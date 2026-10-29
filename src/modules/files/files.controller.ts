// src/modules/files/files.controller.ts
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { apiTag } from '../../config/swagger.config';
import {
  CurrentUser,
  type CurrentUserData,
} from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FilesService } from './files.service';
import { FileUrlSigner } from './file-url.signer';
import { MAX_FILE_SIZE, MAX_FILES_PER_UPLOAD } from './file-rules';

@ApiTags(apiTag('FILES'))
@Controller('files')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly signer: FileUrlSigner,
  ) {}

  /** رفع ملف أو أكثر لشركة المستخدم (صور/PDF، 5MB للملف) — يعيد معرّف كل ملف ورابط عرضه */
  @Post(':category')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_UPLOAD, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
      // الأسماء العربية تصل UTF-8 (الافتراضي latin1 يشوّهها)
      defParamCharset: 'utf8',
    }),
  )
  upload(
    @Param('category') category: string,
    @UploadedFiles() uploads: Express.Multer.File[],
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.files.store(uploads, category, user);
  }

  /** عرض ملف أو تحميله برابط موقَّع (الرابط نفسه هو الإذن ويصلح ساعة؛ ?download=1 للتحميل) */
  @Get(':id/:name')
  async serve(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { file, path } = await this.files.openSigned(id, exp, sig);
    const disposition = download ? 'attachment' : 'inline';
    // Content-Type من المحتوى المكتشف عند الرفع (sendFile لا يغيّره إن كان مضبوطاً)
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Cache-Control',
      `private, max-age=${this.signer.remainingSeconds(exp)}`,
    );
    res.sendFile(path, { dotfiles: 'allow' });
  }
}
