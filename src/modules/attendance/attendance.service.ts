import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  Between,
  FindOptionsWhere,
  DataSource,
  EntityManager,
} from 'typeorm';
import { BiometricDevice } from './entities/biometric-device.entity';
import {
  AttendanceLog,
  PunchType,
  VerifyMode,
} from './entities/attendance-log.entity';
import { DeviceCommand } from './entities/device-command.entity';
import { Shift } from '../shifts/entities/shift.entity';
import {
  getShiftWindow,
  diffMinutesOvernightAware,
} from '../shifts/utils/shift-time.util'; // ✅ منطق حساب نافذة الشيفت (يدعم الشيفت الليلي)
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { AttendanceQueryDto } from './dto/attendance-query.dto';
import { UpdateAttendanceLogDto } from './dto/update-attendance-log.dto';
import { CreateManualAttendanceLogDto } from './dto/create-manual-attendance-log.dto';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Employee } from '../employees/entities/employee.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationCategory } from '../notifications/entities/notification.entity';
import { ReportService } from '../../common/reports/report.service';

const EDIT_WINDOW_HOURS = 24;
const MANUAL_ENTRY_WINDOW_HOURS = 24;

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

const PUNCH_TYPE_LABELS_AR: Record<PunchType, string> = {
  [PunchType.CHECK_IN]: 'حضور',
  [PunchType.CHECK_OUT]: 'انصراف',
  [PunchType.BREAK_OUT]: 'خروج استراحة',
  [PunchType.BREAK_IN]: 'عودة من استراحة',
  [PunchType.OVERTIME_IN]: 'بداية إضافي',
  [PunchType.OVERTIME_OUT]: 'نهاية إضافي',
  [PunchType.LEAVE]: 'إجازة',
};

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(BiometricDevice)
    private readonly deviceRepo: Repository<BiometricDevice>,
    @InjectRepository(AttendanceLog)
    private readonly logRepo: Repository<AttendanceLog>,
    @InjectRepository(Shift)
    private readonly shiftRepo: Repository<Shift>,
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
    private readonly reportService: ReportService,
  ) {}

  // ==========================================================
  // ✅ منطق ضبط الحضور/الانصراف حسب الشيفت (مع دعم الشيفت الليلي)
  // ==========================================================

  private getShiftDayRange(
    day: Date,
    shift?: Shift,
  ): { start: Date; end: Date } {
    if (!shift) {
      const start = new Date(day);
      start.setHours(0, 0, 0, 0);
      const end = new Date(day);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }

    const { startMinutes, endMinutes, isOvernight, graceMinutes } =
      getShiftWindow(shift);

    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    start.setMinutes(start.getMinutes() + startMinutes - graceMinutes);

    const end = new Date(day);
    end.setHours(0, 0, 0, 0);
    if (isOvernight) end.setDate(end.getDate() + 1);
    end.setMinutes(end.getMinutes() + endMinutes + graceMinutes);

    return { start, end };
  }

  private evaluateAttendanceStatus(
    checkIn: Date,
    checkOut: Date,
    shift: Shift,
  ): AttendanceEvaluation {
    const { startMinutes, endMinutes, isOvernight, graceMinutes } =
      getShiftWindow(shift);

    const checkInMinutes = checkIn.getHours() * 60 + checkIn.getMinutes();
    const checkOutMinutes = checkOut.getHours() * 60 + checkOut.getMinutes();

    const lateRaw = diffMinutesOvernightAware(
      checkInMinutes,
      startMinutes,
      isOvernight,
    );
    const lateMinutes = lateRaw > graceMinutes ? lateRaw : 0;

    const earlyRaw = diffMinutesOvernightAware(
      endMinutes,
      checkOutMinutes,
      isOvernight,
    );
    const earlyLeaveMinutes = earlyRaw > graceMinutes ? earlyRaw : 0;

    let status: AttendanceStatus = 'present';
    if (lateMinutes > 0 && earlyLeaveMinutes > 0)
      status = 'late_and_early_leave';
    else if (lateMinutes > 0) status = 'late';
    else if (earlyLeaveMinutes > 0) status = 'early_leave';

    return { lateMinutes, earlyLeaveMinutes, status };
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
      checkOutLog.punchTime.getTime() - 24 * 60 * 60 * 1000,
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
      await logRepo.update(checkOutLog.id, {
        workHours: undefined,
        overtimeHours: undefined,
      });
      return;
    }

    const rawHours =
      (checkOutLog.punchTime.getTime() - checkIn.punchTime.getTime()) / 3600000;
    const workHours = Math.round(rawHours * 100) / 100;

    let overtimeHours: number | undefined;
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

  // ==========================================================
  // ✅ إشعار الموظف عند إضافة/تعديل بصمة (لو عنده حساب مستخدم مرتبط)
  // ==========================================================

  private async notifyEmployeeAboutLog(
    employeeId: string,
    tenantId: string,
    title: string,
    message: string,
  ): Promise<void> {
    const employee = await this.dataSource.getRepository(Employee).findOne({
      where: { id: employeeId, tenantId },
      relations: ['user'],
    });

    if (!employee?.user?.id) return; // الموظف مالوش حساب مستخدم مرتبط — تخطي بأمان

    await this.notificationsService.create({
      recipientId: employee.user.id,
      title,
      message,
      category: NotificationCategory.CUSTOM,
      referenceId: employeeId,
      referenceType: 'attendance',
    });
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
    const hoursSinceRecorded =
      (Date.now() - referenceTime.getTime()) / (1000 * 60 * 60);

    if (hoursSinceRecorded > EDIT_WINDOW_HOURS) {
      throw new BadRequestException(
        `لا يمكن تعديل البصمة بعد مرور أكثر من ${EDIT_WINDOW_HOURS} ساعة على وقتها المسجل الأصلي`,
      );
    }

    if (dto.punchType === PunchType.LEAVE && !dto.leaveReason?.trim()) {
      throw new BadRequestException('سبب الإجازة مطلوب');
    }

    const editorUser = await this.dataSource
      .getRepository(User)
      .findOne({ where: { id: user.id } });

    log.punchTime = new Date(dto.punchTime);
    if (dto.punchType) log.punchType = dto.punchType;
    if (dto.leaveReason !== undefined) log.leaveReason = dto.leaveReason;
    log.isEdited = true;
    log.editedByUserId = user.id;
    // ⚠️ نفترض هنا أن الـ User entity فيها حقل username — تأكد من ذلك في مشروعك
    log.editedByName = editorUser?.username ?? editorUser?.email ?? undefined;
    log.editedAt = new Date();

    const saved = await this.logRepo.save(log);

    if (saved.punchType === PunchType.CHECK_OUT) {
      await this.recalculateWorkHours(saved);
    }

    if (saved.employeeId) {
      await this.notifyEmployeeAboutLog(
        saved.employeeId,
        user.tenantId,
        'تم تعديل بصمة حضور',
        `تم تعديل بصمة "${PUNCH_TYPE_LABELS_AR[saved.punchType]}" الخاصة بك إلى ${saved.punchTime.toLocaleString('ar-SA')} بواسطة ${log.editedByName ?? 'الإدارة'}`,
      );
    }

    return saved;
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

    const hoursSinceNow =
      (now.getTime() - punchTime.getTime()) / (1000 * 60 * 60);
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

    if (saved.punchType === PunchType.CHECK_OUT) {
      await this.recalculateWorkHours(saved);
    }

    await this.notifyEmployeeAboutLog(
      employee.id,
      user.tenantId,
      saved.punchType === PunchType.LEAVE
        ? 'تم تسجيل إجازة'
        : 'تم تسجيل بصمة يدوية',
      saved.punchType === PunchType.LEAVE
        ? `تم تسجيل إجازة لك بتاريخ ${saved.punchTime.toLocaleDateString('ar-SA')}${dto.leaveReason ? ` — السبب: ${dto.leaveReason}` : ''}`
        : `تم تسجيل بصمة "${PUNCH_TYPE_LABELS_AR[saved.punchType]}" يدويًا لك بتاريخ ${saved.punchTime.toLocaleString('ar-SA')}`,
    );

    return this.logRepo.findOneOrFail({
      where: { id: saved.id },
      relations: ['employee', 'device'],
    });
  }

  // ==========================================================
  // Devices Management (بدون تغيير)
  // ==========================================================

  async pushUserToDevice(
    deviceId: string,
    employeeId: string,
    user: CurrentUserData,
  ) {
    const device = await this.deviceRepo.findOne({
      where: { id: deviceId, tenantId: user.tenantId },
    });
    if (!device) throw new NotFoundException('الجهاز غير موجود');

    const employee = await this.dataSource.getRepository(Employee).findOne({
      where: { id: employeeId, tenantId: user.tenantId },
    });
    if (!employee) throw new NotFoundException('الموظف غير موجود');

    const commandContent = `DATA USER PIN=${employee.employeeCode}\tName=${employee.fullName}\tPri=0\tPass=0`;

    return await this.dataSource.getRepository(DeviceCommand).save({
      deviceId: device.id,
      command: commandContent,
      isExecuted: false,
      tenantId: user.tenantId,
    });
  }

  async createDevice(
    dto: CreateDeviceDto,
    user: CurrentUserData,
  ): Promise<BiometricDevice> {
    const device = this.deviceRepo.create({ ...dto, tenantId: user.tenantId });
    return this.deviceRepo.save(device);
  }

  async findAllDevices(user: CurrentUserData): Promise<BiometricDevice[]> {
    return this.deviceRepo.find({
      where: { tenantId: user.tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOneDevice(
    id: string,
    user: CurrentUserData,
  ): Promise<BiometricDevice> {
    const device = await this.deviceRepo.findOne({
      where: { id, tenantId: user.tenantId },
    });
    if (!device) throw new NotFoundException('الجهاز غير موجود');
    return device;
  }

  async updateDevice(
    id: string,
    dto: UpdateDeviceDto,
    user: CurrentUserData,
  ): Promise<BiometricDevice> {
    const device = await this.findOneDevice(id, user);
    Object.assign(device, dto);
    return this.deviceRepo.save(device);
  }

  async removeDevice(id: string, user: CurrentUserData): Promise<void> {
    const device = await this.findOneDevice(id, user);
    await this.deviceRepo.remove(device);
  }

  // ==========================================================
  // ✅ 7) عرض السجلات مع الفلترة (نوع البصمة / الموظف / التاريخ)
  // ==========================================================

  private buildLogsQuery(query: AttendanceQueryDto, user: CurrentUserData) {
    const qb = this.logRepo
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.employee', 'employee')
      .leftJoinAndSelect('log.device', 'device')
      .where('log.tenantId = :tenantId', { tenantId: user.tenantId });

    if (query.from && query.to) {
      qb.andWhere('log.punchTime BETWEEN :from AND :to', {
        from: new Date(query.from),
        to: new Date(query.to),
      });
    }
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
    const { page = 1, limit = 50 } = query;

    const qb = this.buildLogsQuery(query, user)
      .orderBy('log.punchTime', 'DESC')
      .take(Math.min(limit, 200))
      .skip((page - 1) * limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async findEmployeeLogs(
    employeeId: string,
    query: AttendanceQueryDto,
    user: CurrentUserData,
  ) {
    const { from, to } = query;
    const where: FindOptionsWhere<AttendanceLog> = {
      tenantId: user.tenantId,
      employeeId,
    };
    if (from && to) where.punchTime = Between(new Date(from), new Date(to));
    return this.logRepo.find({
      where,
      relations: ['device'],
      order: { punchTime: 'ASC' },
    });
  }

  // ✅ تصدير نتائج الفلترة PDF / Excel
  async exportLogs(
    query: AttendanceQueryDto,
    type: 'excel' | 'pdf',
    user: CurrentUserData,
  ): Promise<Buffer> {
    const logs = await this.buildLogsQuery(query, user)
      .orderBy('log.punchTime', 'DESC')
      .getMany();

    const columns = [
      { header: 'الموظف', key: 'employeeName' },
      { header: 'كود الموظف', key: 'employeeCode' },
      { header: 'النوع', key: 'punchTypeLabel' },
      { header: 'وقت البصمة', key: 'punchTime' },
      { header: 'ساعات العمل', key: 'workHours' },
      { header: 'ساعات إضافية', key: 'overtimeHours' },
      { header: 'سبب الإجازة', key: 'leaveReason' },
      { header: 'تم تعديلها', key: 'editedLabel' },
    ];

    const rows = logs.map((l) => ({
      employeeName: l.employee?.fullName ?? '—',
      employeeCode: l.deviceUserId,
      punchTypeLabel: PUNCH_TYPE_LABELS_AR[l.punchType] ?? l.punchType,
      punchTime: l.punchTime.toLocaleString('ar-SA'),
      workHours: l.workHours != null ? String(l.workHours) : '—',
      overtimeHours: l.overtimeHours != null ? String(l.overtimeHours) : '—',
      leaveReason: l.leaveReason ?? '—',
      editedLabel: l.isEdited ? `نعم (${l.editedByName ?? '-'})` : 'لا',
    }));

    if (type === 'excel') {
      return this.reportService.generateExcel(rows, columns);
    }
    return this.reportService.generatePdf(
      rows,
      columns,
      'تقرير سجلات الحضور والانصراف',
    );
  }

  // ==========================================================
  // ملخصات الحضور اليومية والشهرية (مع دعم الإجازة الآن)
  // ==========================================================

  async getDailySummary(dateStr: string, user: CurrentUserData) {
    const targetDate = new Date(dateStr);
    targetDate.setHours(0, 0, 0, 0);

    const queryStart = new Date(targetDate);
    queryStart.setHours(queryStart.getHours() - 6);
    const queryEnd = new Date(targetDate);
    queryEnd.setDate(queryEnd.getDate() + 1);
    queryEnd.setHours(queryEnd.getHours() + 6);

    const logs = await this.logRepo.find({
      where: {
        tenantId: user.tenantId,
        punchTime: Between(queryStart, queryEnd),
      },
      relations: ['employee', 'employee.shift'],
      order: { punchTime: 'ASC' },
    });

    const grouped = new Map<string, AttendanceLog[]>();
    for (const log of logs) {
      const key = log.employeeId ?? log.deviceUserId;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(log);
    }

    const results: Array<{
      employeeId: string | undefined;
      employeeCode: string;
      employeeName: string | undefined;
      shiftName: string | undefined;
      firstPunch: Date;
      lastPunch: Date;
      totalMinutes: number;
      lateMinutes: number;
      earlyLeaveMinutes: number;
      status: AttendanceStatus;
      leaveReason?: string;
      logs: AttendanceLog[];
    }> = [];

    for (const employeeLogs of grouped.values()) {
      const shift = employeeLogs[0].employee?.shift;
      const { start, end } = this.getShiftDayRange(targetDate, shift);

      const dayLogs = employeeLogs
        .filter((l) => l.punchTime >= start && l.punchTime <= end)
        .sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());

      if (dayLogs.length === 0) continue;

      const leaveLog = dayLogs.find((l) => l.punchType === PunchType.LEAVE);
      if (leaveLog) {
        results.push({
          employeeId: leaveLog.employeeId,
          employeeCode: leaveLog.deviceUserId,
          employeeName: leaveLog.employee?.fullName,
          shiftName: shift?.name,
          firstPunch: leaveLog.punchTime,
          lastPunch: leaveLog.punchTime,
          totalMinutes: 0,
          lateMinutes: 0,
          earlyLeaveMinutes: 0,
          status: 'on_leave',
          leaveReason: leaveLog.leaveReason,
          logs: dayLogs,
        });
        continue;
      }

      const first = dayLogs[0];
      const last = dayLogs[dayLogs.length - 1];
      const totalMinutes = Math.round(
        (last.punchTime.getTime() - first.punchTime.getTime()) / 60000,
      );

      let evaluation: AttendanceEvaluation = {
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        status: 'unclassified',
      };
      if (shift) {
        evaluation =
          dayLogs.length < 2
            ? { lateMinutes: 0, earlyLeaveMinutes: 0, status: 'incomplete' }
            : this.evaluateAttendanceStatus(
                first.punchTime,
                last.punchTime,
                shift,
              );
      }

      results.push({
        employeeId: first.employeeId,
        employeeCode: first.deviceUserId,
        employeeName: first.employee?.fullName,
        shiftName: shift?.name,
        firstPunch: first.punchTime,
        lastPunch: last.punchTime,
        totalMinutes,
        lateMinutes: evaluation.lateMinutes,
        earlyLeaveMinutes: evaluation.earlyLeaveMinutes,
        status: evaluation.status,
        logs: dayLogs,
      });
    }

    return results;
  }

  async getMonthlyReport(
    employeeId: string,
    month: number,
    year: number,
    user: CurrentUserData,
  ) {
    const monthStart = new Date(year, month - 1, 1, 0, 0, 0);
    monthStart.setHours(monthStart.getHours() - 12);
    const monthEnd = new Date(year, month, 0, 23, 59, 59);
    monthEnd.setHours(monthEnd.getHours() + 12);

    const logs = await this.logRepo.find({
      where: {
        tenantId: user.tenantId,
        employeeId,
        punchTime: Between(monthStart, monthEnd),
      },
      relations: ['employee', 'employee.shift'],
      order: { punchTime: 'ASC' },
    });

    const shift = logs[0]?.employee?.shift;
    const daysInMonth = new Date(year, month, 0).getDate();

    const dailyBreakdown: Array<{
      date: string;
      checkIn: Date | null;
      checkOut: Date | null;
      minutes: number;
      lateMinutes: number;
      earlyLeaveMinutes: number;
      status: AttendanceStatus;
      leaveReason?: string;
      workHours?: number;
      overtimeHours?: number;
    }> = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const day = new Date(year, month - 1, d, 0, 0, 0);
      const { start, end } = this.getShiftDayRange(day, shift);
      const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

      const dayLogs = logs
        .filter((l) => l.punchTime >= start && l.punchTime <= end)
        .sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());

      if (dayLogs.length === 0) {
        dailyBreakdown.push({
          date: dateKey,
          checkIn: null,
          checkOut: null,
          minutes: 0,
          lateMinutes: 0,
          earlyLeaveMinutes: 0,
          status: 'absent',
        });
        continue;
      }

      const leaveLog = dayLogs.find((l) => l.punchType === PunchType.LEAVE);
      if (leaveLog) {
        dailyBreakdown.push({
          date: dateKey,
          checkIn: null,
          checkOut: null,
          minutes: 0,
          lateMinutes: 0,
          earlyLeaveMinutes: 0,
          status: 'on_leave',
          leaveReason: leaveLog.leaveReason,
        });
        continue;
      }

      const checkInLog = dayLogs[0];
      const checkOutLog = dayLogs[dayLogs.length - 1];
      const minutes = Math.round(
        (checkOutLog.punchTime.getTime() - checkInLog.punchTime.getTime()) /
          60000,
      );

      let evaluation: AttendanceEvaluation = {
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        status: 'unclassified',
      };
      if (shift) {
        evaluation =
          dayLogs.length < 2
            ? { lateMinutes: 0, earlyLeaveMinutes: 0, status: 'incomplete' }
            : this.evaluateAttendanceStatus(
                checkInLog.punchTime,
                checkOutLog.punchTime,
                shift,
              );
      }

      dailyBreakdown.push({
        date: dateKey,
        checkIn: checkInLog.punchTime,
        checkOut: checkOutLog.punchTime,
        minutes,
        lateMinutes: evaluation.lateMinutes,
        earlyLeaveMinutes: evaluation.earlyLeaveMinutes,
        status: evaluation.status,
        workHours: checkOutLog.workHours,
        overtimeHours: checkOutLog.overtimeHours,
      });
    }

    const presentDays = dailyBreakdown.filter((d) => d.checkIn !== null).length;
    const leaveDays = dailyBreakdown.filter(
      (d) => d.status === 'on_leave',
    ).length;

    return {
      employeeId,
      month,
      year,
      shiftName: shift?.name,
      totalDays: daysInMonth,
      presentDays,
      leaveDays,
      absentDays: daysInMonth - presentDays - leaveDays,
      totalMinutes: dailyBreakdown.reduce((s, d) => s + d.minutes, 0),
      totalLateMinutes: dailyBreakdown.reduce((s, d) => s + d.lateMinutes, 0),
      totalEarlyLeaveMinutes: dailyBreakdown.reduce(
        (s, d) => s + d.earlyLeaveMinutes,
        0,
      ),
      totalWorkHours: dailyBreakdown.reduce(
        (s, d) => s + (d.workHours ?? 0),
        0,
      ),
      totalOvertimeHours: dailyBreakdown.reduce(
        (s, d) => s + (d.overtimeHours ?? 0),
        0,
      ),
      dailyBreakdown,
    };
  }
}
