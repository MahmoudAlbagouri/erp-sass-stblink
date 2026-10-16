// src/modules/delivery/driver.controller.ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { apiTag } from '../../config/swagger.config';
import { DeliveryService } from './delivery.service';
import { CurrentDriver, DriverGuard } from './driver.guard';
import { DriverSyncDto, FailDeliveryOrderDto } from './dto/delivery.dto';
import type { DeliveryAgent } from './entities/delivery.entity';

/**
 * شاشة الطيار على جواله: أوردراته، واستلامها، وتسليمها أو تسجيل عدم تسليمها.
 *
 * يُصادَق برابط الطيار لا بجلسة مستخدم (انظر DriverGuard)، ولا يرى إلا
 * أوردراته.
 */
@ApiTags(apiTag('DELIVERY_DRIVER'))
@Controller('delivery/driver')
@UseGuards(DriverGuard)
export class DriverController {
  constructor(private readonly delivery: DeliveryService) {}

  /** أوردرات الطيار المفتوحة وما أنهاه اليوم، وما معه من مال */
  @Get('board')
  board(@CurrentDriver() driver: DeliveryAgent) {
    return this.delivery.driverBoard(driver);
  }

  /** استلم الأوردر وخرج به (أوردر لوحة التوصيل: تصدر فاتورته الآن) */
  @Post('orders/:id/pickup')
  @HttpCode(HttpStatus.OK)
  async pickup(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentDriver() driver: DeliveryAgent,
  ) {
    await this.delivery.assertDriverOrder(driver, id);
    return this.delivery.dispatch(id, driver.tenantId);
  }

  /** سلّم الأوردر للعميل */
  @Post('orders/:id/deliver')
  @HttpCode(HttpStatus.OK)
  async deliver(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentDriver() driver: DeliveryAgent,
  ) {
    await this.delivery.assertDriverOrder(driver, id);
    return this.delivery.deliver(id, driver.tenantId);
  }

  /** لم يُسلَّم (سبب إجباري): مرتجع كامل وتعود البضاعة */
  @Post('orders/:id/fail')
  @HttpCode(HttpStatus.OK)
  async fail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FailDeliveryOrderDto,
    @CurrentDriver() driver: DeliveryAgent,
  ) {
    await this.delivery.assertDriverOrder(driver, id);
    return this.delivery.fail(id, dto, driver.tenantId);
  }

  /** رفع ما سجّله الطيار بلا إنترنت بترتيبه — نتيجة لكل عملية، وإعادة الرفع لا تكررها */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  sync(@Body() dto: DriverSyncDto, @CurrentDriver() driver: DeliveryAgent) {
    return this.delivery.syncDriver(driver, dto.operations);
  }
}
