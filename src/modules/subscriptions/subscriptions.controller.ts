import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionManagerService } from './subscription-manager.service';
import { ChangePlanDto } from './dto/change-plan.dto';
import { RenewSubscriptionDto } from './dto/renew-subscription.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { PERMS } from '../../common/constants/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { UpdateSubscriptionStatusDto } from './dto/update-subscription-status.dto';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly subscriptionManager: SubscriptionManagerService,
  ) {}

  @Get('me')
  @Permissions(PERMS.SUBSCRIPTION_VIEW_OWN)
  @UseGuards(PermissionsGuard)
  async getMySubscription(
    @CurrentTenantId() tenantId?: string,
    @CurrentUser() user?: User & { isSuperSystem?: boolean }, // احقن المستخدم الحالي
  ) {
    // ✅ التحقق الأول: هل المستخدم هو مالك النظام؟
    if (user?.isSuperSystem) {
      return {
        isSuperSystem: true,
        plan: { name: 'SYSTEM_OWNER', nameAr: 'مالك النظام' },
        status: 'active',
        quotas: null, // لا يوجد حدود لمالك النظام
        message: 'أنت مالك النظام ولديك صلاحيات وصول كاملة غير محدودة',
      };
    }

    // ✅ الحالة الثانية: مستخدم عادي مرتبط بـ Tenant
    if (!tenantId) {
      throw new BadRequestException('لا يمكن تحديد هوية الشركة لهذا المستخدم');
    }

    return this.subscriptionManager.getUsageSummary(tenantId);
  }

  @Get('tenant/:tenantId')
  @Permissions(PERMS.SUBSCRIPTION_VIEW_ANY)
  @UseGuards(PermissionsGuard)
  getTenantSubscription(@Param('tenantId') tenantId: string) {
    return this.subscriptionManager.getUsageSummary(tenantId);
  }

  @Post('tenant/:tenantId/change-plan')
  @Permissions(PERMS.SUBSCRIPTION_MANAGE)
  @UseGuards(PermissionsGuard)
  changePlan(@Param('tenantId') tenantId: string, @Body() dto: ChangePlanDto) {
    return this.subscriptionsService.changePlan(tenantId, dto.planId, {
      durationDays: dto.durationDays,
      autoRenew: dto.autoRenew,
    });
  }
  @Post('tenant/:tenantId/status')
  @Permissions(PERMS.SUBSCRIPTION_MANAGE)
  @UseGuards(PermissionsGuard)
  updateStatus(
    @Param('tenantId') tenantId: string,
    @Body() dto: UpdateSubscriptionStatusDto,
  ) {
    return this.subscriptionsService.updateSubscriptionStatus(tenantId, dto);
  }

  @Post('tenant/:tenantId/renew')
  @Permissions(PERMS.SUBSCRIPTION_MANAGE)
  @UseGuards(PermissionsGuard)
  renew(
    @Param('tenantId') tenantId: string,
    @Body() dto: RenewSubscriptionDto,
  ) {
    return this.subscriptionsService.renew(tenantId, dto.extraDays);
  }

  @Post('tenant/:tenantId/cancel')
  @Permissions(PERMS.SUBSCRIPTION_MANAGE)
  @UseGuards(PermissionsGuard)
  cancel(@Param('tenantId') tenantId: string) {
    return this.subscriptionsService.cancel(tenantId);
  }
}
