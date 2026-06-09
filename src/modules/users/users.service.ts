// src/modules/users/users.service.ts
import { Injectable, Inject, Scope, NotFoundException } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { Request } from 'express';
import * as argon2 from 'argon2';

import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Role } from '../roles/entities/role.entity';
import { UserStatus } from '../../common/enums/user.enums';

// ✅ تحديث الواجهة لتشمل isSystemAdmin وجعل tenantId اختيارياً
interface RequestWithUser extends Request {
  user: {
    id: string;
    tenantId?: string; // ✅ nullable
    isSuperAdmin: boolean;
    isSystemAdmin: boolean; // ✅ تمت الإضافة
  };
}

@Injectable({ scope: Scope.REQUEST })
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @Inject(REQUEST)
    private readonly request: RequestWithUser,
  ) {}

  async findOneByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email },
      relations: ['role', 'role.permissions'],
      select: [
        'id',
        'username',
        'email',
        'password',
        'tenantId',
        'isSuperAdmin',
        'isSystemAdmin',
        'status',
        'role',
      ],
    });
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['role', 'role.permissions'],
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(createUserDto: CreateUserDto): Promise<User> {
    const { roleId, password, ...userData } = createUserDto;

    let role: Role | undefined;
    if (roleId) {
      const foundRole = await this.roleRepository.findOneBy({ id: roleId });
      if (!foundRole) throw new NotFoundException('Role not found');
      role = foundRole ?? undefined;
    }

    const hashedPassword = await argon2.hash(password);

    // ✅ السماح لمالك النظام أو مدير الشركة بتعيين SuperAdmin
    const canAssignSuperAdmin =
      this.request.user.isSuperAdmin || this.request.user.isSystemAdmin;

    const finalIsSuperAdmin = canAssignSuperAdmin
      ? (createUserDto.isSuperAdmin ?? false)
      : false;

    const user = this.userRepository.create({
      ...userData,
      password: hashedPassword,
      tenantId: this.request.user.tenantId, // ✅ قد تكون undefined لمالك النظام
      roleId: role?.id,
      role: role,
      isSuperAdmin: finalIsSuperAdmin,
      status: createUserDto.status || UserStatus.ACTIVE,
    });

    return this.userRepository.save(user);
  }

  async findAll(): Promise<User[]> {
    const whereCondition: FindOptionsWhere<User> = {};

    // ✅ المنطق الذكي للعزل
    if (!this.request.user.isSystemAdmin) {
      // إذا لم يكن مالك نظام، فلتر حسب الشركة فقط
      whereCondition.tenantId = this.request.user.tenantId;
    }
    // إذا كان SystemAdmin، الشرط فارغ = جلب الجميع

    return this.userRepository.find({
      where: whereCondition,
      relations: ['role', 'role.permissions', 'tenant'],
      order: { created_at: 'DESC' },
      withDeleted: false,
    });
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);

    if (updateUserDto.password) {
      updateUserDto.password = await argon2.hash(updateUserDto.password);
    }

    // ✅ حماية مزدوجة
    const canUpdateSuperAdmin =
      this.request.user.isSuperAdmin || this.request.user.isSystemAdmin;

    if (updateUserDto.isSuperAdmin !== undefined && !canUpdateSuperAdmin) {
      delete updateUserDto.isSuperAdmin;
    }

    Object.assign(user, updateUserDto);
    return this.userRepository.save(user);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);
    await this.userRepository.softRemove(user);
  }
}
