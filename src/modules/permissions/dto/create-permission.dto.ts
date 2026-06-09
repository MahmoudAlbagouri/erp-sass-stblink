// src/modules/permissions/dto/create-permission.dto.ts
import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { PermissionScope } from '../entities/permission.entity';

export class CreatePermissionDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(PermissionScope)
  @IsOptional()
  scope?: PermissionScope = PermissionScope.TENANT;
}
