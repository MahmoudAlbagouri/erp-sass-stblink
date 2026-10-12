// يُحمَّل قبل ملفات اختبار الـ e2e (setupFiles): يوجّه التطبيق لقاعدة الاختبار
// قبل أن يقرأ ConfigModule قيمة DB_NAME.
import { useTestDatabaseForApp } from './test-database';

useTestDatabaseForApp();
