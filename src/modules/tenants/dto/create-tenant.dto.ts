// src/modules/tenants/dto/create-tenant.dto.ts
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم الشركة مطلوب' })
  companyName!: string; // camelCase كما يرسلها الفرونت إند

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}
