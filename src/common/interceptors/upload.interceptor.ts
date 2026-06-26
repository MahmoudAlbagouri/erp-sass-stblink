import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class UploadInterceptor implements NestInterceptor {
  // الرابط الأساسي للسيرفر
  private readonly baseUrl = 'https://erp.api.stblink.com/uploads';

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next
      .handle()
      .pipe(map((data: unknown): unknown => this.transformData(data)));
  }

  private transformData(data: any, visited = new WeakSet()): unknown {
    // 1. إذا لم تكن البيانات كائناً أو كانت null/undefined، نرجعها كما هي
    if (!data || typeof data !== 'object') return data;

    // 2. حماية من التكرار اللانهائي (Circular References)
    if (visited.has(data)) {
      return data;
    }
    visited.add(data);

    // 3. إذا كانت مصفوفة، نطبق التحويل على كل عنصر
    if (Array.isArray(data)) {
      return data.map((item) => this.transformData(item, visited));
    }

    // 4. نمر على كل مفاتيح الكائن
    const keys = Object.keys(data as Record<string, any>);
    for (const key of keys) {
      const value = data[key];

      // حالة خاصة: تجاهل بعض المفاتيح إذا لزم الأمر (مثل filename الداخلي)
      if (key === 'filename') continue;

      // معالجة النصوص المفردة (مثل mainImage أو logo)
      if (typeof value === 'string' && this.isImagePath(value)) {
        if (!value.startsWith('http')) {
          data[key] = `${this.baseUrl}/${value}`;
        }
      }
      // معالجة القيم التي هي كائنات أو مصفوفات للدخول فيها recursively
      else if (value && typeof value === 'object') {
        data[key] = this.transformData(value, visited);
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
