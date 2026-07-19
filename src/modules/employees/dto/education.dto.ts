import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
} from 'class-validator';

export class EducationDto {
  @IsString()
  @IsNotEmpty({ message: 'درجة الشهادة مطلوبة' })
  degree!: string;

  @IsString()
  @IsOptional()
  certificateNumber?: string;

  @IsDateString()
  @IsOptional()
  expiryDate?: string;

  @IsString()
  @IsOptional()
  attachmentPath?: string;
}
