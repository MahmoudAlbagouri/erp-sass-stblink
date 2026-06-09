// src/modules/permissions/permissions.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DiscoveryModule } from '@nestjs/core';
import { Permission } from './entities/permission.entity';
import { PermissionsService } from './permissions.service';
import { PermissionsController } from './permissions.controller';
import { PermissionCoreService } from './permission-core.service';
import { PermissionDiscoveryService } from './permission-discovery.service';

@Module({
  imports: [TypeOrmModule.forFeature([Permission]), DiscoveryModule],
  controllers: [PermissionsController],
  providers: [
    PermissionsService,
    PermissionCoreService, // ← مضاف
    PermissionDiscoveryService,
  ],
  exports: [PermissionsService, PermissionCoreService], // ← export الاثنين
})
export class PermissionsModule {}
