import { Injectable, NotFoundException, Inject, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, FindOptionsWhere, DataSource } from 'typeorm';
import { Request } from 'express';
import { BiometricDevice } from './entities/biometric-device.entity';
import { AttendanceLog, PunchType } from './entities/attendance-log.entity';
import { DeviceCommand } from './entities/device-command.entity'; // تأكد من استيراد الـ Entity الجديد
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { AttendanceQueryDto } from './dto/attendance-query.dto';

interface RequestWithUser extends Request {
  user?: { tenantId?: string; isSystemAdmin?: boolean };
}

@Injectable({ scope: Scope.REQUEST })
export class AttendanceService {
  constructor(
    @InjectRepository(BiometricDevice)
    private readonly deviceRepo: Repository<BiometricDevice>,
    @InjectRepository(AttendanceLog)
    private readonly logRepo: Repository<AttendanceLog>,
    @Inject(REQUEST)
    private readonly request: RequestWithUser,
    private readonly dataSource: DataSource, // تم حقن الـ DataSource هنا
  ) {}

  private getTenantId(): string {
    const tid = this.request.user?.tenantId;
    if (!tid) throw new NotFoundException('سياق الشركة غير موجود');
    return tid;
  }

  // ──────────────────── إضافة موظف للجهاز ────────────────────

  async pushUserToDevice(
    deviceId: string,
    employeeData: { pin: string; name: string },
  ) {
    const tenantId = this.getTenantId();

    const device = await this.deviceRepo.findOne({
      where: { id: deviceId, tenantId },
    });
    if (!device)
      throw new NotFoundException(
        'الجهاز غير موجود أو لا تملك صلاحية الوصول إليه',
      );

    const commandContent = `DATA USER PIN=${employeeData.pin}\tName=${employeeData.name}\tPri=0\tPass=0`;

    return await this.dataSource.getRepository(DeviceCommand).save({
      deviceId: device.id,
      command: commandContent,
      isExecuted: false,
      tenantId: tenantId,
    });
  }

  // ──────────────────── الأجهزة ────────────────────

  async createDevice(dto: CreateDeviceDto): Promise<BiometricDevice> {
    const tenantId = this.getTenantId();
    const device = this.deviceRepo.create({ ...dto, tenantId });
    return this.deviceRepo.save(device);
  }

  async findAllDevices(): Promise<BiometricDevice[]> {
    const tenantId = this.getTenantId();
    return this.deviceRepo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOneDevice(id: string): Promise<BiometricDevice> {
    const tenantId = this.getTenantId();
    const device = await this.deviceRepo.findOne({ where: { id, tenantId } });
    if (!device) throw new NotFoundException('الجهاز غير موجود');
    return device;
  }

  async updateDevice(
    id: string,
    dto: UpdateDeviceDto,
  ): Promise<BiometricDevice> {
    const device = await this.findOneDevice(id);
    Object.assign(device, dto);
    return this.deviceRepo.save(device);
  }

  async removeDevice(id: string): Promise<void> {
    const device = await this.findOneDevice(id);
    await this.deviceRepo.remove(device);
  }

  // ──────────────────── سجلات الحضور ────────────────────

  async findLogs(
    query: AttendanceQueryDto,
  ): Promise<{ data: AttendanceLog[]; total: number }> {
    const tenantId = this.getTenantId();
    const { from, to, page = 1, limit = 50 } = query;
    const where: FindOptionsWhere<AttendanceLog> = { tenantId };

    if (from && to) {
      where.punchTime = Between(new Date(from), new Date(to));
    }

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
  ): Promise<AttendanceLog[]> {
    const tenantId = this.getTenantId();
    const { from, to } = query;
    const where: FindOptionsWhere<AttendanceLog> = { tenantId, employeeId };

    if (from && to) {
      where.punchTime = Between(new Date(from), new Date(to));
    }

    return this.logRepo.find({
      where,
      relations: ['device'],
      order: { punchTime: 'ASC' },
    });
  }

  async getDailySummary(dateStr: string) {
    const tenantId = this.getTenantId();
    const date = new Date(dateStr);
    const dayStart = new Date(date.setHours(0, 0, 0, 0));
    const dayEnd = new Date(date.setHours(23, 59, 59, 999));

    const logs = await this.logRepo.find({
      where: { tenantId, punchTime: Between(dayStart, dayEnd) },
      relations: ['employee'],
      order: { punchTime: 'ASC' },
    });

    const grouped = new Map<string, AttendanceLog[]>();
    for (const log of logs) {
      const key = log.employeeId ?? log.deviceUserId;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(log);
    }

    return Array.from(grouped.entries()).map(([, employeeLogs]) => {
      const first = employeeLogs[0];
      const last = employeeLogs[employeeLogs.length - 1];
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
        logs: employeeLogs,
      };
    });
  }

  async getMonthlyReport(employeeId: string, month: number, year: number) {
    const tenantId = this.getTenantId();
    const monthStart = new Date(year, month - 1, 1, 0, 0, 0);
    const monthEnd = new Date(year, month, 0, 23, 59, 59);

    const logs = await this.logRepo.find({
      where: { tenantId, employeeId, punchTime: Between(monthStart, monthEnd) },
      order: { punchTime: 'ASC' },
    });

    const dailyMap = new Map<
      string,
      { checkIn: Date | null; checkOut: Date | null }
    >();

    for (const log of logs) {
      const dayKey = log.punchTime.toISOString().split('T')[0];
      if (!dailyMap.has(dayKey))
        dailyMap.set(dayKey, { checkIn: null, checkOut: null });
      const day = dailyMap.get(dayKey)!;

      if (log.punchType === PunchType.CHECK_IN && !day.checkIn)
        day.checkIn = log.punchTime;
      else if (log.punchType === PunchType.CHECK_OUT)
        day.checkOut = log.punchTime;
    }

    const dailyBreakdown = Array.from(dailyMap.entries()).map(
      ([date, { checkIn, checkOut }]) => {
        const minutes =
          checkIn && checkOut
            ? Math.round((checkOut.getTime() - checkIn.getTime()) / 60000)
            : 0;
        return { date, checkIn, checkOut, minutes };
      },
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
