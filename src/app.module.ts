// src/app.module.ts
import { Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { I18nModule } from 'nestjs-i18n';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { MailerModule } from '@nestjs-modules/mailer';

// الموديولات الخاصة بك
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module'; // ✅ تم نقله للأعلى
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { RolesModule } from './modules/roles/roles.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { ContractsModule } from './modules/contracts/contracts.module';

// الإعدادات (Config)
import databaseConfig from './config/database.config';
import { i18nConfig } from './config/i18n.config';

// الفلاتر والـ Interceptors
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { UploadInterceptor } from './common/interceptors/upload.interceptor';
import { I18nExceptionFilter } from './common/filters/i18n-exception.filter';
import { LeavesModule } from './modules/leaves/leaves.module';
import { AdvancesModule } from './modules/advances/advances.module';
import { LoansModule } from './modules/loans/loans.module';
import { SalariesModule } from './modules/salaries/salaries.module';
import { MediaModule } from './modules/media/media.module';
import { FilesModule } from './modules/files/files.module';
import { ShiftsModule } from './modules/shifts/shifts.module';
import { ProfileModule } from './modules/profile/profile.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig],
    }),
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.get('MAIL_HOST') || 'smtp.gmail.com',
          port: config.get<number>('MAIL_PORT') || 465,
          secure: true,
          auth: {
            user: config.get('MAIL_USER'),
            pass: config.get('MAIL_PASS'),
          },
        },
        defaults: {
          from: `"No Reply" <${config.get('MAIL_USER')}>`,
        },
      }),
    }),
    DatabaseModule,
    I18nModule.forRoot(i18nConfig),

    // ✅ الترتيب الصحيح: AuthModule أولاً لضمان تسجيل الاستراتيجيات قبل استخدامها
    AuthModule,

    TenantsModule,
    UsersModule,
    PermissionsModule,
    RolesModule,
    EmployeesModule,
    AttendanceModule,
    ContractsModule,
    LeavesModule,
    AdvancesModule,
    LoansModule,
    SalariesModule,
    MediaModule,
    FilesModule,
    ShiftsModule,
    ProfileModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: I18nExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: UploadInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure() {}
}
