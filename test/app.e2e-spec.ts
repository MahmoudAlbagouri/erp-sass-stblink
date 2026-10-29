import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * اختبار دخاني للتطبيق كاملاً (كل الموديولات + قاعدة الاختبار):
 * يتأكد أن التطبيق يُقلع وأن الحماية الأساسية تعمل.
 */
describe('App (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects login with wrong credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong-password' });

    expect(res.status).toBe(403);
  });

  it.each([
    ['GET', '/tenants'],
    ['GET', '/employees'],
    ['GET', '/users'],
    ['POST', '/files/employee'],
    ['GET', '/subscriptions/me/access'],
  ])('requires authentication for %s %s', async (method, path) => {
    const server = request(app.getHttpServer());
    const res = await (method === 'POST'
      ? server.post(path)
      : server.get(path));

    expect(res.status).toBe(401);
  });

  it('rejects a forged token', async () => {
    const res = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', 'Bearer not-a-real-token');

    expect(res.status).toBe(401);
  });
});
