// src/modules/branches/dto/branch.dto.ts
import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateBranchDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم الفرع مطلوب' })
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBranchDto extends PartialType(CreateBranchDto) {}
