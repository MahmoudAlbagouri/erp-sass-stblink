// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import {
  i18nValidationErrorFactory,
  I18nValidationExceptionFilter,
} from 'nestjs-i18n';
// import { TypeOrmExceptionFilter } from './common/filters/typeorm-exception.filter';
import { NestExpressApplication } from '@nestjs/platform-express';
import { seedSystemOwner } from './database/seeds/system-owner.seed';
import { DataSource } from 'typeorm';
import * as bodyParser from 'body-parser';
import type { NextFunction, Request, Response } from 'express';
import { LOGO_ROUTE } from './modules/tenants/tenant-logo';
import {
  isSwaggerEnabled,
  setupSwagger,
  SWAGGER_PATH,
} from './config/swagger.config';

async function bootstrap() {
  // ✅ rawBody: true مطلوب لـ ADMS قبل أي middleware
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const logger = new Logger('Bootstrap');

  // خلف nginx: عنوان العميل الحقيقي من X-Forwarded-For (يقفل عليه جهاز البصمة)
  app.set('trust proxy', trustProxySetting(process.env.TRUST_PROXY));

  // تشخيص توصيل أجهزة ZKTeco (ADMS_DEBUG=true): كل طلب على /iclock وردّه،
  // ومنها مسارات لا نعالجها (404) تكشف إصدار بروتوكول مختلفاً
  if (process.env.ADMS_DEBUG === 'true') {
    const adms = new Logger('ADMS');
    app.use('/iclock', (req: Request, res: Response, next: NextFunction) => {
      res.on('finish', () =>
        adms.log(
          `${req.method} ${req.originalUrl} from ${req.ip} ` +
            `type=${req.headers['content-type'] ?? '-'} ` +
            `length=${req.headers['content-length'] ?? 0} -> ${res.statusCode}`,
        ),
      );
      next();
    });
  }

  // ZKTeco: نص عادي، وبعض الأجهزة بلا Content-Type أصلاً — يُقرأ الجسم أياً كان
  // نوعه، وإلا وصل فارغاً فرُدّ بـ "OK: 0" وضاعت البصمات. قبل محلل JSON.
  app.use('/iclock', bodyParser.text({ type: () => true, limit: '10mb' }));

  // أجهزة البصمة والبرامج الوسيطة: حتى 1000 بصمة في الطلب
  app.use('/attendance-push', bodyParser.json({ limit: '2mb' }));

  // شعار الشركة صورةً مصغّرة في جسم الطلب: حد أكبر من الافتراضي (100KB)
  app.use(LOGO_ROUTE, bodyParser.json({ limit: '512kb' }));

  // ✅ باقي الـ parsers للمسارات العادية
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));

  // ✅ تفعيل CORS
  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'lang',
      'Accept-Language',
      // هوية شاشة الكاشير (PosDeviceGuard): بدونها يرفض المتصفح طلباتها
      'X-Pos-Device',
      'X-Pos-Key',
      'X-Pos-Installation',
      // هوية شاشة الطيار (DriverGuard)
      'X-Driver-Agent',
      'X-Driver-Key',
    ],
    credentials: true,
  });

  // ✅ إعدادات التحقق من البيانات
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: i18nValidationErrorFactory,
    }),
  );

  // ✅ الفلاتر العامة
  app.useGlobalFilters(
    new I18nValidationExceptionFilter({ detailedErrors: false }),
    // new TypeOrmExceptionFilter(),
  );

  // لا خدمة ملفات ثابتة: المرفوعات (هويات، عقود) تُفتح بروابط موقَّعة مؤقتة
  // عبر GET /files/:id/:name فقط (docs/modules/files.md)

  // ✅ توثيق الـ API (Swagger): مغلق في الإنتاج إلا بـ SWAGGER_ENABLED=true
  const swagger = isSwaggerEnabled();
  if (swagger) setupSwagger(app);

  // ✅ تشغيل سكريبت إنشاء المالك قبل بدء الاستماع للمنفذ
  try {
    const dataSource = app.get(DataSource);
    await seedSystemOwner(dataSource);
    logger.log('System owner seed executed successfully');
  } catch (error) {
    logger.error('Failed to execute system owner seed:', error);
  }

  const port = process.env.PORT || 3002;
  await app.listen(port, '0.0.0.0');
  logger.log(`Application is running on: http://localhost:${port}`);
  if (swagger) {
    logger.log(`API docs: http://localhost:${port}/${SWAGGER_PATH}`);
  }
}

/**
 * TRUST_PROXY: افتراضياً loopback (nginx على نفس السيرفر)؛ رقم = عدد الوسطاء
 * الموثوقين، أو قائمة عناوين/نطاقات، أو false لاتصال مباشر بلا وسيط.
 */
function trustProxySetting(raw?: string): boolean | number | string {
  const value = raw?.trim();
  if (!value) return 'loopback';
  if (value === 'true' || value === 'false') return value === 'true';
  return /^\d+$/.test(value) ? Number(value) : value;
}

bootstrap().catch((err) => {
  console.error('Error starting application:', err);
  process.exit(1);
});
