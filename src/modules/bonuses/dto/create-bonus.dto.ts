import {
  IsUUID,
  IsNumber,
  IsDateString,
  IsOptional,
  IsString,
  Min,
  IsEnum,
} from 'class-validator';
import { BonusStatus } from '../entities/bonus.entity';

export class CreateBonusDto {
  @IsUUID()
  employeeId!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsDateString()
  payoutDate!: string; // YYYY-MM-DD

  @IsString()
  @IsOptional()
  notes?: string;

  // ✅ السماح بتحديد الحالة عند الإنشاء (اختياري، الافتراضي pending)
  @IsEnum(BonusStatus)
  @IsOptional()
  status?: BonusStatus;
}
