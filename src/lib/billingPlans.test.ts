import { describe, expect, it } from 'vitest';
import { findPlan, periodSavingsPercent, savingsAmount, savingsPercent } from './billingPlans';

describe('plan savings', () => {
  const standard = findPlan('standard').prices!;
  const pro = findPlan('pro').prices!;

  it('compares a period with paying monthly for the same months', () => {
    expect(savingsAmount(standard, 'month')).toBe(0);
    expect(savingsAmount(standard, 'year')).toBe(1490 * 12 - 14900);
    expect(savingsAmount(pro, 'two_years')).toBe(3990 * 24 - 71800);
  });

  it('rounds to whole percents: yearly 17%, two-year 25%', () => {
    expect(savingsPercent(standard, 'year')).toBe(17);
    expect(savingsPercent(pro, 'year')).toBe(17);
    expect(savingsPercent(standard, 'two_years')).toBe(25);
    expect(savingsPercent(pro, 'two_years')).toBe(25);
    expect(periodSavingsPercent('month')).toBe(0);
    expect(periodSavingsPercent('year')).toBe(17);
    expect(periodSavingsPercent('two_years')).toBe(25);
  });
});
