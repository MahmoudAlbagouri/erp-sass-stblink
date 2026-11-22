// src/modules/farms/plantings.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, In, Not, Repository } from 'typeorm';
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
import {
  assertBranchVisible,
  restrictToScopedBranches,
} from '../branches/branch-scope';
import { CropsService } from './crops.service';
import {
  ActivatePlantingDto,
  BulkPlantsDto,
  ClosePlantingDto,
  CreatePlantDto,
  CreatePlantingDto,
  PlantQueryDto,
  PlantStatusDto,
  PlantingQueryDto,
  UpdatePlantDto,
  UpdatePlantingDto,
} from './dto/crops.dto';
import { CropLifecycle } from './entities/crop.entity';
import { DatePrecision, PlantingTrackingMode } from './entities/farm-enums';
import { FarmUnit } from './entities/farm.entity';
import {
  FarmOperation,
  FarmOperationStatus,
} from './entities/farm-work.entity';
import {
  FarmPlant,
  FarmPlantStatusLog,
  GONE_PLANT_STATUSES,
  PlantRemovalReason,
  PlantSex,
  PlantSource,
  PlantStatus,
  Planting,
  PlantingEndReason,
  PlantingStatus,
} from './entities/planting.entity';
import { FarmPlanService } from './farm-plan.service';
import { addDays, deviceTime } from './farm-utils';
import { FarmsService } from './farms.service';

const PLANTING_PREFIX = 'PLT-';

/** أسباب إنهاء تعني فشل الزراعة لا اكتمالها */
const FAILURE_REASONS: readonly PlantingEndReason[] = [
  PlantingEndReason.CROP_FAILURE,
  PlantingEndReason.PEST,
  PlantingEndReason.DISEASE,
  PlantingEndReason.FROST,
  PlantingEndReason.HEAT,
  PlantingEndReason.DROUGHT,
  PlantingEndReason.FLOOD,
  PlantingEndReason.SALINITY,
];

const GONE_SQL = `('${PlantStatus.DEAD}', '${PlantStatus.REMOVED}')`;

export interface PlantStatusChange {
  reason?: string | null;
  removalReason?: PlantRemovalReason | null;
  sourceType: 'inspection' | 'operation' | 'manual' | 'field';
  sourceId?: string | null;
  occurredAt?: Date;
  userId?: string | null;
}

@Injectable()
export class PlantingsService {
  constructor(
    @InjectRepository(Planting)
    private readonly plantings: Repository<Planting>,
    @InjectRepository(FarmPlant) private readonly plants: Repository<FarmPlant>,
    private readonly farms: FarmsService,
    private readonly crops: CropsService,
    private readonly plan: FarmPlanService,
    private readonly dataSource: DataSource,
  ) {}

  // ══════════════════════════ الزراعات ══════════════════════════

  async findAll(
    tenantId: string,
    query: PlantingQueryDto,
  ): Promise<Paginated<Planting>> {
    const { page, limit, skip } = resolvePagination(query);
    const qb = this.plantings
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.farm', 'farm')
      .innerJoinAndSelect('p.unit', 'unit')
      .innerJoinAndSelect('p.crop', 'crop')
      .leftJoinAndSelect('p.variety', 'variety')
      .where('p.tenantId = :tenantId', { tenantId });
    restrictToScopedBranches(qb, 'farm.branchId');
    if (query.farmId)
      qb.andWhere('p.farmId = :farmId', { farmId: query.farmId });
    if (query.cropId)
      qb.andWhere('p.cropId = :cropId', { cropId: query.cropId });
    if (query.status === 'open') {
      qb.andWhere('p.status IN (:...open)', {
        open: [PlantingStatus.PLANNED, PlantingStatus.ACTIVE],
      });
    } else if (query.status) {
      qb.andWhere('p.status = :status', { status: query.status });
    }
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
    if (query.search) {
      qb.andWhere(
        '(p.number ILIKE :s OR crop.name ILIKE :s OR variety.name ILIKE :s OR unit.name ILIKE :s OR p.season ILIKE :s)',
        { s: `%${query.search.trim()}%` },
      );
    }
    const [data, total] = await qb
      .orderBy('p.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();
    return paginated(data, total, page, limit);
  }

  /** الزراعة وأرقامها: النخيل بحالاته، الحصاد، العمليات، والمخطط مقابل الفعلي */
  async findOne(id: string, tenantId: string) {
    const planting = await this.plantings.findOne({
      where: { id, tenantId },
      relations: [
        'farm',
        'unit',
        'crop',
        'crop.harvestProduct',
        'variety',
        'variety.harvestProduct',
      ],
    });
    if (!planting) throw new NotFoundException('الزراعة غير موجودة');
    assertBranchVisible(planting.farm?.branchId, 'الزراعة غير موجودة');

    const [plantsByStatus, harvest, operations] = await Promise.all([
      this.dataSource.query<{ status: PlantStatus; count: string }[]>(
        `SELECT status, COUNT(*) AS "count" FROM farm_plants
          WHERE "plantingId" = $1 AND "deletedAt" IS NULL GROUP BY status`,
        [id],
      ),
      this.dataSource.query<
        {
          quantity: string;
          reject: string;
          value: string;
          count: string;
          last: Date | null;
        }[]
      >(
        `SELECT COALESCE(SUM(quantity), 0) AS "quantity",
                COALESCE(SUM("rejectQuantity"), 0) AS "reject",
                COALESCE(SUM(value), 0) AS "value", COUNT(*) AS "count",
                MAX("harvestedAt") AS "last"
           FROM farm_harvests
          WHERE "plantingId" = $1 AND "deletedAt" IS NULL AND status = 'recorded'`,
        [id],
      ),
      this.dataSource.query<
        {
          status: FarmOperationStatus;
          count: string;
          inputCost: string;
          laborCost: string;
          water: string;
        }[]
      >(
        `SELECT status, COUNT(*) AS "count", COALESCE(SUM("inputCost"), 0) AS "inputCost",
                COALESCE(SUM("laborCost"), 0) AS "laborCost", COALESCE(SUM("waterM3"), 0) AS "water"
           FROM farm_operations
          WHERE "plantingId" = $1 AND "deletedAt" IS NULL GROUP BY status`,
        [id],
      ),
    ]);
    const done = operations.find((o) => o.status === FarmOperationStatus.DONE);
    const h = harvest[0];
    return {
      ...planting,
      plantsByStatus: Object.fromEntries(
        plantsByStatus.map((r) => [r.status, Number(r.count)]),
      ),
      harvest: {
        quantity: Number(h?.quantity ?? 0),
        rejectQuantity: Number(h?.reject ?? 0),
        value: Number(h?.value ?? 0),
        count: Number(h?.count ?? 0),
        lastAt: h?.last ?? null,
      },
      operations: {
        planned: Number(
          operations.find((o) => o.status === FarmOperationStatus.PLANNED)
            ?.count ?? 0,
        ),
        done: Number(done?.count ?? 0),
        inputCost: Number(done?.inputCost ?? 0),
        laborCost: Number(done?.laborCost ?? 0),
        waterM3: Number(done?.water ?? 0),
      },
      expected: this.expectedYieldOf(planting),
    };
  }

  async create(dto: CreatePlantingDto, tenantId: string) {
    const id = await this.dataSource.transaction(async (manager) => {
      const unit = await this.farms.unitOf(manager, dto.unitId, tenantId);
      const farm = await this.farms.farmOf(manager, unit.farmId, tenantId);
      if (!farm.isActive) throw new BadRequestException('المزرعة موقوفة');
      const crop = await this.crops.cropOf(manager, dto.cropId, tenantId);
      const variety = dto.varietyId
        ? await this.crops.varietyIn(manager, crop.id, dto.varietyId, tenantId)
        : null;
      const trackingMode = dto.trackingMode ?? crop.defaultTrackingMode;
      const status = dto.status ?? PlantingStatus.ACTIVE;
      const zone = await tenantTimezoneOf(manager, tenantId);
      const plantedAt =
        dto.plantedAt ??
        (status === PlantingStatus.ACTIVE
          ? dayKeyInZone(new Date(), zone)
          : null);
      const plantCount =
        trackingMode === PlantingTrackingMode.INDIVIDUAL
          ? 0
          : (dto.plantCount ?? 0);
      const areaM2 = dto.areaM2 ?? unit.areaM2 ?? null;
      const expectedHarvestAt =
        dto.expectedHarvestAt ??
        (crop.lifecycle === CropLifecycle.ANNUAL &&
        plantedAt &&
        variety?.daysToHarvest
          ? addDays(plantedAt, variety.daysToHarvest)
          : null);
      const expectedYield =
        dto.expectedYield ??
        this.expectedYieldOf({
          crop,
          variety,
          plantCount,
          areaM2,
          trackingMode,
        }) ??
        null;

      const number = await nextDocumentNumber(
        manager,
        'plantings',
        PLANTING_PREFIX,
        tenantId,
      );
      const planting = await manager.save(
        manager.create(Planting, {
          tenantId,
          number,
          farmId: farm.id,
          unitId: unit.id,
          cropId: crop.id,
          varietyId: variety?.id ?? null,
          trackingMode,
          plantCount,
          areaM2,
          plantedAt,
          plantedAtPrecision: dto.plantedAtPrecision ?? DatePrecision.DAY,
          season: dto.season?.trim() || null,
          expectedHarvestAt,
          expectedYield,
          status,
          startedAt: status === PlantingStatus.ACTIVE ? new Date() : null,
          notes: dto.notes ?? null,
        }),
      );
      if (dto.generatePlan) {
        await this.plan.forPlanting(manager, planting, tenantId);
      }
      return planting.id;
    });
    return this.findOne(id, tenantId);
  }

  async update(id: string, dto: UpdatePlantingDto, tenantId: string) {
    await this.dataSource.transaction(async (manager) => {
      const planting = await this.lock(manager, id, tenantId);
      const changes: Partial<Planting> = {};
      if (dto.varietyId !== undefined) {
        changes.varietyId = dto.varietyId
          ? (
              await this.crops.varietyIn(
                manager,
                planting.cropId,
                dto.varietyId,
                tenantId,
              )
            ).id
          : null;
      }
      if (dto.plantCount !== undefined) {
        if (planting.trackingMode === PlantingTrackingMode.INDIVIDUAL) {
          throw new BadRequestException(
            'العدد يُحسب من سجل النخيل — سجّلها أو غيّر حالاتها',
          );
        }
        changes.plantCount = dto.plantCount;
      }
      for (const key of [
        'areaM2',
        'plantedAt',
        'plantedAtPrecision',
        'expectedHarvestAt',
        'expectedYield',
        'notes',
      ] as const) {
        if (dto[key] !== undefined) {
          (changes as Record<string, unknown>)[key] = dto[key];
        }
      }
      if (dto.season !== undefined) changes.season = dto.season?.trim() || null;
      if (Object.keys(changes).length) {
        await manager.update(Planting, { id }, changes);
      }
    });
    return this.findOne(id, tenantId);
  }

  /** زراعة مخططة زُرعت فعلاً */
  async activate(id: string, dto: ActivatePlantingDto, tenantId: string) {
    await this.dataSource.transaction(async (manager) => {
      const planting = await this.lock(manager, id, tenantId);
      if (planting.status !== PlantingStatus.PLANNED) {
        throw new BadRequestException('الزراعة ليست مخططة');
      }
      const zone = await tenantTimezoneOf(manager, tenantId);
      await manager.update(
        Planting,
        { id },
        {
          status: PlantingStatus.ACTIVE,
          plantedAt: dto.plantedAt ?? dayKeyInZone(new Date(), zone),
          startedAt: new Date(),
        },
      );
    });
    return this.findOne(id, tenantId);
  }

  /**
   * إنهاء زراعة بسببها: الاكتمال (حُصدت) أو القلع يغلقها، وأسباب الفشل (آفة،
   * صقيع...) تجعلها فاشلة. عملياتها المخططة تُلغى، ونخيل الزراعة المقلوعة يُقلع.
   */
  async close(
    id: string,
    dto: ClosePlantingDto,
    tenantId: string,
    userId?: string,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const planting = await this.lock(manager, id, tenantId);
      if (
        ![PlantingStatus.ACTIVE, PlantingStatus.PLANNED].includes(
          planting.status,
        )
      ) {
        throw new BadRequestException('الزراعة منتهية من قبل');
      }
      const zone = await tenantTimezoneOf(manager, tenantId);
      await manager.update(
        Planting,
        { id },
        {
          status: FAILURE_REASONS.includes(dto.reason)
            ? PlantingStatus.FAILED
            : PlantingStatus.CLOSED,
          closedAt: dto.closedAt ?? dayKeyInZone(new Date(), zone),
          closeReason: dto.reason,
          notes: dto.notes ?? planting.notes ?? null,
        },
      );
      await manager.update(
        FarmOperation,
        { plantingId: id, status: FarmOperationStatus.PLANNED },
        {
          status: FarmOperationStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: 'انتهت الزراعة',
        },
      );
      if (dto.reason === PlantingEndReason.REMOVED) {
        const live = await manager.find(FarmPlant, {
          where: { plantingId: id, status: Not(In([...GONE_PLANT_STATUSES])) },
        });
        for (const plant of live) {
          await this.applyStatus(manager, plant, PlantStatus.REMOVED, {
            reason: 'قلع الزراعة',
            removalReason: PlantRemovalReason.OTHER,
            sourceType: 'manual',
            userId,
          });
        }
        await this.recount(manager, id);
      }
    });
    return this.findOne(id, tenantId);
  }

  /** حذف زراعة مخططة لم يُعمل فيها شيء */
  async remove(id: string, tenantId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const planting = await this.lock(manager, id, tenantId);
      const [used] = await manager.query<{ used: boolean }[]>(
        `SELECT EXISTS (SELECT 1 FROM farm_plants WHERE "plantingId" = $1)
             OR EXISTS (SELECT 1 FROM farm_harvests WHERE "plantingId" = $1)
             OR EXISTS (SELECT 1 FROM farm_operations WHERE "plantingId" = $1 AND status = 'done') AS "used"`,
        [id],
      );
      if (planting.status !== PlantingStatus.PLANNED || used?.used) {
        throw new ConflictException(
          'الزراعة عليها عمل مسجّل — أنهِها بسببها بدل حذفها',
        );
      }
      await manager.softDelete(FarmOperation, { plantingId: id });
      await manager.softDelete(Planting, { id });
    });
  }

  /** الزراعة داخل معاملة (للخدمات الأخرى) */
  async plantingOf(
    manager: EntityManager,
    id: string,
    tenantId: string,
  ): Promise<Planting> {
    const planting = await manager.findOne(Planting, {
      where: { id, tenantId },
      relations: ['crop', 'variety'],
    });
    if (!planting) throw new NotFoundException('الزراعة غير موجودة');
    return planting;
  }

  /**
   * المتوقع للموسم/الدورة: المكتوب، وإلا من الصنف (للنبتة × العدد للمعمّر،
   * أو للهكتار × المساحة للحولي)
   */
  expectedYieldOf(p: {
    expectedYield?: number | null;
    crop?: { lifecycle: CropLifecycle } | null;
    variety?: {
      expectedYieldPerPlant?: number | null;
      expectedYieldPerHectare?: number | null;
    } | null;
    plantCount: number;
    areaM2?: number | null;
    trackingMode: PlantingTrackingMode;
  }): number | null {
    if (p.expectedYield !== undefined && p.expectedYield !== null)
      return Number(p.expectedYield);
    const perPlant = p.variety?.expectedYieldPerPlant;
    const perHectare = p.variety?.expectedYieldPerHectare;
    if (
      p.trackingMode !== PlantingTrackingMode.AREA &&
      perPlant &&
      p.plantCount
    ) {
      return new Decimal(perPlant)
        .mul(p.plantCount)
        .toDecimalPlaces(3)
        .toNumber();
    }
    if (perHectare && p.areaM2) {
      return new Decimal(perHectare)
        .mul(p.areaM2)
        .div(10000)
        .toDecimalPlaces(3)
        .toNumber();
    }
    return null;
  }

  // ══════════════════════════ سجل النخيل والأشجار ══════════════════════════

  async findPlants(
    tenantId: string,
    query: PlantQueryDto,
  ): Promise<Paginated<FarmPlant>> {
    const { page, limit, skip } = resolvePagination(query);
    const qb = this.plants
      .createQueryBuilder('pl')
      .innerJoinAndSelect('pl.farm', 'farm')
      .innerJoinAndSelect('pl.unit', 'unit')
      .innerJoinAndSelect('pl.planting', 'planting')
      .innerJoinAndSelect('planting.crop', 'crop')
      .leftJoinAndSelect('planting.variety', 'variety')
      .where('pl.tenantId = :tenantId', { tenantId });
    restrictToScopedBranches(qb, 'farm.branchId');
    if (query.farmId)
      qb.andWhere('pl.farmId = :farmId', { farmId: query.farmId });
    if (query.plantingId) {
      qb.andWhere('pl.plantingId = :plantingId', {
        plantingId: query.plantingId,
      });
    }
    if (query.varietyId) {
      qb.andWhere('planting.varietyId = :varietyId', {
        varietyId: query.varietyId,
      });
    }
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
    if (query.status === 'live') {
      qb.andWhere(`pl.status NOT IN ${GONE_SQL}`);
    } else if (query.status) {
      qb.andWhere('pl.status = :status', { status: query.status });
    }
    if (query.sex) qb.andWhere('pl.sex = :sex', { sex: query.sex });
    if (query.search) {
      qb.andWhere('pl.tag ILIKE :s', { s: `%${query.search.trim()}%` });
    }
    const [data, total] = await qb
      .orderBy('unit.path', 'ASC')
      .addOrderBy('pl.position', 'ASC', 'NULLS LAST')
      .addOrderBy('pl.tag', 'ASC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();
    return paginated(data, total, page, limit);
  }

  /** النخلة وتاريخها: حالاتها، إنتاجها بالسنة، عملياتها، وفحوصها */
  async plantDetail(id: string, tenantId: string) {
    const plant = await this.plants.findOne({
      where: { id, tenantId },
      relations: [
        'farm',
        'unit',
        'planting',
        'planting.crop',
        'planting.variety',
        'motherPlant',
      ],
    });
    if (!plant) throw new NotFoundException('النبتة غير موجودة');
    assertBranchVisible(plant.farm?.branchId, 'النبتة غير موجودة');
    const [history, yields, operations, inspections, offshoots] =
      await Promise.all([
        this.dataSource.manager.find(FarmPlantStatusLog, {
          where: { plantId: id, tenantId },
          order: { occurredAt: 'DESC' },
          take: 100,
        }),
        this.dataSource.query<
          { year: string; quantity: string; harvests: string }[]
        >(
          `SELECT to_char("harvestedAt", 'YYYY') AS "year", SUM(quantity) AS "quantity",
                COUNT(*) AS "harvests"
           FROM farm_harvests
          WHERE "plantId" = $1 AND "deletedAt" IS NULL AND status = 'recorded'
          GROUP BY 1 ORDER BY 1 DESC`,
          [id],
        ),
        this.dataSource.query<
          {
            id: string;
            number: string;
            type: string;
            performedAt: Date;
            quantity: string | null;
          }[]
        >(
          `SELECT o.id, o.number, o.type, o."performedAt", op.quantity
           FROM farm_operation_plants op
           JOIN farm_operations o ON o.id = op."operationId"
          WHERE op."plantId" = $1 AND o."deletedAt" IS NULL AND o.status = 'done'
          ORDER BY o."performedAt" DESC LIMIT 100`,
          [id],
        ),
        this.dataSource.query<
          {
            id: string;
            number: string;
            pest: string;
            severity: number;
            status: string;
            inspectedAt: Date;
          }[]
        >(
          `SELECT id, number, pest, severity, status, "inspectedAt" FROM farm_inspections
          WHERE "plantId" = $1 AND "deletedAt" IS NULL ORDER BY "inspectedAt" DESC LIMIT 50`,
          [id],
        ),
        this.dataSource.query<{ count: string }[]>(
          `SELECT COUNT(*) AS "count" FROM farm_plants
          WHERE "motherPlantId" = $1 AND "deletedAt" IS NULL`,
          [id],
        ),
      ]);
    return {
      ...plant,
      history,
      yields: yields.map((y) => ({
        year: Number(y.year),
        quantity: Number(y.quantity),
        harvests: Number(y.harvests),
      })),
      operations: operations.map((o) => ({
        ...o,
        quantity: o.quantity === null ? null : Number(o.quantity),
      })),
      inspections,
      offshootCount: Number(offshoots[0]?.count ?? 0),
    };
  }

  /**
   * تسجيل نخيل صفوف دفعة واحدة: كل صف بعدده، ترقيم يكمل بعد آخر نبتة فيه،
   * ووسم من أكواد الوحدات ورقم الموقع (A-B3-R12-07).
   */
  async bulkPlants(
    plantingId: string,
    dto: BulkPlantsDto,
    tenantId: string,
    userId?: string,
  ): Promise<{ created: number; plantCount: number }> {
    return this.dataSource.transaction(async (manager) => {
      const planting = await this.lockIndividual(manager, plantingId, tenantId);
      const anchor = await this.farms.unitOf(
        manager,
        planting.unitId,
        tenantId,
      );
      const tags = await this.farmTags(manager, planting.farmId);
      const now = new Date();
      let created = 0;
      for (const row of dto.rows) {
        const unit = await this.unitWithin(
          manager,
          anchor,
          row.unitId,
          tenantId,
        );
        const base = await this.tagBase(manager, unit);
        let position =
          row.startPosition ?? (await this.nextPosition(manager, unit.id));
        const batch: FarmPlant[] = [];
        for (let i = 0; i < row.count; i++, position++) {
          const tag = uniqueTag(
            `${base}-${String(position).padStart(2, '0')}`,
            tags,
          );
          batch.push(
            manager.create(FarmPlant, {
              tenantId,
              farmId: planting.farmId,
              plantingId,
              unitId: unit.id,
              tag,
              position,
              sex: dto.sex ?? PlantSex.UNKNOWN,
              plantedAt: dto.plantedAt ?? planting.plantedAt ?? null,
              plantedAtPrecision:
                dto.plantedAtPrecision ??
                planting.plantedAtPrecision ??
                DatePrecision.DAY,
              source: dto.source ?? PlantSource.EXISTING,
              status: PlantStatus.HEALTHY,
              statusChangedAt: now,
            }),
          );
        }
        for (const chunk of chunks(batch, 500)) {
          const saved = await manager.save(chunk);
          await manager.save(
            saved.map((plant) =>
              manager.create(FarmPlantStatusLog, {
                tenantId,
                plantId: plant.id,
                fromStatus: null,
                toStatus: PlantStatus.HEALTHY,
                reason: 'تسجيل',
                sourceType: 'manual',
                occurredAt: now,
                userId: userId ?? null,
              }),
            ),
          );
        }
        created += batch.length;
      }
      const plantCount = await this.recount(manager, plantingId);
      return { created, plantCount };
    });
  }

  /** نبتة واحدة: فسيلة غُرست، أو بديل لنخلة ماتت في نفس موقعها */
  async createPlant(
    plantingId: string,
    dto: CreatePlantDto,
    tenantId: string,
    userId?: string,
  ): Promise<FarmPlant> {
    const id = await this.dataSource.transaction(async (manager) => {
      const planting = await this.lockIndividual(manager, plantingId, tenantId);
      const anchor = await this.farms.unitOf(
        manager,
        planting.unitId,
        tenantId,
      );
      let unit = await this.unitWithin(manager, anchor, dto.unitId, tenantId);
      let position = dto.position ?? null;
      let source = dto.source ?? PlantSource.OTHER;

      if (dto.replacesPlantId) {
        const old = await manager.findOne(FarmPlant, {
          where: { id: dto.replacesPlantId, tenantId, farmId: planting.farmId },
        });
        if (!old) throw new NotFoundException('النبتة التي تُستبدل غير موجودة');
        if (!GONE_PLANT_STATUSES.includes(old.status)) {
          throw new BadRequestException(
            'سجّل موت النبتة القديمة أو قلعها قبل استبدالها',
          );
        }
        unit = await this.unitWithin(manager, anchor, old.unitId, tenantId);
        position = old.position ?? position;
      }
      if (dto.motherPlantId) {
        const mother = await manager.findOne(FarmPlant, {
          where: { id: dto.motherPlantId, tenantId, farmId: planting.farmId },
        });
        if (!mother)
          throw new NotFoundException('النخلة الأم غير موجودة في المزرعة');
        source = dto.source ?? PlantSource.OFFSHOOT;
      }
      position = position ?? (await this.nextPosition(manager, unit.id));
      const tags = await this.farmTags(manager, planting.farmId);
      const tag = dto.tag?.trim()
        ? assertFreeTag(dto.tag.trim(), tags)
        : uniqueTag(
            `${await this.tagBase(manager, unit)}-${String(position).padStart(2, '0')}`,
            tags,
          );
      const zone = await tenantTimezoneOf(manager, tenantId);
      const now = new Date();
      const plant = await manager.save(
        manager.create(FarmPlant, {
          tenantId,
          farmId: planting.farmId,
          plantingId,
          unitId: unit.id,
          tag,
          position,
          sex: dto.sex ?? PlantSex.UNKNOWN,
          plantedAt: dto.plantedAt ?? dayKeyInZone(now, zone),
          plantedAtPrecision: dto.plantedAtPrecision ?? DatePrecision.DAY,
          source,
          motherPlantId: dto.motherPlantId ?? null,
          replacesPlantId: dto.replacesPlantId ?? null,
          status: PlantStatus.HEALTHY,
          statusChangedAt: now,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          notes: dto.notes ?? null,
        }),
      );
      await manager.save(
        manager.create(FarmPlantStatusLog, {
          tenantId,
          plantId: plant.id,
          fromStatus: null,
          toStatus: PlantStatus.HEALTHY,
          reason: dto.replacesPlantId ? 'بديل لنبتة سابقة' : 'غرس',
          sourceType: 'manual',
          occurredAt: now,
          userId: userId ?? null,
        }),
      );
      await this.recount(manager, plantingId);
      return plant.id;
    });
    return this.plantDetail(id, tenantId);
  }

  async updatePlant(id: string, dto: UpdatePlantDto, tenantId: string) {
    await this.dataSource.transaction(async (manager) => {
      const plant = await this.plantOf(manager, id, tenantId);
      const changes: Partial<FarmPlant> = {};
      if (dto.tag !== undefined && dto.tag.trim() !== plant.tag) {
        changes.tag = assertFreeTag(
          dto.tag.trim(),
          await this.farmTags(manager, plant.farmId),
        );
      }
      for (const key of [
        'position',
        'sex',
        'plantedAt',
        'plantedAtPrecision',
        'latitude',
        'longitude',
        'notes',
      ] as const) {
        if (dto[key] !== undefined) {
          (changes as Record<string, unknown>)[key] = dto[key];
        }
      }
      if (Object.keys(changes).length)
        await manager.update(FarmPlant, { id }, changes);
    });
    return this.plantDetail(id, tenantId);
  }

  /** حالة نبتة يدوياً (أُصيبت، تعافت، ماتت، قُلعت) */
  async setPlantStatus(
    id: string,
    dto: PlantStatusDto,
    tenantId: string,
    userId?: string,
    source: Pick<PlantStatusChange, 'sourceType' | 'sourceId'> = {
      sourceType: 'manual',
    },
  ) {
    await this.dataSource.transaction(async (manager) => {
      const plant = await this.plantOf(manager, id, tenantId, true);
      await this.applyStatus(manager, plant, dto.status, {
        reason: dto.reason,
        removalReason: dto.removalReason,
        occurredAt: deviceTime(dto.occurredAt),
        userId,
        ...source,
      });
      await this.recount(manager, plant.plantingId);
    });
    return this.plantDetail(id, tenantId);
  }

  /**
   * يغيّر حالة نبتة ويسجّل التغيير في تاريخها. الميتة والمقلوعة بسبب من
   * القائمة ويوم الإزالة. نفس الحالة = لا شيء (لا تُسجَّل مرتين).
   */
  async applyStatus(
    manager: EntityManager,
    plant: FarmPlant,
    status: PlantStatus,
    change: PlantStatusChange,
  ): Promise<boolean> {
    if (plant.status === status) return false;
    const gone = GONE_PLANT_STATUSES.includes(status);
    if (gone && !change.removalReason) {
      throw new BadRequestException('اختر سبب الموت أو القلع');
    }
    const at = change.occurredAt ?? new Date();
    const zone = await tenantTimezoneOf(manager, plant.tenantId);
    await manager.update(
      FarmPlant,
      { id: plant.id },
      {
        status,
        statusChangedAt: at,
        removedAt: gone ? dayKeyInZone(at, zone) : null,
        removalReason: gone ? change.removalReason : null,
      },
    );
    await manager.save(
      manager.create(FarmPlantStatusLog, {
        tenantId: plant.tenantId,
        plantId: plant.id,
        fromStatus: plant.status,
        toStatus: status,
        reason:
          change.reason?.trim() || (gone ? change.removalReason : null) || null,
        sourceType: change.sourceType,
        sourceId: change.sourceId ?? null,
        occurredAt: at,
        userId: change.userId ?? null,
      }),
    );
    plant.status = status;
    return true;
  }

  async plantOf(
    manager: EntityManager,
    id: string,
    tenantId: string,
    lock = false,
  ): Promise<FarmPlant> {
    const plant = await manager.findOne(FarmPlant, {
      where: { id, tenantId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!plant) throw new NotFoundException('النبتة غير موجودة');
    await this.farms.farmOf(manager, plant.farmId, tenantId);
    return plant;
  }

  /** عدد النخيل القائمة على الزراعة (من السجل) */
  async recount(manager: EntityManager, plantingId: string): Promise<number> {
    const [row] = await manager.query<{ count: string }[]>(
      `UPDATE plantings SET "plantCount" = (
          SELECT COUNT(*) FROM farm_plants
           WHERE "plantingId" = $1 AND "deletedAt" IS NULL AND status NOT IN ${GONE_SQL})
        WHERE id = $1 AND "trackingMode" = '${PlantingTrackingMode.INDIVIDUAL}'
        RETURNING "plantCount" AS "count"`,
      [plantingId],
    );
    return Number(
      Array.isArray(row)
        ? ((row[0] as { count?: string })?.count ?? 0)
        : (row?.count ?? 0),
    );
  }

  // ─── مساعدات ───

  private async lock(
    manager: EntityManager,
    id: string,
    tenantId: string,
  ): Promise<Planting> {
    const planting = await manager.findOne(Planting, {
      where: { id, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!planting) throw new NotFoundException('الزراعة غير موجودة');
    await this.farms.farmOf(manager, planting.farmId, tenantId);
    return planting;
  }

  private async lockIndividual(
    manager: EntityManager,
    id: string,
    tenantId: string,
  ) {
    const planting = await this.lock(manager, id, tenantId);
    if (planting.trackingMode !== PlantingTrackingMode.INDIVIDUAL) {
      throw new BadRequestException(
        'الزراعة تُتابع بالعدد أو المساحة لا نخلة نخلة',
      );
    }
    if (
      ![PlantingStatus.ACTIVE, PlantingStatus.PLANNED].includes(planting.status)
    ) {
      throw new BadRequestException('الزراعة منتهية');
    }
    return planting;
  }

  /** وحدة داخل وحدة الزراعة (هي أو تحتها) */
  private async unitWithin(
    manager: EntityManager,
    anchor: FarmUnit,
    unitId: string,
    tenantId: string,
  ): Promise<FarmUnit> {
    const unit =
      unitId === anchor.id
        ? anchor
        : await this.farms.unitOf(manager, unitId, tenantId);
    if (unit.id !== anchor.id && !unit.path.startsWith(`${anchor.path}/`)) {
      throw new BadRequestException(
        `"${unit.name}" ليست داخل وحدة الزراعة "${anchor.name}"`,
      );
    }
    return unit;
  }

  /** بداية الوسم: أكواد الوحدات من الأعلى (أو ترتيبها إن لم يكن لها كود) */
  private async tagBase(
    manager: EntityManager,
    unit: FarmUnit,
  ): Promise<string> {
    const ids = unit.path.split('/');
    const lineage = await manager.find(FarmUnit, {
      where: { id: In(ids) },
      withDeleted: true,
      select: ['id', 'code', 'sortOrder'],
    });
    const byId = new Map(lineage.map((u) => [u.id, u]));
    return ids
      .map((id) => {
        const u = byId.get(id);
        return u?.code?.trim() || String((u?.sortOrder ?? 0) + 1);
      })
      .join('-');
  }

  private async nextPosition(
    manager: EntityManager,
    unitId: string,
  ): Promise<number> {
    const [row] = await manager.query<{ next: number }[]>(
      `SELECT COALESCE(MAX(position), 0) + 1 AS "next" FROM farm_plants
        WHERE "unitId" = $1 AND "deletedAt" IS NULL AND status NOT IN ${GONE_SQL}`,
      [unitId],
    );
    return Number(row?.next ?? 1);
  }

  private async farmTags(
    manager: EntityManager,
    farmId: string,
  ): Promise<Set<string>> {
    const rows = await manager.query<{ tag: string }[]>(
      `SELECT tag FROM farm_plants WHERE "farmId" = $1 AND "deletedAt" IS NULL`,
      [farmId],
    );
    return new Set(rows.map((r) => r.tag));
  }
}

/** وسم غير مستعمل: يُضاف حرف (07B، 07C) إن سبقته نبتة بنفس الموقع */
function uniqueTag(wanted: string, taken: Set<string>): string {
  let tag = wanted;
  for (let i = 0; taken.has(tag); i++) {
    tag = `${wanted}${String.fromCharCode(66 + (i % 25))}${i >= 25 ? Math.floor(i / 25) : ''}`;
  }
  taken.add(tag);
  return tag;
}

function assertFreeTag(tag: string, taken: Set<string>): string {
  if (taken.has(tag))
    throw new ConflictException(`الوسم ${tag} مستعمل في المزرعة`);
  taken.add(tag);
  return tag;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}
