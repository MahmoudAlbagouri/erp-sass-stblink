// src/app.module.ts
import { Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { I18nModule } from 'nestjs-i18n';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { MailerModule } from '@nestjs-modules/mailer';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';

// الموديولات الخاصة بك
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { RolesModule } from './modules/roles/roles.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { SettlementsModule } from './modules/settlements/settlements.module';

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
import { QuotationModule } from './modules/quotation/quotation.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { PlansModule } from './modules/plans/plans.module';
import { BonusesModule } from './modules/bonuses/bonuses.module';
import { DeductionsModule } from './modules/deduction/deduction.module';
import { EOSModule } from './modules/eos/eos.module';
import { ResignationsModule } from './modules/resignations/resignations.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    // The package's typings are not resolved by the ESLint type checker.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    EventEmitterModule.forRoot(), // ✅ تم إضافته لتفعيل الـ Event Listeners
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
    QuotationModule,
    PayrollModule,
    SettlementsModule,
    SubscriptionsModule,
    PlansModule,
    BonusesModule,
    DeductionsModule,
    EOSModule,
    ResignationsModule,
    NotificationsModule,
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
