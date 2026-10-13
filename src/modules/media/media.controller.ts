import {
  Controller,
  Post,
  Delete,
  Param,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  Get,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { apiTag } from '../../config/swagger.config';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  isSafePathSegment,
  storageConfig,
} from '../../common/utils/file-upload.utils';
import { FilesService } from '../files/files.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

const SUB_FOLDERS = ['image', 'files'];

/** يرفض أي اسم مجلد/ملف قد يُستخدم للخروج من مجلد uploads (Path Traversal) */
function assertSafeSegment(value: string, label: string): void {
  if (!isSafePathSegment(value)) {
    throw new BadRequestException(`${label} غير صالح`);
  }
}

@ApiTags(apiTag('MEDIA'))
@Controller('media')
@UseGuards(JwtAuthGuard) // ✅ الرفع/العرض/الحذف للمستخدمين المسجلين فقط
export class MediaController {
  constructor(private readonly filesService: FilesService) {}

  /** رفع ملف أو صورة إلى مجلد */
  @Post('upload/:folder')
  @UseInterceptors(FilesInterceptor('files', 10, storageConfig('products')))
  upload(
    @Param('folder') folder: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    assertSafeSegment(folder, 'اسم المجلد');

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

  /** صور مجلد */
  @Get('list/:folder/images')
  async listImages(@Param('folder') folder: string) {
    assertSafeSegment(folder, 'اسم المجلد');
    const images = await this.filesService.getFilesByFolder(`${folder}/image`);
    return {
      success: true,
      data: { images },
    };
  }

  /** ملفات مجلد (غير الصور) */
  @Get('list/:folder/files')
  async listFiles(@Param('folder') folder: string) {
    assertSafeSegment(folder, 'اسم المجلد');
    const files = await this.filesService.getFilesByFolder(`${folder}/files`);
    return {
      success: true,
      data: files,
    };
  }

  /** حذف ملف مرفوع */
  @Delete('delete/:folder/:subFolder/:fileName')
  async remove(
    @Param('folder') folder: string,
    @Param('subFolder') subFolder: string, // سيتم تمرير image أو files
    @Param('fileName') fileName: string,
  ) {
    assertSafeSegment(folder, 'اسم المجلد');
    if (!SUB_FOLDERS.includes(subFolder)) {
      throw new BadRequestException('المجلد الفرعي غير صالح');
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(fileName) || fileName.includes('..')) {
      throw new BadRequestException('اسم الملف غير صالح');
    }

    // المسار الكامل للملف يتضمن المجلد الفرعي
    const folderPath = `${folder}/${subFolder}`;
    const deleted = await this.filesService.deleteFile(folderPath, fileName);

    if (!deleted) throw new BadRequestException('الملف غير موجود');
    return { success: true, message: 'تم الحذف بنجاح' };
  }
}
