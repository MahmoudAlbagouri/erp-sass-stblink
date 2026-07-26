import {
  IsUUID,
  IsNumber,
  IsDateString,
  IsOptional,
  IsString,
  Min,
  IsInt,
  IsEnum,
} from 'class-validator';
import { DeductionStatus } from '../entities/deduction.entity';

export class CreateDeductionDto {
  @IsUUID()
  employeeId!: string;

  @IsString()
  name!: string;

  @IsNumber()
  @Min(0.01)
  totalAmount!: number;

  @IsDateString()
  startDate!: string;

  @IsInt()
  @Min(1)
  installmentsCount!: number;

  @IsString()
  @IsOptional()
  notes?: string;

  // ✅ السماح بتحديد الحالة عند الإنشاء (اختياري)
  @IsEnum(DeductionStatus)
  @IsOptional()
  status?: DeductionStatus;
}
