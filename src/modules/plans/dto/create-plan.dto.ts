import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumberString,
  IsEnum,
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
} from 'class-validator';
import { BillingCycle } from '../../../common/enums/subscription.enums';
import type { PlanQuotas } from '../entities/plan.entity';

export class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  nameAr!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumberString()
  price!: string;

  @IsEnum(BillingCycle)
  billingCycle!: BillingCycle;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  features?: string[];

  @IsObject()
  @IsOptional()
  quotas?: PlanQuotas;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsBoolean()
  @IsOptional()
  isCustom?: boolean;

  @IsInt()
  @IsOptional()
  sortOrder?: number;
}
