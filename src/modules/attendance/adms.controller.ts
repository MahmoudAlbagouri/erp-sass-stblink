// src/modules/attendance/adms.controller.ts
// نقاط بروتوكول ADMS / Push التي تتصل بها أجهزة ZKTeco. الردود نص عادي بصيغة
// يفهمها الجهاز، لا JSON؛ والجهاز يُعرَّف برقمه التسلسلي (SN) المسجّل مسبقاً.
import { Controller, Get, Post, Query, Req, Res, Logger } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdmsService } from './adms.service';

/** رد يجعل الجهاز يحتفظ ببياناته ويعيد المحاولة لاحقاً */
const REJECTED = 'ERROR: Device not registered or disabled';

@Controller('iclock')
export class AdmsController {
  private readonly logger = new Logger(AdmsController.name);

  constructor(private readonly admsService: AdmsService) {}

  /** التعريف: الجهاز يطلب إعدادات المزامنة */
  @Get('cdata')
  async handleInitialRequest(
    @Query('SN') sn: string,
    @Query('pushver') pushver: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!sn) return send(res, 400, 'ERROR: Missing SN');

    try {
      const options = await this.admsService.handleDeviceInit(sn, {
        ip: req.ip ?? req.socket?.remoteAddress,
      });
      if (options === null) return send(res, 403, REJECTED);

      this.logger.log(`Device connected: SN=${sn}, pushver=${pushver ?? '-'}`);
      send(res, 200, options);
    } catch (err) {
      this.logger.error(`Failed to handle device init for SN=${sn}`, err);
      send(res, 500, 'ERROR: Internal server error');
    }
  }

  /** رفع البيانات: البصمات (ATTLOG)، وغيرها يُقبل بلا معالجة */
  @Post('cdata')
  async handleAttendanceData(
    @Query('SN') sn: string,
    @Query('table') table: string,
    @Query('Stamp') stamp: string,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ): Promise<void> {
    if (!sn) return send(res, 400, 'ERROR: Missing SN');

    // ما لا نعالجه (سجل العمليات، الصور…) نقرّ باستلامه حتى لا يعيد الجهاز رفعه
    if (table !== 'ATTLOG') return send(res, 200, 'OK: 0');

    try {
      const count = await this.admsService.processAttendanceLogs(
        sn,
        bodyText(req),
        stamp,
      );
      if (count === null) return send(res, 403, REJECTED);

      if (count > 0) {
        this.logger.log(`Saved ${count} attendance record(s) from SN=${sn}`);
      }
      send(res, 200, `OK: ${count}`);
    } catch (err) {
      // غير 200: الجهاز يحتفظ بالدفعة ويعيد رفعها
      this.logger.error(`Failed to process ATTLOG from SN=${sn}`, err);
      send(res, 500, 'ERROR: Failed to process logs');
    }
  }

  /** سؤال الجهاز الدوري عن أوامره (وهو أيضاً نبض الاتصال) */
  @Get('getrequest')
  async handleGetRequest(
    @Query('SN') sn: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!sn) return send(res, 400, 'ERROR: Missing SN');

    try {
      const command = await this.admsService.getPendingCommand(sn);
      send(res, 200, command ?? 'OK');
    } catch (err) {
      this.logger.error(`Failed to get command for SN=${sn}`, err);
      send(res, 200, 'OK');
    }
  }

  /** نتيجة تنفيذ الأوامر */
  @Post('devicecmd')
  async handleDeviceCommandResult(
    @Query('SN') sn: string,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ): Promise<void> {
    if (!sn) return send(res, 400, 'ERROR: Missing SN');

    try {
      const confirmed = await this.admsService.confirmCommands(
        sn,
        bodyText(req),
      );
      if (confirmed > 0) {
        this.logger.log(`SN=${sn} confirmed ${confirmed} command(s)`);
      }
    } catch (err) {
      this.logger.error(`Failed to confirm commands for SN=${sn}`, err);
    }
    send(res, 200, 'OK');
  }

  /** بعض الإصدارات تفحص الاتصال بهذا المسار */
  @Get('ping')
  ping(@Res() res: Response): void {
    send(res, 200, 'OK');
  }
}

function send(res: Response, status: number, body: string): void {
  res.setHeader('Content-Type', 'text/plain');
  res.status(status).send(body);
}

function bodyText(req: RawBodyRequest<Request>): string {
  const body = req.body as unknown;
  if (typeof body === 'string') return body;
  return Buffer.isBuffer(body) ? body.toString('utf-8') : '';
}
