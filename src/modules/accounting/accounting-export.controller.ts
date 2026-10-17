// src/modules/accounting/accounting-export.controller.ts
import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { FEATURES } from '../../common/constants/features';
import { PERMS } from '../../common/constants/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard';
import {
  assertReportFormat,
  ReportService,
} from '../../common/reports/report.service';
import type { CurrentUserData } from '../../common/types/auth.types';
import { apiTag } from '../../config/swagger.config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionManagerService } from '../subscriptions/subscription-manager.service';
import {
  AccountingExportService,
  ExportReport,
} from './accounting-export.service';
import { CompanyWideInterceptor } from './company-wide.interceptor';
import {
  BalanceSheetQueryDto,
  ExpenseQueryDto,
  JournalQueryDto,
  LedgerQueryDto,
  PeriodQueryDto,
  TrialBalanceQueryDto,
  VatReturnQueryDto,
} from './dto/accounting.dto';
import { PostingService } from './posting.service';

/**
 * تصدير تقارير المحاسبة (excel أو pdf). الباقة تحتاج الميزتين: المحاسبة
 * وتصدير التقارير — الثانية بالحارس والأولى هنا.
 */
@ApiTags(apiTag('ACCOUNTING'))
@Controller('accounting')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@UseInterceptors(CompanyWideInterceptor)
@RequiresFeature(FEATURES.REPORTS_EXPORT)
export class AccountingExportController {
  constructor(
    private readonly exports: AccountingExportService,
    private readonly reportService: ReportService,
    private readonly posting: PostingService,
    private readonly subscriptions: SubscriptionManagerService,
  ) {}

  /** تصدير ميزان المراجعة */
  @Get('reports/trial-balance/export/:type')
  @Permissions(PERMS.ACCOUNTING_VIEW)
  async trialBalance(
    @Param('type') type: string,
    @Query() query: TrialBalanceQueryDto,
    @CurrentUser() user: CurrentUserData,
    @Res() res: Response,
  ) {
    const format = await this.prepare(type, user, true);
    await this.send(
      res,
      format,
      await this.exports.trialBalance(user.tenantId, query, format),
    );
  }

  /** تصدير كشف حساب (دفتر الأستاذ) */
  @Get('reports/ledger/export/:type')
  @Permissions(PERMS.ACCOUNTING_VIEW)
  async ledger(
    @Param('type') type: string,
    @Query() query: LedgerQueryDto,
    @CurrentUser() user: CurrentUserData,
    @Res() res: Response,
  ) {
    const format = await this.prepare(type, user, true);
    await this.send(
      res,
      format,
      await this.exports.ledger(user.tenantId, query, format),
    );
  }

  /** تصدير قائمة الدخل */
  @Get('reports/income-statement/export/:type')
  @Permissions(PERMS.ACCOUNTING_VIEW)
  async incomeStatement(
    @Param('type') type: string,
    @Query() query: PeriodQueryDto,
    @CurrentUser() user: CurrentUserData,
    @Res() res: Response,
  ) {
    const format = await this.prepare(type, user, true);
    await this.send(
      res,
      format,
      await this.exports.incomeStatement(user.tenantId, query, format),
    );
  }

  /** تصدير الميزانية */
  @Get('reports/balance-sheet/export/:type')
  @Permissions(PERMS.ACCOUNTING_VIEW)
  async balanceSheet(
    @Param('type') type: string,
    @Query() query: BalanceSheetQueryDto,
    @CurrentUser() user: CurrentUserData,
    @Res() res: Response,
  ) {
    const format = await this.prepare(type, user, true);
    await this.send(
      res,
      format,
      await this.exports.balanceSheet(user.tenantId, query, format),
    );
  }

  /** تصدير إقرار ضريبة القيمة المضافة */
  @Get('reports/vat-return/export/:type')
  @Permissions(PERMS.ACCOUNTING_VIEW)
  async vatReturn(
    @Param('type') type: string,
    @Query() query: VatReturnQueryDto,
    @CurrentUser() user: CurrentUserData,
    @Res() res: Response,
  ) {
    const format = await this.prepare(type, user, false);
    await this.send(
      res,
      format,
      await this.exports.vatReturn(user.tenantId, query, format),
    );
  }

  /** تصدير دفتر اليومية (أسطر القيود بفلاتر الصفحة) */
  @Get('journals/export/:type')
  @Permissions(PERMS.ACCOUNTING_VIEW)
  async journals(
    @Param('type') type: string,
    @Query() query: JournalQueryDto,
    @CurrentUser() user: CurrentUserData,
    @Res() res: Response,
  ) {
    const format = await this.prepare(type, user, true);
    await this.send(
      res,
      format,
      await this.exports.journals(user.tenantId, query, format),
    );
  }

  /** تصدير سندات الصرف بفلاتر الصفحة */
  @Get('expenses/export/:type')
  @Permissions(PERMS.ACCOUNTING_VIEW)
  async expenses(
    @Param('type') type: string,
    @Query() query: ExpenseQueryDto,
    @CurrentUser() user: CurrentUserData,
    @Res() res: Response,
  ) {
    const format = await this.prepare(type, user, false);
    await this.send(
      res,
      format,
      await this.exports.expenses(user.tenantId, query, format),
    );
  }

  /** الصيغة، وميزة المحاسبة في الباقة، وترحيل المستندات الجديدة قبل التقرير */
  private async prepare(type: string, user: CurrentUserData, sync: boolean) {
    assertReportFormat(type);
    if (
      !user.isSystemAdmin &&
      !(await this.subscriptions.hasFeature(
        user.tenantId,
        FEATURES.ACCOUNTING_MODULE.name,
      ))
    ) {
      throw new ForbiddenException(
        `هذه الميزة (${FEATURES.ACCOUNTING_MODULE.name}) غير متاحة ضمن خطتكم الحالية`,
      );
    }
    if (sync) await this.posting.sync(user.tenantId);
    return type;
  }

  private send(res: Response, format: string, report: ExportReport) {
    return this.reportService.sendReport(res, format, report);
  }
}
