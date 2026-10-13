// src/modules/pos/pos-device.controller.ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { apiTag } from '../../config/swagger.config';
import { PosDeviceBootstrapQueryDto, PosDeviceSyncDto } from './dto/pos.dto';
import {
  PosContext,
  PosDeviceGuard,
  type PosDeviceContext,
} from './guards/pos-device.guard';
import { PosService } from './pos.service';

/**
 * ما تطلبه شاشة الكاشير في الخلفية وهي تبيع: فحص الاتصال، سحب الأصناف
 * والأسعار، ورفع ما بيع.
 *
 * يُصادَق بمفتاح الجهاز لا بجلسة مستخدم (انظر PosDeviceGuard): الشاشة تعمل
 * أياماً بلا إنترنت، والرفع عند عودته لا ينتظر أحداً ليسجّل دخوله. ربط الشاشة
 * أول مرة وإدارة الأجهزة يبقيان بجلسة مستخدم في PosController.
 */
@ApiTags(apiTag('POS_DEVICE'))
@Controller('pos/device')
@UseGuards(PosDeviceGuard)
export class PosDeviceController {
  constructor(private readonly pos: PosService) {}

  /** فحص الاتصال — وهو أيضاً ما يُعلم الشاشة أن اشتراكها ما زال سارياً */
  @Get('ping')
  ping() {
    return { serverTime: new Date().toISOString() };
  }

  /** الأصناف والأسعار والعملاء والكاشيرات (كلها أو ما تغيّر منذ `since`) */
  @Get('bootstrap')
  bootstrap(
    @Query() query: PosDeviceBootstrapQueryDto,
    @PosContext() context: PosDeviceContext,
  ) {
    return this.pos.bootstrapDevice(context.device, query.since);
  }

  /** رفع طابور الشاشة: ورديات ومبيعات ومرتجعات تمّت محلياً */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  sync(@Body() dto: PosDeviceSyncDto, @PosContext() context: PosDeviceContext) {
    return this.pos.syncDevice(context.device, dto.operations, {
      id: context.userId,
      canReturn: context.canReturn,
    });
  }

  /** فاتورة برقمها المطبوع: لاختيار ما يُرجَع منها */
  @Get('invoices/:number')
  lookupInvoice(
    @Param('number') number: string,
    @PosContext() context: PosDeviceContext,
  ) {
    return this.pos.lookupInvoice(number, context.device.tenantId);
  }
}
