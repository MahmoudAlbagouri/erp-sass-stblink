// src/modules/farms/farm-inspections.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  Paginated,
  paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import { nextDocumentNumber } from '../../common/utils/document-number.util';
import { tenantTimezoneOf } from '../../common/utils/timezone.util';
import { restrictToScopedBranches } from '../branches/branch-scope';
import {
  CreateInspectionDto,
  InspectionQueryDto,
  InspectionStatusDto,
} from './dto/farm-work.dto';
import {
  FarmInspection,
  FarmOperation,
  InspectionStatus,
  PestType,
} from './entities/farm-work.entity';
import {
  FarmPlant,
  GONE_PLANT_STATUSES,
  PlantStatus,
  Planting,
} from './entities/planting.entity';
import { deviceTime } from './farm-utils';
import { FarmsService } from './farms.service';
import { RecordContext } from './farm-operations.service';
import { PlantingsService } from './plantings.service';

const INSPECTION_PREFIX = 'INS-';

/** أمراض (لا حشرات): النخلة مريضة لا مصابة بآفة */
const DISEASES: readonly PestType[] = [
  PestType.BAYOUD,
  PestType.BLACK_SCORCH,
  PestType.INFLORESCENCE_ROT,
  PestType.POWDERY_MILDEW,
  PestType.DOWNY_MILDEW,
  PestType.ROOT_ROT,
  PestType.VIRAL,
];

/** حالة النبتة من نوع ما وُجد فيها */
export function plantStatusFor(pest: PestType): PlantStatus {
  if (DISEASES.includes(pest)) return PlantStatus.DISEASED;
  if (pest === PestType.NUTRIENT_DEFICIENCY) return PlantStatus.WEAK;
  return PlantStatus.INFESTED;
}

@Injectable()
export class FarmInspectionsService {
  constructor(
    @InjectRepository(FarmInspection)
    private readonly inspections: Repository<FarmInspection>,
    private readonly farms: FarmsService,
    private readonly plantings: PlantingsService,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(
    tenantId: string,
    query: InspectionQueryDto,
  ): Promise<Paginated<FarmInspection>> {
    const { page, limit, skip } = resolvePagination(query);
    const qb = this.inspections
      .createQueryBuilder('i')
      .innerJoinAndSelect('i.farm', 'farm')
      .leftJoinAndSelect('i.unit', 'unit')
      .leftJoinAndSelect('i.planting', 'planting')
      .leftJoinAndSelect('planting.crop', 'crop')
      .leftJoinAndSelect('i.plant', 'plant')
      .leftJoin('plant.unit', 'plantUnit')
      .where('i.tenantId = :tenantId', { tenantId });
    restrictToScopedBranches(qb, 'farm.branchId');
    if (query.farmId)
      qb.andWhere('i.farmId = :farmId', { farmId: query.farmId });
    if (query.plantId)
      qb.andWhere('i.plantId = :plantId', { plantId: query.plantId });
    if (query.status)
      qb.andWhere('i.status = :status', { status: query.status });
    if (query.pest) qb.andWhere('i.pest = :pest', { pest: query.pest });
    if (query.unitId) {
      const unit = await this.farms.unitOf(
        this.dataSource.manager,
        query.unitId,
        tenantId,
      );
      qb.andWhere(
        `(unit.id = :unitId OR unit.path LIKE :under
          OR plantUnit.id = :unitId OR plantUnit.path LIKE :under)`,
        { unitId: unit.id, under: `${unit.path}/%` },
      );
    }
    if (query.from || query.to) {
      const zone = await tenantTimezoneOf(this.dataSource.manager, tenantId);
      if (query.from) {
        qb.andWhere(`(i.inspectedAt AT TIME ZONE :zone)::date >= :from`, {
          zone,
          from: query.from,
        });
      }
      if (query.to) {
        qb.andWhere(`(i.inspectedAt AT TIME ZONE :zone)::date <= :to`, {
          zone,
          to: query.to,
        });
      }
    }
    const [data, total] = await qb
      .orderBy('i.inspectedAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();
    return paginated(data, total, page, limit);
  }

  async findOne(id: string, tenantId: string): Promise<FarmInspection> {
    const inspection = await this.inspections.findOne({
      where: { id, tenantId },
      relations: ['farm', 'unit', 'planting', 'planting.crop', 'plant'],
    });
    if (!inspection) throw new NotFoundException('الفحص غير موجود');
    await this.farms.farmOf(
      this.dataSource.manager,
      inspection.farmId,
      tenantId,
    );
    return inspection;
  }

  /**
   * فحص آفة: أين ومتى وكم شدته. النخلة المفحوصة بإصابة (شدة > 0) تُعلَّم في
   * السجل مصابة أو مريضة، ويُسجَّل ذلك في تاريخها.
   */
  async create(
    dto: CreateInspectionDto,
    tenantId: string,
    ctx: RecordContext = {},
  ) {
    const id = await this.dataSource.transaction(async (manager) => {
      const farm = await this.farms.farmOf(manager, dto.farmId, tenantId);
      const plant = dto.plantId
        ? await manager.findOne(FarmPlant, {
            where: { id: dto.plantId, tenantId },
            lock: { mode: 'pessimistic_write' },
          })
        : null;
      if (dto.plantId && (!plant || plant.farmId !== farm.id)) {
        throw new NotFoundException('النخلة غير موجودة في المزرعة');
      }
      const plantingId = plant?.plantingId ?? dto.plantingId ?? null;
      if (plantingId) {
        const planting = await manager.findOne(Planting, {
          where: { id: plantingId, tenantId },
        });
        if (!planting || planting.farmId !== farm.id) {
          throw new NotFoundException('الزراعة غير موجودة في المزرعة');
        }
      }
      const unitId = plant?.unitId ?? dto.unitId ?? null;
      if (unitId) {
        const unit = await this.farms.unitOf(manager, unitId, tenantId);
        if (unit.farmId !== farm.id) {
          throw new NotFoundException('الوحدة غير موجودة في المزرعة');
        }
      }
      if (
        dto.affectedCount !== undefined &&
        dto.affectedCount !== null &&
        dto.sampledCount &&
        dto.affectedCount > dto.sampledCount
      ) {
        throw new BadRequestException('المصاب أكثر من المفحوص');
      }
      const inspectedAt = deviceTime(dto.inspectedAt);
      const number = await nextDocumentNumber(
        manager,
        'farm_inspections',
        INSPECTION_PREFIX,
        tenantId,
      );
      const inspection = await manager.save(
        manager.create(FarmInspection, {
          tenantId,
          number,
          farmId: farm.id,
          unitId,
          plantingId,
          plantId: plant?.id ?? null,
          inspectedAt,
          pest: dto.pest,
          pestName: dto.pestName?.trim() || null,
          severity: dto.severity,
          affectedCount:
            dto.affectedCount ?? (plant ? (dto.severity > 0 ? 1 : 0) : null),
          sampledCount: dto.sampledCount ?? (plant ? 1 : null),
          status:
            dto.severity > 0
              ? InspectionStatus.OPEN
              : InspectionStatus.RESOLVED,
          resolvedAt: dto.severity > 0 ? null : inspectedAt,
          clientUuid: dto.clientUuid ?? null,
          recordedById: ctx.userId ?? null,
          inspectorName: dto.inspectorName?.trim() || null,
          notes: dto.notes ?? null,
        }),
      );
      if (
        plant &&
        dto.severity > 0 &&
        dto.markPlant !== false &&
        !GONE_PLANT_STATUSES.includes(plant.status)
      ) {
        await this.plantings.applyStatus(
          manager,
          plant,
          plantStatusFor(dto.pest),
          {
            reason: dto.pestName?.trim() || dto.pest,
            sourceType: 'inspection',
            sourceId: inspection.id,
            occurredAt: inspectedAt,
            userId: ctx.userId,
          },
        );
      }
      return inspection.id;
    });
    return this.findOne(id, tenantId);
  }

  /**
   * متابعة الفحص: قيد العلاج (ومعه عملية العلاج) ← انتهى. انتهاء فحص نخلة
   * يعيدها سليمة إن كان الفحص هو ما علّمها.
   */
  async setStatus(
    id: string,
    dto: InspectionStatusDto,
    tenantId: string,
    ctx: RecordContext = {},
  ) {
    await this.dataSource.transaction(async (manager) => {
      const inspection = await manager.findOne(FarmInspection, {
        where: { id, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!inspection) throw new NotFoundException('الفحص غير موجود');
      await this.farms.farmOf(manager, inspection.farmId, tenantId);
      if (dto.treatmentOperationId) {
        const operation = await manager.findOne(FarmOperation, {
          where: {
            id: dto.treatmentOperationId,
            tenantId,
            farmId: inspection.farmId,
          },
        });
        if (!operation)
          throw new NotFoundException('عملية العلاج غير موجودة في المزرعة');
      }
      const resolved = dto.status === InspectionStatus.RESOLVED;
      await manager.update(
        FarmInspection,
        { id },
        {
          status: dto.status,
          resolvedAt: resolved ? new Date() : null,
          treatmentOperationId:
            dto.treatmentOperationId ?? inspection.treatmentOperationId ?? null,
          notes: dto.notes ?? inspection.notes ?? null,
        },
      );
      if (resolved && inspection.plantId) {
        await this.healPlant(manager, inspection, ctx);
      }
    });
    return this.findOne(id, tenantId);
  }

  findByClientUuid(tenantId: string, clientUuid: string) {
    return this.inspections.findOne({
      where: { tenantId, clientUuid },
      withDeleted: true,
    });
  }

  /** النخلة تعود سليمة إن لم يبقَ عليها فحص مفتوح آخر */
  private async healPlant(
    manager: EntityManager,
    inspection: FarmInspection,
    ctx: RecordContext,
  ): Promise<void> {
    const plant = await manager.findOne(FarmPlant, {
      where: { id: inspection.plantId! },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !plant ||
      ![PlantStatus.INFESTED, PlantStatus.DISEASED, PlantStatus.WEAK].includes(
        plant.status,
      )
    ) {
      return;
    }
    const [other] = await manager.query<{ open: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM farm_inspections
          WHERE "plantId" = $1 AND id <> $2 AND "deletedAt" IS NULL
            AND status <> '${InspectionStatus.RESOLVED}' AND severity > 0) AS "open"`,
      [plant.id, inspection.id],
    );
    if (other?.open) return;
    await this.plantings.applyStatus(manager, plant, PlantStatus.HEALTHY, {
      reason: 'انتهى العلاج',
      sourceType: 'inspection',
      sourceId: inspection.id,
      userId: ctx.userId,
    });
  }
}
