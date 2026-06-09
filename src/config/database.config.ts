// src/config/database.config.ts
import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export default registerAs(
  'database',
  (): TypeOrmModuleOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    synchronize: true,
    logging: process.env.NODE_ENV === 'development',

    // ✅ الحل الجذري: يمنع TypeORM من إرسال SET TIME ZONE query منفصلة
    // عند تعيينه لـ 'Z' يتعامل معه كـ UTC ولا يحتاج لإرسال query إضافية
    // NOTE: `timezone` is not a known TypeOrmModuleOptions property for Postgres,
    // so pass it inside `extra` which is forwarded to the DB driver.
    extra: {
      timezone: 'Z',
      max: 10,
      min: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      application_name: 'saas-erp',
    },

    connectTimeoutMS: 10000,
  }),
);
