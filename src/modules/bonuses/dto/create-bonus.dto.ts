import {
  IsUUID,
  IsNumber,
  IsDateString,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateBonusDto {
  @IsUUID()
  employeeId!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsDateString()
  payoutDate!: string; // YYYY-MM-DD

  @IsString()
  @IsOptional()
  notes?: string;
}
