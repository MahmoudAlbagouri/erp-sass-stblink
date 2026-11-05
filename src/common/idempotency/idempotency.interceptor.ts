// src/common/idempotency/idempotency.interceptor.ts
import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Response } from 'express';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { QueryFailedError, Repository } from 'typeorm';
import type { AuthenticatedRequest } from '../types/auth.types';
import { IdempotencyRecord } from './idempotency-record.entity';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
/** حروف وأرقام وفواصل بسيطة: UUID أو معرّف طابور (`op-…`) */
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;
const UNIQUE_VIOLATION = '23505';

/**
 * يجعل أي عملية حفظ آمنة الإعادة: التطبيق والويب يحفظان بلا إنترنت في طابور،
 * ويرفعانه حين يعود الاتصال — وقد يُعاد إرسال العملية نفسها (انقطع الرد بعد
 * التنفيذ). بالمفتاح نفسه يعيد السيرفر الرد الأول ولا ينفّذ شيئاً.
 *
 * - المفتاح اختياري: طلب بدونه يمر كما هو.
 * - يُحجز قبل التنفيذ: طلبان متزامنان بنفس المفتاح لا يُنفَّذان معاً (الثاني 409).
 * - فشل الطلب (تحقق، قاعدة عمل) يحرّر المفتاح: الإعادة بعد التصحيح تُنفَّذ.
 * - المفتاح نفسه لمسار آخر = خطأ في العميل (422)، لا رد مخزَّن لطلب مختلف.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @InjectRepository(IdempotencyRecord)
    private readonly records: Repository<IdempotencyRecord>,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const header = request.headers[IDEMPOTENCY_HEADER];
    const userId = request.user?.id;
    if (
      typeof header !== 'string' ||
      !userId ||
      !MUTATING.has(request.method)
    ) {
      return next.handle();
    }
    if (!KEY_PATTERN.test(header)) {
      throw new BadRequestException('مفتاح Idempotency-Key غير صالح');
    }

    const key = header;
    const method = request.method;
    const path = request.originalUrl.split('?')[0].slice(0, 300);
    const existing = await this.records.findOne({ where: { userId, key } });
    if (existing) {
      if (existing.method !== method || existing.path !== path) {
        throw new UnprocessableEntityException('مفتاح العملية مستخدم لطلب آخر');
      }
      if (!existing.completed) {
        throw new ConflictException(
          'العملية نفسها قيد التنفيذ — أعد المحاولة بعد لحظات',
        );
      }
      http.getResponse<Response>().setHeader('Idempotent-Replayed', 'true');
      return of(existing.response);
    }

    try {
      await this.records.insert({
        userId,
        tenantId: request.user.tenantId ?? null,
        key,
        method,
        path,
        completed: false,
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string } | undefined)?.code ===
          UNIQUE_VIOLATION
      ) {
        throw new ConflictException(
          'العملية نفسها قيد التنفيذ — أعد المحاولة بعد لحظات',
        );
      }
      throw error;
    }

    return next.handle().pipe(
      mergeMap(async (data: unknown) => {
        await this.records.update(
          { userId, key },
          // نسخة JSON: ما يصل العميل فعلاً (التواريخ نصوص)
          { completed: true, response: toJson(data) as object },
        );
        return data;
      }),
      catchError((error: unknown) =>
        from(this.records.delete({ userId, key })).pipe(
          mergeMap(() => throwError(() => error)),
        ),
      ),
    );
  }
}

const toJson = (data: unknown): unknown =>
  data === undefined ? null : (JSON.parse(JSON.stringify(data)) as unknown);
