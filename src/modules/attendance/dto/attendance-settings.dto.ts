// src/modules/attendance/dto/attendance-settings.dto.ts
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class UpdateAttendanceSettingsDto {
  /** أيام الراحة الأسبوعية (0 = الأحد … 6 = السبت)، مثال [5, 6] */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6, { message: 'لا بد من يوم عمل واحد على الأقل في الأسبوع' })
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weeklyOffDays?: number[];

  /** خصم أيام الغياب في المسير */
  @IsOptional()
  @IsBoolean()
  deductAbsence?: boolean;

  /** خصم التأخير والانصراف المبكر في المسير */
  @IsOptional()
  @IsBoolean()
  deductLateness?: boolean;

  /** صرف أجر الساعات الإضافية في المسير */
  @IsOptional()
  @IsBoolean()
  payOvertime?: boolean;

  /** أجر الساعة الإضافية نسبةً من أجر الساعة (150 = مرة ونصف) */
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(300)
  overtimeRatePercent?: number;

  /** أقل إضافي يُحتسب في اليوم (دقائق) */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  overtimeMinMinutes?: number;

  /** نسخ بصمات الموظفين بين أجهزة ZKTeco (تُحفظ مشفّرة) */
  @IsOptional()
  @IsBoolean()
  syncBiometrics?: boolean;
}
