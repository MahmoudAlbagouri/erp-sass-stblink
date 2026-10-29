import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsString,
  IsNotEmpty,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateShiftDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() startTime!: string;
  @IsString() @IsNotEmpty() endTime!: string;
  @IsInt() @Min(0) gracePeriod!: number;

  /**
   * أيام راحة هذه الوردية (0 = الأحد … 6 = السبت). null = أيام راحة الشركة؛
   * [] = تعمل كل الأسبوع.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsArray()
  @ArrayMaxSize(6, { message: 'لا بد من يوم عمل واحد على الأقل في الأسبوع' })
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  offDays?: number[] | null;
}
