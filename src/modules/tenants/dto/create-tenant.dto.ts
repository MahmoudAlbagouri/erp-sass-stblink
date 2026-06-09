// src/modules/tenants/dto/create-tenant.dto.ts
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsDateString,
} from 'class-validator';
import {
  TenantStatus,
  SubscriptionPlan,
} from '../../../common/enums/tenant.enums';

export class CreateTenantDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم الشركة مطلوب' })
  companyName!: string;

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
  @IsEnum(SubscriptionPlan)
  subscriptionPlan?: SubscriptionPlan;

  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;

  @IsOptional()
  @IsDateString()
  trialEndsAt?: Date;

  @IsOptional()
  @IsNumber()
  maxUsers?: number;

  @IsOptional()
  @IsNumber()
  storageLimitMb?: number;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;
}
