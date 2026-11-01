// src/modules/attendance/my-attendance.service.ts
// حضور الموظف لنفسه من تطبيق الجوال: يومه، شهره، وبصمته. البصمة تمر بنفس مدخل
// باقي المصادر (PunchIngestService)، فالتقويم وأثرها في المسير لا يعرفان مصدرها.
//
// بصمة الجوال لا تثبت هوية صاحبها كبصمة الجهاز: ما يحميها الجوال المربوط،
// والموقع داخل نطاق الفرع، ووقت السيرفر لا ساعة الجوال.
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, Not } from 'typeorm';
import { FEATURES } from '../../common/constants/features';
import { type CurrentUserData } from '../../common/decorators/current-user.decorator';
import { tenantTimezoneOf } from '../../common/utils/timezone.util';
import { Branch } from '../branches/entities/branch.entity';
import { Employee } from '../employees/entities/employee.entity';
import { SubscriptionManagerService } from '../subscriptions/subscription-manager.service';
import { shiftDayOf } from './attendance-days';
import { AttendanceService } from './attendance.service';
import type { MobilePunchDto } from './dto/my-attendance.dto';
import {
  AttendanceLog,
  PunchType,
  VerifyMode,
} from './entities/attendance-log.entity';
import { PunchIngestService } from './punch-ingest.service';
import { employeePin } from './utils/attendance-pin';
import { distanceInMeters } from './utils/geo';

/** قراءة موقع أضعف من هذا لا تصلح للحكم على وجوده في الفرع */
const MAX_ACCURACY_METERS = 150;
/** ما يُتسامح به من خطأ القراءة فوق نطاق الفرع */
const ACCURACY_TOLERANCE_METERS = 50;
/** ضغطة مزدوجة أو إعادة إرسال لا تُحسب بصمة ثانية */
const MIN_SECONDS_BETWEEN_PUNCHES = 60;

interface PunchPolicy {
  allowed: boolean;
  blockedReason: string | null;
  branch: Branch | null;
}

@Injectable()
export class MyAttendanceService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly attendance: AttendanceService,
    private readonly ingest: PunchIngestService,
    private readonly subscriptions: SubscriptionManagerService,
  ) {}

  private async employeeOf(user: CurrentUserData): Promise<Employee> {
    if (!user.employeeId) {
      throw new NotFoundException('حسابك غير مرتبط بملف موظف');
    }
    const employee = await this.dataSource.getRepository(Employee).findOne({
      where: { id: user.employeeId, tenantId: user.tenantId },
      relations: ['shift'],
    });
    if (!employee) throw new NotFoundException('الموظف غير موجود');
    return employee;
  }

  async today(user: CurrentUserData) {
    return this.todayOf(await this.employeeOf(user));
  }

  async month(user: CurrentUserData, month: number, year: number) {
    const employee = await this.employeeOf(user);
    return this.attendance.monthlyReportFor(employee, month, year);
  }

  private async todayOf(employee: Employee) {
    const { tenantId } = employee;
    const zone = await tenantTimezoneOf(this.dataSource.manager, tenantId);
    const date = shiftDayOf(new Date(), zone, employee.shift);
    const days = await this.attendance.attendanceDays(
      tenantId,
      [employee],
      date,
      date,
    );
    const day = days.get(employee.id)![0];
    const policy = await this.policyOf(employee);

    return {
      date,
      status: day.status,
      checkIn: day.checkIn?.punchTime ?? null,
      checkOut: day.checkOut?.punchTime ?? null,
      minutes: day.minutes,
      lateMinutes: day.lateMinutes,
      earlyLeaveMinutes: day.earlyLeaveMinutes,
      overtimeMinutes: day.overtimeMinutes,
      holidayName: day.holidayName ?? null,
      leaveReason: day.leaveReason ?? null,
      shift: employee.shift
        ? {
            name: employee.shift.name,
            startTime: employee.shift.startTime,
            endTime: employee.shift.endTime,
          }
        : null,
      punches: day.logs.map((log) => log.punchTime),
      mobilePunch: {
        allowed: policy.allowed,
        blockedReason: policy.blockedReason,
        branchName: policy.branch?.name ?? null,
      },
    };
  }

  /** هل يبصم هذا الموظف من جواله؟ ولماذا لا؟ السبب يُعرض له كما هو. */
  private async policyOf(employee: Employee): Promise<PunchPolicy> {
    const blocked = (blockedReason: string, branch: Branch | null = null) => ({
      allowed: false,
      blockedReason,
      branch,
    });

    const planAllows = await this.subscriptions.hasFeature(
      employee.tenantId,
      FEATURES.MOBILE_ATTENDANCE.name,
    );
    if (!planAllows) return blocked('البصمة من الجوال غير متاحة لشركتك');
    if (employee.status !== 'active') return blocked('حسابك الوظيفي غير نشط');
    if (!employee.mobilePunchEnabled) {
      return blocked('البصمة من الجوال غير مفعّلة لك — راجع إدارة شركتك');
    }

    const branch = await this.branchOf(employee);
    if (branch?.latitude == null || branch.longitude == null) {
      return blocked('لم يُحدَّد موقع فرعك بعد — راجع إدارة شركتك', branch);
    }
    return { allowed: true, blockedReason: null, branch };
  }

  private branchOf(employee: Employee): Promise<Branch | null> {
    const { tenantId, branchId } = employee;
    return this.dataSource.getRepository(Branch).findOne({
      where: branchId ? { id: branchId, tenantId } : { tenantId, isMain: true },
    });
  }

  async punch(user: CurrentUserData, dto: MobilePunchDto) {
    const employee = await this.employeeOf(user);
    const policy = await this.policyOf(employee);
    if (!policy.allowed) throw new ForbiddenException(policy.blockedReason);

    const distanceMeters = this.assertInsideBranch(policy.branch!, dto);
    const now = new Date();

    await this.dataSource.transaction(async (manager) => {
      await this.assertOwnDevice(manager, employee, dto, now);
      await this.assertNotDuplicate(manager, employee, now);

      await this.ingest.save(
        {
          tenantId: employee.tenantId,
          deviceId: null,
          sourceKey: `mobile:${employee.id}`,
        },
        [
          {
            pin: employeePin(employee),
            punchTime: now,
            rawLogId: randomUUID(),
            punchType: await this.punchTypeOf(employee),
            verifyMode: VerifyMode.MOBILE,
            location: {
              latitude: dto.latitude,
              longitude: dto.longitude,
              distanceMeters,
            },
          },
        ],
        manager,
      );
    });

    return this.todayOf(employee);
  }

  /** يعيد بُعده عن الفرع بالمتر، أو يرفض البصمة */
  private assertInsideBranch(branch: Branch, dto: MobilePunchDto): number {
    if (dto.isMocked) {
      throw new ForbiddenException(
        'رُصد موقع غير حقيقي — أوقف تطبيق تغيير الموقع ثم أعد المحاولة',
      );
    }
    const accuracy = dto.accuracy ?? 0;
    if (accuracy > MAX_ACCURACY_METERS) {
      throw new BadRequestException(
        'دقة موقعك ضعيفة — اقترب من مكان مفتوح وأعد المحاولة',
      );
    }

    const distance = Math.round(
      distanceInMeters(
        {
          latitude: Number(branch.latitude),
          longitude: Number(branch.longitude),
        },
        dto,
      ),
    );
    const limit =
      branch.punchRadiusMeters + Math.min(accuracy, ACCURACY_TOLERANCE_METERS);
    if (distance > limit) {
      throw new ForbiddenException(
        `أنت خارج نطاق ${branch.name} — تبعد عنه ${distance} متر`,
      );
    }
    return distance;
  }

  /**
   * يربط أول جوال يبصم منه الموظف، ويرفض غيره بعدها. القفل على سطر الموظف يمنع
   * ربط جوالين ببصمتين متزامنتين.
   */
  private async assertOwnDevice(
    manager: EntityManager,
    employee: Employee,
    dto: MobilePunchDto,
    now: Date,
  ): Promise<void> {
    const locked = await manager.findOneOrFail(Employee, {
      where: { id: employee.id },
      lock: { mode: 'pessimistic_write' },
    });

    if (locked.mobileDeviceId) {
      if (locked.mobileDeviceId !== dto.deviceId) {
        throw new ForbiddenException(
          `حسابك مربوط بجوال آخر (${locked.mobileDeviceName ?? 'غير معروف'}) — اطلب من الإدارة فك الربط`,
        );
      }
      return;
    }

    const taken = await manager.exists(Employee, {
      where: {
        tenantId: employee.tenantId,
        mobileDeviceId: dto.deviceId,
        id: Not(employee.id),
      },
    });
    if (taken) {
      throw new ForbiddenException('هذا الجوال مربوط بموظف آخر');
    }

    await manager.update(Employee, employee.id, {
      mobileDeviceId: dto.deviceId,
      mobileDeviceName: dto.deviceName ?? null,
      mobileDeviceBoundAt: now,
    });
  }

  private async assertNotDuplicate(
    manager: EntityManager,
    employee: Employee,
    now: Date,
  ): Promise<void> {
    const last = await manager.findOne(AttendanceLog, {
      where: { employeeId: employee.id },
      order: { punchTime: 'DESC' },
      select: { id: true, punchTime: true },
    });
    const seconds = last
      ? (now.getTime() - last.punchTime.getTime()) / 1000
      : Infinity;
    if (seconds < MIN_SECONDS_BETWEEN_PUNCHES) {
      throw new BadRequestException('تم تسجيل بصمتك قبل قليل');
    }
  }

  /** للعرض فقط: اليوم يُحسب بأول بصمة وآخرها أياً كان نوعهما */
  private async punchTypeOf(employee: Employee): Promise<PunchType> {
    const today = await this.todayOf(employee);
    return today.checkIn ? PunchType.CHECK_OUT : PunchType.CHECK_IN;
  }

  /** فك ربط الجوال: البصمة التالية تربط الجوال الجديد */
  async unbindDevice(employeeId: string, tenantId: string): Promise<void> {
    const result = await this.dataSource.getRepository(Employee).update(
      { id: employeeId, tenantId },
      {
        mobileDeviceId: null,
        mobileDeviceName: null,
        mobileDeviceBoundAt: null,
      },
    );
    if (!result.affected) throw new NotFoundException('الموظف غير موجود');
  }
}
