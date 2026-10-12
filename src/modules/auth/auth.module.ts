import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';

import { UsersModule } from '../users/users.module';
import { TenantsModule } from '../tenants/tenants.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AccessTokenStrategy } from './strategies/access-token.strategy';
import { RefreshTokenStrategy } from './strategies/refresh-token.strategy';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { DisclaimerGuard } from './guards/disclaimer.guard';
import { SupportSession } from './entities/support-session.entity';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [
    UsersModule,
    TenantsModule,
    PassportModule,
    TypeOrmModule.forFeature([SupportSession]),
    JwtModule.register({}),
    SubscriptionsModule,
  ],
  controllers: [AuthController, SupportController],
  providers: [
    AuthService,
    SupportService,
    AccessTokenStrategy,
    RefreshTokenStrategy,
    { provide: APP_GUARD, useClass: DisclaimerGuard },
  ],
  exports: [AuthService], // ✅ أضف هذه
})
export class AuthModule {}
