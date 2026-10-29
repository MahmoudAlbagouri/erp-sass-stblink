// src/modules/attendance/attendance-days.ts
// تقييم "يوم" حضور لموظف — المصدر الوحيد لحالته وساعاته، يستخدمه الملخص
// اليومي والتقرير الشهري وسجل البصمات ومسير الرواتب.
//
// اليوم يُقاس بأول بصمة وآخرها مهما كان نوعها: أغلب الأجهزة تُركَّب بلا زر
// "حضور/انصراف" فتصل كل بصماتها "حضوراً".
import { LeaveType } from '../leaves/entities/leave-request.entity';
import { Shift } from '../shifts/entities/shift.entity';
import { getShiftWindow } from '../shifts/utils/shift-time.util';
import {
  dayKeyInZone,
  dayOffsetInZone,
} from '../../common/utils/timezone.util';
import { AttendanceLog, PunchType } from './entities/attendance-log.entity';

export const DAY_MINUTES = 24 * 60;

/**
 * "يوم الوردية" يبدأ قبل موعد بدايتها بهذه المدة ويستمر 24 ساعة: فكل بصمة
 * تنتمي ليوم واحد بالضبط — من جاء مبكراً أو انصرف متأخراً يُحسب ليومه.
 */
export const SHIFT_DAY_LEAD_MINUTES = 4 * 60;

export type AttendanceStatus =
  | 'present'
  | 'late'
  | 'early_leave'
  | 'late_and_early_leave'
  | 'incomplete' // بصمة واحدة بس (حضور بدون انصراف أو العكس)
  | 'absent'
  | 'on_leave'
  | 'off_day' // يوم راحة أسبوعية بلا عمل
  | 'holiday' // عطلة رسمية بلا عمل
  | 'unclassified' // حضر في يوم عمل لكن بلا وردية يُقاس عليها
  | 'not_employed'; // قبل بداية عمله

export const LEAVE_TYPE_LABELS_AR: Record<LeaveType, string> = {
  [LeaveType.ANNUAL]: 'إجازة سنوية',
  [LeaveType.UNPAID]: 'إجازة بدون راتب',
  [LeaveType.OTHER]: 'إجازة',
};

export interface CalendarHoliday {
  name: string;
  startDate: string;
  endDate: string;
}

export interface CalendarLeave {
  startDate: string;
  endDate: string;
  type: LeaveType;
}

/** ما يلزم لمعرفة نوع كل يوم في فترة، محمَّلاً مرة واحدة */
export interface AttendanceCalendar {
  zone: string;
  weeklyOffDays: number[];
  overtimeMinMinutes: number;
  holidays: CalendarHoliday[];
  /** الإجازات المعتمدة لكل موظف */
  leaves: Map<string, CalendarLeave[]>;
}

export interface DayPlan {
  kind: 'work' | 'off_day' | 'holiday';
  holidayName?: string;
  leave?: CalendarLeave;
}

/** حضور موظف في يوم واحد */
export interface DayAttendance {
  status: AttendanceStatus;
  checkIn: AttendanceLog | null;
  checkOut: AttendanceLog | null;
  /** من أول بصمة لآخرها */
  minutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  /** ما زاد على مدة الوردية (أو كل العمل في يوم راحة/عطلة) */
  overtimeMinutes: number;
  leaveReason?: string;
  holidayName?: string;
  logs: AttendanceLog[];
}

// ─── التواريخ ─────────────────────────────────────────────────────────────

/** يوم الأسبوع لتاريخ YYYY-MM-DD (0 = الأحد) — لا يتأثر بالمنطقة الزمنية */
export function weekdayOf(day: string): number {
  return new Date(`${day.slice(0, 10)}T00:00:00Z`).getUTCDay();
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** تاريخ YYYY-MM-DD موجود فعلاً في التقويم (لا 2026-02-30) */
export function isValidDay(day: string): boolean {
  const date = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(day);
}

/** عدد الأيام من from إلى to (سالب إن سبقه) */
export function dayDiff(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

/** كل الأيام من from إلى to شاملة */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** عمود date (نص YYYY-MM-DD أو Date) إلى مفتاح يوم */
export function toDayKey(value: string | Date): string {
  return typeof value === 'string'
    ? value.slice(0, 10)
    : value.toISOString().slice(0, 10);
}

// ─── يوم الوردية ──────────────────────────────────────────────────────────

function leadMinutes(shift?: Shift | null): number {
  return shift
    ? getShiftWindow(shift).startMinutes - SHIFT_DAY_LEAD_MINUTES
    : 0;
}

/**
 * حدود "اليوم" لموظف: من قبل بداية ورديته بمهلة حتى نفس اللحظة من اليوم
 * التالي (النهاية غير مشمولة). بلا وردية: اليوم التقويمي بتوقيت الشركة.
 */
export function shiftDayRange(
  day: string,
  zone: string,
  shift?: Shift | null,
): { start: Date; end: Date } {
  const lead = leadMinutes(shift);
  return {
    start: dayOffsetInZone(day, lead, zone),
    end: dayOffsetInZone(day, lead + DAY_MINUTES, zone),
  };
}

/** يوم الوردية الذي تنتمي إليه لحظة */
export function shiftDayOf(
  time: Date,
  zone: string,
  shift?: Shift | null,
): string {
  const day = dayKeyInZone(
    new Date(time.getTime() - leadMinutes(shift) * 60_000),
    zone,
  );
  // تصحيح نادر حول تغيير التوقيت الصيفي
  const { start, end } = shiftDayRange(day, zone, shift);
  if (time < start) return addDays(day, -1);
  if (time >= end) return addDays(day, 1);
  return day;
}

// ─── نوع اليوم ────────────────────────────────────────────────────────────

/** يوم عمل، أو راحة أسبوعية، أو عطلة — ومعه إجازة الموظف إن وُجدت */
export function planDay(
  calendar: AttendanceCalendar,
  employeeId: string | undefined,
  shift: Shift | null | undefined,
  day: string,
): DayPlan {
  const leave = employeeId
    ? calendar.leaves
        .get(employeeId)
        ?.find((l) => l.startDate <= day && day <= l.endDate)
    : undefined;
  const holiday = calendar.holidays.find(
    (h) => h.startDate <= day && day <= h.endDate,
  );
  if (holiday) return { kind: 'holiday', holidayName: holiday.name, leave };

  const offDays = shift?.offDays ?? calendar.weeklyOffDays;
  if (offDays.includes(weekdayOf(day))) return { kind: 'off_day', leave };
  return { kind: 'work', leave };
}

// ─── تقييم اليوم ──────────────────────────────────────────────────────────

/** دقائق من `from` إلى `to` (سالبة إن كان `to` قبله) */
export function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60000);
}

/** التأخير والانصراف المبكر مقارنةً بموعدَي الوردية في ذلك اليوم */
function againstShift(
  checkIn: Date,
  checkOut: Date,
  shift: Shift,
  day: string,
  zone: string,
): Pick<DayAttendance, 'status' | 'lateMinutes' | 'earlyLeaveMinutes'> {
  const { startMinutes, endMinutes, isOvernight, graceMinutes } =
    getShiftWindow(shift);

  const shiftStart = dayOffsetInZone(day, startMinutes, zone);
  const shiftEnd = dayOffsetInZone(
    day,
    endMinutes + (isOvernight ? DAY_MINUTES : 0),
    zone,
  );

  const lateRaw = minutesBetween(shiftStart, checkIn);
  const lateMinutes = lateRaw > graceMinutes ? lateRaw : 0;

  const earlyRaw = minutesBetween(checkOut, shiftEnd);
  const earlyLeaveMinutes = earlyRaw > graceMinutes ? earlyRaw : 0;

  let status: AttendanceStatus = 'present';
  if (lateMinutes > 0 && earlyLeaveMinutes > 0) status = 'late_and_early_leave';
  else if (lateMinutes > 0) status = 'late';
  else if (earlyLeaveMinutes > 0) status = 'early_leave';

  return { status, lateMinutes, earlyLeaveMinutes };
}

/**
 * يلخّص بصمات موظف في يوم واحد (مرتبة زمنياً وضمن حدود يومه). بلا بصمات:
 * إجازة معتمدة، ثم عطلة، ثم راحة أسبوعية، وإلا غياب. العمل في يوم راحة أو
 * عطلة إضافي كله.
 */
export function evaluateDay(
  dayLogs: AttendanceLog[],
  shift: Shift | null | undefined,
  day: string,
  zone: string,
  plan: DayPlan,
  overtimeMinMinutes: number,
): DayAttendance {
  const base: DayAttendance = {
    status: 'absent',
    checkIn: null,
    checkOut: null,
    minutes: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    holidayName: plan.holidayName,
    logs: dayLogs,
  };

  const leaveLog = dayLogs.find((l) => l.punchType === PunchType.LEAVE);
  if (leaveLog) {
    return { ...base, status: 'on_leave', leaveReason: leaveLog.leaveReason };
  }

  const punches = dayLogs.filter((l) => l.punchType !== PunchType.LEAVE);
  if (punches.length === 0) {
    if (plan.leave) {
      return {
        ...base,
        status: 'on_leave',
        leaveReason: LEAVE_TYPE_LABELS_AR[plan.leave.type],
      };
    }
    if (plan.kind === 'holiday') return { ...base, status: 'holiday' };
    if (plan.kind === 'off_day') return { ...base, status: 'off_day' };
    return base;
  }

  const checkIn = punches[0];
  const checkOut = punches[punches.length - 1];
  const minutes = minutesBetween(checkIn.punchTime, checkOut.punchTime);
  const worked = { ...base, checkIn, checkOut, minutes };
  if (punches.length < 2) return { ...worked, status: 'incomplete' };

  const counted = (extra: number) => (extra >= overtimeMinMinutes ? extra : 0);
  if (plan.kind !== 'work') {
    return { ...worked, status: 'present', overtimeMinutes: counted(minutes) };
  }
  if (!shift) return { ...worked, status: 'unclassified' };

  const { durationMinutes } = getShiftWindow(shift);
  return {
    ...worked,
    ...againstShift(checkIn.punchTime, checkOut.punchTime, shift, day, zone),
    overtimeMinutes: counted(Math.max(0, minutes - durationMinutes)),
  };
}

/** ساعات بخانتين عشريتين */
export function toHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}
