// src/modules/loans/dto/create-loan.dto.ts
import {
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsOptional,
  IsString,
  IsDateString,
} from 'class-validator';

export class CreateLoanDto {
  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  totalAmount!: number;

  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  installmentsCount!: number;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsDateString()
  @IsNotEmpty()
  startDate!: string; // تاريخ بداية الخصم
}
