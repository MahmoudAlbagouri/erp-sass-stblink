// src/common/decorators/permissions.decorator.ts
import { SetMetadata } from '@nestjs/common';

export interface PermissionMetadata {
  name: string;
  labelAr: string;
}

export const PERMISSIONS_KEY = 'permissions';
export const Permissions = (...permissions: (string | PermissionMetadata)[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
