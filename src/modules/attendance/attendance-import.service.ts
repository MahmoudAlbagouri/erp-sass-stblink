// src/modules/attendance/attendance-import.service.ts
// استيراد بصمات من ملف Excel/CSV صدّره برنامج أي جهاز بصمة — الطريق لأي جهاز
// لا يتصل بالسيرفر مباشرة. خطوتان: معاينة (أعمدة الملف وتخمين معانيها) ثم
// استيراد بالأعمدة التي أكدها المستخدم.
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Workbook, type CellValue } from 'exceljs';
import {
  BiometricDevice,
  DeviceProtocol,
} from './entities/biometric-device.entity';
import { PunchType, VerifyMode } from './entities/attendance-log.entity';
import { User } from '../users/entities/user.entity';
import { type IncomingPunch, PunchIngestService } from './punch-ingest.service';
import { DateOrder, ImportPunchesDto } from './dto/import-punches.dto';
import { assertBranchVisible } from '../branches/branch-scope';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';
import {
  formatWallTime,
  isValidTimezone,
  tenantTimezoneOf,
  zonedTimeToUtc,
} from '../../common/utils/timezone.util';

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 20_000;
const PREVIEW_ROWS = 8;
const MAX_ERRORS = 20;

type Cell = string | number | Date | null;

export interface ImportPreview {
  headerRow: number;
  headers: string[];
  rows: string[][];
  totalRows: number;
  guess: {
    pinColumn: number | null;
    dateTimeColumn: number | null;
    dateColumn: number | null;
    timeColumn: number | null;
    typeColumn: number | null;
    dateOrder: DateOrder;
  };
}

export interface ImportResult {
  total: number;
  imported: number;
  duplicates: number;
  /** بصمات لأرقام غير مربوطة بموظف (تظهر في "أرقام غير مربوطة") */
  unlinked: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

const HEADER_PATTERNS = {
  pin: /^(pin|ac-?no\.?|no\.?|id|user ?id|person ?id|emp(loyee)? ?(no|id|code|number)|enroll(ment)? ?(no|id|number)|badge ?(no|number)?|رقم.*|كود.*|الرقم|المعرف|رقم البصمة)$/i,
  dateTime:
    /^(date ?time|date and time|time ?stamp|check ?time|punch ?time|attendance ?time|التاريخ والوقت|وقت البصمة|الوقت والتاريخ)$/i,
  date: /^(date|day|التاريخ|اليوم)$/i,
  time: /^(time|الوقت|الساعة)$/i,
  type: /^(state|status|type|check ?type|in\/out|attendance ?status|punch ?state|verify ?state|النوع|الحالة|نوع البصمة)$/i,
};

@Injectable()
export class AttendanceImportService {
  constructor(
    @InjectRepository(BiometricDevice)
    private readonly deviceRepo: Repository<BiometricDevice>,
    private readonly dataSource: DataSource,
    private readonly ingest: PunchIngestService,
  ) {}

  async preview(file?: Express.Multer.File): Promise<ImportPreview> {
    const rows = await readRows(file);
    const headerRow = detectHeaderRow(rows);
    const headers =
      headerRow >= 0
        ? rows[headerRow].map((cell) => display(cell))
        : (rows[0] ?? []).map((_, i) => `عمود ${i + 1}`);
    const body = rows.slice(headerRow + 1);
    const guess = guessColumns(headers, body);
    return {
      headerRow,
      headers,
      rows: body.slice(0, PREVIEW_ROWS).map((row) => row.map(display)),
      totalRows: body.length,
      guess: { ...guess, dateOrder: guessDateOrder(body, guess) },
    };
  }

  async import(
    file: Express.Multer.File | undefined,
    dto: ImportPunchesDto,
    user: CurrentUserData,
  ): Promise<ImportResult> {
    const hasDateTime = dto.dateTimeColumn !== undefined;
    const hasSplit =
      dto.dateColumn !== undefined && dto.timeColumn !== undefined;
    if (!hasDateTime && !hasSplit) {
      throw new BadRequestException(
        'حدد عمود التاريخ والوقت، أو عمودي التاريخ والوقت',
      );
    }

    const device = dto.deviceId
      ? await this.deviceRepo.findOneBy({
          id: dto.deviceId,
          tenantId: user.tenantId,
        })
      : null;
    if (dto.deviceId && !device) {
      throw new BadRequestException('الجهاز غير موجود');
    }
    if (device) assertBranchVisible(device.branchId, 'الجهاز غير موجود');

    const zone =
      device && isValidTimezone(device.timezone)
        ? device.timezone
        : await tenantTimezoneOf(this.dataSource.manager, user.tenantId);

    const rows = await readRows(file);
    const headerRow = dto.headerRow ?? detectHeaderRow(rows);
    const body = rows.slice(headerRow + 1);
    const dateOrder = dto.dateOrder ?? 'DMY';
    const now = Date.now();

    const punches: IncomingPunch[] = [];
    const errors: ImportResult['errors'] = [];
    let skipped = 0;
    const fail = (row: number, reason: string) => {
      skipped++;
      if (errors.length < MAX_ERRORS) errors.push({ row, reason });
    };

    body.forEach((row, index) => {
      const rowNumber = headerRow + index + 2; // كما يظهر في Excel
      if (row.every((cell) => cell === null || display(cell) === '')) return;

      const pin = display(row[dto.pinColumn] ?? null).replace(/\.0+$/, '');
      if (!/^[A-Za-z0-9]{1,20}$/.test(pin)) {
        return fail(rowNumber, 'رقم الموظف فارغ أو غير صالح');
      }
      const wall = hasDateTime
        ? toWallTime(row[dto.dateTimeColumn!] ?? null, null, dateOrder)
        : toWallTime(
            row[dto.dateColumn!] ?? null,
            row[dto.timeColumn!] ?? null,
            dateOrder,
          );
      const punchTime = wall ? zonedTimeToUtc(wall, zone) : null;
      if (!wall || !punchTime) {
        return fail(rowNumber, 'التاريخ أو الوقت غير مفهوم');
      }
      if (punchTime.getTime() > now + 5 * 60_000) {
        return fail(rowNumber, 'وقت في المستقبل');
      }
      if (punchTime.getUTCFullYear() < 2000) {
        return fail(rowNumber, 'تاريخ قديم جداً');
      }

      punches.push({
        pin,
        punchTime,
        rawLogId: rawIdFor(device, pin, wall, punchTime),
        punchType:
          dto.typeColumn !== undefined
            ? parsePunchType(row[dto.typeColumn] ?? null)
            : PunchType.CHECK_IN,
        verifyMode: VerifyMode.OTHER,
      });
    });

    const importer = await this.dataSource.getRepository(User).findOne({
      where: { id: user.id },
      select: { username: true, email: true },
    });
    const { saved } = await this.ingest.save(
      {
        tenantId: user.tenantId,
        deviceId: device?.id ?? null,
        sourceKey: device?.serialNumber ?? `IMPORT:${user.tenantId}`,
        createdBy: {
          id: user.id,
          name: importer?.username ?? importer?.email ?? null,
        },
      },
      punches,
    );

    return {
      total: punches.length + skipped,
      imported: saved.length,
      duplicates: punches.length - saved.length,
      unlinked: saved.filter((log) => !log.employeeId).length,
      skipped,
      errors,
    };
  }
}

/**
 * معرّف البصمة كما يصنعه مصدرها الحي، فلا تتكرر بصمة أرسلها الجهاز ثم
 * استوردت من ملفه: ZKTeco (الرقم + الوقت المحلي)، وغيرها (الرقم + اللحظة).
 */
function rawIdFor(
  device: BiometricDevice | null,
  pin: string,
  wall: string,
  punchTime: Date,
): string {
  if (!device || device.protocol === DeviceProtocol.ZK_ADMS) {
    return `${pin}_${wall.replace(/[: ]/g, '')}`;
  }
  return `${pin}_${punchTime.toISOString().slice(0, 19).replace(/[-:T]/g, '')}`;
}

// ═════════════════════════════ قراءة الملف ═════════════════════════════

async function readRows(file?: Express.Multer.File): Promise<Cell[][]> {
  if (!file?.buffer?.length) throw new BadRequestException('الملف مطلوب');
  if (file.size > IMPORT_MAX_BYTES) {
    throw new BadRequestException('حجم الملف أكبر من 5 ميجا');
  }
  const head = file.buffer.subarray(0, 4);
  // ملف Excel القديم (.xls): مكتبتنا لا تقرؤه
  if (head.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) {
    throw new BadRequestException(
      'صيغة xls القديمة غير مدعومة: افتح الملف واحفظه بصيغة xlsx أو csv',
    );
  }

  const rows = head.subarray(0, 2).equals(Buffer.from('PK'))
    ? await readXlsx(file.buffer)
    : readCsv(file.buffer);
  if (rows.length === 0) throw new BadRequestException('الملف فارغ');
  if (rows.length > MAX_ROWS) {
    throw new BadRequestException(
      `الملف أكبر من ${MAX_ROWS} صف: قسّمه على أكثر من ملف`,
    );
  }
  return rows;
}

async function readXlsx(buffer: Buffer): Promise<Cell[][]> {
  const workbook = new Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestException('تعذّرت قراءة ملف Excel');
  }
  const sheet = workbook.worksheets.find((ws) => ws.actualRowCount > 0);
  if (!sheet) return [];
  const rows: Cell[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: Cell[] = [];
    for (let col = 1; col <= row.cellCount; col++) {
      cells.push(fromExcel(row.getCell(col).value));
    }
    rows.push(cells);
  });
  return rows;
}

function fromExcel(value: CellValue): Cell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date || typeof value === 'number') return value;
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    if ('result' in value) return fromExcel(value.result);
    if ('richText' in value) {
      return value.richText
        .map((part) => part.text)
        .join('')
        .trim();
    }
    if ('text' in value) return String(value.text).trim();
  }
  return null;
}

/** CSV بفاصلة أو فاصلة منقوطة أو tab، مع النصوص بين علامتي تنصيص */
function readCsv(buffer: Buffer): Cell[][] {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].reduce((best, candidate) =>
    firstLine.split(candidate).length > firstLine.split(best).length
      ? candidate
      : best,
  );

  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = '';
  let quoted = false;
  const pushField = () => {
    row.push(field.trim() === '' ? null : field.trim());
    field = '';
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      pushField();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      pushField();
      if (row.some((cell) => cell !== null)) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  pushField();
  if (row.some((cell) => cell !== null)) rows.push(row);
  return rows;
}

// ═════════════════════════════ تخمين الأعمدة ═════════════════════════════

/** أول صف (من أول 10) أغلب خلاياه نصوص لا أرقام ولا تواريخ */
function detectHeaderRow(rows: Cell[][]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const texts = rows[i].filter(
      (cell) =>
        typeof cell === 'string' &&
        cell !== '' &&
        !/^\d+([.:/\- ]\d+)*$/.test(cell),
    ).length;
    if (texts >= 2) return i;
  }
  return -1;
}

function guessColumns(headers: string[], body: Cell[][]) {
  const find = (pattern: RegExp) => {
    const index = headers.findIndex((h) => pattern.test(h.trim()));
    return index >= 0 ? index : null;
  };
  let pinColumn = find(HEADER_PATTERNS.pin);
  let dateTimeColumn = find(HEADER_PATTERNS.dateTime);
  let dateColumn = find(HEADER_PATTERNS.date);
  let timeColumn = find(HEADER_PATTERNS.time);
  const typeColumn = find(HEADER_PATTERNS.type);

  // عمود "Time" وحده يحمل التاريخ والوقت في أغلب برامج الأجهزة
  if (dateTimeColumn === null && timeColumn !== null && dateColumn === null) {
    if (body.slice(0, 5).some((row) => hasDateAndTime(row[timeColumn!]))) {
      dateTimeColumn = timeColumn;
      timeColumn = null;
    }
  }
  if (dateTimeColumn === null && (dateColumn === null || timeColumn === null)) {
    const sample = body.slice(0, 5);
    const width = Math.max(0, ...sample.map((row) => row.length));
    for (let col = 0; col < width; col++) {
      if (sample.length && sample.every((row) => hasDateAndTime(row[col]))) {
        dateTimeColumn = col;
        break;
      }
    }
  }
  if (pinColumn === null) {
    const sample = body.slice(0, 5);
    const width = Math.max(0, ...sample.map((row) => row.length));
    for (let col = 0; col < width; col++) {
      if (
        col !== dateTimeColumn &&
        sample.length &&
        sample.every((row) => /^\d{1,12}$/.test(display(row[col] ?? null)))
      ) {
        pinColumn = col;
        break;
      }
    }
  }
  if (dateTimeColumn !== null) {
    dateColumn = null;
    timeColumn = null;
  }
  return { pinColumn, dateTimeColumn, dateColumn, timeColumn, typeColumn };
}

function hasDateAndTime(cell: Cell | undefined): boolean {
  if (cell instanceof Date) return true;
  if (typeof cell === 'number') return cell > 20000 && cell % 1 !== 0;
  return (
    typeof cell === 'string' &&
    /\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}[ T]+\d{1,2}:\d{2}/.test(cell)
  );
}

/** أول جزء أكبر من 12 = يوم أولاً؛ ثانيه أكبر من 12 = شهر أولاً */
function guessDateOrder(
  body: Cell[][],
  guess: { dateTimeColumn: number | null; dateColumn: number | null },
): DateOrder {
  const column = guess.dateTimeColumn ?? guess.dateColumn;
  if (column === null) return 'DMY';
  for (const row of body.slice(0, 200)) {
    const cell = row[column];
    if (typeof cell !== 'string') continue;
    const match = /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})/.exec(cell);
    if (!match) continue;
    if (match[1].length === 4) return 'YMD';
    if (Number(match[1]) > 12) return 'DMY';
    if (Number(match[2]) > 12) return 'MDY';
  }
  return 'DMY';
}

// ═════════════════════════════ القيم ═════════════════════════════

function display(cell: Cell): string {
  if (cell === null) return '';
  if (cell instanceof Date) return formatWallTime(cell, 'UTC');
  return String(cell).trim();
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Excel يخزّن التاريخ "كما يظهر" لحظةً بتوقيت UTC، أو رقماً تسلسلياً */
function excelDate(cell: Cell): Date | null {
  if (cell instanceof Date) return cell;
  if (typeof cell === 'number' && cell > 0 && cell < 80000) {
    return new Date(Math.round((cell - 25569) * 86_400_000));
  }
  return null;
}

function datePart(cell: Cell, order: DateOrder): string | null {
  const date = excelDate(cell);
  if (date && (cell instanceof Date || (cell as number) >= 1)) {
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }
  if (typeof cell !== 'string') return null;
  const match = /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})/.exec(cell.trim());
  if (!match) return null;
  const [a, b, c] = [match[1], match[2], match[3]];
  const [rawYear, month, day] =
    a.length === 4 || order === 'YMD'
      ? [a, b, c]
      : order === 'MDY'
        ? [c, a, b]
        : [c, b, a];
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1) return null;
  return `${year.padStart(4, '0')}-${pad(Number(month))}-${pad(Number(day))}`;
}

function timePart(cell: Cell): string | null {
  const date = excelDate(cell);
  if (date) {
    return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  }
  if (typeof cell !== 'string') return null;
  const match = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|ص|م)?\s*$/i.exec(
    cell.trim(),
  );
  if (!match) return null;
  let hour = Number(match[1]);
  const suffix = match[4]?.toLowerCase();
  if ((suffix === 'pm' || suffix === 'م') && hour < 12) hour += 12;
  if ((suffix === 'am' || suffix === 'ص') && hour === 12) hour = 0;
  if (hour > 23 || Number(match[2]) > 59) return null;
  return `${pad(hour)}:${match[2]}:${match[3] ?? '00'}`;
}

/** "YYYY-MM-DD HH:mm:ss" بساعة الجهاز، من خلية واحدة أو خليتين */
function toWallTime(
  dateCell: Cell,
  timeCell: Cell | null,
  order: DateOrder,
): string | null {
  const day = datePart(dateCell, order);
  const time = timePart(timeCell ?? dateCell);
  return day && time ? `${day} ${time}` : null;
}

function parsePunchType(cell: Cell): PunchType {
  const value = display(cell)
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();
  if (/break.*out|خروج استراحة|^2$/.test(value)) return PunchType.BREAK_OUT;
  if (/break.*in|عودة|^3$/.test(value)) return PunchType.BREAK_IN;
  if (/(overtime|ot).*in|بداية إضافي|^4$/.test(value)) {
    return PunchType.OVERTIME_IN;
  }
  if (/(overtime|ot).*out|نهاية إضافي|^5$/.test(value)) {
    return PunchType.OVERTIME_OUT;
  }
  if (/out|خروج|انصراف|^1$/.test(value)) return PunchType.CHECK_OUT;
  return PunchType.CHECK_IN;
}
