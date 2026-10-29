// src/modules/files/file-url.interceptor.ts
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { FileView, StoredFile } from './entities/stored-file.entity';
import { FileUrlSigner } from './file-url.signer';

/**
 * أصل الـ API كما يراه المتصفح: API_BASE_URL إن ضُبط (الإنتاج خلف nginx)،
 * وإلا من الطلب نفسه — فلا دومين مخزَّن في قاعدة البيانات ولا في الكود.
 */
export function publicOrigin(req?: Request): string {
  const configured = process.env.API_BASE_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  const forwarded = String(req?.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    .trim();
  return `${forwarded || req?.protocol || 'http'}://${req?.get('host') ?? 'localhost'}`;
}

/**
 * عام على كل الردود: أي ملف (StoredFile) محمَّل ضمن الرد يصل الواجهة كـ
 * FileView برابط موقَّع، فيكفي أي خدمة أن تحمّل علاقة الملف مع سجلها.
 */
@Injectable()
export class FileUrlInterceptor implements NestInterceptor {
  constructor(private readonly signer: FileUrlSigner) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const origin = publicOrigin(context.switchToHttp().getRequest<Request>());
    return next
      .handle()
      .pipe(map((data: unknown) => this.walk(data, origin, new WeakSet())));
  }

  private walk(value: unknown, origin: string, seen: WeakSet<object>): unknown {
    if (!value || typeof value !== 'object') return value;
    if (value instanceof StoredFile) return this.view(value, origin);
    if (
      seen.has(value) ||
      value instanceof Date ||
      value instanceof StreamableFile ||
      Buffer.isBuffer(value)
    ) {
      return value;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        value[i] = this.walk(value[i], origin, seen);
      }
      return value;
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      record[key] = this.walk(record[key], origin, seen);
    }
    return value;
  }

  private view(file: StoredFile, origin: string): FileView {
    return {
      id: file.id,
      name: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      url: this.signer.url(file, origin),
    };
  }
}
