import { buildZatcaQr, computeInvoiceHash, parseZatcaQr } from './zatca.util';

describe('zatca util', () => {
  const input = {
    sellerName: 'مؤسسة الأفق التجارية',
    taxNumber: '300000000000003',
    issuedAt: new Date('2026-10-12T09:30:45.123Z'),
    total: 115,
    taxTotal: 15,
  };

  describe('buildZatcaQr', () => {
    it('encodes the five phase-1 fields as base64 TLV', () => {
      const fields = parseZatcaQr(buildZatcaQr(input));

      expect(fields).toEqual({
        1: 'مؤسسة الأفق التجارية',
        2: '300000000000003',
        3: '2026-10-12T09:30:45Z',
        4: '115.00',
        5: '15.00',
      });
    });

    it('uses byte length (not character count) for Arabic text', () => {
      const bytes = Buffer.from(buildZatcaQr(input), 'base64');

      expect(bytes[0]).toBe(1); // الحقل الأول
      expect(bytes[1]).toBe(Buffer.byteLength(input.sellerName, 'utf8'));
      expect(bytes[1]).toBeGreaterThan(input.sellerName.length);
    });

    it('rejects a field longer than one length byte allows', () => {
      expect(() =>
        buildZatcaQr({ ...input, sellerName: 'ش'.repeat(200) }),
      ).toThrow('255');
    });
  });

  describe('computeInvoiceHash', () => {
    const base = {
      uuid: '3f0c2b1e-0000-4000-8000-000000000001',
      number: 'INV-000001',
      issuedAt: input.issuedAt,
      total: 115,
      taxTotal: 15,
      previousHash: '',
    };

    it('is deterministic and changes with any field', () => {
      const hash = computeInvoiceHash(base);

      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(computeInvoiceHash(base)).toBe(hash);
      expect(computeInvoiceHash({ ...base, total: 116 })).not.toBe(hash);
      expect(computeInvoiceHash({ ...base, previousHash: 'x' })).not.toBe(hash);
    });
  });
});
