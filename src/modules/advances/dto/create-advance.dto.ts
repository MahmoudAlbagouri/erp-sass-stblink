// src/modules/advances/dto/create-advance.dto.ts
import {
  IsNotEmpty,
  IsNumber,
  IsString,
  IsOptional,
  Min,
  IsDateString,
} from 'class-validator';

export class CreateAdvanceDto {
  @IsNumber()
  @Min(1)
  @IsNotEmpty()
  amount!: number;

  @IsString()
  @IsOptional()
  reason?: string;

  // تاريخ السداد (مثلاً: 2026-07-30 لخصمها من راتب يوليو)
  @IsDateString()
  @IsNotEmpty()
  repaymentDate!: string;
}
