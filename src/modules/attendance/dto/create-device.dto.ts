// src/modules/attendance/dto/create-device.dto.ts
import {
  IsEnum,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsTimeZone,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { DeviceProtocol } from '../entities/biometric-device.entity';

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
   * طريقة اتصال الجهاز: zk_adms (ZKTeco، الافتراضي)، hikvision، أو api لأي
   * جهاز/برنامج يرسل البصمات بمفتاح. hikvision و api يُعطيان مفتاحاً مرة واحدة.
   */
  @IsOptional()
  @IsEnum(DeviceProtocol)
  protocol?: DeviceProtocol;

  /**
   * عناوين IP المسموح للجهاز الاتصال منها، مفصولة بفواصل (تقبل نطاقاً مثل
   * 41.33.10.0/24). فارغة = أي عنوان.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  allowedIps?: string | null;

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
