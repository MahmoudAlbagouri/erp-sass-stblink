// src/modules/sales/sales-quotes.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  paginated,
  Paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import { moneyDecimalsOf } from '../../common/utils/money.util';
import { tenantCalendarOf } from '../../common/utils/timezone.util';
import {
  assertWarehouseVisible,
  restrictToScopedWarehouses,
} from '../branches/branch-scope';
import { SalesQuoteQueryDto } from './dto/sales.dto';
import { SalesInvoice } from './entities/sales-invoice.entity';
import { SalesQuote, SalesQuoteStatus } from './entities/sales-quote.entity';
import {
  PosSaleInput,
  SalesInvoicesService,
  totalsOf,
} from './sales-invoices.service';
import { SalesSettingsService } from './sales-settings.service';

/** عرض سعر أصدره جهاز كاشير، كما يرفعه */
export interface PosQuoteInput extends Pick<
  PosSaleInput,
  'uuid' | 'number' | 'issuedAt' | 'pricesIncludeTax' | 'lines'
> {
  validUntil: string;
  warehouseId: string;
  deviceId: string;
  shiftId: string;
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerTaxNumber?: string | null;
  note?: string | null;
  cashierName?: string | null;
  approvedBy?: string | null;
}

/**
 * عروض أسعار العملاء. قائم ──بيع──▶ حُوّل لفاتورة، أو ملغي من لوحة التحكم.
 * لا يمس المخزون ولا الوردية ولا حساب العميل، وعند التحويل تسري قواعد البيع
 * العادية (الرصيد، الدرج، الترقيم) لأن الفاتورة هي التي تُسجَّل.
 */
@Injectable()
export class SalesQuotesService {
  constructor(
    @InjectRepository(SalesQuote)
    private readonly quotes: Repository<SalesQuote>,
    private readonly invoices: SalesInvoicesService,
    private readonly settings: SalesSettingsService,
    private readonly dataSource: DataSource,
  ) {}

  // ══════════════════════════ القراءة ══════════════════════════

  async findAll(
    tenantId: string,
    query: SalesQuoteQueryDto,
  ): Promise<Paginated<SalesQuote>> {
    const { page, limit, skip } = resolvePagination(query);
    const { today } = await tenantCalendarOf(this.dataSource.manager, tenantId);

    const qb = this.quotes
      .createQueryBuilder('quote')
      .leftJoinAndSelect('quote.warehouse', 'warehouse')
      .leftJoinAndSelect('warehouse.branch', 'branch')
      .where('quote.tenantId = :tenantId', { tenantId });
    restrictToScopedWarehouses(qb, 'quote.warehouseId');

    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        '(quote.number ILIKE :like OR quote.customerName ILIKE :like OR quote.customerPhone ILIKE :like)',
        { like: `%${search}%` },
      );
    }
    if (query.status === 'open' || query.status === 'expired') {
      qb.andWhere('quote.status = :open', { open: SalesQuoteStatus.OPEN });
      qb.andWhere(
        query.status === 'open'
          ? 'quote.validUntil >= :today'
          : 'quote.validUntil < :today',
        { today },
      );
    } else if (query.status) {
      qb.andWhere('quote.status = :status', { status: query.status });
    }

    const [data, total] = await qb
      .orderBy('quote.issuedAt', 'DESC')
      .addOrderBy('quote.id', 'ASC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    data.forEach((quote) => markExpiry(quote, today));
    return paginated(data, total, page, limit);
  }

  async findOne(id: string, tenantId: string): Promise<SalesQuote> {
    const quote = await this.quotes.findOne({
      where: { id, tenantId },
      relations: ['warehouse', 'warehouse.branch'],
    });
    if (!quote) throw new NotFoundException('عرض السعر غير موجود');
    assertWarehouseVisible(quote.warehouseId, 'عرض السعر غير موجود');
    return this.withExpiry(quote);
  }

  /** عرض برقمه المطبوع (أي عرض للشركة، من أي شاشة) */
  async findByNumber(number: string, tenantId: string): Promise<SalesQuote> {
    const quote = await this.quotes.findOne({
      // الأرقام تُولَّد بحروف كبيرة؛ الكاشير قد يكتبها صغيرة
      where: { number: number.trim().toUpperCase(), tenantId },
    });
    if (!quote) {
      throw new NotFoundException(`لا يوجد عرض سعر برقم "${number}"`);
    }
    return this.withExpiry(quote);
  }

  private async withExpiry(quote: SalesQuote): Promise<SalesQuote> {
    const { today } = await tenantCalendarOf(
      this.dataSource.manager,
      quote.tenantId,
    );
    return markExpiry(quote, today);
  }

  // ══════════════════════════ من الجهاز ══════════════════════════

  /**
   * يسجّل عرضاً أصدره جهاز كاشير. الورقة في يد العميل: المبالغ تُعتمد كما
   * طُبعت بعد التحقق من اتساقها، والأسعار والموافقات فُحصت على الجهاز.
   *
   * @returns duplicate: true إذا كان العرض مسجّلاً من قبل (رفع مكرر)
   */
  async recordPosQuote(
    input: PosQuoteInput,
    tenantId: string,
    userId?: string,
  ): Promise<{ duplicate: boolean }> {
    if (await this.existsByUuid(input.uuid, tenantId)) {
      return { duplicate: true };
    }

    const [decimals, seller] = await Promise.all([
      moneyDecimalsOf(this.dataSource.manager, tenantId),
      this.settings.get(tenantId),
    ]);
    const { lines } = await this.invoices.posLines(
      input,
      tenantId,
      decimals,
      seller.vatRegistered,
    );

    try {
      await this.quotes.insert({
        tenantId,
        uuid: input.uuid,
        number: input.number,
        warehouseId: input.warehouseId,
        deviceId: input.deviceId,
        shiftId: input.shiftId,
        customerId: input.customerId ?? null,
        customerName: input.customerName ?? null,
        customerPhone: input.customerPhone ?? null,
        customerTaxNumber: input.customerTaxNumber ?? null,
        cashierName: input.cashierName ?? null,
        approvedBy: input.approvedBy ?? null,
        createdById: userId ?? null,
        issuedAt: input.issuedAt,
        validUntil: input.validUntil,
        pricesIncludeTax: input.pricesIncludeTax,
        note: input.note ?? null,
        ...totalsOf(lines),
        lines: lines.map((line) => ({
          productId: line.productId,
          productName: line.productName,
          sku: line.sku,
          unitId: line.unitId,
          unitName: line.unitName,
          factor: line.factor,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          listPrice: line.listPrice ?? null,
          priceReason: line.priceReason ?? null,
          discount: line.discount,
          taxRate: line.taxRate,
          subtotal: line.subtotal,
          taxAmount: line.taxAmount,
          total: line.total,
        })),
      });
    } catch (error) {
      if ((error as { code?: string } | null)?.code !== '23505') throw error;
      // طلب مزامنة آخر سبقنا بنفس العرض ← رفع مكرر. غير ذلك: الرقم مأخوذ
      if (await this.existsByUuid(input.uuid, tenantId)) {
        return { duplicate: true };
      }
      throw new ConflictException(`رقم عرض السعر "${input.number}" مستخدم`);
    }
    return { duplicate: false };
  }

  private existsByUuid(uuid: string, tenantId: string): Promise<boolean> {
    return this.quotes.existsBy({ tenantId, uuid });
  }

  /**
   * عرض تحوّل لفاتورة. لا يرمي أبداً: البيع وقع، ولا يُرفض لأن عرضه لم يصل أو
   * سبق تحويله من شاشة أخرى بلا إنترنت (الأول يبقى هو المسجّل). الرفع المكرر
   * لا يغيّر شيئاً.
   */
  async markConverted(
    uuid: string,
    invoice: SalesInvoice,
    tenantId: string,
  ): Promise<void> {
    await this.quotes.update(
      { tenantId, uuid, status: SalesQuoteStatus.OPEN },
      {
        status: SalesQuoteStatus.CONVERTED,
        convertedInvoiceId: invoice.id,
        convertedInvoiceNumber: invoice.number ?? null,
        convertedAt: invoice.issuedAt ?? new Date(),
      },
    );
  }

  // ══════════════════════════ من لوحة التحكم ══════════════════════════

  /** يلغي عرضاً قائماً: لا يُحوَّل لفاتورة بعدها. ما تحوّل لا يُلغى */
  async cancel(id: string, tenantId: string): Promise<SalesQuote> {
    const quote = await this.findOne(id, tenantId);
    if (quote.status === SalesQuoteStatus.CONVERTED) {
      throw new BadRequestException(
        `تحوّل العرض لفاتورة ${quote.convertedInvoiceNumber ?? ''} ولا يُلغى`.trim(),
      );
    }
    if (quote.status === SalesQuoteStatus.CANCELLED) return quote;
    await this.quotes.update(
      { id, tenantId, status: SalesQuoteStatus.OPEN },
      { status: SalesQuoteStatus.CANCELLED },
    );
    return this.findOne(id, tenantId);
  }
}

function markExpiry(quote: SalesQuote, today: string): SalesQuote {
  quote.expired =
    quote.status === SalesQuoteStatus.OPEN && quote.validUntil < today;
  return quote;
}
