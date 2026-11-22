// src/modules/farms/farm-plan.service.ts
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { nextDocumentNumber } from '../../common/utils/document-number.util';
import {
  dayKeyInZone,
  tenantTimezoneOf,
} from '../../common/utils/timezone.util';
import { CropCalendarStep } from './entities/crop.entity';
import {
  FarmOperation,
  FarmOperationStatus,
} from './entities/farm-work.entity';
import { Planting, PlantingStatus } from './entities/planting.entity';
import { addDays, dayOfYear } from './farm-utils';

export const OPERATION_PREFIX = 'OPR-';

/**
 * التقويم الزراعي ← عمليات مخططة. للحولي بعد تاريخ الزرع بأيام الخطوة،
 * وللمعمّر في شهر ويوم من السنة المطلوبة، مع التكرار. التوليد مرة لكل
 * (زراعة، خطوة، يوم): إعادته لا تكرر شيئاً.
 */
@Injectable()
export class FarmPlanService {
  constructor(private readonly dataSource: DataSource) {}

  async forPlanting(
    manager: EntityManager,
    planting: Planting,
    tenantId: string,
    year?: number,
  ): Promise<number> {
    const steps = await manager.find(CropCalendarStep, {
      where: { tenantId, cropId: planting.cropId },
      order: { sortOrder: 'ASC' },
    });
    const applicable = steps.filter(
      (s) => !s.varietyId || s.varietyId === planting.varietyId,
    );
    if (!applicable.length) return 0;
    const planYear =
      year ??
      Number(
        dayKeyInZone(
          new Date(),
          await tenantTimezoneOf(manager, tenantId),
        ).slice(0, 4),
      );

    const wanted: { step: CropCalendarStep; date: string }[] = [];
    for (const step of applicable) {
      let first: string | null = null;
      if (step.anchor === 'planting' && planting.plantedAt) {
        first = addDays(planting.plantedAt, step.dayOffset ?? 0);
      } else if (step.anchor === 'yearly' && step.month && step.day) {
        first = dayOfYear(planYear, step.month, step.day);
      }
      if (!first) continue;
      const times = step.repeatEveryDays
        ? Math.max(1, step.repeatCount ?? 1)
        : 1;
      for (let i = 0; i < times; i++) {
        wanted.push({
          step,
          date: addDays(first, i * (step.repeatEveryDays ?? 0)),
        });
      }
    }
    if (!wanted.length) return 0;

    const existing = await manager.find(FarmOperation, {
      where: {
        tenantId,
        plantingId: planting.id,
        calendarStepId: In([...new Set(wanted.map((w) => w.step.id))]),
      },
      select: ['id', 'calendarStepId', 'plannedDate'],
      withDeleted: true,
    });
    const done = new Set(
      existing.map((o) => `${o.calendarStepId}:${o.plannedDate}`),
    );

    let created = 0;
    for (const { step, date } of wanted) {
      if (done.has(`${step.id}:${date}`)) continue;
      const number = await nextDocumentNumber(
        manager,
        'farm_operations',
        OPERATION_PREFIX,
        tenantId,
      );
      await manager.save(
        manager.create(FarmOperation, {
          tenantId,
          number,
          farmId: planting.farmId,
          unitId: planting.unitId,
          plantingId: planting.id,
          type: step.operationType,
          title: step.title,
          status: FarmOperationStatus.PLANNED,
          plannedDate: date,
          calendarStepId: step.id,
          notes: step.notes ?? null,
        }),
      );
      done.add(`${step.id}:${date}`);
      created++;
    }
    return created;
  }

  /** خطة السنة لكل زراعات المزرعة القائمة */
  async forFarm(
    farmId: string,
    tenantId: string,
    year?: number,
  ): Promise<{ created: number; plantings: number }> {
    return this.dataSource.transaction(async (manager) => {
      const plantings = await manager.find(Planting, {
        where: {
          tenantId,
          farmId,
          status: In([PlantingStatus.ACTIVE, PlantingStatus.PLANNED]),
        },
      });
      let created = 0;
      for (const planting of plantings) {
        created += await this.forPlanting(manager, planting, tenantId, year);
      }
      return { created, plantings: plantings.length };
    });
  }
}
