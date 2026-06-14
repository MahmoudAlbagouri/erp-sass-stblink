// src/modules/salaries/dto/create-salary.dto.ts
import { IsNotEmpty, IsNumber, IsUUID, IsOptional, Min } from 'class-validator';

export class CreateSalaryDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId!: string;

  @IsNumber() @Min(0) @IsNotEmpty() basicSalary!: number;
  @IsNumber() @Min(0) @IsOptional() housingAllowance: number = 0;
  @IsNumber() @Min(0) @IsOptional() transportAllowance: number = 0;
  @IsNumber() @Min(0) @IsOptional() otherAllowances: number = 0;
}
