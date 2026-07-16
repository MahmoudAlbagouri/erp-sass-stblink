import {
  IsUUID,
  IsNumber,
  IsDateString,
  IsOptional,
  IsString,
  Min,
  IsInt,
} from 'class-validator';

export class CreateDeductionDto {
  @IsUUID()
  employeeId!: string;

  @IsString()
  name!: string;

  @IsNumber()
  @Min(0.01)
  totalAmount!: number;

  @IsDateString()
  startDate!: string;

  @IsInt()
  @Min(1)
  installmentsCount!: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
