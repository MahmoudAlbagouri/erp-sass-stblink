// src/modules/loans/dto/create-loan.dto.ts
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsDateString,
  Min,
} from 'class-validator';

export class CreateLoanDto {
  @IsNumber()
  @Min(500, { message: 'قيمة القرض يجب أن تكون 500 على الأقل' }) // ✅ الشرط الجديد
  @IsNotEmpty()
  totalAmount!: number;

  @IsNumber()
  @Min(2, { message: 'عدد الأقساط يجب أن يكون 2 على الأقل' }) // ✅ الشرط الجديد
  @IsNotEmpty()
  installmentsCount!: number;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsDateString()
  @IsNotEmpty()
  startDate!: string;
}
