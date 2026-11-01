// src/modules/attendance/my-attendance.controller.ts
import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
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
import { MobilePunchDto, MyMonthQueryDto } from './dto/my-attendance.dto';
import { MyAttendanceService } from './my-attendance.service';

/**
 * ما يراه الموظف عن حضوره. بلا صلاحية خاصة: كل موظف يرى نفسه فقط (مثل
 * /profile/me)، والهوية من التوكن لا من الطلب.
 */
@ApiTags(apiTag('ATTENDANCE'))
@Controller('attendance/me')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
@RequiresFeature(FEATURES.ATTENDANCE_MODULE)
export class MyAttendanceController {
  constructor(private readonly myAttendance: MyAttendanceService) {}

  /** حضوري اليوم، وهل أستطيع البصمة من الجوال الآن */
  @Get('today')
  today(@CurrentUser() user: CurrentUserData) {
    return this.myAttendance.today(user);
  }

  /** تقرير حضوري في شهر، بنفس أرقام المسير */
  @Get('month')
  month(@CurrentUser() user: CurrentUserData, @Query() query: MyMonthQueryDto) {
    return this.myAttendance.month(user, query.month, query.year);
  }

  /** بصمة من تطبيق الجوال: بالجوال المربوط وداخل نطاق الفرع، وتعيد حضور اليوم */
  @Post('punch')
  punch(@CurrentUser() user: CurrentUserData, @Body() dto: MobilePunchDto) {
    return this.myAttendance.punch(user, dto);
  }
}
