import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * التوصيل من شاشة الكاشير، وشاشة الطيار على جواله:
 *
 * - delivery_orders.source / deviceId: أوردر من لوحة التوصيل أو من الكاشير
 *   (فاتورته صدرت عند البيع).
 * - delivery_agents.accessKeyHash / accessIssuedAt / lastSeenAt: رابط شاشة
 *   الطيار (بصمة المفتاح فقط) وآخر مرة فتحها.
 */

export class DeliveryPosDriver1792094821649 implements MigrationInterface {
  name = 'DeliveryPosDriver1792094821649';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_agents" ADD "accessKeyHash" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_agents" ADD "accessIssuedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_agents" ADD "lastSeenAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" ADD "source" character varying(20) NOT NULL DEFAULT 'dashboard'`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" ADD "deviceId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" DROP COLUMN "deviceId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" DROP COLUMN "source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_agents" DROP COLUMN "lastSeenAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_agents" DROP COLUMN "accessIssuedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_agents" DROP COLUMN "accessKeyHash"`,
    );
  }
}
