// src/modules/attendance/dto/my-attendance.dto.ts
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class MobilePunchDto {
  @IsNumber({}, { message: 'الموقع غير صالح' })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber({}, { message: 'الموقع غير صالح' })
  @Min(-180)
  @Max(180)
  longitude!: number;

  /** دقة قراءة الموقع بالمتر */
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;

  /** قراءة من تطبيق تزوير موقع (أندرويد) */
  @IsOptional()
  @IsBoolean()
  isMocked?: boolean;

  /** معرّف تثبيت التطبيق: به يُربط الجوال بالموظف */
  @IsString()
  @IsNotEmpty({ message: 'معرّف الجوال مطلوب' })
  @MaxLength(64)
  deviceId!: string;

  /** اسم الجوال كما يظهر للمدير عند فك الربط */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;
}

export class MyMonthQueryDto {
  @Type(() => Number)
  @IsInt({ message: 'الشهر غير صالح' })
  @Min(1)
  @Max(12)
  month!: number;

  @Type(() => Number)
  @IsInt({ message: 'السنة غير صالحة' })
  @Min(2000)
  @Max(2100)
  year!: number;
}
