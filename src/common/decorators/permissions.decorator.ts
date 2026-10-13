// src/common/decorators/permissions.decorator.ts
import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';

export interface PermissionMetadata {
  name: string;
  labelAr: string;
}

export const PERMISSIONS_KEY = 'permissions';
/** امتداد OpenAPI يحمل الصلاحيات المطلوبة: منه يكتب Swagger وصف كل مسار */
export const PERMISSIONS_EXTENSION = 'x-permissions';

export const Permissions = (...permissions: (string | PermissionMetadata)[]) =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    ApiExtension(
      PERMISSIONS_EXTENSION,
      permissions.map((p) =>
        typeof p === 'string' ? { name: p, labelAr: p } : p,
      ),
    ),
  );
