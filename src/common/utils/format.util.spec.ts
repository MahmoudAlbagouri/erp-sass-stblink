import { formatAmount, formatDate, formatDateTime } from './format.util';

describe('format.util (en-US display format)', () => {
  it('formats amounts with thousands separators and latin digits', () => {
    expect(formatAmount(1500)).toBe('1,500');
    expect(formatAmount('1234567.5')).toBe('1,234,567.5');
    expect(formatAmount(1500, { minimumFractionDigits: 2 })).toBe('1,500.00');
  });

  it('formats dates as M/D/YYYY', () => {
    expect(formatDate(new Date(2026, 9, 11))).toBe('10/11/2026');
  });

  it('formats date-times with a 12-hour clock', () => {
    expect(formatDateTime(new Date(2026, 9, 11, 15, 45, 0))).toBe(
      '10/11/2026, 3:45:00 PM',
    );
  });
});
