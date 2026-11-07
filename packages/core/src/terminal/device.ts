import { maskToPrefix, parseIpv4 } from '../ipv4.js';
import { formatNumberList, interfaceTypeHelp, paramLabel, parseNumberList, readParam, type ParamContext } from './params.js';
import type { TerminalCommand, TerminalMode, TerminalProfile } from './profile.js';
import { expandSyntax, type SyntaxElem } from './syntax.js';

/**
 * Simulateur de terminal générique et sans I/O : un équipement, ses modes, sa configuration courante.
 * Toute la connaissance d'IOS (modes, prompts, messages, commandes) vient du profil.
 */

/** Ligne de configuration ; une section (interface, line, router…) a des enfants. */
export interface ConfigEntry {
  text: string;
  /** Indice de la commande du profil qui l'a produite. */
  cmd: number;
  /** Mode de la section, pour une ligne qui ouvre un sous-mode. */
  mode?: string;
  /** Numéro de séquence d'une entrée numérotée (ACL nommée). */
  seq?: number;
  children?: ConfigEntry[];
}

export interface DeviceSpec {
  id: string;
  /** Type d'équipement du profil (`router`, `switch`…). */
  type: string;
  /** Interfaces physiques, forme canonique ; `GigabitEthernet0/0-2` déplie une plage. */
  interfaces: string[];
  /** Configuration de départ, au format de la configuration courante (indentation des sous-modes). */
  startupConfig?: string;
}

export interface HistoryEntry {
  mode: string;
  /** Sections visées (vides au niveau global). */
  targets: string[];
  /** Forme canonique, `no …` compris. */
  canonical: string;
  /** La commande a modifié la configuration (une sauvegarde doit venir après la dernière). */
  changed: boolean;
}

export type ExecStatus = 'ok' | 'error' | 'help' | 'empty';

export interface ExecResult {
  /** Ligne telle que le terminal l'affiche : prompt puis saisie (ou `^Z`). */
  echo: string;
  output: string;
  /** Prompt après la commande. */
  prompt: string;
  status: ExecStatus;
  /** Après `?`, texte à remettre dans la ligne de saisie. */
  keep?: string;
}

interface Seq {
  elems: SyntaxElem[];
  cmd: number;
  /** Mots-clés en tête, avant le premier paramètre : minimum d'une forme `no` partielle. */
  lead: number;
}

interface Token {
  text: string;
  start: number;
}

interface Cand {
  seq: Seq;
  pos: number;
  canon: string[];
  values: string[];
  /** Indice du mot de la ligne qui porte chaque valeur. */
  at: number[];
  targets?: string[];
}

type Walk =
  | { kind: 'ok'; alive: Cand[]; complete: Cand[] }
  | { kind: 'invalid'; at: number }
  | { kind: 'ambiguous'; at: number };

interface Resolved {
  cand: Cand;
  cmd: TerminalCommand;
  negated: boolean;
  /** Commande `do` : exécutée dans le mode de fin, sans changer de mode. */
  viaDo: boolean;
  mode: string;
  partial: boolean;
  /** Commandes visées par une forme `no` partielle. */
  partialCmds: number[];
}

type Resolution = { kind: 'ok'; r: Resolved } | { kind: 'invalid' | 'ambiguous' | 'incomplete'; at: number };

/** Déplie `GigabitEthernet0/0-2` en trois interfaces. */
export function expandInterfaceList(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const item of list) {
    const m = /^(.*?)(\d+)-(\d+)$/.exec(item);
    if (!m) {
      out.push(item);
      continue;
    }
    for (let n = Number(m[2]); n <= Number(m[3]); n++) out.push(`${m[1]}${n}`);
  }
  return out;
}

const PSEUDO_NO = -1;
const PSEUDO_DO = -2;

/** Grammaire d'un profil, préparée une fois : formes linéaires par mode et par type d'équipement. */
export class TerminalGrammar {
  readonly modes: Map<string, TerminalMode>;
  private readonly cache = new Map<string, Seq[]>();
  private readonly expanded: SyntaxElem[][][];

  constructor(readonly profile: TerminalProfile) {
    this.modes = new Map(profile.modes.map((m) => [m.id, m]));
    this.expanded = profile.commands.map((c) => expandSyntax(c.syntax));
  }

  mode(id: string): TerminalMode {
    const m = this.modes.get(id);
    if (!m) throw new Error(`mode inconnu : ${id}`);
    return m;
  }

  seqs(mode: string, deviceType: string): Seq[] {
    const k = `${mode}|${deviceType}`;
    let list = this.cache.get(k);
    if (!list) {
      list = [];
      this.profile.commands.forEach((c, cmd) => {
        if (!c.modes.includes(mode)) return;
        if (c.devices && !c.devices.includes(deviceType)) return;
        for (const elems of this.expanded[cmd] as SyntaxElem[][]) {
          const lead = elems.findIndex((e) => e.kind !== 'kw');
          list!.push({ elems, cmd, lead: lead === -1 ? elems.length : lead });
        }
      });
      this.cache.set(k, list);
    }
    return list;
  }
}

const grammars = new WeakMap<TerminalProfile, TerminalGrammar>();
export function grammarOf(profile: TerminalProfile): TerminalGrammar {
  let g = grammars.get(profile);
  if (!g) {
    g = new TerminalGrammar(profile);
    grammars.set(profile, g);
  }
  return g;
}

function tokenize(line: string): Token[] {
  const out: Token[] = [];
  for (const m of line.matchAll(/\S+/g)) out.push({ text: m[0], start: m.index ?? 0 });
  return out;
}

function fill(template: string, vars: Record<string, string>, values: readonly string[] = [], target = ''): string {
  return template.replace(/\{(\$?)([A-Za-z0-9_-]+)\}/g, (all, dollar: string, name: string) => {
    if (dollar) return values[Number(name) - 1] ?? '';
    if (name === 'target') return target;
    return vars[name] ?? all;
  });
}

/** Empreinte stable d'un secret pour l'affichage (jamais le secret lui-même). */
function maskSecret(secret: string): string {
  const alphabet = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let h = 2166136261;
  let out = '';
  for (let i = 0; out.length < 57; i++) {
    h ^= secret.charCodeAt(i % Math.max(1, secret.length)) + i;
    h = Math.imul(h, 16777619) >>> 0;
    out += alphabet[h % alphabet.length];
  }
  return `$9$${out.slice(0, 14)}$${out.slice(14)}`;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Ordre naturel : `vlan 9` < `vlan 10`, `line vty 0 4` < `line vty 5 15`. */
export function naturalCompare(a: string, b: string): number {
  const pa = a.toLowerCase().match(/\d+|\D+/g) ?? [];
  const pb = b.toLowerCase().match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const x = pa[i] as string;
    const y = pb[i] as string;
    if (x === y) continue;
    if (/^\d/.test(x) && /^\d/.test(y)) return Number(x) - Number(y);
    return x < y ? -1 : 1;
  }
  return pa.length - pb.length;
}

export class TerminalDevice {
  readonly grammar: TerminalGrammar;
  readonly profile: TerminalProfile;
  mode: string;
  targets: string[] = [];
  vars: Record<string, string>;
  config: ConfigEntry[] = [];
  history: HistoryEntry[] = [];
  readonly interfaces: string[];
  /** Ligne en cours d'exécution (pour placer le marqueur `^` d'un refus). */
  private current: { tokens: Token[]; promptLen: number } | null = null;

  constructor(
    profile: TerminalProfile,
    readonly spec: DeviceSpec,
  ) {
    this.profile = profile;
    this.grammar = grammarOf(profile);
    const type = profile.deviceTypes[spec.type];
    if (!type) throw new Error(`type d'équipement inconnu : ${spec.type}`);
    this.interfaces = expandInterfaceList(spec.interfaces);
    this.vars = { hostname: type.defaultHostname, defaultHostname: type.defaultHostname };
    this.mode = profile.configMode;
    if (type.baseConfig) this.loadConfig(type.baseConfig);
    for (const name of this.interfaces) {
      this.loadConfig([fill(type.interfaceSection, { name }), ...type.interfaceDefaults.map((l) => ` ${l}`)].join('\n'));
    }
    if (spec.startupConfig) this.loadConfig(spec.startupConfig);
    this.mode = profile.startMode;
    this.targets = [];
    this.history = [];
  }

  private get ctx(): ParamContext {
    return { profile: this.profile, deviceType: this.spec.type, interfaces: this.interfaces };
  }

  /** Charge un extrait de configuration (lignes indentées = sous-mode). Lève une erreur au premier refus. */
  loadConfig(text: string): void {
    for (const rawLine of text.split('\n')) {
      const line = rawLine.replace(/\s+$/, '');
      const body = line.trim();
      if (!body || body.startsWith('!') || body === 'end') continue;
      if (!/^\s/.test(line)) {
        this.mode = this.profile.configMode;
        this.targets = [];
      }
      const r = this.execute(body);
      if (r.status === 'error') throw new Error(`configuration de départ refusée : « ${body} »\n${r.output}`);
    }
  }

  prompt(): string {
    return fill(this.grammar.mode(this.mode).prompt, this.vars);
  }

  private isConfig(mode = this.mode): boolean {
    return this.grammar.mode(mode).config;
  }

  /** Modes essayés pour une commande : le mode courant, puis ses parents de configuration (comme IOS). */
  private modeChain(): string[] {
    const chain = [this.mode];
    let m = this.grammar.mode(this.mode);
    while (m.config && m.parent && this.grammar.mode(m.parent).config) {
      chain.push(m.parent);
      m = this.grammar.mode(m.parent);
    }
    return chain;
  }

  private walk(seqs: Seq[], tokens: Token[], line: string, from: number, pseudo: Seq[] = []): Walk {
    let alive: Cand[] = [...pseudo, ...seqs].map((seq) => ({ seq, pos: 0, canon: [], values: [], at: [] }));
    let ti = from;
    while (ti < tokens.length) {
      const token = tokens[ti] as Token;
      const word = token.text.toLowerCase();
      const raw = line.slice(token.start);
      const kwHits: { cand: Cand; word: string }[] = [];
      const paramHits: { cand: Cand; canon: string; consumed: number; targets?: string[] }[] = [];
      const texts = tokens.map((t) => t.text);
      for (const cand of alive) {
        const elem = cand.seq.elems[cand.pos];
        if (!elem) continue;
        if (elem.kind === 'kw') {
          if (elem.word.startsWith(word)) kwHits.push({ cand, word: elem.word });
        } else {
          const v = readParam(this.ctx, elem, texts, ti, raw);
          if (v) paramHits.push({ cand, canon: v.canon, consumed: v.consumed, ...(v.targets ? { targets: v.targets } : {}) });
        }
      }
      let next: Cand[];
      let consumed = 1;
      const words = [...new Set(kwHits.map((h) => h.word))];
      const exact = words.find((w) => w === word);
      const chosen = exact ?? (words.length === 1 ? words[0] : undefined);
      if (chosen !== undefined) {
        next = kwHits.filter((h) => h.word === chosen).map((h) => ({ ...h.cand, pos: h.cand.pos + 1, canon: [...h.cand.canon, chosen] }));
      } else if (paramHits.length) {
        consumed = Math.max(...paramHits.map((h) => h.consumed));
        next = paramHits
          .filter((h) => h.consumed === consumed)
          .map((h) => ({
            ...h.cand,
            pos: h.cand.pos + 1,
            canon: [...h.cand.canon, h.canon],
            values: [...h.cand.values, h.canon],
            at: [...h.cand.at, ti],
            ...(h.targets ? { targets: h.targets } : {}),
          }));
      } else if (words.length > 1) {
        return { kind: 'ambiguous', at: ti };
      } else {
        return { kind: 'invalid', at: ti };
      }
      alive = next;
      ti = consumed === Number.POSITIVE_INFINITY ? tokens.length : ti + consumed;
      // Les mots `no` et `do` absorbent la suite : leur résolution se fait à part.
      if (alive.every((c) => c.seq.cmd < 0)) return { kind: 'ok', alive, complete: alive };
    }
    const complete = alive.filter((c) => c.pos === c.seq.elems.length);
    return { kind: 'ok', alive, complete };
  }

  /** Type d'interface d'une section (`interface Port-channel1` → `Port-channel`), ou null. */
  interfaceTypeOf(header: string): string | null {
    const last = header.split(' ').pop() ?? '';
    const m = /^([A-Za-z][A-Za-z-]*?)\d/.exec(last);
    if (!m) return null;
    return this.profile.interfaceTypes.find((t) => t.name === m[1])?.name ?? null;
  }

  /** La commande existe-t-elle sur les sections visées (types d'interface permis) ? */
  private allowedOn(cmd: TerminalCommand, mode: string): boolean {
    if (!cmd.onInterfaces || mode !== this.mode || !this.targets.length) return true;
    const types = cmd.onInterfaces[this.spec.type] ?? cmd.onInterfaces['*'];
    if (!types) return true;
    return this.targets.every((t) => {
      const type = this.interfaceTypeOf(t);
      return type !== null && types.includes(type);
    });
  }

  /** Formes linéaires offertes dans un mode, compte tenu des sections visées. */
  private seqsHere(mode: string): Seq[] {
    const all = this.grammar.seqs(mode, this.spec.type);
    if (mode !== this.mode || !this.targets.length) return all;
    return all.filter((s) => this.allowedOn(this.profile.commands[s.cmd] as TerminalCommand, mode));
  }

  private pseudoSeqs(mode: string): Seq[] {
    if (!this.isConfig(mode)) return [];
    const list: Seq[] = [{ elems: [{ kind: 'kw', word: 'no' }], cmd: PSEUDO_NO, lead: 1 }];
    if (this.profile.doKeyword) list.push({ elems: [{ kind: 'kw', word: this.profile.doKeyword }], cmd: PSEUDO_DO, lead: 1 });
    return list;
  }

  /** Résout une ligne dans un mode donné. */
  private resolveIn(mode: string, tokens: Token[], line: string): Resolution {
    const seqs = this.seqsHere(mode);
    const head = this.walk(seqs, tokens, line, 0, this.pseudoSeqs(mode));
    if (head.kind !== 'ok') return head;
    const pseudo = head.alive.find((c) => c.seq.cmd < 0);
    if (pseudo && head.alive.every((c) => c.seq.cmd < 0)) {
      if (pseudo.seq.cmd === PSEUDO_DO) {
        if (tokens.length < 2) return { kind: 'incomplete', at: tokens.length };
        const r = this.resolveIn(this.profile.endMode, tokens.slice(1), line);
        if (r.kind !== 'ok') return { ...r, at: r.at + 1 } as Resolution;
        return { kind: 'ok', r: { ...r.r, viaDo: true } };
      }
      // Forme `no` : la suite se lit parmi les commandes de configuration de ce mode.
      if (tokens.length < 2) return { kind: 'incomplete', at: tokens.length };
      const negatable = seqs.filter((s) => (this.profile.commands[s.cmd] as TerminalCommand).negate !== 'none');
      const rest = this.walk(negatable, tokens, line, 1);
      if (rest.kind !== 'ok') return rest;
      const done = rest.complete[0];
      if (done) {
        return { kind: 'ok', r: { cand: done, cmd: this.profile.commands[done.seq.cmd] as TerminalCommand, negated: true, viaDo: false, mode, partial: false, partialCmds: [] } };
      }
      const ok = rest.alive.filter((c) => c.pos >= c.seq.lead && c.pos > 0);
      const first = ok[0];
      if (!first) return { kind: 'incomplete', at: tokens.length };
      return {
        kind: 'ok',
        r: {
          cand: first,
          cmd: this.profile.commands[first.seq.cmd] as TerminalCommand,
          negated: true,
          viaDo: false,
          mode,
          partial: true,
          partialCmds: [...new Set(ok.map((c) => c.seq.cmd))],
        },
      };
    }
    const done = head.complete.find((c) => c.seq.cmd >= 0);
    if (done) {
      return { kind: 'ok', r: { cand: done, cmd: this.profile.commands[done.seq.cmd] as TerminalCommand, negated: false, viaDo: false, mode, partial: false, partialCmds: [] } };
    }
    return { kind: 'incomplete', at: tokens.length };
  }

  private resolve(tokens: Token[], line: string): Resolution {
    let best: Exclude<Resolution, { kind: 'ok' }> | null = null;
    for (const mode of this.modeChain()) {
      const r = this.resolveIn(mode, tokens, line);
      if (r.kind === 'ok') return r;
      // On garde l'erreur du mode où la lecture est allée le plus loin ; à égalité, le mode courant.
      if (!best || r.at > best.at) best = r;
    }
    return best as Resolution;
  }

  private sections(): ConfigEntry[] {
    return this.config.filter((e) => e.children);
  }

  /** Section par son en-tête exact (forme canonique : `interface GigabitEthernet0/1`, `ip dhcp pool LAN`). Les noms sont sensibles à la casse, comme dans IOS. */
  section(header: string): ConfigEntry | undefined {
    return this.config.find((e) => e.children && e.text === header);
  }

  private ensureSection(header: string, cmd: number, mode: string): ConfigEntry {
    let s = this.section(header);
    if (!s) {
      s = { text: header, cmd, mode, children: [] };
      this.config.push(s);
    }
    return s;
  }

  /** Lignes visées par la commande : sections courantes, ou configuration globale. */
  private scopes(targets: string[]): { lists: ConfigEntry[][]; names: string[] } {
    if (!targets.length) return { lists: [this.config], names: [''] };
    const lists: ConfigEntry[][] = [];
    for (const t of targets) {
      const s = this.section(t);
      if (s?.children) lists.push(s.children);
    }
    return { lists, names: targets };
  }

  private keyOf(cmd: TerminalCommand, canon: string[]): string | null {
    if (!cmd.key) return null;
    return cmd.key
      .map((i) => canon[i < 0 ? canon.length + i : i] ?? '')
      .join(' ')
      .toLowerCase();
  }

  private checkRequirements(cmd: TerminalCommand, targets: string[], cand: Cand): string | null {
    const values = cand.values;
    for (const req of cmd.requires ?? []) {
      if (req.when) {
        const v = Number(values[req.when.param - 1]);
        if (!Number.isFinite(v) || (req.when.min !== undefined && v < req.when.min) || (req.when.max !== undefined && v > req.when.max)) continue;
      }
      const problem = this.requirementProblem(req, targets, values);
      if (problem === null) continue;
      if (req.invalidAt !== undefined) {
        const token = this.current?.tokens[cand.at[req.invalidAt - 1] ?? -1];
        const col = (this.current?.promptLen ?? 0) + (token?.start ?? 0);
        return `${' '.repeat(col)}^\n${this.profile.messages.invalid}`;
      }
      return problem;
    }
    return null;
  }

  /** Message d'une condition non remplie, ou null. */
  private requirementProblem(req: NonNullable<TerminalCommand['requires']>[number], targets: string[], values: string[]): string | null {
    const msg = (vars: Record<string, string> = this.vars, target = '') => fill(req.message ?? '', vars, values, target);
    {
      if (req.var !== undefined) {
        const v = this.vars[req.var];
        if (v === undefined) return msg();
        if (req.min !== undefined && !(Number(v) >= req.min)) return msg();
        if (req.notEquals !== undefined && same(v, fill(req.notEquals, this.vars))) return msg();
      }
      if (req.config !== undefined) {
        const re = new RegExp(req.config, 'i');
        if (!this.config.some((e) => !e.children && re.test(e.text))) return msg();
      }
      if (req.notConfig !== undefined) {
        const escaped = values.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const re = new RegExp(fill(req.notConfig, {}, escaped), 'i');
        if (this.config.some((e) => !e.children && re.test(e.text))) return msg();
      }
      if (req.ipv4Host !== undefined) {
        const ip = parseIpv4(values[req.ipv4Host[0] - 1] ?? '');
        const mask = parseIpv4(values[req.ipv4Host[1] - 1] ?? '');
        const prefix = mask === null ? null : maskToPrefix(mask);
        if (ip !== null && mask !== null && prefix !== null && prefix < 31) {
          const host = (ip & ~mask) >>> 0;
          const all = ~mask >>> 0;
          if (host === 0 || host === all) {
            return msg({ ...this.vars, prefix: String(prefix), address: values[req.ipv4Host[0] - 1] ?? '' });
          }
        }
      }
      if (req.notInSections !== undefined) {
        const v = values[req.notInSections.param - 1];
        const re = new RegExp(req.notInSections.pattern, 'i');
        const taken = this.sections().some((sec) => sec.children?.some((e) => re.exec(e.text)?.[1]?.toLowerCase() === v?.toLowerCase()));
        if (v !== undefined && taken) return msg();
      }
      if (req.param !== undefined && req.notMatch !== undefined) {
        const v = values[req.param - 1];
        if (v !== undefined && new RegExp(req.notMatch, 'i').test(v)) return msg();
      }
      if (req.section !== undefined) {
        const re = new RegExp(req.section, 'i');
        for (const t of targets) {
          const s = this.section(t);
          if (!s?.children?.some((e) => re.test(e.text))) {
            const name = t.replace(/^\S+\s+/, '');
            return msg(this.vars, name);
          }
        }
      }
    }
    return null;
  }

  /** Deux commandes du profil règlent-elles la même chose (même commande ou même `keyGroup`) ? */
  private sameSetting(a: number, b: number): boolean {
    if (a === b) return true;
    const ga = this.profile.commands[a]?.keyGroup;
    return ga !== undefined && ga === this.profile.commands[b]?.keyGroup;
  }

  /** Ligne `no …` qui règle la même chose que la commande (même réglage et même clé, ou même texte). */
  private sameNegation(e: ConfigEntry, cmdIndex: number, cmd: TerminalCommand, canon: string[]): boolean {
    if (!e.text.startsWith('no ') || !this.sameSetting(e.cmd, cmdIndex)) return false;
    const key = this.keyOf(cmd, canon);
    const other = this.profile.commands[e.cmd];
    if (key === null || !other) return same(e.text, `no ${canon.join(' ')}`);
    return this.keyOf(other, e.text.slice(3).split(' ')) === key;
  }

  private entryKey(e: ConfigEntry): string | null {
    const c = this.profile.commands[e.cmd];
    return c ? this.keyOf(c, e.text.split(' ')) : null;
  }

  private store(list: ConfigEntry[], entry: ConfigEntry, cmd: TerminalCommand, canon: string[]): void {
    const key = this.keyOf(cmd, canon);
    const idx = key !== null ? list.findIndex((e) => this.sameSetting(e.cmd, entry.cmd) && !e.text.startsWith('no ') && this.entryKey(e) === key) : -1;
    if (idx >= 0) {
      list[idx] = entry;
      return;
    }
    if (list.some((e) => same(e.text, entry.text))) return;
    list.push(entry);
  }

  private applyList(list: ConfigEntry[], cmdIndex: number, cmd: TerminalCommand, values: string[]): void {
    const spec = cmd.list!;
    const idx = list.findIndex((e) => e.text.toLowerCase().startsWith(`${spec.prefix.toLowerCase()} `));
    const current = idx >= 0 ? parseNumberList((list[idx] as ConfigEntry).text.slice(spec.prefix.length + 1), spec.max) : null;
    const all = Array.from({ length: spec.max }, (_, i) => i + 1);
    const given = values.length ? parseNumberList(values[values.length - 1] as string, spec.max) ?? [] : [];
    let next: number[] | 'all' | 'none';
    switch (spec.op) {
      case 'set':
        next = given;
        break;
      case 'add':
        next = current ? [...current, ...given] : 'all';
        break;
      case 'remove':
        next = (current ?? all).filter((n) => !given.includes(n));
        break;
      case 'except':
        next = all.filter((n) => !given.includes(n));
        break;
      case 'all':
        next = 'all';
        break;
      case 'none':
        next = 'none';
        break;
    }
    if (Array.isArray(next) && next.length === spec.max) next = 'all';
    if (next === 'all') {
      if (idx >= 0) list.splice(idx, 1);
      return;
    }
    const text = `${spec.prefix} ${next === 'none' || next.length === 0 ? 'none' : formatNumberList(next)}`;
    const entry = { text, cmd: cmdIndex };
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
  }

  private leaveConfig(out: string[]): void {
    if (this.profile.messages.leaveConfig) out.push(fill(this.profile.messages.leaveConfig, this.vars));
  }

  private goTo(mode: string, out: string[]): void {
    const wasConfig = this.isConfig();
    this.mode = mode;
    this.targets = [];
    if (wasConfig && !this.isConfig()) this.leaveConfig(out);
  }

  private exitMode(out: string[]): void {
    const current = this.grammar.mode(this.mode);
    if (current.config && current.parent && this.grammar.mode(current.parent).config) {
      this.mode = current.parent;
      this.targets = [];
      return;
    }
    if (current.config) {
      this.goTo(this.profile.endMode, out);
      return;
    }
    this.goTo(current.parent ?? this.profile.startMode, out);
  }

  /** Préfixe d'affichage à plat d'une section (ACL numérotée : `access-list 10`), ou null. */
  private flatPrefix(e: ConfigEntry): { prefix: string; rank: number | undefined } | null {
    const f = e.children ? this.profile.commands[e.cmd]?.flatten : undefined;
    if (!f) return null;
    const m = new RegExp(f.match).exec(e.text);
    if (!m) return null;
    return { prefix: f.display.replace(/\$(\d)/g, (_a, n: string) => m[Number(n)] ?? ''), rank: f.rank ?? this.profile.commands[e.cmd]?.rank };
  }

  private rankOf(e: ConfigEntry): number {
    const flat = this.flatPrefix(e);
    const rank = flat ? flat.rank : this.profile.commands[e.cmd]?.rank;
    return rank ?? Number.POSITIVE_INFINITY;
  }

  /** Ordre de deux sections de même rang : interfaces par type puis par numéro, sinon ordre naturel. */
  private compareSections(a: ConfigEntry, b: ConfigEntry): number {
    const ta = this.interfaceTypeOf(a.text);
    const tb = this.interfaceTypeOf(b.text);
    if (ta && tb) {
      const rank = (t: string) => this.profile.interfaceTypes.find((x) => x.name === t && (!x.devices || x.devices.includes(this.spec.type)))?.rank ?? 0;
      const ra = rank(ta);
      const rb = rank(tb);
      if (ra !== rb) return ra - rb;
      const ia = this.interfaces.findIndex((i) => same(`interface ${i}`, a.text));
      const ib = this.interfaces.findIndex((i) => same(`interface ${i}`, b.text));
      if (ia >= 0 && ib >= 0) return ia - ib;
    }
    const ka = this.flatPrefix(a)?.prefix ?? a.text;
    const kb = this.flatPrefix(b)?.prefix ?? b.text;
    return naturalCompare(ka, kb);
  }

  /** Entrées dans l'ordre d'affichage : par rang de commande (profil), les sections de même rang triées. */
  private ordered(list: ConfigEntry[]): ConfigEntry[] {
    return list
      .map((e, i) => ({ e, i }))
      .sort((x, y) => {
        const r = this.rankOf(x.e) - this.rankOf(y.e);
        if (r !== 0 && !Number.isNaN(r)) return r;
        if (x.e.children && y.e.children) return this.compareSections(x.e, y.e) || x.i - y.i;
        return x.i - y.i;
      })
      .map((x) => x.e);
  }

  /** Configuration courante, telle que `show running-config` l'affiche (sans en-tête). */
  renderConfig(onlySection?: string): string[] {
    const { separator, indent } = this.profile.runningConfig;
    const lines: string[] = [];
    const display = (e: ConfigEntry) => {
      const cmd = this.profile.commands[e.cmd];
      if (!cmd?.display || e.text.startsWith('no ')) return e.text;
      const tokens = e.text.split(' ');
      return cmd.display.replace(/\{(mask:)?\$(\d+)\}/g, (_all, mask: string | undefined, n: string) => {
        const v = tokens[Number(n)] ?? '';
        return mask ? maskSecret(tokens.slice(Number(n)).join(' ')) : v;
      });
    };
    let lastFlat: string | null = null;
    for (const e of this.ordered(this.config)) {
      if (onlySection !== undefined && !(e.children && e.text === onlySection)) continue;
      const flat = this.flatPrefix(e);
      if (flat && onlySection === undefined) {
        if (lastFlat === null && lines.length && lines[lines.length - 1] !== separator) lines.push(separator);
        for (const c of e.children ?? []) lines.push(`${flat.prefix} ${display(c)}`);
        lastFlat = flat.prefix;
        continue;
      }
      if (lastFlat !== null) {
        lines.push(separator);
        lastFlat = null;
      }
      if (e.children) {
        if (e.mode && this.grammar.mode(e.mode).hidden) continue;
        if (lines.length && lines[lines.length - 1] !== separator) lines.push(separator);
        lines.push(display(e));
        for (const c of this.ordered(e.children)) lines.push(`${indent}${display(c)}`);
        lines.push(separator);
      } else {
        lines.push(display(e));
      }
    }
    return lines;
  }

  private runningConfig(values: string[]): string {
    const only = values[0] ? `interface ${values[0]}` : undefined;
    const body = this.renderConfig(only);
    const { header, footer } = this.profile.runningConfig;
    const lines = [...fill(header, this.vars).split('\n'), ...body, ...footer.split('\n')];
    const sep = this.profile.runningConfig.separator;
    const deduped = lines.filter((l, i) => !(l === sep && lines[i - 1] === sep));
    const text = deduped.join('\n');
    return fill(text, { bytes: String(text.length) });
  }

  private apply(r: Resolved): string[] {
    const out: string[] = [];
    const { cand, cmd, negated } = r;
    const cmdIndex = cand.seq.cmd;
    const canonText = cand.canon.join(' ');
    const config = this.isConfig(r.mode) && !r.viaDo;

    if (!r.viaDo && r.mode !== this.mode) {
      // La commande appartient à un mode parent : on y remonte, comme IOS.
      this.mode = r.mode;
      this.targets = [];
    }

    if (negated) {
      if (cmd.into) {
        // `no access-list 10 …` retire toute l'ACL 10, comme IOS.
        const header = fill(cmd.into.section, this.vars, cand.values);
        this.config = this.config.filter((e) => !(e.children && e.text === header));
        this.history.push({ mode: r.mode, targets: [...this.targets], canonical: `no ${canonText}`, changed: false });
        return out;
      }
      if (cmd.enter) {
        this.config = this.config.filter((e) => !(e.children && e.text === canonText && !this.isPhysical(e.text)));
        this.history.push({ mode: r.mode, targets: [...this.targets], canonical: `no ${canonText}`, changed: false });
        return out;
      }
      const { lists } = this.scopes(this.targets);
      const key = this.keyOf(cmd, cand.canon);
      for (const list of lists) {
        if (cmd.list) {
          const prefix = cmd.list.prefix.toLowerCase();
          const idx = list.findIndex((e) => e.text.toLowerCase().startsWith(`${prefix} `));
          if (idx >= 0) list.splice(idx, 1);
          continue;
        }
        const seqNo = cmd.sequenced ? this.sequenceOf(cand) : null;
        const positive = (e: ConfigEntry) => {
          if (e.text.startsWith('no ')) return false;
          // `no 20` ou `no 20 permit …` : l'entrée n° 20 d'une ACL nommée.
          if (seqNo !== null) return e.seq === seqNo.seq;
          if (r.partial) return r.partialCmds.includes(e.cmd) && e.text.toLowerCase().startsWith(`${canonText.toLowerCase()} `);
          if (!this.sameSetting(e.cmd, cmdIndex)) return false;
          return key !== null ? this.entryKey(e) === key : same(e.text, canonText);
        };
        const had = list.some(positive);
        for (let i = list.length - 1; i >= 0; i--) if (positive(list[i] as ConfigEntry)) list.splice(i, 1);
        const mode = cmd.negate ?? 'remove';
        if (mode === 'store' || (mode === 'toggle' && !had)) {
          // `no ip domain-lookup` puis `no ip domain lookup` : une seule ligne, la dernière forme saisie.
          for (let i = list.length - 1; i >= 0; i--) if (this.sameNegation(list[i] as ConfigEntry, cmdIndex, cmd, cand.canon)) list.splice(i, 1);
          list.push({ text: `no ${canonText}`, cmd: cmdIndex });
        }
      }
      this.history.push({ mode: r.mode, targets: [...this.targets], canonical: `no ${canonText}`, changed: false });
      this.syncAggregates(this.targets);
      return out;
    }

    const problem = this.checkRequirements(cmd, this.targets, cand);
    if (problem !== null) return [problem];

    const historyTargets = [...this.targets];

    if (cmd.into && config) {
      const done = this.applyInto(cmd, cand);
      if (done === null) return out;
      if (typeof done === 'string') return done ? [done] : out;
      this.history.push({ mode: r.mode, targets: historyTargets, canonical: canonText, changed: false });
      return [...out, ...done];
    }

    const aggregateHeader = cmd.aggregate ? fill(cmd.aggregate.section, this.vars, cand.values) : null;
    const aggregateExisted = aggregateHeader !== null && this.section(aggregateHeader) !== undefined;

    if (cmd.enter && !r.viaDo) {
      let headers: string[];
      if (cmd.blocks) {
        const pieces = this.enterBlocks(cmdIndex, cmd, cand);
        if (typeof pieces === 'string') return [pieces];
        headers = pieces;
      } else {
        headers = cmd.enter.range ? (cand.targets ?? []).map((t) => `${cand.canon[0]} ${t}`) : [canonText];
        const sectionMode = cmd.enter.range ? this.rangeSectionMode(cmd.enter.mode) : cmd.enter.mode;
        for (const h of headers) this.ensureSection(h, cmdIndex, sectionMode);
      }
      this.mode = cmd.enter.mode;
      this.targets = headers;
    } else if (config && cmd.store !== false && !cmd.goto && !cmd.exit && !cmd.end) {
      const { lists } = this.scopes(this.targets);
      for (const list of lists) {
        if (cmd.list) {
          this.applyList(list, cmdIndex, cmd, cand.values);
          continue;
        }
        if (cmd.sequenced) {
          const problem = this.storeSequenced(list, cmdIndex, cand);
          if (problem) return [problem];
          continue;
        }
        if (cmd.clears) {
          const re = new RegExp(cmd.clears, 'i');
          for (let i = list.length - 1; i >= 0; i--) if (re.test((list[i] as ConfigEntry).text)) list.splice(i, 1);
        }
        const negIdx = list.findIndex((e) => this.sameNegation(e, cmdIndex, cmd, cand.canon));
        if (negIdx >= 0) list.splice(negIdx, 1);
        if (cmd.negate === 'store' || (cmd.negate === 'toggle' && negIdx >= 0)) continue;
        this.store(list, { text: canonText, cmd: cmdIndex }, cmd, cand.canon);
      }
    }

    for (const tpl of cmd.create ?? []) {
      const header = fill(tpl, this.vars, cand.values);
      const existed = this.section(header) !== undefined;
      this.openSection(header);
      if (!existed && cmd.createOutput !== undefined) out.push(fill(cmd.createOutput, this.vars, cand.values));
    }
    if (cmd.aggregate && aggregateHeader !== null && config) this.joinAggregate(cmd.aggregate.lines, aggregateHeader, aggregateExisted);
    for (const [name, value] of Object.entries(cmd.set ?? {})) this.vars[name] = fill(value, this.vars, cand.values);
    if (config && !cmd.enter) this.syncAggregates(historyTargets);

    this.history.push({ mode: r.mode, targets: historyTargets, canonical: canonText, changed: false });

    if (cmd.builtin === 'running-config') out.push(this.runningConfig(cand.values));
    if (cmd.output !== undefined) out.push(fill(cmd.output, this.vars, cand.values, historyTargets[0]?.replace(/^\S+\s+/, '') ?? ''));

    if (!r.viaDo) {
      if (cmd.goto) this.goTo(cmd.goto, out);
      if (cmd.end && this.isConfig()) this.goTo(this.profile.endMode, out);
      if (cmd.exit) this.exitMode(out);
    }
    return out;
  }

  /**
   * Section d'en-tête donné, créée au besoin par la commande qui l'ouvre (lue comme une saisie dans le
   * mode de configuration). Renvoie la section et son mode, ou null si l'en-tête n'ouvre aucune section.
   */
  private openSection(header: string): { entry: ConfigEntry; mode: string } | null {
    const existing = this.section(header);
    if (existing?.mode) return { entry: existing, mode: existing.mode };
    const saved = { mode: this.mode, targets: this.targets };
    this.mode = this.profile.configMode;
    this.targets = [];
    const r = this.resolveIn(this.profile.configMode, tokenize(header), header);
    this.mode = saved.mode;
    this.targets = saved.targets;
    if (r.kind !== 'ok' || !r.r.cmd.enter) return null;
    const canon = r.r.cand.canon.join(' ');
    const mode = r.r.cmd.enter.range ? this.rangeSectionMode(r.r.cmd.enter.mode) : r.r.cmd.enter.mode;
    return { entry: this.ensureSection(canon, r.r.cand.seq.cmd, mode), mode };
  }

  /**
   * Commande rangée dans une section (`access-list 10 permit …`) : la fin de la ligne y est exécutée.
   * Renvoie la sortie, un message de refus, ou null si rien n'a été fait.
   */
  private applyInto(cmd: TerminalCommand, cand: Cand): string[] | string | null {
    const spec = cmd.into!;
    const header = fill(spec.section, this.vars, cand.values);
    const existed = this.section(header) !== undefined;
    const saved = { mode: this.mode, targets: this.targets };
    const opened = this.openSection(header);
    if (!opened) return null;
    const text = cand.canon.slice(spec.skip).join(' ');
    this.mode = opened.mode;
    this.targets = [opened.entry.text];
    const r = this.resolveIn(opened.mode, tokenize(text), text);
    let result: string[] | string | null = null;
    if (r.kind === 'ok') {
      const before = this.history.length;
      const out = this.apply(r.r);
      if (this.history.length > before) {
        this.history.length = before;
        result = out;
      } else {
        result = out.join('\n');
      }
    }
    this.mode = saved.mode;
    this.targets = saved.targets;
    // Une section créée pour rien (entrée refusée) ne reste pas.
    if (result === null || typeof result === 'string') {
      if (!existed && !opened.entry.children?.length) this.config = this.config.filter((e) => e !== opened.entry);
    }
    return result;
  }

  /** Plage `de à` d'un morceau de bloc (`line vty 5 15`, `line vty 3`). */
  private pieceRange(text: string, prefix: string): { from: number; to: number } | null {
    const m = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)(?: (\\d+))?$`).exec(text);
    if (!m) return null;
    return { from: Number(m[1]), to: Number(m[2] ?? m[1]) };
  }

  private pieceHeader(prefix: string, from: number, to: number): string {
    return from === to ? `${prefix} ${from}` : `${prefix} ${from} ${to}`;
  }

  private pieces(cmdIndex: number, prefix: string): { e: ConfigEntry; from: number; to: number }[] {
    const out: { e: ConfigEntry; from: number; to: number }[] = [];
    for (const e of this.config) {
      if (!e.children || e.cmd !== cmdIndex) continue;
      const r = this.pieceRange(e.text, prefix);
      if (r) out.push({ e, ...r });
    }
    return out.sort((a, b) => a.from - b.from);
  }

  /** Entrée dans un sous-mode découpé en blocs : renvoie les sections visées, ou un message de refus. */
  private enterBlocks(cmdIndex: number, cmd: TerminalCommand, cand: Cand): string[] | string {
    const nums = cand.values.map(Number);
    const a = nums[0] as number;
    const b = nums[1] ?? a;
    if (b < a) {
      const token = this.current?.tokens[cand.at[1] ?? -1];
      return `${' '.repeat((this.current?.promptLen ?? 0) + (token?.start ?? 0))}^\n${this.profile.messages.invalid}`;
    }
    const prefix = cand.canon.slice(0, cand.canon.length - cand.values.length).join(' ');
    const mode = cmd.enter!.mode;
    const blocks = cmd.blocks!;
    const add = (from: number, to: number, children: ConfigEntry[] = []) => {
      const e: ConfigEntry = { text: this.pieceHeader(prefix, from, to), cmd: cmdIndex, mode, children };
      this.config.push(e);
      return e;
    };
    for (const [x, y] of blocks) {
      if (y < a || x > b) continue;
      if (!this.pieces(cmdIndex, prefix).some((p) => p.from >= x && p.to <= y)) add(x, y);
    }
    if (!blocks.some(([x, y]) => x <= a && b <= y) && !this.pieces(cmdIndex, prefix).some((p) => p.from <= a && b <= p.to)) {
      // Plage hors des blocs déclarés : un morceau à part.
      if (!blocks.some(([x, y]) => !(y < a || x > b))) add(a, b);
    }
    const split = (at: number) => {
      for (const p of this.pieces(cmdIndex, prefix)) {
        if (p.from < at && p.to >= at) {
          p.e.text = this.pieceHeader(prefix, p.from, at - 1);
          add(at, p.to, (p.e.children ?? []).map((c) => ({ ...c })));
        }
      }
    };
    split(a);
    split(b + 1);
    return this.pieces(cmdIndex, prefix)
      .filter((p) => p.from >= a && p.to <= b)
      .map((p) => p.e.text);
  }

  /** Réunit les morceaux voisins d'un même bloc dont la configuration est identique (hors sections visées). */
  private mergeBlocks(): void {
    this.profile.commands.forEach((cmd, cmdIndex) => {
      if (!cmd.blocks) return;
      const prefixes = new Set<string>();
      for (const e of this.config) if (e.children && e.cmd === cmdIndex) prefixes.add(e.text.replace(/( \d+){1,2}$/, ''));
      for (const prefix of prefixes) {
        let merged = true;
        while (merged) {
          merged = false;
          const list = this.pieces(cmdIndex, prefix);
          for (let i = 0; i + 1 < list.length; i++) {
            const p = list[i]!;
            const q = list[i + 1]!;
            const block = cmd.blocks.find(([x, y]) => x <= p.from && p.to <= y);
            if (!block || q.from !== p.to + 1 || q.to > block[1]) continue;
            if (this.targets.includes(p.e.text) || this.targets.includes(q.e.text)) continue;
            const text = (e: ConfigEntry) => (e.children ?? []).map((c) => c.text).join('\n');
            if (text(p.e) !== text(q.e)) continue;
            p.e.text = this.pieceHeader(prefix, p.from, q.to);
            this.config = this.config.filter((e) => e !== q.e);
            merged = true;
            break;
          }
        }
      }
    });
  }

  /** Indice, dans la forme canonique, du premier paramètre d'une commande. */
  private firstParam(cmdIndex: number): number {
    const seq = this.grammar.seqs(this.profile.commands[cmdIndex]?.modes[0] ?? '', this.spec.type).find((s) => s.cmd === cmdIndex);
    return seq ? seq.elems.findIndex((e) => e.kind === 'param') : -1;
  }

  /** Agrégat de chaque membre : en-tête de la section d'agrégat que désigne la ligne d'adhésion. */
  private aggregateOf(member: ConfigEntry): { header: string; lines: RegExp } | null {
    for (const c of member.children ?? []) {
      const cmd = this.profile.commands[c.cmd];
      if (!cmd?.aggregate || c.text.startsWith('no ')) continue;
      const i = this.firstParam(c.cmd);
      const value = c.text.split(' ')[i] ?? '';
      return { header: fill(cmd.aggregate.section, this.vars, [value]), lines: new RegExp(cmd.aggregate.lines, 'i') };
    }
    return null;
  }

  /** Une interface rejoint un agrégat : il hérite du premier membre, les suivants héritent de lui. */
  private joinAggregate(pattern: string, header: string, existed: boolean): void {
    const re = new RegExp(pattern, 'i');
    const agg = this.section(header);
    if (!agg?.children) return;
    let first = !existed;
    for (const t of this.targets) {
      const member = this.section(t);
      if (!member?.children || member === agg) continue;
      if (first) {
        agg.children = [...agg.children.filter((c) => !re.test(c.text)), ...member.children.filter((c) => re.test(c.text)).map((c) => ({ ...c }))];
        first = false;
      } else {
        member.children = [...member.children.filter((c) => !re.test(c.text)), ...agg.children.filter((c) => re.test(c.text)).map((c) => ({ ...c }))];
      }
    }
  }

  /** Après une modification d'un agrégat, ses membres reçoivent ses lignes recopiées. */
  private syncAggregates(targets: string[]): void {
    if (!targets.length || !this.profile.commands.some((c) => c.aggregate)) return;
    const members = this.sections().map((e) => ({ e, agg: this.aggregateOf(e) })).filter((m) => m.agg !== null);
    for (const t of targets) {
      const agg = this.section(t);
      if (!agg?.children) continue;
      for (const m of members) {
        if (m.agg!.header !== t || !m.e.children) continue;
        const re = m.agg!.lines;
        m.e.children = [...m.e.children.filter((c) => !re.test(c.text)), ...agg.children.filter((c) => re.test(c.text)).map((c) => ({ ...c }))];
      }
    }
  }

  /** Numéro de séquence en tête d'une commande numérotée, et le reste de la commande. */
  private sequenceOf(cand: Cand): { seq: number; text: string } | null {
    const first = cand.seq.elems[0];
    const n = cand.canon[0];
    if (first?.kind !== 'param' || first.type !== 'number' || n === undefined || !/^\d+$/.test(n)) return null;
    return { seq: Number(n), text: cand.canon.slice(1).join(' ') };
  }

  /** Range une entrée numérotée ; renvoie un message d'erreur si le numéro est déjà pris. */
  private storeSequenced(list: ConfigEntry[], cmdIndex: number, cand: Cand): string | null {
    const given = this.sequenceOf(cand);
    const text = given ? given.text : cand.canon.join(' ');
    if (!given && list.some((e) => same(e.text, text))) return null;
    const last = Math.max(0, ...list.map((e) => e.seq ?? 0));
    const seq = given ? given.seq : last + 10;
    if (list.some((e) => e.seq === seq)) return this.profile.messages.duplicateSequence;
    const entry: ConfigEntry = { text, cmd: cmdIndex, seq };
    const at = list.findIndex((e) => (e.seq ?? Number.POSITIVE_INFINITY) > seq);
    if (at === -1) list.push(entry);
    else list.splice(at, 0, entry);
    return null;
  }

  /** Une plage d'interfaces ouvre des sections d'interface ordinaires (le mode de la section est celui d'une interface). */
  private rangeSectionMode(mode: string): string {
    const first = this.profile.commands.find((c) => c.enter?.mode === mode)?.syntax.split(' ')[0];
    const single = this.profile.commands.find((c) => c.enter && !c.enter.range && c.syntax.split(' ')[0] === first);
    return single?.enter?.mode ?? mode;
  }

  private isPhysical(header: string): boolean {
    return this.interfaces.some((i) => same(`interface ${i}`, header));
  }

  private error(kind: 'invalid' | 'ambiguous' | 'incomplete', at: number, tokens: Token[], line: string, promptLen: number): string {
    const m = this.profile.messages;
    if (kind === 'ambiguous') return fill(m.ambiguous, { input: line.trim() });
    if (kind === 'incomplete') return m.incomplete;
    const unknown = this.grammar.mode(this.mode).unknownCommand;
    if (at === 0 && tokens.length === 1 && unknown) return fill(unknown, { input: line.trim() });
    const col = promptLen + (tokens[at]?.start ?? line.length);
    return `${' '.repeat(col)}^\n${m.invalid}`;
  }

  private help(line: string): { output: string; ok: boolean } {
    const body = line.slice(0, -1);
    const tokens = tokenize(body);
    const trailingSpace = body.length === 0 || /\s$/.test(body);
    const mode = this.grammar.mode(this.mode);
    const kwHelp = (word: string, cmd?: TerminalCommand) => cmd?.help[word] ?? this.profile.keywordHelp[word] ?? '';
    const columns = (rows: [string, string][]) => {
      const width = Math.max(...rows.map(([a]) => a.length)) + 2;
      return rows.map(([a, b]) => `  ${a.padEnd(width)}${b}`.trimEnd()).join('\n');
    };

    // Candidats après les mots déjà saisis, dans le mode courant (pseudo-mots `no` et `do` compris).
    const prefixTokens = trailingSpace ? tokens : tokens.slice(0, -1);
    const partialWord = trailingSpace ? '' : (tokens[tokens.length - 1]?.text.toLowerCase() ?? '');
    const seqs = this.seqsHere(this.mode);
    let pool: Cand[];
    if (prefixTokens.length === 0) {
      pool = [...this.pseudoSeqs(this.mode), ...seqs].map((seq) => ({ seq, pos: 0, canon: [], values: [], at: [] }));
    } else {
      const first = prefixTokens[0]?.text.toLowerCase() ?? '';
      const negating = this.isConfig() && 'no'.startsWith(first) && first.length >= 2;
      const doing = this.isConfig() && this.profile.doKeyword !== undefined && this.profile.doKeyword === first;
      const scope = doing ? this.grammar.seqs(this.profile.endMode, this.spec.type) : seqs;
      const from = negating || doing ? 1 : 0;
      const w = this.walk(scope, prefixTokens, body, from);
      if (w.kind !== 'ok') {
        if (w.kind === 'ambiguous') return { output: fill(this.profile.messages.ambiguous, { input: body.trim() }), ok: false };
        const col = this.prompt().length + (prefixTokens[w.at]?.start ?? body.length);
        return { output: `${' '.repeat(col)}^\n${this.profile.messages.invalid}`, ok: false };
      }
      pool = w.alive;
    }

    if (!trailingSpace) {
      const words = this.keywordsAt(pool, partialWord);
      if (!words.length) return { output: this.profile.messages.unrecognized, ok: false };
      return { output: words.join('  '), ok: true };
    }

    const rows = new Map<string, string>();
    let cr = false;
    for (const c of pool) {
      const elem = c.seq.elems[c.pos];
      const cmd = this.profile.commands[c.seq.cmd];
      if (!elem) {
        cr = true;
        continue;
      }
      if (elem.kind === 'kw') {
        if (!rows.has(elem.word)) rows.set(elem.word, kwHelp(elem.word, cmd));
      } else if (elem.type === 'interface' || elem.type === 'interface-range') {
        for (const [name, h] of interfaceTypeHelp(this.ctx)) if (!rows.has(name)) rows.set(name, h);
      } else {
        const label = paramLabel(elem);
        if (!rows.has(label)) rows.set(label, cmd?.help[elem.label] ?? this.profile.paramHelp[elem.type] ?? '');
      }
    }
    const list: [string, string][] = [...rows.entries()].sort(([a], [b]) => {
      const pa = a.startsWith('<') || /^[A-Z.:]+/.test(a) ? 1 : 0;
      const pb = b.startsWith('<') || /^[A-Z.:]+/.test(b) ? 1 : 0;
      return pa - pb || a.localeCompare(b);
    });
    if (cr) list.push(['<cr>', '']);
    if (!list.length) return { output: this.profile.messages.unrecognized, ok: false };
    const text = columns(list);
    return { output: prefixTokens.length === 0 ? `${mode.helpTitle}\n${text}` : text, ok: true };
  }

  /** Mots-clés possibles à la position des candidats, qui commencent par `prefix`. */
  private keywordsAt(pool: Cand[], prefix: string): string[] {
    return [...new Set(pool.map((c) => c.seq.elems[c.pos]).filter((e): e is Extract<SyntaxElem, { kind: 'kw' }> => e?.kind === 'kw').map((e) => e.word))]
      .filter((w) => w.startsWith(prefix))
      .sort();
  }

  /**
   * Complétion (touche Tab d'IOS) : si le dernier mot commencé ne peut être qu'un seul mot-clé, la ligne
   * est complétée (suivie d'une espace) ; sinon elle est rendue telle quelle. Rien n'est exécuté ni enregistré.
   */
  complete(line: string): string {
    const body = line.replace(/^\s+/, '');
    if (!body || /\s$/.test(body)) return line;
    const tokens = tokenize(body);
    const last = tokens[tokens.length - 1] as Token;
    const prefixTokens = tokens.slice(0, -1);
    const partial = last.text.toLowerCase();
    let pool: Cand[];
    if (!prefixTokens.length) {
      pool = [...this.pseudoSeqs(this.mode), ...this.seqsHere(this.mode)].map((seq) => ({ seq, pos: 0, canon: [], values: [], at: [] }));
    } else {
      const first = prefixTokens[0]?.text.toLowerCase() ?? '';
      const negating = this.isConfig() && 'no'.startsWith(first) && first.length >= 2;
      const doing = this.isConfig() && this.profile.doKeyword !== undefined && this.profile.doKeyword === first;
      const scope = doing ? this.grammar.seqs(this.profile.endMode, this.spec.type) : this.seqsHere(this.mode);
      const w = this.walk(scope, prefixTokens, body, negating || doing ? 1 : 0);
      if (w.kind !== 'ok') return line;
      pool = w.alive;
    }
    const words = this.keywordsAt(pool, partial);
    if (words.length !== 1) return line;
    return `${body.slice(0, last.start)}${words[0]} `;
  }

  private applyPipe(output: string, filter: string | null): string {
    if (filter === null) return output;
    const m = /^(include|exclude|begin|section)\s+(.+)$/i.exec(filter.trim());
    if (!m) return output;
    const kind = (m[1] as string).toLowerCase();
    let re: RegExp;
    try {
      re = new RegExp(m[2] as string, 'i');
    } catch {
      re = new RegExp((m[2] as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    const lines = output.split('\n');
    if (kind === 'include') return lines.filter((l) => re.test(l)).join('\n');
    if (kind === 'exclude') return lines.filter((l) => !re.test(l)).join('\n');
    if (kind === 'begin') {
      const i = lines.findIndex((l) => re.test(l));
      return i >= 0 ? lines.slice(i).join('\n') : '';
    }
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i] as string;
      if (/^\S/.test(l) && re.test(l)) {
        out.push(l);
        while (i + 1 < lines.length && /^\s/.test(lines[i + 1] as string)) out.push(lines[++i] as string);
      } else if (/^\s/.test(l) && re.test(l)) {
        out.push(l);
      }
    }
    return out.join('\n');
  }

  /** Exécute une ligne saisie. `\x1a` (Ctrl+Z) vaut `end` en configuration. */
  execute(input: string): ExecResult {
    const before = this.prompt();
    if (input === '\x1a') {
      const out: string[] = [];
      if (this.isConfig()) this.goTo(this.profile.endMode, out);
      return { echo: `${before}${this.profile.messages.ctrlZ}`, output: out.join('\n'), prompt: this.prompt(), status: 'ok' };
    }
    const line = input.replace(/[\r\n]/g, '');
    const echo = `${before}${line}`;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('!')) return { echo, output: '', prompt: before, status: 'empty' };

    if (trimmed.endsWith('?')) {
      const h = this.help(line.trimStart());
      return { echo, output: h.output, prompt: before, status: h.ok ? 'help' : 'error', keep: line.trimStart().slice(0, -1) };
    }

    // `show … | include …` : filtre appliqué à la sortie.
    const pipeAt = line.indexOf(' | ');
    const commandPart = pipeAt >= 0 ? line.slice(0, pipeAt) : line;
    const filter = pipeAt >= 0 ? line.slice(pipeAt + 3) : null;

    let tokens = tokenize(commandPart);
    let r = this.resolve(tokens, commandPart);
    if (r.kind === 'ok' && r.r.cmd.rewrite && !r.r.partial) {
      // `standby 0 ip …` est relue comme `standby ip …`.
      const re = new RegExp(r.r.cmd.rewrite.pattern, 'i');
      const canon = r.r.cand.canon.join(' ');
      if (re.test(canon)) {
        const text = `${r.r.negated ? 'no ' : ''}${canon.replace(re, r.r.cmd.rewrite.replace)}`;
        const t2 = tokenize(text);
        const r2 = this.resolveIn(r.r.mode, t2, text);
        if (r2.kind === 'ok') {
          r = r2;
          tokens = t2;
        }
      }
    }
    if (r.kind !== 'ok') {
      return { echo, output: this.error(r.kind, r.at, tokens, commandPart, before.length), prompt: before, status: 'error' };
    }
    if (filter !== null && r.r.cmd.output === undefined && !r.r.cmd.builtin) {
      return { echo, output: this.error('invalid', tokens.length, tokens, line, before.length), prompt: before, status: 'error' };
    }
    const historyBefore = this.history.length;
    const snapshot = JSON.stringify(this.config);
    this.current = { tokens, promptLen: before.length };
    const out = this.apply(r.r);
    this.current = null;
    this.mergeBlocks();
    const refused = this.history.length === historyBefore;
    const last = this.history[this.history.length - 1];
    if (!refused && last) last.changed = JSON.stringify(this.config) !== snapshot;
    return {
      echo,
      output: this.applyPipe(out.join('\n'), filter),
      prompt: this.prompt(),
      status: refused ? 'error' : 'ok',
    };
  }

  /**
   * Lignes d'une section, ou de la configuration globale si `header` est vide ; la configuration globale
   * comprend les sections affichées à plat (`access-list 10 permit …`).
   */
  linesOf(header?: string): string[] {
    if (!header) {
      return this.config.flatMap((e) => {
        if (!e.children) return [e.text];
        const flat = this.flatPrefix(e);
        return flat ? e.children.map((c) => `${flat.prefix} ${c.text}`) : [];
      });
    }
    return this.section(header)?.children?.map((e) => e.text) ?? [];
  }

  sectionHeaders(): string[] {
    return this.sections().map((e) => e.text);
  }
}
