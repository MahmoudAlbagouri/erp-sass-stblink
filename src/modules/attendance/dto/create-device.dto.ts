// src/modules/attendance/dto/create-device.dto.ts
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsTimeZone,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateDeviceDto {
  @IsString()
  @IsNotEmpty({ message: 'الرقم التسلسلي للجهاز مطلوب' })
  @MaxLength(64)
  serialNumber!: string; // SN مثل JHG3255001087

  @IsOptional()
  @IsString()
  alias?: string; // "بوابة المدخل الرئيسي"

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  model?: string; // MB10

  /**
   * منطقة ساعة الجهاز (IANA مثل Asia/Dubai). تُترك فارغة ليتبع منطقة الشركة؛
   * تُحدَّد فقط لجهاز في فرع بدولة أخرى.
   */
  @IsOptional()
  @IsTimeZone({ message: 'المنطقة الزمنية غير صالحة' })
  timezone?: string;

  /** الفرع المركَّب فيه الجهاز — يُترك فارغاً للفرع الرئيسي */
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
