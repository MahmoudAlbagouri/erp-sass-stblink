import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { QueryFailedError } from 'typeorm';

@Catch(QueryFailedError)
export class TypeOrmExceptionFilter implements ExceptionFilter {
  catch(exception: QueryFailedError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const detail = (exception as any).detail; // استخراج التفاصيل من PostgreSQL

    let message = 'حدث خطأ في قاعدة البيانات';
    let status = HttpStatus.INTERNAL_SERVER_ERROR;

    // معالجة خطأ القيم المكررة (كود 23505 في Postgres)
    if ((exception as any).code === '23505') {
      status = HttpStatus.CONFLICT;
      message =
        'عفواً، هذه البيانات موجودة مسبقاً. يرجى التأكد من الـ SKU أو الحقول الفريدة.';

      // لوجيك إضافي لتحديد الحقل المسبب للمشكلة
      if (detail && detail.includes('sku')) {
        message = 'رمز المنتج (SKU) مستخدم بالفعل لمنتج آخر، يرجى تغيير الرمز.';
      }
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message: message,
      error: exception.name,
      timestamp: new Date().toISOString(),
    });
  }
}
