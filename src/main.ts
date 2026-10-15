// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import {
  i18nValidationErrorFactory,
  I18nValidationExceptionFilter,
} from 'nestjs-i18n';
// import { TypeOrmExceptionFilter } from './common/filters/typeorm-exception.filter';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { seedSystemOwner } from './database/seeds/system-owner.seed';
import { DataSource } from 'typeorm';
import * as bodyParser from 'body-parser';
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

  // ✅ ZKTeco بيبعت text/plain - لازم يكون قبل الـ JSON parser
  app.use('/iclock', bodyParser.text({ type: '*/*', limit: '10mb' }));

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

  // ✅ الملفات الثابتة
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
  });

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

bootstrap().catch((err) => {
  console.error('Error starting application:', err);
  process.exit(1);
});
