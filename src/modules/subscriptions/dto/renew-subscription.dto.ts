import { IsInt, Min, IsOptional } from 'class-validator';

export class RenewSubscriptionDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  extraDays?: number;
}
