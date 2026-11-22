// src/modules/farms/farm-operations.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
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
import { StockMovementType } from '../inventory/entities/stock-movement.entity';
import { StockService } from '../inventory/stock.service';
import { WarehousesService } from '../inventory/warehouses.service';
import {
  CancelOperationDto,
  CompleteOperationDto,
  CreateOperationDto,
  OperationActualsDto,
  OperationQueryDto,
} from './dto/farm-work.dto';
import { Farm, FarmUnit, FarmWaterSource } from './entities/farm.entity';
import {
  FarmInspection,
  FarmOperation,
  FarmOperationInput,
  FarmOperationPlant,
  FarmOperationStatus,
  FarmOperationWorker,
  FarmTransaction,
  FarmTransactionKind,
  InspectionStatus,
} from './entities/farm-work.entity';
import {
  FarmPlant,
  Planting,
  PlantingStatus,
} from './entities/planting.entity';
import { OPERATION_PREFIX } from './farm-plan.service';
import { addDays, deviceTime } from './farm-utils';
import { FarmsService } from './farms.service';

/** مرجع حركات المخزون وتتبع الدفعات */
export const FARM_OPERATION_REFERENCE = 'farm_operation';

const money = (value: Decimal.Value) =>
  new Decimal(value).toDecimalPlaces(3).toNumber();

export interface RecordContext {
  userId?: string | null;
}

@Injectable()
export class FarmOperationsService {
  constructor(
    @InjectRepository(FarmOperation)
    private readonly operations: Repository<FarmOperation>,
    private readonly farms: FarmsService,
    private readonly stock: StockService,
    private readonly warehouses: WarehousesService,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(
    tenantId: string,
    query: OperationQueryDto,
  ): Promise<Paginated<FarmOperation>> {
    const { page, limit, skip } = resolvePagination(query);
    const qb = this.operations
      .createQueryBuilder('o')
      .innerJoinAndSelect('o.farm', 'farm')
      .leftJoinAndSelect('o.unit', 'unit')
      .leftJoinAndSelect('o.planting', 'planting')
      .leftJoinAndSelect('planting.crop', 'crop')
      .leftJoinAndSelect('planting.variety', 'variety')
      .where('o.tenantId = :tenantId', { tenantId });
    restrictToScopedBranches(qb, 'farm.branchId');
    if (query.farmId)
      qb.andWhere('o.farmId = :farmId', { farmId: query.farmId });
    if (query.type) qb.andWhere('o.type = :type', { type: query.type });
    if (query.status)
      qb.andWhere('o.status = :status', { status: query.status });
    if (query.plantingId) {
      qb.andWhere('o.plantingId = :plantingId', {
        plantingId: query.plantingId,
      });
    }
    if (query.unitId) {
      const unit = await this.farms.unitOf(
        this.dataSource.manager,
        query.unitId,
        tenantId,
      );
      // على الوحدة أو ما تحتها، أو على أحد آبائها أو المزرعة كلها (تشملها)
      qb.andWhere(
        `o.farmId = :unitFarm AND (o.unitId IS NULL OR unit.id IN (:...lineage)
           OR unit.path LIKE :under)`,
        {
          unitFarm: unit.farmId,
          lineage: unit.path.split('/'),
          under: `${unit.path}/%`,
        },
      );
    }
    if (query.plantId) {
      const plant = await this.dataSource.manager.findOne(FarmPlant, {
        where: { id: query.plantId, tenantId },
        relations: ['unit'],
      });
      if (!plant) throw new NotFoundException('النبتة غير موجودة');
      qb.andWhere(
        `(EXISTS (SELECT 1 FROM farm_operation_plants t
                   WHERE t."operationId" = o.id AND t."plantId" = :plantId)
          OR (NOT EXISTS (SELECT 1 FROM farm_operation_plants t WHERE t."operationId" = o.id)
              AND o.farmId = :plantFarm
              AND (o.plantingId = :plantPlanting
                   OR (o.plantingId IS NULL AND (o.unitId IS NULL OR o.unitId IN (:...plantLineage))))))`,
        {
          plantId: plant.id,
          plantFarm: plant.farmId,
          plantPlanting: plant.plantingId,
          plantLineage: plant.unit?.path.split('/') ?? [plant.unitId],
        },
      );
    }
    if (query.due) {
      const today = dayKeyInZone(
        new Date(),
        await tenantTimezoneOf(this.dataSource.manager, tenantId),
      );
      qb.andWhere('o.status = :planned', {
        planned: FarmOperationStatus.PLANNED,
      });
      if (query.due === 'overdue') {
        qb.andWhere('o.plannedDate < :today', { today });
      } else {
        qb.andWhere('o.plannedDate BETWEEN :today AND :week', {
          today,
          week: addDays(today, 7),
        });
      }
    }
    if (query.from) {
      qb.andWhere(`COALESCE(o.performedAt::date, o.plannedDate) >= :from`, {
        from: query.from,
      });
    }
    if (query.to) {
      qb.andWhere(`COALESCE(o.performedAt::date, o.plannedDate) <= :to`, {
        to: query.to,
      });
    }
    if (query.search) {
      qb.andWhere(
        '(o.number ILIKE :s OR o.title ILIKE :s OR unit.name ILIKE :s OR o.supervisorName ILIKE :s)',
        { s: `%${query.search.trim()}%` },
      );
    }
    // المخطط بموعده الأقرب أولاً، والمنفّذ بالأحدث أولاً
    if (query.status === FarmOperationStatus.PLANNED || query.due) {
      qb.orderBy('o.plannedDate', 'ASC').addOrderBy('o.number', 'ASC');
    } else {
      qb.orderBy('o.performedAt', 'DESC', 'NULLS LAST')
        .addOrderBy('o.plannedDate', 'DESC')
        .addOrderBy('o.number', 'DESC');
    }
    const [data, total] = await qb.skip(skip).take(limit).getManyAndCount();
    return paginated(data, total, page, limit);
  }

  async findOne(id: string, tenantId: string) {
    const operation = await this.operations.findOne({
      where: { id, tenantId },
      relations: [
        'farm',
        'unit',
        'planting',
        'planting.crop',
        'planting.variety',
        'waterSource',
        'inputs',
        'inputs.product',
        'inputs.product.baseUnit',
        'inputs.warehouse',
        'workers',
      ],
    });
    if (!operation) throw new NotFoundException('العملية غير موجودة');
    await this.farms.farmOf(
      this.dataSource.manager,
      operation.farmId,
      tenantId,
    );
    const plants = await this.dataSource.query<
      { id: string; tag: string; quantity: string | null }[]
    >(
      `SELECT p.id, p.tag, t.quantity FROM farm_operation_plants t
         JOIN farm_plants p ON p.id = t."plantId"
        WHERE t."operationId" = $1 ORDER BY p.tag`,
      [id],
    );
    return {
      ...operation,
      plants: plants.map((p) => ({
        ...p,
        quantity: p.quantity === null ? null : Number(p.quantity),
      })),
    };
  }

  /**
   * تسجيل عملية: مخططة لموعد، أو منفّذة بما حدث فعلاً (مدخلاتها تخرج من
   * المخزن بتكلفتها، وعمالها وساعاتهم، والنخيل التي شملتها).
   */
  async create(
    dto: CreateOperationDto,
    tenantId: string,
    ctx: RecordContext = {},
  ) {
    const id = await this.dataSource.transaction(async (manager) => {
      const farm = await this.farms.farmOf(manager, dto.farmId, tenantId);
      const scope = await this.scopeOf(manager, farm, dto, tenantId);
      const status = dto.status ?? FarmOperationStatus.DONE;
      if (status === FarmOperationStatus.PLANNED && !dto.plannedDate) {
        throw new BadRequestException('حدد موعد العملية المخططة');
      }
      const inspection = dto.inspectionId
        ? await manager.findOne(FarmInspection, {
            where: { id: dto.inspectionId, tenantId, farmId: farm.id },
          })
        : null;
      if (dto.inspectionId && !inspection) {
        throw new NotFoundException('فحص الآفة غير موجود في المزرعة');
      }
      const number = await nextDocumentNumber(
        manager,
        'farm_operations',
        OPERATION_PREFIX,
        tenantId,
      );
      const operation = await manager.save(
        manager.create(FarmOperation, {
          tenantId,
          number,
          farmId: farm.id,
          unitId: scope.unit?.id ?? null,
          plantingId: scope.planting?.id ?? null,
          type: dto.type,
          title: dto.title?.trim() || null,
          status,
          plannedDate: dto.plannedDate ?? null,
          inspectionId: inspection?.id ?? null,
          clientUuid: dto.clientUuid ?? null,
          recordedById: ctx.userId ?? null,
          supervisorName: dto.supervisorName?.trim() || null,
          targetPest: dto.targetPest ?? null,
          notes: dto.notes ?? null,
          laborCost: 0,
          inputCost: 0,
        }),
      );
      if (status === FarmOperationStatus.DONE) {
        await this.applyActuals(
          manager,
          operation,
          farm,
          scope,
          dto,
          tenantId,
          ctx,
        );
        if (inspection?.status === InspectionStatus.OPEN) {
          await manager.update(
            FarmInspection,
            { id: inspection.id },
            {
              status: InspectionStatus.TREATING,
              treatmentOperationId: operation.id,
            },
          );
        }
      } else if (dto.plantIds?.length) {
        await this.saveTargets(
          manager,
          operation,
          scope,
          dto.plantIds,
          tenantId,
        );
      }
      return operation.id;
    });
    return this.findOne(id, tenantId);
  }

  /** إتمام عملية مخططة بما نُفّذ فعلاً */
  async complete(
    id: string,
    dto: CompleteOperationDto,
    tenantId: string,
    ctx: RecordContext = {},
  ) {
    await this.dataSource.transaction(async (manager) => {
      const operation = await this.lock(manager, id, tenantId);
      if (operation.status === FarmOperationStatus.DONE) {
        if (dto.clientUuid && operation.clientUuid === dto.clientUuid) return;
        throw new ConflictException('العملية نُفّذت من قبل');
      }
      if (operation.status !== FarmOperationStatus.PLANNED) {
        throw new BadRequestException('العملية ملغاة');
      }
      const farm = await this.farms.farmOf(manager, operation.farmId, tenantId);
      const scope = await this.scopeOf(manager, farm, operation, tenantId);
      if (dto.clientUuid) operation.clientUuid = dto.clientUuid;
      await this.applyActuals(
        manager,
        operation,
        farm,
        scope,
        dto,
        tenantId,
        ctx,
      );
      if (operation.inspectionId) {
        await manager.update(
          FarmInspection,
          { id: operation.inspectionId, status: InspectionStatus.OPEN },
          {
            status: InspectionStatus.TREATING,
            treatmentOperationId: operation.id,
          },
        );
      }
    });
    return this.findOne(id, tenantId);
  }

  /**
   * إلغاء مخطط، أو إبطال منفّذ: مدخلاته تعود للمخزن بتكلفة صرفها وإلى
   * دفعاتها، ويُعكس قيدها. لا يُعدَّل المنفّذ — يُبطل ويُسجَّل من جديد.
   */
  async cancel(
    id: string,
    dto: CancelOperationDto,
    tenantId: string,
    ctx: RecordContext = {},
  ) {
    await this.dataSource.transaction(async (manager) => {
      const operation = await this.lock(manager, id, tenantId);
      if (operation.status === FarmOperationStatus.CANCELLED) {
        throw new BadRequestException('العملية ملغاة من قبل');
      }
      const wasDone = operation.status === FarmOperationStatus.DONE;
      const now = new Date();
      if (wasDone) {
        const inputs = await manager.find(FarmOperationInput, {
          where: { operationId: id },
        });
        if (inputs.length) {
          await this.stock.apply(
            manager,
            tenantId,
            inputs.map((input) => ({
              warehouseId: input.warehouseId,
              productId: input.productId,
              type: StockMovementType.FARM_INPUT,
              quantity: Number(input.quantity),
              unitCost: Number(input.unitCost),
              note: `إبطال ${operation.number}`,
              lotsFrom: {
                referenceType: FARM_OPERATION_REFERENCE,
                referenceId: id,
              },
            })),
            {
              referenceType: FARM_OPERATION_REFERENCE,
              referenceId: id,
              userId: ctx.userId ?? undefined,
              occurredAt: now,
            },
          );
          await this.recordTransactions(
            manager,
            operation,
            inputs,
            FarmTransactionKind.INPUT_REVERSAL,
            now,
          );
        }
      }
      await manager.update(
        FarmOperation,
        { id },
        {
          status: FarmOperationStatus.CANCELLED,
          cancelledAt: now,
          cancelReason: dto.reason.trim(),
          harvestAllowedAt: null,
        },
      );
    });
    return this.findOne(id, tenantId);
  }

  // ══════════════════════════ التنفيذ ══════════════════════════

  /** ما يُسجَّل عند التنفيذ: الوقت، العمال، النخيل، المياه، والمدخلات من المخزن */
  private async applyActuals(
    manager: EntityManager,
    operation: FarmOperation,
    farm: Farm,
    scope: { unit: FarmUnit | null; planting: Planting | null },
    dto: OperationActualsDto,
    tenantId: string,
    ctx: RecordContext,
  ): Promise<void> {
    const zone = await tenantTimezoneOf(manager, tenantId);
    const performedAt = deviceTime(dto.performedAt);
    const endedAt = dto.endedAt ? deviceTime(dto.endedAt) : null;
    if (endedAt && endedAt < performedAt) {
      throw new BadRequestException('نهاية العملية قبل بدايتها');
    }
    if (dto.waterSourceId) {
      const source = await manager.findOne(FarmWaterSource, {
        where: { id: dto.waterSourceId, farmId: farm.id, tenantId },
      });
      if (!source)
        throw new NotFoundException('مصدر المياه غير موجود في المزرعة');
    }

    // العمال وساعاتهم
    const workers = await this.saveWorkers(manager, operation, dto, tenantId);
    const workerHours = workers.reduce(
      (sum, w) =>
        w.hours === null || w.hours === undefined ? sum : sum.plus(w.hours),
      new Decimal(0),
    );
    const laborHours =
      dto.laborHours ??
      (workerHours.gt(0)
        ? workerHours.toNumber()
        : dto.workerCount && endedAt
          ? new Decimal(endedAt.getTime() - performedAt.getTime())
              .div(3_600_000)
              .mul(dto.workerCount)
              .toDecimalPlaces(2)
              .toNumber()
          : null);
    const laborCost =
      laborHours !== null && farm.laborHourCost
        ? money(new Decimal(laborHours).mul(farm.laborHourCost))
        : 0;

    // النخيل المستهدفة وما شملته العملية
    const targets = dto.plantIds?.length
      ? await this.saveTargets(
          manager,
          operation,
          scope,
          dto.plantIds,
          tenantId,
        )
      : await manager.count(FarmOperationPlant, {
          where: { operationId: operation.id },
        });
    const plantsCovered =
      dto.plantsCovered ??
      (targets || (await this.coveredPlants(manager, farm, scope)) || null);
    const areaCoveredM2 =
      dto.areaCoveredM2 ??
      scope.planting?.areaM2 ??
      scope.unit?.areaM2 ??
      farm.areaM2 ??
      null;

    // المدخلات من المخزن
    const inputs = await this.issueInputs(
      manager,
      operation,
      farm,
      dto,
      tenantId,
      ctx,
      performedAt,
    );
    const inputCost = inputs.reduce(
      (sum, i) => sum.plus(i.totalCost),
      new Decimal(0),
    );
    const phi = Math.max(0, ...inputs.map((i) => i.phiDays ?? 0));

    Object.assign(operation, {
      status: FarmOperationStatus.DONE,
      performedAt,
      endedAt,
      durationMinutes:
        dto.durationMinutes ??
        (endedAt
          ? Math.round((endedAt.getTime() - performedAt.getTime()) / 60_000)
          : null),
      quantity: dto.quantity ?? null,
      quantityUnit: dto.quantityUnit?.trim() || null,
      waterM3: dto.waterM3 ?? null,
      waterSourceId: dto.waterSourceId ?? scope.unit?.waterSourceId ?? null,
      plantsCovered,
      areaCoveredM2,
      workerCount: dto.workerCount ?? (workers.length || null),
      laborHours,
      laborCost,
      inputCost: money(inputCost),
      harvestAllowedAt:
        phi > 0 ? addDays(dayKeyInZone(performedAt, zone), phi) : null,
      targetPest: dto.targetPest ?? operation.targetPest ?? null,
      supervisorName:
        dto.supervisorName?.trim() || operation.supervisorName || null,
      notes: dto.notes ?? operation.notes ?? null,
      recordedById: ctx.userId ?? operation.recordedById ?? null,
    });
    await manager.save(operation);
  }

  private async saveWorkers(
    manager: EntityManager,
    operation: FarmOperation,
    dto: OperationActualsDto,
    tenantId: string,
  ): Promise<FarmOperationWorker[]> {
    if (!dto.workers?.length) return [];
    const employeeIds = [
      ...new Set(
        dto.workers.map((w) => w.employeeId).filter((id): id is string => !!id),
      ),
    ];
    const employees = employeeIds.length
      ? await manager.query<{ id: string; fullName: string }[]>(
          `SELECT id, "fullName" FROM employees
            WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND "deletedAt" IS NULL`,
          [tenantId, employeeIds],
        )
      : [];
    const names = new Map(employees.map((e) => [e.id, e.fullName]));
    const rows = dto.workers
      .map((w) => {
        // موظف لم يعد موجوداً: يبقى اسمه كما كُتب (ما حدث لا يُرفض)
        const known =
          w.employeeId && names.has(w.employeeId) ? w.employeeId : null;
        const name = (known ? names.get(known) : null) ?? w.name?.trim();
        if (!name) return null;
        return manager.create(FarmOperationWorker, {
          tenantId,
          operationId: operation.id,
          employeeId: known,
          name,
          hours: w.hours ?? null,
        });
      })
      .filter((w): w is FarmOperationWorker => !!w);
    return rows.length ? manager.save(rows) : [];
  }

  /** نخيل بعينها: في المزرعة، وداخل الزراعة/الوحدة إن حُدّدت */
  private async saveTargets(
    manager: EntityManager,
    operation: FarmOperation,
    scope: { unit: FarmUnit | null; planting: Planting | null },
    plantIds: string[],
    tenantId: string,
  ): Promise<number> {
    const unique = [...new Set(plantIds)];
    const plants = await manager.find(FarmPlant, {
      where: { id: In(unique), tenantId, farmId: operation.farmId },
      relations: ['unit'],
    });
    if (plants.length !== unique.length) {
      throw new NotFoundException('بعض النخيل المختارة غير موجودة في المزرعة');
    }
    for (const plant of plants) {
      if (scope.planting && plant.plantingId !== scope.planting.id) {
        throw new BadRequestException(
          `النخلة ${plant.tag} ليست في هذه الزراعة`,
        );
      }
      if (
        scope.unit &&
        plant.unitId !== scope.unit.id &&
        !plant.unit?.path.startsWith(`${scope.unit.path}/`)
      ) {
        throw new BadRequestException(
          `النخلة ${plant.tag} ليست في "${scope.unit.name}"`,
        );
      }
    }
    await manager.delete(FarmOperationPlant, { operationId: operation.id });
    await manager.save(
      plants.map((plant) =>
        manager.create(FarmOperationPlant, {
          tenantId,
          operationId: operation.id,
          plantId: plant.id,
        }),
      ),
    );
    return plants.length;
  }

  /** كم نبتة قائمة تشملها العملية (الزراعة، أو زراعات الوحدة وما تحتها، أو المزرعة) */
  private async coveredPlants(
    manager: EntityManager,
    farm: Farm,
    scope: { unit: FarmUnit | null; planting: Planting | null },
  ): Promise<number> {
    if (scope.planting) return scope.planting.plantCount;
    const [row] = await manager.query<{ count: string }[]>(
      `SELECT COALESCE(SUM(p."plantCount"), 0) AS "count"
         FROM plantings p JOIN farm_units u ON u.id = p."unitId"
        WHERE p."farmId" = $1 AND p."deletedAt" IS NULL AND p.status = '${PlantingStatus.ACTIVE}'
          AND ($2::uuid IS NULL OR u.id = $2 OR u.path LIKE $3)`,
      [
        farm.id,
        scope.unit?.id ?? null,
        scope.unit ? `${scope.unit.path}/%` : '',
      ],
    );
    return Number(row?.count ?? 0);
  }

  /**
   * المدخلات تخرج من المخزن بمتوسط تكلفتها (الأقرب انتهاءً للمتتبعة بدفعات).
   * ما صُرف فعلاً في الأرض لا يُرفض لنقص رصيد الشاشة — يُسجَّل سالباً وينبّه.
   */
  private async issueInputs(
    manager: EntityManager,
    operation: FarmOperation,
    farm: Farm,
    dto: OperationActualsDto,
    tenantId: string,
    ctx: RecordContext,
    occurredAt: Date,
  ): Promise<FarmOperationInput[]> {
    if (!dto.inputs?.length) return [];
    const productIds = [...new Set(dto.inputs.map((i) => i.productId))];
    const products = await manager.find(Product, {
      where: { id: In(productIds), tenantId },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const lines = dto.inputs.map((input) => {
      const product = byId.get(input.productId);
      if (!product) throw new NotFoundException('مدخل غير موجود في الأصناف');
      if (product.type !== ProductType.STOCKED) {
        throw new BadRequestException(`"${product.name}" ليس صنفاً مخزنياً`);
      }
      const warehouseId = input.warehouseId ?? farm.warehouseId;
      if (!warehouseId) {
        throw new BadRequestException('حدد مخزن المزرعة أو مخزن كل مدخل');
      }
      return { input, product, warehouseId };
    });
    await this.warehouses.findActiveByIds(
      [...new Set(lines.map((l) => l.warehouseId))],
      tenantId,
      manager,
    );
    const results = await this.stock.apply(
      manager,
      tenantId,
      lines.map(({ input, product, warehouseId }) => ({
        warehouseId,
        productId: product.id,
        type: StockMovementType.FARM_INPUT,
        quantity: -input.quantity,
        note: operation.number,
      })),
      {
        referenceType: FARM_OPERATION_REFERENCE,
        referenceId: operation.id,
        userId: ctx.userId ?? undefined,
        occurredAt,
        allowNegative: true,
      },
    );
    const saved = await manager.save(
      lines.map(({ input, product, warehouseId }, index) =>
        manager.create(FarmOperationInput, {
          tenantId,
          operationId: operation.id,
          productId: product.id,
          warehouseId,
          quantity: input.quantity,
          unitCost: results[index].unitCost,
          totalCost: money(
            new Decimal(input.quantity).mul(results[index].unitCost),
          ),
          phiDays: input.phiDays ?? null,
        }),
      ),
    );
    await this.recordTransactions(
      manager,
      operation,
      saved,
      FarmTransactionKind.INPUT,
      occurredAt,
    );
    return saved;
  }

  /** حدث بقيمته لكل مخزن: منه يُرحَّل القيد */
  private async recordTransactions(
    manager: EntityManager,
    operation: FarmOperation,
    inputs: FarmOperationInput[],
    kind: FarmTransactionKind,
    occurredAt: Date,
  ): Promise<void> {
    const byWarehouse = new Map<string, Decimal>();
    for (const input of inputs) {
      byWarehouse.set(
        input.warehouseId,
        (byWarehouse.get(input.warehouseId) ?? new Decimal(0)).plus(
          input.totalCost,
        ),
      );
    }
    for (const [warehouseId, value] of byWarehouse) {
      if (value.isZero()) continue;
      await manager.save(
        manager.create(FarmTransaction, {
          tenantId: operation.tenantId,
          farmId: operation.farmId,
          sourceType: 'operation',
          sourceId: operation.id,
          kind,
          value: money(value),
          warehouseId,
          reference: operation.number,
          occurredAt,
        }),
      );
    }
  }

  /** الوحدة والزراعة: متسقتان وفي المزرعة (الزراعة بلا وحدة = وحدتها) */
  private async scopeOf(
    manager: EntityManager,
    farm: Farm,
    dto: { unitId?: string | null; plantingId?: string | null },
    tenantId: string,
  ): Promise<{ unit: FarmUnit | null; planting: Planting | null }> {
    const planting = dto.plantingId
      ? await manager.findOne(Planting, {
          where: { id: dto.plantingId, tenantId },
        })
      : null;
    if (dto.plantingId && (!planting || planting.farmId !== farm.id)) {
      throw new NotFoundException('الزراعة غير موجودة في المزرعة');
    }
    const unitId = dto.unitId ?? planting?.unitId ?? null;
    const unit = unitId
      ? await this.farms.unitOf(manager, unitId, tenantId)
      : null;
    if (unit && unit.farmId !== farm.id) {
      throw new NotFoundException('الوحدة غير موجودة في المزرعة');
    }
    if (planting && unit && planting.unitId !== unit.id) {
      const plantingUnit = await this.farms.unitOf(
        manager,
        planting.unitId,
        tenantId,
      );
      const related =
        unit.path.startsWith(`${plantingUnit.path}/`) ||
        plantingUnit.path.startsWith(`${unit.path}/`);
      if (!related) {
        throw new BadRequestException('الزراعة ليست في هذه الوحدة');
      }
    }
    return { unit, planting };
  }

  private async lock(manager: EntityManager, id: string, tenantId: string) {
    const operation = await manager.findOne(FarmOperation, {
      where: { id, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!operation) throw new NotFoundException('العملية غير موجودة');
    await this.farms.farmOf(manager, operation.farmId, tenantId);
    return operation;
  }

  /** للشاشة الميدانية: عملية سبق رفعها بنفس معرّف الجهاز */
  findByClientUuid(tenantId: string, clientUuid: string) {
    return this.operations.findOne({
      where: { tenantId, clientUuid },
      withDeleted: true,
    });
  }
}
