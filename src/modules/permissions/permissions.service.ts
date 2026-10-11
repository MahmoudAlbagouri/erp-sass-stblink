// src/modules/permissions/permissions.service.ts
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Permission, PermissionScope } from './entities/permission.entity';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { isSystemPermission } from './utils/permission-scope.util';

@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(Permission)
    private readonly repo: Repository<Permission>,
  ) {}

  async create(
    dto: CreatePermissionDto,
    user: CurrentUserData,
    tenantId: string,
  ): Promise<Permission> {
    const isSystem = dto.scope === PermissionScope.SYSTEM;

    if (isSystem && !user.isSystemAdmin) {
      throw new ForbiddenException(
        'Only System Admin can create system permissions',
      );
    }

    const permission = this.repo.create({
      ...dto,
      tenantId: isSystem ? null : tenantId,
    });

    return this.repo.save(permission);
  }

  async findAll(
    user: CurrentUserData,
    tenantId: string,
  ): Promise<Permission[]> {
    // ✅ System Admin: يرى كل الصلاحيات بدون استثناء
    if (user.isSystemAdmin) {
      return this.repo.find();
    }

    if (tenantId) {
      // ✅ يجلب:
      //    1. الصلاحيات العامة (tenantId = NULL) بكلا النوعين
      //    2. الصلاحيات الخاصة بهذا الـ tenant
      const allPerms = await this.repo.find({
        where: [
          { tenantId: IsNull() }, // كل الصلاحيات العامة (SYSTEM + TENANT بدون مستأجر)
          { tenantId: tenantId }, // الصلاحيات الخاصة بهذا المستأجر
        ],
      });

      // ✅ حذف صلاحيات system: من نتائج الموظفين العاديين والـ SuperAdmin
      return allPerms.filter((p) => !isSystemPermission(p));
    }

    return [];
  }

  /**
   * ✅ عزل الشركات: الصلاحيات العامة (tenantId = null) للقراءة فقط لغير
   * مالك النظام، وصلاحيات system: والشركات الأخرى غير مرئية إطلاقاً.
   */
  async findOne(
    id: string,
    user: CurrentUserData,
    tenantId: string,
    forWrite = false,
  ): Promise<Permission> {
    const permission = await this.repo.findOneBy({ id });
    const notFound = new NotFoundException(
      `Permission with ID "${id}" not found`,
    );
    if (!permission) throw notFound;
    if (user.isSystemAdmin) return permission;

    const isOwn = permission.tenantId === tenantId;
    if (isSystemPermission(permission) || (!isOwn && permission.tenantId)) {
      throw notFound;
    }
    if (!isOwn && forWrite) {
      throw new ForbiddenException(
        'لا يمكن تعديل أو حذف صلاحيات النظام العامة',
      );
    }
    return permission;
  }

  async update(
    id: string,
    dto: UpdatePermissionDto,
    user: CurrentUserData,
    tenantId: string,
  ): Promise<Permission> {
    const permission = await this.findOne(id, user, tenantId, true);

    if (dto.scope === PermissionScope.SYSTEM && !user.isSystemAdmin) {
      throw new ForbiddenException(
        'Only System Admin can create system permissions',
      );
    }

    Object.assign(permission, dto);
    return this.repo.save(permission);
  }

  async remove(
    id: string,
    user: CurrentUserData,
    tenantId: string,
  ): Promise<void> {
    await this.findOne(id, user, tenantId, true);
    await this.repo.delete(id);
  }
}
