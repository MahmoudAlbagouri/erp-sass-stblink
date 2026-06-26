// src/modules/permissions/permission-discovery.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import {
  PERMISSIONS_KEY,
  PermissionMetadata,
} from '../../common/decorators/permissions.decorator';
import { PermissionCoreService } from './permission-core.service';
import { PermissionScope } from './entities/permission.entity';

@Injectable()
export class PermissionDiscoveryService implements OnModuleInit {
  private readonly logger = new Logger(PermissionDiscoveryService.name);

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly reflector: Reflector,
    private readonly permissionCoreService: PermissionCoreService,
  ) {}

  async onModuleInit(): Promise<void> {
    const controllers = this.discoveryService.getControllers();

    for (const controller of controllers) {
      if (!controller.instance) continue;

      // ✅ الحل 1: تحديد نوع prototype بوضوح
      const prototype = Object.getPrototypeOf(controller.instance) as Record<
        string,
        any
      >;

      // ✅ الحل 2: تحديد نوع methodName كـ string
      for (const methodName of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[methodName];

        // ✅ التحقق من أن handler هو دالة قبل استخدامه
        if (typeof handler !== 'function') continue;

        const permissions = this.reflector.get<(string | PermissionMetadata)[]>(
          PERMISSIONS_KEY,
          handler, // ✅ الآن handler معروف أنه Function
        );

        if (!Array.isArray(permissions)) continue;

        for (const p of permissions) {
          const name = typeof p === 'string' ? p : p.name;
          const labelAr = typeof p === 'string' ? p : p.labelAr;
          const scope = name.startsWith('system:')
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
