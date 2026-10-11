// src/modules/leaves/dto/set-leave-balance.dto.ts
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsUUID, Max, Min } from 'class-validator';

export class SetLeaveBalanceDto {
  @IsUUID()
  employeeId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount!: number;
}
