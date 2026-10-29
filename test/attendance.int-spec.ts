import { DataSource } from 'typeorm';
import { AdmsService } from '../src/modules/attendance/adms.service';
import { AttendanceService } from '../src/modules/attendance/attendance.service';
import {
  AttendanceLog,
  PunchType,
} from '../src/modules/attendance/entities/attendance-log.entity';
import {
  BiometricDevice,
  DeviceStatus,
} from '../src/modules/attendance/entities/biometric-device.entity';
import { DeviceCommand } from '../src/modules/attendance/entities/device-command.entity';
import { Employee } from '../src/modules/employees/entities/employee.entity';
import type { DomainEvents } from '../src/common/events/domain-events';
import { Shift } from '../src/modules/shifts/entities/shift.entity';
import { Tenant } from '../src/modules/tenants/entities/tenant.entity';
import type { CurrentUserData } from '../src/common/decorators/current-user.decorator';
import type { ReportService } from '../src/common/reports/report.service';
import { createTestDataSource, truncateAllTables } from './utils/test-database';

describe('attendance module', () => {
  let dataSource: DataSource;
  let attendance: AttendanceService;
  let adms: AdmsService;

  let riyadh: Tenant;
  let cairo: Tenant;
  let user: CurrentUserData;

  const SN = 'RYD0001';
  const CAIRO_SN = 'CAI0001';

  const asUser = (tenant: Tenant): CurrentUserData => ({
    id: '00000000-0000-4000-8000-000000000001',
    tenantId: tenant.id,
    isSuperAdmin: true,
    isSystemAdmin: false,
  });

  const addEmployee = (
    tenant: Tenant,
    employeeCode: string,
    fullName: string,
    shift?: Shift,
  ) =>
    dataSource.getRepository(Employee).save({
      tenantId: tenant.id,
      employeeCode,
      fullName,
      shiftId: shift?.id,
    });

  const addShift = (startTime: string, endTime: string, gracePeriod = 15) =>
    dataSource.getRepository(Shift).save({
      tenantId: riyadh.id,
      name: `${startTime}-${endTime}`,
      startTime,
      endTime,
      gracePeriod,
    });

  /** سطر كما يرسله الجهاز: الوقت بساعته المحلية بلا منطقة */
  const punch = (pin: string, time: string, status: 0 | 1) =>
    `${pin}\t${time}\t${status}\t1\t0\t0`;

  const logsOf = (tenant: Tenant) =>
    dataSource.getRepository(AttendanceLog).find({
      where: { tenantId: tenant.id },
      order: { punchTime: 'ASC' },
    });

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    attendance = new AttendanceService(
      dataSource.getRepository(BiometricDevice),
      dataSource.getRepository(AttendanceLog),
      dataSource,
      {} as ReportService,
      { emit: jest.fn() } as unknown as DomainEvents,
    );
    adms = new AdmsService(
      dataSource.getRepository(BiometricDevice),
      dataSource,
      attendance,
    );
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    const tenants = dataSource.getRepository(Tenant);
    riyadh = await tenants.save({
      companyName: 'شركة الرياض',
      country: 'SA',
      currency: 'SAR',
      timezone: 'Asia/Riyadh',
    });
    cairo = await tenants.save({
      companyName: 'شركة القاهرة',
      country: 'EG',
      currency: 'EGP',
      timezone: 'Africa/Cairo',
    });
    user = asUser(riyadh);

    await attendance.createDevice({ serialNumber: SN }, user);
    await attendance.createDevice({ serialNumber: CAIRO_SN }, asUser(cairo));
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  describe('device handshake', () => {
    it('tells the device its timezone and where to resume uploading', async () => {
      const options = await adms.handleDeviceInit(SN, { ip: '10.0.0.5' });

      expect(options).toContain(`GET OPTION FROM: ${SN}`);
      expect(options).toContain('TimeZone=3');
      expect(options).toContain('ATTLOGStamp=0');
      expect(options).toContain('Realtime=1');
    });

    it('follows daylight saving time of the device country', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      try {
        jest.setSystemTime(new Date('2026-01-15T10:00:00Z'));
        expect(await adms.handleDeviceInit(CAIRO_SN)).toContain('TimeZone=2');
        jest.setSystemTime(new Date('2026-07-15T10:00:00Z'));
        expect(await adms.handleDeviceInit(CAIRO_SN)).toContain('TimeZone=3');
      } finally {
        jest.useRealTimers();
      }
    });

    it('uses the device timezone when one is set on it', async () => {
      const [device] = await attendance.findAllDevices(user);
      await attendance.updateDevice(
        device.id,
        { timezone: 'Asia/Dubai' },
        user,
      );

      expect(await adms.handleDeviceInit(SN)).toContain('TimeZone=4');
    });

    it('rejects unknown and disabled devices', async () => {
      expect(await adms.handleDeviceInit('UNKNOWN')).toBeNull();

      const [device] = await attendance.findAllDevices(user);
      await attendance.updateDevice(
        device.id,
        { status: DeviceStatus.DISABLED },
        user,
      );

      expect(await adms.handleDeviceInit(SN)).toBeNull();
      expect(
        await adms.processAttendanceLogs(
          SN,
          punch('1', '2026-01-12 08:00:00', 0),
        ),
      ).toBeNull();
      expect(await logsOf(riyadh)).toHaveLength(0);
    });
  });

  describe('receiving punches', () => {
    it('stores each punch as the real instant in the device timezone', async () => {
      const line = punch('1001', '2026-01-12 09:10:00', 0);

      await adms.processAttendanceLogs(SN, line);
      await adms.processAttendanceLogs(CAIRO_SN, line);

      // نفس الساعة على الجهازين: الرياض UTC+3، القاهرة شتاءً UTC+2
      expect((await logsOf(riyadh))[0].punchTime.toISOString()).toBe(
        '2026-01-12T06:10:00.000Z',
      );
      expect((await logsOf(cairo))[0].punchTime.toISOString()).toBe(
        '2026-01-12T07:10:00.000Z',
      );
    });

    it('links punches to employees by PIN within the device tenant only', async () => {
      const mine = await addEmployee(riyadh, '1001', 'سالم');
      await addEmployee(cairo, '1002', 'موظف شركة أخرى');

      await adms.processAttendanceLogs(
        SN,
        [
          punch('1001', '2026-01-12 08:00:00', 0),
          punch('1002', '2026-01-12 08:01:00', 0),
        ].join('\n'),
      );

      const [first, second] = await logsOf(riyadh);
      expect(first.employeeId).toBe(mine.id);
      expect(second.employeeId).toBeNull();
      expect(second.deviceUserId).toBe('1002');
    });

    it('never stores the same punch twice', async () => {
      const batch = [
        punch('1001', '2026-01-12 08:00:00', 0),
        punch('1001', '2026-01-12 08:00:00', 0), // مكرر داخل الدفعة
        punch('1001', '2026-01-12 16:00:00', 1),
      ].join('\r\n');

      expect(await adms.processAttendanceLogs(SN, batch, '25')).toBe(2);
      // الجهاز يعيد رفع الدفعة بعد انقطاع
      expect(await adms.processAttendanceLogs(SN, batch, '25')).toBe(0);
      // دفعتان متزامنتان (رفع فوري + مجدول)
      const again = punch('1001', '2026-01-13 08:00:00', 0);
      const counts = await Promise.all([
        adms.processAttendanceLogs(SN, again),
        adms.processAttendanceLogs(SN, again),
      ]);

      expect(counts.sort()).toEqual([0, 1]);
      expect(await logsOf(riyadh)).toHaveLength(3);
      expect(await adms.handleDeviceInit(SN)).toContain('ATTLOGStamp=25');
    });

    it('skips malformed lines without losing the rest of the batch', async () => {
      const batch = [
        'garbage',
        punch('1001', 'not-a-date', 0),
        punch('1001', '2026-01-12 08:00:00', 0),
      ].join('\n');

      expect(await adms.processAttendanceLogs(SN, batch)).toBe(1);
    });

    it('computes work and overtime hours on the check-out', async () => {
      const shift = await addShift('08:00', '16:00');
      await addEmployee(riyadh, '1001', 'سالم', shift);

      // الانصراف يصل قبل الحضور (ترتيب الرفع غير مضمون)
      await adms.processAttendanceLogs(
        SN,
        punch('1001', '2026-01-12 17:30:00', 1),
      );
      await adms.processAttendanceLogs(
        SN,
        punch('1001', '2026-01-12 08:00:00', 0),
      );

      const checkOut = (await logsOf(riyadh)).find(
        (l) => l.punchType === PunchType.CHECK_OUT,
      )!;
      expect(Number(checkOut.workHours)).toBe(9.5);
      expect(Number(checkOut.overtimeHours)).toBe(1.5);
    });
  });

  describe('device commands', () => {
    it('queues a command once and marks it done when the device confirms', async () => {
      const [device] = await attendance.findAllDevices(user);
      const employee = await addEmployee(riyadh, '1001', 'سالم\tبن\nأحمد');

      const queued = await attendance.pushUserToDevice(
        device.id,
        employee.id,
        user,
      );
      const repeated = await attendance.pushUserToDevice(
        device.id,
        employee.id,
        user,
      );
      expect(repeated.id).toBe(queued.id);

      const sent = await adms.getPendingCommand(SN);
      // tab و newline داخل الاسم كانا سيكسران صيغة الأمر
      expect(sent).toBe(
        `C:${queued.id}:DATA USER PIN=1001\tName=سالم بن أحمد\tPri=0\tPass=0`,
      );

      // جهاز آخر لا يؤكد أمراً لا يخصه
      expect(
        await adms.confirmCommands(
          CAIRO_SN,
          `ID=${queued.id}&Return=0&CMD=DATA`,
        ),
      ).toBe(0);
      expect(
        await adms.confirmCommands(SN, `ID=${queued.id}&Return=0&CMD=DATA\n`),
      ).toBe(1);

      const stored = await dataSource
        .getRepository(DeviceCommand)
        .findOneByOrFail({ id: queued.id });
      expect(stored).toMatchObject({ isExecuted: true, returnCode: 0 });
      expect(await adms.getPendingCommand(SN)).toBeNull();
    });
  });

  describe('devices', () => {
    it('refuses a serial number that is already registered', async () => {
      await expect(
        attendance.createDevice({ serialNumber: ` ${SN} ` }, asUser(cairo)),
      ).rejects.toThrow(/مسجّل بالفعل/);
    });

    it('reports a device online only while it keeps calling in', async () => {
      const statusNow = async () =>
        (await attendance.findAllDevices(user))[0].status;

      expect(await statusNow()).toBe(DeviceStatus.OFFLINE);

      await adms.getPendingCommand(SN);
      expect(await statusNow()).toBe(DeviceStatus.ONLINE);

      await dataSource
        .getRepository(BiometricDevice)
        .update(
          { serialNumber: SN },
          { lastSeenAt: new Date(Date.now() - 10 * 60 * 1000) },
        );
      expect(await statusNow()).toBe(DeviceStatus.OFFLINE);
    });
  });

  describe('logs and summaries', () => {
    it('treats date-only filters as whole days in the tenant timezone', async () => {
      await adms.processAttendanceLogs(
        SN,
        [
          punch('1001', '2026-01-11 23:50:00', 1),
          punch('1001', '2026-01-12 00:10:00', 0), // 21:10 UTC يوم 11
          punch('1001', '2026-01-12 23:40:00', 1),
          punch('1001', '2026-01-13 00:05:00', 0),
        ].join('\n'),
      );

      const { data, total } = await attendance.findLogs(
        { from: '2026-01-12', to: '2026-01-12' },
        user,
      );

      expect(total).toBe(2);
      expect(data.map((l) => l.punchTime.toISOString())).toEqual([
        '2026-01-12T20:40:00.000Z',
        '2026-01-11T21:10:00.000Z',
      ]);
    });

    it('evaluates lateness against the shift in local time and lists absentees', async () => {
      const shift = await addShift('08:00', '16:00', 15);
      await addEmployee(riyadh, '1001', 'أحمد', shift);
      await addEmployee(riyadh, '1002', 'بدر', shift);
      await addEmployee(riyadh, '1003', 'جمال', shift);

      await adms.processAttendanceLogs(
        SN,
        [
          // أحمد: تأخر 40 دقيقة وانصرف بعد الدوام
          punch('1001', '2026-01-12 08:40:00', 0),
          punch('1001', '2026-01-12 18:00:00', 1),
          // بدر: في موعده (ضمن السماحية) وانصرف مبكراً ساعة
          punch('1002', '2026-01-12 08:10:00', 0),
          punch('1002', '2026-01-12 15:00:00', 1),
        ].join('\n'),
      );

      const rows = await attendance.getDailySummary('2026-01-12', user);
      const byName = new Map(rows.map((r) => [r.employeeName, r]));

      expect(byName.get('أحمد')).toMatchObject({
        status: 'late',
        lateMinutes: 40,
        earlyLeaveMinutes: 0,
        totalMinutes: 560,
      });
      expect(byName.get('بدر')).toMatchObject({
        status: 'early_leave',
        lateMinutes: 0,
        earlyLeaveMinutes: 60,
      });
      expect(byName.get('جمال')).toMatchObject({
        status: 'absent',
        firstPunch: null,
      });
    });

    it('keeps an overnight shift in the day it started', async () => {
      const night = await addShift('22:00', '06:00', 15);
      await addEmployee(riyadh, '2001', 'حارس', night);

      await adms.processAttendanceLogs(
        SN,
        [
          punch('2001', '2026-01-12 21:55:00', 0),
          punch('2001', '2026-01-13 06:05:00', 1),
        ].join('\n'),
      );

      const [monday] = await attendance.getDailySummary('2026-01-12', user);
      const [tuesday] = await attendance.getDailySummary('2026-01-13', user);

      expect(monday).toMatchObject({ status: 'present', totalMinutes: 490 });
      expect(tuesday).toMatchObject({ status: 'absent' });
    });

    it('builds a monthly report by local days', async () => {
      const shift = await addShift('08:00', '16:00', 15);
      const employee = await addEmployee(riyadh, '1001', 'أحمد', shift);

      await adms.processAttendanceLogs(
        SN,
        [
          punch('1001', '2026-01-05 08:00:00', 0),
          punch('1001', '2026-01-05 16:00:00', 1),
          punch('1001', '2026-01-06 09:00:00', 0),
          punch('1001', '2026-01-06 16:00:00', 1),
        ].join('\n'),
      );

      const report = await attendance.getMonthlyReport(
        employee.id,
        1,
        2026,
        user,
      );

      expect(report).toMatchObject({
        totalDays: 31,
        elapsedDays: 31,
        presentDays: 2,
        absentDays: 29,
        totalLateMinutes: 60,
        totalWorkHours: 15,
      });
      expect(report.dailyBreakdown[4]).toMatchObject({
        date: '2026-01-05',
        status: 'present',
        workHours: 8,
      });
      expect(report.dailyBreakdown[5]).toMatchObject({
        date: '2026-01-06',
        status: 'late',
        lateMinutes: 60,
      });
    });

    it('rejects an invalid month', async () => {
      const employee = await addEmployee(riyadh, '1001', 'أحمد');
      await expect(
        attendance.getMonthlyReport(employee.id, 13, 2026, user),
      ).rejects.toThrow(/غير صالحين/);
    });
  });
});
