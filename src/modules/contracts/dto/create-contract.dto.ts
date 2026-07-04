// src/modules/contracts/dto/create-contract.dto.ts
import {
  IsNotEmpty,
  IsString,
  IsDateString,
  IsOptional,
  IsNumber,
  IsUUID,
  IsEnum,
  IsArray,
  Min,
} from 'class-validator';
import { ContractType } from '../entities/contract.entity';

export class CreateContractDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId!: string;

  @IsEnum(ContractType)
  @IsNotEmpty()
  contractType!: ContractType;

  @IsDateString()
  @IsNotEmpty()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsNumber()
  @IsNotEmpty()
  annualLeaveDays!: number;

  // ✅ إضافة حقل مدة العقد
  @IsNumber()
  @IsOptional()
  @Min(1)
  contractDurationYears?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  // استقبال مصفوفة الروابط من الـ Frontend
  @IsOptional()
  @IsArray()
  attachmentPaths?: string[];
}
