// src/modules/permissions/permission-discovery.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import {
  PERMISSIONS_KEY,
  PermissionMetadata,
} from '../../common/decorators/permissions.decorator';
import { PermissionCoreService } from './permission-core.service';
import { PermissionScope } from './entities/permission.entity';
import { SYSTEM_PERMISSION_PREFIX } from './utils/permission-scope.util';

@Injectable()
export class PermissionDiscoveryService implements OnModuleInit {
  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly reflector: Reflector,
    private readonly permissionCoreService: PermissionCoreService,
  ) {}

  async onModuleInit(): Promise<void> {
    const controllers = this.discoveryService.getControllers();

    for (const controller of controllers) {
      if (!controller.instance) continue;

      const prototype = Object.getPrototypeOf(controller.instance) as Record<
        string,
        unknown
      >;

      // ✅ الحل 2: تحديد نوع methodName كـ string
      for (const methodName of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[methodName];

        // ✅ التحقق من أن handler هو دالة قبل استخدامه
        if (typeof handler !== 'function') continue;

        const permissions = this.reflector.get<(string | PermissionMetadata)[]>(
          PERMISSIONS_KEY,
          handler as (...args: unknown[]) => unknown,
        );

        if (!Array.isArray(permissions)) continue;

        for (const p of permissions) {
          const name = typeof p === 'string' ? p : p.name;
          const labelAr = typeof p === 'string' ? p : p.labelAr;
          const scope = name.startsWith(SYSTEM_PERMISSION_PREFIX)
            ? PermissionScope.SYSTEM
            : PermissionScope.TENANT;

          await this.permissionCoreService.findOrCreate(
            name,
            labelAr,
            scope,
            null,
          );
        }
      }
    }
  }
}
