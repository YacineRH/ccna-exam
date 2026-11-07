import { describe, expect, it } from 'vitest';
import { dueLabel } from './revision';

describe('libellé d’échéance', () => {
  it('aujourd’hui, demain, dans N jours', () => {
    const now = new Date(2026, 2, 10, 15, 0);
    expect(dueLabel(new Date(2026, 2, 10, 9, 0).toISOString(), now)).toBe('aujourd’hui');
    expect(dueLabel(new Date(2026, 2, 11, 0, 0).toISOString(), now)).toBe('demain');
    expect(dueLabel(new Date(2026, 2, 14, 0, 0).toISOString(), now)).toBe('dans 4 jours');
    expect(dueLabel(null, now)).toBe('—');
  });
});
