// src/modules/pos/restaurant-menu.service.ts
import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import {
  assertBranchAllowed,
  assertWarehouseAllowed,
  scopedBranchIds,
} from '../branches/branch-scope';
import { Product, ProductType } from '../catalog/entities/product.entity';
import {
  StockAdjustmentReason,
  StockMovementType,
} from '../inventory/entities/stock-movement.entity';
import { StockEntry, StockService } from '../inventory/stock.service';
import { RecipeConsumptionService } from '../manufacturing/recipe-consumption.service';
import {
  CreateKitchenStationDto,
  CreateModifierGroupDto,
  DishWasteDto,
  UpdateKitchenStationDto,
  UpdateModifierGroupDto,
} from './dto/restaurant-menu.dto';
import {
  KitchenStation,
  ModifierGroup,
  ModifierOption,
  ProductModifierGroup,
} from './entities/restaurant-menu.entity';

/** مجموعة إضافات كما تنزل لشاشة الكاشير */
export interface PosModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: {
    id: string;
    name: string;
    priceDelta: number;
    isDefault: boolean;
  }[];
}

/** مفتاح ما بلا محطة في تقدّم البون */
export const GENERAL_STATION = 'general';

/**
 * قائمة المطعم: الإضافات والوجبات (خيارات بسعر وأثر مخزني)، ربطها بالأصناف،
 * محطات المطبخ وتوزيع أسطر البون عليها، وهالك الأطباق (تُفك وصفتها وتخرج
 * مكوّناتها كتسوية هالك).
 */
@Injectable()
export class RestaurantMenuService {
  constructor(
    @InjectRepository(ModifierGroup)
    private readonly groups: Repository<ModifierGroup>,
    @InjectRepository(KitchenStation)
    private readonly stations: Repository<KitchenStation>,
    private readonly dataSource: DataSource,
    private readonly stock: StockService,
    private readonly recipes: RecipeConsumptionService,
  ) {}

  // ══════════════════════════ الإضافات ══════════════════════════

  async findGroups(tenantId: string): Promise<ModifierGroup[]> {
    const groups = await this.groups.find({
      where: { tenantId },
      relations: ['options'],
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    for (const group of groups) {
      group.options?.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return groups;
  }

  async findGroup(id: string, tenantId: string): Promise<ModifierGroup> {
    const group = await this.groups.findOne({
      where: { id, tenantId },
      relations: ['options'],
    });
    if (!group) throw new NotFoundException('مجموعة الإضافات غير موجودة');
    group.options?.sort((a, b) => a.sortOrder - b.sortOrder);
    return group;
  }

  async createGroup(
    dto: CreateModifierGroupDto,
    tenantId: string,
  ): Promise<ModifierGroup> {
    assertSelection(dto.minSelect ?? 0, dto.maxSelect ?? 1);
    await this.assertOptionProducts(dto.options, tenantId);
    const id = await this.dataSource.transaction(async (manager) => {
      await this.assertNameFree(manager, tenantId, dto.name);
      const group = await manager.save(
        manager.create(ModifierGroup, {
          tenantId,
          name: dto.name.trim(),
          minSelect: dto.minSelect ?? 0,
          maxSelect: dto.maxSelect ?? 1,
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
        }),
      );
      await this.saveOptions(manager, group.id, tenantId, dto.options);
      return group.id;
    });
    return this.findGroup(id, tenantId);
  }

  async updateGroup(
    id: string,
    dto: UpdateModifierGroupDto,
    tenantId: string,
  ): Promise<ModifierGroup> {
    const current = await this.findGroup(id, tenantId);
    assertSelection(
      dto.minSelect ?? current.minSelect,
      dto.maxSelect ?? current.maxSelect,
    );
    if (dto.options) await this.assertOptionProducts(dto.options, tenantId);
    await this.dataSource.transaction(async (manager) => {
      if (dto.name && dto.name.trim() !== current.name) {
        await this.assertNameFree(manager, tenantId, dto.name, id);
      }
      await manager.update(
        ModifierGroup,
        { id, tenantId },
        {
          ...(dto.name ? { name: dto.name.trim() } : {}),
          ...(dto.minSelect !== undefined ? { minSelect: dto.minSelect } : {}),
          ...(dto.maxSelect !== undefined ? { maxSelect: dto.maxSelect } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      );
      if (dto.options) {
        await this.saveOptions(manager, id, tenantId, dto.options);
      }
    });
    return this.findGroup(id, tenantId);
  }

  async removeGroup(id: string, tenantId: string): Promise<void> {
    await this.findGroup(id, tenantId);
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(ProductModifierGroup, { groupId: id, tenantId });
      await manager.softDelete(ModifierGroup, { id, tenantId });
    });
  }

  /** مجموعات صنف بترتيبها */
  async productGroups(
    productId: string,
    tenantId: string,
  ): Promise<ModifierGroup[]> {
    const links = await this.dataSource.manager.find(ProductModifierGroup, {
      where: { tenantId, productId },
      order: { sortOrder: 'ASC' },
    });
    if (!links.length) return [];
    const groups = await this.groups.find({
      where: { tenantId, id: In(links.map((l) => l.groupId)) },
      relations: ['options'],
    });
    const order = new Map(links.map((l, i) => [l.groupId, i]));
    return groups.sort(
      (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
    );
  }

  /** مجموعات الصنف (تستبدل القائمة كلها بترتيبها) */
  async setProductGroups(
    productId: string,
    groupIds: string[],
    tenantId: string,
  ): Promise<ModifierGroup[]> {
    const product = await this.dataSource.manager.findOne(Product, {
      where: { id: productId, tenantId },
    });
    if (!product) throw new NotFoundException('الصنف غير موجود');
    const unique = [...new Set(groupIds)];
    if (unique.length) {
      const found = await this.groups.count({
        where: { tenantId, id: In(unique) },
      });
      if (found !== unique.length) {
        throw new NotFoundException('مجموعة إضافات غير موجودة');
      }
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(ProductModifierGroup, { productId, tenantId });
      if (unique.length) {
        await manager.save(
          unique.map((groupId, index) =>
            manager.create(ProductModifierGroup, {
              tenantId,
              productId,
              groupId,
              sortOrder: index,
            }),
          ),
        );
      }
      // الجهاز يسحب الأصناف بما تغيّر: لمسة على الصنف تنزل ربطه الجديد
      await manager.update(
        Product,
        { id: productId },
        { updatedAt: new Date() },
      );
    });
    return this.productGroups(productId, tenantId);
  }

  /** ما ينزل للكاشير: المجموعات الفعّالة وخياراتها، وأي مجموعات لأي صنف */
  async deviceMenu(tenantId: string): Promise<{
    modifierGroups: PosModifierGroup[];
    productModifierGroups: Record<string, string[]>;
  }> {
    const [groups, links] = await Promise.all([
      this.groups.find({
        where: { tenantId, isActive: true },
        relations: ['options'],
        order: { sortOrder: 'ASC', name: 'ASC' },
      }),
      this.dataSource.manager.find(ProductModifierGroup, {
        where: { tenantId },
        order: { sortOrder: 'ASC' },
      }),
    ]);
    const active = new Set(groups.map((g) => g.id));
    const productModifierGroups: Record<string, string[]> = {};
    for (const link of links) {
      if (!active.has(link.groupId)) continue;
      (productModifierGroups[link.productId] ??= []).push(link.groupId);
    }
    return {
      modifierGroups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        options: (g.options ?? [])
          .filter((o) => o.isActive)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((o) => ({
            id: o.id,
            name: o.name,
            priceDelta: o.priceDelta,
            isDefault: o.isDefault,
          })),
      })),
      productModifierGroups,
    };
  }

  // ══════════════════════════ محطات المطبخ ══════════════════════════

  findStations(tenantId: string): Promise<KitchenStation[]> {
    const allowed = scopedBranchIds();
    const qb = this.stations
      .createQueryBuilder('s')
      .where('s.tenantId = :tenantId', { tenantId });
    if (allowed) {
      qb.andWhere('(s.branchId IS NULL OR s.branchId IN (:...allowed))', {
        allowed,
      });
    }
    return qb
      .orderBy('s.sortOrder', 'ASC')
      .addOrderBy('s.name', 'ASC')
      .getMany();
  }

  async createStation(
    dto: CreateKitchenStationDto,
    tenantId: string,
  ): Promise<KitchenStation> {
    if (dto.branchId) assertBranchAllowed(dto.branchId);
    const taken = await this.stations.findOne({
      where: { tenantId, name: dto.name.trim() },
    });
    if (taken) throw new ConflictException('اسم المحطة مستخدم');
    return this.stations.save(
      this.stations.create({
        tenantId,
        name: dto.name.trim(),
        branchId: dto.branchId ?? null,
        categoryIds: dto.categoryIds ?? [],
        targetMinutes: dto.targetMinutes ?? null,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      }),
    );
  }

  async updateStation(
    id: string,
    dto: UpdateKitchenStationDto,
    tenantId: string,
  ): Promise<KitchenStation> {
    const station = await this.stations.findOne({ where: { id, tenantId } });
    if (!station) throw new NotFoundException('المحطة غير موجودة');
    if (dto.branchId) assertBranchAllowed(dto.branchId);
    Object.assign(station, {
      ...dto,
      ...(dto.name ? { name: dto.name.trim() } : {}),
    });
    return this.stations.save(station);
  }

  async removeStation(id: string, tenantId: string): Promise<void> {
    const station = await this.stations.findOne({ where: { id, tenantId } });
    if (!station) throw new NotFoundException('المحطة غير موجودة');
    await this.stations.softDelete({ id, tenantId });
  }

  /**
   * محطة كل صنف في فرع: أول محطة (بالترتيب) فيها تصنيفه، وإلا المحطة بلا
   * تصنيفات (تستلم الباقي)، وإلا null (المطبخ العام). لا محطات = خريطة فارغة.
   */
  async routeProducts(
    tenantId: string,
    branchId: string | null,
    productIds: string[],
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Map<string, string | null>> {
    const stations = await manager.find(KitchenStation, {
      where: branchId
        ? [
            { tenantId, isActive: true, branchId },
            { tenantId, isActive: true, branchId: IsNull() },
          ]
        : { tenantId, isActive: true, branchId: IsNull() },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    const result = new Map<string, string | null>();
    if (!stations.length || !productIds.length) return result;
    const products = await manager.find(Product, {
      where: { tenantId, id: In([...new Set(productIds)]) },
      select: ['id', 'categoryId'],
      withDeleted: true,
    });
    const fallback = stations.find((s) => !s.categoryIds?.length) ?? null;
    for (const product of products) {
      const station = stations.find(
        (s) =>
          !!product.categoryId && s.categoryIds?.includes(product.categoryId),
      );
      result.set(product.id, (station ?? fallback)?.id ?? null);
    }
    return result;
  }

  // ══════════════════════════ الهالك ══════════════════════════

  /**
   * هالك طبق (أو مكوّن): الطبق تُفك وصفته وتخرج مكوّناته كتسوية سببها "هالك"
   * — تُرحَّل محاسبياً كأي تسوية مخزون. @returns حركات المخزون
   */
  async recordWaste(
    dto: DishWasteDto,
    tenantId: string,
    userId?: string,
  ): Promise<{
    components: { productId: string; quantity: number; unitCost: number }[];
  }> {
    assertWarehouseAllowed(dto.warehouseId);
    const product = await this.dataSource.manager.findOne(Product, {
      where: { id: dto.productId, tenantId },
    });
    if (!product) throw new NotFoundException('الصنف غير موجود');
    if (product.type === ProductType.SERVICE) {
      throw new BadRequestException('الخدمة لا هالك لها');
    }
    return this.dataSource.transaction(async (manager) => {
      let entries: StockEntry[];
      const note = dto.note
        ? `هالك: ${product.name} — ${dto.note}`
        : `هالك: ${product.name}`;
      if (product.type === ProductType.COMPOSITE) {
        const [components] = await this.recipes.explode(manager, tenantId, [
          { productId: product.id, quantity: dto.quantity },
        ]);
        if (!components.size) {
          throw new BadRequestException(
            `"${product.name}" بلا وصفة فعّالة — لا مكوّنات تُخصم`,
          );
        }
        entries = [...components.entries()].map(([productId, quantity]) => ({
          warehouseId: dto.warehouseId,
          productId,
          type: StockMovementType.ADJUSTMENT,
          quantity: -quantity.toNumber(),
          reason: StockAdjustmentReason.WASTE,
          note,
        }));
      } else {
        entries = [
          {
            warehouseId: dto.warehouseId,
            productId: product.id,
            type: StockMovementType.ADJUSTMENT,
            quantity: -dto.quantity,
            reason: StockAdjustmentReason.WASTE,
            note,
          },
        ];
      }
      const results = await this.stock.apply(manager, tenantId, entries, {
        // مستند تسوية واحد: يُرحَّل قيداً واحداً كالتسويات اليدوية
        referenceType: 'adjustment',
        referenceId: randomUUID(),
        userId,
        allowNegative: true,
      });
      return {
        components: entries.map((entry, i) => ({
          productId: entry.productId,
          quantity: -entry.quantity!,
          unitCost: results[i].unitCost,
        })),
      };
    });
  }

  // ══════════════════════════ داخلي ══════════════════════════

  private async saveOptions(
    manager: EntityManager,
    groupId: string,
    tenantId: string,
    options: CreateModifierGroupDto['options'],
  ): Promise<void> {
    const existing = await manager.find(ModifierOption, {
      where: { groupId },
    });
    const keep = new Set(options.map((o) => o.id).filter(Boolean));
    // خيار حُذف من القائمة يُوقف (المبيعات السابقة تشير إليه)
    for (const option of existing.filter((o) => !keep.has(o.id))) {
      await manager.update(
        ModifierOption,
        { id: option.id },
        { isActive: false },
      );
    }
    for (const [index, option] of options.entries()) {
      const values = {
        tenantId,
        groupId,
        name: option.name.trim(),
        priceDelta: option.priceDelta ?? 0,
        productId: option.productId ?? null,
        quantity: option.quantity ?? 1,
        removesProductId: option.removesProductId ?? null,
        isDefault: option.isDefault ?? false,
        isActive: option.isActive ?? true,
        sortOrder: index,
      };
      if (option.id && existing.some((o) => o.id === option.id)) {
        await manager.update(ModifierOption, { id: option.id }, values);
      } else {
        await manager.save(manager.create(ModifierOption, values));
      }
    }
  }

  private async assertOptionProducts(
    options: CreateModifierGroupDto['options'],
    tenantId: string,
  ): Promise<void> {
    const ids = [
      ...new Set(
        options.flatMap((o) =>
          [o.productId, o.removesProductId].filter((id): id is string => !!id),
        ),
      ),
    ];
    if (!ids.length) return;
    const found = await this.dataSource.manager.find(Product, {
      where: { tenantId, id: In(ids) },
      select: ['id', 'type', 'name'],
    });
    if (found.length !== ids.length) {
      throw new NotFoundException('صنف في الخيارات غير موجود');
    }
    const service = found.find((p) => p.type === ProductType.SERVICE);
    if (service) {
      throw new BadRequestException(
        `"${service.name}" خدمة — أثر الخيار لصنف مخزني أو مركّب`,
      );
    }
  }

  private async assertNameFree(
    manager: EntityManager,
    tenantId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const taken = await manager.findOne(ModifierGroup, {
      where: { tenantId, name: name.trim() },
    });
    if (taken && taken.id !== exceptId) {
      throw new ConflictException('اسم المجموعة مستخدم');
    }
  }
}

function assertSelection(min: number, max: number): void {
  if (max !== 0 && min > max) {
    throw new BadRequestException('أقل اختيار لا يتجاوز أقصاه');
  }
}
