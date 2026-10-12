import { normalizeIban } from './iban.util';

describe('normalizeIban', () => {
  it('removes spaces and upper-cases', () => {
    expect(normalizeIban(' sa03 8000 0000 6080 1016 7519 ')).toBe(
      'SA0380000000608010167519',
    );
  });

  it('returns null for empty values', () => {
    expect(normalizeIban('')).toBeNull();
    expect(normalizeIban('   ')).toBeNull();
    expect(normalizeIban(null)).toBeNull();
    expect(normalizeIban(undefined)).toBeNull();
  });
});
