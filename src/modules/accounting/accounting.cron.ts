// src/modules/accounting/accounting.cron.ts
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PostingService } from './posting.service';

/**
 * ترحيل دوري: كل دقيقة يُرحَّل ما وقع من مستندات في كل شركة فعّلت المحاسبة
 * (والتقارير ترحّل قبل عرضها أيضاً). دورة جارية لا تتكرر فوق نفسها.
 */
@Injectable()
export class AccountingCron {
  private running = false;

  constructor(private readonly posting: PostingService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    if (this.running || process.env.NODE_ENV === 'test') return;
    this.running = true;
    try {
      await this.posting.syncAll();
    } finally {
      this.running = false;
    }
  }
}
