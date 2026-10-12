import { calculateDurationDays, DateUtils } from './date.utils';

describe('calculateDurationDays', () => {
  it('counts both ends when inclusive (leave length)', () => {
    expect(calculateDurationDays('2026-01-01', '2026-01-03', true)).toBe(3);
    expect(calculateDurationDays('2026-01-01', '2026-01-01', true)).toBe(1);
  });

  it('returns the plain difference when not inclusive (service duration)', () => {
    expect(calculateDurationDays('2026-01-01', '2026-01-03', false)).toBe(2);
    expect(calculateDurationDays('2026-01-01', '2026-01-01', false)).toBe(0);
  });

  it('never returns a negative number', () => {
    expect(calculateDurationDays('2026-01-10', '2026-01-01', true)).toBe(0);
  });

  it('ignores the time of day', () => {
    const start = new Date(2026, 0, 1, 23, 59);
    const end = new Date(2026, 0, 2, 0, 1);
    expect(calculateDurationDays(start, end, false)).toBe(1);
  });

  it('handles month and leap-year boundaries', () => {
    expect(calculateDurationDays('2028-02-28', '2028-03-01', true)).toBe(3);
    expect(calculateDurationDays('2026-02-28', '2026-03-01', true)).toBe(2);
  });
});

describe('DateUtils', () => {
  const utils = new DateUtils();

  it('clips a period to a window', () => {
    // إجازة 1–10 يناير مقصوصة على نافذة 5–20 يناير = 6 أيام
    expect(
      utils.clipDaysToPeriod(
        '2026-01-01',
        '2026-01-10',
        '2026-01-05',
        '2026-01-20',
      ),
    ).toBe(6);
  });

  it('returns 0 when the period is outside the window', () => {
    expect(
      utils.clipDaysToPeriod(
        '2026-01-01',
        '2026-01-03',
        '2026-02-01',
        '2026-02-28',
      ),
    ).toBe(0);
  });

  it('builds the anniversary date for a given year', () => {
    const anniversary = utils.anniversaryForYear(new Date(2024, 4, 15), 2026);
    expect(anniversary.getFullYear()).toBe(2026);
    expect(anniversary.getMonth()).toBe(4);
    expect(anniversary.getDate()).toBe(15);
  });
});
