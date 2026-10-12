// src/config/database.config.ts
import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'path';
import { DataSourceOptions } from 'typeorm';

/**
 * المصدر الوحيد لإعدادات الاتصال — يستخدمه التطبيق (TypeOrmModule) وأداة الـ
 * migrations (src/database/data-source.ts) والاختبارات، حتى لا يختلف الـ schema
 * بينها.
 *
 * ⚠️ الجداول تُدار بالـ migrations فقط (src/database/migrations):
 * `synchronize` معطّل دائماً لأنه يعدّل/يحذف أعمدة تلقائياً وقد يُتلف بيانات
 * مالية ومخزنية. لأي تغيير في Entity:  npm run migration:generate -- <name>
 */
export function buildDataSourceOptions(
  overrides: { database?: string } = {},
): DataSourceOptions {
  return {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: overrides.database ?? process.env.DB_NAME,
    entities: [join(__dirname, '..', '**', '*.entity{.ts,.js}')],
    migrations: [join(__dirname, '..', 'database', 'migrations', '*{.ts,.js}')],
    migrationsTableName: 'migrations',
    synchronize: false,
    // الـ migrations المعلّقة تُنفَّذ تلقائياً عند تشغيل التطبيق
    migrationsRun: true,
    logging: process.env.NODE_ENV === 'development',

    // ✅ يمنع TypeORM من إرسال SET TIME ZONE query منفصلة: القيمة 'Z' = UTC.
    // `timezone` ليست خاصية معروفة لـ Postgres في TypeORM، فتُمرَّر عبر `extra`
    // التي تصل مباشرة للـ driver.
    extra: {
      timezone: 'Z',
      max: 10,
      min: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      application_name: 'saas-erp',
    },

    connectTimeoutMS: 10000,
  };
}

export default registerAs(
  'database',
  (): TypeOrmModuleOptions => buildDataSourceOptions(),
);
