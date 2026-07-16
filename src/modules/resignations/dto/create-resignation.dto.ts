import { IsDateString, IsString, MinLength } from 'class-validator';

export class CreateResignationDto {
  @IsDateString()
  lastWorkingDay!: string;

  @IsString()
  @MinLength(10, {
    message: 'سبب الاستقالة يجب أن يكون مفصلاً (10 أحرف على الأقل)',
  })
  reason!: string;
}
