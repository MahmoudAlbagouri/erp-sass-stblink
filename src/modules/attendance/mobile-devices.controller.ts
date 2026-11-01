// src/modules/attendance/mobile-devices.controller.ts
import {
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FEATURES } from '../../common/constants/features';
import { PERMS } from '../../common/constants/permissions';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { apiTag } from '../../config/swagger.config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MyAttendanceService } from './my-attendance.service';

@ApiTags(apiTag('ATTENDANCE'))
@Controller('attendance/mobile-devices')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class MobileDevicesController {
  constructor(private readonly myAttendance: MyAttendanceService) {}

  /** فك ربط جوال موظف: تغيّر جواله، والبصمة التالية تربط الجديد */
  @Delete(':employeeId')
  @Permissions(PERMS.ATTENDANCE_SETTINGS_MANAGE)
  @RequiresFeature(FEATURES.MOBILE_ATTENDANCE)
  @UseGuards(PermissionsGuard)
  unbind(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.myAttendance.unbindDevice(employeeId, tenantId);
  }
}
