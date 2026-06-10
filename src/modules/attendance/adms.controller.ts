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

@Controller('iclock')
export class AdmsController {
  private readonly logger = new Logger(AdmsController.name);

  constructor(private readonly admsService: AdmsService) {}

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
      const payload: {
        options?: string;
        pushver?: string;
        ip?: string;
      } = {
        options,
        pushver,
        ip: req.ip ?? (req.socket && req.socket.remoteAddress) ?? 'unknown',
      };

      const responseBody = await this.admsService.handleDeviceInit(sn, payload);

      res.setHeader('Content-Type', 'text/plain');
      res.status(200).send(responseBody);
    } catch (err) {
      this.logger.error(`Failed to handle device init for SN=${sn}`, err);
      res.status(500).send('ERROR: Internal server error');
    }
  }

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
        res.setHeader('Content-Type', 'text/plain');
        res.status(200).send(`OK: ${count}`);
      } catch (err) {
        this.logger.error(`Failed to process ATTLOG from SN=${sn}`, err);
        res.status(500).send('ERROR: Failed to process logs');
      }
    } else if (table === 'OPERLOG') {
      this.logger.debug(`OPERLOG from SN=${sn} - ignored for now`);
      res.setHeader('Content-Type', 'text/plain');
      res.status(200).send('OK: 0');
    } else {
      this.logger.warn(`Unknown table: ${table} from SN=${sn}`);
      res.setHeader('Content-Type', 'text/plain');
      res.status(200).send('OK: 0');
    }
  }

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
      res.status(200).send(command ?? 'OK');
    } catch (err) {
      this.logger.error(`Failed to get command for SN=${sn}`, err);
      res.status(200).send('OK');
    }
  }

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
