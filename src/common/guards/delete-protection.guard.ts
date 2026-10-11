// src/common/guards/delete-protection.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../modules/users/entities/user.entity';
import { PROTECTED_DELETE } from '../decorators/protected-delete.decorator';
import type { AuthenticatedRequest } from '../types/auth.types';

@Injectable()
export class DeleteProtectionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. هل هذه الدالة محمية بـ @ProtectedDelete()؟
    const isProtected = this.reflector.get<boolean>(
      PROTECTED_DELETE,
      context.getHandler(),
    );
    if (!isProtected) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { user, params } = request;
    const targetId = String(params.id);
    const routePath =
      (request.route as { path?: string } | undefined)?.path ?? '';

    // 2. السماح لمالك النظام (System Admin) بتجاوز كافة القيود
    if (user.isSystemAdmin) return true;

    // --- حماية المستخدمين ---
    if (routePath.includes('/users')) {
      if (targetId === user.id) {
        throw new ForbiddenException('لا يمكنك حذف حسابك الشخصي.');
      }

      const userToDelete = await this.userRepository.findOne({
        where: { id: targetId },
      });
      if (!userToDelete) throw new NotFoundException('المستخدم غير موجود');

      // منع مدير الشركة من حذف مدير شركة آخر
      if (userToDelete.isSuperAdmin && user.isSuperAdmin) {
        throw new ForbiddenException('لا يمكنك حذف مدير شركة آخر.');
      }
    }

    // --- حماية الشركات ---
    if (routePath.includes('/tenants')) {
      if (targetId === user.tenantId) {
        throw new ForbiddenException('لا يمكنك حذف شركتك الحالية.');
      }
    }

    return true;
  }
}
