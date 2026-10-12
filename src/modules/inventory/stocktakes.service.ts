// src/modules/inventory/stocktakes.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  paginated,
  Paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import { nextDocumentNumber } from '../../common/utils/document-number.util';
import {
  CreateStocktakeDto,
  StocktakeLineDto,
  StocktakeQueryDto,
  UpdateStocktakeDto,
} from './dto/inventory.dto';
import { StockMovementType } from './entities/stock-movement.entity';
import {
  Stocktake,
  StocktakeLine,
  StocktakeStatus,
} from './entities/stocktake.entity';
import { assertNoDuplicateProducts, StockService } from './stock.service';
import { WarehousesService } from './warehouses.service';

const REFERENCE_TYPE = 'stocktake';
const NUMBER_PREFIX = 'ST-';

/**
 * الجرد: تُسجَّل الكميات المعدودة في مسودة (لا تغيّر شيئاً)، وعند الاعتماد
 * يُسوّى رصيد كل صنف على ما عُدّ فعلاً بحركة "جرد" تحمل الفرق.
 */
@Injectable()
export class StocktakesService {
  constructor(
    @InjectRepository(Stocktake)
    private readonly stocktakes: Repository<Stocktake>,
    private readonly stock: StockService,
    private readonly warehouses: WarehousesService,
    private readonly dataSource: DataSource,
  ) {}

  // ══════════════════════════ القراءة ══════════════════════════

  async findAll(
    tenantId: string,
    query: StocktakeQueryDto,
  ): Promise<Paginated<Stocktake>> {
    const { page, limit, skip } = resolvePagination(query);

    const qb = this.stocktakes
      .createQueryBuilder('stocktake')
      .leftJoinAndSelect('stocktake.warehouse', 'warehouse')
      .loadRelationCountAndMap('stocktake.linesCount', 'stocktake.lines')
      .where('stocktake.tenantId = :tenantId', { tenantId });

    if (query.status) {
      qb.andWhere('stocktake.status = :status', { status: query.status });
    }
    if (query.warehouseId) {
      qb.andWhere('stocktake.warehouseId = :warehouseId', {
        warehouseId: query.warehouseId,
      });
    }

    const [data, total] = await qb
      .orderBy('stocktake.createdAt', 'DESC')
      .addOrderBy('stocktake.id', 'ASC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return paginated(data, total, page, limit);
  }

  async findOne(id: string, tenantId: string): Promise<Stocktake> {
    const stocktake = await this.stocktakes.findOne({
      where: { id, tenantId },
      relations: [
        'warehouse',
        'lines',
        'lines.product',
        'lines.product.baseUnit',
      ],
    });
    if (!stocktake) throw new NotFoundException('الجرد غير موجود');

    // المسودة تعرض رصيد النظام الحالي بجانب المعدود ليظهر الفرق قبل الاعتماد
    if (stocktake.status === StocktakeStatus.DRAFT && stocktake.lines) {
      const quantities = await this.stock.getQuantities(
        tenantId,
        stocktake.warehouseId,
        stocktake.lines.map((line) => line.productId),
      );
      for (const line of stocktake.lines) {
        line.currentQuantity = quantities.get(line.productId) ?? 0;
      }
    }
    return stocktake;
  }

  // ══════════════════════════ المسودة ══════════════════════════

  async create(
    dto: CreateStocktakeDto,
    tenantId: string,
    userId?: string,
  ): Promise<Stocktake> {
    await this.assertValid(dto.warehouseId, dto.lines, tenantId);

    const id = await this.dataSource.transaction(async (manager) => {
      const stocktake = await manager.save(
        manager.create(Stocktake, {
          tenantId,
          number: await nextDocumentNumber(
            manager,
            'stocktakes',
            NUMBER_PREFIX,
            tenantId,
          ),
          warehouseId: dto.warehouseId,
          note: dto.note ?? null,
          createdById: userId ?? null,
        }),
      );
      await this.replaceLines(manager, stocktake.id, tenantId, dto.lines);
      return stocktake.id;
    });

    return this.findOne(id, tenantId);
  }

  async update(
    id: string,
    dto: UpdateStocktakeDto,
    tenantId: string,
  ): Promise<Stocktake> {
    const current = await this.findOne(id, tenantId);
    assertDraft(current, 'تعديل');

    const warehouseId = dto.warehouseId ?? current.warehouseId;
    await this.assertValid(warehouseId, dto.lines ?? [], tenantId);

    await this.dataSource.transaction(async (manager) => {
      assertDraft(await this.lock(manager, id, tenantId), 'تعديل');

      await manager.update(
        Stocktake,
        { id, tenantId },
        {
          warehouseId,
          ...(dto.note !== undefined ? { note: dto.note } : {}),
        },
      );
      if (dto.lines) {
        await this.replaceLines(manager, id, tenantId, dto.lines);
      }
    });

    return this.findOne(id, tenantId);
  }

  // ══════════════════════════ الاعتماد والإلغاء ══════════════════════════

  /** اعتماد الجرد: تسوية رصيد كل صنف على الكمية المعدودة */
  async post(
    id: string,
    tenantId: string,
    userId?: string,
  ): Promise<Stocktake> {
    await this.dataSource.transaction(async (manager) => {
      const stocktake = await this.lock(manager, id, tenantId);
      assertDraft(stocktake, 'اعتماد');
      const lines = await manager.find(StocktakeLine, {
        where: { stocktakeId: id },
      });

      // targetQuantity: الفرق يُحسب داخل قفل الصنف، فبيع يتم أثناء الاعتماد
      // لا يفسد النتيجة
      const results = await this.stock.apply(
        manager,
        tenantId,
        lines.map((line) => ({
          warehouseId: stocktake.warehouseId,
          productId: line.productId,
          type: StockMovementType.STOCKTAKE,
          targetQuantity: line.countedQuantity,
          note: `جرد ${stocktake.number}`,
        })),
        { referenceType: REFERENCE_TYPE, referenceId: id, userId },
      );

      for (const [index, line] of lines.entries()) {
        await manager.update(
          StocktakeLine,
          { id: line.id },
          {
            expectedQuantity: results[index].previousQuantity,
            unitCost: results[index].unitCost,
          },
        );
      }

      await manager.update(
        Stocktake,
        { id, tenantId },
        {
          status: StocktakeStatus.POSTED,
          postedAt: new Date(),
          postedById: userId ?? null,
        },
      );
    });

    return this.findOne(id, tenantId);
  }

  async cancel(id: string, tenantId: string): Promise<Stocktake> {
    await this.dataSource.transaction(async (manager) => {
      assertDraft(await this.lock(manager, id, tenantId), 'إلغاء');
      await manager.update(
        Stocktake,
        { id, tenantId },
        { status: StocktakeStatus.CANCELLED },
      );
    });

    return this.findOne(id, tenantId);
  }

  // ══════════════════════════ داخلي ══════════════════════════

  private async assertValid(
    warehouseId: string,
    lines: StocktakeLineDto[],
    tenantId: string,
  ): Promise<void> {
    await this.warehouses.findActiveByIds([warehouseId], tenantId);

    const productIds = lines.map((l) => l.productId);
    assertNoDuplicateProducts(productIds);
    await this.stock.loadStockedProducts(productIds, tenantId);
  }

  private async lock(
    manager: EntityManager,
    id: string,
    tenantId: string,
  ): Promise<Stocktake> {
    const stocktake = await manager.findOne(Stocktake, {
      where: { id, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!stocktake) throw new NotFoundException('الجرد غير موجود');
    return stocktake;
  }

  private async replaceLines(
    manager: EntityManager,
    stocktakeId: string,
    tenantId: string,
    lines: StocktakeLineDto[],
  ): Promise<void> {
    await manager.delete(StocktakeLine, { stocktakeId, tenantId });
    await manager.save(
      lines.map((line) =>
        manager.create(StocktakeLine, {
          stocktakeId,
          tenantId,
          productId: line.productId,
          countedQuantity: line.countedQuantity,
        }),
      ),
    );
  }
}

const STATUS_LABEL: Record<StocktakeStatus, string> = {
  [StocktakeStatus.DRAFT]: 'مسودة',
  [StocktakeStatus.POSTED]: 'معتمد',
  [StocktakeStatus.CANCELLED]: 'ملغي',
};

function assertDraft(stocktake: Stocktake, action: string): void {
  if (stocktake.status !== StocktakeStatus.DRAFT) {
    throw new BadRequestException(
      `لا يمكن ${action} جرد حالته "${STATUS_LABEL[stocktake.status]}"`,
    );
  }
}
