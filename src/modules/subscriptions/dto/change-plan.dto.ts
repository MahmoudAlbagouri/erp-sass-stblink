import { IsUUID, IsOptional, IsInt, Min, IsBoolean } from 'class-validator';

export class ChangePlanDto {
  @IsUUID()
  planId!: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  durationDays?: number;

  @IsBoolean()
  @IsOptional()
  autoRenew?: boolean;
}
