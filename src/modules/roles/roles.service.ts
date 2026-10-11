import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull, FindOptionsWhere } from 'typeorm';
import { Role } from './entities/role.entity';
import {
  Permission,
  PermissionScope,
} from '../permissions/entities/permission.entity';
import { filterTenantAssignablePermissions } from '../permissions/utils/permission-scope.util';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';

@Injectable() // أصبح Singleton
export class RolesService {
  constructor(
    @InjectRepository(Role) private roleRepo: Repository<Role>,
    @InjectRepository(Permission) private permRepo: Repository<Permission>,
  ) {}

  /** ✅ غير مالك النظام لا يستطيع إسناد صلاحيات system: أو صلاحيات شركة أخرى */
  private async resolvePermissions(
    permissionIds: string[],
    user: CurrentUserData,
    tenantId: string,
  ): Promise<Permission[]> {
    const permissions = await this.permRepo.findBy({ id: In(permissionIds) });
    return user.isSystemAdmin
      ? permissions
      : filterTenantAssignablePermissions(permissions, tenantId);
  }

  async create(
    dto: CreateRoleDto,
    user: CurrentUserData,
    tenantId: string,
  ): Promise<Role> {
    const isSystem = dto.scope === PermissionScope.SYSTEM;

    if (isSystem && !user.isSystemAdmin) {
      throw new ForbiddenException('Only System Admin can create system roles');
    }

    const roleData = {
      name: dto.name,
      scope: dto.scope,
      permissions: await this.resolvePermissions(
        dto.permissionIds,
        user,
        tenantId,
      ),
      tenantId: isSystem ? null : tenantId,
    };

    return await this.roleRepo.save(this.roleRepo.create(roleData));
  }

  async findAll(user: CurrentUserData, tenantId: string): Promise<Role[]> {
    if (user.isSystemAdmin) {
      return this.roleRepo.find({ relations: ['permissions'] });
    }

    return this.roleRepo.find({
      where: [
        { tenantId: tenantId },
        { tenantId: IsNull(), scope: PermissionScope.SYSTEM },
      ] as FindOptionsWhere<Role>[],
      relations: ['permissions'],
    });
  }

  /**
   * ✅ عزل الشركات: الأدوار العامة (tenantId = null) للقراءة فقط،
   * وأدوار الشركات الأخرى غير مرئية إطلاقاً.
   */
  async findOne(
    id: string,
    user: CurrentUserData,
    tenantId: string,
    forWrite = false,
  ): Promise<Role> {
    const role = await this.roleRepo.findOne({
      where: { id },
      relations: ['permissions'],
    });
    if (!role) throw new NotFoundException(`Role with ID ${id} not found`);
    if (user.isSystemAdmin) return role;

    const isOwnRole = role.tenantId === tenantId;
    if (!isOwnRole && role.tenantId) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }
    if (!isOwnRole && forWrite) {
      throw new ForbiddenException('لا يمكن تعديل أو حذف أدوار النظام العامة');
    }
    return role;
  }

  async update(
    id: string,
    dto: UpdateRoleDto,
    user: CurrentUserData,
    tenantId: string,
  ): Promise<Role> {
    const role = await this.findOne(id, user, tenantId, true);

    if (dto.permissionIds) {
      role.permissions = await this.resolvePermissions(
        dto.permissionIds,
        user,
        tenantId,
      );
    }

    if (dto.name) role.name = dto.name;

    return await this.roleRepo.save(role);
  }

  async remove(
    id: string,
    user: CurrentUserData,
    tenantId: string,
  ): Promise<void> {
    const role = await this.findOne(id, user, tenantId, true);
    await this.roleRepo.remove(role);
  }
}
