// src/quotations/dto/create-quotation.dto.ts
import {
  IsString,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

class QuotationItemDto {
  @IsString()
  description: string;

  @IsNumber()
  @Min(1)
  qty: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;
}

// ✅ DTO جديد للحسابات البنكية
export class BankAccountDto {
  @IsString()
  bankName: string; // اسم البنك

  @IsString()
  iban: string; // رقم الآيبان
}

export class CreateQuotationDto {
  @IsString()
  customerName: string;

  @IsString()
  @IsOptional()
  customerPhone?: string;

  @IsString()
  @IsOptional()
  customerAddress?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationItemDto)
  items: QuotationItemDto[];

  @IsString()
  @IsOptional()
  notes?: string;

  // ✅ الحسابات البنكية (اختياري - يمكن وضع قيم افتراضية في الـ Service إذا لم ترسل)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BankAccountDto)
  @IsOptional()
  bankAccounts?: BankAccountDto[];

  // ✅ الشروط والأحكام (مصفوفة نصوص)
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  termsAndConditions?: string[];
}
