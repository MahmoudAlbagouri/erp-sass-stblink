// src/modules/payroll/my-payslips.controller.ts
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FEATURES } from '../../common/constants/features';
import {
  CurrentUser,
  type CurrentUserData,
} from '../../common/decorators/current-user.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { apiTag } from '../../config/swagger.config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MyPayslipsService } from './my-payslips.service';

/**
 * قسائم الموظف لنفسه، بلا صلاحية خاصة (مثل /profile/me).
 *
 * يُسجَّل قبل PayrollController في الموديول: `GET /payroll/:id` هناك كان سيلتقط
 * `/payroll/me`.
 */
@ApiTags(apiTag('PAYROLL'))
@Controller('payroll/me')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
@RequiresFeature(FEATURES.PAYROLL_MODULE)
export class MyPayslipsController {
  constructor(private readonly payslips: MyPayslipsService) {}

  /** قسائم راتبي بعد تأكيد الصرف، الأحدث أولاً */
  @Get()
  list(@CurrentUser() user: CurrentUserData) {
    return this.payslips.list(user);
  }

  /** تفاصيل قسيمة: المستحقات والخصومات والصافي */
  @Get(':id')
  detail(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payslips.detail(user, id);
  }
}
