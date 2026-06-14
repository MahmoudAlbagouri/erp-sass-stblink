import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, FindOptionsWhere, DataSource } from 'typeorm';
import { BiometricDevice } from './entities/biometric-device.entity';
import { AttendanceLog, PunchType } from './entities/attendance-log.entity';
import { DeviceCommand } from './entities/device-command.entity';
import { Shift } from './entities/shift.entity'; // تأكد من وجود الـ Entity
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { AttendanceQueryDto } from './dto/attendance-query.dto';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';

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

  // منطق تصنيف البصمة (Rules Engine)
  private classifyPunch(punchTime: Date, shift: Shift): PunchType {
    const time = punchTime.getHours() * 60 + punchTime.getMinutes();
    const start =
      parseInt(shift.startTime.split(':')[0]) * 60 +
      parseInt(shift.startTime.split(':')[1]);
    const end =
      parseInt(shift.endTime.split(':')[0]) * 60 +
      parseInt(shift.endTime.split(':')[1]);
    const grace = shift.gracePeriod || 30;

    if (Math.abs(time - start) <= grace) return PunchType.CHECK_IN;
    if (Math.abs(time - end) <= grace) return PunchType.CHECK_OUT;

    return time < (start + end) / 2 ? PunchType.CHECK_IN : PunchType.CHECK_OUT;
  }

  async pushUserToDevice(
    deviceId: string,
    employeeData: { pin: string; name: string },
    user: CurrentUserData,
  ) {
    const device = await this.deviceRepo.findOne({
      where: { id: deviceId, tenantId: user.tenantId },
    });
    if (!device) throw new NotFoundException('الجهاز غير موجود');
    const commandContent = `DATA USER PIN=${employeeData.pin}\tName=${employeeData.name}\tPri=0\tPass=0`;
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
    const date = new Date(dateStr);
    const dayStart = new Date(date.setHours(0, 0, 0, 0));
    const dayEnd = new Date(date.setHours(23, 59, 59, 999));

    const logs = await this.logRepo.find({
      where: { tenantId: user.tenantId, punchTime: Between(dayStart, dayEnd) },
      relations: ['employee', 'employee.shift'],
      order: { punchTime: 'ASC' },
    });

    const grouped = new Map<string, AttendanceLog[]>();
    for (const log of logs) {
      const key = log.employeeId ?? log.deviceUserId;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(log);
    }

    return Array.from(grouped.entries()).map(([, employeeLogs]) => {
      const shift = employeeLogs[0].employee?.shift;
      // تطبيق المنطق الذكي على السجلات
      const logsWithLogic = employeeLogs.map((l) => ({
        ...l,
        punchType: shift ? this.classifyPunch(l.punchTime, shift) : l.punchType,
      }));

      const first = logsWithLogic[0];
      const last = logsWithLogic[logsWithLogic.length - 1];
      const totalMinutes = Math.round(
        (last.punchTime.getTime() - first.punchTime.getTime()) / 60000,
      );

      return {
        employeeId: first.employeeId,
        employeeCode: first.deviceUserId,
        employeeName: first.employee?.fullName,
        firstPunch: first.punchTime,
        lastPunch: last.punchTime,
        totalMinutes,
        logs: logsWithLogic,
      };
    });
  }

  async getMonthlyReport(
    employeeId: string,
    month: number,
    year: number,
    user: CurrentUserData,
  ) {
    const monthStart = new Date(year, month - 1, 1, 0, 0, 0);
    const monthEnd = new Date(year, month, 0, 23, 59, 59);

    const logs = await this.logRepo.find({
      where: {
        tenantId: user.tenantId,
        employeeId,
        punchTime: Between(monthStart, monthEnd),
      },
      relations: ['employee', 'employee.shift'],
      order: { punchTime: 'ASC' },
    });

    const dailyMap = new Map<
      string,
      { checkIn: Date | null; checkOut: Date | null }
    >();
    for (const log of logs) {
      const shift = log.employee?.shift;
      const type = shift
        ? this.classifyPunch(log.punchTime, shift)
        : log.punchType;

      const dayKey = log.punchTime.toISOString().split('T')[0];
      if (!dailyMap.has(dayKey))
        dailyMap.set(dayKey, { checkIn: null, checkOut: null });

      const day = dailyMap.get(dayKey)!;
      if (type === PunchType.CHECK_IN && !day.checkIn)
        day.checkIn = log.punchTime;
      else if (type === PunchType.CHECK_OUT) day.checkOut = log.punchTime;
    }

    const dailyBreakdown = Array.from(dailyMap.entries()).map(
      ([date, { checkIn, checkOut }]) => ({
        date,
        checkIn,
        checkOut,
        minutes:
          checkIn && checkOut
            ? Math.round((checkOut.getTime() - checkIn.getTime()) / 60000)
            : 0,
      }),
    );

    return {
      employeeId,
      month,
      year,
      totalDays: dailyMap.size,
      presentDays: dailyBreakdown.filter((d) => d.checkIn !== null).length,
      totalMinutes: dailyBreakdown.reduce((s, d) => s + d.minutes, 0),
      dailyBreakdown,
    };
  }
}
