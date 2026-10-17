// src/modules/accounting/accounting.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportService } from '../../common/reports/report.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AccountingExportController } from './accounting-export.controller';
import { AccountingExportService } from './accounting-export.service';
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
import {
  ExpenseVoucher,
  ExpenseVoucherLine,
} from './entities/expense-voucher.entity';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { JournalsService } from './journals.service';
import { LedgerService } from './ledger.service';
import { PostingService } from './posting.service';
import { ReportsService } from './reports.service';
import { SetupService } from './setup.service';
import { VatReturnService } from './vat-return.service';
import { YearEndService } from './year-end.service';

/**
 * المحاسبة بالقيد المزدوج: شجرة حسابات لكل دولة، دفتر يومية لا يُعدَّل،
 * ترحيل تلقائي لكل المستندات، قفل الفترات وإقفال السنة، سندات الصرف،
 * إقرار ضريبة القيمة المضافة، والقوائم المالية (وتصديرها Excel / PDF).
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
      ExpenseVoucher,
      ExpenseVoucherLine,
    ]),
    SubscriptionsModule, // SubscriptionGuard
  ],
  controllers: [
    AccountingController,
    ExpensesController,
    AccountingExportController,
  ],
  providers: [
    LedgerService,
    ChartService,
    PostingService,
    SetupService,
    JournalsService,
    ReportsService,
    ExpensesService,
    YearEndService,
    VatReturnService,
    AccountingExportService,
    ReportService,
    AccountingCron,
  ],
  exports: [PostingService],
})
export class AccountingModule {}
