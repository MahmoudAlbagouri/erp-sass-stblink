// test/utils/test-database.ts
// قاعدة بيانات مستقلة لاختبارات التكامل (Postgres حقيقي — نفس محرك الإنتاج).
// تُنشأ تلقائياً عند أول تشغيل، ويُبنى الـ schema فيها بالـ migrations نفسها
// المستخدمة في الإنتاج، فأي migration ناقص أو خاطئ يظهر هنا أولاً.
import 'dotenv/config';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../../src/config/database.config';

/** قاعدة التطبيق الحقيقية كما في .env (قبل أي توجيه لقاعدة الاختبار) */
const REAL_DB_NAME = process.env.DB_NAME;

export const TEST_DB_NAME =
  process.env.DB_NAME_TEST ?? `${process.env.DB_NAME}_test`;

/** حماية: لا نسمح أبداً بتشغيل اختبارات (تمسح البيانات) على قاعدة غير اختبارية */
function assertSafeTestDatabase(): void {
  if (!TEST_DB_NAME.endsWith('_test') || TEST_DB_NAME === REAL_DB_NAME) {
    throw new Error(
      `Refusing to run tests against "${TEST_DB_NAME}": the test database name must end with "_test".`,
    );
  }
}

async function ensureDatabaseExists(): Promise<void> {
  const admin = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: 'postgres',
  });
  await admin.connect();
  try {
    const existing = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [TEST_DB_NAME],
    );
    if (existing.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${TEST_DB_NAME}"`);
    }
  } finally {
    await admin.end();
  }
}

/** اتصال جاهز بقاعدة الاختبار بعد تنفيذ كل الـ migrations */
export async function createTestDataSource(): Promise<DataSource> {
  assertSafeTestDatabase();
  await ensureDatabaseExists();

  const dataSource = new DataSource({
    ...buildDataSourceOptions({ database: TEST_DB_NAME }),
    logging: false,
  });
  await dataSource.initialize();
  return dataSource;
}

/** يمسح بيانات كل الجداول (مع الإبقاء على الـ schema وسجل الـ migrations) */
export async function truncateAllTables(dataSource: DataSource): Promise<void> {
  assertSafeTestDatabase();
  const tables = dataSource.entityMetadatas
    .map((meta) => `"${meta.tableName}"`)
    .join(', ');
  if (tables) {
    await dataSource.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  }
}

/** يجعل AppModule (عبر ConfigModule) يتصل بقاعدة الاختبار — يُستدعى قبل استيراده */
export function useTestDatabaseForApp(): void {
  assertSafeTestDatabase();
  process.env.DB_NAME = TEST_DB_NAME;
}
