// src/modules/inventory/warehouses.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Not, Repository } from 'typeorm';
import {
  assertWarehouseAllowed,
  assertWarehouseVisible,
  scopedWarehouseIds,
} from '../branches/branch-scope';
import { ensureMainBranch, resolveBranchId } from '../branches/branches.util';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/inventory.dto';
import { StockLevel } from './entities/stock-level.entity';
import {
  StockTransfer,
  StockTransferStatus,
} from './entities/stock-transfer.entity';
import { Warehouse, WarehouseType } from './entities/warehouse.entity';

const MAIN_WAREHOUSE_NAME = 'المخزن الرئيسي';

@Injectable()
export class WarehousesService {
  constructor(
    @InjectRepository(Warehouse)
    private readonly warehouses: Repository<Warehouse>,
    @InjectRepository(StockLevel)
    private readonly levels: Repository<StockLevel>,
    @InjectRepository(StockTransfer)
    private readonly transfers: Repository<StockTransfer>,
  ) {}

  /** مخازن الشركة التي يحق للمستخدم رؤيتها (مخازن فروعه)، مع فرع كل منها */
  async findAll(tenantId: string): Promise<Warehouse[]> {
    await this.ensureDefaults(tenantId);
    const allowed = scopedWarehouseIds();
    return this.warehouses.find({
      where: { tenantId, ...(allowed ? { id: In(allowed) } : {}) },
      relations: { branch: true },
      // الرئيسي أولاً (ترتيب قيم الـ enum في القاعدة: main ثم branch)
      order: { type: 'ASC', name: 'ASC' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<Warehouse> {
    const warehouse = await this.warehouses.findOne({
      where: { id, tenantId },
    });
    if (!warehouse) throw new NotFoundException('المخزن غير موجود');
    assertWarehouseVisible(warehouse.id, 'المخزن غير موجود');
    return warehouse;
  }

  /**
   * مخازن فعّالة تابعة للشركة — يرمي 404 إذا كان أحدها غير موجود.
   * داخل معاملة يُمرَّر الـ manager حتى لا يُطلب اتصال ثانٍ من الـ pool.
   *
   * كل مستند وكل حركة مخزون يمرّان من هنا، فهنا يُمنع المستخدم المقيَّد بفروع
   * من العمل على مخزن فرع آخر. `anyBranch` للحالة الوحيدة التي يُسمّى فيها
   * مخزن فرع آخر دون تحريك رصيده: الطرف المقابل في طلب تحويل.
   */
  async findActiveByIds(
    ids: string[],
    tenantId: string,
    manager?: EntityManager,
    { anyBranch = false }: { anyBranch?: boolean } = {},
  ): Promise<Warehouse[]> {
    const unique = [...new Set(ids)];
    const repository = manager?.getRepository(Warehouse) ?? this.warehouses;
    const found = await repository.find({
      where: { tenantId, id: In(unique) },
    });
    if (found.length !== unique.length) {
      throw new NotFoundException('المخزن غير موجود');
    }
    const inactive = found.find((w) => !w.isActive);
    if (inactive) {
      throw new BadRequestException(`المخزن "${inactive.name}" موقوف`);
    }
    if (!anyBranch) found.forEach((w) => assertWarehouseAllowed(w.id));
    return found;
  }

  async getMain(tenantId: string): Promise<Warehouse> {
    await this.ensureDefaults(tenantId);
    const main = await this.warehouses.findOne({
      where: { tenantId, type: WarehouseType.MAIN },
    });
    if (!main) throw new NotFoundException('لا يوجد مخزن رئيسي للشركة');
    return main;
  }

  /** عدد مخازن الشركة — يستخدمه حد الخطة (max_warehouses) */
  countActive(tenantId: string): Promise<number> {
    return this.warehouses.count({ where: { tenantId } });
  }

  /** كل مخزن جديد هو مخزن فرع؛ الرئيسي يُنشأ تلقائياً مرة واحدة */
  async create(dto: CreateWarehouseDto, tenantId: string): Promise<Warehouse> {
    await this.ensureDefaults(tenantId);
    await this.assertNameFree(dto.name, tenantId);
    const branchId = await resolveBranchId(
      this.warehouses.manager,
      tenantId,
      dto.branchId,
    );

    return this.warehouses.save(
      this.warehouses.create({
        ...dto,
        branchId,
        tenantId,
        type: WarehouseType.BRANCH,
      }),
    );
  }

  async update(
    id: string,
    dto: UpdateWarehouseDto,
    tenantId: string,
  ): Promise<Warehouse> {
    const warehouse = await this.findOne(id, tenantId);

    if (dto.name && dto.name !== warehouse.name) {
      await this.assertNameFree(dto.name, tenantId, id);
    }
    if (warehouse.type === WarehouseType.MAIN && dto.isActive === false) {
      throw new BadRequestException('لا يمكن إيقاف المخزن الرئيسي');
    }
    if (dto.isActive === false && warehouse.isActive) {
      await this.assertNoOpenTransfers(id, tenantId, 'إيقاف');
    }
    // نقل المخزن إلى فرع آخر ينقل معه تاريخه كله: فرع المستند هو فرع مخزنه
    if (dto.branchId && dto.branchId !== warehouse.branchId) {
      await resolveBranchId(this.warehouses.manager, tenantId, dto.branchId);
    }

    Object.assign(warehouse, dto);
    return this.warehouses.save(warehouse);
  }

  /** حذف منطقي: حركات المخزن القديمة تبقى تشير إليه */
  async remove(id: string, tenantId: string): Promise<void> {
    const warehouse = await this.findOne(id, tenantId);

    if (warehouse.type === WarehouseType.MAIN) {
      throw new BadRequestException('لا يمكن حذف المخزن الرئيسي');
    }
    const withStock = await this.levels.count({
      where: { tenantId, warehouseId: id, quantity: Not(0) },
    });
    if (withStock > 0) {
      throw new ConflictException(
        `لا يمكن حذف المخزن: به أرصدة لـ ${withStock} صنف. حوّلها أو سوِّها أولاً`,
      );
    }
    await this.assertNoOpenTransfers(id, tenantId, 'حذف');

    await this.warehouses.softRemove(warehouse);
  }

  // ══════════════════════════ داخلي ══════════════════════════

  /**
   * ينشئ المخزن الرئيسي عند أول استخدام للموديول. يُحسب المحذوف أيضاً حتى لا
   * يُعاد إنشاؤه، والفهرس الفريد يمنع التكرار عند طلبين متزامنين.
   */
  private async ensureDefaults(tenantId: string): Promise<void> {
    const existing = await this.warehouses.count({
      where: { tenantId },
      withDeleted: true,
    });
    if (existing > 0) return;

    const branch = await ensureMainBranch(this.warehouses.manager, tenantId);
    await this.warehouses
      .createQueryBuilder()
      .insert()
      .values({
        tenantId,
        branchId: branch.id,
        name: MAIN_WAREHOUSE_NAME,
        type: WarehouseType.MAIN,
        allowNegativeStock: false,
      })
      .orIgnore()
      .execute();
  }

  private async assertNameFree(
    name: string,
    tenantId: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.warehouses.findOne({
      where: { tenantId, name },
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`يوجد مخزن آخر باسم "${name}"`);
    }
  }

  private async assertNoOpenTransfers(
    warehouseId: string,
    tenantId: string,
    action: string,
  ): Promise<void> {
    const open = [StockTransferStatus.DRAFT, StockTransferStatus.IN_TRANSIT];
    const count = await this.transfers.count({
      where: [
        { tenantId, fromWarehouseId: warehouseId, status: In(open) },
        { tenantId, toWarehouseId: warehouseId, status: In(open) },
      ],
    });
    if (count > 0) {
      throw new ConflictException(
        `لا يمكن ${action} المخزن: عليه ${count} تحويل لم يكتمل`,
      );
    }
  }
}
