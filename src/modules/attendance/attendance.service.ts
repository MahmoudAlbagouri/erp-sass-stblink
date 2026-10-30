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
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
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
  DeviceProtocol,
  DeviceStatus,
} from './entities/biometric-device.entity';
import {
  AttendanceLog,
  PUNCH_ROLE_LABELS_AR,
  PUNCH_TYPE_LABELS_AR,
  type PunchRole,
  PunchType,
  VerifyMode,
} from './entities/attendance-log.entity';
import { DeviceCommand } from './entities/device-command.entity';
import { Shift } from '../shifts/entities/shift.entity';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { AttendanceQueryDto } from './dto/attendance-query.dto';
import { UpdateAttendanceLogDto } from './dto/update-attendance-log.dto';
import { CreateManualAttendanceLogDto } from './dto/create-manual-attendance-log.dto';
import { LinkPinDto } from './dto/link-pin.dto';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Employee } from '../employees/entities/employee.entity';
import { Contract } from '../contracts/entities/contract.entity';
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
import { AttendanceSettingsService } from './attendance-settings.service';
import {
  BiometricSyncService,
  type DeviceCommandView,
} from './biometric-sync.service';
import {
  type AttendanceCalendar,
  type AttendanceStatus,
  type DayAttendance,
  DAY_MINUTES,
  addDays,
  daysBetween,
  evaluateDay,
  planDay,
  shiftDayOf,
  shiftDayRange,
  toDayKey,
  toHours,
} from './attendance-days';
import {
  assertPinFree,
  employeePin,
  pinKey,
  pinKeySql,
  relinkPunches,
} from './utils/attendance-pin';
import { parseAllowedIps } from './utils/ip-allowlist';
import { generateDeviceKey, hashDeviceKey } from '../pos/utils/pos-crypto.util';

const EDIT_WINDOW_HOURS = 24;
const MANUAL_ENTRY_WINDOW_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

/**
 * الجهاز يسأل السيرفر كل ~10 ثوانٍ: غيابه أطول من هذا يعني أنه غير متصل.
 * الحالة تُحسب عند القراءة — لا أحد يُبلغنا حين ينقطع الجهاز.
 */
const ONLINE_WINDOW_MS = 2 * 60 * 1000;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export type { AttendanceStatus };

/** يوم حضور موظف (بتقويم الشركة) */
export interface EmployeeDay extends DayAttendance {
  date: string;
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
  overtimeMinutes: number;
  status: AttendanceStatus;
  leaveReason?: string;
  holidayName?: string;
  logs: AttendanceLog[];
}

export interface UnlinkedPin {
  pin: string;
  punches: number;
  firstPunch: Date;
  lastPunch: Date;
  devices: string[];
}

/** الجهاز ومفتاح إرساله (يُعرض مرة واحدة عند إنشائه أو تجديده) */
export type DeviceWithKey = BiometricDevice & { pushKey?: string };

export interface DeviceSetup {
  protocol: DeviceProtocol;
  serialNumber: string;
  /** ZKTeco: ما يُكتب في إعدادات "Cloud Server" على الجهاز */
  zk?: {
    serverAddress: string;
    serverPort: number;
    https: boolean;
    path: string;
  };
  /** Hikvision: ما يُكتب في HTTP Listening؛ المفتاح يُعرض عند توليده فقط */
  hikvision?: {
    host: string;
    port: number;
    https: boolean;
    urlPath: string;
  };
  /** API: الرابط والترويسات */
  api?: { url: string; deviceIdHeader: string; deviceKeyHeader: string };
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
    private readonly settings: AttendanceSettingsService,
    private readonly sync: BiometricSyncService,
  ) {}

  /** منطقة الشركة الزمنية: بها تُحدَّد الأيام والورديات وتُعرض الأوقات */
  private zoneOf(tenantId: string): Promise<string> {
    return tenantTimezoneOf(this.dataSource.manager, tenantId);
  }

  // ==========================================================
  // ✅ أيام الحضور — أساس الملخص والتقرير الشهري ومسير الرواتب
  // ==========================================================

  /**
   * أيام حضور موظفين من `fromDay` إلى `toDay` (شاملة، بتقويم الشركة).
   * الموظفون محمَّلون بورديتهم (relations: shift).
   */
  async attendanceDays(
    tenantId: string,
    employees: Employee[],
    fromDay: string,
    toDay: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Map<string, EmployeeDay[]>> {
    const result = new Map<string, EmployeeDay[]>();
    if (employees.length === 0 || toDay < fromDay) return result;
    const ids = employees.map((e) => e.id);

    const calendar = await this.settings.loadCalendar(
      tenantId,
      fromDay,
      toDay,
      ids,
      manager,
    );
    const [logs, starts] = await Promise.all([
      manager.find(AttendanceLog, {
        where: {
          tenantId,
          employeeId: In(ids),
          punchTime: Between(
            dayOffsetInZone(fromDay, -DAY_MINUTES, calendar.zone),
            dayOffsetInZone(toDay, 2 * DAY_MINUTES, calendar.zone),
          ),
        },
        order: { punchTime: 'ASC' },
      }),
      this.employmentStarts(tenantId, employees, calendar.zone, manager),
    ]);

    const logsOf = groupBy(logs, (log) => log.employeeId!);
    const days = daysBetween(fromDay, toDay);
    for (const employee of employees) {
      result.set(
        employee.id,
        days.map((day) => ({
          date: day,
          ...this.evaluateFor(
            employee,
            day,
            logsOf.get(employee.id) ?? [],
            calendar,
            starts.get(employee.id),
          ),
        })),
      );
    }
    return result;
  }

  private evaluateFor(
    employee: Pick<Employee, 'id' | 'shift'>,
    day: string,
    personLogs: AttendanceLog[],
    calendar: AttendanceCalendar,
    startDay: string | undefined,
  ): DayAttendance {
    const { start, end } = shiftDayRange(day, calendar.zone, employee.shift);
    const dayLogs = personLogs.filter(
      (l) => l.punchTime >= start && l.punchTime < end,
    );
    if (startDay && day < startDay && dayLogs.length === 0) {
      return {
        status: 'not_employed',
        checkIn: null,
        checkOut: null,
        minutes: 0,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        overtimeMinutes: 0,
        logs: [],
      };
    }
    return evaluateDay(
      dayLogs,
      employee.shift,
      day,
      calendar.zone,
      planDay(calendar, employee.id, employee.shift, day),
      calendar.overtimeMinMinutes,
    );
  }

  /**
   * أول يوم يُحاسب فيه الموظف: بداية عقده (وإلا يوم تسجيله في النظام)، أو
   * أول بصمة له إن سبقت ذلك — فلا يُحسب غائباً قبل أن يلتحق.
   */
  private async employmentStarts(
    tenantId: string,
    employees: Employee[],
    zone: string,
    manager: EntityManager,
  ): Promise<Map<string, string>> {
    const ids = employees.map((e) => e.id);
    const [contracts, firstPunches] = await Promise.all([
      manager.find(Contract, {
        where: { employeeId: In(ids) },
        select: { employeeId: true, startDate: true },
      }),
      manager.query<{ employeeId: string; first: Date }[]>(
        `SELECT "employee_id" AS "employeeId", MIN("punch_time") AS "first"
           FROM attendance_logs
          WHERE "tenant_id" = $1 AND "employee_id" = ANY($2::uuid[])
          GROUP BY "employee_id"`,
        [tenantId, ids],
      ),
    ]);
    const contractStart = new Map(
      contracts
        .filter((c) => c.startDate)
        .map((c) => [c.employeeId, toDayKey(c.startDate)]),
    );
    const firstPunch = new Map(
      firstPunches.map((r) => [r.employeeId, dayKeyInZone(r.first, zone)]),
    );

    const starts = new Map<string, string>();
    for (const employee of employees) {
      const declared =
        contractStart.get(employee.id) ??
        (employee.createdAt ? dayKeyInZone(employee.createdAt, zone) : null);
      const punched = firstPunch.get(employee.id);
      const start =
        declared && punched
          ? declared < punched
            ? declared
            : punched
          : (declared ?? punched);
      if (start) starts.set(employee.id, start);
    }
    return starts;
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

    const previousPunchTime = log.punchTime;

    log.punchTime = punchTime;
    log.punchType = punchType;
    if (dto.leaveReason !== undefined) log.leaveReason = dto.leaveReason;
    log.isEdited = true;
    log.editedByUserId = user.id;
    log.editedByName = editorUser?.username ?? editorUser?.email ?? undefined;
    log.editedAt = new Date();

    const saved = await this.logRepo.save(log);

    if (saved.employeeId) {
      this.events.emit('attendance.punch_changed', {
        tenantId: user.tenantId,
        actorUserId: user.id,
        logId: saved.id,
        employeeId: saved.employeeId,
        change: 'edited',
        punchType: saved.punchType,
        punchTime: saved.punchTime,
        previousPunchTime,
        byName: log.editedByName ?? null,
        leaveReason: saved.leaveReason ?? null,
      });
    }

    const fresh = await this.logRepo.findOneOrFail({ where: { id: saved.id } });
    await this.annotateDayHours(user.tenantId, [fresh]);
    return fresh;
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
      deviceUserId: employeePin(employee),
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

    const fresh = await this.logRepo.findOneOrFail({
      where: { id: saved.id },
      relations: ['employee', 'device'],
    });
    await this.annotateDayHours(user.tenantId, [fresh]);
    return fresh;
  }

  // ==========================================================
  // إدارة الأجهزة
  // ==========================================================

  /** يضع أمر تسجيل الموظف (وبصماته المحفوظة) في طابور جهاز ZKTeco */
  async pushUserToDevice(
    deviceId: string,
    employeeId: string,
    user: CurrentUserData,
  ): Promise<{ queued: number }> {
    const device = await this.commandableDevice(deviceId, user);
    const employee = await this.dataSource.getRepository(Employee).findOne({
      where: { id: employeeId, tenantId: user.tenantId },
    });
    if (!employee) throw new NotFoundException('الموظف غير موجود');

    const commands = await this.sync.queueEmployee(device, employee);
    return { queued: commands.length };
  }

  /** كل الموظفين النشطين (أو موظفو فرع الجهاز) إلى جهاز ZKTeco */
  async syncAllUsersToDevice(
    deviceId: string,
    branchOnly: boolean,
    user: CurrentUserData,
  ): Promise<{ employees: number }> {
    const device = await this.commandableDevice(deviceId, user);
    const employees = await this.sync.queueAllEmployees(
      device,
      branchOnly ? device.branchId : null,
    );
    return { employees };
  }

  private async commandableDevice(
    deviceId: string,
    user: CurrentUserData,
  ): Promise<BiometricDevice> {
    const device = await this.findOneDevice(deviceId, user);
    if (device.status === DeviceStatus.DISABLED) {
      throw new BadRequestException('الجهاز موقوف: فعّله أولاً لإرسال الأوامر');
    }
    if (device.protocol !== DeviceProtocol.ZK_ADMS) {
      throw new BadRequestException(
        'إرسال الموظفين للجهاز متاح لأجهزة ZKTeco فقط؛ سجّل الموظف على الجهاز برقمه',
      );
    }
    return device;
  }

  async createDevice(
    dto: CreateDeviceDto,
    user: CurrentUserData,
  ): Promise<DeviceWithKey> {
    const serialNumber = dto.serialNumber.trim();
    await this.assertSerialFree(serialNumber);
    const protocol = dto.protocol ?? DeviceProtocol.ZK_ADMS;
    const pushKey = usesPushKey(protocol) ? generateDeviceKey() : undefined;

    const device = this.deviceRepo.create({
      ...dto,
      serialNumber,
      protocol,
      allowedIps: cleanAllowedIps(dto.allowedIps),
      pushKeyHash: pushKey ? hashDeviceKey(pushKey) : null,
      tenantId: user.tenantId,
      branchId: await resolveBranchId(
        this.dataSource.manager,
        user.tenantId,
        dto.branchId,
      ),
    });
    const saved = withLiveStatus(await this.deviceRepo.save(device));
    delete saved.pushKeyHash;
    return pushKey ? { ...saved, pushKey } : saved;
  }

  /** مفتاح إرسال جديد (Hikvision / API): القديم يتوقف فوراً */
  async regeneratePushKey(
    id: string,
    user: CurrentUserData,
  ): Promise<DeviceWithKey> {
    const device = await this.findOneDevice(id, user);
    if (!usesPushKey(device.protocol)) {
      throw new BadRequestException('أجهزة ZKTeco لا تستخدم مفتاحاً');
    }
    const pushKey = generateDeviceKey();
    await this.deviceRepo.update(device.id, {
      pushKeyHash: hashDeviceKey(pushKey),
    });
    return { ...device, pushKey };
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
    const pending = await this.sync.pendingCounts(devices.map((d) => d.id));
    return devices.map((device) => {
      device.pendingCommands = pending.get(device.id) ?? 0;
      return withLiveStatus(device);
    });
  }

  /** آخر أوامر جهاز ZKTeco وحالاتها: نُفّذ، رُفض، أو لم يرد عليه */
  async deviceCommands(
    id: string,
    user: CurrentUserData,
  ): Promise<DeviceCommandView[]> {
    const device = await this.findOneDevice(id, user);
    return this.sync.history(device.id);
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

  /**
   * ما يُكتب في الجهاز ليتصل بالسيرفر. `origin` أصل الـ API العام. أجهزة
   * ZKTeco كثيرة لا تدعم HTTPS: عنوانها DEVICE_SERVER_URL إن ضُبط، وإلا نفس
   * الدومين على HTTP (المنفذ 80).
   */
  async deviceSetup(
    id: string,
    user: CurrentUserData,
    origin: string,
  ): Promise<DeviceSetup> {
    const device = await this.findOneDevice(id, user);
    const api = new URL(origin);
    const base = {
      protocol: device.protocol,
      serialNumber: device.serialNumber,
    };

    if (device.protocol === DeviceProtocol.ZK_ADMS) {
      const server = new URL(
        process.env.DEVICE_SERVER_URL?.trim() || `http://${api.hostname}`,
      );
      const https = server.protocol === 'https:';
      return {
        ...base,
        zk: {
          serverAddress: server.hostname,
          serverPort: Number(server.port) || (https ? 443 : 80),
          https,
          path: '/iclock/cdata',
        },
      };
    }
    if (device.protocol === DeviceProtocol.HIKVISION) {
      const https = api.protocol === 'https:';
      return {
        ...base,
        hikvision: {
          host: api.hostname,
          port: Number(api.port) || (https ? 443 : 80),
          https,
          urlPath: `/attendance-push/hikvision/${device.id}/<المفتاح>`,
        },
      };
    }
    return {
      ...base,
      api: {
        url: `${origin}/attendance-push/api`,
        deviceIdHeader: `X-Device-Id: ${device.id}`,
        deviceKeyHeader: 'X-Device-Key: <المفتاح>',
      },
    };
  }

  async updateDevice(
    id: string,
    dto: UpdateDeviceDto,
    user: CurrentUserData,
  ): Promise<DeviceWithKey> {
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

    const { allowedIps, ...rest } = dto;
    Object.assign(device, rest, serialNumber ? { serialNumber } : {});
    if (allowedIps !== undefined) {
      device.allowedIps = cleanAllowedIps(allowedIps);
    }
    if (disabled) {
      device.isActive = false;
      device.status = DeviceStatus.DISABLED;
    } else if (enabled) {
      device.isActive = true;
      // الحالة الفعلية تُحسب من آخر اتصال
      device.status = DeviceStatus.OFFLINE;
    }

    // تحويل الجهاز إلى نوع بمفتاح يعطيه مفتاحاً
    let pushKey: string | undefined;
    if (usesPushKey(device.protocol)) {
      const { pushKeyHash } = await this.deviceRepo.findOneOrFail({
        where: { id: device.id },
        select: { id: true, pushKeyHash: true },
      });
      if (!pushKeyHash) {
        pushKey = generateDeviceKey();
        device.pushKeyHash = hashDeviceKey(pushKey);
      }
    }

    const saved = withLiveStatus(await this.deviceRepo.save(device));
    delete saved.pushKeyHash;
    return pushKey ? { ...saved, pushKey } : saved;
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
  // أرقام البصمة غير المربوطة بموظفين
  // ==========================================================

  /**
   * أرقام وصلت منها بصمات ولا يقابلها موظف: موظفون مسجّلون على الجهاز بأرقام
   * غير أكوادهم، أو لم يُضافوا للنظام بعد.
   */
  async findUnlinkedPins(user: CurrentUserData): Promise<UnlinkedPin[]> {
    const allowed = scopedBranchIds();
    const rows = await this.dataSource.query<
      {
        pin: string;
        punches: number;
        firstPunch: Date;
        lastPunch: Date;
        devices: string[] | null;
      }[]
    >(
      `SELECT MIN(l."device_user_id") AS "pin",
              COUNT(*)::int AS "punches",
              MIN(l."punch_time") AS "firstPunch",
              MAX(l."punch_time") AS "lastPunch",
              array_agg(DISTINCT COALESCE(d."alias", d."serialNumber"))
                FILTER (WHERE d."id" IS NOT NULL) AS "devices"
         FROM attendance_logs l
         LEFT JOIN biometric_devices d ON d."id" = l."device_id"
        WHERE l."tenant_id" = $1 AND l."employee_id" IS NULL
          AND l."punch_type" <> 'leave'
          AND ($2::uuid[] IS NULL OR d."branch_id" = ANY($2::uuid[]))
        GROUP BY ${pinKeySql('l."device_user_id"')}
        ORDER BY MAX(l."punch_time") DESC
        LIMIT 200`,
      [user.tenantId, allowed],
    );
    return rows.map((row) => ({ ...row, devices: row.devices ?? [] }));
  }

  /**
   * يربط رقماً على الجهاز بموظف: يصبح رقمه على الأجهزة، وتُنسب له كل البصمات
   * التي وصلت بهذا الرقم من قبل.
   */
  async linkPin(
    dto: LinkPinDto,
    user: CurrentUserData,
  ): Promise<{
    employeeId: string;
    attendancePin: string | null;
    linked: number;
  }> {
    return this.dataSource.transaction(async (manager) => {
      const employee = await manager.findOne(Employee, {
        where: { id: dto.employeeId, tenantId: user.tenantId },
      });
      if (!employee) throw new NotFoundException('الموظف غير موجود');
      assertBranchVisible(employee.branchId, 'الموظف غير موجود');

      const pin = dto.pin.trim();
      // رقمه هو كوده: لا حاجة لرقم خاص
      const attendancePin =
        pinKey(pin) === pinKey(employee.employeeCode) ? null : pin;
      if (attendancePin) {
        await assertPinFree(manager, user.tenantId, pin, employee.id);
      }
      await manager.update(Employee, employee.id, { attendancePin });
      const linked = await relinkPunches(
        manager,
        user.tenantId,
        employee.id,
        pin,
      );
      return { employeeId: employee.id, attendancePin, linked };
    });
  }

  // ==========================================================
  // ✅ عرض السجلات مع الفلترة (نوع البصمة / الموظف / التاريخ)
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
    await this.annotateDayHours(user.tenantId, data);
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

    const logs = await this.logRepo.find({
      where,
      relations: ['device'],
      order: { punchTime: 'ASC' },
    });
    await this.annotateDayHours(user.tenantId, logs);
    return logs;
  }

  /**
   * دور كل بصمة في يوم ورديتها (حضور، انصراف، خلال اليوم)، وساعات العمل
   * والإضافي على آخر بصمة فيه (وغيرها null) — من أول بصمة وآخرها في يومها،
   * أيّاً كان نوعهما.
   */
  private async annotateDayHours(
    tenantId: string,
    logs: AttendanceLog[],
  ): Promise<void> {
    for (const log of logs) {
      log.workHours = null;
      log.overtimeHours = null;
      log.dayRole = null;
    }
    const linked = logs.filter(
      (l) => l.employeeId && l.punchType !== PunchType.LEAVE,
    );
    if (linked.length === 0) return;

    const employeeIds = [...new Set(linked.map((l) => l.employeeId!))];
    const [zone, employees] = await Promise.all([
      this.zoneOf(tenantId),
      this.dataSource.getRepository(Employee).find({
        where: { id: In(employeeIds) },
        relations: { shift: true },
        withDeleted: true,
      }),
    ]);
    const byId = new Map(employees.map((e) => [e.id, e]));

    const wanted = new Map<string, { employee: Employee; day: string }>();
    for (const log of linked) {
      const employee = byId.get(log.employeeId!);
      if (!employee) continue;
      const day = shiftDayOf(log.punchTime, zone, employee.shift);
      wanted.set(`${employee.id}|${day}`, { employee, day });
    }
    if (wanted.size === 0) return;

    const days = [...wanted.values()].map((w) => w.day).sort();
    const [fromDay, toDay] = [days[0], days[days.length - 1]];
    const calendar = await this.settings.loadCalendar(
      tenantId,
      fromDay,
      toDay,
      employeeIds,
    );
    const dayLogs = await this.logRepo.find({
      where: {
        tenantId,
        employeeId: In(employeeIds),
        punchTime: Between(
          dayOffsetInZone(fromDay, -DAY_MINUTES, zone),
          dayOffsetInZone(toDay, 2 * DAY_MINUTES, zone),
        ),
      },
      order: { punchTime: 'ASC' },
    });
    const logsOf = groupBy(dayLogs, (log) => log.employeeId!);

    const hoursByLog = new Map<string, DayAttendance>();
    const roleByLog = new Map<string, PunchRole>();
    for (const { employee, day } of wanted.values()) {
      const result = this.evaluateFor(
        employee,
        day,
        logsOf.get(employee.id) ?? [],
        calendar,
        undefined,
      );
      const punches = result.logs.filter(
        (l) => l.punchType !== PunchType.LEAVE,
      );
      punches.forEach((punch, i) =>
        roleByLog.set(
          punch.id,
          i === 0
            ? 'check_in'
            : i === punches.length - 1
              ? 'check_out'
              : 'during_day',
        ),
      );
      if (result.checkOut && result.checkIn !== result.checkOut) {
        hoursByLog.set(result.checkOut.id, result);
      }
    }
    for (const log of linked) {
      log.dayRole = roleByLog.get(log.id) ?? null;
      const day = hoursByLog.get(log.id);
      if (!day) continue;
      log.workHours = toHours(day.minutes);
      log.overtimeHours = toHours(day.overtimeMinutes);
    }
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
    await this.annotateDayHours(user.tenantId, logs);

    const columns: ReportColumn[] = [
      { header: 'الموظف', key: 'employeeName' },
      { header: 'رقم البصمة', key: 'employeeCode' },
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
      punchTypeLabel: l.dayRole
        ? PUNCH_ROLE_LABELS_AR[l.dayRole]
        : (PUNCH_TYPE_LABELS_AR[l.punchType] ?? l.punchType),
      // بتوقيت الشركة، لا بتوقيت السيرفر
      punchTime: formatDateTime(l.punchTime, zone),
      workHours: l.workHours != null ? String(l.workHours) : '—',
      overtimeHours: l.overtimeHours ? String(l.overtimeHours) : '—',
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
   * برقم غير مربوط بموظف. من لم يبصم يظهر غائباً — إلا في يوم راحة أو عطلة
   * أو إجازة معتمدة، أو يوم لم يبدأ بعد.
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
    const employees = await this.dataSource.getRepository(Employee).find({
      where: {
        tenantId: user.tenantId,
        status: 'active',
        ...(allowed ? { branchId: In(allowed) } : {}),
      },
      relations: ['shift'],
      order: { fullName: 'ASC' },
    });
    const ids = employees.map((e) => e.id);
    const [calendar, logs, starts] = await Promise.all([
      this.settings.loadCalendar(user.tenantId, day, day, ids),
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
      ids.length
        ? this.employmentStarts(
            user.tenantId,
            employees,
            zone,
            this.dataSource.manager,
          )
        : new Map<string, string>(),
    ]);

    const grouped = groupBy(
      logs,
      (log) => log.employeeId ?? `pin:${pinKey(log.deviceUserId)}`,
    );
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
      const summary = this.evaluateFor(
        { id: identity.employeeId ?? '', shift: shift ?? undefined },
        day,
        personLogs,
        calendar,
        identity.employeeId ? starts.get(identity.employeeId) : undefined,
      );
      const hasPunches = summary.logs.length > 0;
      if (summary.status === 'not_employed') return;
      if (!hasPunches && (!identity.employeeId || !dayHasStarted)) return;

      results.push({
        ...identity,
        shiftName: shift?.name,
        firstPunch: summary.checkIn?.punchTime ?? null,
        lastPunch: summary.checkOut?.punchTime ?? null,
        totalMinutes: summary.minutes,
        lateMinutes: summary.lateMinutes,
        earlyLeaveMinutes: summary.earlyLeaveMinutes,
        overtimeMinutes: summary.overtimeMinutes,
        status: summary.status,
        leaveReason: summary.leaveReason,
        holidayName: summary.holidayName,
        logs: summary.logs,
      });
    };

    for (const employee of employees) {
      addRow(
        {
          employeeId: employee.id,
          employeeCode: employeePin(employee),
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
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const last = addDays(first, daysInMonth - 1);
    const today = dayKeyInZone(new Date(), zone);
    const until = last < today ? last : today;

    const days =
      until < first
        ? []
        : ((
            await this.attendanceDays(user.tenantId, [employee], first, until)
          ).get(employee.id) ?? []);

    const dailyBreakdown = days.map((d) => ({
      date: d.date,
      checkIn: d.checkIn?.punchTime ?? null,
      checkOut: d.checkOut?.punchTime ?? null,
      minutes: d.minutes,
      lateMinutes: d.lateMinutes,
      earlyLeaveMinutes: d.earlyLeaveMinutes,
      overtimeMinutes: d.overtimeMinutes,
      status: d.status,
      leaveReason: d.leaveReason,
      holidayName: d.holidayName,
      workHours: d.minutes > 0 ? toHours(d.minutes) : undefined,
      overtimeHours:
        d.overtimeMinutes > 0 ? toHours(d.overtimeMinutes) : undefined,
    }));

    const count = (...statuses: AttendanceStatus[]) =>
      days.filter((d) => statuses.includes(d.status)).length;
    const sum = (pick: (d: EmployeeDay) => number) =>
      days.reduce((total, d) => total + pick(d), 0);
    const totalMinutes = sum((d) => d.minutes);
    const totalOvertimeMinutes = sum((d) => d.overtimeMinutes);

    return {
      employeeId,
      month,
      year,
      shiftName: employee.shift?.name,
      totalDays: daysInMonth,
      /** الأيام التي مرّت من الشهر (يساوي totalDays لشهر انتهى) */
      elapsedDays: days.length,
      /** أيام قبل التحاقه (لا تُحسب) */
      notEmployedDays: count('not_employed'),
      offDays: count('off_day'),
      holidayDays: count('holiday'),
      /** أيام العمل المطلوبة: ما مرّ عدا الراحة والعطلات وما قبل التحاقه */
      workingDays: days.length - count('off_day', 'holiday', 'not_employed'),
      presentDays: days.filter((d) => d.checkIn !== null).length,
      leaveDays: count('on_leave'),
      absentDays: count('absent'),
      incompleteDays: count('incomplete'),
      totalMinutes,
      totalLateMinutes: sum((d) => d.lateMinutes),
      totalEarlyLeaveMinutes: sum((d) => d.earlyLeaveMinutes),
      totalOvertimeMinutes,
      totalWorkHours: toHours(totalMinutes),
      totalOvertimeHours: toHours(totalOvertimeMinutes),
      dailyBreakdown,
    };
  }

  /** موظفو الشركة النشطون الذين لهم وردية — من يُحاسَب بالحضور */
  activeShiftEmployees(
    tenantId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Employee[]> {
    return manager.find(Employee, {
      where: { tenantId, status: 'active', shiftId: Not(IsNull()) },
      relations: ['shift'],
    });
  }
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function usesPushKey(protocol: DeviceProtocol): boolean {
  return (
    protocol === DeviceProtocol.HIKVISION || protocol === DeviceProtocol.API
  );
}

/** قائمة العناوين منظَّفة (أو null)؛ عنوان غير صالح يُرفض برسالة */
function cleanAllowedIps(raw?: string | null): string | null {
  try {
    const entries = parseAllowedIps(raw);
    return entries.length > 0 ? entries.join(', ') : null;
  } catch (err) {
    throw new BadRequestException(
      `عنوان IP غير صالح: ${(err as Error).message}`,
    );
  }
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
