// src/modules/permissions/permission-core.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission, PermissionScope } from './entities/permission.entity';

/**
 * Service مستقل بدون REQUEST scope.
 * يستخدمه PermissionDiscoveryService أثناء onModuleInit.
 * لا يعتمد على request.user لأنه يعمل فقط مع صلاحيات النظام.
 */
@Injectable()
export class PermissionCoreService {
  constructor(
    @InjectRepository(Permission)
    private readonly repo: Repository<Permission>,
  ) {}

  async findOrCreate(
    name: string,
    scope: PermissionScope = PermissionScope.SYSTEM,
    tenantId: string | null = null,
  ): Promise<Permission> {
    const existing = await this.repo.findOne({
      where: {
        name,
        scope,
        ...(tenantId ? { tenantId } : {}),
      },
    });

    if (existing) return existing;

    const permission = this.repo.create({ name, scope, tenantId });
    return this.repo.save(permission);
  }
}
