// src/modules/attendance/dto/attendance-query.dto.ts
import { IsOptional, IsDateString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class AttendanceQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string; // '2026-06-01'

  @IsOptional()
  @IsDateString()
  to?: string; // '2026-06-30'

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
