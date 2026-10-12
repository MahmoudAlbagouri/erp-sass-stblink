import { DataSource } from 'typeorm';
import { createTestDataSource } from './utils/test-database';

/**
 * حارس الـ schema: يفشل إذا تغيّر أي Entity بدون migration مقابل.
 * (بعد إيقاف synchronize، نسيان الـ migration يعني عموداً غير موجود في الإنتاج.)
 */
describe('database schema', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it('applies every migration', async () => {
    expect(await dataSource.showMigrations()).toBe(false);
  });

  it('matches the entities exactly (no missing migration)', async () => {
    const pending = await dataSource.driver.createSchemaBuilder().log();
    const queries = pending.upQueries.map((q) => q.query);

    expect(queries).toEqual([]);
  });
});
