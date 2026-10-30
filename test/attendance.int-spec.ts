import { DataSource } from 'typeorm';
import { Workbook } from 'exceljs';
import { AdmsService } from '../src/modules/attendance/adms.service';
import { AttendanceService } from '../src/modules/attendance/attendance.service';
import { AttendanceSettingsService } from '../src/modules/attendance/attendance-settings.service';
import { AttendanceImportService } from '../src/modules/attendance/attendance-import.service';
import { BiometricSyncService } from '../src/modules/attendance/biometric-sync.service';
import {
  collectHikvisionEvents,
  DevicePushService,
} from '../src/modules/attendance/device-push.service';
import { PunchIngestService } from '../src/modules/attendance/punch-ingest.service';
import { AttendanceSettings } from '../src/modules/attendance/entities/attendance-settings.entity';
import { PublicHoliday } from '../src/modules/attendance/entities/public-holiday.entity';
import { BiometricTemplate } from '../src/modules/attendance/entities/biometric-template.entity';
import {
  LeaveRequest,
  LeaveStatus,
  LeaveType,
} from '../src/modules/leaves/entities/leave-request.entity';
import { PayrollService } from '../src/modules/payroll/payroll.service';
import { Payroll } from '../src/modules/payroll/entities/payroll.entity';
import { PayrollItem } from '../src/modules/payroll/entities/payroll-item.entity';
import { Salary } from '../src/modules/salaries/entities/salary.entity';
import type { PushPunchesDto } from '../src/modules/attendance/dto/push-punches.dto';
import {
  AttendanceLog,
  PunchType,
} from '../src/modules/attendance/entities/attendance-log.entity';
import {
  BiometricDevice,
  DeviceProtocol,
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
  let settings: AttendanceSettingsService;
  let sync: BiometricSyncService;
  let pushes: DevicePushService;
  let imports: AttendanceImportService;
  let payroll: PayrollService;
  const events = { emit: jest.fn() };

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

  // موظفون التحقوا قبل فترات الاختبار (لا تُحسب أيام قبل التحاقهم غياباً)
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
      createdAt: new Date('2025-01-01T00:00:00Z'),
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
    const domainEvents = events as unknown as DomainEvents;
    settings = new AttendanceSettingsService(
      dataSource.getRepository(AttendanceSettings),
      dataSource.getRepository(PublicHoliday),
      dataSource,
    );
    sync = new BiometricSyncService(dataSource, settings);
    attendance = new AttendanceService(
      dataSource.getRepository(BiometricDevice),
      dataSource.getRepository(AttendanceLog),
      dataSource,
      {} as ReportService,
      domainEvents,
      settings,
      sync,
    );
    const ingest = new PunchIngestService(dataSource, domainEvents);
    adms = new AdmsService(
      dataSource.getRepository(BiometricDevice),
      dataSource,
      ingest,
      sync,
      settings,
    );
    pushes = new DevicePushService(
      dataSource.getRepository(BiometricDevice),
      dataSource,
      ingest,
    );
    imports = new AttendanceImportService(
      dataSource.getRepository(BiometricDevice),
      dataSource,
      ingest,
    );
    payroll = new PayrollService(
      dataSource.getRepository(Payroll),
      dataSource,
      domainEvents,
      attendance,
      settings,
    );
  });

  beforeEach(async () => {
    events.emit.mockClear();
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

    it('computes the day hours from first to last punch, even without a check-out state', async () => {
      const shift = await addShift('08:00', '16:00');
      await addEmployee(riyadh, '1001', 'سالم', shift);

      // جهاز بلا زر حالة: كل البصمات "حضور"، والانصراف يصل قبل الحضور
      await adms.processAttendanceLogs(
        SN,
        punch('1001', '2026-01-12 17:30:00', 0),
      );
      await adms.processAttendanceLogs(
        SN,
        punch('1001', '2026-01-12 08:00:00', 0),
      );

      const { data } = await attendance.findLogs({}, user);
      const [last, first] = data;
      expect(last.punchTime.toISOString()).toBe('2026-01-12T14:30:00.000Z');
      expect(last.workHours).toBe(9.5);
      expect(last.overtimeHours).toBe(1.5);
      expect(first.workHours).toBeNull();
    });

    it('links a device number that drops the leading zeros of the code', async () => {
      const employee = await addEmployee(riyadh, '0420001', 'سالم');

      await adms.processAttendanceLogs(
        SN,
        punch('420001', '2026-01-12 08:00:00', 0),
      );

      expect((await logsOf(riyadh))[0].employeeId).toBe(employee.id);
    });
  });

  describe('device commands', () => {
    it('queues a command once and speaks the protocol version of the device', async () => {
      const [device] = await attendance.findAllDevices(user);
      const employee = await addEmployee(riyadh, '1001', 'سالم\tبن\nأحمد');

      expect(
        await attendance.pushUserToDevice(device.id, employee.id, user),
      ).toEqual({ queued: 1 });
      await attendance.pushUserToDevice(device.id, employee.id, user);
      const queued = await dataSource.getRepository(DeviceCommand).find();
      expect(queued).toHaveLength(1);
      const [command] = queued;

      // رقم الأمر عدد صحيح، وكل أمر ينتهي بسطر جديد (الجهاز يتجاهل غير ذلك)
      expect(Number.isInteger(command.seq)).toBe(true);

      // جهاز لم يعلن إصداره (Push 1.x): الصيغة القديمة. tab و newline
      // داخل الاسم كانا سيكسران صيغة الأمر
      expect(await adms.getPendingCommand(SN)).toBe(
        `C:${command.seq}:DATA USER PIN=1001\tName=سالم بن أحمد\tPri=0\n`,
      );
      await adms.handleDeviceInit(SN, { pushVersion: '2.4.1' });
      expect(await adms.getPendingCommand(SN)).toBe(
        `C:${command.seq}:DATA UPDATE USERINFO PIN=1001\tName=سالم بن أحمد\tPri=0\n`,
      );

      // جهاز آخر لا يؤكد أمراً لا يخصه، ولا يُقبل رقم غير صحيح
      expect(
        await adms.confirmCommands(
          CAIRO_SN,
          `ID=${command.seq}&Return=0&CMD=DATA`,
        ),
      ).toBe(0);
      expect(
        await adms.confirmCommands(SN, `ID=${command.id}&Return=0&CMD=DATA`),
      ).toBe(0);
      expect(
        await adms.confirmCommands(SN, `ID=${command.seq}&Return=0&CMD=DATA\n`),
      ).toBe(1);

      const stored = await dataSource
        .getRepository(DeviceCommand)
        .findOneByOrFail({ id: command.id });
      expect(stored).toMatchObject({ isExecuted: true, returnCode: 0 });
      expect(await adms.getPendingCommand(SN)).toBeNull();
    });

    it('sends the device number of an employee enrolled before the system', async () => {
      const [device] = await attendance.findAllDevices(user);
      const employee = await addEmployee(riyadh, '1230001', 'سالم');
      await dataSource
        .getRepository(Employee)
        .update(employee.id, { attendancePin: '7' });

      await attendance.pushUserToDevice(device.id, employee.id, user);

      expect(await adms.getPendingCommand(SN)).toContain('PIN=7\tName=سالم');
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

      // يناير 2026 فيه خمس جُمَع (راحة الشركة الافتراضية في السعودية)
      expect(report).toMatchObject({
        totalDays: 31,
        elapsedDays: 31,
        offDays: 5,
        workingDays: 26,
        presentDays: 2,
        absentDays: 24,
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

  describe('company calendar', () => {
    const approveLeave = (employee: Employee, from: string, to: string) =>
      dataSource.getRepository(LeaveRequest).save({
        tenantId: riyadh.id,
        employeeId: employee.id,
        startDate: from as unknown as Date,
        endDate: to as unknown as Date,
        type: LeaveType.ANNUAL,
        status: LeaveStatus.APPROVED,
      });

    it('does not count rest days, holidays and approved leaves as absence', async () => {
      const shift = await addShift('08:00', '16:00', 15);
      const onLeave = await addEmployee(riyadh, '1001', 'أحمد', shift);
      await addEmployee(riyadh, '1002', 'بدر', shift);
      await approveLeave(onLeave, '2026-01-13', '2026-01-14');
      await settings.createHoliday(riyadh.id, {
        name: 'يوم التأسيس',
        startDate: '2026-01-15',
      });

      const statusOf = async (day: string) =>
        new Map(
          (await attendance.getDailySummary(day, user)).map((r) => [
            r.employeeName,
            r,
          ]),
        );

      // الثلاثاء: أحمد في إجازة معتمدة، بدر غائب
      const tuesday = await statusOf('2026-01-13');
      expect(tuesday.get('أحمد')).toMatchObject({
        status: 'on_leave',
        leaveReason: 'إجازة سنوية',
      });
      expect(tuesday.get('بدر')?.status).toBe('absent');
      // الخميس عطلة رسمية، والجمعة راحة أسبوعية
      expect((await statusOf('2026-01-15')).get('بدر')).toMatchObject({
        status: 'holiday',
        holidayName: 'يوم التأسيس',
      });
      expect((await statusOf('2026-01-16')).get('بدر')?.status).toBe('off_day');
    });

    it('counts work on a rest day as overtime, and follows the shift own rest days', async () => {
      const shift = await addShift('08:00', '16:00', 15);
      const guards = await dataSource.getRepository(Shift).save({
        tenantId: riyadh.id,
        name: 'حراسة',
        startTime: '08:00',
        endTime: '16:00',
        gracePeriod: 15,
        offDays: [],
      });
      await addEmployee(riyadh, '1001', 'أحمد', shift);
      await addEmployee(riyadh, '1002', 'حارس', guards);

      await adms.processAttendanceLogs(
        SN,
        [
          punch('1001', '2026-01-16 09:00:00', 0),
          punch('1001', '2026-01-16 12:00:00', 0),
        ].join('\n'),
      );

      const friday = new Map(
        (await attendance.getDailySummary('2026-01-16', user)).map((r) => [
          r.employeeName,
          r,
        ]),
      );
      expect(friday.get('أحمد')).toMatchObject({
        status: 'present',
        lateMinutes: 0,
        overtimeMinutes: 180,
      });
      // ورديته تعمل كل الأسبوع: الجمعة يوم عمل عادي
      expect(friday.get('حارس')?.status).toBe('absent');
    });

    it('uses the company rest days, and validates holidays', async () => {
      await settings.updatePolicy(riyadh.id, { weeklyOffDays: [5, 6] });
      const shift = await addShift('08:00', '16:00', 15);
      await addEmployee(riyadh, '1001', 'أحمد', shift);

      expect(
        (await attendance.getDailySummary('2026-01-17', user))[0].status,
      ).toBe('off_day');
      await expect(
        settings.createHoliday(riyadh.id, {
          name: 'خطأ',
          startDate: '2026-01-20',
          endDate: '2026-01-10',
        }),
      ).rejects.toThrow(/قبل بدايتها/);
      await expect(
        settings.createHoliday(riyadh.id, {
          name: 'خطأ',
          startDate: '2026-02-30',
        }),
      ).rejects.toThrow(/غير صالح/);
    });

    it('starts counting from the employee first day', async () => {
      const shift = await addShift('08:00', '16:00', 15);
      const newcomer = await dataSource.getRepository(Employee).save({
        tenantId: riyadh.id,
        employeeCode: '1009',
        fullName: 'جديد',
        shiftId: shift.id,
        createdAt: new Date('2026-01-20T08:00:00Z'),
      });

      const report = await attendance.getMonthlyReport(
        newcomer.id,
        1,
        2026,
        user,
      );

      expect(report.notEmployedDays).toBe(19);
      expect(report.dailyBreakdown[0].status).toBe('not_employed');
      // من 20 إلى 31: 12 يوماً منها جمعتان (23 و30)
      expect(report.absentDays).toBe(10);
    });
  });

  describe('device numbers', () => {
    it('links an unknown number to its employee with all its earlier punches', async () => {
      await adms.processAttendanceLogs(
        SN,
        [
          punch('5', '2026-01-12 08:00:00', 0),
          punch('005', '2026-01-12 16:00:00', 0),
        ].join('\n'),
      );
      const employee = await addEmployee(riyadh, '1230001', 'سالم');

      const [unlinked] = await attendance.findUnlinkedPins(user);
      expect(unlinked).toMatchObject({ punches: 2, devices: [SN] });

      expect(
        await attendance.linkPin({ pin: '5', employeeId: employee.id }, user),
      ).toEqual({ employeeId: employee.id, attendancePin: '5', linked: 2 });
      expect(await attendance.findUnlinkedPins(user)).toEqual([]);

      // ما يصل بعد الربط يُنسب له مباشرة — وجهاز آخر يعرفه بكوده يبقى كذلك
      await adms.processAttendanceLogs(
        SN,
        [
          punch('5', '2026-01-13 08:00:00', 0),
          punch('1230001', '2026-01-13 16:00:00', 0),
        ].join('\n'),
      );
      const logs = await logsOf(riyadh);
      expect(logs).toHaveLength(4);
      expect(logs.every((l) => l.employeeId === employee.id)).toBe(true);
    });

    it('refuses a number that belongs to another employee', async () => {
      const first = await addEmployee(riyadh, '1230001', 'سالم');
      const second = await addEmployee(riyadh, '1230002', 'بدر');
      await addEmployee(riyadh, '1230003', 'جمال');
      await attendance.linkPin({ pin: '5', employeeId: first.id }, user);

      // نفس الرقم بأصفار في أوله هو نفس الرقم على الجهاز
      await expect(
        attendance.linkPin({ pin: '05', employeeId: second.id }, user),
      ).rejects.toThrow(/مستخدم للموظف سالم/);
      // ولا يُعطى موظفٌ كودَ موظف آخر
      await expect(
        attendance.linkPin({ pin: '1230003', employeeId: second.id }, user),
      ).rejects.toThrow(/مستخدم للموظف جمال/);
    });
  });

  describe('device security', () => {
    it('locks a device to its addresses and alerts on anything else', async () => {
      const [device] = await attendance.findAllDevices(user);
      await attendance.updateDevice(
        device.id,
        { allowedIps: '10.0.0.0/24, 41.33.1.7' },
        user,
      );

      expect(await adms.handleDeviceInit(SN, { ip: '10.0.0.5' })).toContain(
        'GET OPTION',
      );
      expect(
        await adms.handleDeviceInit(SN, { ip: '::ffff:41.33.1.7' }),
      ).toContain('GET OPTION');
      expect(
        await adms.processAttendanceLogs(
          SN,
          punch('1', '2026-01-12 08:00:00', 0),
          undefined,
          { ip: '8.8.8.8' },
        ),
      ).toBeNull();
      expect(await logsOf(riyadh)).toHaveLength(0);
      expect(events.emit).toHaveBeenCalledWith(
        'attendance.device_blocked',
        expect.objectContaining({ deviceId: device.id, ip: '8.8.8.8' }),
      );

      await expect(
        attendance.updateDevice(device.id, { allowedIps: '10.0.0.300' }, user),
      ).rejects.toThrow(/IP غير صالح/);
    });

    it('alerts when an unlocked device calls from a new address', async () => {
      const [device] = await attendance.findAllDevices(user);
      await adms.handleDeviceInit(SN, { ip: '10.0.0.5' });
      expect(events.emit).not.toHaveBeenCalled();

      await adms.getPendingCommand(SN, { ip: '197.1.2.3' });

      expect(events.emit).toHaveBeenCalledWith(
        'attendance.device_ip_changed',
        expect.objectContaining({
          deviceId: device.id,
          previousIp: '10.0.0.5',
          ip: '197.1.2.3',
        }),
      );
    });
  });

  describe('copying fingerprints between devices', () => {
    const SECOND_SN = 'RYD0002';
    const fingerprint = 'FP PIN=1001\tFID=6\tSize=8\tValid=1\tTMP=QUJDREVGR0g=';

    it('stores templates encrypted and sends them to the other devices once', async () => {
      await settings.updatePolicy(riyadh.id, { syncBiometrics: true });
      await attendance.createDevice({ serialNumber: SECOND_SN }, user);
      await adms.handleDeviceInit(SECOND_SN, { pushVersion: '2.4.1' });
      const employee = await addEmployee(riyadh, '1001', 'سالم');

      expect(
        await adms.processOperationLog(
          SN,
          `USER PIN=1001\tName=x\tPri=0\n${fingerprint}\n`,
          '7',
        ),
      ).toBe(2);

      const [stored] = await dataSource.getRepository(BiometricTemplate).find();
      expect(stored).toMatchObject({ employeeId: employee.id, slot: '6' });
      expect(stored.data).not.toContain('QUJD');

      const sent = await adms.getPendingCommand(SECOND_SN);
      expect(sent).toContain('DATA UPDATE USERINFO PIN=1001\tName=سالم\tPri=0');
      expect(sent).toContain(
        'DATA UPDATE FINGERTMP PIN=1001\tFID=6\tSize=8\tValid=1\tTMP=QUJDREVGR0g=',
      );
      // المصدر لا يُرسل له ما أرسله، والقالب العائد من الجهاز الآخر لا يُنسخ ثانية
      expect(await adms.getPendingCommand(SN)).toBeNull();
      await adms.processOperationLog(SECOND_SN, fingerprint, '1');
      expect(await adms.getPendingCommand(SN)).toBeNull();

      const options = await adms.handleDeviceInit(SN);
      expect(options).toContain('OPERLOGStamp=7');
      expect(options).toContain('EnrollFP');
    });

    it('keeps nothing when copying is off, and purges when it is turned off', async () => {
      await addEmployee(riyadh, '1001', 'سالم');
      await adms.processOperationLog(SN, fingerprint, '1');
      expect(await dataSource.getRepository(BiometricTemplate).count()).toBe(0);
      expect(await adms.handleDeviceInit(SN)).toContain('OPERLOGStamp=9999');

      await settings.updatePolicy(riyadh.id, { syncBiometrics: true });
      await adms.processOperationLog(SN, fingerprint, '2');
      expect(await dataSource.getRepository(BiometricTemplate).count()).toBe(1);

      await settings.updatePolicy(riyadh.id, { syncBiometrics: false });
      await sync.purge(riyadh.id);
      expect(await dataSource.getRepository(BiometricTemplate).count()).toBe(0);
    });
  });

  describe('other devices', () => {
    it('receives Hikvision events with the device key only', async () => {
      const employee = await addEmployee(riyadh, '1001', 'سالم');
      const device = await attendance.createDevice(
        { serialNumber: 'HIK-1', protocol: DeviceProtocol.HIKVISION },
        user,
      );
      expect(device.pushKey).toBeTruthy();

      const event = {
        dateTime: '2026-01-12T08:01:02+03:00',
        eventType: 'AccessControllerEvent',
        AccessControllerEvent: {
          majorEventType: 5,
          subEventType: 75,
          employeeNoString: '1001',
          attendanceStatus: 'checkIn',
        },
      };
      const body = {
        event_log: JSON.stringify(event),
        heartbeat: JSON.stringify({ eventType: 'heartBeat' }),
      };

      expect(
        await pushes.authenticate(device.id, 'wrong', DeviceProtocol.HIKVISION),
      ).toBeNull();
      const authed = await pushes.authenticate(
        device.id,
        device.pushKey,
        DeviceProtocol.HIKVISION,
      );
      expect(
        await pushes.receiveHikvision(
          authed!,
          collectHikvisionEvents(body),
          '10.0.0.9',
        ),
      ).toMatchObject({ received: 2, saved: 1 });
      // إعادة إرسال نفس الحدث لا تكرره
      expect(
        await pushes.receiveHikvision(authed!, [event], '10.0.0.9'),
      ).toMatchObject({ saved: 0, duplicates: 1 });

      const [log] = await logsOf(riyadh);
      expect(log).toMatchObject({
        employeeId: employee.id,
        verifyMode: 'face',
        deviceSn: 'HIK-1',
      });
      expect(log.punchTime.toISOString()).toBe('2026-01-12T05:01:02.000Z');
    });

    it('receives punches from any device through the API', async () => {
      const device = await attendance.createDevice(
        { serialNumber: 'API-1', protocol: DeviceProtocol.API },
        user,
      );
      const authed = await pushes.authenticate(
        device.id,
        device.pushKey,
        DeviceProtocol.API,
      );
      // ZKTeco لا يُقبل بمفتاح، ولا جهاز API بلا مفتاحه
      expect(
        await pushes.authenticate(
          device.id,
          device.pushKey,
          DeviceProtocol.HIKVISION,
        ),
      ).toBeNull();

      const dto = {
        punches: [
          { pin: '1001', time: '2026-01-12T08:00:00' },
          { pin: '1001', time: '2026-01-12T17:00:00+03:00', type: 'check_out' },
        ],
      } as PushPunchesDto;
      expect(await pushes.receiveApi(authed!, dto, '1.2.3.4')).toEqual({
        received: 2,
        saved: 2,
        duplicates: 0,
        unlinked: 2,
      });
      expect(
        (await pushes.receiveApi(authed!, dto, '1.2.3.4'))?.duplicates,
      ).toBe(2);

      // بلا منطقة: بتوقيت الجهاز (الرياض)
      expect((await logsOf(riyadh))[0].punchTime.toISOString()).toBe(
        '2026-01-12T05:00:00.000Z',
      );

      const renewed = await attendance.regeneratePushKey(device.id, user);
      expect(
        await pushes.authenticate(
          device.id,
          device.pushKey,
          DeviceProtocol.API,
        ),
      ).toBeNull();
      expect(
        await pushes.authenticate(
          device.id,
          renewed.pushKey,
          DeviceProtocol.API,
        ),
      ).not.toBeNull();
    });

    it('imports punches exported from any device as CSV', async () => {
      const employee = await addEmployee(riyadh, '1001', 'سالم');
      const csv = [
        '"No.","Name","Time","State"',
        '1001,سالم,12/01/2026 08:05,C/In',
        '1001,سالم,12/01/2026 17:10,C/Out',
        'ab!,x,12/01/2026 09:00,C/In',
        '1001,سالم,not a date,C/In',
      ].join('\r\n');
      const file = {
        buffer: Buffer.from(`\uFEFF${csv}`),
        size: csv.length,
      } as Express.Multer.File;

      const preview = await imports.preview(file);
      expect(preview).toMatchObject({
        headers: ['No.', 'Name', 'Time', 'State'],
        totalRows: 4,
        guess: {
          pinColumn: 0,
          dateTimeColumn: 2,
          typeColumn: 3,
          dateOrder: 'DMY',
        },
      });

      const mapping = { pinColumn: 0, dateTimeColumn: 2, typeColumn: 3 };
      expect(await imports.import(file, mapping, user)).toMatchObject({
        total: 4,
        imported: 2,
        duplicates: 0,
        skipped: 2,
        errors: [
          { row: 4, reason: 'رقم الموظف فارغ أو غير صالح' },
          { row: 5, reason: 'التاريخ أو الوقت غير مفهوم' },
        ],
      });
      expect(await imports.import(file, mapping, user)).toMatchObject({
        imported: 0,
        duplicates: 2,
      });

      const logs = await logsOf(riyadh);
      expect(logs.map((l) => l.punchTime.toISOString())).toEqual([
        '2026-01-12T05:05:00.000Z',
        '2026-01-12T14:10:00.000Z',
      ]);
      expect(logs[1]).toMatchObject({
        employeeId: employee.id,
        punchType: PunchType.CHECK_OUT,
      });
    });

    it('imports an Excel file with separate date and time columns', async () => {
      const workbook = new Workbook();
      const sheet = workbook.addWorksheet('Report');
      sheet.addRow(['Person ID', 'Date', 'Time']);
      sheet.addRow(['7', new Date(Date.UTC(2026, 0, 13)), '07:58:00']);
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      const file = { buffer, size: buffer.length } as Express.Multer.File;

      const { guess } = await imports.preview(file);
      expect(guess).toMatchObject({
        pinColumn: 0,
        dateColumn: 1,
        timeColumn: 2,
        dateTimeColumn: null,
      });

      expect(
        await imports.import(
          file,
          { pinColumn: 0, dateColumn: 1, timeColumn: 2 },
          user,
        ),
      ).toMatchObject({ imported: 1, unlinked: 1 });
      expect((await logsOf(riyadh))[0].punchTime.toISOString()).toBe(
        '2026-01-13T04:58:00.000Z',
      );
    });
  });

  describe('payroll', () => {
    it('deducts absence and lateness and pays overtime by the company policy', async () => {
      const shift = await addShift('08:00', '16:00', 15);
      const tracked = await addEmployee(riyadh, '1001', 'أحمد', shift);
      const office = await addEmployee(riyadh, '1002', 'بلا وردية');
      for (const employee of [tracked, office]) {
        await dataSource.getRepository(Salary).save({
          tenantId: riyadh.id,
          employeeId: employee.id,
          basicSalary: 3000,
          totalSalary: 3000,
        });
      }
      await dataSource.getRepository(LeaveRequest).save({
        tenantId: riyadh.id,
        employeeId: tracked.id,
        startDate: '2026-01-08' as unknown as Date,
        endDate: '2026-01-08' as unknown as Date,
        type: LeaveType.ANNUAL,
        status: LeaveStatus.APPROVED,
      });
      await settings.createHoliday(riyadh.id, {
        name: 'عطلة',
        startDate: '2026-01-07',
      });
      await adms.processAttendanceLogs(
        SN,
        [
          // تأخر 40 دقيقة، ثم يوم بساعتين إضافيتين
          punch('1001', '2026-01-05 08:40:00', 0),
          punch('1001', '2026-01-05 16:00:00', 0),
          punch('1001', '2026-01-06 08:00:00', 0),
          punch('1001', '2026-01-06 18:00:00', 0),
        ].join('\n'),
      );
      await settings.updatePolicy(riyadh.id, {
        deductAbsence: true,
        deductLateness: true,
        payOvertime: true,
      });

      const run = await payroll.generateMonthlyPayroll(1, 2026, riyadh.id);
      const items = await dataSource
        .getRepository(PayrollItem)
        .findBy({ payrollId: run.id });
      const itemOf = (id: string) => items.find((i) => i.employeeId === id)!;

      // 31 يوماً − 5 جُمَع − عطلة − إجازة − يوما حضور = 22 غياباً
      expect(itemOf(tracked.id)).toMatchObject({
        absenceDays: 22,
        absenceDeduction: '2200.000',
        lateMinutes: 40,
        lateDeduction: '8.330',
        overtimeMinutes: 120,
        overtimeAmount: '37.500',
        netSalary: '829.170',
      });
      // من لا وردية له لا يُحاسب بالبصمة
      expect(itemOf(office.id)).toMatchObject({
        absenceDays: 0,
        absenceDeduction: '0.000',
        netSalary: '3000.000',
      });
    });
  });
});
