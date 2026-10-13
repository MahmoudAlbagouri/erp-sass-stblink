import { getCountry } from '../constants/countries';
import { normalizePhone } from './phone.util';

describe('normalizePhone', () => {
  const sa = getCountry('SA');
  const eg = getCountry('EG');

  it('converts a local number to E.164 using the country dial code', () => {
    expect(normalizePhone('0501234567', sa)).toBe('+966501234567');
    expect(normalizePhone('01012345678', eg)).toBe('+201012345678');
  });

  it('accepts the dial code written as +, 00 or bare digits', () => {
    expect(normalizePhone('+966 50 123 4567', sa)).toBe('+966501234567');
    expect(normalizePhone('00966501234567', sa)).toBe('+966501234567');
    expect(normalizePhone('966501234567', sa)).toBe('+966501234567');
  });

  it('drops the trunk zero after the dial code', () => {
    expect(normalizePhone('+9660501234567', sa)).toBe('+966501234567');
  });

  it('converts Arabic-Indic digits', () => {
    expect(normalizePhone('٠٥٠١٢٣٤٥٦٧', sa)).toBe('+966501234567');
  });

  it('rejects numbers of another country or of the wrong length', () => {
    expect(normalizePhone('+201012345678', sa)).toBeNull();
    expect(normalizePhone('05012345', sa)).toBeNull();
    expect(normalizePhone('050123456789', sa)).toBeNull();
    expect(normalizePhone('abc', sa)).toBeNull();
  });
});
