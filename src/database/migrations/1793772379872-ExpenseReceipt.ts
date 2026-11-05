// صورة إيصال سند الصرف: ملف في files يشير إليه السند (يُرفع من الجوال لحظة الدفع).
import { MigrationInterface, QueryRunner } from "typeorm";

export class ExpenseReceipt1793772379872 implements MigrationInterface {
    name = 'ExpenseReceipt1793772379872'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "expense_vouchers" ADD "receiptFileId" uuid`);
        await queryRunner.query(`ALTER TABLE "expense_vouchers" ADD CONSTRAINT "FK_edbdc689970a1b88a5a98e472e8" FOREIGN KEY ("receiptFileId") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "expense_vouchers" DROP CONSTRAINT "FK_edbdc689970a1b88a5a98e472e8"`);
        await queryRunner.query(`ALTER TABLE "expense_vouchers" DROP COLUMN "receiptFileId"`);
    }

}
