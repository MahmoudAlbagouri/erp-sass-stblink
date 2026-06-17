import { IsString, IsNotEmpty, IsInt, Min } from 'class-validator';

export class CreateShiftDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() startTime!: string;
  @IsString() @IsNotEmpty() endTime!: string;
  @IsInt() @Min(0) gracePeriod!: number;
}
