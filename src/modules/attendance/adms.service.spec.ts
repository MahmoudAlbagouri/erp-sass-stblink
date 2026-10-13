import { parseAttlogLine } from './adms.service';

describe('parseAttlogLine', () => {
  const line = '1001\t2026-10-13 08:05:00\t0\t1\t0\t0';

  it('reads the device wall-clock time in the device zone', () => {
    // نفس السطر من جهاز في الرياض وجهاز في تونس: لحظتان مختلفتان
    expect(parseAttlogLine(line, 'Asia/Riyadh')?.punchTime.toISOString()).toBe(
      '2026-10-13T05:05:00.000Z',
    );
    expect(parseAttlogLine(line, 'Africa/Tunis')?.punchTime.toISOString()).toBe(
      '2026-10-13T07:05:00.000Z',
    );
  });

  it('extracts pin, status and verify mode', () => {
    expect(
      parseAttlogLine('7\t2026-10-13 17:00:00\t1\t15', 'Asia/Riyadh'),
    ).toMatchObject({
      pin: '7',
      status: 1,
      verify: 15,
    });
  });

  it('keeps the raw id stable across zones so re-uploads stay deduplicated', () => {
    expect(parseAttlogLine(line, 'Asia/Riyadh')?.rawLogId).toBe(
      '1001_2026-10-13080500',
    );
    expect(parseAttlogLine(line, 'Africa/Cairo')?.rawLogId).toBe(
      '1001_2026-10-13080500',
    );
  });

  it('defaults missing status and verify, and rejects unusable lines', () => {
    expect(
      parseAttlogLine('5\t2026-10-13 08:00:00', 'Asia/Riyadh'),
    ).toMatchObject({
      status: 0,
      verify: 1,
    });
    expect(parseAttlogLine('5\tnot-a-date\t0\t1', 'Asia/Riyadh')).toBeNull();
    expect(parseAttlogLine('', 'Asia/Riyadh')).toBeNull();
  });
});
