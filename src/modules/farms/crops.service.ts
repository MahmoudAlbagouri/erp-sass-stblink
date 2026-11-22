// src/modules/farms/crops.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Product, ProductType } from '../catalog/entities/product.entity';
import {
  CalendarStepDto,
  CreateCropDto,
  CropVarietyDto,
  UpdateCalendarStepDto,
  UpdateCropDto,
  UpdateCropVarietyDto,
} from './dto/crops.dto';
import {
  Crop,
  CropCalendarStep,
  CropCategory,
  CropLifecycle,
  CropVariety,
} from './entities/crop.entity';
import { PlantingTrackingMode } from './entities/farm-enums';

/** الافتراضي لكل فئة: النخيل نخلة نخلة، الأشجار بالعدد، والباقي بالمساحة */
const CATEGORY_DEFAULTS: Record<
  CropCategory,
  { lifecycle: CropLifecycle; tracking: PlantingTrackingMode }
> = {
  [CropCategory.PALM]: {
    lifecycle: CropLifecycle.PERENNIAL,
    tracking: PlantingTrackingMode.INDIVIDUAL,
  },
  [CropCategory.FRUIT_TREE]: {
    lifecycle: CropLifecycle.PERENNIAL,
    tracking: PlantingTrackingMode.COUNT,
  },
  [CropCategory.ORNAMENTAL]: {
    lifecycle: CropLifecycle.PERENNIAL,
    tracking: PlantingTrackingMode.COUNT,
  },
  [CropCategory.FIELD_CROP]: {
    lifecycle: CropLifecycle.ANNUAL,
    tracking: PlantingTrackingMode.AREA,
  },
  [CropCategory.VEGETABLE]: {
    lifecycle: CropLifecycle.ANNUAL,
    tracking: PlantingTrackingMode.AREA,
  },
  [CropCategory.FORAGE]: {
    lifecycle: CropLifecycle.ANNUAL,
    tracking: PlantingTrackingMode.AREA,
  },
  [CropCategory.GREENHOUSE]: {
    lifecycle: CropLifecycle.ANNUAL,
    tracking: PlantingTrackingMode.AREA,
  },
  [CropCategory.OTHER]: {
    lifecycle: CropLifecycle.ANNUAL,
    tracking: PlantingTrackingMode.AREA,
  },
};

@Injectable()
export class CropsService {
  constructor(
    @InjectRepository(Crop) private readonly crops: Repository<Crop>,
    @InjectRepository(CropVariety)
    private readonly varieties: Repository<CropVariety>,
    @InjectRepository(CropCalendarStep)
    private readonly steps: Repository<CropCalendarStep>,
    private readonly dataSource: DataSource,
  ) {}

  /** المحاصيل بأصنافها ومنتجات حصادها */
  findAll(tenantId: string): Promise<Crop[]> {
    return this.crops
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.harvestProduct', 'hp')
      .leftJoinAndSelect('hp.baseUnit', 'hpUnit')
      .leftJoinAndSelect('c.varieties', 'v', 'v.deletedAt IS NULL')
      .leftJoinAndSelect('v.harvestProduct', 'vp')
      .where('c.tenantId = :tenantId', { tenantId })
      .orderBy('c.name', 'ASC')
      .addOrderBy('v.name', 'ASC')
      .getMany();
  }

  async findOne(id: string, tenantId: string): Promise<Crop> {
    const crop = await this.crops
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.harvestProduct', 'hp')
      .leftJoinAndSelect('hp.baseUnit', 'hpUnit')
      .leftJoinAndSelect('c.varieties', 'v', 'v.deletedAt IS NULL')
      .leftJoinAndSelect('v.harvestProduct', 'vp')
      .where('c.tenantId = :tenantId AND c.id = :id', { tenantId, id })
      .orderBy('v.name', 'ASC')
      .getOne();
    if (!crop) throw new NotFoundException('المحصول غير موجود');
    return crop;
  }

  async create(dto: CreateCropDto, tenantId: string): Promise<Crop> {
    const defaults = CATEGORY_DEFAULTS[dto.category];
    await this.assertUniqueCrop(tenantId, dto.name.trim());
    await this.assertHarvestProduct(
      this.dataSource.manager,
      dto.harvestProductId,
      tenantId,
    );
    const saved = await this.crops.save(
      this.crops.create({
        tenantId,
        name: dto.name.trim(),
        category: dto.category,
        lifecycle: dto.lifecycle ?? defaults.lifecycle,
        defaultTrackingMode: dto.defaultTrackingMode ?? defaults.tracking,
        harvestProductId: dto.harvestProductId ?? null,
        notes: dto.notes ?? null,
        isActive: dto.isActive ?? true,
      }),
    );
    return this.findOne(saved.id, tenantId);
  }

  async update(
    id: string,
    dto: UpdateCropDto,
    tenantId: string,
  ): Promise<Crop> {
    const crop = await this.findOne(id, tenantId);
    if (dto.name && dto.name.trim() !== crop.name) {
      await this.assertUniqueCrop(tenantId, dto.name.trim(), id);
    }
    await this.assertHarvestProduct(
      this.dataSource.manager,
      dto.harvestProductId,
      tenantId,
    );
    const changes: Partial<Crop> = {};
    if (dto.name !== undefined) changes.name = dto.name.trim();
    for (const key of [
      'category',
      'lifecycle',
      'defaultTrackingMode',
      'harvestProductId',
      'notes',
      'isActive',
    ] as const) {
      if (dto[key] !== undefined) {
        (changes as Record<string, unknown>)[key] = dto[key];
      }
    }
    await this.crops.update({ id, tenantId }, changes);
    return this.findOne(id, tenantId);
  }

  /** حذف محصول لم يُزرع؛ المزروع يوقف */
  async remove(id: string, tenantId: string): Promise<void> {
    await this.findOne(id, tenantId);
    const [used] = await this.dataSource.query<{ used: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM plantings WHERE "cropId" = $1) AS "used"`,
      [id],
    );
    if (used?.used) {
      throw new ConflictException('المحصول مزروع — أوقفه بدل حذفه');
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(CropCalendarStep, { cropId: id, tenantId });
      await manager.softDelete(CropVariety, { cropId: id, tenantId });
      await manager.softDelete(Crop, { id, tenantId });
    });
  }

  // ─── الأصناف ───

  async addVariety(
    cropId: string,
    dto: CropVarietyDto,
    tenantId: string,
  ): Promise<CropVariety> {
    await this.findOne(cropId, tenantId);
    await this.assertUniqueVariety(cropId, dto.name.trim());
    await this.assertHarvestProduct(
      this.dataSource.manager,
      dto.harvestProductId,
      tenantId,
    );
    return this.varieties.save(
      this.varieties.create({
        ...dto,
        name: dto.name.trim(),
        tenantId,
        cropId,
        isActive: dto.isActive ?? true,
      }),
    );
  }

  async updateVariety(
    cropId: string,
    varietyId: string,
    dto: UpdateCropVarietyDto,
    tenantId: string,
  ): Promise<CropVariety> {
    const variety = await this.varietyOf(cropId, varietyId, tenantId);
    if (dto.name && dto.name.trim() !== variety.name) {
      await this.assertUniqueVariety(cropId, dto.name.trim(), varietyId);
    }
    await this.assertHarvestProduct(
      this.dataSource.manager,
      dto.harvestProductId,
      tenantId,
    );
    Object.assign(variety, dto, dto.name ? { name: dto.name.trim() } : {});
    return this.varieties.save(variety);
  }

  async removeVariety(
    cropId: string,
    varietyId: string,
    tenantId: string,
  ): Promise<void> {
    await this.varietyOf(cropId, varietyId, tenantId);
    const [used] = await this.dataSource.query<{ used: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM plantings WHERE "varietyId" = $1) AS "used"`,
      [varietyId],
    );
    if (used?.used) throw new ConflictException('الصنف مزروع — أوقفه بدل حذفه');
    await this.varieties.softDelete({ id: varietyId, tenantId });
  }

  // ─── التقويم الزراعي ───

  async listSteps(
    cropId: string,
    tenantId: string,
  ): Promise<CropCalendarStep[]> {
    await this.findOne(cropId, tenantId);
    return this.steps.find({
      where: { cropId, tenantId },
      relations: ['variety'],
      order: { sortOrder: 'ASC', month: 'ASC', dayOffset: 'ASC' },
    });
  }

  async addStep(
    cropId: string,
    dto: CalendarStepDto,
    tenantId: string,
  ): Promise<CropCalendarStep> {
    await this.findOne(cropId, tenantId);
    if (dto.varietyId) await this.varietyOf(cropId, dto.varietyId, tenantId);
    assertStepTiming(dto);
    return this.steps.save(
      this.steps.create({
        ...dto,
        title: dto.title.trim(),
        tenantId,
        cropId,
        sortOrder: dto.sortOrder ?? 0,
      }),
    );
  }

  async updateStep(
    cropId: string,
    stepId: string,
    dto: UpdateCalendarStepDto,
    tenantId: string,
  ): Promise<CropCalendarStep> {
    const step = await this.steps.findOne({
      where: { id: stepId, cropId, tenantId },
    });
    if (!step) throw new NotFoundException('خطوة التقويم غير موجودة');
    if (dto.varietyId) await this.varietyOf(cropId, dto.varietyId, tenantId);
    Object.assign(step, dto, dto.title ? { title: dto.title.trim() } : {});
    assertStepTiming(step);
    return this.steps.save(step);
  }

  async removeStep(
    cropId: string,
    stepId: string,
    tenantId: string,
  ): Promise<void> {
    const result = await this.steps.softDelete({
      id: stepId,
      cropId,
      tenantId,
    });
    if (!result.affected)
      throw new NotFoundException('خطوة التقويم غير موجودة');
  }

  // ─── للخدمات الأخرى ───

  async cropOf(
    manager: EntityManager,
    id: string,
    tenantId: string,
  ): Promise<Crop> {
    const crop = await manager.findOne(Crop, { where: { id, tenantId } });
    if (!crop) throw new NotFoundException('المحصول غير موجود');
    return crop;
  }

  async varietyIn(
    manager: EntityManager,
    cropId: string,
    varietyId: string,
    tenantId: string,
  ): Promise<CropVariety> {
    const variety = await manager.findOne(CropVariety, {
      where: { id: varietyId, cropId, tenantId },
    });
    if (!variety) throw new NotFoundException('الصنف غير موجود في هذا المحصول');
    return variety;
  }

  /** منتج الحصاد: للصنف، وإلا للمحصول */
  harvestProductOf(crop: Crop, variety?: CropVariety | null): string | null {
    return variety?.harvestProductId ?? crop.harvestProductId ?? null;
  }

  private async varietyOf(
    cropId: string,
    varietyId: string,
    tenantId: string,
  ): Promise<CropVariety> {
    return this.varietyIn(this.dataSource.manager, cropId, varietyId, tenantId);
  }

  private async assertUniqueCrop(
    tenantId: string,
    name: string,
    exceptId?: string,
  ) {
    const clash = await this.crops.findOne({ where: { tenantId, name } });
    if (clash && clash.id !== exceptId) {
      throw new ConflictException(`محصول باسم "${name}" موجود`);
    }
  }

  private async assertUniqueVariety(
    cropId: string,
    name: string,
    exceptId?: string,
  ) {
    const clash = await this.varieties.findOne({ where: { cropId, name } });
    if (clash && clash.id !== exceptId) {
      throw new ConflictException(`صنف باسم "${name}" موجود`);
    }
  }

  /** منتج الحصاد صنف مخزني (يدخل المخزن بدفعة) */
  private async assertHarvestProduct(
    manager: EntityManager,
    productId: string | null | undefined,
    tenantId: string,
  ): Promise<void> {
    if (!productId) return;
    const product = await manager.findOne(Product, {
      where: { id: productId, tenantId },
    });
    if (!product) throw new NotFoundException('منتج الحصاد غير موجود');
    if (product.type !== ProductType.STOCKED) {
      throw new BadRequestException('منتج الحصاد يجب أن يكون صنفاً مخزنياً');
    }
  }
}

function assertStepTiming(step: {
  anchor?: 'planting' | 'yearly';
  dayOffset?: number | null;
  month?: number | null;
  day?: number | null;
}): void {
  if (step.anchor === 'planting' && (step.dayOffset ?? null) === null) {
    throw new BadRequestException('حدد بعد الزرع بكم يوم');
  }
  if (step.anchor === 'yearly' && (!step.month || !step.day)) {
    throw new BadRequestException('حدد الشهر واليوم');
  }
}
