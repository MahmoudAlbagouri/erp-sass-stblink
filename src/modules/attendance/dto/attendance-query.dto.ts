// src/modules/attendance/dto/attendance-query.dto.ts
import {
  IsOptional,
  IsDateString,
  IsInt,
  Min,
  Max,
  IsEnum,
  IsString,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PunchType } from '../entities/attendance-log.entity';

export class AttendanceQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string; // '2026-06-01'

  @IsOptional()
  @IsDateString()
  to?: string; // '2026-06-30'

  // ✅ فلترة حسب نوع البصمة: حضور / انصراف / إجازة ... إلخ
  @IsOptional()
  @IsEnum(PunchType)
  punchType?: PunchType;

  // ✅ فلترة حسب موظف محدد (اختيار من قائمة، أدق من البحث النصي)
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  // ✅ بحث نصي باسم الموظف
  @IsOptional()
  @IsString()
  employeeName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}
