// src/common/idempotency/idempotency.module.ts
import { Injectable, Logger, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Cron } from '@nestjs/schedule';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { IdempotencyRecord } from './idempotency-record.entity';
import { IdempotencyInterceptor } from './idempotency.interceptor';

/** طابور جهاز بلا إنترنت أكثر من هذا لا يُتوقع: بعده تُنسى المفاتيح */
const KEEP_DAYS = 30;
/** حجز لم يكتمل (توقف السيرفر في منتصف الطلب) يُحرَّر بعد هذه المدة */
const STALE_PENDING_MS = 60 * 60 * 1000;

@Injectable()
export class IdempotencyCleanup {
  private readonly logger = new Logger(IdempotencyCleanup.name);

  constructor(
    @InjectRepository(IdempotencyRecord)
    private readonly records: Repository<IdempotencyRecord>,
  ) {}

  @Cron('15 4 * * *', { name: 'idempotency-cleanup' })
  async run(now = new Date()): Promise<number> {
    const old = await this.records.delete({
      createdAt: LessThan(new Date(now.getTime() - KEEP_DAYS * 86_400_000)),
    });
    const stale = await this.records.delete({
      completed: false,
      createdAt: LessThan(new Date(now.getTime() - STALE_PENDING_MS)),
    });
    const removed = (old.affected ?? 0) + (stale.affected ?? 0);
    if (removed) this.logger.log(`حُذف ${removed} مفتاح عملية قديم`);
    return removed;
  }
}

/**
 * عمليات حفظ آمنة الإعادة بترويسة `Idempotency-Key` — لطوابير العمل بلا إنترنت
 * في التطبيق ولوحة التحكم (انظر docs/offline.md).
 */
@Module({
  imports: [TypeOrmModule.forFeature([IdempotencyRecord])],
  providers: [
    IdempotencyCleanup,
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class IdempotencyModule {}
