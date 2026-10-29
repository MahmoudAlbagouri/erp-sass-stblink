import { TemplateKind } from './entities/biometric-template.entity';
import { PunchType, VerifyMode } from './entities/attendance-log.entity';
import { pinKey } from './utils/attendance-pin';
import { ipAllowed, parseAllowedIps } from './utils/ip-allowlist';
import { decryptTemplate, encryptTemplate } from './utils/template-cipher';
import {
  commandForDevice,
  parseTemplateLine,
  userInfoCommand,
} from './utils/zk-protocol';
import { parseDeviceTime, parseHikvisionEvent } from './device-push.service';
import { planDay, shiftDayOf, weekdayOf } from './attendance-days';

describe('attendance pin', () => {
  it('compares device numbers without leading zeros', () => {
    expect(pinKey(' 0420001 ')).toBe('420001');
    expect(pinKey('000')).toBe('0');
    expect(pinKey('A001')).toBe('A001');
  });
});

describe('ip allowlist', () => {
  it('accepts exact addresses and ranges, IPv4 inside IPv6 too', () => {
    const list = '10.0.0.0/24, 41.33.1.7';
    expect(ipAllowed('10.0.0.200', list)).toBe(true);
    expect(ipAllowed('::ffff:41.33.1.7', list)).toBe(true);
    expect(ipAllowed('10.0.1.1', list)).toBe(false);
    expect(ipAllowed(null, list)).toBe(false);
    expect(ipAllowed('8.8.8.8', '')).toBe(true);
  });

  it('rejects malformed entries', () => {
    expect(() => parseAllowedIps('10.0.0.1/33')).toThrow('10.0.0.1/33');
    expect(() => parseAllowedIps('example.com')).toThrow();
  });
});

describe('zk protocol', () => {
  it('writes commands in the modern format and translates for old devices', () => {
    const command = userInfoCommand('7', 'سالم\tأحمد');
    expect(command).toBe('DATA UPDATE USERINFO PIN=7\tName=سالم أحمد\tPri=0');
    expect(commandForDevice(command, '2.4.1')).toBe(command);
    expect(commandForDevice(command, null)).toBe(
      'DATA USER PIN=7\tName=سالم أحمد\tPri=0',
    );
  });

  it('reads fingerprint and BIODATA templates, and ignores other lines', () => {
    expect(
      parseTemplateLine('FP PIN=1\tFID=6\tSize=4\tValid=1\tTMP=QUI='),
    ).toEqual({
      kind: TemplateKind.FINGER,
      pin: '1',
      slot: '6',
      fields: 'FID=6\tSize=4\tValid=1\tTMP=QUI=',
    });
    expect(
      parseTemplateLine(
        'BIODATA Pin=9\tNo=0\tIndex=1\tValid=1\tType=9\tMajorVer=5\tTmp=QQ==',
      ),
    ).toMatchObject({ kind: TemplateKind.BIODATA, pin: '9', slot: '9:0:1' });
    expect(parseTemplateLine('USER PIN=1\tName=x')).toBeNull();
    expect(parseTemplateLine('OPLOG 4\t0\t2026-01-01 00:00:00')).toBeNull();
  });

  it('encrypts templates so tampering is detected', () => {
    const sealed = encryptTemplate('TMP=secret');
    expect(sealed).not.toContain('secret');
    expect(decryptTemplate(sealed)).toBe('TMP=secret');
    const tampered = sealed.slice(0, -4) + 'AAAA';
    expect(decryptTemplate(tampered)).toBeNull();
  });
});

describe('hikvision events', () => {
  const event = (
    detail: Record<string, unknown>,
    dateTime = '2026-01-12T08:00:00+03:00',
  ) => ({
    eventType: 'AccessControllerEvent',
    dateTime,
    AccessControllerEvent: { majorEventType: 5, ...detail },
  });

  it('turns a recognized person into a punch', () => {
    expect(
      parseHikvisionEvent(
        event({
          employeeNoString: '12',
          subEventType: 38,
          attendanceStatus: 'checkOut',
        }),
        'Asia/Riyadh',
      ),
    ).toMatchObject({
      pin: '12',
      punchType: PunchType.CHECK_OUT,
      verifyMode: VerifyMode.FINGERPRINT,
      punchTime: new Date('2026-01-12T05:00:00Z'),
    });
  });

  it('ignores strangers, other events and heartbeats', () => {
    expect(parseHikvisionEvent(event({ subEventType: 76 }), 'UTC')).toBeNull();
    expect(parseHikvisionEvent({ eventType: 'heartBeat' }, 'UTC')).toBeNull();
  });

  it('reads times without a zone in the device zone', () => {
    expect(parseDeviceTime('2026-01-12 08:00:00', 'Africa/Cairo')).toEqual(
      new Date('2026-01-12T06:00:00Z'),
    );
    expect(parseDeviceTime('2026-01-12T08:00:00Z', 'Africa/Cairo')).toEqual(
      new Date('2026-01-12T08:00:00Z'),
    );
    expect(parseDeviceTime('garbage', 'UTC')).toBeNull();
  });
});

describe('attendance days', () => {
  const calendar = {
    zone: 'Asia/Riyadh',
    weeklyOffDays: [5],
    overtimeMinMinutes: 30,
    holidays: [{ name: 'عيد', startDate: '2026-03-20', endDate: '2026-03-22' }],
    leaves: new Map(),
  };

  it('knows rest days, holidays and the shift own rest days', () => {
    expect(weekdayOf('2026-01-16')).toBe(5);
    expect(planDay(calendar, undefined, null, '2026-01-16').kind).toBe(
      'off_day',
    );
    expect(planDay(calendar, undefined, null, '2026-03-21')).toMatchObject({
      kind: 'holiday',
      holidayName: 'عيد',
    });
    const allWeek = { offDays: [] } as never;
    expect(planDay(calendar, undefined, allWeek, '2026-01-16').kind).toBe(
      'work',
    );
  });

  it('puts a night punch in the day its shift started', () => {
    const night = { startTime: '22:00', endTime: '06:00' } as never;
    // 05:30 صباح الثلاثاء بتوقيت الرياض = نهاية وردية الاثنين
    expect(
      shiftDayOf(new Date('2026-01-13T02:30:00Z'), 'Asia/Riyadh', night),
    ).toBe('2026-01-12');
  });
});
