// src/modules/eos/dto/create-eos.dto.ts
import {
  IsUUID,
  IsDateString,
  IsOptional,
  IsString,
  IsIn,
} from 'class-validator';
import { EOSReason } from '../entities/eos.entity';

// استخراج القيم العربية المسموحة من الـ Enum
const ALLOWED_REASONS = Object.values(EOSReason);

export class CreateEOSDto {
  @IsUUID()
  employeeId!: string;

  @IsDateString()
  terminationDate!: string;

  // ✅ التغيير الجوهري: استخدام IsIn بدلاً من IsEnum للتحقق من القيم العربية
  @IsIn(ALLOWED_REASONS, {
    message: `السبب يجب أن يكون أحد القيم التالية: ${ALLOWED_REASONS.join(', ')}`,
  })
  reason!: EOSReason;

  @IsDateString()
  payoutDate!: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
