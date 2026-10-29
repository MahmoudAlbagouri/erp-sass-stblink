// src/modules/attendance/dto/holiday.dto.ts
import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateHolidayDto {
  /** مثال: عيد الفطر */
  @IsString()
  @IsNotEmpty({ message: 'اسم العطلة مطلوب' })
  @MaxLength(100)
  name!: string;

  /** أول يوم (YYYY-MM-DD) */
  @Matches(DAY, { message: 'تاريخ البداية بصيغة YYYY-MM-DD' })
  startDate!: string;

  /** آخر يوم شاملاً (YYYY-MM-DD)؛ يُترك لعطلة يوم واحد */
  @IsOptional()
  @Matches(DAY, { message: 'تاريخ النهاية بصيغة YYYY-MM-DD' })
  endDate?: string;
}

export class UpdateHolidayDto extends PartialType(CreateHolidayDto) {}

export class HolidayQueryDto {
  /** عطلات سنة واحدة */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}
