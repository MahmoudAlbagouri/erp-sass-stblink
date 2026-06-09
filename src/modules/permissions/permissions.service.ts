// src/modules/permissions/permissions.service.ts
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Inject,
  Scope,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, IsNull } from 'typeorm';
import { Request } from 'express';
import { Permission, PermissionScope } from './entities/permission.entity';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';

interface RequestUser {
  tenantId?: string;
  isSystemAdmin?: boolean;
}

interface RequestWithUser extends Request {
  user?: RequestUser;
}

@Injectable({ scope: Scope.REQUEST })
export class PermissionsService {
  constructor(
    @InjectRepository(Permission)
    private readonly repo: Repository<Permission>,
    @Inject(REQUEST)
    private readonly request: RequestWithUser,
  ) {}

  async create(dto: CreatePermissionDto): Promise<Permission> {
    const isSystem = dto.scope === PermissionScope.SYSTEM;

    if (isSystem && !this.request.user?.isSystemAdmin) {
      throw new ForbiddenException(
        'Only System Admin can create system permissions',
      );
    }

    const permission = this.repo.create({
      ...dto,
      tenantId: isSystem ? null : (this.request.user?.tenantId ?? null),
    });

    return this.repo.save(permission);
  }

  // src/modules/permissions/permissions.service.ts
  async findAll(): Promise<Permission[]> {
    const user = this.request.user;

    if (user?.isSystemAdmin) {
      return this.repo.find(); // المالك يرى كل شيء
    }

    if (user?.tenantId) {
      // ✅ الشركات ترى الصلاحيات العامة فقط (تستبعد التي تبدأ بـ system:)
      const allPerms = await this.repo.find({
        where: [
          { tenantId: IsNull(), scope: PermissionScope.SYSTEM },
          { tenantId: user.tenantId },
        ] as FindOptionsWhere<Permission>[],
      });

      // ✅ تصفية الصلاحيات الخاصة بالسيستم والتي تبدأ بـ system:
      return allPerms.filter((p) => !p.name.startsWith('system:'));
    }

    return [];
  }

  async findOne(id: string): Promise<Permission> {
    const permission = await this.repo.findOneBy({ id });
    if (!permission) {
      throw new NotFoundException(`Permission with ID "${id}" not found`);
    }
    return permission;
  }

  async update(id: string, dto: UpdatePermissionDto): Promise<Permission> {
    const permission = await this.findOne(id);
    Object.assign(permission, dto);
    return this.repo.save(permission);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.repo.delete(id);
  }
}
