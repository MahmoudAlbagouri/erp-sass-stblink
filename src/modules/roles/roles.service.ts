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
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';

@Injectable() // أصبح Singleton
export class RolesService {
  constructor(
    @InjectRepository(Role) private roleRepo: Repository<Role>,
    @InjectRepository(Permission) private permRepo: Repository<Permission>,
  ) {}

  async create(
    dto: CreateRoleDto,
    user: CurrentUserData,
    tenantId: string,
  ): Promise<Role> {
    const isSystem = dto.scope === PermissionScope.SYSTEM;

    if (isSystem && !user.isSystemAdmin) {
      throw new ForbiddenException('Only System Admin can create system roles');
    }

    const permissions = await this.permRepo.findBy({
      id: In(dto.permissionIds),
    });

    const roleData = {
      name: dto.name,
      scope: dto.scope,
      permissions,
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

  async findOne(id: string): Promise<Role> {
    const role = await this.roleRepo.findOne({
      where: { id },
      relations: ['permissions'],
    });
    if (!role) throw new NotFoundException(`Role with ID ${id} not found`);
    return role;
  }

  async update(id: string, dto: UpdateRoleDto): Promise<Role> {
    const role = await this.findOne(id);

    if (dto.permissionIds) {
      role.permissions = await this.permRepo.findBy({
        id: In(dto.permissionIds),
      });
    }

    if (dto.name) role.name = dto.name;

    return await this.roleRepo.save(role);
  }

  async remove(id: string): Promise<void> {
    const role = await this.findOne(id);
    await this.roleRepo.remove(role);
  }
}
