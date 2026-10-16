// src/modules/accounting/accounting.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AccountingController } from './accounting.controller';
import { AccountingCron } from './accounting.cron';
import { ChartService } from './chart.service';
import {
  Account,
  AccountingSettings,
  JournalEntry,
  JournalLine,
  OpeningBaseline,
  PostingError,
  SkippedSource,
} from './entities/accounting.entity';
import { JournalsService } from './journals.service';
import { LedgerService } from './ledger.service';
import { PostingService } from './posting.service';
import { ReportsService } from './reports.service';
import { SetupService } from './setup.service';

/**
 * المحاسبة بالقيد المزدوج: شجرة حسابات لكل دولة، دفتر يومية لا يُعدَّل،
 * ترحيل تلقائي لكل المستندات، قفل الفترات، والقوائم المالية.
 *
 * لا تستورد موديولات المستندات: تقرأ جداولها (كياناتها) مباشرة في محرك
 * الترحيل، فلا تعتمد عليها تلك الموديولات ولا تنتظرها. التوثيق:
 * docs/modules/accounting.md
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Account,
      JournalEntry,
      JournalLine,
      AccountingSettings,
      PostingError,
      SkippedSource,
      OpeningBaseline,
    ]),
    SubscriptionsModule, // SubscriptionGuard
  ],
  controllers: [AccountingController],
  providers: [
    LedgerService,
    ChartService,
    PostingService,
    SetupService,
    JournalsService,
    ReportsService,
    AccountingCron,
  ],
  exports: [PostingService],
})
export class AccountingModule {}
