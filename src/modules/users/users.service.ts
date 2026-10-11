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

const ASSIGN_SUPER_ADMIN_PERMISSION = 'assign_super_admin';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Role) private readonly roleRepository: Repository<Role>,
  ) {}

  /** استخدام داخلي (Auth) — بدون عزل شركات. للـ API استخدم findOneScoped */
  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['role', 'role.permissions', 'employee'],
    });

    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** ✅ عزل الشركات: لا يرى/يعدّل المستخدم إلا مستخدمي شركته (عدا مالك النظام) */
  async findOneScoped(id: string, currentUser: CurrentUserData): Promise<User> {
    const user = await this.findOne(id);
    if (!currentUser.isSystemAdmin && user.tenantId !== currentUser.tenantId) {
      throw new NotFoundException('User not found');
    }
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

  /** الدور يجب أن يكون دوراً عاماً أو تابعاً لنفس الشركة */
  private async resolveAssignableRole(
    roleId: string,
    currentUser: CurrentUserData,
    tenantId: string | undefined,
  ): Promise<Role> {
    const role = await this.roleRepository.findOneBy({ id: roleId });
    const isForeignRole =
      !!role?.tenantId &&
      !currentUser.isSystemAdmin &&
      role.tenantId !== tenantId;

    if (!role || isForeignRole) throw new NotFoundException('Role not found');
    return role;
  }

  private canAssignSuperAdmin(currentUser: CurrentUserData): boolean {
    return (
      currentUser.isSystemAdmin ||
      (currentUser.permissions?.includes(ASSIGN_SUPER_ADMIN_PERMISSION) ??
        false)
    );
  }

  async create(
    dto: CreateUserDto,
    currentUser: CurrentUserData,
    tenantId: string,
  ): Promise<User> {
    const { roleId, password, ...userData } = dto;
    const role = roleId
      ? await this.resolveAssignableRole(roleId, currentUser, tenantId)
      : undefined;
    const hashedPassword = await argon2.hash(password);

    const user = this.userRepository.create({
      ...userData,
      password: hashedPassword,
      tenantId: tenantId,
      role: role,
      isSuperAdmin: this.canAssignSuperAdmin(currentUser)
        ? (dto.isSuperAdmin ?? false)
        : false,
      status: dto.status || UserStatus.ACTIVE,
      // 🔒 المستخدم الجديد يبدأ دائماً بدون إقرار (ولا يمكن تمريره من الـ DTO)
      isDisclaimerAccepted: false,
      disclaimerAcceptedAt: null,
    });
    return this.userRepository.save(user);
  }

  async findAll(
    currentUser: CurrentUserData,
    tenantId: string,
  ): Promise<User[]> {
    const whereCondition: FindOptionsWhere<User> = {};
    if (!currentUser.isSystemAdmin) whereCondition.tenantId = tenantId;

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
    const user = await this.findOneScoped(id, currentUser);

    // 🔒 حقول الإقرار لا تتغير إلا عبر POST /auth/accept-disclaimer
    const { roleId, ...changes } = dto as UpdateUserDto &
      Record<string, unknown>;
    delete changes.isDisclaimerAccepted;
    delete changes.disclaimerAcceptedAt;

    if (changes.password)
      changes.password = await argon2.hash(changes.password);
    if (
      changes.isSuperAdmin !== undefined &&
      !this.canAssignSuperAdmin(currentUser)
    )
      delete changes.isSuperAdmin;

    Object.assign(user, changes);

    // ✅ تغيير الدور عبر العلاقة نفسها (تعديل roleId وحده يتجاهله TypeORM
    // لأن العلاقة role المحمّلة لها الأولوية عند الحفظ)
    if (roleId) {
      user.role = await this.resolveAssignableRole(
        roleId,
        currentUser,
        user.tenantId,
      );
      user.roleId = user.role.id;
    }

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
    const isSystemAdmin = currentUser.isSystemAdmin;
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
