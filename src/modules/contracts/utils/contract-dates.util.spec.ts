import { ProbationPeriod } from '../entities/contract.entity';
import {
  calculateContractEndDate,
  calculateProbationEndDate,
} from './contract-dates.util';

describe('calculateProbationEndDate', () => {
  const start = new Date(2026, 0, 15);

  it('adds 3 or 6 months', () => {
    expect(
      calculateProbationEndDate(start, ProbationPeriod.THREE_MONTHS),
    ).toEqual(new Date(2026, 3, 15));
    expect(
      calculateProbationEndDate(start, ProbationPeriod.SIX_MONTHS),
    ).toEqual(new Date(2026, 6, 15));
  });

  it('returns undefined when there is no probation', () => {
    expect(
      calculateProbationEndDate(start, ProbationPeriod.NONE),
    ).toBeUndefined();
    expect(calculateProbationEndDate(start, undefined)).toBeUndefined();
  });
});

describe('calculateContractEndDate', () => {
  const start = new Date(2026, 0, 1);

  it('prefers an explicit end date', () => {
    expect(calculateContractEndDate(start, '2027-06-30', 12)).toEqual(
      new Date('2027-06-30'),
    );
  });

  it('falls back to the duration in months', () => {
    expect(calculateContractEndDate(start, undefined, 12)).toEqual(
      new Date(2027, 0, 1),
    );
  });

  it('returns undefined when neither is given', () => {
    expect(calculateContractEndDate(start)).toBeUndefined();
  });
});
