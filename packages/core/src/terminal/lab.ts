import { z } from 'zod';
import { DIFFICULTIES } from '../certification.js';
import { normalizeCommand } from '../cli.js';
import { parseIpv4 } from '../ipv4.js';
import { TerminalDevice, type ExecResult } from './device.js';
import type { TerminalProfile } from './profile.js';

/**
 * Un lab : un énoncé, une topologie, un ou plusieurs équipements simulés dans leur état de départ,
 * des objectifs vérifiés sur l'état (ou l'historique) des équipements, trois indices, une solution.
 * La solution, l'explication et le détail des objectifs ne quittent jamais le serveur avant la fin.
 */

const textOrList = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

const coversSchema = z.object({
  /** Adresse qui doit être couverte par le couple (adresse, masque générique ou masque) capturé. */
  address: z.string().refine((a) => parseIpv4(a) !== null, 'adresse IPv4 attendue'),
  /** Groupes de l'expression qui portent l'adresse et le masque (1 et 2 par défaut). */
  groups: z.tuple([z.number().int().min(1), z.number().int().min(1)]).default([1, 2]),
  /** Le second groupe est un masque de sous-réseau plutôt qu'un masque générique. */
  mask: z.boolean().default(false),
});

const scope = {
  /** Équipement ; facultatif s'il n'y en a qu'un. */
  device: z.string().optional(),
  /** Section exacte (`interface GigabitEthernet0/1`) ; configuration globale si absent. */
  section: z.string().optional(),
  /** Ou : expression des sections visées (`^line vty 0 (4|15)$`), insensible à la casse. */
  sectionPattern: z.string().optional(),
  /** Avec `sectionPattern` : une section qui convient suffit (`any`, défaut) ou toutes (`all`). */
  sections: z.enum(['any', 'all']).default('any'),
};

export type LabCheck =
  | { type: 'line'; device?: string; section?: string; sectionPattern?: string; sections: 'any' | 'all'; line: string | string[]; absent: boolean }
  | {
      type: 'regex';
      device?: string;
      section?: string;
      sectionPattern?: string;
      sections: 'any' | 'all';
      pattern: string;
      absent: boolean;
      caseSensitive?: boolean;
      covers?: z.infer<typeof coversSchema>;
    }
  | { type: 'section'; device?: string; section?: string; sectionPattern?: string; absent: boolean }
  | { type: 'sequence'; device?: string; section?: string; sectionPattern?: string; sections: 'any' | 'all'; patterns: string[]; absent?: boolean }
  | { type: 'command'; device?: string; mode?: string; section?: string; command: string | string[]; afterLastChange?: boolean; after?: string[] }
  | { type: 'all'; checks: LabCheck[] }
  | { type: 'any'; checks: LabCheck[] };

export const labCheckSchema: z.ZodType<LabCheck, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.discriminatedUnion('type', [
    /** Une ligne de configuration présente (ou absente), comparée après normalisation (abréviations, casse). */
    z.object({ type: z.literal('line'), ...scope, line: textOrList, absent: z.boolean().default(false) }),
    /** Une ligne qui correspond à une expression régulière (insensible à la casse). */
    z.object({
      type: z.literal('regex'),
      ...scope,
      pattern: z.string().min(1),
      absent: z.boolean().default(false),
      /** Respecter la casse (nom de VLAN imposé en majuscules…). */
      caseSensitive: z.boolean().optional(),
      covers: coversSchema.optional(),
    }),
    /** Une section existe (ou n'existe pas, avec `absent`), même vide : pool DHCP, ACL nommée, VLAN… */
    z.object({
      type: z.literal('section'),
      device: z.string().optional(),
      section: z.string().optional(),
      sectionPattern: z.string().optional(),
      absent: z.boolean().default(false),
    }),
    /** Des lignes dans cet ordre (pas forcément consécutives) : une expression par ligne, insensibles à la casse. */
    z.object({
      type: z.literal('sequence'),
      ...scope,
      patterns: z.array(z.string().min(1)).min(2),
      /** Vrai si cet ordre ne se trouve pas (aucun refus avant l'autorisation, par exemple). */
      absent: z.boolean().default(false),
    }),
    /** Une commande saisie avec succès (n'importe quand), dans un mode et une section donnés. */
    z.object({
      type: z.literal('command'),
      device: z.string().optional(),
      mode: z.string().optional(),
      section: z.string().optional(),
      command: textOrList,
      /** La commande doit venir après la dernière modification de la configuration (sauvegarde). */
      afterLastChange: z.boolean().optional(),
      /**
       * La commande doit venir après la dernière saisie réussie de chacune de ces commandes (mêmes mode et
       * section) : une réactivation après la correction, pas avant.
       */
      after: z.array(z.string().min(1)).optional(),
    }),
    z.object({ type: z.literal('all'), checks: z.array(labCheckSchema).min(1) }),
    z.object({ type: z.literal('any'), checks: z.array(labCheckSchema).min(1) }),
  ]),
) as z.ZodType<LabCheck, z.ZodTypeDef, unknown>;

const deviceSchema = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9-]*$/),
  type: z.string().min(1),
  interfaces: z.array(z.string().min(1)).min(1),
  startupConfig: z.string().default(''),
});

const commandsByDevice = z.array(z.object({ device: z.string().min(1), commands: z.array(z.string()).min(1) })).min(1);

/** Genre d'un lab : un lab guidé (avec indices), ou un challenge chronométré (sans indice, fin automatique). */
export const LAB_KINDS = ['lab', 'challenge'] as const;
export type LabKind = (typeof LAB_KINDS)[number];

/**
 * Réglages d'un challenge. `build` : configuration à faire ; `troubleshoot` : la configuration de départ
 * contient des pannes (`faults`, révélées à la fin) que les objectifs demandent de corriger.
 */
const challengeSchema = z.object({
  /** Temps cible, en minutes : le temps à battre. */
  targetMinutes: z.number().int().min(1).max(60),
  /** Échéance, en minutes : la session se termine d'elle-même, contrôlée côté serveur. */
  timeLimitMinutes: z.number().int().min(1).max(120),
  mode: z.enum(['build', 'troubleshoot']),
  /** Pannes semées dans la configuration de départ (mode dépannage), une phrase chacune. */
  faults: z.array(z.string().min(10)).default([]),
});
export type ChallengeSettings = z.infer<typeof challengeSchema>;

export const labSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9.-]+$/),
    kind: z.enum(LAB_KINDS).default('lab'),
    certification: z.string().min(1),
    domain: z.string().min(1),
    subtopic: z.string().min(1),
    difficulty: z.enum(DIFFICULTIES),
    title: z.string().min(5).max(120),
    /** Énoncé : contexte et consignes, sans la solution. */
    statement: z.string().min(40),
    /** Topologie (exhibit) : schéma texte et plan d'adressage. */
    topology: z.string().min(10),
    /** Profil de terminal (packages/content/data/labs/<certification>/profile.json). */
    profile: z.string().min(1),
    devices: z.array(deviceSchema).min(1).max(4),
    objectives: z
      .array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/), description: z.string().min(10), check: labCheckSchema }))
      .min(1)
      .max(15),
    /** Trois indices, du plus vague au plus précis ; aucun ne donne toute la solution. Aucun pour un challenge. */
    hints: z.array(z.string().min(10)).max(3).default([]),
    /** Réglages d'un challenge (obligatoires avec `kind: challenge`, interdits sinon). */
    challenge: challengeSchema.optional(),
    solution: commandsByDevice,
    /** Autres façons valides de réussir, chacune complète : elles doivent atteindre tous les objectifs. */
    variants: z.array(z.object({ description: z.string().min(5), solution: commandsByDevice })).default([]),
    /** Erreurs classiques qui ne doivent pas réussir : `failing` liste les objectifs qui restent ouverts. */
    pitfalls: z
      .array(z.object({ description: z.string().min(5), solution: commandsByDevice, failing: z.array(z.string()).min(1) }))
      .default([]),
    explanation: z.string().min(40),
    reference: z.string().min(5),
    /** Durée indicative, en minutes. */
    estimatedMinutes: z.number().int().min(1).max(120).default(10),
  })
  .superRefine((lab, ctx) => {
    if (lab.kind === 'lab') {
      if (lab.hints.length !== 3) ctx.addIssue({ code: 'custom', message: 'un lab a exactement 3 indices' });
      if (lab.challenge) ctx.addIssue({ code: 'custom', message: 'challenge réservé à kind: challenge' });
    } else {
      if (lab.hints.length) ctx.addIssue({ code: 'custom', message: 'un challenge n’a pas d’indice' });
      const c = lab.challenge;
      if (!c) ctx.addIssue({ code: 'custom', message: 'challenge (temps cible, échéance, mode) attendu' });
      else {
        if (c.timeLimitMinutes < c.targetMinutes) ctx.addIssue({ code: 'custom', message: 'l’échéance précède le temps cible' });
        if (c.mode === 'troubleshoot') {
          if (!c.faults.length) ctx.addIssue({ code: 'custom', message: 'un challenge de dépannage décrit ses pannes (faults)' });
          if (!lab.devices.some((d) => d.startupConfig.trim())) ctx.addIssue({ code: 'custom', message: 'un challenge de dépannage part d’une configuration' });
          if (c.faults.length > lab.objectives.length) ctx.addIssue({ code: 'custom', message: 'plus de pannes que d’objectifs' });
        } else if (c.faults.length) ctx.addIssue({ code: 'custom', message: 'faults réservé au mode troubleshoot' });
      }
    }
    const devices = new Set(lab.devices.map((d) => d.id));
    if (devices.size !== lab.devices.length) ctx.addIssue({ code: 'custom', message: 'équipement en double' });
    const ids = new Set(lab.objectives.map((o) => o.id));
    if (ids.size !== lab.objectives.length) ctx.addIssue({ code: 'custom', message: 'objectif en double' });
    const checkDevices = (c: LabCheck, where: string) => {
      if (c.type === 'all' || c.type === 'any') {
        c.checks.forEach((x) => checkDevices(x, where));
        return;
      }
      if (c.device === undefined && lab.devices.length > 1) ctx.addIssue({ code: 'custom', message: `${where} : équipement à préciser` });
      if (c.device !== undefined && !devices.has(c.device)) ctx.addIssue({ code: 'custom', message: `${where} : équipement inconnu ${c.device}` });
      if (c.type === 'section' && c.section === undefined && c.sectionPattern === undefined) {
        ctx.addIssue({ code: 'custom', message: `${where} : section ou sectionPattern attendu` });
      }
      if (c.type !== 'command' && c.section !== undefined && c.sectionPattern !== undefined) {
        ctx.addIssue({ code: 'custom', message: `${where} : section ou sectionPattern, pas les deux` });
      }
    };
    for (const o of lab.objectives) checkDevices(o.check, o.id);
    const sets = [{ name: 'solution', solution: lab.solution }, ...lab.variants.map((v) => ({ name: v.description, solution: v.solution })), ...lab.pitfalls.map((p) => ({ name: p.description, solution: p.solution }))];
    for (const s of sets) for (const step of s.solution) if (!devices.has(step.device)) ctx.addIssue({ code: 'custom', message: `${s.name} : équipement inconnu ${step.device}` });
    for (const p of lab.pitfalls) for (const f of p.failing) if (!ids.has(f)) ctx.addIssue({ code: 'custom', message: `${p.description} : objectif inconnu ${f}` });
  });

export type Lab = z.infer<typeof labSchema>;
export type LabInput = z.input<typeof labSchema>;

export function parseLab(input: unknown): Lab {
  return labSchema.parse(input);
}

/** Ce que le navigateur reçoit d'un lab avant la fin : jamais la solution, ni le détail des objectifs. */
export interface PublicLab {
  slug: string;
  kind: LabKind;
  /** Challenge : temps cible, échéance et mode ; les pannes restent secrètes jusqu'à la fin. */
  challenge: { targetMinutes: number; timeLimitMinutes: number; mode: ChallengeSettings['mode'] } | null;
  title: string;
  difficulty: Lab['difficulty'];
  domain: string;
  subtopic: string;
  statement: string;
  topology: string;
  estimatedMinutes: number;
  hintCount: number;
  devices: { id: string; type: string }[];
  objectives: { id: string; description: string }[];
}

export function toPublicLab(lab: Lab): PublicLab {
  return {
    slug: lab.slug,
    kind: lab.kind,
    challenge: lab.challenge ? { targetMinutes: lab.challenge.targetMinutes, timeLimitMinutes: lab.challenge.timeLimitMinutes, mode: lab.challenge.mode } : null,
    title: lab.title,
    difficulty: lab.difficulty,
    domain: lab.domain,
    subtopic: lab.subtopic,
    statement: lab.statement,
    topology: lab.topology,
    estimatedMinutes: lab.estimatedMinutes,
    hintCount: lab.hints.length,
    devices: lab.devices.map((d) => ({ id: d.id, type: d.type })),
    objectives: lab.objectives.map((o) => ({ id: o.id, description: o.description })),
  };
}

const norm = (s: string) => normalizeCommand(s);
const list = (v: string | string[]) => (Array.isArray(v) ? v : [v]);

function coveredBy(c: z.infer<typeof coversSchema>, m: RegExpExecArray): boolean {
  const ip = parseIpv4(m[c.groups[0]] ?? '');
  const second = m[c.groups[1]] ?? '';
  const target = parseIpv4(c.address);
  if (ip === null || target === null) return false;
  let wildcard: number | null;
  if (c.mask) {
    const prefix = /^\/(\d+)$/.exec(second);
    const mask = prefix ? (Number(prefix[1]) === 0 ? 0 : (0xffffffff << (32 - Number(prefix[1]))) >>> 0) : parseIpv4(second);
    wildcard = mask === null ? null : ~mask >>> 0;
  } else {
    wildcard = parseIpv4(second);
  }
  if (wildcard === null) return false;
  const care = ~wildcard >>> 0;
  return ((ip & care) >>> 0) === ((target & care) >>> 0);
}

/** Session de lab : les équipements simulés, et l'évaluation des objectifs. Sans I/O, rejouable. */
export class LabSession {
  readonly devices = new Map<string, TerminalDevice>();

  constructor(
    readonly profile: TerminalProfile,
    readonly lab: Lab,
  ) {
    for (const d of lab.devices) {
      this.devices.set(d.id, new TerminalDevice(profile, { id: d.id, type: d.type, interfaces: d.interfaces, startupConfig: d.startupConfig }));
    }
  }

  device(id?: string): TerminalDevice {
    const d = id === undefined ? this.devices.values().next().value : this.devices.get(id);
    if (!d) throw new Error(`équipement inconnu : ${id}`);
    return d;
  }

  run(deviceId: string, input: string): ExecResult {
    return this.device(deviceId).execute(input);
  }

  /** Joue une suite de commandes ; renvoie les résultats, dans l'ordre. */
  runAll(steps: { device: string; commands: string[] }[]): ExecResult[] {
    const out: ExecResult[] = [];
    for (const step of steps) for (const c of step.commands) out.push(this.run(step.device, c));
    return out;
  }

  private sectionsFor(dev: TerminalDevice, c: { section?: string; sectionPattern?: string }): string[][] | null {
    if (c.section !== undefined) {
      const header = dev.sectionHeaders().find((h) => h === c.section);
      return header ? [dev.linesOf(header)] : null;
    }
    if (c.sectionPattern !== undefined) {
      const re = new RegExp(c.sectionPattern, 'i');
      const found = dev.sectionHeaders().filter((h) => re.test(h));
      return found.length ? found.map((h) => dev.linesOf(h)) : null;
    }
    return [dev.linesOf()];
  }

  check(c: LabCheck): boolean {
    switch (c.type) {
      case 'all':
        return c.checks.every((x) => this.check(x));
      case 'any':
        return c.checks.some((x) => this.check(x));
      case 'command': {
        const dev = this.device(c.device);
        const accepted = list(c.command).map(norm);
        const matches = (h: (typeof dev.history)[number]) =>
          accepted.includes(norm(h.canonical)) &&
          (c.mode === undefined || h.mode === c.mode) &&
          (c.section === undefined || h.targets.some((t) => norm(t) === norm(c.section as string)));
        let from = -1;
        if (c.afterLastChange) from = dev.history.map((h) => h.changed).lastIndexOf(true);
        for (const prior of c.after ?? []) {
          const want = norm(prior);
          const sameScope = (h: (typeof dev.history)[number]) =>
            norm(h.canonical) === want &&
            (c.mode === undefined || h.mode === c.mode) &&
            (c.section === undefined || h.targets.some((t) => norm(t) === norm(c.section as string)));
          const last = dev.history.map(sameScope).lastIndexOf(true);
          if (last === -1) return false;
          from = Math.max(from, last);
        }
        return dev.history.some((h, i) => i > from && matches(h));
      }
      case 'section': {
        const dev = this.device(c.device);
        const re = c.sectionPattern !== undefined ? new RegExp(c.sectionPattern, 'i') : null;
        const found = dev.sectionHeaders().some((h) => (re ? re.test(h) : h === c.section));
        return c.absent ? !found : found;
      }
      case 'sequence': {
        const dev = this.device(c.device);
        const scopes = this.sectionsFor(dev, c);
        if (scopes === null) return c.absent === true;
        const res = c.patterns.map((p) => new RegExp(p, 'i'));
        const inOrder = (lines: string[]) => {
          let from = 0;
          for (const re of res) {
            const i = lines.findIndex((l, idx) => idx >= from && re.test(l));
            if (i === -1) return false;
            from = i + 1;
          }
          return true;
        };
        const hits = scopes.map(inOrder);
        if (c.absent) return !hits.some(Boolean);
        return c.sections === 'all' ? hits.every(Boolean) : hits.some(Boolean);
      }
      case 'line':
      case 'regex': {
        const dev = this.device(c.device);
        const scopes = this.sectionsFor(dev, c);
        let matches: (lines: string[]) => boolean;
        if (c.type === 'line') {
          const accepted = list(c.line).map(norm);
          matches = (lines) => lines.some((l) => accepted.includes(norm(l)));
        } else {
          const re = new RegExp(c.pattern, c.caseSensitive ? '' : 'i');
          const covers = c.covers;
          matches = (lines) =>
            lines.some((l) => {
              const m = re.exec(l);
              return m !== null && (!covers || coveredBy(covers, m));
            });
        }
        if (scopes === null) return c.absent;
        const hits = scopes.map(matches);
        const found = c.sections === 'all' ? hits.every(Boolean) : hits.some(Boolean);
        return c.absent ? !hits.some(Boolean) : found;
      }
    }
  }

  /** Objectifs atteints dans l'état actuel. */
  achieved(): string[] {
    return this.lab.objectives.filter((o) => this.check(o.check)).map((o) => o.id);
  }

  complete(): boolean {
    return this.achieved().length === this.lab.objectives.length;
  }
}

/**
 * Contrôles d'un lab au-delà du schéma : configuration de départ acceptée, aucun objectif atteint
 * au départ, solution et variantes sans erreur et gagnantes, pièges perdants sur les objectifs annoncés.
 */
export function checkLab(profile: TerminalProfile, lab: Lab): string[] {
  const issues: string[] = [];
  let start: LabSession;
  try {
    start = new LabSession(profile, lab);
  } catch (err) {
    return [`état de départ : ${(err as Error).message}`];
  }
  for (const d of lab.devices) if (!profile.deviceTypes[d.type]) issues.push(`type d'équipement inconnu : ${d.type}`);
  const already = start.achieved();
  if (already.length) issues.push(`objectifs déjà atteints au départ : ${already.join(', ')}`);

  const play = (name: string, steps: Lab['solution']) => {
    const s = new LabSession(profile, lab);
    for (const step of steps) {
      for (const command of step.commands) {
        const r = s.run(step.device, command);
        if (r.status === 'error') issues.push(`${name} : « ${command} » sur ${step.device} refusée\n${r.output}`);
      }
    }
    return s;
  };

  const solved = play('solution', lab.solution);
  const missing = lab.objectives.map((o) => o.id).filter((id) => !solved.achieved().includes(id));
  if (missing.length) issues.push(`la solution n'atteint pas : ${missing.join(', ')}`);
  for (const v of lab.variants) {
    const s = play(`variante « ${v.description} »`, v.solution);
    const left = lab.objectives.map((o) => o.id).filter((id) => !s.achieved().includes(id));
    if (left.length) issues.push(`variante « ${v.description} » : objectifs non atteints ${left.join(', ')}`);
  }
  for (const p of lab.pitfalls) {
    const s = new LabSession(profile, lab);
    for (const step of p.solution) for (const c of step.commands) s.run(step.device, c);
    const done = s.achieved();
    const passing = p.failing.filter((id) => done.includes(id));
    if (passing.length) issues.push(`piège « ${p.description} » : ${passing.join(', ')} atteint(s) à tort`);
  }
  return issues;
}
