import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config'; // استيراد الخدمة
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class UploadInterceptor implements NestInterceptor {
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    // جلب الرابط من ملف .env، مع رابط افتراضي في حال عدم وجود المتغير
    this.baseUrl =
      this.configService.get<string>('API_BASE_URL') ||
      'https://api.aphnan.com';
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next
      .handle()
      .pipe(map((data: unknown): unknown => this.transformData(data)));
  }

  private transformData(data: any): unknown {
    if (!data || typeof data !== 'object') return data;

    if (Array.isArray(data)) {
      return data.map((item) => this.transformData(item));
    }

    Object.keys(data as Record<string, any>).forEach((key) => {
      const value = data[key];

      // معالجة النصوص
      if (
        key !== 'filename' &&
        typeof value === 'string' &&
        this.isImagePath(value)
      ) {
        if (!value.startsWith('http')) {
          // دمج الرابط الديناميكي مع المجلد واسم الملف
          data[key] = `${this.baseUrl}/uploads/${value}`;
        }
      }
      // معالجة المصفوفات
      else if (Array.isArray(value)) {
        data[key] = value.map((item) => {
          if (
            typeof item === 'string' &&
            this.isImagePath(item) &&
            !item.startsWith('http')
          ) {
            return `${this.baseUrl}/uploads/${item}`;
          }
          return this.transformData(item);
        });
      }
      // معالجة الكائنات المتداخلة
      else if (value && typeof value === 'object') {
        this.transformData(value);
      }
    });

    return data;
  }

  private isImagePath(value: string): boolean {
    const imageExtensions = /\.(jpg|jpeg|png|webp|gif|svg|bmp)$/i;
    return imageExtensions.test(value);
  }
}
