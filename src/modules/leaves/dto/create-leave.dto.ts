// src/modules/leaves/dto/create-leave.dto.ts
import {
  IsNotEmpty,
  IsDateString,
  IsString,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { LeaveType } from '../entities/leave-request.entity';

export class CreateLeaveDto {
  @IsDateString()
  @IsNotEmpty()
  startDate!: string;

  @IsDateString()
  @IsNotEmpty()
  endDate!: string;

  @IsEnum(LeaveType)
  @IsNotEmpty()
  type!: LeaveType; // إلزامي لتحديد نوع الإجازة

  @IsString()
  @IsOptional()
  reason?: string;
}
