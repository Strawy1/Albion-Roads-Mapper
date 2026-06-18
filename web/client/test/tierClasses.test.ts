import { describe, it, expect } from 'vitest';
import { getTierClasses } from '../src/utils/colors.js';

describe('getTierClasses', () => {
  it('returns blue-700 for Royal Blue', () => {
    expect(getTierClasses('royalBlue')).toBe('bg-blue-800 border border-blue-400');
  });

  it('returns yellow-700 for Royal Yellow', () => {
    expect(getTierClasses('royalYellow')).toBe('bg-yellow-700/60 border border-yellow-400');
  });

  it('returns red-700 for Royal Red', () => {
    expect(getTierClasses('royalRed')).toBe('bg-red-900/70 border border-red-500');
  });

  it('returns dark gray for Outlands/Roads', () => {
    expect(getTierClasses('outlands')).toBe('bg-[#1f1f1f] border border-gray-500');
    expect(getTierClasses('roads')).toBe('bg-[#1f1f1f] border border-gray-500');
    expect(getTierClasses('roadsHideout')).toBe('bg-[#1f1f1f] border border-gray-500');
  });
});
