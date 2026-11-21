// src/modules/inventory/dto/lots.dto.ts
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { DATE_ONLY } from './inventory.dto';

const DATE_MESSAGE = 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD';

export class LotQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  /** برقم الدفعة أو اسم الصنف أو كوده */
  @IsOptional()
  @IsString()
  search?: string;

  /**
   * in_stock (الافتراضي) = ذات رصيد، expiring = تنتهي خلال days، expired =
   * منتهية (ذات رصيد)، all = كل الدفعات ولو فرغت (للتتبع)
   */
  @IsOptional()
  @IsIn(['in_stock', 'expiring', 'expired', 'all'])
  status?: 'in_stock' | 'expiring' | 'expired' | 'all';

  /** نافذة "قارب على الانتهاء" بالأيام (الافتراضي 30) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

export class AvailableLotsQueryDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  warehouseId!: string;
}

export class AssignLotDto {
  @IsUUID()
  warehouseId!: string;

  @IsUUID()
  productId!: string;

  /** الكمية (بوحدة الأساس) من الرصيد غير المعيّن */
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  quantity!: number;

  @IsString()
  @IsNotEmpty({ message: 'رقم الدفعة مطلوب' })
  @MaxLength(60)
  lotNumber!: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  expiryDate?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  manufactureDate?: string;
}

export class UpdateLotDto {
  /** null يمسح التاريخ */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  expiryDate?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  manufactureDate?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
