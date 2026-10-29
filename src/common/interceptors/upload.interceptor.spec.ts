import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { UploadInterceptor } from './upload.interceptor';

const BASE = 'https://api.test/uploads';

const run = (data: unknown) =>
  lastValueFrom(
    new UploadInterceptor().intercept(
      {} as ExecutionContext,
      {
        handle: () => of(data),
      } as CallHandler,
    ),
  );

describe('UploadInterceptor (stored file paths → full URLs)', () => {
  const previous = process.env.UPLOADS_BASE_URL;
  beforeAll(() => (process.env.UPLOADS_BASE_URL = BASE));
  afterAll(() => {
    // تعيين undefined في process.env يخزّن النص "undefined"
    if (previous === undefined) delete process.env.UPLOADS_BASE_URL;
    else process.env.UPLOADS_BASE_URL = previous;
  });

  it('prefixes a relative path without doubling the slash', async () => {
    const out = await run({ nationalIdCardPath: '/employee/image/a.jpg' });
    expect(out).toEqual({ nationalIdCardPath: `${BASE}/employee/image/a.jpg` });
  });

  it('treats .jfif as an image file', async () => {
    const out = await run({ logo: 'company/image/logo.jfif' });
    expect(out).toEqual({ logo: `${BASE}/company/image/logo.jfif` });
  });

  it('resolves paths inside string arrays (contract attachments)', async () => {
    const out = await run({
      contract: {
        attachmentPaths: [
          '/contract/image/scan.jfif',
          'https://cdn.test/contract/files/old.pdf',
        ],
      },
    });
    expect(out).toEqual({
      contract: {
        attachmentPaths: [
          `${BASE}/contract/image/scan.jfif`,
          'https://cdn.test/contract/files/old.pdf',
        ],
      },
    });
  });

  it('leaves non-file strings and the upload filename untouched', async () => {
    const out = await run({
      name: 'Ahmed',
      tags: ['a', 'b'],
      filename: 'contract/image/x.jpg',
    });
    expect(out).toEqual({
      name: 'Ahmed',
      tags: ['a', 'b'],
      filename: 'contract/image/x.jpg',
    });
  });
});
