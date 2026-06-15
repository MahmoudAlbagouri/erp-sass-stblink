import {
  Controller,
  Post,
  Delete,
  Param,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
  Get,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { storageConfig } from '../../common/utils/file-upload.utils';
import { FilesService } from '../files/files.service';

@Controller('media')
export class MediaController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload/:folder')
  @UseInterceptors(FilesInterceptor('files', 10, storageConfig('products')))
  upload(
    @Param('folder') folder: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('لم يتم رفع أي ملفات');
    }

    const uploadedData = files.map((file) => {
      // استنتاج المجلد الفرعي بناءً على الـ mimetype
      const subFolder = file.mimetype.startsWith('image/') ? 'image' : 'files';
      return {
        filename: `${folder}/${subFolder}/${file.filename}`,
        mimetype: file.mimetype,
        size: file.size,
        url: `/${folder}/${subFolder}/${file.filename}`,
      };
    });

    return { success: true, message: 'تم الرفع بنجاح', data: uploadedData };
  }

  @Get('list/:folder/images')
  async listImages(@Param('folder') folder: string) {
    const images = await this.filesService.getFilesByFolder(`${folder}/image`);
    return {
      success: true,
      data: { images },
    };
  }

  // استجابة للملفات فقط
  @Get('list/:folder/files')
  async listFiles(@Param('folder') folder: string) {
    const files = await this.filesService.getFilesByFolder(`${folder}/files`);
    return {
      success: true,
      data: files,
    };
  }

  @Delete('delete/:folder/:subFolder/:fileName')
  async remove(
    @Param('folder') folder: string,
    @Param('subFolder') subFolder: string, // سيتم تمرير image أو files
    @Param('fileName') fileName: string,
  ) {
    // المسار الكامل للملف يتضمن المجلد الفرعي
    const folderPath = `${folder}/${subFolder}`;
    const deleted = await this.filesService.deleteFile(folderPath, fileName);

    if (!deleted) throw new BadRequestException('الملف غير موجود');
    return { success: true, message: 'تم الحذف بنجاح' };
  }
}
