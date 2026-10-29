// src/modules/attendance/attendance-settings.service.ts
// سياسة الحضور للشركة (أيام الراحة، ربط الحضور بالمسير، نسخ البصمات) وعطلاتها
// الرسمية، وتحميل "تقويم" فترة: ما يلزم لمعرفة نوع كل يوم لكل موظف.
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { AttendanceSettings } from './entities/attendance-settings.entity';
import { PublicHoliday } from './entities/public-holiday.entity';
import {
  LeaveRequest,
  LeaveStatus,
} from '../leaves/entities/leave-request.entity';
import { UpdateAttendanceSettingsDto } from './dto/attendance-settings.dto';
import {
  CreateHolidayDto,
  HolidayQueryDto,
  UpdateHolidayDto,
} from './dto/holiday.dto';
import { tenantTimezoneOf } from '../../common/utils/timezone.util';
import {
  type AttendanceCalendar,
  type CalendarLeave,
  dayDiff,
  isValidDay,
  toDayKey,
} from './attendance-days';

/** السياسة كما تُقرأ (حتى قبل أن تحفظ الشركة شيئاً) */
export type AttendancePolicy = Omit<AttendanceSettings, 'tenant' | 'updatedAt'>;

/** عطلة الأسبوع في الدول التي تختلف عن الجمعة */
const WEEKEND_BY_COUNTRY: Record<string, number[]> = {
  AE: [6, 0],
};

const MAX_HOLIDAY_DAYS = 60;

@Injectable()
export class AttendanceSettingsService {
  constructor(
    @InjectRepository(AttendanceSettings)
    private readonly settingsRepo: Repository<AttendanceSettings>,
    @InjectRepository(PublicHoliday)
    private readonly holidayRepo: Repository<PublicHoliday>,
    private readonly dataSource: DataSource,
  ) {}

  // ═════════════════════════════ السياسة ═════════════════════════════

  async getPolicy(
    tenantId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<AttendancePolicy> {
    const saved = await manager.findOneBy(AttendanceSettings, { tenantId });
    if (saved) {
      return {
        tenantId,
        weeklyOffDays: saved.weeklyOffDays,
        deductAbsence: saved.deductAbsence,
        deductLateness: saved.deductLateness,
        payOvertime: saved.payOvertime,
        overtimeRatePercent: saved.overtimeRatePercent,
        overtimeMinMinutes: saved.overtimeMinMinutes,
        syncBiometrics: saved.syncBiometrics,
      };
    }
    return this.defaults(tenantId, manager);
  }

  async updatePolicy(
    tenantId: string,
    dto: UpdateAttendanceSettingsDto,
  ): Promise<AttendancePolicy> {
    const current = await this.getPolicy(tenantId);
    await this.settingsRepo.save({ ...current, ...dto, tenantId });
    return this.getPolicy(tenantId);
  }

  private async defaults(
    tenantId: string,
    manager: EntityManager,
  ): Promise<AttendancePolicy> {
    const [tenant] = await manager.query<{ country: string | null }[]>(
      `SELECT "country" FROM tenants WHERE "id" = $1`,
      [tenantId],
    );
    return {
      tenantId,
      weeklyOffDays: WEEKEND_BY_COUNTRY[tenant?.country ?? ''] ?? [5],
      deductAbsence: false,
      deductLateness: false,
      payOvertime: false,
      overtimeRatePercent: 150,
      overtimeMinMinutes: 30,
      syncBiometrics: false,
    };
  }

  // ═════════════════════════════ العطلات الرسمية ═════════════════════════════

  findHolidays(tenantId: string, query: HolidayQueryDto) {
    return this.holidayRepo.find({
      where: {
        tenantId,
        ...(query.year
          ? {
              startDate: LessThanOrEqual(`${query.year}-12-31`),
              endDate: MoreThanOrEqual(`${query.year}-01-01`),
            }
          : {}),
      },
      order: { startDate: 'ASC' },
      take: 500,
    });
  }

  async createHoliday(tenantId: string, dto: CreateHolidayDto) {
    const range = holidayRange(dto.startDate, dto.endDate ?? dto.startDate);
    return this.holidayRepo.save(
      this.holidayRepo.create({ tenantId, name: dto.name.trim(), ...range }),
    );
  }

  async updateHoliday(id: string, tenantId: string, dto: UpdateHolidayDto) {
    const holiday = await this.holidayRepo.findOneBy({ id, tenantId });
    if (!holiday) throw new NotFoundException('العطلة غير موجودة');

    const startDate = dto.startDate ?? holiday.startDate;
    // تغيير البداية وحدها لعطلة يوم واحد يحرّكها كلها
    const endDate =
      dto.endDate ??
      (dto.startDate && holiday.startDate === holiday.endDate
        ? dto.startDate
        : holiday.endDate);
    Object.assign(holiday, holidayRange(startDate, endDate));
    if (dto.name !== undefined) holiday.name = dto.name.trim();
    return this.holidayRepo.save(holiday);
  }

  async removeHoliday(id: string, tenantId: string): Promise<void> {
    const result = await this.holidayRepo.delete({ id, tenantId });
    if (!result.affected) throw new NotFoundException('العطلة غير موجودة');
  }

  // ═════════════════════════════ التقويم ═════════════════════════════

  /**
   * كل ما يحدد نوع الأيام من `fromDay` إلى `toDay` (شاملة): أيام الراحة،
   * العطلات، والإجازات المعتمدة للموظفين المطلوبين (أو كل موظفي الشركة).
   */
  async loadCalendar(
    tenantId: string,
    fromDay: string,
    toDay: string,
    employeeIds?: string[],
    manager: EntityManager = this.dataSource.manager,
  ): Promise<AttendanceCalendar> {
    const [zone, policy, holidays, leaves] = await Promise.all([
      tenantTimezoneOf(manager, tenantId),
      this.getPolicy(tenantId, manager),
      manager.find(PublicHoliday, {
        where: {
          tenantId,
          startDate: LessThanOrEqual(toDay),
          endDate: MoreThanOrEqual(fromDay),
        },
      }),
      employeeIds?.length === 0
        ? []
        : manager.find(LeaveRequest, {
            where: {
              tenantId,
              status: LeaveStatus.APPROVED,
              ...(employeeIds ? { employeeId: In(employeeIds) } : {}),
              startDate: LessThanOrEqual(toDay) as unknown as Date,
              endDate: MoreThanOrEqual(fromDay) as unknown as Date,
            },
          }),
    ]);

    const byEmployee = new Map<string, CalendarLeave[]>();
    for (const leave of leaves) {
      const list = byEmployee.get(leave.employeeId) ?? [];
      list.push({
        startDate: toDayKey(leave.startDate),
        endDate: toDayKey(leave.endDate),
        type: leave.type,
      });
      byEmployee.set(leave.employeeId, list);
    }

    return {
      zone,
      weeklyOffDays: policy.weeklyOffDays,
      overtimeMinMinutes: policy.overtimeMinMinutes,
      holidays: holidays.map((h) => ({
        name: h.name,
        startDate: toDayKey(h.startDate),
        endDate: toDayKey(h.endDate),
      })),
      leaves: byEmployee,
    };
  }
}

function holidayRange(startDate: string, endDate: string) {
  if (!isValidDay(startDate) || !isValidDay(endDate)) {
    throw new BadRequestException('تاريخ العطلة غير صالح');
  }
  if (endDate < startDate) {
    throw new BadRequestException('نهاية العطلة قبل بدايتها');
  }
  if (dayDiff(startDate, endDate) + 1 > MAX_HOLIDAY_DAYS) {
    throw new BadRequestException(
      `العطلة الواحدة لا تتجاوز ${MAX_HOLIDAY_DAYS} يوماً`,
    );
  }
  return { startDate, endDate };
}
