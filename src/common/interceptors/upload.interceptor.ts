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

  private transformData(data: any): unknown {
    // 1. إذا لم تكن البيانات كائناً أو مصفوفة، نرجعها كما هي
    if (!data || typeof data !== 'object') return data;

    // 2. إذا كانت مصفوفة (مثل قائمة المنتجات)، نطبق التحويل على كل عنصر
    if (Array.isArray(data)) {
      return data.map((item) => this.transformData(item));
    }

    // 3. نمر على كل مفاتيح الكائن
    Object.keys(data as Record<string, any>).forEach((key) => {
      const value = data[key];

      // معالجة النصوص المفردة (مثل mainImage أو logo أو ogImage)
      if (
        key !== 'filename' &&
        typeof value === 'string' &&
        this.isImagePath(value)
      ) {
        if (!value.startsWith('http')) {
          data[key] = `${this.baseUrl}/${value}`;
        }
      }

      // معالجة المصفوفات (مثل defaultGallery أو variantImages)
      else if (Array.isArray(value)) {
        data[key] = value.map((item) => {
          // إذا كان العنصر نصاً ويمثل مسار صورة
          if (
            typeof item === 'string' &&
            this.isImagePath(item) &&
            !item.startsWith('http')
          ) {
            return `${this.baseUrl}/${item}`;
          }
          // إذا كانت مصفوفة من الكائنات، نطبق التحويل بداخلها
          return this.transformData(item);
        });
      }

      // 4. الدخول في الكائنات المتداخلة (Nested Objects)
      else if (value && typeof value === 'object') {
        this.transformData(value);
      }
    });

    return data as unknown;
  }

  // دالة ذكية للتحقق من امتدادات الصور الشائعة
  private isImagePath(value: string): boolean {
    const allowedExtensions = /\.(jpg|jpeg|png|webp|gif|svg|bmp|pdf)$/i;
    return allowedExtensions.test(value);
  }
}
