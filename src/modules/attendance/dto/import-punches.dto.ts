// src/modules/attendance/dto/import-punches.dto.ts
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export const DATE_ORDERS = ['DMY', 'MDY', 'YMD'] as const;
export type DateOrder = (typeof DATE_ORDERS)[number];

/**
 * أعمدة ملف البصمات كما اختارها المستخدم بعد المعاينة (أرقام الأعمدة تبدأ من
 * 0). الوقت: عمود واحد للتاريخ والوقت، أو عمودان منفصلان.
 */
export class ImportPunchesDto {
  /** عمود رقم الموظف على الجهاز */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  pinColumn!: number;

  /** عمود التاريخ والوقت معاً */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  dateTimeColumn?: number;

  /** عمود التاريخ (مع timeColumn) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  dateColumn?: number;

  /** عمود الوقت (مع dateColumn) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  timeColumn?: number;

  /** عمود نوع البصمة (حضور/انصراف) إن وُجد */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  typeColumn?: number;

  /** صف العناوين (من 0)؛ ‎-1 = الملف بلا عناوين */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1)
  @Max(50)
  headerRow?: number;

  /** ترتيب أجزاء التاريخ في الملف (للتواريخ النصية مثل 05/01/2026) */
  @IsOptional()
  @IsIn(DATE_ORDERS)
  dateOrder?: DateOrder;

  /** الجهاز الذي صدرت منه البصمات (توقيته، ومنع تكرارها مع ما أرسله) */
  @IsOptional()
  @IsUUID()
  deviceId?: string;
}
