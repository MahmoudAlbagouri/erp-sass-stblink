import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoredFile } from './entities/stored-file.entity';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { FilesCleanupService } from './files-cleanup.service';
import { FileUrlSigner } from './file-url.signer';
import { FileUrlInterceptor } from './file-url.interceptor';

/**
 * الملفات المرفوعة (docs/modules/files.md). عام: أي موديول يربط ملفاً بسجله
 * يتحقق منه بـ FilesService.resolve بلا استيراد.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([StoredFile])],
  controllers: [FilesController],
  providers: [
    FilesService,
    FilesCleanupService,
    FileUrlSigner,
    FileUrlInterceptor,
  ],
  exports: [FilesService, FileUrlSigner, FileUrlInterceptor],
})
export class FilesModule {}
