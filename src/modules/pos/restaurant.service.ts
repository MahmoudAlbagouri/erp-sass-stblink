// src/modules/pos/restaurant.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, IsNull, Repository } from 'typeorm';
import {
  assertBranchAllowed,
  assertBranchVisible,
  scopedBranchIds,
} from '../branches/branch-scope';
import {
  BulkCreateTablesDto,
  CreateDiningTableDto,
  KitchenCloseOp,
  KitchenSendOp,
  UpdateDiningTableDto,
  UpdateRestaurantSettingsDto,
} from './dto/restaurant.dto';
import { PosDevice } from './entities/pos.entity';
import {
  DiningTable,
  KitchenOrder,
  KitchenOrderStatus,
  RestaurantSettings,
} from './entities/restaurant.entity';

/** ما ينزل لشاشة الكاشير (null في البوتستراب = الباقة بلا مطاعم) */
export interface PosRestaurantOptions {
  tables: { id: string; name: string; area: string | null; seats: number }[];
  /** تصنيفات تُحضَّر في المطبخ. فارغة = كل الأصناف */
  kitchenCategoryIds: string[];
  printKitchenTicket: boolean;
  sendOnPayment: boolean;
}

/** حالة بون كما تعرفها شاشة الكاشير (للتنبيه بالجاهز) */
export interface DeviceKitchenOrder {
  id: string;
  ticketNo: number;
  orderRef: string;
  tableName: string | null;
  label: string | null;
  status: KitchenOrderStatus;
  readyAt: Date | null;
}

const TABLE_NOT_FOUND = 'الطاولة غير موجودة';
const ORDER_NOT_FOUND = 'طلب المطبخ غير موجود';
/** أقصى طاولات في إضافة جماعية واحدة */
const MAX_BULK_TABLES = 200;
/** الجاهز يبقى على شاشة المطبخ حتى يُسلَّم أو تمر هذه المدة */
const READY_VISIBLE_HOURS = 2;
/** طلب لم يُنهَ خلال يوم لا يبقى على الشاشات */
const ACTIVE_WINDOW_HOURS = 24;

/**
 * وقت الإرسال كما على الجهاز (بون أُرسل بلا إنترنت يحمل وقته الحقيقي). ساعة
 * جهاز خاطئة (في المستقبل، أو متأخرة أكثر من يوم) لا تُخفي البون عن شاشة
 * المطبخ ولا تُفسد مدته: يُعتمد وقت وصوله.
 */
function sentTime(value: string): Date {
  const sent = new Date(value);
  const now = new Date();
  const age = now.getTime() - sent.getTime();
  return age < 0 || age > ACTIVE_WINDOW_HOURS * 3_600_000 ? now : sent;
}

/** الانتقالات المسموحة على شاشة المطبخ (والرجوع خطوة لتصحيح ضغطة خطأ) */
const TRANSITIONS: Record<KitchenOrderStatus, KitchenOrderStatus[]> = {
  [KitchenOrderStatus.NEW]: [
    KitchenOrderStatus.PREPARING,
    KitchenOrderStatus.READY,
    KitchenOrderStatus.CANCELLED,
  ],
  [KitchenOrderStatus.PREPARING]: [
    KitchenOrderStatus.NEW,
    KitchenOrderStatus.READY,
    KitchenOrderStatus.CANCELLED,
  ],
  [KitchenOrderStatus.READY]: [
    KitchenOrderStatus.PREPARING,
    KitchenOrderStatus.SERVED,
  ],
  [KitchenOrderStatus.SERVED]: [KitchenOrderStatus.READY],
  [KitchenOrderStatus.CANCELLED]: [],
};

const STATUS_LABEL: Record<KitchenOrderStatus, string> = {
  [KitchenOrderStatus.NEW]: 'جديد',
  [KitchenOrderStatus.PREPARING]: 'قيد التحضير',
  [KitchenOrderStatus.READY]: 'جاهز',
  [KitchenOrderStatus.SERVED]: 'سُلّم',
  [KitchenOrderStatus.CANCELLED]: 'ملغي',
};

/**
 * المطاعم: الطاولات وإعدادات المطبخ (لوحة التحكم)، وطلبات المطبخ — ترفعها
 * شاشات الكاشير في طابورها (تعمل بلا إنترنت) وتعرضها شاشة المطبخ بحالتها.
 */
@Injectable()
export class RestaurantService {
  constructor(
    @InjectRepository(DiningTable)
    private readonly tables: Repository<DiningTable>,
    @InjectRepository(KitchenOrder)
    private readonly orders: Repository<KitchenOrder>,
    @InjectRepository(RestaurantSettings)
    private readonly settings: Repository<RestaurantSettings>,
  ) {}

  // ══════════════════════════ الطاولات ══════════════════════════

  /** طاولات الشركة (المقيَّد بفروع: طاولات فروعه والمشتركة) */
  findTables(tenantId: string): Promise<DiningTable[]> {
    const qb = this.tables
      .createQueryBuilder('t')
      .where('t.tenantId = :tenantId', { tenantId });
    const allowed = scopedBranchIds();
    if (allowed) {
      qb.andWhere('(t.branchId IS NULL OR t.branchId IN (:...allowed))', {
        allowed,
      });
    }
    return qb
      .orderBy('t.area', 'ASC', 'NULLS FIRST')
      .addOrderBy('t.sortOrder', 'ASC')
      .addOrderBy('t.name', 'ASC')
      .getMany();
  }

  async createTable(
    dto: CreateDiningTableDto,
    tenantId: string,
  ): Promise<DiningTable> {
    const branchId = await this.branchOf(dto.branchId, tenantId);
    const name = dto.name.trim();
    await this.assertNameFree(name, branchId, tenantId);
    const sortOrder =
      dto.sortOrder ?? (await this.nextSortOrder(tenantId, branchId));
    return this.tables.save(
      this.tables.create({
        tenantId,
        name,
        area: dto.area?.trim() || null,
        seats: dto.seats ?? 4,
        branchId,
        sortOrder,
        isActive: dto.isActive ?? true,
      }),
    );
  }

  /** "طاولة 1" … "طاولة 20": ما كان موجوداً باسمه يُتخطّى */
  async createTables(
    dto: BulkCreateTablesDto,
    tenantId: string,
  ): Promise<{ created: number; skipped: number }> {
    if (dto.to < dto.from) {
      throw new BadRequestException('رقم البداية بعد رقم النهاية');
    }
    if (dto.to - dto.from + 1 > MAX_BULK_TABLES) {
      throw new BadRequestException(
        `حتى ${MAX_BULK_TABLES} طاولة في المرة الواحدة`,
      );
    }
    const branchId = await this.branchOf(dto.branchId, tenantId);
    const prefix = (dto.prefix ?? 'طاولة').trim();
    const existing = new Set(
      (await this.sameScope(tenantId, branchId)).map((t) =>
        t.name.toLowerCase(),
      ),
    );
    const rows: Partial<DiningTable>[] = [];
    for (let n = dto.from; n <= dto.to; n++) {
      const name = prefix ? `${prefix} ${n}` : String(n);
      if (existing.has(name.toLowerCase())) continue;
      rows.push({
        tenantId,
        name,
        area: dto.area?.trim() || null,
        seats: dto.seats ?? 4,
        branchId,
        sortOrder: n,
        isActive: true,
      });
    }
    if (rows.length) await this.tables.insert(rows);
    return {
      created: rows.length,
      skipped: dto.to - dto.from + 1 - rows.length,
    };
  }

  async updateTable(
    id: string,
    dto: UpdateDiningTableDto,
    tenantId: string,
  ): Promise<DiningTable> {
    const table = await this.findTable(id, tenantId);
    const branchId =
      dto.branchId !== undefined
        ? await this.branchOf(dto.branchId, tenantId)
        : (table.branchId ?? null);
    const name = dto.name !== undefined ? dto.name.trim() : table.name;
    if (
      name.toLowerCase() !== table.name.toLowerCase() ||
      branchId !== (table.branchId ?? null)
    ) {
      await this.assertNameFree(name, branchId, tenantId, table.id);
    }
    Object.assign(table, {
      name,
      branchId,
      ...(dto.area !== undefined ? { area: dto.area?.trim() || null } : {}),
      ...(dto.seats !== undefined ? { seats: dto.seats } : {}),
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    });
    return this.tables.save(table);
  }

  /** حذف منطقي: بونات المطبخ القديمة تحمل اسمها */
  async removeTable(id: string, tenantId: string): Promise<void> {
    const table = await this.findTable(id, tenantId);
    await this.tables.softDelete({ id: table.id, tenantId });
  }

  private async findTable(id: string, tenantId: string): Promise<DiningTable> {
    const table = await this.tables.findOne({ where: { id, tenantId } });
    if (!table) throw new NotFoundException(TABLE_NOT_FOUND);
    if (table.branchId) assertBranchVisible(table.branchId, TABLE_NOT_FOUND);
    return table;
  }

  /** فرع مختار: موجود في الشركة وضمن فروع المستخدم. فارغ = كل الفروع */
  private async branchOf(
    branchId: string | null | undefined,
    tenantId: string,
  ): Promise<string | null> {
    if (!branchId) {
      // المقيَّد بفروع لا ينشئ طاولة تظهر في فروع غيره
      if (scopedBranchIds()) {
        throw new BadRequestException('اختر فرع الطاولة');
      }
      return null;
    }
    assertBranchAllowed(branchId);
    const [row] = await this.tables.manager.query<{ id: string }[]>(
      `SELECT "id" FROM branches
        WHERE "id" = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL`,
      [branchId, tenantId],
    );
    if (!row) throw new BadRequestException('الفرع غير موجود');
    return branchId;
  }

  /** طاولات تظهر مع طاولة بهذا الفرع (نفس الفرع، أو المشتركة) */
  private sameScope(
    tenantId: string,
    branchId: string | null,
  ): Promise<DiningTable[]> {
    return this.tables.find({
      where: branchId
        ? [
            { tenantId, branchId },
            { tenantId, branchId: IsNull() },
          ]
        : { tenantId },
      select: { id: true, name: true, sortOrder: true },
    });
  }

  private async assertNameFree(
    name: string,
    branchId: string | null,
    tenantId: string,
    exceptId?: string,
  ): Promise<void> {
    const clash = (await this.sameScope(tenantId, branchId)).find(
      (t) => t.id !== exceptId && t.name.toLowerCase() === name.toLowerCase(),
    );
    if (clash) throw new ConflictException(`الطاولة "${name}" موجودة`);
  }

  private async nextSortOrder(
    tenantId: string,
    branchId: string | null,
  ): Promise<number> {
    const rows = await this.sameScope(tenantId, branchId);
    return rows.reduce((max, t) => Math.max(max, t.sortOrder), 0) + 1;
  }

  // ══════════════════════════ الإعدادات ══════════════════════════

  /** إعدادات المطبخ — تُنشأ بالافتراضي عند أول قراءة */
  async getSettings(tenantId: string): Promise<RestaurantSettings> {
    const existing = await this.settings.findOne({ where: { tenantId } });
    if (existing) return existing;
    await this.settings
      .createQueryBuilder()
      .insert()
      .values({ tenantId })
      .orIgnore()
      .execute();
    return this.settings.findOneOrFail({ where: { tenantId } });
  }

  async updateSettings(
    tenantId: string,
    dto: UpdateRestaurantSettingsDto,
  ): Promise<RestaurantSettings> {
    const current = await this.getSettings(tenantId);
    if (dto.kitchenCategoryIds) {
      const ids = [...new Set(dto.kitchenCategoryIds)];
      if (ids.length) {
        const [{ count }] = await this.settings.manager.query<
          { count: string }[]
        >(
          `SELECT COUNT(*) AS "count" FROM product_categories
            WHERE "tenantId" = $1 AND "id" = ANY($2::uuid[]) AND "deletedAt" IS NULL`,
          [tenantId, ids],
        );
        if (Number(count) !== ids.length) {
          throw new BadRequestException('تصنيف غير موجود');
        }
      }
      current.kitchenCategoryIds = ids;
    }
    if (dto.printKitchenTicket !== undefined) {
      current.printKitchenTicket = dto.printKitchenTicket;
    }
    if (dto.sendOnPayment !== undefined) {
      current.sendOnPayment = dto.sendOnPayment;
    }
    return this.settings.save(current);
  }

  /** ما ينزل لشاشة الكاشير: طاولات فرعها (والمشتركة) وإعدادات المطبخ */
  async deviceOptions(device: PosDevice): Promise<PosRestaurantOptions> {
    const { tenantId } = device;
    const branchId = await this.deviceBranch(device);
    const [tables, settings] = await Promise.all([
      this.tables.find({
        where: branchId
          ? [
              { tenantId, isActive: true, branchId },
              { tenantId, isActive: true, branchId: IsNull() },
            ]
          : { tenantId, isActive: true, branchId: IsNull() },
        order: { area: 'ASC', sortOrder: 'ASC', name: 'ASC' },
      }),
      this.getSettings(tenantId),
    ]);
    return {
      tables: tables.map((t) => ({
        id: t.id,
        name: t.name,
        area: t.area ?? null,
        seats: t.seats,
      })),
      kitchenCategoryIds: settings.kitchenCategoryIds ?? [],
      printKitchenTicket: settings.printKitchenTicket,
      sendOnPayment: settings.sendOnPayment,
    };
  }

  // ══════════════════════════ من شاشة الكاشير ══════════════════════════

  /**
   * بون مطبخ رفعه الجهاز. @returns true إن كان مسجّلاً من قبل (رفع مكرر)
   */
  async recordKitchenOrder(
    op: KitchenSendOp,
    device: PosDevice,
  ): Promise<boolean> {
    const existing = await this.orders.findOne({
      where: { id: op.id },
      select: { id: true, tenantId: true, deviceId: true },
    });
    if (existing) {
      if (
        existing.tenantId !== device.tenantId ||
        existing.deviceId !== device.id
      ) {
        throw new ConflictException('معرّف طلب المطبخ مستخدم');
      }
      return true;
    }
    try {
      await this.orders.insert({
        id: op.id,
        tenantId: device.tenantId,
        deviceId: device.id,
        branchId: await this.deviceBranch(device),
        shiftId: op.shiftId ?? null,
        ticketNo: op.ticketNo,
        orderType: op.orderType,
        tableId: op.tableId ?? null,
        tableName: op.tableName?.trim() || null,
        label: op.label?.trim() || null,
        orderRef: op.orderRef,
        round: op.round,
        cashierName: op.cashierName?.trim() || null,
        note: op.note?.trim() || null,
        lines: op.lines.map((line) => ({
          productId: line.productId ?? null,
          name: line.name.trim(),
          unitName: line.unitName?.trim() || null,
          quantity: line.quantity,
          note: line.note?.trim() || null,
        })),
        status: KitchenOrderStatus.NEW,
        sentAt: sentTime(op.sentAt),
      });
    } catch (error) {
      // طلبا رفع متزامنان لنفس البون: الثاني مكرر
      if ((error as { code?: string } | null)?.code === '23505') return true;
      throw error;
    }
    return false;
  }

  /**
   * الطاولة دفعت: ما جهز من بوناتها سُلّم. ما لم يجهز يبقى على شاشة المطبخ
   * (الطعام لم يُحضَّر بعد). @returns true إن لم يبقَ ما يُغلق
   */
  async closeKitchenOrders(
    op: KitchenCloseOp,
    device: PosDevice,
  ): Promise<boolean> {
    const result = await this.orders.update(
      {
        tenantId: device.tenantId,
        deviceId: device.id,
        orderRef: op.orderRef,
        status: KitchenOrderStatus.READY,
      },
      { status: KitchenOrderStatus.SERVED, servedAt: new Date(op.closedAt) },
    );
    return !result.affected;
  }

  /** بونات هذا الجهاز التي لم تُسلَّم (آخر يوم): بها ينبّه الكاشير بالجاهز */
  async deviceKitchenOrders(device: PosDevice): Promise<DeviceKitchenOrder[]> {
    const rows = await this.orders
      .createQueryBuilder('o')
      .select([
        'o.id',
        'o.ticketNo',
        'o.orderRef',
        'o.tableName',
        'o.label',
        'o.status',
        'o.readyAt',
      ])
      .where('o.tenantId = :tenantId AND o.deviceId = :deviceId', {
        tenantId: device.tenantId,
        deviceId: device.id,
      })
      .andWhere('o.status IN (:...active)', {
        active: [
          KitchenOrderStatus.NEW,
          KitchenOrderStatus.PREPARING,
          KitchenOrderStatus.READY,
        ],
      })
      .andWhere(`o.sentAt > now() - interval '${ACTIVE_WINDOW_HOURS} hours'`)
      .orderBy('o.sentAt', 'ASC')
      .getMany();
    return rows.map((o) => ({
      id: o.id,
      ticketNo: o.ticketNo,
      orderRef: o.orderRef,
      tableName: o.tableName ?? null,
      label: o.label ?? null,
      status: o.status,
      readyAt: o.readyAt ?? null,
    }));
  }

  /** الكاشير استلم الطلب الجاهز من المطبخ */
  async serveFromDevice(id: string, device: PosDevice): Promise<KitchenOrder> {
    const order = await this.orders.findOne({
      where: { id, tenantId: device.tenantId, deviceId: device.id },
    });
    if (!order) throw new NotFoundException(ORDER_NOT_FOUND);
    if (order.status === KitchenOrderStatus.SERVED) return order;
    return this.applyStatus(order, KitchenOrderStatus.SERVED);
  }

  // ══════════════════════════ شاشة المطبخ ══════════════════════════

  /**
   * طلبات المطبخ: الجديد وقيد التحضير، والجاهز الذي لم يُسلَّم (آخر ساعتين).
   * لفرع واحد، أو لكل فروع المستخدم.
   */
  async board(tenantId: string, branchId?: string): Promise<KitchenOrder[]> {
    const qb = this.orders
      .createQueryBuilder('o')
      .where('o.tenantId = :tenantId', { tenantId })
      .andWhere(`o.sentAt > now() - interval '${ACTIVE_WINDOW_HOURS} hours'`)
      .andWhere(
        new Brackets((w) =>
          w
            .where('o.status IN (:...cooking)', {
              cooking: [KitchenOrderStatus.NEW, KitchenOrderStatus.PREPARING],
            })
            .orWhere(
              `(o.status = :ready AND o.readyAt > now() - interval '${READY_VISIBLE_HOURS} hours')`,
              { ready: KitchenOrderStatus.READY },
            ),
        ),
      );
    if (branchId) {
      assertBranchAllowed(branchId);
      qb.andWhere('o.branchId = :branchId', { branchId });
    } else {
      const allowed = scopedBranchIds();
      if (allowed) qb.andWhere('o.branchId IN (:...allowed)', { allowed });
    }
    return qb.orderBy('o.sentAt', 'ASC').addOrderBy('o.round', 'ASC').getMany();
  }

  async updateStatus(
    id: string,
    status: KitchenOrderStatus,
    tenantId: string,
  ): Promise<KitchenOrder> {
    const order = await this.orders.findOne({ where: { id, tenantId } });
    if (!order) throw new NotFoundException(ORDER_NOT_FOUND);
    assertBranchVisible(order.branchId, ORDER_NOT_FOUND);
    if (order.status === status) return order;
    if (!TRANSITIONS[order.status].includes(status)) {
      throw new BadRequestException(
        `لا يُنقل الطلب من "${STATUS_LABEL[order.status]}" إلى "${STATUS_LABEL[status]}"`,
      );
    }
    return this.applyStatus(order, status);
  }

  /** الحالة وأوقاتها: الرجوع خطوة يمسح وقت الخطوة التي أُلغيت */
  private applyStatus(
    order: KitchenOrder,
    status: KitchenOrderStatus,
  ): Promise<KitchenOrder> {
    const now = new Date();
    switch (status) {
      case KitchenOrderStatus.NEW:
        order.startedAt = null;
        break;
      case KitchenOrderStatus.PREPARING:
        order.startedAt ??= now;
        order.readyAt = null;
        break;
      case KitchenOrderStatus.READY:
        order.startedAt ??= now;
        order.readyAt = now;
        order.servedAt = null;
        break;
      case KitchenOrderStatus.SERVED:
        order.readyAt ??= now;
        order.servedAt = now;
        break;
    }
    order.status = status;
    return this.orders.save(order);
  }

  /** فرع جهاز الكاشير (فرع مخزنه) */
  private async deviceBranch(device: PosDevice): Promise<string | null> {
    if (device.warehouse?.branchId) return device.warehouse.branchId;
    const [row] = await this.orders.manager.query<
      { branchId: string | null }[]
    >(`SELECT "branchId" FROM warehouses WHERE "id" = $1 AND "tenantId" = $2`, [
      device.warehouseId,
      device.tenantId,
    ]);
    return row?.branchId ?? null;
  }
}
