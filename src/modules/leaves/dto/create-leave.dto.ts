// src/modules/leaves/dto/create-leave.dto.ts
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { LeaveType } from '../entities/leave-request.entity';

export class CreateLeaveDto {
  @IsDateString(
    {},
    { message: 'تاريخ البداية غير صالح (الصيغة المطلوبة: YYYY-MM-DD)' },
  )
  startDate!: string;

  @IsDateString(
    {},
    { message: 'تاريخ النهاية غير صالح (الصيغة المطلوبة: YYYY-MM-DD)' },
  )
  endDate!: string;

  @IsEnum(LeaveType, { message: 'نوع الإجازة غير صالح' })
  type!: LeaveType;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'السبب طويل جداً (الحد الأقصى 1000 حرف)' })
  reason?: string;
}
