// src/modules/inventory/stock-import.service.ts
import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  ImportProductsResult,
  ProductsImportService,
} from '../catalog/products-import.service';
import { ImportProductsWithStockDto } from './dto/import-stock.dto';
import { StockMovementType } from './entities/stock-movement.entity';
import { StockService } from './stock.service';
import { WarehousesService } from './warehouses.service';

/** أقصى عدد أسطر في تسوية واحدة (حد CreateAdjustmentDto) */
const OPENING_CHUNK = 500;

export interface ImportStockResult extends ImportProductsResult {
  warehouse: { id: string; name: string };
  /** عدد الأصناف التي سُجّل لها رصيد افتتاحي */
  stocked: number;
}

/**
 * استيراد أصناف مع رصيدها الافتتاحي في طلب واحد: الأصناف تُنشأ عبر موديول
 * الأصناف، ثم يُسجَّل رصيد **الجديد منها فقط** — فإعادة إرسال القائمة لا
 * تضاعف رصيد صنف موجود.
 */
@Injectable()
export class StockImportService {
  constructor(
    private readonly productsImport: ProductsImportService,
    private readonly warehouses: WarehousesService,
    private readonly stock: StockService,
  ) {}

  async import(
    dto: ImportProductsWithStockDto,
    tenantId: string,
    userId?: string,
  ): Promise<ImportStockResult> {
    // المخزن أولاً: خطأ فيه يُكتشف قبل إنشاء أي صنف
    const warehouse = dto.warehouseId
      ? (await this.warehouses.findActiveByIds([dto.warehouseId], tenantId))[0]
      : await this.warehouses.getMain(tenantId);

    const imported = await this.productsImport.import(dto, tenantId);

    const inputs = new Map(dto.items.map((item) => [item.name.trim(), item]));
    const lines = imported.created.flatMap((product) => {
      const input = inputs.get(product.name);
      const quantity = input?.quantity ?? dto.quantity ?? 0;
      if (!input || quantity <= 0) return [];

      const unitCost =
        input.unitCost ??
        (dto.costRatio === undefined
          ? undefined
          : new Decimal(input.salePrice)
              .mul(dto.costRatio)
              .toDecimalPlaces(4)
              .toNumber());
      return [{ productId: product.id, quantity, unitCost }];
    });

    for (let start = 0; start < lines.length; start += OPENING_CHUNK) {
      await this.stock.adjust(
        {
          warehouseId: warehouse.id,
          type: StockMovementType.OPENING,
          note: 'رصيد افتتاحي — استيراد',
          lines: lines.slice(start, start + OPENING_CHUNK),
        },
        tenantId,
        userId,
      );
    }

    return {
      ...imported,
      warehouse: { id: warehouse.id, name: warehouse.name },
      stocked: lines.length,
    };
  }
}
