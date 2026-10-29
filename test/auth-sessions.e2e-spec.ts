import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { getJwtRefreshSecret } from '../src/config/jwt.config';
import { Plan } from '../src/modules/plans/entities/plan.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { truncateAllTables } from './utils/test-database';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * جلسات الدخول على السيرفر: الخروج يلغي الجلسة فعلاً — توكن التجديد بعده لا
 * يُدخل أحداً، حتى لو بقي في متصفح أو سُرق.
 */
describe('Auth sessions (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  const api = () => request(app.getHttpServer());
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  const credentials = { email: 'admin@nile.test', password: 'secret123' };
  const login = async () =>
    data<Tokens>(await api().post('/auth/login').send(credentials).expect(201));
  const refresh = (token: string) =>
    api().post('/auth/refresh').set(bearer(token));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    await dataSource
      .getRepository(Plan)
      .save({ name: 'FREE', nameAr: 'مجانية', features: [], quotas: {} });
    await api()
      .post('/auth/register')
      .send({
        companyName: 'شركة النيل',
        country: 'EG',
        phone: '010 1234 5678',
        username: 'admin_nile',
        ...credentials,
      })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('refreshes a live session, and refuses it after logout', async () => {
    const tokens = await login();
    const renewed = data<Tokens>(
      await refresh(tokens.refreshToken).expect(201),
    );

    await api()
      .post('/auth/logout')
      .set(bearer(renewed.refreshToken))
      .expect(204);

    // التوكن القديم والمجدَّد كلاهما لنفس الجلسة الملغاة
    await refresh(renewed.refreshToken).expect(401);
    await refresh(tokens.refreshToken).expect(401);
  });

  it('logs out one device only', async () => {
    const laptop = await login();
    const phone = await login();

    await api()
      .post('/auth/logout')
      .set(bearer(laptop.refreshToken))
      .expect(204);

    await refresh(laptop.refreshToken).expect(401);
    await refresh(phone.refreshToken).expect(201);
  });

  it('keeps the session through the disclaimer, and ends all on a password reset', async () => {
    const first = await login();
    const second = await login();

    // الإقرار يجدّد توكنات الجلسة نفسها (لا يفتح جلسة جديدة)
    const accepted = data<Tokens>(
      await api()
        .post('/auth/accept-disclaimer')
        .set(bearer(first.accessToken))
        .expect(201),
    );
    await refresh(accepted.refreshToken).expect(201);

    // استعادة كلمة المرور برمز البريد
    const code = '123456789012';
    await dataSource.getRepository(User).update(
      { email: credentials.email },
      {
        resetPasswordToken: await argon2.hash(code),
        resetPasswordExpires: new Date(Date.now() + 10 * 60 * 1000),
      },
    );
    await api()
      .post('/auth/reset-password')
      .send({ email: credentials.email, code, newPassword: 'newSecret456' })
      .expect(201);

    await refresh(accepted.refreshToken).expect(401);
    await refresh(second.refreshToken).expect(401);
  });

  it('refuses a refresh token issued before sessions existed', async () => {
    const user = await dataSource
      .getRepository(User)
      .findOneByOrFail({ email: credentials.email });
    const legacy = await app
      .get(JwtService)
      .signAsync(
        { sub: user.id, tenantId: user.tenantId },
        { secret: getJwtRefreshSecret(), expiresIn: '7d' },
      );

    await refresh(legacy).expect(401);
  });
});
