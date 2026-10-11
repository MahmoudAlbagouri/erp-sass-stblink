import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import type { Response as ExpressResponse } from 'express';
import { I18nService } from 'nestjs-i18n';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

// تعريف واجهة شكل الاستجابة الموحد
export interface Response<T> {
  success: boolean;
  message: string;
  data: T;
  statusCode: number;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  Response<T>
> {
  constructor(private readonly i18n: I18nService) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<Response<T>> {
    const response = context.switchToHttp().getResponse<ExpressResponse>();
    const statusCode = response.statusCode;

    return next.handle().pipe(
      map((data) => ({
        success: true,
        message: this.i18n.t<string, string>('user.SUCCESS_OPERATION'),
        statusCode: statusCode,
        data: data, // هنا ستوضع البيانات التي ترجعها الـ Controllers
      })),
    );
  }
}
