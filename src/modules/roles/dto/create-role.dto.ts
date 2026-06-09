// src/modules/roles/dto/create-role.dto.ts
import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { PermissionScope } from '../../permissions/entities/permission.entity';

export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(PermissionScope)
  @IsOptional()
  scope?: PermissionScope = PermissionScope.TENANT;

  @IsArray()
  permissionIds!: string[];
}
