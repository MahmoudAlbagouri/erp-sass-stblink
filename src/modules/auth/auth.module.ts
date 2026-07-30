import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from '../users/users.module';
import { TenantsModule } from '../tenants/tenants.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AccessTokenStrategy } from './strategies/access-token.strategy';
import { RefreshTokenStrategy } from './strategies/refresh-token.strategy';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    UsersModule,
    TenantsModule,
    PassportModule,
    TypeOrmModule,
    JwtModule.register({}),
    SubscriptionsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, AccessTokenStrategy, RefreshTokenStrategy],
  exports: [AuthService], // ✅ أضف هذه
})
export class AuthModule {}
