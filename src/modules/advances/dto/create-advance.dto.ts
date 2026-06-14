// src/modules/advances/dto/create-advance.dto.ts
import {
  IsNotEmpty,
  IsNumber,
  IsString,
  IsOptional,
  Min,
} from 'class-validator';

export class CreateAdvanceDto {
  @IsNumber()
  @Min(1)
  @IsNotEmpty()
  amount!: number;

  @IsNumber()
  @Min(1)
  @IsNotEmpty()
  numberOfInstallments!: number;

  @IsString()
  @IsOptional()
  reason?: string;
}
