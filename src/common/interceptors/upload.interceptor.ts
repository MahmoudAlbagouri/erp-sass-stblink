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

  private transformData(data: any, seen = new WeakSet()): any {
    // 1. إذا لم تكن كائناً أو مصفوفة، لا تفعل شيئاً
    if (!data || typeof data !== 'object') return data;

    // 2. حماية من المراجع الدائرية (Circular References)
    if (seen.has(data)) return data;
    seen.add(data);

    // 3. إذا كانت مصفوفة، قم بإنشاء نسخة جديدة
    if (Array.isArray(data)) {
      return data.map((item) => this.transformData(item, seen));
    }

    // 4. إنشاء كائن جديد بدلاً من تعديل الأصلي (Immutability)
    const result = { ...data };

    Object.keys(result).forEach((key) => {
      const value = result[key];

      // معالجة النصوص (إضافة الرابط)
      if (
        key !== 'filename' &&
        typeof value === 'string' &&
        this.isImagePath(value) &&
        !value.startsWith('http')
      ) {
        result[key] = `${this.baseUrl}/uploads/${value}`;
      }
      // معالجة الكائنات المتداخلة أو المصفوفات
      else if (typeof value === 'object' && value !== null) {
        result[key] = this.transformData(value, seen);
      }
    });

    return result;
  }

  private isImagePath(value: string): boolean {
    const imageExtensions = /\.(jpg|jpeg|png|webp|gif|svg|bmp)$/i;
    return imageExtensions.test(value);
  }
}
