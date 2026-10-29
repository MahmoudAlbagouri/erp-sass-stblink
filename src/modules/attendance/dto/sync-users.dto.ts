// src/modules/attendance/dto/sync-users.dto.ts
import { IsBoolean, IsOptional } from 'class-validator';

export class SyncUsersDto {
  /** موظفو فرع الجهاز فقط (افتراضياً كل الموظفين النشطين) */
  @IsOptional()
  @IsBoolean()
  branchOnly?: boolean;
}
