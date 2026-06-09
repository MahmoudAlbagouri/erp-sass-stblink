// src/modules/permissions/permission-discovery.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PermissionCoreService } from './permission-core.service'; // ← التغيير هنا
import { PermissionScope } from './entities/permission.entity';

@Injectable()
export class PermissionDiscoveryService implements OnModuleInit {
  private readonly logger = new Logger(PermissionDiscoveryService.name);

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly reflector: Reflector,
    private readonly permissionCoreService: PermissionCoreService, // ← بدلاً من PermissionsService
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('Starting automatic permission discovery...');

    const controllers = this.discoveryService.getControllers();
    let discoveredCount = 0;

    for (const controller of controllers) {
      if (!controller.instance || !controller.metatype) continue;

      const prototype = Object.getPrototypeOf(controller.instance) as Record<
        string,
        unknown
      >;

      for (const methodName of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[methodName];
        if (typeof handler !== 'function') continue;

        const permissions = this.reflector.get<string[] | undefined>(
          PERMISSIONS_KEY,
          handler as (...args: unknown[]) => unknown,
        );

        if (!Array.isArray(permissions)) continue;

        for (const permName of permissions) {
          // ✅ تحديد النطاق بوضوح
          const scope = permName.startsWith('system:')
            ? PermissionScope.SYSTEM
            : PermissionScope.SYSTEM; // ✅ تغيير هنا: الصلاحيات الأساسية كلها SYSTEM

          // ✅ تمرير null كـ tenantId للصلاحيات النظامية
          await this.permissionCoreService.findOrCreate(permName, scope, null);
          discoveredCount++;
        }
      }
    }

    this.logger.log(
      `Permission discovery completed. Processed ${discoveredCount} permissions.`,
    );
  }
}
