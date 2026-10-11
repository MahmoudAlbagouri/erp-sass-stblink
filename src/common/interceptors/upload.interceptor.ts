import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

const DEFAULT_UPLOADS_BASE_URL = 'https://erp.api.stblink.com/uploads';

@Injectable()
export class UploadInterceptor implements NestInterceptor {
  // الرابط الأساسي للسيرفر (قابل للتغيير عبر UPLOADS_BASE_URL)
  private get baseUrl(): string {
    return process.env.UPLOADS_BASE_URL || DEFAULT_UPLOADS_BASE_URL;
  }

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next
      .handle()
      .pipe(map((data: unknown): unknown => this.transformData(data)));
  }

  private transformData(
    data: unknown,
    visited = new WeakSet<object>(),
  ): unknown {
    // 1. إذا لم تكن البيانات كائناً أو كانت null/undefined، نرجعها كما هي
    if (!data || typeof data !== 'object') return data;

    // 2. حماية من التكرار اللانهائي (Circular References)
    if (visited.has(data)) {
      return data;
    }
    visited.add(data);

    // 3. إذا كانت مصفوفة، نطبق التحويل على كل عنصر
    if (Array.isArray(data)) {
      return data.map((item: unknown) => this.transformData(item, visited));
    }

    // 4. نمر على كل مفاتيح الكائن
    const record = data as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const value = record[key];

      // حالة خاصة: تجاهل بعض المفاتيح إذا لزم الأمر (مثل filename الداخلي)
      if (key === 'filename') continue;

      // معالجة النصوص المفردة (مثل mainImage أو logo)
      if (typeof value === 'string' && this.isImagePath(value)) {
        if (!value.startsWith('http')) {
          record[key] = `${this.baseUrl}/${value}`;
        }
      }
      // معالجة القيم التي هي كائنات أو مصفوفات للدخول فيها recursively
      else if (value && typeof value === 'object') {
        record[key] = this.transformData(value, visited);
      }
    }

    return data;
  }

  // دالة ذكية للتحقق من امتدادات الصور الشائعة
  private isImagePath(value: string): boolean {
    if (!value) return false;
    const allowedExtensions = /\.(jpg|jpeg|png|webp|gif|svg|bmp|pdf)$/i;
    return allowedExtensions.test(value);
  }
}
