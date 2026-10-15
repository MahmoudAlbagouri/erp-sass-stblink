// src/modules/pos/pos.service.ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { In, Not, Repository } from 'typeorm';
import {
  assertWarehouseVisible,
  restrictToScopedWarehouses,
  scopedWarehouseIds,
} from '../branches/branch-scope';
import {
  paginated,
  Paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import { sumMoney } from '../../common/utils/document-totals.util';
import { roundMoney } from '../../common/utils/money.util';
import { CatalogSettingsService } from '../catalog/catalog-settings.service';
import { ProductCategory } from '../catalog/entities/product-category.entity';
import { Product, ProductType } from '../catalog/entities/product.entity';
import { ProductsService } from '../catalog/products.service';
import { WarehousesService } from '../inventory/warehouses.service';
import { CustomersService } from '../sales/customers.service';
import { Customer } from '../sales/entities/customer.entity';
import { SalesSettings } from '../sales/entities/sales-settings.entity';
import {
  OverdrawnLine,
  PosLineCheck,
  SalesInvoicesService,
} from '../sales/sales-invoices.service';
import { SalesReturnsService } from '../sales/sales-returns.service';
import { SalesSettingsService } from '../sales/sales-settings.service';
import {
  CloseShiftOp,
  CreatePosDeviceDto,
  OpenShiftOp,
  PosAuditOp,
  PosCashMoveOp,
  PosCustomerOp,
  PosOperationDto,
  PosReturnOp,
  PosSaleOp,
  PosShiftQueryDto,
  PosSyncDto,
  UpdatePosDeviceDto,
} from './dto/pos.dto';
import { PosDevice, PosShift, PosShiftStatus } from './entities/pos.entity';
import { PromotionType } from './entities/pos-extras.entity';
import {
  cashierCouldReturn,
  PosCashierForDevice,
  PosCashiersService,
} from './pos-cashiers.service';
import { POS_OFFLINE_POLICY } from './pos.constants';
import { PosExtrasService, PosPromotionForDevice } from './pos-extras.service';
import {
  PosOptions,
  resolvePosOptions,
} from '../sales/entities/sales-settings.entity';
import { generateDeviceKey, hashDeviceKey } from './utils/pos-crypto.util';
import {
  getCountry,
  getCurrencyDecimals,
} from '../../common/constants/countries';

/** صنف كما يخزّنه جهاز الكاشير محلياً (ما يحتاجه للبيع فقط) */
export interface PosProduct {
  id: string;
  name: string;
  sku: string;
  isStocked: boolean;
  categoryId: string | null;
  baseUnitId: string;
  baseUnitName: string;
  allowsFractions: boolean;
  taxRate: number;
  salePrice: number;
  priceIncludesTax: boolean;
  minSalePrice: number | null;
  allowDiscount: boolean;
  isWeighted: boolean;
  /** سعر مفتوح: الشاشة تطلب السعر عند إضافته */
  openPrice: boolean;
  /** false = يُزال من الجهاز (حُذف أو أُوقف) */
  available: boolean;
  barcodes: { barcode: string; unitId: string | null }[];
  units: { unitId: string; name: string; factor: number; salePrice: number }[];
}

export interface PosCustomer {
  id: string;
  name: string;
  phone: string | null;
  taxNumber: string | null;
  /** أقصى مديونية للبيع الآجل (null = بلا حد) */
  creditLimit: number | null;
  paymentTermsDays: number;
  available: boolean;
}

export interface PosBootstrap {
  /** وقت السيرفر عند إعداد الرد: يرسله الجهاز كـ since في المرة القادمة */
  serverTime: string;
  /** true = الرد يحوي كل شيء (يستبدل نسخة الجهاز)، false = تغييرات فقط */
  full: boolean;
  device: PosDevice;
  settings: SalesSettings;
  categories: Pick<ProductCategory, 'id' | 'name' | 'parentId' | 'color'>[];
  products: PosProduct[];
  customers: PosCustomer[];
  /** وردية مفتوحة على الجهاز في السيرفر (لاستعادتها بعد إعادة تهيئة الجهاز) */
  openShift: PosShift | null;
  /** الشركة: عملتها وتوقيتها تحفظهما الشاشة لتعمل بهما بلا إنترنت ولا جلسة */
  tenant: PosTenantProfile;
  /** الكاشيرات الفعّالون (القائمة كاملة دائماً). فارغة = الورديات بلا رقم سري */
  cashiers: PosCashierForDevice[];
  /** صلاحية المرتجع لوردية بلا كاشير محدد (آخر ما عُرف عن مستخدم الشاشة) */
  returnsAllowed: boolean;
  /** حد العمل بلا اتصال (انظر pos.constants) */
  offlinePolicy: { warnAfterHours: number; blockAfterHours: number };
  /**
   * أرصدة مخزن الجهاز (بوحدة الأساس): كلها في التنزيل الكامل، وما تغيّر منذ
   * `since` في غيره. الشاشة تنقص منها محلياً مع كل بيع.
   */
  stock: { productId: string; quantity: number }[];
  /** ما على كل عميل الآن (غير الصفري؛ القائمة كاملة دائماً) — لحد الائتمان */
  customerBalances: { id: string; balance: number }[];
  /** العروض والأسعار الخاصة السارية (القائمة كاملة دائماً) */
  promotions: PosPromotionForDevice[];
  /** باركود الميزان وما يحتاج موافقة مشرف */
  posOptions: PosOptions;
}

export interface PosTenantProfile {
  companyName: string;
  country: string;
  currency: string;
  currencyDecimals: number;
  timezone: string;
  /**
   * شعار الشركة (Data URL) يُطبع على الإيصال والتقارير — الشاشة تحفظه لتطبعه
   * بلا إنترنت. null = بلا شعار. غائب = لم يتغيّر منذ `since` (يبقى المحفوظ):
   * لا يُعاد إرساله مع كل سحب
   */
  logo?: string | null;
  /** فرع الجهاز: اسمه وعنوانه وهاتفه يُطبعان على الإيصال */
  branch: {
    id: string;
    name: string;
    address: string | null;
    phone: string | null;
    isMain: boolean;
  } | null;
}

/** ما يعود للشاشة عند ربطها: الجهاز + مفتاحه (يُعرض هذه المرة فقط) */
export type BoundPosDevice = PosDevice & { deviceKey: string };

export type PosOperationStatus = 'ok' | 'duplicate' | 'error';

export interface PosOperationResult {
  id: string;
  status: PosOperationStatus;
  message?: string;
}

/** فاتورة كما تعرضها شاشة الكاشير لاختيار ما يُرجَع منها */
export interface PosInvoiceLookup {
  number: string;
  issuedAt: string | null;
  customerName: string | null;
  total: number;
  paidAmount: number;
  returnedAmount: number;
  lines: {
    /** ترتيب السطر: به يشير المرتجع إليه */
    lineIndex: number;
    productName: string;
    unitName: string;
    quantity: number;
    returnedQuantity: number;
    subtotal: number;
    taxAmount: number;
    total: number;
  }[];
}

interface Actor {
  id?: string;
  /** هل يملك صلاحية المرتجع من شاشة الكاشير؟ */
  canReturn?: boolean;
}

/** أرقام الوردية المحسوبة من مستنداتها (دون المعدود وفرقه) */
type ShiftFigures = Pick<
  PosShift,
  | 'invoicesCount'
  | 'salesTotal'
  | 'cashTotal'
  | 'cardTotal'
  | 'returnsCount'
  | 'returnsTotal'
  | 'cashRefunds'
  | 'creditTotal'
  | 'cashIn'
  | 'cashOut'
  | 'expectedCash'
>;

/** محاولات ربط الجهاز حين يسبقنا متصفح آخر بين القراءة والكتابة */
const MAX_BIND_ATTEMPTS = 3;

const LATE_OPERATION_LABELS: Partial<Record<PosOperationDto['type'], string>> =
  {
    sale: 'فاتورة',
    return: 'مرتجع',
    'cash.move': 'حركة درج',
  };

@Injectable()
export class PosService {
  constructor(
    @InjectRepository(PosDevice)
    private readonly devices: Repository<PosDevice>,
    @InjectRepository(PosShift)
    private readonly shifts: Repository<PosShift>,
    private readonly warehouses: WarehousesService,
    private readonly products: ProductsService,
    private readonly catalogSettings: CatalogSettingsService,
    private readonly customers: CustomersService,
    private readonly salesSettings: SalesSettingsService,
    private readonly invoices: SalesInvoicesService,
    private readonly returns: SalesReturnsService,
    private readonly cashiers: PosCashiersService,
    private readonly extras: PosExtrasService,
  ) {}

  // ══════════════════════════ الأجهزة ══════════════════════════

  async findDevices(tenantId: string): Promise<PosDevice[]> {
    const allowed = scopedWarehouseIds();
    const devices = await this.devices.find({
      where: { tenantId, ...(allowed ? { warehouseId: In(allowed) } : {}) },
      relations: ['warehouse', 'warehouse.branch'],
      order: { name: 'ASC' },
    });
    const open = await this.shifts.find({
      where: { tenantId, status: PosShiftStatus.OPEN },
      select: { deviceId: true },
    });
    const busy = new Set(open.map((s) => s.deviceId));
    devices.forEach((device) => {
      device.hasOpenShift = busy.has(device.id);
    });
    return devices;
  }

  async findDevice(id: string, tenantId: string): Promise<PosDevice> {
    const device = await this.devices.findOne({
      where: { id, tenantId },
      relations: ['warehouse'],
    });
    if (!device) throw new NotFoundException('جهاز الكاشير غير موجود');
    assertWarehouseVisible(device.warehouseId, 'جهاز الكاشير غير موجود');
    return device;
  }

  /** عدد أجهزة الشركة — يستخدمه حد الخطة (max_pos_devices) */
  countDevices(tenantId: string): Promise<number> {
    return this.devices.count({ where: { tenantId } });
  }

  async createDevice(
    dto: CreatePosDeviceDto,
    tenantId: string,
  ): Promise<PosDevice> {
    await this.warehouses.findActiveByIds([dto.warehouseId], tenantId);
    await this.assertCodeFree(dto.code, tenantId);

    const device = await this.devices.save(
      this.devices.create({ ...dto, tenantId }),
    );
    return this.findDevice(device.id, tenantId);
  }

  async updateDevice(
    id: string,
    dto: UpdatePosDeviceDto,
    tenantId: string,
  ): Promise<PosDevice> {
    const device = await this.findDevice(id, tenantId);

    if (dto.code && dto.code !== device.code) {
      throw new BadRequestException(
        'كود الجهاز لا يُعدَّل: فواتيره السابقة تحمله',
      );
    }
    if (dto.warehouseId && dto.warehouseId !== device.warehouseId) {
      await this.warehouses.findActiveByIds([dto.warehouseId], tenantId);
      await this.assertNoOpenShift(id, tenantId, 'تغيير مخزن');
    }

    await this.devices.update(
      { id, tenantId },
      {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.warehouseId !== undefined
          ? { warehouseId: dto.warehouseId }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    );
    return this.findDevice(id, tenantId);
  }

  /** حذف منطقي: فواتير الجهاز وورديّاته تبقى، وكوده لا يُعاد استخدامه */
  async removeDevice(id: string, tenantId: string): Promise<void> {
    const device = await this.findDevice(id, tenantId);
    await this.assertNoOpenShift(id, tenantId, 'حذف');
    await this.devices.softRemove(device);
  }

  // ══════════════════════════ ربط الجهاز بمتصفح ══════════════════════════

  /**
   * يربط الجهاز بالمتصفح الطالب. جهاز مربوط بمتصفح آخر لا يُؤخذ منه: يضيف
   * المدير جهازاً جديداً لهذه الشاشة، أو يفكّ ربط القديم إن استُبدل.
   */
  async bindDevice(
    id: string,
    installationId: string,
    tenantId: string,
    /** هل يملك المستخدم الرابط صلاحية المرتجع؟ (لورديات بلا كاشير محدد) */
    returnsAllowed = false,
    attempt = 1,
  ): Promise<BoundPosDevice> {
    const device = await this.activeDevice(id, tenantId);

    if (device.installationId && device.installationId !== installationId) {
      throw new ConflictException(
        `الجهاز "${device.name}" مربوط بشاشة كاشير أخرى. لكل شاشة بيع جهازها: أضف جهاز كاشير جديداً لهذه الشاشة، أو اطلب من المدير فكّ ربط "${device.name}" إن استُبدل جهازه.`,
      );
    }
    if (!device.installationId) {
      // الشرط في الاستعلام يحسم متصفحين يربطان في نفس اللحظة: واحد فقط ينجح
      const bound = await this.devices
        .createQueryBuilder()
        .update()
        .set({ installationId, boundAt: new Date() })
        .where('id = :id AND "installationId" IS NULL', { id })
        .execute();
      if (!bound.affected) {
        // سبقنا متصفح آخر (أو فُكّ الربط وأُعيد بينهما): نقرأ الحال من جديد
        // مرات محدودة، فلا تدور الدالة بلا نهاية مع ربط وفك متتاليين
        if (attempt >= MAX_BIND_ATTEMPTS) {
          throw new ConflictException(
            `تعذّر ربط الجهاز "${device.name}" الآن — حاول مرة أخرى`,
          );
        }
        return this.bindDevice(
          id,
          installationId,
          tenantId,
          returnsAllowed,
          attempt + 1,
        );
      }
    }
    // الشاشة انتقلت لهذا الجهاز: جهازها السابق يصير حراً لشاشة أخرى
    await this.devices.update(
      { tenantId, installationId, id: Not(id) },
      { installationId: null, boundAt: null, keyHash: null },
    );

    // مفتاح جديد مع كل ربط: الشاشة تحفظه وترفع به دون جلسة مستخدم. المفتاح
    // السابق (إن وُجد) يبطل، ولا يُحفظ هنا إلا بصمته
    const deviceKey = generateDeviceKey();
    await this.devices.update(
      { id, tenantId },
      { keyHash: hashDeviceKey(deviceKey), returnsAllowed },
    );
    return { ...(await this.findDevice(id, tenantId)), deviceKey };
  }

  /**
   * يفكّ ربط الجهاز (استُبدل الحاسب أو مُسحت بيانات المتصفح) ليُربط بغيره.
   * ما لم يرفعه المتصفح القديم من مبيعات لن يُقبل منه بعد ذلك: مفتاحه يبطل
   * فوراً — وهذا ما يُفعل لجهاز سُرق أو فُقد.
   */
  async unbindDevice(id: string, tenantId: string): Promise<PosDevice> {
    await this.findDevice(id, tenantId);
    await this.devices.update(
      { id, tenantId },
      { installationId: null, boundAt: null, keyHash: null },
    );
    return this.findDevice(id, tenantId);
  }

  // ══════════════════════════ التنزيل للجهاز ══════════════════════════

  /**
   * كل ما يحتاجه الجهاز ليبيع بلا إنترنت: بيانات الفاتورة، الأصناف بأسعارها
   * وباركوداتها، والعملاء. مع `since` يُرسل ما تغيّر فقط.
   */
  async bootstrap(
    deviceId: string,
    installationId: string,
    tenantId: string,
    since?: string,
  ): Promise<PosBootstrap> {
    const device = await this.boundDevice(deviceId, installationId, tenantId);
    return this.bootstrapDevice(device, since);
  }

  /** نفس التنزيل لجهاز سبق التحقق منه (بجلسة مستخدم أو بمفتاحه) */
  async bootstrapDevice(
    device: PosDevice,
    since?: string,
  ): Promise<PosBootstrap> {
    // قبل القراءة: ما يتغيّر أثناءها يدخل في المزامنة التالية
    const serverTime = new Date();
    const { tenantId } = device;
    const deviceId = device.id;
    const sinceDate = since ? new Date(since) : undefined;

    const [
      settings,
      categories,
      products,
      customers,
      openShift,
      cashiers,
      stock,
      customerBalances,
      promotions,
    ] = await Promise.all([
      this.salesSettings.get(tenantId),
      this.catalogSettings.findCategories(tenantId),
      this.products.findChangedSince(tenantId, sinceDate),
      this.customers.findChangedSince(tenantId, sinceDate),
      this.shifts.findOne({
        where: { tenantId, deviceId, status: PosShiftStatus.OPEN },
      }),
      this.cashiers.findForDevice(tenantId),
      this.stockOf(device, sinceDate),
      this.customers.balances(tenantId),
      this.extras.findPromotionsForDevice(tenantId, serverTime),
    ]);

    await this.devices.update({ id: deviceId }, { lastSeenAt: serverTime });
    const tenant = await this.tenantProfile(
      tenantId,
      device.warehouseId,
      sinceDate,
    );
    const decimals = tenant.currencyDecimals;

    return {
      serverTime: serverTime.toISOString(),
      full: !sinceDate,
      device,
      settings,
      categories: categories
        .filter((c) => c.isActive)
        .map((c) => ({
          id: c.id,
          name: c.name,
          parentId: c.parentId,
          color: c.color,
        })),
      products: products.map((product) => toPosProduct(product, decimals)),
      customers: customers.map(toPosCustomer),
      openShift,
      tenant,
      cashiers,
      returnsAllowed: device.returnsAllowed,
      offlinePolicy: { ...POS_OFFLINE_POLICY },
      stock,
      customerBalances,
      promotions,
      posOptions: resolvePosOptions(settings.posOptions),
    };
  }

  /** أرصدة مخزن الجهاز: كلها، أو ما تغيّر منذ آخر سحب */
  private async stockOf(
    device: PosDevice,
    since?: Date,
  ): Promise<PosBootstrap['stock']> {
    const rows: { productId: string; quantity: string }[] =
      await this.devices.manager.query(
        `SELECT "productId", "quantity" FROM stock_levels
          WHERE "tenantId" = $1 AND "warehouseId" = $2
            AND ($3::timestamptz IS NULL OR "updatedAt" > $3)`,
        [device.tenantId, device.warehouseId, since ?? null],
      );
    return rows.map((row) => ({
      productId: row.productId,
      quantity: Number(row.quantity),
    }));
  }

  private async tenantProfile(
    tenantId: string,
    warehouseId?: string,
    /** آخر سحب: الشعار يُرسل فقط إن تغيّرت الشركة بعده (أو في السحب الكامل) */
    since?: Date,
  ): Promise<PosTenantProfile> {
    const branches: PosTenantProfile['branch'][] = warehouseId
      ? await this.devices.manager.query(
          `SELECT b."id", b."name", b."address", b."phone", b."isMain"
             FROM warehouses w JOIN branches b ON b."id" = w."branchId"
            WHERE w."id" = $1 AND w."tenantId" = $2`,
          [warehouseId, tenantId],
        )
      : [];

    const rows: {
      companyName: string;
      country: string | null;
      currency: string | null;
      timezone: string | null;
      logo: string | null;
      updatedAt: Date;
    }[] = await this.devices.manager.query(
      `SELECT "companyName", "country", "currency", "timezone",
              "logo_url" AS "logo", "updated_at" AS "updatedAt"
         FROM tenants WHERE "id" = $1`,
      [tenantId],
    );
    const row = rows[0];
    const country = getCountry(row?.country);
    const currency = row?.currency ?? country.currency;
    const logoChanged =
      !since || !row || new Date(row.updatedAt).getTime() > since.getTime();
    return {
      companyName: row?.companyName ?? '',
      country: country.code,
      currency,
      currencyDecimals: getCurrencyDecimals(currency),
      timezone: row?.timezone ?? country.timezone,
      ...(logoChanged ? { logo: row?.logo ?? null } : {}),
      branch: branches[0] ?? null,
    };
  }

  // ══════════════════════════ الرفع من الجهاز ══════════════════════════

  /**
   * ينفّذ عمليات طابور الجهاز بالترتيب. كل عملية مستقلة: فشل واحدة لا يوقف
   * ما بعدها، والنتيجة تعود لكل عملية بمعرّفها ليحذفها الجهاز من طابوره أو
   * يعرض سبب فشلها.
   */
  async sync(
    dto: PosSyncDto,
    tenantId: string,
    actor: Actor,
  ): Promise<{ results: PosOperationResult[]; lastCounter: number }> {
    const device = await this.boundDevice(
      dto.deviceId,
      dto.installationId,
      tenantId,
    );
    return this.syncDevice(device, dto.operations, actor);
  }

  /** نفس الرفع لجهاز سبق التحقق منه (بجلسة مستخدم أو بمفتاحه) */
  async syncDevice(
    device: PosDevice,
    operations: PosOperationDto[],
    actor: Actor,
  ): Promise<{ results: PosOperationResult[]; lastCounter: number }> {
    const { tenantId } = device;
    const results: PosOperationResult[] = [];
    for (const operation of operations) {
      results.push(await this.runOperation(operation, device, actor));
    }

    const fresh = await this.findDevice(device.id, tenantId);
    await this.devices.update({ id: device.id }, { lastSeenAt: new Date() });
    return { results, lastCounter: fresh.lastCounter };
  }

  private async runOperation(
    operation: PosOperationDto,
    device: PosDevice,
    actor: Actor,
  ): Promise<PosOperationResult> {
    try {
      let duplicate = false;
      /** وردية العملية إن كانت تغيّر أرقام الدرج (بيع، مرتجع، حركة نقدية) */
      let affectedShiftId: string | null = null;
      switch (operation.type) {
        case 'shift.open':
          duplicate = await this.openShift(
            await validated(OpenShiftOp, operation.payload),
            device,
            actor,
          );
          break;
        case 'sale': {
          const op = await validated(PosSaleOp, operation.payload);
          duplicate = await this.recordSale(op, device, actor);
          affectedShiftId = op.shiftId;
          break;
        }
        case 'return': {
          const op = await validated(PosReturnOp, operation.payload);
          duplicate = await this.recordReturn(op, device, actor);
          affectedShiftId = op.shiftId;
          break;
        }
        case 'customer.create': {
          const op = await validated(PosCustomerOp, operation.payload);
          duplicate = await this.customers.createFromPos(
            op.id,
            op,
            device.tenantId,
          );
          break;
        }
        case 'cash.move': {
          const op = await validated(PosCashMoveOp, operation.payload);
          duplicate = await this.extras.recordCashMove(
            op,
            await this.shiftOf(op.shiftId, device),
            device,
          );
          affectedShiftId = op.shiftId;
          break;
        }
        case 'audit': {
          const op = await validated(PosAuditOp, operation.payload);
          duplicate = await this.extras.recordAudit(
            op,
            device,
            op.shiftId ? await this.shiftOf(op.shiftId, device) : null,
          );
          break;
        }
        case 'shift.close':
          duplicate = await this.closeShift(
            await validated(CloseShiftOp, operation.payload),
            device,
          );
          break;
      }
      if (!duplicate && affectedShiftId) {
        await this.recalculateIfClosed(affectedShiftId, device, operation.type);
      }
      return { id: operation.id, status: duplicate ? 'duplicate' : 'ok' };
    } catch (error) {
      return {
        id: operation.id,
        status: 'error',
        message: error instanceof Error ? error.message : 'خطأ غير متوقع',
      };
    }
  }

  /** وردية مسجّلة على هذا الجهاز */
  private async shiftOf(id: string, device: PosDevice): Promise<PosShift> {
    const shift = await this.shifts.findOne({ where: { id } });
    if (!shift) throw new NotFoundException('الوردية غير مسجّلة');
    assertShiftOfDevice(shift, device);
    return shift;
  }

  /** @returns true إذا كانت الوردية مسجّلة من قبل (رفع مكرر) */
  private async openShift(
    op: OpenShiftOp,
    device: PosDevice,
    actor: Actor,
  ): Promise<boolean> {
    const existing = await this.shifts.findOne({ where: { id: op.id } });
    if (existing) {
      assertShiftOfDevice(existing, device);
      return true;
    }

    const open = await this.shifts.findOne({
      where: {
        tenantId: device.tenantId,
        deviceId: device.id,
        status: PosShiftStatus.OPEN,
      },
    });
    if (open) {
      throw new ConflictException(
        'على الجهاز وردية أخرى مفتوحة — يجب تقفيلها أولاً',
      );
    }

    // كاشير حُذف بعد أن فتح ورديته بلا إنترنت: الوردية تُقبل باسمه
    const cashier = op.cashierId
      ? await this.cashiers.findForOperation(op.cashierId, device.tenantId)
      : null;

    try {
      await this.shifts.insert({
        id: op.id,
        tenantId: device.tenantId,
        deviceId: device.id,
        userId: actor.id ?? null,
        cashierId: cashier?.id ?? null,
        cashierName: op.cashierName ?? cashier?.name ?? null,
        openedAt: new Date(op.openedAt),
        openingCash: op.openingCash,
        expectedCash: op.openingCash,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // طلب مزامنة آخر سبقنا بين الفحص والإدخال (الفهرس الفريد حسمها):
      // نفس الوردية ← رفع مكرر، وردية غيرها ← على الجهاز وردية مفتوحة
      const raced = await this.shifts.findOne({ where: { id: op.id } });
      if (raced) {
        assertShiftOfDevice(raced, device);
        return true;
      }
      throw new ConflictException(
        'على الجهاز وردية أخرى مفتوحة — يجب تقفيلها أولاً',
      );
    }
    return false;
  }

  /** @returns true إذا كانت الفاتورة مسجّلة من قبل (رفع مكرر) */
  private async recordSale(
    op: PosSaleOp,
    device: PosDevice,
    actor: Actor,
  ): Promise<boolean> {
    const [prefix, counterText] = op.number.split('-');
    if (prefix !== device.code) {
      throw new BadRequestException(
        `رقم الفاتورة "${op.number}" لا يخص الجهاز "${device.code}"`,
      );
    }
    const shift = await this.shifts.findOne({ where: { id: op.shiftId } });
    if (!shift) throw new NotFoundException('وردية الفاتورة غير مسجّلة');
    assertShiftOfDevice(shift, device);

    const { duplicate, overdrawn, checks } = await this.invoices.recordPosSale(
      {
        uuid: op.uuid,
        number: op.number,
        issuedAt: new Date(op.issuedAt),
        deviceId: device.id,
        shiftId: shift.id,
        warehouseId: device.warehouseId,
        customerId: op.customerId ?? null,
        pricesIncludeTax: op.pricesIncludeTax,
        lines: op.lines,
        payments: op.payments,
      },
      device.tenantId,
      actor.id,
    );

    // أعلى عدّاد وصل: منه يكمل الجهاز لو أُعيدت تهيئته
    await this.devices
      .createQueryBuilder()
      .update()
      .set({ lastCounter: () => `GREATEST("lastCounter", :counter)` })
      .where('id = :id', { id: device.id })
      .setParameter('counter', Number(counterText))
      .execute();

    if (!duplicate) {
      await this.reportSaleIssues(op, device, shift, overdrawn, checks);
    }
    return duplicate;
  }

  /**
   * البيع سُجّل كما طُبع؛ ما يستحق المراجعة يذهب لسجل التدقيق: رصيد نزل تحت
   * الصفر، ضريبة تخالف نسبة الصنف، أو سعر تحت الحد بلا عرض ولا موافقة مشرف.
   */
  private async reportSaleIssues(
    op: PosSaleOp,
    device: PosDevice,
    shift: PosShift,
    overdrawn: OverdrawnLine[],
    checks: PosLineCheck[],
  ): Promise<void> {
    const occurredAt = new Date(op.issuedAt);

    if (overdrawn.length > 0) {
      await this.extras.recordServerAudit(device, shift, {
        action: 'stock_overdrawn',
        occurredAt,
        details: `${op.number} — ${overdrawn
          .map((line) => `${line.productName}: الرصيد ${line.quantity}`)
          .join('، ')}`,
      });
    }

    const issues = checks
      .filter((c) => Math.abs(c.taxRate - c.productTaxRate) > 0.001)
      .map((c) =>
        c.vatRegistered
          ? `${c.productName}: ضريبة ${c.taxRate}% بدل ${c.productTaxRate}%`
          : `${c.productName}: ضريبة ${c.taxRate}% والمنشأة غير مسجّلة في الضريبة`,
      );

    const belowMin = op.approvedBy ? [] : checks.filter((c) => c.belowMinPrice);
    // سعر غير سعر الصنف ولم تسجّله الشاشة تعديلاً: شاشة معدّلة، أو سعر تغيّر في
    // الكتالوج ولم يصل الجهاز بعد
    const unmarked = checks.filter((c) => c.unmarkedPrice);
    if (belowMin.length > 0 || unmarked.length > 0) {
      // عرض الإدارة يغيّر السعر بقرارها: لا يُعدّ مخالفة
      const promotions = (
        await this.extras.findPromotionsForDevice(device.tenantId, occurredAt)
      ).filter(
        (p) =>
          (!p.startsAt || new Date(p.startsAt) <= occurredAt) &&
          (!p.customerId || p.customerId === op.customerId),
      );
      for (const check of belowMin) {
        const promoted = promotions.some(
          (p) =>
            p.productId === check.productId ||
            (p.type === PromotionType.PERCENT_OFF &&
              !p.productId &&
              (!p.categoryId || p.categoryId === check.categoryId)),
        );
        if (!promoted) {
          issues.push(`${check.productName}: سعر تحت أقل سعر بلا موافقة مشرف`);
        }
      }
      for (const check of unmarked) {
        // السعر الخاص وحده يغيّر سعر الوحدة؛ بقية العروض خصم على السطر
        const specialPrice = promotions.some(
          (p) =>
            p.type === PromotionType.SPECIAL_PRICE &&
            p.productId === check.productId,
        );
        if (!specialPrice) {
          issues.push(
            `${check.productName}: بيع بسعر ${check.unitPrice} بدل ${check.catalogPrice} بلا تعديل سعر مسجّل`,
          );
        }
      }
    }

    if (issues.length > 0) {
      await this.extras.recordServerAudit(device, shift, {
        action: 'sale_anomaly',
        occurredAt,
        details: `${op.number} — ${issues.join('، ')}`,
      });
    }
  }

  /** @returns true إذا كان المرتجع مسجّلاً من قبل (رفع مكرر) */
  private async recordReturn(
    op: PosReturnOp,
    device: PosDevice,
    actor: Actor,
  ): Promise<boolean> {
    const shift = await this.shifts.findOne({ where: { id: op.shiftId } });
    if (!shift) throw new NotFoundException('وردية المرتجع غير مسجّلة');
    assertShiftOfDevice(shift, device);

    if (!(await this.mayReturn(shift, new Date(op.issuedAt), actor))) {
      throw new ForbiddenException(
        'ليست لديك صلاحية عمل مرتجع من شاشة الكاشير',
      );
    }

    const { duplicate } = await this.returns.recordPosReturn(
      {
        uuid: op.uuid,
        invoiceNumber: op.invoiceNumber,
        issuedAt: new Date(op.issuedAt),
        deviceId: device.id,
        shiftId: shift.id,
        lines: op.lines,
        refundMethod: op.refundMethod,
        refundAmount: op.refundAmount,
        reason: op.reason,
      },
      device.tenantId,
      actor.id,
    );
    return duplicate;
  }

  /**
   * صلاحية المرتجع تتبع صاحب الوردية: كاشيرها إن فُتحت برقم سري، وإلا مستخدم
   * الشاشة (أو آخر ما عُرف عنه حين ترفع الشاشة بمفتاحها).
   */
  private async mayReturn(
    shift: PosShift,
    issuedAt: Date,
    actor: Actor,
  ): Promise<boolean> {
    if (!shift.cashierId) return !!actor.canReturn;

    const cashier = await this.cashiers.findForOperation(
      shift.cashierId,
      shift.tenantId,
    );
    return !!cashier && cashierCouldReturn(cashier, issuedAt);
  }

  /** فاتورة برقمها لاختيار ما يُرجَع منها (أي فاتورة صادرة للشركة) */
  async lookupInvoice(
    number: string,
    tenantId: string,
  ): Promise<PosInvoiceLookup> {
    const invoice = await this.invoices.findByNumber(number, tenantId);
    return {
      number: invoice.number ?? number,
      issuedAt: invoice.issuedAt?.toISOString() ?? null,
      customerName: invoice.customer?.name ?? null,
      total: invoice.total,
      paidAmount: invoice.paidAmount,
      returnedAmount: invoice.returnedAmount,
      lines: (invoice.lines ?? []).map((line) => ({
        lineIndex: line.sortOrder,
        productName: line.productName,
        unitName: line.unitName,
        quantity: line.quantity,
        returnedQuantity: line.returnedQuantity,
        subtotal: line.subtotal,
        taxAmount: line.taxAmount,
        total: line.total,
      })),
    };
  }

  /** @returns true إذا كانت الوردية مقفّلة من قبل (رفع مكرر) */
  private async closeShift(
    op: CloseShiftOp,
    device: PosDevice,
  ): Promise<boolean> {
    const shift = await this.shifts.findOne({ where: { id: op.id } });
    if (!shift) throw new NotFoundException('الوردية غير مسجّلة');
    assertShiftOfDevice(shift, device);
    if (shift.status === PosShiftStatus.CLOSED) return true;

    const figures = (await this.shiftFigures(device.tenantId, [shift])).get(
      shift.id,
    )!;
    await this.shifts.update(
      { id: shift.id },
      {
        ...figures,
        status: PosShiftStatus.CLOSED,
        closedAt: new Date(op.closedAt),
        closingCash: op.closingCash,
        note: op.note ?? null,
        drawerOpens: op.drawerOpens ?? 0,
        cashDifference: sumMoney([op.closingCash, -figures.expectedCash]),
      },
    );
    return false;
  }

  /**
   * عملية رُفضت ثم أُعيدت بعد تقفيل ورديتها (الطابور يكمل بعد الفشل، فالتقفيل
   * قد يسبقها): تُقبل — البيع وقع والنقد في الدرج — وتُعاد أرقام الوردية
   * ليظهر الفرق الحقيقي بين المعدود والمفترض، لا عجزاً وهمياً.
   */
  private async recalculateIfClosed(
    shiftId: string,
    device: PosDevice,
    operationType: PosOperationDto['type'],
  ): Promise<void> {
    const shift = await this.shifts.findOne({ where: { id: shiftId } });
    if (!shift || shift.status !== PosShiftStatus.CLOSED) return;

    const figures = (await this.shiftFigures(shift.tenantId, [shift])).get(
      shift.id,
    )!;
    const cashDifference = sumMoney([
      shift.closingCash ?? 0,
      -figures.expectedCash,
    ]);
    await this.shifts.update(
      { id: shift.id },
      {
        ...figures,
        cashDifference,
        lateOperations: () => '"lateOperations" + 1',
        recalculatedAt: new Date(),
      },
    );
    await this.extras.recordServerAudit(device, shift, {
      action: 'late_after_close',
      amount: cashDifference,
      details: `${LATE_OPERATION_LABELS[operationType] ?? operationType} وصلت بعد تقفيل الوردية — الفرق صار ${cashDifference} (كان ${shift.cashDifference})`,
    });
  }

  /**
   * أرقام الورديات من مستنداتها: المبيعات والمقبوض، المرتجعات والمردود،
   * حركات الدرج، والمفترض في الدرج. ستة استعلامات لكل الورديات معاً.
   */
  private async shiftFigures(
    tenantId: string,
    shifts: PosShift[],
  ): Promise<Map<string, ShiftFigures>> {
    const ids = shifts.map((s) => s.id);
    const [totals, refunds, moves] = await Promise.all([
      this.invoices.shiftTotals(tenantId, ids),
      this.returns.shiftRefunds(tenantId, ids),
      this.extras.shiftCashMoves(tenantId, ids),
    ]);

    const result = new Map<string, ShiftFigures>();
    for (const shift of shifts) {
      const sales = totals.get(shift.id)!;
      const back = refunds.get(shift.id)!;
      const drawer = moves.get(shift.id)!;
      const cashTotal = sales.byMethod.cash ?? 0;
      const cashRefunds = back.byMethod.cash ?? 0;
      result.set(shift.id, {
        invoicesCount: sales.invoicesCount,
        salesTotal: sales.salesTotal,
        cashTotal,
        cardTotal: sales.byMethod.card ?? 0,
        returnsCount: back.returnsCount,
        returnsTotal: back.returnsTotal,
        cashRefunds,
        creditTotal: sales.creditTotal,
        cashIn: drawer.cashIn,
        cashOut: drawer.cashOut,
        expectedCash: sumMoney([
          shift.openingCash,
          cashTotal,
          -cashRefunds,
          drawer.cashIn,
          -drawer.cashOut,
        ]),
      });
    }
    return result;
  }

  // ══════════════════════════ الورديات (للوحة التحكم) ══════════════════════════

  async findShifts(
    tenantId: string,
    query: PosShiftQueryDto,
  ): Promise<Paginated<PosShift>> {
    const { page, limit, skip } = resolvePagination(query);

    const qb = this.shifts
      .createQueryBuilder('shift')
      .withDeleted() // وردية جهاز حُذف لاحقاً تبقى ظاهرة
      .leftJoinAndSelect('shift.device', 'device')
      .where('shift.tenantId = :tenantId', { tenantId });
    restrictToScopedWarehouses(qb, 'device.warehouseId');

    if (query.deviceId) {
      qb.andWhere('shift.deviceId = :deviceId', { deviceId: query.deviceId });
    }
    if (query.status) {
      qb.andWhere('shift.status = :status', { status: query.status });
    }

    const [data, total] = await qb
      .orderBy('shift.openedAt', 'DESC')
      .addOrderBy('shift.id', 'ASC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    // الورديات المفتوحة: أرقامها حتى اللحظة، كلها في استعلامات مجمّعة
    // (المقفّلة محفوظة عند التقفيل)
    const open = data.filter((s) => s.status === PosShiftStatus.OPEN);
    if (open.length > 0) {
      const figures = await this.shiftFigures(tenantId, open);
      for (const shift of open) Object.assign(shift, figures.get(shift.id));
    }
    return paginated(data, total, page, limit);
  }

  // ══════════════════════════ داخلي ══════════════════════════

  private async activeDevice(id: string, tenantId: string): Promise<PosDevice> {
    const device = await this.findDevice(id, tenantId);
    if (!device.isActive) {
      throw new BadRequestException(`جهاز الكاشير "${device.name}" موقوف`);
    }
    return device;
  }

  /** الجهاز الفعّال، بشرط أن يكون الطالب هو المتصفح المربوط به */
  private async boundDevice(
    id: string,
    installationId: string,
    tenantId: string,
  ): Promise<PosDevice> {
    const device = await this.activeDevice(id, tenantId);
    if (device.installationId !== installationId) {
      throw new ConflictException(
        `هذه الشاشة ليست المربوطة بالجهاز "${device.name}" — اربطها بجهاز كاشير خاص بها`,
      );
    }
    return device;
  }

  private async assertCodeFree(code: string, tenantId: string): Promise<void> {
    const existing = await this.devices.findOne({
      where: { tenantId, code },
      withDeleted: true,
    });
    if (existing) {
      throw new ConflictException(
        `الكود "${code}" مستخدم لجهاز آخر (الأكواد لا تُعاد حتى بعد الحذف)`,
      );
    }
  }

  private async assertNoOpenShift(
    deviceId: string,
    tenantId: string,
    action: string,
  ): Promise<void> {
    const open = await this.shifts.count({
      where: { tenantId, deviceId, status: PosShiftStatus.OPEN },
    });
    if (open > 0) {
      throw new ConflictException(
        `لا يمكن ${action} الجهاز وعليه وردية مفتوحة`,
      );
    }
  }
}

/** يتحقق من بيانات عملية واحدة بنفس قواعد الـ DTO */
async function validated<T extends object>(
  type: new () => T,
  payload: Record<string, unknown>,
): Promise<T> {
  const instance = plainToInstance(type, payload);
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length > 0) {
    const first = errors[0];
    const message =
      Object.values(first.constraints ?? {})[0] ??
      `بيانات غير صحيحة في الحقل "${first.property}"`;
    throw new BadRequestException(message);
  }
  return instance;
}

/** خطأ فهرس فريد من PostgreSQL */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

/** وردية شركة أخرى أو جهاز آخر تُعامل كغير موجودة */
function assertShiftOfDevice(shift: PosShift, device: PosDevice): void {
  if (shift.tenantId !== device.tenantId || shift.deviceId !== device.id) {
    throw new NotFoundException('الوردية لا تخص هذا الجهاز');
  }
}

function toPosProduct(product: Product, decimals: number): PosProduct {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    isStocked: product.type === ProductType.STOCKED,
    categoryId: product.categoryId ?? null,
    baseUnitId: product.baseUnitId,
    baseUnitName: product.baseUnit?.name ?? '',
    allowsFractions: product.baseUnit?.allowsFractions ?? false,
    taxRate: product.taxRate?.rate ?? 0,
    salePrice: product.salePrice,
    priceIncludesTax: product.priceIncludesTax,
    minSalePrice: product.minSalePrice ?? null,
    allowDiscount: product.allowDiscount,
    isWeighted: product.isWeighted,
    openPrice: product.openPrice,
    available: !product.deletedAt && product.isActive,
    barcodes: (product.barcodes ?? []).map((b) => ({
      barcode: b.barcode,
      unitId: b.unitId ?? null,
    })),
    units: (product.units ?? []).map((u) => ({
      unitId: u.unitId,
      name: u.unit?.name ?? '',
      factor: u.factor,
      salePrice:
        u.salePrice ?? roundMoney(product.salePrice * u.factor, decimals),
    })),
  };
}

function toPosCustomer(customer: Customer): PosCustomer {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone ?? null,
    taxNumber: customer.taxNumber ?? null,
    creditLimit: customer.creditLimit ?? null,
    paymentTermsDays: customer.paymentTermsDays,
    available: !customer.deletedAt && customer.isActive,
  };
}
