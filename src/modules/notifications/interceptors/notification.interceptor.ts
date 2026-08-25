import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { NotificationsService } from '../notifications.service';
import { NOTIFY_KEY, NotifyConfig } from '../decorators/notify.decorator';

// ✅ تعريف نوع للنتيجة المتوقعة من الـ endpoints
interface EndpointResult {
  [key: string]: unknown;
}

@Injectable()
export class NotificationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(NotificationInterceptor.name);

  constructor(
    private reflector: Reflector,
    private notificationsService: NotificationsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const config = this.reflector.get<NotifyConfig>(
      NOTIFY_KEY,
      context.getHandler(),
    );

    if (!config) {
      return next.handle();
    }

    return next.handle().pipe(
      // ✅ الحل: استخدام tap عادي (ليس async) + معالجة الـ promise بداخله بدون await
      tap((result: EndpointResult) => {
        try {
          if (config.condition && !config.condition(result)) {
            return;
          }

          const recipientId = config.recipientField
            ? (result[config.recipientField] as string)
            : null;

          if (!recipientId) {
            this.logger.warn(
              'Recipient ID not found in response for notification.',
            );
            return;
          }

          // ✅ تنفيذ الإشعار كـ fire-and-forget (لا ننتظر النتيجة)
          this.notificationsService
            .create({
              recipientId,
              title: config.titleField
                ? (result[config.titleField] as string) || 'إشعار جديد'
                : 'إشعار جديد',
              message: config.messageField
                ? (result[config.messageField] as string) ||
                  'تم تنفيذ العملية بنجاح'
                : 'تم تنفيذ العملية بنجاح',
              type: config.type,
              category: config.category,
              referenceId: config.referenceIdField
                ? (result[config.referenceIdField] as string)
                : undefined,
            })
            .catch((error: unknown) => {
              // ✅ معالجة الخطأ هنا بدلاً من try/catch حول async
              this.logger.error(
                'Failed to send notification via interceptor:',
                error,
              );
            });
        } catch (error) {
          this.logger.error(
            'Failed to process notification interceptor:',
            error,
          );
        }
      }),
    );
  }
}
