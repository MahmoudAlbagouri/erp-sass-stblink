// src/modules/farms/farm-harvests.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  Paginated,
  paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import { nextDocumentNumber } from '../../common/utils/document-number.util';
import {
  dayKeyInZone,
  tenantTimezoneOf,
} from '../../common/utils/timezone.util';
import { restrictToScopedBranches } from '../branches/branch-scope';
import { Product, ProductType } from '../catalog/entities/product.entity';
import { StockLotSource } from '../inventory/entities/stock-lot.entity';
import { StockMovementType } from '../inventory/entities/stock-movement.entity';
import { StockService } from '../inventory/stock.service';
import { WarehousesService } from '../inventory/warehouses.service';
import { CropsService } from './crops.service';
import {
  CreateHarvestDto,
  HarvestQueryDto,
  VoidHarvestDto,
} from './dto/farm-work.dto';
import { FarmOperationType } from './entities/farm-enums';
import { Farm, FarmUnit } from './entities/farm.entity';
import {
  FarmHarvest,
  FarmOperationStatus,
  FarmTransaction,
  FarmTransactionKind,
  HarvestStatus,
  HarvestValuation,
} from './entities/farm-work.entity';
import { FarmPlant, Planting } from './entities/planting.entity';
import { deviceTime } from './farm-utils';
import { FarmsService } from './farms.service';
import { RecordContext } from './farm-operations.service';

const HARVEST_PREFIX = 'HRV-';
export const FARM_HARVEST_REFERENCE = 'farm_harvest';

@Injectable()
export class FarmHarvestsService {
  constructor(
    @InjectRepository(FarmHarvest)
    private readonly harvests: Repository<FarmHarvest>,
    private readonly farms: FarmsService,
    private readonly crops: CropsService,
    private readonly stock: StockService,
    private readonly warehouses: WarehousesService,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(
    tenantId: string,
    query: HarvestQueryDto,
  ): Promise<Paginated<FarmHarvest>> {
    const { page, limit, skip } = resolvePagination(query);
    const qb = this.harvests
      .createQueryBuilder('h')
      .innerJoinAndSelect('h.farm', 'farm')
      .leftJoinAndSelect('h.unit', 'unit')
      .leftJoinAndSelect('h.planting', 'planting')
      .leftJoinAndSelect('planting.crop', 'crop')
      .leftJoinAndSelect('planting.variety', 'variety')
      .leftJoinAndSelect('h.plant', 'plant')
      .innerJoinAndSelect('h.product', 'product')
      .leftJoinAndSelect('product.baseUnit', 'baseUnit')
      .innerJoinAndSelect('h.warehouse', 'warehouse')
      .where('h.tenantId = :tenantId', { tenantId });
    restrictToScopedBranches(qb, 'farm.branchId');
    if (query.farmId)
      qb.andWhere('h.farmId = :farmId', { farmId: query.farmId });
    if (query.plantingId) {
      qb.andWhere('h.plantingId = :plantingId', {
        plantingId: query.plantingId,
      });
    }
    if (query.plantId)
      qb.andWhere('h.plantId = :plantId', { plantId: query.plantId });
    if (query.productId) {
      qb.andWhere('h.productId = :productId', { productId: query.productId });
    }
    if (query.status)
      qb.andWhere('h.status = :status', { status: query.status });
    if (query.unitId) {
      const unit = await this.farms.unitOf(
        this.dataSource.manager,
        query.unitId,
        tenantId,
      );
      qb.andWhere('(unit.id = :unitId OR unit.path LIKE :under)', {
        unitId: unit.id,
        under: `${unit.path}/%`,
      });
    }
    if (query.from || query.to) {
      const zone = await tenantTimezoneOf(this.dataSource.manager, tenantId);
      if (query.from) {
        qb.andWhere(`(h.harvestedAt AT TIME ZONE :zone)::date >= :from`, {
          zone,
          from: query.from,
        });
      }
      if (query.to) {
        qb.andWhere(`(h.harvestedAt AT TIME ZONE :zone)::date <= :to`, {
          zone,
          to: query.to,
        });
      }
    }
    const [data, total] = await qb
      .orderBy('h.harvestedAt', 'DESC')
      .addOrderBy('h.number', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();
    return paginated(data, total, page, limit);
  }

  async findOne(id: string, tenantId: string): Promise<FarmHarvest> {
    const harvest = await this.harvests.findOne({
      where: { id, tenantId },
      relations: [
        'farm',
        'unit',
        'planting',
        'planting.crop',
        'planting.variety',
        'plant',
        'product',
        'product.baseUnit',
        'warehouse',
      ],
    });
    if (!harvest) throw new NotFoundException('الحصاد غير موجود');
    await this.farms.farmOf(this.dataSource.manager, harvest.farmId, tenantId);
    return harvest;
  }

  /**
   * حصاد يدخل المخزن بدفعة (كود المزرعة وتاريخ الجني) وقيمته: المكتوبة، أو
   * التكلفة المعيارية للصنف، أو متوسط المنتج الحالي. الحصاد قبل انتهاء فترة
   * أمان مبيد على الوحدة يُقبل ويُعلَّم (phiViolation) — وقع فعلاً.
   */
  async create(
    dto: CreateHarvestDto,
    tenantId: string,
    ctx: RecordContext = {},
  ) {
    const id = await this.dataSource.transaction(async (manager) => {
      const farm = await this.farms.farmOf(manager, dto.farmId, tenantId);
      const { unit, planting, plant } = await this.scopeOf(
        manager,
        farm,
        dto,
        tenantId,
      );
      const variety = planting?.varietyId
        ? await this.crops.varietyIn(
            manager,
            planting.cropId,
            planting.varietyId,
            tenantId,
          )
        : null;
      const productId =
        dto.productId ??
        (planting
          ? this.crops.harvestProductOf(planting.crop!, variety)
          : null);
      if (!productId) {
        throw new BadRequestException(
          'حدد منتج الحصاد (أو اربطه بالمحصول أو الصنف)',
        );
      }
      const product = await manager.findOne(Product, {
        where: { id: productId, tenantId },
      });
      if (!product) throw new NotFoundException('منتج الحصاد غير موجود');
      if (product.type !== ProductType.STOCKED) {
        throw new BadRequestException('منتج الحصاد يجب أن يكون صنفاً مخزنياً');
      }
      const warehouseId = dto.warehouseId ?? farm.warehouseId;
      if (!warehouseId)
        throw new BadRequestException('حدد مخزن المزرعة أو مخزن الحصاد');
      await this.warehouses.findActiveByIds([warehouseId], tenantId, manager);
      if (
        dto.quantity <= 0 &&
        !(dto.rejectQuantity && dto.rejectQuantity > 0)
      ) {
        throw new BadRequestException('أدخل الكمية المحصودة');
      }

      const zone = await tenantTimezoneOf(manager, tenantId);
      const harvestedAt = deviceTime(dto.harvestedAt);
      const day = dayKeyInZone(harvestedAt, zone);
      const { unitCost, valuation } = await this.valuationOf(
        manager,
        tenantId,
        product.id,
        dto.unitCost,
        variety?.standardCost,
      );
      const value = new Decimal(dto.quantity)
        .mul(unitCost)
        .toDecimalPlaces(3)
        .toNumber();
      const lotNumber =
        dto.lotNumber?.trim() || `${farm.code}-${day.replace(/-/g, '')}`;
      const laborCost =
        dto.laborHours && farm.laborHourCost
          ? new Decimal(dto.laborHours)
              .mul(farm.laborHourCost)
              .toDecimalPlaces(3)
              .toNumber()
          : 0;
      const number = await nextDocumentNumber(
        manager,
        'farm_harvests',
        HARVEST_PREFIX,
        tenantId,
      );
      const harvest = await manager.save(
        manager.create(FarmHarvest, {
          tenantId,
          number,
          farmId: farm.id,
          unitId: unit?.id ?? null,
          plantingId: planting?.id ?? null,
          plantId: plant?.id ?? null,
          harvestedAt,
          productId: product.id,
          warehouseId,
          quantity: dto.quantity,
          grossQuantity: dto.grossQuantity ?? null,
          containers: dto.containers ?? null,
          containerLabel: dto.containerLabel?.trim() || null,
          grade: dto.grade ?? null,
          rejectQuantity: dto.rejectQuantity ?? null,
          rejectReason: dto.rejectReason ?? null,
          unitCost,
          valuation,
          value,
          lotNumber,
          workerCount: dto.workerCount ?? null,
          laborHours: dto.laborHours ?? null,
          laborCost,
          status: HarvestStatus.RECORDED,
          phiViolation: await this.withinSafetyPeriod(manager, farm, unit, day),
          clientUuid: dto.clientUuid ?? null,
          recordedById: ctx.userId ?? null,
          supervisorName: dto.supervisorName?.trim() || null,
          notes: dto.notes ?? null,
        }),
      );
      if (dto.quantity > 0) {
        await this.stock.apply(
          manager,
          tenantId,
          [
            {
              warehouseId,
              productId: product.id,
              type: StockMovementType.HARVEST,
              quantity: dto.quantity,
              unitCost,
              note: `حصاد ${number}`,
              lot: {
                lotNumber,
                manufactureDate: day,
                source: StockLotSource.HARVEST,
                sourceType: FARM_HARVEST_REFERENCE,
                sourceId: harvest.id,
              },
            },
          ],
          {
            referenceType: FARM_HARVEST_REFERENCE,
            referenceId: harvest.id,
            userId: ctx.userId ?? undefined,
            occurredAt: harvestedAt,
          },
        );
        if (value > 0) {
          await manager.save(
            manager.create(FarmTransaction, {
              tenantId,
              farmId: farm.id,
              sourceType: 'harvest',
              sourceId: harvest.id,
              kind: FarmTransactionKind.HARVEST,
              value,
              warehouseId,
              reference: number,
              occurredAt: harvestedAt,
            }),
          );
        }
      }
      return harvest.id;
    });
    return this.findOne(id, tenantId);
  }

  /** إلغاء حصاد سُجّل خطأً: يخرج من دفعته ويُعكس قيده (إن بقي في المخزن) */
  async void(
    id: string,
    dto: VoidHarvestDto,
    tenantId: string,
    ctx: RecordContext = {},
  ) {
    await this.dataSource.transaction(async (manager) => {
      const harvest = await manager.findOne(FarmHarvest, {
        where: { id, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!harvest) throw new NotFoundException('الحصاد غير موجود');
      await this.farms.farmOf(manager, harvest.farmId, tenantId);
      if (harvest.status === HarvestStatus.VOIDED) {
        throw new BadRequestException('الحصاد ملغى من قبل');
      }
      const now = new Date();
      if (Number(harvest.quantity) > 0) {
        await this.stock.apply(
          manager,
          tenantId,
          [
            {
              warehouseId: harvest.warehouseId,
              productId: harvest.productId,
              type: StockMovementType.HARVEST,
              quantity: -Number(harvest.quantity),
              note: `إلغاء حصاد ${harvest.number}`,
              lotsFrom: {
                referenceType: FARM_HARVEST_REFERENCE,
                referenceId: id,
              },
            },
          ],
          {
            referenceType: FARM_HARVEST_REFERENCE,
            referenceId: id,
            userId: ctx.userId ?? undefined,
            occurredAt: now,
          },
        );
        if (Number(harvest.value) > 0) {
          await manager.save(
            manager.create(FarmTransaction, {
              tenantId,
              farmId: harvest.farmId,
              sourceType: 'harvest',
              sourceId: harvest.id,
              kind: FarmTransactionKind.HARVEST_REVERSAL,
              value: harvest.value,
              warehouseId: harvest.warehouseId,
              reference: harvest.number,
              occurredAt: now,
            }),
          );
        }
      }
      await manager.update(
        FarmHarvest,
        { id },
        {
          status: HarvestStatus.VOIDED,
          voidedAt: now,
          voidReason: dto.reason.trim(),
        },
      );
    });
    return this.findOne(id, tenantId);
  }

  /** للشاشة الميدانية: حصاد سبق رفعه بنفس معرّف الجهاز */
  findByClientUuid(tenantId: string, clientUuid: string) {
    return this.harvests.findOne({
      where: { tenantId, clientUuid },
      withDeleted: true,
    });
  }

  // ─── مساعدات ───

  /** قيمة الوحدة: المكتوبة ← المعيارية للصنف ← متوسط المنتج ← صفر */
  private async valuationOf(
    manager: EntityManager,
    tenantId: string,
    productId: string,
    manual?: number | null,
    standard?: number | null,
  ): Promise<{ unitCost: number; valuation: HarvestValuation }> {
    if (manual !== undefined && manual !== null) {
      return { unitCost: Number(manual), valuation: HarvestValuation.MANUAL };
    }
    if (standard !== undefined && standard !== null) {
      return {
        unitCost: Number(standard),
        valuation: HarvestValuation.STANDARD,
      };
    }
    const [item] = await manager.query<{ avgCost: string }[]>(
      `SELECT "avgCost" FROM inventory_items WHERE "tenantId" = $1 AND "productId" = $2`,
      [tenantId, productId],
    );
    const average = Number(item?.avgCost ?? 0);
    return average > 0
      ? { unitCost: average, valuation: HarvestValuation.AVERAGE }
      : { unitCost: 0, valuation: HarvestValuation.ZERO };
  }

  /**
   * هل يقع الجني داخل فترة أمان مبيد؟ الرش على الوحدة أو أحد آبائها أو ما
   * تحتها، أو على المزرعة كلها، وما زال "لا يُحصد قبل" بعد يوم الجني.
   */
  private async withinSafetyPeriod(
    manager: EntityManager,
    farm: Farm,
    unit: FarmUnit | null,
    day: string,
  ): Promise<boolean> {
    const [row] = await manager.query<{ hit: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM farm_operations o
           LEFT JOIN farm_units u ON u.id = o."unitId"
          WHERE o."farmId" = $1 AND o."deletedAt" IS NULL
            AND o.status = '${FarmOperationStatus.DONE}'
            AND o.type = '${FarmOperationType.SPRAYING}'
            AND o."harvestAllowedAt" > $2::date
            AND ($3::text IS NULL OR o."unitId" IS NULL
                 OR o."unitId" = ANY(string_to_array($3, '/')::uuid[])
                 OR u.path LIKE $3 || '/%')
       ) AS "hit"`,
      [farm.id, day, unit?.path ?? null],
    );
    return !!row?.hit;
  }

  /** النخلة ← زراعتها ووحدتها؛ الزراعة ← وحدتها — وكلها في المزرعة */
  private async scopeOf(
    manager: EntityManager,
    farm: Farm,
    dto: CreateHarvestDto,
    tenantId: string,
  ): Promise<{
    unit: FarmUnit | null;
    planting: Planting | null;
    plant: FarmPlant | null;
  }> {
    const plant = dto.plantId
      ? await manager.findOne(FarmPlant, {
          where: { id: dto.plantId, tenantId },
        })
      : null;
    if (dto.plantId && (!plant || plant.farmId !== farm.id)) {
      throw new NotFoundException('النخلة غير موجودة في المزرعة');
    }
    const plantingId = plant?.plantingId ?? dto.plantingId ?? null;
    const planting = plantingId
      ? await manager.findOne(Planting, {
          where: { id: plantingId, tenantId },
          relations: ['crop'],
        })
      : null;
    if (plantingId && (!planting || planting.farmId !== farm.id)) {
      throw new NotFoundException('الزراعة غير موجودة في المزرعة');
    }
    if (dto.plantingId && plant && plant.plantingId !== dto.plantingId) {
      throw new BadRequestException(`النخلة ${plant.tag} ليست في هذه الزراعة`);
    }
    const unitId = plant?.unitId ?? dto.unitId ?? planting?.unitId ?? null;
    const unit = unitId
      ? await this.farms.unitOf(manager, unitId, tenantId)
      : null;
    if (unit && unit.farmId !== farm.id) {
      throw new NotFoundException('الوحدة غير موجودة في المزرعة');
    }
    return { unit, planting, plant };
  }
}
