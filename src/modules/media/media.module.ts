import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { FilesModule } from '../files/files.module'; // تأكد من المسار الصحيح لموديول الملفات

@Module({
  imports: [
    // استيراد FilesModule ضروري عشان الـ MediaController يقدر يستخدم الـ FilesService
    FilesModule,
  ],
  controllers: [MediaController],
})
export class MediaModule {}
