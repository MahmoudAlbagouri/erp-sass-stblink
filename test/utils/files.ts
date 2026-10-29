// test/utils/files.ts
// خدمة الملفات الحقيقية لاختبارات التكامل التي تبني خدماتها يدوياً.
import { DataSource } from 'typeorm';
import { StoredFile } from '../../src/modules/files/entities/stored-file.entity';
import { FilesService } from '../../src/modules/files/files.service';
import { FileUrlSigner } from '../../src/modules/files/file-url.signer';

export const createFilesService = (dataSource: DataSource): FilesService =>
  new FilesService(dataSource.getRepository(StoredFile), new FileUrlSigner());
