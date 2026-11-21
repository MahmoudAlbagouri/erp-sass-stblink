// بيانات لبحوث العمليات: ما لا يُسترجع إن لم يُسجَّل لحظة حدوثه — سبب تسوية
// المخزون، مدة توريد المورد وتاريخ الطلب، موقع مستلم التوصيل، والعرض الذي
// طُبّق على سطر بيع الكاشير. كلها اختيارية ولا تغيّر سلوكاً قائماً.
// انظر docs/operations-research.md.
import { MigrationInterface, QueryRunner } from "typeorm";

export class OperationsResearchData1794000000000 implements MigrationInterface {
    name = 'OperationsResearchData1794000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "stock_movements" ADD "reason" character varying(30)`);
        await queryRunner.query(`ALTER TABLE "suppliers" ADD "leadTimeDays" integer`);
        await queryRunner.query(`ALTER TABLE "purchase_invoices" ADD "orderDate" date`);
        await queryRunner.query(`ALTER TABLE "delivery_orders" ADD "latitude" numeric(9,6)`);
        await queryRunner.query(`ALTER TABLE "delivery_orders" ADD "longitude" numeric(9,6)`);
        await queryRunner.query(`ALTER TABLE "sales_invoice_lines" ADD "promotionId" uuid`);
        await queryRunner.query(`ALTER TABLE "sales_invoice_lines" ADD "promotionSaving" numeric(15,3)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "sales_invoice_lines" DROP COLUMN "promotionSaving"`);
        await queryRunner.query(`ALTER TABLE "sales_invoice_lines" DROP COLUMN "promotionId"`);
        await queryRunner.query(`ALTER TABLE "delivery_orders" DROP COLUMN "longitude"`);
        await queryRunner.query(`ALTER TABLE "delivery_orders" DROP COLUMN "latitude"`);
        await queryRunner.query(`ALTER TABLE "purchase_invoices" DROP COLUMN "orderDate"`);
        await queryRunner.query(`ALTER TABLE "suppliers" DROP COLUMN "leadTimeDays"`);
        await queryRunner.query(`ALTER TABLE "stock_movements" DROP COLUMN "reason"`);
    }

}
