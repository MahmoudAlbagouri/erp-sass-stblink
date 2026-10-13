import {
  dayKeyInZone,
  dayOffsetInZone,
  isValidTimezone,
  minutesOfDayInZone,
  startOfDayInZone,
  utcOffsetMinutes,
  zonedTimeToUtc,
} from './timezone.util';

describe('timezone util', () => {
  it('reads a device wall-clock time as an instant in its zone', () => {
    // 08:05 في الرياض (UTC+3) = 05:05 UTC، أياً كانت منطقة السيرفر
    expect(
      zonedTimeToUtc('2026-10-13 08:05:00', 'Asia/Riyadh')?.toISOString(),
    ).toBe('2026-10-13T05:05:00.000Z');
    // نفس الساعة في الكويت وفي تونس لحظتان مختلفتان
    expect(
      zonedTimeToUtc('2026-10-13 08:05:00', 'Africa/Tunis')?.toISOString(),
    ).toBe('2026-10-13T07:05:00.000Z');
  });

  it('follows daylight saving time where the country observes it', () => {
    // القاهرة: شتاءً UTC+2، صيفاً UTC+3
    expect(
      zonedTimeToUtc('2026-01-15 09:00:00', 'Africa/Cairo')?.toISOString(),
    ).toBe('2026-01-15T07:00:00.000Z');
    expect(
      zonedTimeToUtc('2026-07-15 09:00:00', 'Africa/Cairo')?.toISOString(),
    ).toBe('2026-07-15T06:00:00.000Z');
    expect(utcOffsetMinutes('Africa/Cairo', new Date('2026-01-15'))).toBe(120);
    expect(utcOffsetMinutes('Africa/Cairo', new Date('2026-07-15'))).toBe(180);
  });

  it('rejects malformed times and zones', () => {
    expect(zonedTimeToUtc('not a date', 'Asia/Riyadh')).toBeNull();
    expect(startOfDayInZone('2026-13-40', 'Asia/Riyadh')).toBeNull();
    expect(isValidTimezone('UTC+3')).toBe(false);
    expect(isValidTimezone('Asia/Riyadh')).toBe(true);
  });

  it('computes day boundaries in the tenant zone', () => {
    expect(startOfDayInZone('2026-10-13', 'Asia/Riyadh')?.toISOString()).toBe(
      '2026-10-12T21:00:00.000Z',
    );
    // وردية ليلية تنتهي 06:00 اليوم التالي = 30 ساعة من بداية اليوم
    expect(
      dayOffsetInZone('2026-10-13', 30 * 60, 'Asia/Riyadh').toISOString(),
    ).toBe('2026-10-14T03:00:00.000Z');
  });

  it('maps an instant back to the local day and minute', () => {
    // 22:30 UTC = 01:30 اليوم التالي في الرياض
    const instant = new Date('2026-10-13T22:30:00Z');
    expect(dayKeyInZone(instant, 'Asia/Riyadh')).toBe('2026-10-14');
    expect(minutesOfDayInZone(instant, 'Asia/Riyadh')).toBe(90);
  });
});
