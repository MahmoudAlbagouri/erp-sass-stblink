import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { apiTag } from '../../config/swagger.config';
import { ProfileService } from './profile.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { type CurrentUserData } from '../../common/decorators/current-user.decorator';

@ApiTags(apiTag('PROFILE'))
@Controller('profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  /** ملف المستخدم الحالي: بياناته كموظف وعقده وأرصدته */
  @Get('me')
  getMyProfile(@CurrentUser() user: CurrentUserData) {
    return this.profileService.getMyProfile(user);
  }
}
