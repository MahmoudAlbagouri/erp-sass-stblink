import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  Between,
  In,
  FindOptionsWhere,
  DataSource,
  EntityManager,
  LessThanOrEqual,
  MoreThanOrEqual,
} from 'typeorm';
import {
  assertBranchVisible,
  restrictToScopedBranches,
  scopedBranchIds,
  scopedEmployeeWhere,
} from '../branches/branch-scope';
import { resolveBranchId } from '../branches/branches.util';
import {
  BiometricDevice,
  DeviceStatus,
} from './entities/biometric-device.entity';
import {
  AttendanceLog,
  PUNCH_TYPE_LABELS_AR,
  PunchType,
  VerifyMode,
} from './entities/attendance-log.entity';
import { DeviceCommand } from './entities/device-command.entity';
import { Shift } from '../shifts/entities/shift.entity';
import { getShiftWindow } from '../shifts/utils/shift-time.util';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { AttendanceQueryDto } from './dto/attendance-query.dto';
import { UpdateAttendanceLogDto } from './dto/update-attendance-log.dto';
import { CreateManualAttendanceLogDto } from './dto/create-manual-attendance-log.dto';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Employee } from '../employees/entities/employee.entity';
import { User } from '../users/entities/user.entity';
import { DomainEvents } from '../../common/events/domain-events';
import {
  ReportService,
  type ReportColumn,
  type ReportRow,
} from '../../common/reports/report.service';
import { formatDateTime } from '../../common/utils/format.util';
import {
  dayKeyInZone,
  dayOffsetInZone,
  startOfDayInZone,
  tenantTimezoneOf,
} from '../../common/utils/timezone.util';

const EDIT_WINDOW_HOURS = 24;
const MANUAL_ENTRY_WINDOW_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MINUTES = 24 * 60;

/**
 * الجهاز يسأل السيرفر كل ~10 ثوانٍ: غيابه أطول من هذا يعني أنه غير متصل.
 * الحالة تُحسب عند القراءة — لا أحد يُبلغنا حين ينقطع الجهاز.
 */
const ONLINE_WINDOW_MS = 2 * 60 * 1000;

/**
 * "يوم الوردية" يبدأ قبل موعد بدايتها بهذه المدة ويستمر 24 ساعة: فكل بصمة
 * تنتمي ليوم واحد بالضبط — من جاء مبكراً أو انصرف متأخراً يُحسب ليومه.
 */
const SHIFT_DAY_LEAD_MINUTES = 4 * 60;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

type AttendanceStatus =
  | 'present'
  | 'late'
  | 'early_leave'
  | 'late_and_early_leave'
  | 'incomplete' // بصمة واحدة بس (حضور بدون انصراف أو العكس)
  | 'absent'
  | 'on_leave' // ✅ يوم إجازة
  | 'unclassified'; // مفيش شيفت متعين للموظف أصلاً

interface AttendanceEvaluation {
  lateMinutes: number;
  earlyLeaveMinutes: number;
  status: AttendanceStatus;
}

/** حضور موظف في يوم واحد */
interface DayAttendance extends AttendanceEvaluation {
  checkIn: AttendanceLog | null;
  checkOut: AttendanceLog | null;
  minutes: number;
  leaveReason?: string;
  logs: AttendanceLog[];
}

export interface DailySummaryRow {
  employeeId: string | undefined;
  employeeCode: string;
  employeeName: string | undefined;
  shiftName: string | undefined;
  /** null للغائب */
  firstPunch: Date | null;
  lastPunch: Date | null;
  totalMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  status: AttendanceStatus;
  leaveReason?: string;
  logs: AttendanceLog[];
}

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(BiometricDevice)
    private readonly deviceRepo: Repository<BiometricDevice>,
    @InjectRepository(AttendanceLog)
    private readonly logRepo: Repository<AttendanceLog>,
    private readonly dataSource: DataSource,
    private readonly reportService: ReportService,
    private readonly events: DomainEvents,
  ) {}

  /** منطقة الشركة الزمنية: بها تُحدَّد الأيام والورديات وتُعرض الأوقات */
  private zoneOf(tenantId: string): Promise<string> {
    return tenantTimezoneOf(this.dataSource.manager, tenantId);
  }

  // ==========================================================
  // ✅ منطق ضبط الحضور/الانصراف حسب الشيفت (مع دعم الشيفت الليلي)
  // ==========================================================

  /**
   * حدود "اليوم" لموظف: من قبل بداية ورديته بمهلة حتى نفس اللحظة من اليوم
   * التالي (النهاية غير مشمولة). بلا وردية: اليوم التقويمي بتوقيت الشركة.
   */
  private getShiftDayRange(
    day: string,
    zone: string,
    shift?: Shift | null,
  ): { start: Date; end: Date } {
    const lead = shift
      ? getShiftWindow(shift).startMinutes - SHIFT_DAY_LEAD_MINUTES
      : 0;
    return {
      start: dayOffsetInZone(day, lead, zone),
      end: dayOffsetInZone(day, lead + DAY_MINUTES, zone),
    };
  }

  /** التأخير والانصراف المبكر مقارنةً بموعدَي الوردية في ذلك اليوم */
  private evaluateAttendanceStatus(
    checkIn: Date,
    checkOut: Date,
    shift: Shift,
    day: string,
    zone: string,
  ): AttendanceEvaluation {
    const { startMinutes, endMinutes, isOvernight, graceMinutes } =
      getShiftWindow(shift);

    const shiftStart = dayOffsetInZone(day, startMinutes, zone);
    const shiftEnd = dayOffsetInZone(
      day,
      endMinutes + (isOvernight ? DAY_MINUTES : 0),
      zone,
    );

    const lateRaw = minutesBetween(shiftStart, checkIn);
    const lateMinutes = lateRaw > graceMinutes ? lateRaw : 0;

    const earlyRaw = minutesBetween(checkOut, shiftEnd);
    const earlyLeaveMinutes = earlyRaw > graceMinutes ? earlyRaw : 0;

    let status: AttendanceStatus = 'present';
    if (lateMinutes > 0 && earlyLeaveMinutes > 0)
      status = 'late_and_early_leave';
    else if (lateMinutes > 0) status = 'late';
    else if (earlyLeaveMinutes > 0) status = 'early_leave';

    return { lateMinutes, earlyLeaveMinutes, status };
  }

  /** يلخّص بصمات موظف في يوم واحد (مرتبة زمنياً وضمن حدود يومه) */
  private summarizeDay(
    dayLogs: AttendanceLog[],
    shift: Shift | null | undefined,
    day: string,
    zone: string,
  ): DayAttendance {
    const none = { lateMinutes: 0, earlyLeaveMinutes: 0 };

    if (dayLogs.length === 0) {
      return {
        ...none,
        status: 'absent',
        checkIn: null,
        checkOut: null,
        minutes: 0,
        logs: dayLogs,
      };
    }

    const leaveLog = dayLogs.find((l) => l.punchType === PunchType.LEAVE);
    if (leaveLog) {
      return {
        ...none,
        status: 'on_leave',
        checkIn: null,
        checkOut: null,
        minutes: 0,
        leaveReason: leaveLog.leaveReason,
        logs: dayLogs,
      };
    }

    const checkIn = dayLogs[0];
    const checkOut = dayLogs[dayLogs.length - 1];

    let evaluation: AttendanceEvaluation = { ...none, status: 'unclassified' };
    if (dayLogs.length < 2) {
      evaluation = { ...none, status: 'incomplete' };
    } else if (shift) {
      evaluation = this.evaluateAttendanceStatus(
        checkIn.punchTime,
        checkOut.punchTime,
        shift,
        day,
        zone,
      );
    }

    return {
      ...evaluation,
      checkIn,
      checkOut,
      minutes: minutesBetween(checkIn.punchTime, checkOut.punchTime),
      logs: dayLogs,
    };
  }

  // ==========================================================
  // ✅ ساعات العمل والإضافي (تُحسب وتُخزَّن على بصمة "الانصراف")
  // ==========================================================

  /**
   * يبحث عن أقرب بصمة "حضور" سابقة لنفس الموظف خلال آخر 24 ساعة قبل
   * بصمة الانصراف، ويحسب عدد ساعات العمل والإضافي بناءً عليها.
   * يقبل EntityManager اختياري عشان يشتغل داخل transaction (مثلاً أثناء
   * استقبال بيانات الجهاز في AdmsService) بدل ما يفتح اتصال منفصل.
   */
  async recalculateWorkHours(
    checkOutLog: AttendanceLog,
    manager?: EntityManager,
  ): Promise<void> {
    if (checkOutLog.punchType !== PunchType.CHECK_OUT) return;
    if (!checkOutLog.employeeId) return;

    const logRepo = manager
      ? manager.getRepository(AttendanceLog)
      : this.logRepo;
    const employeeRepo = manager
      ? manager.getRepository(Employee)
      : this.dataSource.getRepository(Employee);

    const windowStart = new Date(
      checkOutLog.punchTime.getTime() - 24 * HOUR_MS,
    );

    const checkIn = await logRepo.findOne({
      where: {
        employeeId: checkOutLog.employeeId,
        tenantId: checkOutLog.tenantId,
        punchType: PunchType.CHECK_IN,
        punchTime: Between(windowStart, checkOutLog.punchTime),
      },
      order: { punchTime: 'DESC' },
    });

    if (!checkIn) {
      // ✅ مفيش بصمة حضور مقابلة — نصفّر القيم بدل ما نسيبها بقيمة قديمة غلط
      // (null وليس undefined: TypeORM يتجاهل undefined فيفشل الـ UPDATE لعدم وجود قيم)
      await logRepo.update(checkOutLog.id, {
        workHours: null,
        overtimeHours: null,
      });
      return;
    }

    const rawHours =
      (checkOutLog.punchTime.getTime() - checkIn.punchTime.getTime()) / HOUR_MS;
    const workHours = Math.round(rawHours * 100) / 100;

    let overtimeHours: number | null = null;
    const employee = await employeeRepo.findOne({
      where: { id: checkOutLog.employeeId },
      relations: ['shift'],
    });

    if (employee?.shift) {
      const { durationMinutes } = getShiftWindow(employee.shift);
      const standardHours = durationMinutes / 60;
      overtimeHours = Math.max(
        0,
        Math.round((workHours - standardHours) * 100) / 100,
      );
    }

    await logRepo.update(checkOutLog.id, { workHours, overtimeHours });
  }

  /**
   * يعيد حساب ساعات العمل المتأثرة ببصمة أُضيفت أو عُدّلت: الانصراف نفسه، أو
   * أول انصراف يلي بصمة حضور (حضور يُسجَّل أو يُعدَّل بعد الانصراف يغيّر ساعاته).
   */
  async recalculateAround(
    log: AttendanceLog,
    manager?: EntityManager,
  ): Promise<void> {
    if (!log.employeeId) return;
    const logRepo = manager
      ? manager.getRepository(AttendanceLog)
      : this.logRepo;

    if (log.punchType === PunchType.CHECK_OUT) {
      await this.recalculateWorkHours(log, manager);
      return;
    }

    // بصمة لم تعد انصرافاً (عُدّل نوعها): لا تحمل ساعات عمل
    if (log.workHours != null || log.overtimeHours != null) {
      await logRepo.update(log.id, { workHours: null, overtimeHours: null });
    }
    if (log.punchType !== PunchType.CHECK_IN) return;

    const nextCheckOut = await logRepo.findOne({
      where: {
        employeeId: log.employeeId,
        tenantId: log.tenantId,
        punchType: PunchType.CHECK_OUT,
        punchTime: Between(
          log.punchTime,
          new Date(log.punchTime.getTime() + 24 * HOUR_MS),
        ),
      },
      order: { punchTime: 'ASC' },
    });
    if (nextCheckOut) await this.recalculateWorkHours(nextCheckOut, manager);
  }

  // ==========================================================
  // ✅ 1) تعديل وقت/نوع بصمة موجودة — مرة واحدة فقط خلال 24 ساعة
  // ==========================================================

  async updateLogTime(
    logId: string,
    dto: UpdateAttendanceLogDto,
    user: CurrentUserData,
  ): Promise<AttendanceLog> {
    const log = await this.logRepo.findOne({
      where: { id: logId, tenantId: user.tenantId },
    });
    if (!log) throw new NotFoundException('سجل البصمة غير موجود');

    if (log.isEdited) {
      throw new BadRequestException(
        'تم تعديل هذه البصمة من قبل بالفعل، ولا يمكن تعديلها مرة أخرى',
      );
    }

    const referenceTime = log.originalPunchTime ?? log.punchTime;
    const hoursSinceRecorded = (Date.now() - referenceTime.getTime()) / HOUR_MS;

    if (hoursSinceRecorded > EDIT_WINDOW_HOURS) {
      throw new BadRequestException(
        `لا يمكن تعديل البصمة بعد مرور أكثر من ${EDIT_WINDOW_HOURS} ساعة على وقتها المسجل الأصلي`,
      );
    }

    const punchTime = new Date(dto.punchTime);
    if (punchTime.getTime() > Date.now()) {
      throw new BadRequestException('لا يمكن تسجيل بصمة بتاريخ في المستقبل');
    }

    const punchType = dto.punchType ?? log.punchType;
    if (punchType === PunchType.LEAVE && !dto.leaveReason?.trim()) {
      throw new BadRequestException('سبب الإجازة مطلوب');
    }

    const editorUser = await this.dataSource
      .getRepository(User)
      .findOne({ where: { id: user.id } });

    // بصمة الانصراف التي كانت تُحسب على هذه البصمة قبل تحريكها
    const previous = { ...log };

    log.punchTime = punchTime;
    log.punchType = punchType;
    if (dto.leaveReason !== undefined) log.leaveReason = dto.leaveReason;
    log.isEdited = true;
    log.editedByUserId = user.id;
    log.editedByName = editorUser?.username ?? editorUser?.email ?? undefined;
    log.editedAt = new Date();

    const saved = await this.logRepo.save(log);

    await this.recalculateAround(saved);
    if (previous.punchType === PunchType.CHECK_IN) {
      // الحضور تحرّك أو تغيّر نوعه: الانصراف الذي كان يليه يُعاد حسابه
      await this.recalculateAround(previous);
    }

    if (saved.employeeId) {
      this.events.emit('attendance.punch_changed', {
        tenantId: user.tenantId,
        actorUserId: user.id,
        logId: saved.id,
        employeeId: saved.employeeId,
        change: 'edited',
        punchType: saved.punchType,
        punchTime: saved.punchTime,
        previousPunchTime: previous.punchTime,
        byName: log.editedByName ?? null,
        leaveReason: saved.leaveReason ?? null,
      });
    }

    return this.logRepo.findOneOrFail({ where: { id: saved.id } });
  }

  // ==========================================================
  // ✅ 2) إضافة بصمة/إجازة يدوية — بشرط ألا يتجاوز التاريخ 24 ساعة من الآن
  // ==========================================================

  async createManualLog(
    dto: CreateManualAttendanceLogDto,
    user: CurrentUserData,
  ): Promise<AttendanceLog> {
    const employee = await this.dataSource.getRepository(Employee).findOne({
      where: { id: dto.employeeId, tenantId: user.tenantId },
    });
    if (!employee) throw new NotFoundException('الموظف غير موجود');

    const punchTime = new Date(dto.punchTime);
    const now = new Date();

    if (punchTime.getTime() > now.getTime()) {
      throw new BadRequestException('لا يمكن تسجيل بصمة بتاريخ في المستقبل');
    }

    const hoursSinceNow = (now.getTime() - punchTime.getTime()) / HOUR_MS;
    if (hoursSinceNow > MANUAL_ENTRY_WINDOW_HOURS) {
      throw new BadRequestException(
        `لا يمكن إضافة بصمة يدوية لتاريخ يتجاوز ${MANUAL_ENTRY_WINDOW_HOURS} ساعة من الوقت الحالي`,
      );
    }

    if (dto.punchType === PunchType.LEAVE && !dto.leaveReason?.trim()) {
      throw new BadRequestException('سبب الإجازة مطلوب');
    }

    const creatorUser = await this.dataSource
      .getRepository(User)
      .findOne({ where: { id: user.id } });

    const log = this.logRepo.create({
      employeeId: employee.id,
      deviceUserId: employee.employeeCode,
      tenantId: user.tenantId,
      punchTime,
      originalPunchTime: punchTime,
      punchType: dto.punchType,
      verifyMode: dto.verifyMode ?? VerifyMode.MANUAL,
      leaveReason:
        dto.punchType === PunchType.LEAVE ? dto.leaveReason : undefined,
      isManualEntry: true,
      createdByUserId: user.id,
      createdByName: creatorUser?.username ?? creatorUser?.email ?? undefined,
    });

    const saved = await this.logRepo.save(log);
    await this.recalculateAround(saved);

    this.events.emit('attendance.punch_changed', {
      tenantId: user.tenantId,
      actorUserId: user.id,
      logId: saved.id,
      employeeId: employee.id,
      change: 'manual',
      punchType: saved.punchType,
      punchTime: saved.punchTime,
      byName: saved.createdByName ?? null,
      leaveReason: saved.leaveReason ?? null,
    });

    return this.logRepo.findOneOrFail({
      where: { id: saved.id },
      relations: ['employee', 'device'],
    });
  }

  // ==========================================================
  // إدارة الأجهزة
  // ==========================================================

  /** يضع أمر تسجيل الموظف في طابور الجهاز: ينفّذه عند سؤاله التالي عن أوامره */
  async pushUserToDevice(
    deviceId: string,
    employeeId: string,
    user: CurrentUserData,
  ) {
    const device = await this.findOneDevice(deviceId, user);
    if (device.status === DeviceStatus.DISABLED) {
      throw new BadRequestException('الجهاز موقوف: فعّله أولاً لإرسال الأوامر');
    }

    const employee = await this.dataSource.getRepository(Employee).findOne({
      where: { id: employeeId, tenantId: user.tenantId },
    });
    if (!employee) throw new NotFoundException('الموظف غير موجود');

    // حقول الأمر يفصلها tab وينتهي بسطر جديد: محرف منها داخل الاسم يكسر الأمر
    const name = employee.fullName.replace(/[\t\r\n]+/g, ' ').trim();
    const command = `DATA USER PIN=${employee.employeeCode}\tName=${name}\tPri=0\tPass=0`;

    const commands = this.dataSource.getRepository(DeviceCommand);
    const pending = await commands.findOne({
      where: { deviceId: device.id, command, isExecuted: false },
    });
    // نفس الأمر ما زال بانتظار الجهاز: لا يُكرَّر
    if (pending) return pending;

    return commands.save({
      deviceId: device.id,
      command,
      isExecuted: false,
      tenantId: user.tenantId,
    });
  }

  async createDevice(
    dto: CreateDeviceDto,
    user: CurrentUserData,
  ): Promise<BiometricDevice> {
    const serialNumber = dto.serialNumber.trim();
    await this.assertSerialFree(serialNumber);

    const device = this.deviceRepo.create({
      ...dto,
      serialNumber,
      tenantId: user.tenantId,
      branchId: await resolveBranchId(
        this.dataSource.manager,
        user.tenantId,
        dto.branchId,
      ),
    });
    return withLiveStatus(await this.deviceRepo.save(device));
  }

  async findAllDevices(user: CurrentUserData): Promise<BiometricDevice[]> {
    const allowed = scopedBranchIds();
    const devices = await this.deviceRepo.find({
      where: {
        tenantId: user.tenantId,
        ...(allowed ? { branchId: In(allowed) } : {}),
      },
      relations: { branch: true },
      order: { createdAt: 'DESC' },
    });
    return devices.map(withLiveStatus);
  }

  async findOneDevice(
    id: string,
    user: CurrentUserData,
  ): Promise<BiometricDevice> {
    const device = await this.deviceRepo.findOne({
      where: { id, tenantId: user.tenantId },
    });
    if (!device) throw new NotFoundException('الجهاز غير موجود');
    assertBranchVisible(device.branchId, 'الجهاز غير موجود');
    return withLiveStatus(device);
  }

  async updateDevice(
    id: string,
    dto: UpdateDeviceDto,
    user: CurrentUserData,
  ): Promise<BiometricDevice> {
    const device = await this.deviceRepo.findOne({
      where: { id, tenantId: user.tenantId },
    });
    if (!device) throw new NotFoundException('الجهاز غير موجود');
    assertBranchVisible(device.branchId, 'الجهاز غير موجود');

    if (dto.branchId && dto.branchId !== device.branchId) {
      await resolveBranchId(
        this.dataSource.manager,
        user.tenantId,
        dto.branchId,
      );
    }
    const serialNumber = dto.serialNumber?.trim();
    if (serialNumber && serialNumber !== device.serialNumber) {
      await this.assertSerialFree(serialNumber);
    }

    // الإيقاف والتفعيل: الحقلان يتحركان معاً (isActive يُحتسب في حد الباقة)
    const disabled =
      dto.status === DeviceStatus.DISABLED || dto.isActive === false;
    const enabled =
      dto.isActive === true ||
      (dto.status !== undefined && dto.status !== DeviceStatus.DISABLED);

    Object.assign(device, dto, serialNumber ? { serialNumber } : {});
    if (disabled) {
      device.isActive = false;
      device.status = DeviceStatus.DISABLED;
    } else if (enabled) {
      device.isActive = true;
      // الحالة الفعلية تُحسب من آخر اتصال
      device.status = DeviceStatus.OFFLINE;
    }

    return withLiveStatus(await this.deviceRepo.save(device));
  }

  async removeDevice(id: string, user: CurrentUserData): Promise<void> {
    const device = await this.deviceRepo.findOne({
      where: { id, tenantId: user.tenantId },
    });
    if (!device) throw new NotFoundException('الجهاز غير موجود');
    assertBranchVisible(device.branchId, 'الجهاز غير موجود');

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(DeviceCommand, { deviceId: device.id });
      // البصمات المسجّلة تبقى (تفقد ارتباطها بالجهاز فقط)
      await manager.remove(device);
    });
  }

  /** الرقم التسلسلي يعرّف الجهاز عند اتصاله: فريد على مستوى النظام كله */
  private async assertSerialFree(serialNumber: string): Promise<void> {
    const taken = await this.deviceRepo.findOne({ where: { serialNumber } });
    if (taken) {
      throw new ConflictException(
        'جهاز بهذا الرقم التسلسلي مسجّل بالفعل. تحقق من الرقم، أو تواصل مع الدعم إن كان الجهاز انتقل إليكم من شركة أخرى.',
      );
    }
  }

  // ==========================================================
  // ✅ 7) عرض السجلات مع الفلترة (نوع البصمة / الموظف / التاريخ)
  // ==========================================================

  /**
   * حدّا فترة البحث كلحظات. تاريخ بلا وقت (2026-06-30) يعني اليوم كاملاً
   * بتوقيت الشركة — فـ "إلى 30/6" تشمل بصمات مساء ذلك اليوم.
   */
  private resolveRange(
    query: Pick<AttendanceQueryDto, 'from' | 'to'>,
    zone: string,
  ): { from?: Date; to?: Date } {
    const from = query.from
      ? DATE_ONLY.test(query.from)
        ? (startOfDayInZone(query.from, zone) ?? undefined)
        : new Date(query.from)
      : undefined;
    const to = query.to
      ? DATE_ONLY.test(query.to)
        ? new Date(dayOffsetInZone(query.to, DAY_MINUTES, zone).getTime() - 1)
        : new Date(query.to)
      : undefined;

    if (from && to && from > to) {
      throw new BadRequestException('تاريخ البداية بعد تاريخ النهاية');
    }
    return { from, to };
  }

  private async buildLogsQuery(
    query: AttendanceQueryDto,
    user: CurrentUserData,
  ) {
    const qb = this.logRepo
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.employee', 'employee')
      .leftJoinAndSelect('log.device', 'device')
      .where('log.tenantId = :tenantId', { tenantId: user.tenantId });
    // الحضور يتبع فرع الموظف (لا فرع الجهاز الذي بصم عليه)
    restrictToScopedBranches(qb, 'employee.branchId');
    if (query.branchId) {
      qb.andWhere('employee.branchId = :branchId', {
        branchId: query.branchId,
      });
    }

    const { from, to } = this.resolveRange(
      query,
      await this.zoneOf(user.tenantId),
    );
    if (from) qb.andWhere('log.punchTime >= :from', { from });
    if (to) qb.andWhere('log.punchTime <= :to', { to });

    if (query.punchType) {
      qb.andWhere('log.punchType = :punchType', {
        punchType: query.punchType,
      });
    }
    if (query.employeeId) {
      qb.andWhere('log.employeeId = :employeeId', {
        employeeId: query.employeeId,
      });
    }
    if (query.employeeName) {
      qb.andWhere('LOWER(employee.fullName) LIKE LOWER(:name)', {
        name: `%${query.employeeName}%`,
      });
    }

    return qb;
  }

  async findLogs(query: AttendanceQueryDto, user: CurrentUserData) {
    const { page = 1 } = query;
    const limit = Math.min(query.limit ?? 50, 200);

    const qb = (await this.buildLogsQuery(query, user))
      .orderBy('log.punchTime', 'DESC')
      .take(limit)
      .skip((page - 1) * limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }

  async findEmployeeLogs(
    employeeId: string,
    query: AttendanceQueryDto,
    user: CurrentUserData,
  ) {
    const where: FindOptionsWhere<AttendanceLog> = {
      tenantId: user.tenantId,
      employeeId,
    };
    const { from, to } = this.resolveRange(
      query,
      await this.zoneOf(user.tenantId),
    );
    if (from && to) where.punchTime = Between(from, to);
    else if (from) where.punchTime = MoreThanOrEqual(from);
    else if (to) where.punchTime = LessThanOrEqual(to);

    return this.logRepo.find({
      where,
      relations: ['device'],
      order: { punchTime: 'ASC' },
    });
  }

  // ✅ تصدير نتائج الفلترة PDF / Excel
  async exportLogs(
    query: AttendanceQueryDto,
    type: string,
    user: CurrentUserData,
  ): Promise<Buffer> {
    const zone = await this.zoneOf(user.tenantId);
    const logs = await (await this.buildLogsQuery(query, user))
      .orderBy('log.punchTime', 'DESC')
      .getMany();

    const columns: ReportColumn[] = [
      { header: 'الموظف', key: 'employeeName' },
      { header: 'كود الموظف', key: 'employeeCode' },
      { header: 'النوع', key: 'punchTypeLabel' },
      { header: 'وقت البصمة', key: 'punchTime' },
      { header: 'ساعات العمل', key: 'workHours' },
      { header: 'ساعات إضافية', key: 'overtimeHours' },
      { header: 'سبب الإجازة', key: 'leaveReason' },
      { header: 'تم تعديلها', key: 'editedLabel' },
    ];

    const rows: ReportRow[] = logs.map((l) => ({
      employeeName: l.employee?.fullName ?? '—',
      employeeCode: l.deviceUserId,
      punchTypeLabel: PUNCH_TYPE_LABELS_AR[l.punchType] ?? l.punchType,
      // بتوقيت الشركة، لا بتوقيت السيرفر
      punchTime: formatDateTime(l.punchTime, zone),
      workHours: l.workHours != null ? String(l.workHours) : '—',
      overtimeHours: l.overtimeHours != null ? String(l.overtimeHours) : '—',
      leaveReason: l.leaveReason ?? '—',
      editedLabel: l.isEdited ? `نعم (${l.editedByName ?? '-'})` : 'لا',
    }));

    return this.reportService.generate(type, {
      rows,
      columns,
      title: 'تقرير سجلات الحضور والانصراف',
    });
  }

  // ==========================================================
  // ملخصات الحضور اليومية والشهرية
  // ==========================================================

  /**
   * حضور كل الموظفين النشطين في يوم (YYYY-MM-DD بتوقيت الشركة)، ومعهم من بصم
   * برقم غير مربوط بموظف. من لم يبصم يظهر غائباً — إلا في يوم لم يبدأ بعد.
   */
  async getDailySummary(
    dateStr: string,
    user: CurrentUserData,
  ): Promise<DailySummaryRow[]> {
    const zone = await this.zoneOf(user.tenantId);
    const dayStart = dateStr ? startOfDayInZone(dateStr, zone) : null;
    if (!dayStart) {
      throw new BadRequestException('التاريخ مطلوب بصيغة YYYY-MM-DD');
    }
    const day = dayKeyInZone(dayStart, zone);

    const allowed = scopedBranchIds();
    const [employees, logs] = await Promise.all([
      this.dataSource.getRepository(Employee).find({
        where: {
          tenantId: user.tenantId,
          status: 'active',
          ...(allowed ? { branchId: In(allowed) } : {}),
        },
        relations: ['shift'],
        order: { fullName: 'ASC' },
      }),
      // يوم وردية أي موظف يقع ضمن يوم قبل ويومين بعد بداية اليوم التقويمي
      this.logRepo.find({
        where: {
          tenantId: user.tenantId,
          ...scopedEmployeeWhere(),
          punchTime: Between(
            new Date(dayStart.getTime() - 24 * HOUR_MS),
            new Date(dayStart.getTime() + 48 * HOUR_MS),
          ),
        },
        relations: ['employee', 'employee.shift'],
        order: { punchTime: 'ASC' },
      }),
    ]);

    const grouped = new Map<string, AttendanceLog[]>();
    for (const log of logs) {
      const key = log.employeeId ?? `pin:${log.deviceUserId}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(log);
    }

    const dayHasStarted = dayStart.getTime() <= Date.now();
    const results: DailySummaryRow[] = [];

    const addRow = (
      identity: Pick<
        DailySummaryRow,
        'employeeId' | 'employeeCode' | 'employeeName'
      >,
      shift: Shift | null | undefined,
      personLogs: AttendanceLog[],
    ) => {
      const { start, end } = this.getShiftDayRange(day, zone, shift);
      const dayLogs = personLogs.filter(
        (l) => l.punchTime >= start && l.punchTime < end,
      );
      if (dayLogs.length === 0 && (!identity.employeeId || !dayHasStarted)) {
        return;
      }

      const summary = this.summarizeDay(dayLogs, shift, day, zone);
      results.push({
        ...identity,
        shiftName: shift?.name,
        firstPunch: summary.checkIn?.punchTime ?? null,
        lastPunch: summary.checkOut?.punchTime ?? null,
        totalMinutes: summary.minutes,
        lateMinutes: summary.lateMinutes,
        earlyLeaveMinutes: summary.earlyLeaveMinutes,
        status: summary.status,
        leaveReason: summary.leaveReason,
        logs: dayLogs,
      });
    };

    for (const employee of employees) {
      addRow(
        {
          employeeId: employee.id,
          employeeCode: employee.employeeCode,
          employeeName: employee.fullName,
        },
        employee.shift,
        grouped.get(employee.id) ?? [],
      );
      grouped.delete(employee.id);
    }

    // بصمات لموظف غير نشط، أو لرقم جهاز غير مربوط بموظف
    for (const personLogs of grouped.values()) {
      const [first] = personLogs;
      addRow(
        {
          employeeId: first.employeeId,
          employeeCode: first.deviceUserId,
          employeeName: first.employee?.fullName,
        },
        first.employee?.shift,
        personLogs,
      );
    }

    return results;
  }

  /**
   * تقرير موظف لشهر: يوم بيوم حتى اليوم الحالي (أيام لم تأتِ بعد لا تُحسب
   * غياباً). الأيام بتوقيت الشركة.
   */
  async getMonthlyReport(
    employeeId: string,
    month: number,
    year: number,
    user: CurrentUserData,
  ) {
    if (
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12 ||
      !Number.isInteger(year) ||
      year < 2000 ||
      year > 2100
    ) {
      throw new BadRequestException('الشهر أو السنة غير صالحين');
    }

    const employee = await this.dataSource.getRepository(Employee).findOne({
      where: { id: employeeId, tenantId: user.tenantId },
      relations: ['shift'],
    });
    if (!employee) throw new NotFoundException('الموظف غير موجود');
    assertBranchVisible(employee.branchId, 'الموظف غير موجود');

    const zone = await this.zoneOf(user.tenantId);
    const shift = employee.shift;
    const dayKey = (d: number) =>
      `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const today = dayKeyInZone(new Date(), zone);
    // مقارنة نصية: صيغة YYYY-MM-DD تُرتَّب أبجدياً كما تُرتَّب زمنياً
    const elapsedDays = Array.from(
      { length: daysInMonth },
      (_, i) => i + 1,
    ).filter((d) => dayKey(d) <= today).length;

    const logs =
      elapsedDays === 0
        ? []
        : await this.logRepo.find({
            where: {
              tenantId: user.tenantId,
              employeeId,
              punchTime: Between(
                this.getShiftDayRange(dayKey(1), zone, shift).start,
                this.getShiftDayRange(dayKey(elapsedDays), zone, shift).end,
              ),
            },
            order: { punchTime: 'ASC' },
          });

    const dailyBreakdown = Array.from({ length: elapsedDays }, (_, i) => {
      const day = dayKey(i + 1);
      const { start, end } = this.getShiftDayRange(day, zone, shift);
      const summary = this.summarizeDay(
        logs.filter((l) => l.punchTime >= start && l.punchTime < end),
        shift,
        day,
        zone,
      );

      return {
        date: day,
        checkIn: summary.checkIn?.punchTime ?? null,
        checkOut: summary.checkOut?.punchTime ?? null,
        minutes: summary.minutes,
        lateMinutes: summary.lateMinutes,
        earlyLeaveMinutes: summary.earlyLeaveMinutes,
        status: summary.status,
        leaveReason: summary.leaveReason,
        // ساعات العمل مخزّنة على بصمات الانصراف: يوم بأكثر من فترة يُجمع
        workHours: sumHours(summary.logs.map((l) => l.workHours)),
        overtimeHours: sumHours(summary.logs.map((l) => l.overtimeHours)),
      };
    });

    const presentDays = dailyBreakdown.filter((d) => d.checkIn !== null).length;
    const leaveDays = dailyBreakdown.filter(
      (d) => d.status === 'on_leave',
    ).length;
    const total = (pick: (d: (typeof dailyBreakdown)[number]) => number) =>
      Math.round(dailyBreakdown.reduce((s, d) => s + pick(d), 0) * 100) / 100;

    return {
      employeeId,
      month,
      year,
      shiftName: shift?.name,
      totalDays: daysInMonth,
      /** الأيام التي مرّت من الشهر (يساوي totalDays لشهر انتهى) */
      elapsedDays,
      presentDays,
      leaveDays,
      absentDays: elapsedDays - presentDays - leaveDays,
      totalMinutes: total((d) => d.minutes),
      totalLateMinutes: total((d) => d.lateMinutes),
      totalEarlyLeaveMinutes: total((d) => d.earlyLeaveMinutes),
      totalWorkHours: total((d) => d.workHours ?? 0),
      totalOvertimeHours: total((d) => d.overtimeHours ?? 0),
      dailyBreakdown,
    };
  }
}

/** دقائق من `from` إلى `to` (سالبة إن كان `to` قبله) */
function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60000);
}

/** مجموع ساعات مخزّنة؛ undefined إن لم تُسجَّل أي قيمة */
function sumHours(values: (number | null | undefined)[]): number | undefined {
  const present = values.filter((v) => v != null).map(Number);
  if (present.length === 0) return undefined;
  return Math.round(present.reduce((s, v) => s + v, 0) * 100) / 100;
}

/**
 * الحالة الفعلية للجهاز: المخزّنة تسجّل آخر اتصال ولا تتغير حين ينقطع، فتُشتق
 * من وقت آخر ظهور.
 */
function withLiveStatus(device: BiometricDevice): BiometricDevice {
  if (!device.isActive || device.status === DeviceStatus.DISABLED) {
    device.status = DeviceStatus.DISABLED;
  } else {
    const lastSeen = device.lastSeenAt?.getTime() ?? 0;
    device.status =
      Date.now() - lastSeen <= ONLINE_WINDOW_MS
        ? DeviceStatus.ONLINE
        : DeviceStatus.OFFLINE;
  }
  return device;
}
