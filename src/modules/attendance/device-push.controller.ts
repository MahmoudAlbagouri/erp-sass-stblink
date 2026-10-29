// src/modules/attendance/device-push.controller.ts
// نقاط تستدعيها أجهزة البصمة غير ZKTeco والبرامج الوسيطة — لا الواجهة. الجهاز
// يُعرَّف بمعرّفه ومفتاحه (في الرابط لـ Hikvision، وفي الترويسة للـ API).
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  ForbiddenException,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import type { Request, Response } from 'express';
import { apiTag } from '../../config/swagger.config';
import { DeviceProtocol } from './entities/biometric-device.entity';
import {
  collectHikvisionEvents,
  DevicePushService,
  type PushResult,
} from './device-push.service';
import { PushPunchesDto } from './dto/push-punches.dto';

/** صورة الحدث المرفقة لا نحفظها: حدود تمنع إغراق الذاكرة */
const HIKVISION_UPLOAD_LIMITS = {
  fileSize: 2 * 1024 * 1024,
  files: 4,
  fields: 20,
  fieldSize: 512 * 1024,
};

@ApiTags(apiTag('DEVICE_PUSH'))
@Controller('attendance-push')
export class DevicePushController {
  private readonly logger = new Logger(DevicePushController.name);

  constructor(private readonly pushService: DevicePushService) {}

  /** فحص الرابط من المتصفح أو من زر "اختبار" في الجهاز */
  @Get('hikvision/:deviceId/:key')
  async hikvisionCheck(
    @Param('deviceId') deviceId: string,
    @Param('key') key: string,
    @Res() res: Response,
  ): Promise<void> {
    const device = await this.pushService.authenticate(
      deviceId,
      key,
      DeviceProtocol.HIKVISION,
    );
    send(res, device ? 200 : 401, device ? 'OK' : 'Unauthorized');
  }

  /**
   * أحداث جهاز Hikvision (HTTP Listening): JSON أو multipart بحقل event_log.
   * يرد 200 على كل حدث مقبول — بصمةً كان أو غيره — فلا يعيد الجهاز إرساله.
   */
  @Post('hikvision/:deviceId/:key')
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: memoryStorage(),
      limits: HIKVISION_UPLOAD_LIMITS,
    }),
  )
  async hikvision(
    @Param('deviceId') deviceId: string,
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const device = await this.pushService.authenticate(
      deviceId,
      key,
      DeviceProtocol.HIKVISION,
    );
    if (!device) return send(res, 401, 'Unauthorized');

    try {
      const result = await this.pushService.receiveHikvision(
        device,
        collectHikvisionEvents(body),
        clientIp(req),
      );
      if (!result) return send(res, 403, 'Forbidden');
      send(res, 200, 'OK');
    } catch (err) {
      // غير 200: الجهاز يحتفظ بالحدث ويعيد إرساله
      this.logger.error(`Failed to process Hikvision event (${deviceId})`, err);
      send(res, 500, 'Error');
    }
  }

  /**
   * بصمات من أي جهاز أو برنامج وسيط: حتى 1000 بصمة في الطلب. الجهاز يُعرَّف
   * بترويستي X-Device-Id و X-Device-Key.
   */
  @Post('api')
  @HttpCode(200)
  async api(
    @Headers('x-device-id') deviceId: string | undefined,
    @Headers('x-device-key') key: string | undefined,
    @Body() dto: PushPunchesDto,
    @Req() req: Request,
  ): Promise<PushResult> {
    const device = await this.pushService.authenticate(
      deviceId,
      key,
      DeviceProtocol.API,
    );
    if (!device) throw new UnauthorizedException('مفتاح الجهاز غير صحيح');

    const result = await this.pushService.receiveApi(
      device,
      dto,
      clientIp(req),
    );
    if (!result) {
      throw new ForbiddenException('الجهاز غير مسموح له من هذا العنوان');
    }
    return result;
  }
}

function send(res: Response, status: number, body: string): void {
  res.setHeader('Content-Type', 'text/plain');
  res.status(status).send(body);
}

function clientIp(req: Request): string | null {
  return req.ip ?? req.socket?.remoteAddress ?? null;
}
