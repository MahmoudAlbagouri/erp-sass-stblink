// src/modules/permissions/permission-core.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission, PermissionScope } from './entities/permission.entity';

@Injectable()
export class PermissionCoreService {
  constructor(
    @InjectRepository(Permission) private readonly repo: Repository<Permission>,
  ) {}

  async findOrCreate(
    name: string,
    labelAr: string,
    scope: PermissionScope,
    tenantId: string | null = null,
  ): Promise<Permission> {
    let permission = await this.repo.findOne({ where: { name } });

    if (!permission) {
      permission = this.repo.create({
        name,
        displayNameAr: labelAr,
        scope,
        tenantId,
      });
      await this.repo.save(permission);
    }
    return permission;
  }
}
