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

    // 3. إذا كانت مصفوفة، نطبق التحويل على كل عنصر — بما فيها النصوص
    // (مرفقات العقد attachmentPaths مصفوفة مسارات)
    if (Array.isArray(data)) {
      return data.map((item: unknown) => this.transformValue(item, visited));
    }

    // 4. نمر على كل مفاتيح الكائن
    const record = data as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      // حالة خاصة: تجاهل بعض المفاتيح إذا لزم الأمر (مثل filename الداخلي)
      if (key === 'filename') continue;
      record[key] = this.transformValue(record[key], visited);
    }

    return data;
  }

  // نص مسار ملف ← رابط كامل، وكائن/مصفوفة ← ندخل فيه recursively
  private transformValue(value: unknown, visited: WeakSet<object>): unknown {
    if (typeof value === 'string') {
      if (!this.isFilePath(value) || value.startsWith('http')) return value;
      // المسار المخزّن يبدأ بـ "/" (مثل /contract/image/x.jpg): لا نكرر الفاصل
      return `${this.baseUrl}/${value.replace(/^\/+/, '')}`;
    }
    if (value && typeof value === 'object') {
      return this.transformData(value, visited);
    }
    return value;
  }

  // امتدادات الملفات المرفوعة (jfif صورة JPEG بامتداد مختلف)
  private isFilePath(value: string): boolean {
    if (!value) return false;
    return /\.(jpe?g|jfif|png|webp|gif|svg|bmp|avif|pdf)$/i.test(value);
  }
}
