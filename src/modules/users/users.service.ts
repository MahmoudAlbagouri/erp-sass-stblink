import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import * as argon2 from 'argon2';

import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Role } from '../roles/entities/role.entity';
import { UserStatus } from '../../common/enums/user.enums';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Role) private readonly roleRepository: Repository<Role>,
  ) {}

  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['role', 'role.permissions', 'employee'],
    });

    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findOneByEmail(email: string): Promise<User | null> {
    return await this.userRepository.findOne({
      where: { email },
      relations: ['role', 'role.permissions'],
      select: {
        id: true,
        email: true,
        password: true,
        username: true,
        tenantId: true,
        isSuperAdmin: true,
        isSystemAdmin: true,
        status: true,
        resetPasswordToken: true,
        resetPasswordExpires: true,
        role: {
          id: true,
          name: true,
          permissions: {
            name: true,
          },
        },
      },
    });
  }

  async create(
    dto: CreateUserDto,
    currentUser: CurrentUserData,
    tenantId: string,
  ): Promise<User> {
    const { roleId, password, ...userData } = dto;
    let role: Role | undefined;
    if (roleId) {
      role = (await this.roleRepository.findOneBy({ id: roleId })) ?? undefined;
      if (!role) throw new NotFoundException('Role not found');
    }
    const hashedPassword = await argon2.hash(password);
    const canAssignSuperAdmin =
      currentUser.permissions?.includes('assign_super_admin') ?? false;

    const user = this.userRepository.create({
      ...userData,
      password: hashedPassword,
      tenantId: tenantId,
      role: role,
      isSuperAdmin: canAssignSuperAdmin ? (dto.isSuperAdmin ?? false) : false,
      status: dto.status || UserStatus.ACTIVE,
    });
    return this.userRepository.save(user);
  }

  async findAll(
    currentUser: CurrentUserData,
    tenantId: string,
  ): Promise<User[]> {
    const whereCondition: FindOptionsWhere<User> = {};
    const isSystemAdmin =
      currentUser.permissions?.includes('system:admin') ?? false;
    if (!isSystemAdmin) whereCondition.tenantId = tenantId;

    return this.userRepository.find({
      where: whereCondition,
      relations: ['role', 'role.permissions', 'tenant'],
      order: { created_at: 'DESC' },
    });
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    currentUser: CurrentUserData,
  ): Promise<User> {
    const user = await this.findOne(id);
    if (dto.password) dto.password = await argon2.hash(dto.password);
    const canUpdateSuperAdmin =
      currentUser.permissions?.includes('assign_super_admin') ?? false;
    if (dto.isSuperAdmin !== undefined && !canUpdateSuperAdmin)
      delete dto.isSuperAdmin;
    Object.assign(user, dto);
    return this.userRepository.save(user);
  }

  async remove(id: string, currentUser: CurrentUserData): Promise<void> {
    // 1. حماية النفس: يمنع المستخدم من حذف حسابه الخاص
    if (id === currentUser.id) {
      throw new BadRequestException('لا يمكنك حذف حسابك الشخصي');
    }

    // 2. البحث عن المستخدم المراد حذفه
    const userToDelete = await this.findOne(id);

    // 3. عزل الشركات: التأكد من أن المستخدم ينتمي لشركة المستعلم نفسها
    const isSystemAdmin =
      currentUser.permissions?.includes('system:admin') ?? false;
    if (!isSystemAdmin && userToDelete.tenantId !== currentUser.tenantId) {
      throw new ForbiddenException('لا تملك صلاحية الوصول لهذا المستخدم');
    }

    // 4. حماية مالك المنصة (System Admin)
    if (userToDelete.isSystemAdmin) {
      throw new ForbiddenException('لا يمكن حذف مالك المنصة (System Admin)');
    }

    // 5. حماية مدير الشركة (Super Admin)
    if (userToDelete.isSuperAdmin && !isSystemAdmin) {
      throw new ForbiddenException('لا يمكنك حذف مدير الشركة (Super Admin)');
    }

    // 6. تنفيذ الحذف اللطيف (Soft Delete)
    await this.userRepository.softRemove(userToDelete);
  }

  async getSystemStats() {
    return {
      totalUsers: await this.userRepository.count(),
      message: 'Platform Stats',
    };
  }
}
