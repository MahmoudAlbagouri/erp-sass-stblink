// src/modules/accounting/expenses.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  paginated,
  Paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import { nextDocumentNumber } from '../../common/utils/document-number.util';
import { moneyDecimalsOf } from '../../common/utils/money.util';
import { vatRegisteredOf } from '../../common/utils/vat.util';
import {
  AccountType,
  EXPENSE_VOUCHER_PREFIX,
  JournalSource,
  SUBLEDGER_ACCOUNTS,
  SystemAccount,
} from './accounting.constants';
import {
  CancelExpenseVoucherDto,
  CreateExpenseVoucherDto,
  ExpenseQueryDto,
} from './dto/accounting.dto';
import { Account, JournalEntry } from './entities/accounting.entity';
import {
  ExpenseVoucher,
  ExpenseVoucherLine,
  ExpenseVoucherStatus,
} from './entities/expense-voucher.entity';
import { LedgerLineInput, LedgerService } from './ledger.service';
import { SetupService } from './setup.service';

const NOT_FOUND = 'سند الصرف غير موجود';

export interface ExpenseVoucherView extends ExpenseVoucher {
  paidFromName: string;
  lines: (ExpenseVoucherLine & {
    accountCode: string;
    accountName: string;
    branchName: string | null;
  })[];
}

/**
 * سندات الصرف: المصروف يُقيَّد لحظة حفظه في نفس المعاملة (مستند محاسبي، لا
 * ينتظر محرك الترحيل): من حساب المصروف (وضريبة المدخلات إن كانت مستردة) إلى
 * الصندوق أو البنك. لا يُعدَّل؛ الإلغاء قيد عكسي بتاريخه.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly setup: SetupService,
  ) {}

  async findAll(
    tenantId: string,
    query: ExpenseQueryDto,
  ): Promise<Paginated<ExpenseVoucher>> {
    const { page, limit, skip } = resolvePagination(query);
    const qb = this.dataSource
      .getRepository(ExpenseVoucher)
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.paidFromAccount', 'paidFrom')
      .where('v.tenantId = :tenantId', { tenantId });
    if (query.from) qb.andWhere('v.date >= :from', { from: query.from });
    if (query.to) qb.andWhere('v.date <= :to', { to: query.to });
    if (query.status)
      qb.andWhere('v.status = :status', { status: query.status });
    if (query.accountId) {
      qb.andWhere(
        `(v.paidFromAccountId = :accountId OR EXISTS (SELECT 1 FROM expense_voucher_lines l
           WHERE l."voucherId" = v.id AND l."accountId" = :accountId))`,
        { accountId: query.accountId },
      );
    }
    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        `(v.number ILIKE :like OR v.payee ILIKE :like OR v.reference ILIKE :like
          OR v.description ILIKE :like)`,
        { like: `%${search}%` },
      );
    }
    const [data, total] = await qb
      .orderBy('v.date', 'DESC')
      .addOrderBy('v.number', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();
    return paginated(data, total, page, limit);
  }

  async findOne(id: string, tenantId: string): Promise<ExpenseVoucherView> {
    const voucher = await this.dataSource.manager.findOne(ExpenseVoucher, {
      where: { id, tenantId },
      relations: ['paidFromAccount'],
      withDeleted: true,
    });
    if (!voucher) throw new NotFoundException(NOT_FOUND);
    const lines = await this.dataSource.manager.find(ExpenseVoucherLine, {
      where: { voucherId: id },
      relations: ['account'],
      withDeleted: true,
      order: { lineOrder: 'ASC' },
    });
    const branchIds = [
      ...new Set(lines.map((l) => l.branchId).filter(Boolean)),
    ];
    const branches = branchIds.length
      ? await this.dataSource.query<{ id: string; name: string }[]>(
          `SELECT "id", "name" FROM branches WHERE "tenantId" = $1 AND "id" = ANY($2::uuid[])`,
          [tenantId, branchIds],
        )
      : [];
    const branchName = new Map(branches.map((b) => [b.id, b.name]));
    return {
      ...voucher,
      paidFromName: voucher.paidFromAccount
        ? `${voucher.paidFromAccount.code} ${voucher.paidFromAccount.name}`
        : '',
      lines: lines.map((line) => ({
        ...line,
        accountCode: line.account?.code ?? '',
        accountName: line.account?.name ?? '',
        account: undefined,
        branchName: line.branchId
          ? (branchName.get(line.branchId) ?? null)
          : null,
      })),
    };
  }

  async create(
    tenantId: string,
    dto: CreateExpenseVoucherDto,
    userId?: string,
  ): Promise<ExpenseVoucherView> {
    const settings = await this.setup.settingsOf(tenantId);
    const id = await this.dataSource.transaction(async (manager) => {
      await this.assertAccounts(manager, tenantId, dto);
      await this.assertBranches(manager, tenantId, dto);

      const decimals = await moneyDecimalsOf(manager, tenantId);
      const round = (v: Decimal) =>
        v.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
      const recoverable = await vatRegisteredOf(manager, tenantId);

      const lines = dto.lines.map((line, index) => {
        const amount = round(new Decimal(line.amount));
        const rate = new Decimal(line.taxRate ?? 0);
        const tax = round(amount.mul(rate).div(100));
        return {
          index,
          accountId: line.accountId,
          description: line.description?.trim() || null,
          branchId: line.branchId ?? null,
          amount,
          rate,
          tax,
          total: amount.plus(tax),
        };
      });
      const subtotal = lines.reduce((t, l) => t.plus(l.amount), new Decimal(0));
      const taxTotal = lines.reduce((t, l) => t.plus(l.tax), new Decimal(0));
      const total = subtotal.plus(taxTotal);

      const voucher = await manager.save(
        manager.create(ExpenseVoucher, {
          tenantId,
          number: await nextDocumentNumber(
            manager,
            'expense_vouchers',
            EXPENSE_VOUCHER_PREFIX,
            tenantId,
          ),
          date: dto.date,
          paidFromAccountId: dto.paidFromAccountId,
          payee: dto.payee.trim(),
          payeeTaxNumber: dto.payeeTaxNumber?.trim() || null,
          reference: dto.reference?.trim() || null,
          description: dto.description.trim(),
          status: ExpenseVoucherStatus.POSTED,
          subtotal: subtotal.toNumber(),
          taxTotal: taxTotal.toNumber(),
          total: total.toNumber(),
          taxRecoverable: recoverable && taxTotal.gt(0),
          createdById: userId ?? null,
        }),
      );
      await manager.insert(
        ExpenseVoucherLine,
        lines.map((line) => ({
          tenantId,
          voucherId: voucher.id,
          lineOrder: line.index,
          accountId: line.accountId,
          description: line.description,
          amount: line.amount.toNumber(),
          taxRate: line.rate.toNumber(),
          taxAmount: line.tax.toNumber(),
          total: line.total.toNumber(),
          branchId: line.branchId,
        })),
      );

      // ─── القيد: المصروف (والضريبة المستردة) من الصندوق/البنك ───
      const vatInput = recoverable
        ? await this.systemAccount(manager, tenantId, SystemAccount.VAT_INPUT)
        : null;
      const entryLines: LedgerLineInput[] = [];
      for (const line of lines) {
        entryLines.push({
          accountId: line.accountId,
          // غير المسجّلة: الضريبة جزء من المصروف
          debit: (vatInput ? line.amount : line.total).toNumber(),
          description: line.description,
          branchId: line.branchId,
        });
        if (vatInput && line.tax.gt(0)) {
          entryLines.push({
            accountId: vatInput,
            debit: line.tax.toNumber(),
            description: `ضريبة مدخلات — ${voucher.number}`,
            branchId: line.branchId,
          });
        }
      }
      entryLines.push({
        accountId: dto.paidFromAccountId,
        credit: total.toNumber(),
        description: `سند صرف ${voucher.number} — ${voucher.payee}`,
      });
      const entry = await this.ledger.post(
        manager,
        {
          tenantId,
          date: dto.date,
          description: `سند صرف ${voucher.number}: ${voucher.description} — ${voucher.payee}`,
          sourceType: JournalSource.EXPENSE_VOUCHER,
          sourceId: voucher.id,
          sourceEvent: 'post',
          sourceRef: voucher.number,
          lines: entryLines,
          createdById: userId ?? null,
          automatic: false,
        },
        settings,
      );
      await manager.update(
        ExpenseVoucher,
        { id: voucher.id, tenantId },
        { journalEntryId: entry?.id ?? null },
      );
      return voucher.id;
    });
    return this.findOne(id, tenantId);
  }

  /** إلغاء سند: قيد عكسي بتاريخ الإلغاء (في فترة مفتوحة)، والسند يبقى للمراجعة */
  async cancel(
    tenantId: string,
    id: string,
    dto: CancelExpenseVoucherDto,
    userId?: string,
  ): Promise<ExpenseVoucherView> {
    const settings = await this.setup.settingsOf(tenantId);
    await this.dataSource.transaction(async (manager) => {
      const voucher = await manager.findOne(ExpenseVoucher, {
        where: { id, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!voucher) throw new NotFoundException(NOT_FOUND);
      if (voucher.status === ExpenseVoucherStatus.CANCELLED) {
        throw new ConflictException('السند ملغي من قبل');
      }
      const original = voucher.journalEntryId
        ? await manager.findOne(JournalEntry, {
            where: { id: voucher.journalEntryId, tenantId },
            relations: ['lines'],
          })
        : null;

      let reversalId: string | null = null;
      if (original?.lines?.length) {
        const reversal = await this.ledger.post(
          manager,
          {
            tenantId,
            date: dto.date,
            description: `إلغاء سند الصرف ${voucher.number}: ${dto.reason.trim()}`,
            sourceType: JournalSource.EXPENSE_VOUCHER,
            sourceId: voucher.id,
            sourceEvent: 'cancel',
            sourceRef: voucher.number,
            lines: original.lines
              .sort((a, b) => a.lineOrder - b.lineOrder)
              .map((line) => ({
                accountId: line.accountId,
                debit: line.credit,
                credit: line.debit,
                description: line.description,
                branchId: line.branchId,
              })),
            createdById: userId ?? null,
            reversalOfId: original.id,
            automatic: false,
          },
          settings,
        );
        reversalId = reversal?.id ?? null;
        if (reversalId) {
          await manager.update(
            JournalEntry,
            { id: original.id, tenantId },
            { reversedById: reversalId },
          );
        }
      }
      await manager.update(
        ExpenseVoucher,
        { id, tenantId },
        {
          status: ExpenseVoucherStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelDate: dto.date,
          cancelReason: dto.reason.trim(),
          cancelJournalEntryId: reversalId,
        },
      );
    });
    return this.findOne(id, tenantId);
  }

  /**
   * يُدفع من حساب أصول فرعي فعّال (صندوق، بنك). البنود على حسابات فرعية فعّالة
   * غير حساب الدفع، ولا على حساب له دفتر مساعد (العملاء، الموردون، المخزون…):
   * تلك تتحرك بمستنداتها.
   */
  private async assertAccounts(
    manager: EntityManager,
    tenantId: string,
    dto: CreateExpenseVoucherDto,
  ): Promise<void> {
    const ids = [
      ...new Set([dto.paidFromAccountId, ...dto.lines.map((l) => l.accountId)]),
    ];
    const accounts = await manager.find(Account, {
      where: { tenantId, id: In(ids) },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const paidFrom = byId.get(dto.paidFromAccountId);
    if (!paidFrom) throw new BadRequestException('حساب الدفع غير موجود');
    if (
      paidFrom.isGroup ||
      !paidFrom.isActive ||
      paidFrom.type !== AccountType.ASSET
    ) {
      throw new BadRequestException(
        `"${paidFrom.name}": ادفع من حساب أصول فرعي فعّال (صندوق، بنك)`,
      );
    }
    for (const line of dto.lines) {
      const account = byId.get(line.accountId);
      if (!account) throw new BadRequestException('حساب في البنود غير موجود');
      if (account.isGroup || !account.isActive) {
        throw new BadRequestException(
          `"${account.code} ${account.name}": اختر حساباً فرعياً فعّالاً`,
        );
      }
      if (account.id === paidFrom.id) {
        throw new BadRequestException('حساب المصروف هو نفس حساب الدفع');
      }
      if (
        account.systemKey &&
        SUBLEDGER_ACCOUNTS.includes(account.systemKey as SystemAccount)
      ) {
        throw new BadRequestException(
          `"${account.name}" يتحرك بمستنداته (سداد مورد، سند قبض، فاتورة…) لا بسند صرف`,
        );
      }
    }
  }

  private async assertBranches(
    manager: EntityManager,
    tenantId: string,
    dto: CreateExpenseVoucherDto,
  ): Promise<void> {
    const ids = [...new Set(dto.lines.map((l) => l.branchId).filter(Boolean))];
    if (!ids.length) return;
    const [{ count }] = await manager.query<{ count: string }[]>(
      `SELECT COUNT(*) AS "count" FROM branches
        WHERE "tenantId" = $1 AND "id" = ANY($2::uuid[]) AND "deletedAt" IS NULL`,
      [tenantId, ids],
    );
    if (Number(count) !== ids.length) {
      throw new BadRequestException('فرع في البنود غير موجود');
    }
  }

  private async systemAccount(
    manager: EntityManager,
    tenantId: string,
    key: SystemAccount,
  ): Promise<string> {
    const account = await manager.findOne(Account, {
      where: { tenantId, systemKey: key },
      select: ['id'],
    });
    if (!account) {
      throw new BadRequestException(
        `حساب النظام "${key}" غير موجود في الشجرة — أعد إضافته`,
      );
    }
    return account.id;
  }
}
