import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { I18nContext } from 'nestjs-i18n';
import { Response } from 'express';

@Catch(HttpException)
export class I18nExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const i18n = I18nContext.current(host);

    const exceptionResponse: any = exception.getResponse();
    const exceptionName = exception.constructor.name; // مثل NotFoundException

    let message: string | string[];

    // استخراج الرسالة القادمة من throw new ...
    const incomingMessage =
      typeof exceptionResponse === 'object'
        ? exceptionResponse.message
        : exceptionResponse;

    /**
     * المنطق الجديد:
     * إذا أرسلت رسالة في الـ Service، ستكون مختلفة عن اسم الحالة الافتراضية
     * مثلاً: "Not Found" هي الافتراضية لـ NotFoundException.
     * أي شيء آخر (مثل ترجمتك) يعتبر رسالة خاصة.
     */
    if (
      incomingMessage &&
      !this.isDefaultMessage(String(incomingMessage), exceptionName)
    ) {
      message = incomingMessage;
    } else {
      // إذا كانت الرسالة هي الافتراضية، نذهب لملف error.json
      message = i18n?.t(`error.${exceptionName}`) || incomingMessage;
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message: Array.isArray(message) ? message[0] : message,
      error: exceptionName,
      timestamp: new Date().toISOString(),
    });
  }

  private isDefaultMessage(msg: string, exceptionName: string): boolean {
    // هذه هي الرسائل التي يضعها NestJS تلقائياً إذا تركت الأقواس فارغة
    const defaultMap: Record<string, string> = {
      NotFoundException: 'Not Found',
      BadRequestException: 'Bad Request',
      ForbiddenException: 'Forbidden',
      UnauthorizedException: 'Unauthorized',
      ConflictException: 'Conflict',
      InternalServerErrorException: 'Internal Server Error',
    };

    return defaultMap[exceptionName] === msg;
  }
}
