import { Controller, Post, Body, HttpCode, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { apiTag } from '../../config/swagger.config';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshTokenGuard } from './guards/refresh-token.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserData,
} from '../../common/decorators/current-user.decorator';
import { SkipDisclaimer } from '../../common/decorators/skip-disclaimer.decorator';

// ✅ كل راوتات Auth (بما فيها accept-disclaimer و refresh) مستثناة من DisclaimerGuard
@SkipDisclaimer()
@ApiTags(apiTag('AUTH'))
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** تسجيل شركة جديدة مع مديرها (يحدد الدولة والعملة والمنطقة الزمنية) */
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /** تسجيل الدخول بالبريد وكلمة المرور */
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /** تجديد الجلسة بتوكن التجديد (والجلسة لم تُلغَ) */
  @UseGuards(RefreshTokenGuard)
  @Post('refresh')
  refreshTokens(@CurrentUser() user: CurrentUserData) {
    return this.authService.refreshTokens(user.id, user.sessionId);
  }

  /** تسجيل الخروج: يلغي جلسة توكن التجديد على السيرفر */
  @UseGuards(RefreshTokenGuard)
  @Post('logout')
  @HttpCode(204)
  logout(@CurrentUser() user: CurrentUserData) {
    return this.authService.logout(user.id, user.sessionId);
  }

  /** الموافقة على الإقرار وإصدار توكن جديد */
  @UseGuards(JwtAuthGuard)
  @Post('accept-disclaimer')
  acceptDisclaimer(@CurrentUser() user: CurrentUserData) {
    return this.authService.acceptDisclaimer(user);
  }

  /** طلب رابط استعادة كلمة المرور بالبريد */
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  /** تعيين كلمة مرور جديدة برمز الاستعادة */
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
}
