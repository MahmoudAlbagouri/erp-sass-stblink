import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, FindOptionsWhere, DataSource } from 'typeorm';
import { BiometricDevice } from './entities/biometric-device.entity';
import { AttendanceLog } from './entities/attendance-log.entity';
import { DeviceCommand } from './entities/device-command.entity';
import { Shift } from '../shifts/entities/shift.entity';
import {
  getShiftWindow,
  diffMinutesOvernightAware,
} from '../shifts/utils/shift-time.util'; // ✅ منطق حساب نافذة الشيفت (يدعم الشيفت الليلي)
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { AttendanceQueryDto } from './dto/attendance-query.dto';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Employee } from '../employees/entities/employee.entity';

type AttendanceStatus =
  | 'present'
  | 'late'
  | 'early_leave'
  | 'late_and_early_leave'
  | 'incomplete' // بصمة واحدة بس (حضور بدون انصراف أو العكس)
  | 'absent'
  | 'unclassified'; // مفيش شيفت متعين للموظف أصلاً

interface AttendanceEvaluation {
  lateMinutes: number;
  earlyLeaveMinutes: number;
  status: AttendanceStatus;
}

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
  ) {}

  // ==========================================================
  // ✅ منطق ضبط الحضور/الانصراف حسب الشيفت (مع دعم الشيفت الليلي)
  // ==========================================================

  /**
   * يحدد بداية ونهاية "يوم الشيفت" الفعلي لتاريخ معين.
   * للشيفت العادي: من منتصف ليل اليوم لمنتصف ليل اليوم التالي (بهامش السماحية).
   * للشيفت الليلي (مثال 22:00 -> 06:00): من بداية الشيفت في نفس اليوم
   * لنهايته في اليوم التالي، عشان البصمتين (حضور وانصراف) يتحسبوا كوحدة واحدة.
   */
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

  /**
   * يقيّم بصمتي الحضور والانصراف الفعليتين مقابل الشيفت المحدد،
   * ويحسب دقائق التأخير والانصراف المبكر (بعد تجاوز فترة السماحية).
   *
   * ملحوظة: الدقائق المحسوبة هي من بداية/نهاية الشيفت مباشرة (مش من بعد
   * انتهاء السماحية) — السماحية هنا بتحدد فقط "هل يُحتسب تأخير/انصراف مبكر
   * ولا لأ". لو حابب تطرح مدة السماحية من الرقم النهائي في الرواتب، سهل
   * تعدلها هنا في مكان واحد.
   */
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

  async pushUserToDevice(
    deviceId: string,
    employeeId: string, // نمرر الـ ID فقط
    user: CurrentUserData,
  ) {
    // 1. التأكد من وجود الجهاز
    const device = await this.deviceRepo.findOne({
      where: { id: deviceId, tenantId: user.tenantId },
    });
    if (!device) throw new NotFoundException('الجهاز غير موجود');

    // 2. جلب الموظف (للتأكد من وجوده وللحصول على بياناته)
    const employee = await this.dataSource.getRepository(Employee).findOne({
      where: { id: employeeId, tenantId: user.tenantId },
    });
    if (!employee) throw new NotFoundException('الموظف غير موجود');

    // 3. بناء الأمر باستخدام بيانات الموظف الحقيقية
    const commandContent = `DATA USER PIN=${employee.employeeCode}\tName=${employee.fullName}\tPri=0\tPass=0`;

    // 4. حفظ الأمر
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

  async findLogs(query: AttendanceQueryDto, user: CurrentUserData) {
    const { from, to, page = 1, limit = 50 } = query;
    const where: FindOptionsWhere<AttendanceLog> = { tenantId: user.tenantId };
    if (from && to) where.punchTime = Between(new Date(from), new Date(to));
    const [data, total] = await this.logRepo.findAndCount({
      where,
      relations: ['employee', 'device'],
      order: { punchTime: 'DESC' },
      take: Math.min(limit, 200),
      skip: (page - 1) * limit,
    });
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

  async getDailySummary(dateStr: string, user: CurrentUserData) {
    const targetDate = new Date(dateStr);
    targetDate.setHours(0, 0, 0, 0);

    // ✅ نافذة استعلام موسّعة (±6 ساعات) عشان نضمن التقاط بصمات الشيفت الليلي
    // اللي بتمتد لليوم التالي، أو بتبدأ في آخر اليوم السابق
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
      logs: AttendanceLog[];
    }> = [];

    for (const employeeLogs of grouped.values()) {
      const shift = employeeLogs[0].employee?.shift;
      const { start, end } = this.getShiftDayRange(targetDate, shift);

      // ✅ نفلتر ونأخذ فقط البصمات الواقعة فعليًا ضمن نافذة وردية هذا اليوم
      const dayLogs = employeeLogs
        .filter((l) => l.punchTime >= start && l.punchTime <= end)
        .sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());

      if (dayLogs.length === 0) continue;

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
    // ✅ هامش 12 ساعة على أول وآخر يوم بالشهر عشان يلتقط بصمات الشيفت الليلي
    // اللي ممكن تمتد خارج حدود الشهر التقويمي
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

      const checkIn = dayLogs[0].punchTime;
      const checkOut = dayLogs[dayLogs.length - 1].punchTime;
      const minutes = Math.round(
        (checkOut.getTime() - checkIn.getTime()) / 60000,
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
            : this.evaluateAttendanceStatus(checkIn, checkOut, shift);
      }

      dailyBreakdown.push({
        date: dateKey,
        checkIn,
        checkOut,
        minutes,
        lateMinutes: evaluation.lateMinutes,
        earlyLeaveMinutes: evaluation.earlyLeaveMinutes,
        status: evaluation.status,
      });
    }

    const presentDays = dailyBreakdown.filter((d) => d.checkIn !== null).length;

    return {
      employeeId,
      month,
      year,
      shiftName: shift?.name,
      totalDays: daysInMonth,
      presentDays,
      absentDays: daysInMonth - presentDays,
      totalMinutes: dailyBreakdown.reduce((s, d) => s + d.minutes, 0),
      totalLateMinutes: dailyBreakdown.reduce((s, d) => s + d.lateMinutes, 0),
      totalEarlyLeaveMinutes: dailyBreakdown.reduce(
        (s, d) => s + d.earlyLeaveMinutes,
        0,
      ),
      dailyBreakdown,
    };
  }
}
