// src/modules/contracts/utils/contract-dates.util.ts
import { addMonths } from 'date-fns';
import { ProbationPeriod } from '../entities/contract.entity';

const PROBATION_MONTHS: Partial<Record<ProbationPeriod, number>> = {
  [ProbationPeriod.THREE_MONTHS]: 3,
  [ProbationPeriod.SIX_MONTHS]: 6,
};

/** تاريخ نهاية فترة التجربة، أو undefined إذا لم توجد فترة تجربة */
export function calculateProbationEndDate(
  startDate: Date,
  probationPeriod?: ProbationPeriod,
): Date | undefined {
  const months = probationPeriod && PROBATION_MONTHS[probationPeriod];
  return months ? addMonths(startDate, months) : undefined;
}

/** تاريخ نهاية العقد: المُدخل يدوياً أولاً، وإلا يُحسب من المدة بالشهور */
export function calculateContractEndDate(
  startDate: Date,
  endDate?: string | Date,
  contractDurationMonths?: number,
): Date | undefined {
  if (endDate) return new Date(endDate);
  if (contractDurationMonths)
    return addMonths(startDate, contractDurationMonths);
  return undefined;
}
