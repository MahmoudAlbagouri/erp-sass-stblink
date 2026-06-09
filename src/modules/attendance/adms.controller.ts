// src/modules/attendance/adms.controller.ts
import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Req,
  Res,
  Logger,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdmsService } from './adms.service';

/**
 * ✅ بروتوكول ADMS الخاص بـ ZKTeco
 *
 * الجهاز بيتصل بالسيرفر بنفسه عبر HTTP push:
 * 1. GET  /iclock/cdata?SN=xxx            → تسجيل الجهاز وجلب الوقت
 * 2. POST /iclock/cdata?SN=xxx&table=ATTLOG → رفع سجلات البصمات
 * 3. GET  /iclock/getrequest?SN=xxx       → الجهاز يطلب أوامر pending
 * 4. POST /iclock/devicecmd?SN=xxx        → الجهاز يرسل نتيجة تنفيذ أمر
 */
@Controller('iclock')
export class AdmsController {
  private readonly logger = new Logger(AdmsController.name);

  constructor(private readonly admsService: AdmsService) {}

  /**
   * ✅ STEP 1: الجهاز يتصل لأول مرة أو بعد كل فترة
   * GET /iclock/cdata?SN=JHG3255001087&options=all&pushver=2.4.1&language=69
   *
   * الرد المطلوب: نص plain text بصيغة معينة يفهمها الجهاز
   */
  @Get('cdata')
  async handleInitialRequest(
    @Query('SN') sn: string,
    @Query('options') options: string,
    @Query('pushver') pushver: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    this.logger.log(`📡 Device connected: SN=${sn}, pushver=${pushver}`);

    if (!sn) {
      res.status(400).send('ERROR: Missing SN');
      return;
    }

    try {
      const responseBody = await this.admsService.handleDeviceInit(sn, {
        options,
        pushver,
        ip: req.ip ?? req.socket.remoteAddress ?? 'unknown',
      });

      // ✅ الجهاز يتوقع Content-Type: text/plain
      res.setHeader('Content-Type', 'text/plain');
      res.status(200).send(responseBody);
    } catch (err) {
      this.logger.error(`Failed to handle device init for SN=${sn}`, err);
      res.status(500).send('ERROR: Internal server error');
    }
  }

  /**
   * ✅ STEP 2: الجهاز يرسل سجلات البصمات
   * POST /iclock/cdata?SN=xxx&table=ATTLOG&Stamp=xxx
   *
   * Body (plain text, كل سطر سجل واحد):
   * PIN\tDate Time\tStatus\tVerify\tWorkCode\tReserved
   * مثال: 1\t2026-06-08 09:00:00\t0\t1\t0\t0
   */
  @Post('cdata')
  async handleAttendanceData(
    @Query('SN') sn: string,
    @Query('table') table: string,
    @Query('Stamp') stamp: string,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ): Promise<void> {
    if (!sn) {
      res.status(400).send('ERROR: Missing SN');
      return;
    }

    // ✅ نقرأ الـ body كـ text عشان بروتوكول ZKTeco مش JSON
    const rawBody = req.body as string | Buffer;
    const bodyText =
      typeof rawBody === 'string'
        ? rawBody
        : Buffer.isBuffer(rawBody)
          ? rawBody.toString('utf-8')
          : '';

    this.logger.debug(
      `📥 Data from SN=${sn}, table=${table}, rows=${bodyText.split('\n').filter(Boolean).length}`,
    );

    if (table === 'ATTLOG') {
      try {
        const count = await this.admsService.processAttendanceLogs(
          sn,
          bodyText,
          stamp,
        );
        this.logger.log(`✅ Saved ${count} attendance records from SN=${sn}`);
        // ✅ الرد المطلوب من الجهاز بالضبط
        res.setHeader('Content-Type', 'text/plain');
        res.status(200).send(`OK: ${count}`);
      } catch (err) {
        this.logger.error(`Failed to process ATTLOG from SN=${sn}`, err);
        res.status(500).send('ERROR: Failed to process logs');
      }
    } else if (table === 'OPERLOG') {
      // سجلات العمليات (فتح باب، تغيير إعداد..)
      this.logger.debug(`OPERLOG from SN=${sn} - ignored for now`);
      res.setHeader('Content-Type', 'text/plain');
      res.status(200).send('OK: 0');
    } else {
      this.logger.warn(`Unknown table: ${table} from SN=${sn}`);
      res.setHeader('Content-Type', 'text/plain');
      res.status(200).send('OK: 0');
    }
  }

  /**
   * ✅ STEP 3: الجهاز يسأل إذا في أوامر جديدة
   * GET /iclock/getrequest?SN=xxx
   *
   * الرد: أمر واحد في كل مرة أو "OK" لو مافيش
   */
  @Get('getrequest')
  async handleGetRequest(
    @Query('SN') sn: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!sn) {
      res.status(400).send('ERROR: Missing SN');
      return;
    }

    try {
      const command = await this.admsService.getPendingCommand(sn);

      res.setHeader('Content-Type', 'text/plain');
      // لو مافيش أوامر، الجهاز يتوقع "OK" بالضبط
      res.status(200).send(command ?? 'OK');
    } catch (err) {
      this.logger.error(`Failed to get command for SN=${sn}`, err);
      res.status(200).send('OK');
    }
  }

  /**
   * ✅ STEP 4: الجهاز يرسل نتيجة تنفيذ الأمر
   * POST /iclock/devicecmd?SN=xxx
   */
  @Post('devicecmd')
  async handleDeviceCommandResult(
    @Query('SN') sn: string,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ): Promise<void> {
    const rawBody = req.body as string | Buffer;
    const bodyText =
      typeof rawBody === 'string'
        ? rawBody
        : Buffer.isBuffer(rawBody)
          ? rawBody.toString('utf-8')
          : '';

    // الصيغة المتوقعة من الجهاز: C:ID:RETURN_CODE
    // مثال: C:123:0 (0 يعني نجاح)
    const parts = bodyText.split(':');
    if (parts.length >= 2) {
      const commandId = parts[1];
      await this.admsService.confirmCommandExecution(commandId);
      this.logger.log(`✅ Command ${commandId} executed by SN=${sn}`);
    }

    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send('OK');
  }
}
