import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsUUID,
  // ✅ استيراد التحقق من UUID,
} from 'class-validator';

export class EducationDto {
  // ✅ إضافة حقل id اختياري للتعريف عند التحديث
  @IsUUID()
  @IsOptional()
  id?: string;

  @IsString()
  @IsNotEmpty({ message: 'درجة الشهادة مطلوبة' })
  degree!: string;

  @IsString()
  @IsOptional()
  certificateNumber?: string;

  // ✅ إضافة حقل مصدر/جهة إصدار الشهادة
  @IsString()
  @IsOptional()
  issuingAuthority?: string;

  @IsDateString()
  @IsOptional()
  expiryDate?: string;

  /** معرّف ملف الشهادة (من POST /files/employee)؛ null لإزالته */
  @IsOptional()
  @IsUUID('4', { message: 'ملف الشهادة غير صالح' })
  attachmentFileId?: string | null;
}
