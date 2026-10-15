import { DataSource } from 'typeorm';
import { runInTenantContext } from '../src/common/context/tenant-context';
import { ReportService } from '../src/common/reports/report.service';
import { Tenant } from '../src/modules/tenants/entities/tenant.entity';
import { createTestDataSource, truncateAllTables } from './utils/test-database';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** رأس تقارير PDF بهوية الشركة صاحبة الطلب (اسمها وشعارها) */
describe('report branding', () => {
  let dataSource: DataSource;
  let reports: ReportService;

  /** HTML التقرير كما يُرسل للمتصفح الذي يحوّله PDF */
  const html = async () => {
    const service = reports as unknown as {
      companyBranding: () => Promise<{
        companyName: string;
        logo: string | null;
      } | null>;
      buildHtmlTemplate: (
        rows: unknown[],
        columns: unknown[],
        title: string,
        company: unknown,
      ) => string;
    };
    return service.buildHtmlTemplate(
      [],
      [],
      'تقرير',
      await service.companyBranding(),
    );
  };

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    reports = new ReportService(dataSource);
  });

  beforeEach(() => truncateAllTables(dataSource));

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it("uses the company's name and logo for its own reports", async () => {
    const tenant = await dataSource
      .getRepository(Tenant)
      .save({ companyName: 'مخابز الريف', logo_url: PNG });

    const page = await runInTenantContext(tenant.id, html);

    expect(page).toContain('مخابز الريف');
    expect(page).toContain(`src="${PNG}"`);
    expect(page).not.toContain('STB ERP System');
  });

  it('keeps the company name when no logo was uploaded', async () => {
    const tenant = await dataSource
      .getRepository(Tenant)
      .save({ companyName: 'مخابز الريف' });

    const page = await runInTenantContext(tenant.id, html);

    expect(page).toContain('مخابز الريف');
    expect(page).not.toContain('logo--company"');
  });

  it('falls back to the STB identity outside a company request', async () => {
    expect(await runInTenantContext(null, html)).toContain('STB ERP System');
  });
});
