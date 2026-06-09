// src/modules/roles/roles.service.ts
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Inject,
  Scope,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, FindOptionsWhere, IsNull } from 'typeorm';
import { Request } from 'express';
import { Role } from './entities/role.entity';
import {
  Permission,
  PermissionScope,
} from '../permissions/entities/permission.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

interface RequestWithUser extends Request {
  user?: {
    tenantId?: string;
    isSystemAdmin?: boolean;
  };
}

@Injectable({ scope: Scope.REQUEST })
export class RolesService {
  constructor(
    @InjectRepository(Role) private roleRepo: Repository<Role>,
    @InjectRepository(Permission) private permRepo: Repository<Permission>,
    @Inject(REQUEST) private request: RequestWithUser,
  ) {}

  async create(dto: CreateRoleDto): Promise<Role> {
    const isSystem = dto.scope === PermissionScope.SYSTEM;

    if (isSystem && !this.request.user?.isSystemAdmin) {
      throw new ForbiddenException('Only System Admin can create system roles');
    }

    // ✅ جلب الصلاحيات بالـ IDs فقط (لضمان العثور عليها سواء كانت system أو tenant)
    const permissions = await this.permRepo.findBy({
      id: In(dto.permissionIds),
    });

    // ✅ التحقق الأمني: تأكد أن الصلاحيات المختارة مسموح للمستخدم الوصول إليها
    // (يمكن إضافة منطق هنا لاحقاً لمنع مدير الشركة من اختيار صلاحيات system:)

    // ✅ تحديد tenantId للدور: إذا كان نظامياً فهو null، وإلا فهو شركة المستخدم الحالي
    const roleTenantId = isSystem ? null : this.request.user?.tenantId || null;

    const roleData = {
      name: dto.name,
      scope: dto.scope,
      permissions, // ربط كائنات الصلاحيات مباشرة
      tenantId: roleTenantId,
    };

    const role = this.roleRepo.create(roleData);
    return await this.roleRepo.save(role);
  }
  // في findAll() - أضف صلاحيات النظام للمستخدمين العاديين أيضاً
  async findAll(): Promise<Role[]> {
    if (this.request.user?.isSystemAdmin) {
      return this.roleRepo.find({ relations: ['permissions'] });
    }

    // ✅ مستخدمو الشركة يرون أدوار شركتهم + الأدوار النظامية
    return this.roleRepo.find({
      where: [
        { tenantId: this.request.user?.tenantId },
        { tenantId: IsNull() }, // ← أضف: import { IsNull } from 'typeorm'
      ] as FindOptionsWhere<Role>[],
      relations: ['permissions'],
    });
  }

  async findOne(id: string): Promise<Role> {
    const role = await this.roleRepo.findOne({
      where: { id },
      relations: ['permissions'],
    });
    if (!role) throw new NotFoundException(`Role with ID ${id} not found`);
    return role;
  }

  async update(id: string, updateRoleDto: UpdateRoleDto): Promise<Role> {
    const role = await this.findOne(id);

    if (updateRoleDto.permissionIds) {
      const permissions = await this.permRepo.findBy({
        id: In(updateRoleDto.permissionIds),
      });
      role.permissions = permissions;
    }

    if (updateRoleDto.name) {
      role.name = updateRoleDto.name;
    }

    return await this.roleRepo.save(role);
  }

  async remove(id: string): Promise<void> {
    const role = await this.findOne(id);
    await this.roleRepo.remove(role);
  }
}
