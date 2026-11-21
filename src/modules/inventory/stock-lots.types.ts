// src/modules/inventory/stock-lots.types.ts — أنواع توزيع الحركات على الدفعات
import type { EntityManager } from 'typeorm';
import type { StockLotSource } from './entities/stock-lot.entity';

/** ما يكفي من EntityManager لاستعلامات الدفعات (يسهّل الاختبار) */
export type EntryManagerLike = Pick<EntityManager, 'query'>;

/** دفعة كمية داخلة: تُنشأ برقمها إن لم توجد للصنف */
export interface LotInput {
  lotNumber: string;
  /** YYYY-MM-DD. غائب = يُقترح من مدة صلاحية الصنف */
  expiryDate?: string | null;
  manufactureDate?: string | null;
  source?: StockLotSource;
  sourceType?: string;
  sourceId?: string;
  supplierId?: string | null;
  note?: string | null;
}

/** كمية (بالموجب، بوحدة الأساس) من دفعة قائمة */
export interface LotPick {
  lotId: string;
  quantity: number;
}

/** دفعات مستند سابق تتبعها الحركة (مرتجع، استلام تحويل) */
export interface LotsFrom {
  referenceType: string;
  referenceId: string;
}

/** نصيب دفعة من حركة: موجبة دخول وسالبة خروج، lotId = null غير معيّن */
export interface LotAllocation {
  lotId: string | null;
  quantity: number;
}
