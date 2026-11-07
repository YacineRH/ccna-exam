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

export class TerminalDevice {
  readonly grammar: TerminalGrammar;
  readonly profile: TerminalProfile;
  mode: string;
  targets: string[] = [];
  vars: Record<string, string>;
  config: ConfigEntry[] = [];
  history: HistoryEntry[] = [];
  readonly interfaces: string[];

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
    let alive: Cand[] = [...pseudo, ...seqs].map((seq) => ({ seq, pos: 0, canon: [], values: [] }));
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

  private pseudoSeqs(mode: string): Seq[] {
    if (!this.isConfig(mode)) return [];
    const list: Seq[] = [{ elems: [{ kind: 'kw', word: 'no' }], cmd: PSEUDO_NO, lead: 1 }];
    if (this.profile.doKeyword) list.push({ elems: [{ kind: 'kw', word: this.profile.doKeyword }], cmd: PSEUDO_DO, lead: 1 });
    return list;
  }

  /** Résout une ligne dans un mode donné. */
  private resolveIn(mode: string, tokens: Token[], line: string): Resolution {
    const seqs = this.grammar.seqs(mode, this.spec.type);
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

  section(header: string): ConfigEntry | undefined {
    return this.config.find((e) => e.children && same(e.text, header));
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

  private checkRequirements(cmd: TerminalCommand, targets: string[], values: string[]): string | null {
    for (const req of cmd.requires ?? []) {
      if (req.var !== undefined) {
        const v = this.vars[req.var];
        if (v === undefined) return fill(req.message, this.vars, values);
        if (req.min !== undefined && !(Number(v) >= req.min)) return fill(req.message, this.vars, values);
        if (req.notEquals !== undefined && same(v, fill(req.notEquals, this.vars))) return fill(req.message, this.vars, values);
      }
      if (req.config !== undefined) {
        const re = new RegExp(req.config, 'i');
        if (!this.config.some((e) => !e.children && re.test(e.text))) return fill(req.message, this.vars, values);
      }
      if (req.section !== undefined) {
        const re = new RegExp(req.section, 'i');
        for (const t of targets) {
          const s = this.section(t);
          if (!s?.children?.some((e) => re.test(e.text))) {
            const name = t.replace(/^\S+\s+/, '');
            return fill(req.message, this.vars, values, name);
          }
        }
      }
    }
    return null;
  }

  private store(list: ConfigEntry[], entry: ConfigEntry, cmd: TerminalCommand, canon: string[]): void {
    const key = this.keyOf(cmd, canon);
    const idx = key !== null ? list.findIndex((e) => e.cmd === entry.cmd && !e.text.startsWith('no ') && this.keyOf(cmd, e.text.split(' ')) === key) : -1;
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
    for (const e of this.config) {
      if (onlySection !== undefined && !(e.children && same(e.text, onlySection))) continue;
      if (e.children) {
        if (e.mode && this.grammar.mode(e.mode).hidden) continue;
        if (lines.length && lines[lines.length - 1] !== separator) lines.push(separator);
        lines.push(display(e));
        for (const c of e.children) lines.push(`${indent}${display(c)}`);
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
      if (cmd.enter) {
        this.config = this.config.filter((e) => !(e.children && same(e.text, canonText) && !this.isPhysical(e.text)));
        this.history.push({ mode: r.mode, targets: [...this.targets], canonical: `no ${canonText}` });
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
        const positive = (e: ConfigEntry) => {
          if (e.text.startsWith('no ')) return false;
          if (r.partial) return r.partialCmds.includes(e.cmd) && e.text.toLowerCase().startsWith(`${canonText.toLowerCase()} `);
          if (e.cmd !== cmdIndex) return false;
          return key !== null ? this.keyOf(cmd, e.text.split(' ')) === key : same(e.text, canonText);
        };
        const had = list.some(positive);
        for (let i = list.length - 1; i >= 0; i--) if (positive(list[i] as ConfigEntry)) list.splice(i, 1);
        const mode = cmd.negate ?? 'remove';
        if (mode === 'store' || (mode === 'toggle' && !had)) {
          if (!list.some((e) => same(e.text, `no ${canonText}`))) list.push({ text: `no ${canonText}`, cmd: cmdIndex });
        }
      }
      this.history.push({ mode: r.mode, targets: [...this.targets], canonical: `no ${canonText}` });
      return out;
    }

    const problem = this.checkRequirements(cmd, this.targets, cand.values);
    if (problem !== null) return [problem];

    const historyTargets = [...this.targets];

    if (cmd.enter && !r.viaDo) {
      const headers = cmd.enter.range ? (cand.targets ?? []).map((t) => `${cand.canon[0]} ${t}`) : [canonText];
      const sectionMode = cmd.enter.range ? this.rangeSectionMode(cmd.enter.mode) : cmd.enter.mode;
      for (const h of headers) this.ensureSection(h, cmdIndex, sectionMode);
      this.mode = cmd.enter.mode;
      this.targets = headers;
    } else if (config && cmd.store !== false && !cmd.goto && !cmd.exit && !cmd.end) {
      const { lists } = this.scopes(this.targets);
      for (const list of lists) {
        if (cmd.list) {
          this.applyList(list, cmdIndex, cmd, cand.values);
          continue;
        }
        const negIdx = list.findIndex((e) => e.cmd === cmdIndex && same(e.text, `no ${canonText}`));
        if (negIdx >= 0) list.splice(negIdx, 1);
        if (cmd.negate === 'store' || (cmd.negate === 'toggle' && negIdx >= 0)) continue;
        this.store(list, { text: canonText, cmd: cmdIndex }, cmd, cand.canon);
      }
    }

    for (const tpl of cmd.create ?? []) {
      const header = fill(tpl, this.vars, cand.values);
      const first = header.split(' ')[0]?.toLowerCase();
      const creator = this.profile.commands.findIndex((c) => c.enter && !c.enter.range && c.syntax.split(' ')[0] === first);
      const existed = this.section(header) !== undefined;
      this.ensureSection(header, creator, this.profile.commands[creator]?.enter?.mode ?? this.mode);
      if (!existed && cmd.createOutput !== undefined) out.push(fill(cmd.createOutput, this.vars, cand.values));
    }
    for (const [name, value] of Object.entries(cmd.set ?? {})) this.vars[name] = fill(value, this.vars, cand.values);

    this.history.push({ mode: r.mode, targets: historyTargets, canonical: canonText });

    if (cmd.builtin === 'running-config') out.push(this.runningConfig(cand.values));
    if (cmd.output !== undefined) out.push(fill(cmd.output, this.vars, cand.values, historyTargets[0]?.replace(/^\S+\s+/, '') ?? ''));

    if (!r.viaDo) {
      if (cmd.goto) this.goTo(cmd.goto, out);
      if (cmd.end && this.isConfig()) this.goTo(this.profile.endMode, out);
      if (cmd.exit) this.exitMode(out);
    }
    return out;
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
    const seqs = this.grammar.seqs(this.mode, this.spec.type);
    let pool: Cand[];
    if (prefixTokens.length === 0) {
      pool = [...this.pseudoSeqs(this.mode), ...seqs].map((seq) => ({ seq, pos: 0, canon: [], values: [] }));
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
      const words = [...new Set(pool.map((c) => c.seq.elems[c.pos]).filter((e): e is Extract<SyntaxElem, { kind: 'kw' }> => e?.kind === 'kw').map((e) => e.word))]
        .filter((w) => w.startsWith(partialWord))
        .sort();
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

    const tokens = tokenize(commandPart);
    const r = this.resolve(tokens, commandPart);
    if (r.kind !== 'ok') {
      return { echo, output: this.error(r.kind, r.at, tokens, commandPart, before.length), prompt: before, status: 'error' };
    }
    if (filter !== null && r.r.cmd.output === undefined && !r.r.cmd.builtin) {
      return { echo, output: this.error('invalid', tokens.length, tokens, line, before.length), prompt: before, status: 'error' };
    }
    const historyBefore = this.history.length;
    const out = this.apply(r.r);
    const refused = this.history.length === historyBefore;
    return {
      echo,
      output: this.applyPipe(out.join('\n'), filter),
      prompt: this.prompt(),
      status: refused ? 'error' : 'ok',
    };
  }

  /** Lignes d'une section (ou de la configuration globale si `header` est vide). */
  linesOf(header?: string): string[] {
    if (!header) return this.config.filter((e) => !e.children).map((e) => e.text);
    return this.section(header)?.children?.map((e) => e.text) ?? [];
  }

  sectionHeaders(): string[] {
    return this.sections().map((e) => e.text);
  }
}
