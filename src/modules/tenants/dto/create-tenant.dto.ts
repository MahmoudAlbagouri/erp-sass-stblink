// src/modules/tenants/dto/create-tenant.dto.ts
import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';
import { COUNTRY_CODES } from '../../../common/constants/countries';

export class CreateTenantDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم الشركة مطلوب' })
  companyName!: string; // camelCase كما يرسلها الفرونت إند

  /** محلي أو دولي: يُوحَّد إلى E.164 حسب الدولة */
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  /** رمز الدولة ISO: منه تُشتق العملة والمنطقة الزمنية */
  @IsOptional()
  @IsIn(COUNTRY_CODES, { message: 'الدولة غير مدعومة' })
  country?: string;

  @IsOptional()
  @IsString()
  language?: string;
}
