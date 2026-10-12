import { MigrationInterface, QueryRunner } from 'typeorm';

export class BindPosDevices1791821386845 implements MigrationInterface {
  name = 'BindPosDevices1791821386845';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pos_devices" ADD "installationId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_devices" ADD "boundAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "pos_devices" DROP COLUMN "boundAt"`);
    await queryRunner.query(
      `ALTER TABLE "pos_devices" DROP COLUMN "installationId"`,
    );
  }
}
