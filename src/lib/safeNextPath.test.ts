import { describe, expect, it } from 'vitest';
import { safeNextPath } from './safeNextPath';

describe('safeNextPath', () => {
  it('keeps same-site paths and rejects anything that could leave the site', () => {
    expect(safeNextPath('/checkout?plan=pro&period=year')).toBe('/checkout?plan=pro&period=year');
    expect(safeNextPath('//evil.example')).toBeNull();
    expect(safeNextPath('/\\evil.example')).toBeNull();
    expect(safeNextPath('https://evil.example')).toBeNull();
    expect(safeNextPath(null)).toBeNull();
  });
});
