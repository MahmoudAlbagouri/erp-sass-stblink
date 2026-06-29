// src/modules/settlements/dto/confirm-settlement.dto.ts

import {
  IsUUID,
  IsDateString,
  IsOptional,
  IsString,
  IsInt,
  IsNumber,
  Min,
} from 'class-validator';

export class ConfirmSettlementDto {
  @IsUUID()
  employeeId!: string;

  /** يُرسل من الـ Frontend بعد عرض الحساب على المستخدم والموافقة عليه */
  @IsInt()
  @Min(0)
  unusedLeaveDays!: number;

  @IsNumber()
  @Min(0)
  dailyRate!: number;

  @IsNumber()
  @Min(0)
  totalAmount!: number;

  @IsDateString()
  settlementDate!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
