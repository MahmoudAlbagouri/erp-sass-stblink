import { DataSource, Repository } from 'typeorm';
import { Employee } from '../src/modules/employees/entities/employee.entity';
import { generateEmployeeCode } from '../src/modules/employees/utils/employee-code.util';
import { Tenant } from '../src/modules/tenants/entities/tenant.entity';
import { createTestDataSource, truncateAllTables } from './utils/test-database';

describe('generateEmployeeCode', () => {
  let dataSource: DataSource;
  let employees: Repository<Employee>;

  const createTenant = (companyName: string) =>
    dataSource.getRepository(Tenant).save({ companyName });

  const addEmployee = async (tenantId: string) => {
    const employeeCode = await generateEmployeeCode(employees, tenantId);
    return employees.save(
      employees.create({ fullName: 'موظف تجريبي', employeeCode, tenantId }),
    );
  };

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    employees = dataSource.getRepository(Employee);
  });

  beforeEach(() => truncateAllTables(dataSource));

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it('starts at 0001 with a 3-digit tenant prefix', async () => {
    const tenant = await createTenant('شركة أ');

    const code = await generateEmployeeCode(employees, tenant.id);

    expect(code).toMatch(/^\d{3}0001$/);
  });

  it('increments within the same tenant', async () => {
    const tenant = await createTenant('شركة أ');

    const first = await addEmployee(tenant.id);
    const second = await addEmployee(tenant.id);

    expect(Number(second.employeeCode)).toBe(Number(first.employeeCode) + 1);
  });

  it('numbers each tenant independently', async () => {
    const a = await createTenant('شركة أ');
    const b = await createTenant('شركة ب');
    await addEmployee(a.id);
    await addEmployee(a.id);

    const firstOfB = await generateEmployeeCode(employees, b.id);

    expect(firstOfB.slice(-4)).toBe('0001');
  });

  it('does not reuse the code of a soft-deleted employee', async () => {
    const tenant = await createTenant('شركة أ');
    const first = await addEmployee(tenant.id);
    await employees.softRemove(first);

    const next = await generateEmployeeCode(employees, tenant.id);

    expect(next).not.toBe(first.employeeCode);
  });
});
