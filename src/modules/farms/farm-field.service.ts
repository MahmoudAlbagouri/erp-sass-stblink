// src/modules/farms/farm-field.service.ts
//
// الشاشة الميدانية بلا إنترنت: تنزّل المزرعة كاملة (الوحدات، الزراعات، سجل
// النخيل، المدخلات، العمال، المخطط) ثم ترفع ما سُجّل في الأرض بطابور. كل
// عملية بمعرّف من الجهاز: إعادة رفعها = duplicate، ورفض واحدة لا يوقف الباقي.
import { BadRequestException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { DataSource, In, Not } from 'typeorm';
import {
  dayKeyInZone,
  tenantTimezoneOf,
} from '../../common/utils/timezone.util';
import { scopedBranchIds, scopedWarehouseIds } from '../branches/branch-scope';
import { Product, ProductType } from '../catalog/entities/product.entity';
import { Warehouse } from '../inventory/entities/warehouse.entity';
import { PlantStatusDto } from './dto/crops.dto';
import {
  CompleteOperationDto,
  CreateHarvestDto,
  CreateInspectionDto,
  CreateOperationDto,
  FieldBootstrapQueryDto,
  FieldOpDto,
  FieldSyncDto,
} from './dto/farm-work.dto';
import { FarmUnit, FarmWaterSource } from './entities/farm.entity';
import {
  FarmInspection,
  FarmOperation,
  FarmOperationStatus,
  InspectionStatus,
} from './entities/farm-work.entity';
import {
  FarmPlant,
  FarmPlantStatusLog,
  PlantStatus,
  Planting,
  PlantingStatus,
} from './entities/planting.entity';
import { FarmHarvestsService } from './farm-harvests.service';
import { FarmInspectionsService } from './farm-inspections.service';
import { FarmOperationsService } from './farm-operations.service';
import { addDays, isUniqueViolation } from './farm-utils';
import { FarmsService } from './farms.service';
import { PlantingsService } from './plantings.service';

export interface FieldResult {
  id: string;
  status: 'ok' | 'duplicate' | 'error';
  message?: string;
}

@Injectable()
export class FarmFieldService {
  constructor(
    private readonly farms: FarmsService,
    private readonly plantings: PlantingsService,
    private readonly operations: FarmOperationsService,
    private readonly harvests: FarmHarvestsService,
    private readonly inspections: FarmInspectionsService,
    private readonly dataSource: DataSource,
  ) {}

  /** كل ما تحتاجه الشاشة لتعمل بلا إنترنت */
  async bootstrap(query: FieldBootstrapQueryDto, tenantId: string) {
    const manager = this.dataSource.manager;
    const zone = await tenantTimezoneOf(manager, tenantId);
    const today = dayKeyInZone(new Date(), zone);
    const visible = (await this.farms.findAll(tenantId)).filter(
      (f) => f.isActive,
    );
    if (query.farmId && !visible.some((f) => f.id === query.farmId)) {
      await this.farms.findOne(query.farmId, tenantId); // 404 بالرسالة المعتادة
    }
    const farmIds = query.farmId ? [query.farmId] : visible.map((f) => f.id);
    const none = !farmIds.length;

    const [
      units,
      plantings,
      plants,
      products,
      warehouses,
      employees,
      sources,
      inspections,
      planned,
    ] = await Promise.all([
      none
        ? []
        : manager.find(FarmUnit, {
            where: { tenantId, farmId: In(farmIds), isActive: true },
            select: [
              'id',
              'farmId',
              'parentId',
              'kind',
              'name',
              'code',
              'depth',
              'path',
              'sortOrder',
              'areaM2',
              'waterSourceId',
            ],
            order: { depth: 'ASC', sortOrder: 'ASC' },
          }),
      none
        ? []
        : manager.find(Planting, {
            where: {
              tenantId,
              farmId: In(farmIds),
              status: In([PlantingStatus.ACTIVE, PlantingStatus.PLANNED]),
            },
            relations: ['crop', 'variety'],
          }),
      query.farmId
        ? manager.find(FarmPlant, {
            where: {
              tenantId,
              farmId: query.farmId,
              status: Not(PlantStatus.REMOVED),
            },
            select: [
              'id',
              'plantingId',
              'unitId',
              'tag',
              'position',
              'sex',
              'status',
            ],
            order: { tag: 'ASC' },
          })
        : [],
      manager.find(Product, {
        where: { tenantId, type: ProductType.STOCKED, isActive: true },
        relations: ['baseUnit'],
        order: { name: 'ASC' },
      }),
      manager.find(Warehouse, {
        where: {
          tenantId,
          isActive: true,
          ...(scopedWarehouseIds() ? { id: In(scopedWarehouseIds()!) } : {}),
        },
        order: { name: 'ASC' },
      }),
      manager.query<{ id: string; fullName: string }[]>(
        `SELECT id, "fullName" FROM employees
            WHERE tenant_id = $1 AND "deletedAt" IS NULL AND status = 'active'
              AND ($2::uuid[] IS NULL OR branch_id = ANY($2::uuid[]))
            ORDER BY "fullName"`,
        [tenantId, scopedBranchIds()],
      ),
      none
        ? []
        : manager.find(FarmWaterSource, {
            where: { tenantId, farmId: In(farmIds), isActive: true },
          }),
      none
        ? []
        : manager.find(FarmInspection, {
            where: {
              tenantId,
              farmId: In(farmIds),
              status: Not(InspectionStatus.RESOLVED),
            },
            order: { inspectedAt: 'DESC' },
            take: 500,
          }),
      none
        ? []
        : this.dataSource
            .getRepository(FarmOperation)
            .createQueryBuilder('o')
            .where('o.tenantId = :tenantId AND o.farmId IN (:...farmIds)', {
              tenantId,
              farmIds,
            })
            .andWhere('o.status = :planned', {
              planned: FarmOperationStatus.PLANNED,
            })
            .andWhere('o.plannedDate <= :until', { until: addDays(today, 14) })
            .orderBy('o.plannedDate', 'ASC')
            .take(500)
            .getMany(),
    ]);

    return {
      serverTime: new Date().toISOString(),
      today,
      timezone: zone,
      farmId: query.farmId ?? null,
      farms: visible.map((f) => ({
        id: f.id,
        code: f.code,
        name: f.name,
        warehouseId: f.warehouseId ?? null,
      })),
      units,
      plantings: plantings.map((p) => ({
        id: p.id,
        number: p.number,
        farmId: p.farmId,
        unitId: p.unitId,
        cropId: p.cropId,
        cropName: p.crop?.name ?? '',
        varietyName: p.variety?.name ?? null,
        trackingMode: p.trackingMode,
        plantCount: p.plantCount,
        status: p.status,
        harvestProductId:
          p.variety?.harvestProductId ?? p.crop?.harvestProductId ?? null,
      })),
      plants,
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        unitName: p.baseUnit?.name ?? '',
      })),
      warehouses: warehouses.map((w) => ({ id: w.id, name: w.name })),
      employees,
      waterSources: sources.map((s) => ({
        id: s.id,
        farmId: s.farmId,
        name: s.name,
        kind: s.kind,
      })),
      inspections: inspections.map((i) => ({
        id: i.id,
        number: i.number,
        farmId: i.farmId,
        unitId: i.unitId,
        plantId: i.plantId,
        pest: i.pest,
        pestName: i.pestName,
        severity: i.severity,
        status: i.status,
        inspectedAt: i.inspectedAt,
      })),
      plannedOperations: planned.map((o) => ({
        id: o.id,
        number: o.number,
        farmId: o.farmId,
        unitId: o.unitId,
        plantingId: o.plantingId,
        type: o.type,
        title: o.title,
        plannedDate: o.plannedDate,
      })),
    };
  }

  /** رفع طابور الجهاز بالترتيب: كل عملية وحدها */
  async sync(dto: FieldSyncDto, tenantId: string, userId?: string) {
    const results: FieldResult[] = [];
    for (const op of dto.operations) {
      try {
        results.push({
          id: op.id,
          status: await this.applyOne(op, tenantId, userId),
        });
      } catch (error) {
        results.push(
          isUniqueViolation(error)
            ? { id: op.id, status: 'duplicate' }
            : { id: op.id, status: 'error', message: messageOf(error) },
        );
      }
    }
    return { results, serverTime: new Date().toISOString() };
  }

  private async applyOne(
    op: FieldOpDto,
    tenantId: string,
    userId?: string,
  ): Promise<'ok' | 'duplicate'> {
    const ctx = { userId };
    const payload = { ...op.payload };
    switch (op.type) {
      case 'operation': {
        if (await this.operations.findByClientUuid(tenantId, op.id))
          return 'duplicate';
        const dto = await toDto(CreateOperationDto, {
          ...payload,
          performedAt: payload.performedAt ?? op.occurredAt,
          clientUuid: op.id,
        });
        await this.operations.create(dto, tenantId, ctx);
        return 'ok';
      }
      case 'operation_complete': {
        if (await this.operations.findByClientUuid(tenantId, op.id))
          return 'duplicate';
        const operationId =
          typeof payload.operationId === 'string' ? payload.operationId : '';
        if (!operationId)
          throw new BadRequestException('العملية المخططة غير محددة');
        delete payload.operationId;
        const dto = await toDto(CompleteOperationDto, {
          ...payload,
          performedAt: payload.performedAt ?? op.occurredAt,
          clientUuid: op.id,
        });
        await this.operations.complete(operationId, dto, tenantId, ctx);
        return 'ok';
      }
      case 'harvest': {
        if (await this.harvests.findByClientUuid(tenantId, op.id))
          return 'duplicate';
        const dto = await toDto(CreateHarvestDto, {
          ...payload,
          harvestedAt: payload.harvestedAt ?? op.occurredAt,
          clientUuid: op.id,
        });
        await this.harvests.create(dto, tenantId, ctx);
        return 'ok';
      }
      case 'inspection': {
        if (await this.inspections.findByClientUuid(tenantId, op.id))
          return 'duplicate';
        const dto = await toDto(CreateInspectionDto, {
          ...payload,
          inspectedAt: payload.inspectedAt ?? op.occurredAt,
          clientUuid: op.id,
        });
        await this.inspections.create(dto, tenantId, ctx);
        return 'ok';
      }
      case 'plant_status': {
        const seen = await this.dataSource.manager.findOne(FarmPlantStatusLog, {
          where: { tenantId, sourceType: 'field', sourceId: op.id },
        });
        if (seen) return 'duplicate';
        const plantId =
          typeof payload.plantId === 'string' ? payload.plantId : '';
        if (!plantId) throw new BadRequestException('النخلة غير محددة');
        delete payload.plantId;
        const dto = await toDto(PlantStatusDto, {
          ...payload,
          occurredAt: payload.occurredAt ?? op.occurredAt,
        });
        await this.plantings.setPlantStatus(plantId, dto, tenantId, userId, {
          sourceType: 'field',
          sourceId: op.id,
        });
        return 'ok';
      }
    }
  }
}

/**
 * بيانات الجهاز ← DTO بنفس قواعد المسارات. حقل لا يعرفه السيرفر (جهاز أحدث)
 * يُهمل ولا يرفض العملية؛ الحقل الإلزامي الخاطئ يرفضها برسالته.
 */
async function toDto<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
): Promise<T> {
  const dto = plainToInstance(cls, plain);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: false,
  });
  if (errors.length) throw new BadRequestException(firstMessage(errors));
  return dto;
}

function firstMessage(errors: ValidationError[]): string {
  for (const error of errors) {
    const constraint = error.constraints && Object.values(error.constraints)[0];
    if (constraint) return constraint;
    if (error.children?.length) return firstMessage(error.children);
  }
  return 'بيانات غير صالحة';
}

function messageOf(error: unknown): string {
  const response = (error as { response?: { message?: string | string[] } })
    .response;
  const message = response?.message ?? (error as Error).message;
  return Array.isArray(message) ? message[0] : (message ?? 'خطأ غير معروف');
}
