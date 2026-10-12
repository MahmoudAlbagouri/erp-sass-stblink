// src/database/data-source.ts
// نقطة دخول أداة TypeORM CLI (أوامر migration:* في package.json).
// التطبيق نفسه لا يستخدم هذا الملف — يأخذ نفس الإعدادات عبر DatabaseModule.
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../config/database.config';

export default new DataSource({
  ...buildDataSourceOptions({ database: process.env.MIGRATION_DB_NAME }),
  // الـ CLI ينفّذ ما نطلبه صراحةً فقط
  migrationsRun: false,
});
