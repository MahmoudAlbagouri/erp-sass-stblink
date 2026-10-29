import { FileUrlSigner } from './file-url.signer';
import { cleanFileName, detectFileKind } from './file-rules';

describe('FileUrlSigner', () => {
  const signer = new FileUrlSigner();
  const file = {
    id: '6f1c0a52-8f8e-4b4c-9a51-7b3f0c2d9e10',
    originalName: 'هوية.png',
  };
  const NOW = Date.UTC(2026, 9, 29, 10, 7, 0);

  const parts = (url: string) => {
    const parsed = new URL(url);
    return {
      exp: parsed.searchParams.get('exp'),
      sig: parsed.searchParams.get('sig'),
      path: parsed.pathname,
    };
  };

  it('builds a link to the file under the given origin, with its name', () => {
    const { path } = parts(signer.url(file, 'https://api.test', NOW));
    expect(path).toBe(`/files/${file.id}/${encodeURIComponent('هوية.png')}`);
  });

  it('accepts its own signature until it expires (at least an hour)', () => {
    const { exp, sig } = parts(signer.url(file, 'https://api.test', NOW));
    expect(signer.verify(file.id, exp, sig, NOW)).toBe(true);
    expect(signer.verify(file.id, exp, sig, NOW + 60 * 60 * 1000)).toBe(true);
    expect(signer.verify(file.id, exp, sig, NOW + 76 * 60 * 1000)).toBe(false);
  });

  it('rejects another file, a changed expiry, or a forged signature', () => {
    const { exp, sig } = parts(signer.url(file, 'https://api.test', NOW));
    expect(
      signer.verify('00000000-0000-4000-8000-000000000000', exp, sig, NOW),
    ).toBe(false);
    expect(signer.verify(file.id, Number(exp) + 900, sig, NOW)).toBe(false);
    expect(signer.verify(file.id, exp, 'x'.repeat(43), NOW)).toBe(false);
    expect(signer.verify(file.id, 'soon', sig, NOW)).toBe(false);
  });

  it('repeats the same link within a quarter hour (browser cache)', () => {
    const a = signer.url(file, 'https://api.test', NOW);
    const b = signer.url(file, 'https://api.test', NOW + 5 * 60 * 1000);
    expect(a).toBe(b);
  });
});

describe('file rules', () => {
  it('detects the type from the content, not the name', () => {
    expect(
      detectFileKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mimeType,
    ).toBe('image/jpeg');
    expect(detectFileKind(Buffer.from('%PDF-1.7'))?.mimeType).toBe(
      'application/pdf',
    );
    expect(detectFileKind(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))?.mimeType).toBe(
      'image/webp',
    );
    expect(detectFileKind(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
  });

  it('keeps only the file name, without a path or control characters', () => {
    expect(cleanFileName('../../etc/passwd', '.pdf')).toBe('passwd');
    expect(cleanFileName('C:\\fakepath\\عقد "نهائي".pdf', '.pdf')).toBe(
      'عقد نهائي.pdf',
    );
    expect(cleanFileName('', '.png')).toBe('file.png');
  });
});
