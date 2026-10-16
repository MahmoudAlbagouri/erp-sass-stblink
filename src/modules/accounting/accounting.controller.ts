// src/modules/accounting/accounting.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FEATURES } from '../../common/constants/features';
import { PERMS } from '../../common/constants/permissions';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard';
import { apiTag } from '../../config/swagger.config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChartService } from './chart.service';
import { CompanyWideInterceptor } from './company-wide.interceptor';
import {
  ActivateAccountingDto,
  BalanceSheetQueryDto,
  CreateAccountDto,
  CreateJournalEntryDto,
  JournalQueryDto,
  LedgerQueryDto,
  PeriodQueryDto,
  ReverseJournalEntryDto,
  TrialBalanceQueryDto,
  UpdateAccountDto,
  UpdateAccountingSettingsDto,
} from './dto/accounting.dto';
import { JournalsService } from './journals.service';
import { PostingService } from './posting.service';
import { ReportsService } from './reports.service';
import { SetupService } from './setup.service';
import { buildChartTemplate } from './templates/chart-templates';

@ApiTags(apiTag('ACCOUNTING'))
@Controller('accounting')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@UseInterceptors(CompanyWideInterceptor)
@RequiresFeature(FEATURES.ACCOUNTING_MODULE)
export class AccountingController {
  constructor(
    private readonly setup: SetupService,
    private readonly chart: ChartService,
    private readonly journals: JournalsService,
    private readonly reports: ReportsService,
    private readonly posting: PostingService,
  ) {}

  // ─── التفعيل والإعدادات ───

  /** حالة المحاسبة: مفعّلة؟ إعداداتها، حسابات طرق الدفع، والمستندات التي تعذّر ترحيلها */
  @Get('status')
  @Permissions(PERMS.ACCOUNTING_VIEW)
  status(@CurrentTenantId() tenantId: string) {
    return this.setup.status(tenantId);
  }

  /** معاينة الشجرة الجاهزة لدولة قبل التفعيل */
  @Get('templates/:country')
  @Permissions(PERMS.ACCOUNTING_VIEW)
  template(@Param('country') country: string) {
    return buildChartTemplate(country);
  }

  /** تفعيل المحاسبة: شجرة الدولة + القيد الافتتاحي بأرصدة الآن، ومن بعدها ترحيل تلقائي */
  @Post('activate')
  @Permissions(PERMS.ACCOUNTING_SETTINGS_MANAGE)
  activate(
    @Body() dto: ActivateAccountingDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.setup.activate(tenantId, dto, userId);
  }

  /** قفل الفترة وحسابات طرق القبض والدفع */
  @Patch('settings')
  @Permissions(PERMS.ACCOUNTING_SETTINGS_MANAGE)
  updateSettings(
    @Body() dto: UpdateAccountingSettingsDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.setup.updateSettings(tenantId, dto);
  }

  /** ترحيل الآن (ومعه إعادة محاولة ما تعذّر ترحيله) */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.ACCOUNTING_SETTINGS_MANAGE)
  async sync(@CurrentTenantId() tenantId: string) {
    await this.setup.settingsOf(tenantId);
    return this.posting.sync(tenantId, true);
  }

  // ─── شجرة الحسابات ───

  /** شجرة الحسابات كاملة (مرتبة بالكود) */
  @Get('accounts')
  @Permissions(PERMS.ACCOUNTING_VIEW)
  accounts(@CurrentTenantId() tenantId: string) {
    return this.chart.findAll(tenantId);
  }

  /** إضافة حساب تحت حساب تجميعي */
  @Post('accounts')
  @Permissions(PERMS.ACCOUNTS_MANAGE)
  createAccount(
    @Body() dto: CreateAccountDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.chart.create(dto, tenantId);
  }

  /** تعديل حساب أو نقله أو إيقافه */
  @Patch('accounts/:id')
  @Permissions(PERMS.ACCOUNTS_MANAGE)
  updateAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.chart.update(id, dto, tenantId);
  }

  /** حذف حساب بلا قيود ولا حسابات تحته (حساب النظام لا يُحذف) */
  @Delete('accounts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(PERMS.ACCOUNTS_MANAGE)
  removeAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.chart.remove(id, tenantId);
  }

  // ─── القيود ───

  /** دفتر اليومية: القيود بفلاتر التاريخ والمصدر والحساب والبحث */
  @Get('journals')
  @Permissions(PERMS.ACCOUNTING_VIEW)
  async journalsList(
    @Query() query: JournalQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    await this.posting.sync(tenantId);
    return this.journals.findAll(tenantId, query);
  }

  /** قيد واحد بأسطره (الحساب، الفرع، الطرف) */
  @Get('journals/:id')
  @Permissions(PERMS.ACCOUNTING_VIEW)
  journal(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.journals.findOne(id, tenantId);
  }

  /** قيد يدوي (متوازن، على حسابات فرعية، في فترة مفتوحة) */
  @Post('journals')
  @Permissions(PERMS.JOURNAL_CREATE)
  createJournal(
    @Body() dto: CreateJournalEntryDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.journals.create(tenantId, dto, userId);
  }

  /** عكس قيد يدوي بقيد معاكس (قيود المستندات تُصحَّح بمستنداتها) */
  @Post('journals/:id/reverse')
  @Permissions(PERMS.JOURNAL_CREATE)
  reverseJournal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseJournalEntryDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.journals.reverse(tenantId, id, dto, userId);
  }

  // ─── التقارير (تُرحَّل المستندات الجديدة قبلها) ───

  /** ميزان المراجعة: رصيد أول المدة وحركة الفترة والرصيد الختامي لكل حساب */
  @Get('reports/trial-balance')
  @Permissions(PERMS.ACCOUNTING_VIEW)
  async trialBalance(
    @Query() query: TrialBalanceQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    await this.posting.sync(tenantId);
    return this.reports.trialBalance(tenantId, query);
  }

  /** كشف حساب (دفتر الأستاذ) برصيد متحرك، ولطرف واحد إن شئت */
  @Get('reports/ledger')
  @Permissions(PERMS.ACCOUNTING_VIEW)
  async ledger(
    @Query() query: LedgerQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    await this.posting.sync(tenantId);
    return this.reports.ledger(tenantId, query);
  }

  /** قائمة الدخل: الإيرادات والمصروفات ومجمل وصافي الربح لفترة */
  @Get('reports/income-statement')
  @Permissions(PERMS.ACCOUNTING_VIEW)
  async incomeStatement(
    @Query() query: PeriodQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    await this.posting.sync(tenantId);
    return this.reports.incomeStatement(tenantId, query);
  }

  /** الميزانية (المركز المالي) في تاريخ */
  @Get('reports/balance-sheet')
  @Permissions(PERMS.ACCOUNTING_VIEW)
  async balanceSheet(
    @Query() query: BalanceSheetQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    await this.posting.sync(tenantId);
    return this.reports.balanceSheet(tenantId, query);
  }
}
