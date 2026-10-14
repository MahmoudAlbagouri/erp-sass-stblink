// src/modules/purchasing/purchase-invoices.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  assertWarehouseVisible,
  restrictToScopedWarehouses,
} from '../branches/branch-scope';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  paginated,
  Paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import { nextDocumentNumber } from '../../common/utils/document-number.util';
import { CatalogSettingsService } from '../catalog/catalog-settings.service';
import { ProductType } from '../catalog/entities/product.entity';
import { ProductsService } from '../catalog/products.service';
import { StockMovementType } from '../inventory/entities/stock-movement.entity';
import { StockService } from '../inventory/stock.service';
import { WarehousesService } from '../inventory/warehouses.service';
import {
  CreatePurchaseInvoiceDto,
  PurchaseInvoiceQueryDto,
  PurchaseLineDto,
  UpdatePurchaseInvoiceDto,
} from './dto/purchasing.dto';
import {
  PurchaseInvoice,
  PurchaseInvoiceLine,
  PurchaseInvoiceStatus,
} from './entities/purchase-invoice.entity';
import { SuppliersService } from './suppliers.service';
import { computeLine, sumMoney } from '../../common/utils/document-totals.util';
import { moneyDecimalsOf } from '../../common/utils/money.util';
import { tenantCalendarOf } from '../../common/utils/timezone.util';

export const PURCHASE_INVOICE_REFERENCE = 'purchase_invoice';
const NUMBER_PREFIX = 'PI-';

/** سطر محسوب جاهز للحفظ */
type ComputedLine = Pick<
  PurchaseInvoiceLine,
  | 'sortOrder'
  | 'productId'
  | 'unitId'
  | 'factor'
  | 'quantity'
  | 'unitPrice'
  | 'discount'
  | 'taxRateId'
  | 'taxRate'
  | 'subtotal'
  | 'taxAmount'
  | 'total'
  | 'baseQuantity'
  | 'unitCost'
>;

interface Totals {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

/**
 * فواتير الشراء:
 *   مسودة ──اعتماد──▶ معتمدة   (تدخل البضاعة المخزن بتكلفتها ويُستحق المبلغ للمورد)
 * المسودة تصلح كأمر شراء: تُعدَّل بحرية ولا أثر لها حتى تُعتمد.
 */
@Injectable()
export class PurchaseInvoicesService {
  constructor(
    @InjectRepository(PurchaseInvoice)
    private readonly invoices: Repository<PurchaseInvoice>,
    private readonly suppliers: SuppliersService,
    private readonly warehouses: WarehousesService,
    private readonly products: ProductsService,
    private readonly settings: CatalogSettingsService,
    private readonly stock: StockService,
    private readonly dataSource: DataSource,
  ) {}

  // ══════════════════════════ القراءة ══════════════════════════

  async findAll(
    tenantId: string,
    query: PurchaseInvoiceQueryDto,
  ): Promise<Paginated<PurchaseInvoice>> {
    const { page, limit, skip } = resolvePagination(query);

    const qb = this.invoices
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.supplier', 'supplier')
      .leftJoinAndSelect('invoice.warehouse', 'warehouse')
      .loadRelationCountAndMap('invoice.linesCount', 'invoice.lines')
      .where('invoice.tenantId = :tenantId', { tenantId });
    restrictToScopedWarehouses(qb, 'invoice.warehouseId');

    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        `(invoice.number ILIKE :like OR invoice.supplierReference ILIKE :like
          OR supplier.name ILIKE :like)`,
        { like: `%${search}%` },
      );
    }
    if (query.status) {
      qb.andWhere('invoice.status = :status', { status: query.status });
    }
    if (query.supplierId) {
      qb.andWhere('invoice.supplierId = :supplierId', {
        supplierId: query.supplierId,
      });
    }
    if (query.payment) {
      qb.andWhere('invoice.status = :posted', {
        posted: PurchaseInvoiceStatus.POSTED,
      }).andWhere(
        'invoice.total - invoice.returnedAmount - invoice.paidAmount > 0',
      );
      if (query.payment === 'overdue') {
        const { today } = await tenantCalendarOf(
          this.invoices.manager,
          tenantId,
        );
        qb.andWhere('invoice.dueDate < :today', { today });
      }
    }
    if (query.from) {
      qb.andWhere('invoice.invoiceDate >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('invoice.invoiceDate <= :to', { to: query.to });
    }

    const [data, total] = await qb
      .orderBy('invoice.invoiceDate', 'DESC')
      .addOrderBy('invoice.createdAt', 'DESC')
      .addOrderBy('invoice.id', 'ASC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return paginated(data, total, page, limit);
  }

  async findOne(id: string, tenantId: string): Promise<PurchaseInvoice> {
    const invoice = await this.invoices.findOne({
      where: { id, tenantId },
      relations: [
        'supplier',
        'warehouse',
        'lines',
        'lines.product',
        'lines.product.baseUnit',
        'lines.unit',
      ],
    });
    if (!invoice) throw new NotFoundException('فاتورة الشراء غير موجودة');
    assertWarehouseVisible(invoice.warehouseId, 'فاتورة الشراء غير موجودة');

    invoice.lines?.sort((a, b) => a.sortOrder - b.sortOrder);
    return invoice;
  }

  /**
   * يقفل الفاتورة حتى نهاية المعاملة — للاعتماد/الإلغاء هنا، وللسداد
   * والمرتجع اللذين يعدّلان مبالغها (فلا يُدفع أو يُرجَع أكثر من المتبقي
   * بطلبين متزامنين).
   */
  async lock(
    manager: EntityManager,
    id: string,
    tenantId: string,
  ): Promise<PurchaseInvoice> {
    const invoice = await manager.findOne(PurchaseInvoice, {
      where: { id, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!invoice) throw new NotFoundException('فاتورة الشراء غير موجودة');
    assertWarehouseVisible(invoice.warehouseId, 'فاتورة الشراء غير موجودة');
    return invoice;
  }

  // ══════════════════════════ المسودة ══════════════════════════

  async create(
    dto: CreatePurchaseInvoiceDto,
    tenantId: string,
    userId?: string,
  ): Promise<PurchaseInvoice> {
    const supplier = await this.suppliers.findActive(dto.supplierId, tenantId);
    await this.warehouses.findActiveByIds([dto.warehouseId], tenantId);

    const pricesIncludeTax = dto.pricesIncludeTax ?? false;
    const lines = await this.computeLines(
      dto.lines,
      pricesIncludeTax,
      tenantId,
    );

    const id = await this.dataSource.transaction(async (manager) => {
      const invoice = await manager.save(
        manager.create(PurchaseInvoice, {
          tenantId,
          number: await nextDocumentNumber(
            manager,
            'purchase_invoices',
            NUMBER_PREFIX,
            tenantId,
          ),
          supplierId: supplier.id,
          warehouseId: dto.warehouseId,
          supplierReference: dto.supplierReference ?? null,
          invoiceDate: dto.invoiceDate,
          dueDate:
            dto.dueDate ?? addDays(dto.invoiceDate, supplier.paymentTermsDays),
          pricesIncludeTax,
          note: dto.note ?? null,
          createdById: userId ?? null,
          ...totalsOf(lines, dto.lines),
        }),
      );
      await this.replaceLines(manager, invoice.id, tenantId, lines);
      return invoice.id;
    });

    return this.findOne(id, tenantId);
  }

  async update(
    id: string,
    dto: UpdatePurchaseInvoiceDto,
    tenantId: string,
  ): Promise<PurchaseInvoice> {
    const current = await this.findOne(id, tenantId);
    assertStatus(current, PurchaseInvoiceStatus.DRAFT, 'تعديل');

    const supplierId = dto.supplierId ?? current.supplierId;
    const warehouseId = dto.warehouseId ?? current.warehouseId;
    if (dto.supplierId) await this.suppliers.findActive(supplierId, tenantId);
    if (dto.warehouseId) {
      await this.warehouses.findActiveByIds([warehouseId], tenantId);
    }

    // الأسطر تُعاد حسابها دائماً: تغيير "شامل الضريبة" وحده يغيّر كل المبالغ
    const pricesIncludeTax = dto.pricesIncludeTax ?? current.pricesIncludeTax;
    const lineInputs: PurchaseLineDto[] =
      dto.lines ??
      (current.lines ?? []).map((line) => ({
        productId: line.productId,
        unitId: line.unitId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        taxRateId: line.taxRateId ?? undefined,
      }));
    const lines = await this.computeLines(
      lineInputs,
      pricesIncludeTax,
      tenantId,
    );

    await this.dataSource.transaction(async (manager) => {
      const invoice = await this.lock(manager, id, tenantId);
      assertStatus(invoice, PurchaseInvoiceStatus.DRAFT, 'تعديل');

      await manager.update(
        PurchaseInvoice,
        { id, tenantId },
        {
          supplierId,
          warehouseId,
          pricesIncludeTax,
          invoiceDate: dto.invoiceDate ?? current.invoiceDate,
          ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate } : {}),
          ...(dto.supplierReference !== undefined
            ? { supplierReference: dto.supplierReference }
            : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
          ...totalsOf(lines, lineInputs),
        },
      );
      await this.replaceLines(manager, id, tenantId, lines);
    });

    return this.findOne(id, tenantId);
  }

  // ══════════════════════════ الاعتماد والإلغاء ══════════════════════════

  /** اعتماد الفاتورة: إدخال البضاعة المخزن بتكلفتها (تدخل في المتوسط المرجّح) */
  async post(
    id: string,
    tenantId: string,
    userId?: string,
  ): Promise<PurchaseInvoice> {
    await this.dataSource.transaction(async (manager) => {
      const invoice = await this.lock(manager, id, tenantId);
      assertStatus(invoice, PurchaseInvoiceStatus.DRAFT, 'اعتماد');
      await this.suppliers.findActive(invoice.supplierId, tenantId, manager);

      const lines = await manager.find(PurchaseInvoiceLine, {
        where: { invoiceId: id },
        order: { sortOrder: 'ASC' },
      });

      await this.stock.apply(
        manager,
        tenantId,
        lines.map((line) => ({
          warehouseId: invoice.warehouseId,
          productId: line.productId,
          type: StockMovementType.PURCHASE,
          quantity: line.baseQuantity,
          unitCost: line.unitCost,
          note: `فاتورة شراء ${invoice.number}`,
        })),
        {
          referenceType: PURCHASE_INVOICE_REFERENCE,
          referenceId: id,
          userId,
        },
      );

      await manager.update(
        PurchaseInvoice,
        { id, tenantId },
        {
          status: PurchaseInvoiceStatus.POSTED,
          postedAt: new Date(),
          postedById: userId ?? null,
        },
      );
    });

    return this.findOne(id, tenantId);
  }

  /**
   * إلغاء مسودة، أو إلغاء فاتورة معتمدة لم يُدفع منها ولم يُرجَع منها شيء
   * (تخرج بضاعتها من المخزن). ما عدا ذلك يُعالَج بمرتجع شراء.
   */
  async cancel(
    id: string,
    tenantId: string,
    userId?: string,
  ): Promise<PurchaseInvoice> {
    await this.dataSource.transaction(async (manager) => {
      const invoice = await this.lock(manager, id, tenantId);

      if (invoice.status === PurchaseInvoiceStatus.POSTED) {
        if (invoice.paidAmount > 0 || invoice.returnedAmount > 0) {
          throw new BadRequestException(
            'لا يمكن إلغاء فاتورة عليها سداد أو مرتجع — ألغِ السداد أولاً أو سجّل مرتجع شراء',
          );
        }
        const lines = await manager.find(PurchaseInvoiceLine, {
          where: { invoiceId: id },
        });
        await this.stock.apply(
          manager,
          tenantId,
          lines.map((line) => ({
            warehouseId: invoice.warehouseId,
            productId: line.productId,
            type: StockMovementType.PURCHASE_RETURN,
            quantity: -line.baseQuantity,
            note: `إلغاء فاتورة شراء ${invoice.number}`,
          })),
          {
            referenceType: PURCHASE_INVOICE_REFERENCE,
            referenceId: id,
            userId,
          },
        );
      } else {
        assertStatus(invoice, PurchaseInvoiceStatus.DRAFT, 'إلغاء');
      }

      await manager.update(
        PurchaseInvoice,
        { id, tenantId },
        { status: PurchaseInvoiceStatus.CANCELLED },
      );
    });

    return this.findOne(id, tenantId);
  }

  // ══════════════════════════ داخلي ══════════════════════════

  /** يتحقق من الأصناف والوحدات والضرائب ويحسب مبالغ كل سطر */
  private async computeLines(
    inputs: PurchaseLineDto[],
    pricesIncludeTax: boolean,
    tenantId: string,
  ): Promise<ComputedLine[]> {
    const decimals = await moneyDecimalsOf(this.dataSource.manager, tenantId);
    const productIds = [...new Set(inputs.map((l) => l.productId))];
    const found = await this.products.findByIds(
      productIds,
      tenantId,
      undefined,
      ['baseUnit', 'units', 'taxRate'],
    );
    if (found.length !== productIds.length) {
      throw new NotFoundException('الصنف غير موجود');
    }
    const products = new Map(found.map((p) => [p.id, p]));

    // الضرائب المحددة يدوياً على الأسطر (غير ضريبة الصنف)
    const taxRateIds = [
      ...new Set(inputs.map((l) => l.taxRateId).filter((id) => !!id)),
    ] as string[];
    const taxRates = new Map(
      await Promise.all(
        taxRateIds.map(
          async (id) =>
            [id, (await this.settings.findTaxRate(id, tenantId)).rate] as const,
        ),
      ),
    );

    return inputs.map((input, index) => {
      const product = products.get(input.productId)!;
      if (product.type !== ProductType.STOCKED) {
        throw new BadRequestException(
          `الصنف "${product.name}" خدمة وليس له مخزون`,
        );
      }

      const unitId = input.unitId ?? product.baseUnitId;
      let factor = 1;
      if (unitId !== product.baseUnitId) {
        const productUnit = product.units?.find((u) => u.unitId === unitId);
        if (!productUnit) {
          throw new BadRequestException(
            `الوحدة المختارة ليست من وحدات الصنف "${product.name}"`,
          );
        }
        factor = productUnit.factor;
      }

      const discount = input.discount ?? 0;
      if (discount > input.quantity * input.unitPrice) {
        throw new BadRequestException(
          `خصم الصنف "${product.name}" أكبر من قيمته`,
        );
      }

      const taxRate = input.taxRateId
        ? taxRates.get(input.taxRateId)!
        : (product.taxRate?.rate ?? 0);

      return {
        sortOrder: index,
        productId: product.id,
        unitId,
        factor,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        discount,
        taxRateId: input.taxRateId ?? null,
        taxRate,
        ...computeLine({
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          discount,
          taxRate,
          pricesIncludeTax,
          factor,
          decimals,
        }),
      };
    });
  }

  private async replaceLines(
    manager: EntityManager,
    invoiceId: string,
    tenantId: string,
    lines: ComputedLine[],
  ): Promise<void> {
    await manager.delete(PurchaseInvoiceLine, { invoiceId, tenantId });
    await manager.save(
      lines.map((line) =>
        manager.create(PurchaseInvoiceLine, { ...line, invoiceId, tenantId }),
      ),
    );
  }
}

function totalsOf(lines: ComputedLine[], inputs: PurchaseLineDto[]): Totals {
  return {
    subtotal: sumMoney(lines.map((l) => l.subtotal)),
    discountTotal: sumMoney(inputs.map((l) => l.discount ?? 0)),
    taxTotal: sumMoney(lines.map((l) => l.taxAmount)),
    total: sumMoney(lines.map((l) => l.total)),
  };
}

/** تاريخ (YYYY-MM-DD) + أيام، بلا تأثر بالمنطقة الزمنية */
function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

const STATUS_LABEL: Record<PurchaseInvoiceStatus, string> = {
  [PurchaseInvoiceStatus.DRAFT]: 'مسودة',
  [PurchaseInvoiceStatus.POSTED]: 'معتمدة',
  [PurchaseInvoiceStatus.CANCELLED]: 'ملغاة',
};

function assertStatus(
  invoice: PurchaseInvoice,
  expected: PurchaseInvoiceStatus,
  action: string,
): void {
  if (invoice.status !== expected) {
    throw new BadRequestException(
      `لا يمكن ${action} فاتورة حالتها "${STATUS_LABEL[invoice.status]}"`,
    );
  }
}
