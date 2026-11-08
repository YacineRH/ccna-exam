import { describe, expect, it } from 'vitest';
import {
  CERTIFICATION_STORAGE_KEY,
  certificationLabel,
  hasModule,
  pickCertification,
  readStoredCertification,
  storeCertification,
} from './certification';

const list = [{ code: 'alpha' }, { code: 'bravo' }];

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const broken = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('pickCertification', () => {
  it('garde le choix mémorisé s’il existe encore', () => {
    expect(pickCertification(list, 'bravo')).toBe('bravo');
  });
  it('se replie sur la première certification', () => {
    expect(pickCertification(list, null)).toBe('alpha');
    expect(pickCertification(list, 'retiree')).toBe('alpha');
  });
  it('renvoie null sans certification', () => {
    expect(pickCertification([], 'alpha')).toBeNull();
  });
});

describe('stockage du choix', () => {
  it('lit et écrit sous une clé dédiée', () => {
    const s = memoryStorage();
    expect(readStoredCertification(s)).toBeNull();
    storeCertification('bravo', s);
    expect(s.data.get(CERTIFICATION_STORAGE_KEY)).toBe('bravo');
    expect(readStoredCertification(s)).toBe('bravo');
  });
  it('ne lève jamais d’exception si le stockage est indisponible', () => {
    expect(readStoredCertification(broken)).toBeNull();
    expect(() => storeCertification('alpha', broken)).not.toThrow();
    expect(readStoredCertification(null)).toBeNull();
  });
});

describe('certificationLabel', () => {
  it('assemble code et code d’examen', () => {
    expect(certificationLabel({ code: 'demo', examCode: 'D-101' })).toBe('DEMO D-101');
  });
});

describe('hasModule', () => {
  const secPlus = { modules: ['exam', 'practice', 'flashcards'] as const };
  it('suit la liste de modules de la certification', () => {
    expect(hasModule({ modules: [...secPlus.modules] }, 'exam')).toBe(true);
    expect(hasModule({ modules: [...secPlus.modules] }, 'cli')).toBe(false);
    expect(hasModule({ modules: [...secPlus.modules] }, 'subnet')).toBe(false);
    expect(hasModule({ modules: ['exam', 'cli', 'challenges'] }, 'challenges')).toBe(true);
  });
  it('sans liste (ancienne API) ou sans certification, seuls les modules par défaut', () => {
    expect(hasModule({}, 'practice')).toBe(true);
    expect(hasModule({}, 'cli')).toBe(false);
    expect(hasModule(null, 'flashcards')).toBe(true);
    expect(hasModule(undefined, 'challenges')).toBe(false);
  });
});

describe('certificationLabel avec nom court', () => {
  it('préfère le nom court au code en capitales', () => {
    expect(certificationLabel({ code: 'security-plus', examCode: 'SY0-701', shortName: 'Security+' })).toBe('Security+ SY0-701');
    expect(certificationLabel({ code: 'ccna', examCode: '200-301' })).toBe('CCNA 200-301');
  });
});
