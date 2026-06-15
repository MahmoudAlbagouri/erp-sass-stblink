import { Module, Global } from '@nestjs/common';
import { FilesService } from './files.service';

// جعل الموديول Global اختياري، لكنه يسهل عليك استخدامه في كل مكان
// دون الحاجة لعمل Import في كل موديول فرعي.
@Global()
@Module({
  providers: [FilesService],
  exports: [FilesService], // ضروري جداً لتصدير الخدمة للموديولات الأخرى
})
export class FilesModule {}
