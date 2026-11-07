import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { LabSession, toPublicLab, type ExecResult, type Lab, type LabKind, type TerminalProfile } from '@examforge/core';
import { loadLabProfile } from '@examforge/content';
import type { Db } from '../db/client.js';
import { certifications, domains, labAttemptCommands, labAttempts, labs, subtopics, type LabAttempt } from '../db/schema.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';

/*
 * Labs CLI. Une session ne garde que les commandes saisies : l'état des équipements est
 * reconstitué en les rejouant dans l'ordre (le simulateur est déterministe et sans I/O).
 * La solution, l'explication et le détail des objectifs ne sortent qu'après `finish`.
 */

/** Plafonds d'une session : lignes par envoi, longueur d'une ligne, commandes au total. */
export const LAB_LIMITS = { linesPerRequest: 60, lineLength: 300, commandsPerAttempt: 1500 };

/**
 * Challenge : tolérance après l'échéance (latence réseau). Au-delà, plus aucune commande n'est
 * acceptée et la session se termine d'elle-même, à la prochaine requête qui la touche.
 */
export const CHALLENGE_GRACE_MS = 5_000;

const profiles = new Map<string, TerminalProfile | null>();

/** Profil de terminal d'une certification (packages/content), ou null si elle n'a pas de labs. */
export function profileFor(certCode: string): TerminalProfile | null {
  if (!profiles.has(certCode)) profiles.set(certCode, loadLabProfile(certCode));
  return profiles.get(certCode) ?? null;
}

function requireProfile(certCode: string): TerminalProfile {
  const p = profileFor(certCode);
  if (!p) throw conflict('no_lab_profile', `La certification ${certCode} n'a pas de profil de terminal`);
  return p;
}

interface TranscriptLine {
  device: string;
  /** Saisie brute (`\x1a` pour Ctrl+Z), pour l'historique ↑/↓ du terminal. */
  input: string;
  echo: string;
  output: string;
  status: ExecResult['status'];
}

function replay(profile: TerminalProfile, lab: Lab, commands: { device: string; input: string }[]) {
  const session = new LabSession(profile, lab);
  const transcript: TranscriptLine[] = [];
  for (const c of commands) {
    const r = session.run(c.device, c.input);
    transcript.push({ device: c.device, input: c.input, echo: r.echo, output: r.output, status: r.status });
  }
  return { session, transcript };
}

async function loadCommands(db: Db, attemptId: string) {
  return db
    .select({ device: labAttemptCommands.device, input: labAttemptCommands.input })
    .from(labAttemptCommands)
    .where(eq(labAttemptCommands.attemptId, attemptId))
    .orderBy(asc(labAttemptCommands.seq));
}

async function labRow(db: Db, where: ReturnType<typeof eq>) {
  const [row] = await db
    .select({ lab: labs, certification: certifications.code, subtopicName: subtopics.name })
    .from(labs)
    .innerJoin(certifications, eq(certifications.id, labs.certificationId))
    .innerJoin(subtopics, eq(subtopics.id, labs.subtopicId))
    .where(where);
  return row;
}

async function ownedLabAttempt(db: Db, attemptId: string, userId: string) {
  const [attempt] = await db.select().from(labAttempts).where(eq(labAttempts.id, attemptId));
  if (!attempt) throw notFound('Session de lab introuvable');
  if (attempt.userId !== userId) throw forbidden();
  const row = await labRow(db, eq(labs.id, attempt.labId));
  if (!row) throw notFound('Lab introuvable');
  return { attempt, ...row };
}

const seconds = (from: Date, to: Date) => Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));

const pastDeadline = (a: Pick<LabAttempt, 'deadlineAt'>, graceMs = CHALLENGE_GRACE_MS, now = new Date()) =>
  a.deadlineAt !== null && now.getTime() > a.deadlineAt.getTime() + graceMs;

/**
 * Termine un challenge dont l'échéance est passée. Les commandes arrivées après l'échéance ayant
 * été refusées, l'état rejoué est celui de l'échéance. Renvoie vrai si la session vient d'être close.
 */
async function expireIfDue(db: Db, attempt: LabAttempt, lab: Lab, certification: string, graceMs = CHALLENGE_GRACE_MS): Promise<boolean> {
  if (attempt.status !== 'in_progress' || !pastDeadline(attempt, graceMs)) return false;
  const commands = await loadCommands(db, attempt.id);
  const success = replay(requireProfile(certification), lab, commands).session.complete();
  const done = await db
    .update(labAttempts)
    .set({ status: 'finished', finishedAt: attempt.deadlineAt, success, expired: true })
    .where(and(eq(labAttempts.id, attempt.id), eq(labAttempts.status, 'in_progress')))
    .returning({ id: labAttempts.id });
  return done.length > 0;
}

/** Durée retenue : jusqu'à la réussite si elle a eu lieu, sinon jusqu'à la fin. */
export function labDuration(a: Pick<LabAttempt, 'startedAt' | 'solvedAt' | 'finishedAt' | 'success'>): number | null {
  if (a.success && a.solvedAt) return seconds(a.startedAt, a.solvedAt);
  return a.finishedAt ? seconds(a.startedAt, a.finishedAt) : null;
}

function publicLab(lab: Lab, subtopicName: string) {
  return { ...toPublicLab(lab), subtopicName };
}

/** Commandes acceptées par l'équipement (ni erreur, ni aide, ni ligne vide) : « la configuration saisie ». */
function typedCommands(lab: Lab, commands: { device: string; input: string }[], transcript: TranscriptLine[]) {
  return lab.devices.map((d) => ({
    device: d.id,
    commands: commands
      .map((c, i) => ({ c, r: transcript[i] as TranscriptLine }))
      .filter(({ c, r }) => c.device === d.id && r.status === 'ok')
      .map(({ c }) => (c.input === '\x1a' ? '^Z' : c.input.trim())),
  }));
}

function attemptState(
  attempt: LabAttempt,
  lab: Lab,
  subtopicName: string,
  commands: { device: string; input: string }[],
  replayed: ReturnType<typeof replay>,
) {
  const { session, transcript } = replayed;
  const achieved = session.achieved();
  const finished = attempt.status === 'finished';
  return {
    id: attempt.id,
    kind: lab.kind,
    status: attempt.status,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    /** Challenge : échéance (le chrono du navigateur se recale sur `serverNow`). */
    deadlineAt: attempt.deadlineAt,
    expired: attempt.expired,
    serverNow: new Date().toISOString(),
    lab: publicLab(lab, subtopicName),
    hintsUsed: attempt.hintsUsed,
    hints: lab.hints.slice(0, attempt.hintsUsed),
    devices: lab.devices.map((d) => ({ id: d.id, type: d.type, prompt: session.device(d.id).prompt() })),
    transcript,
    achieved,
    complete: achieved.length === lab.objectives.length,
    commandCount: attempt.commandCount,
    // Révélé seulement une fois la session terminée.
    result: finished
      ? {
          success: attempt.success === true,
          durationSeconds: labDuration(attempt),
          solution: lab.solution,
          variants: lab.variants.map((v) => ({ description: v.description, solution: v.solution })),
          explanation: lab.explanation,
          reference: lab.reference,
          hints: lab.hints,
          expired: attempt.expired,
          targetMinutes: lab.challenge?.targetMinutes ?? null,
          faults: lab.challenge?.faults ?? [],
          typed: typedCommands(lab, commands, transcript),
          runningConfig: Object.fromEntries(lab.devices.map((d) => [d.id, session.device(d.id).renderConfig().join('\n')])),
        }
      : null,
  };
}

export type LabAttemptState = ReturnType<typeof attemptState>;

async function certificationByCode(db: Db, code: string) {
  const [cert] = await db.select().from(certifications).where(eq(certifications.code, code));
  if (!cert || !cert.active) throw notFound(`Certification inconnue : ${code}`);
  return cert;
}

/** Statistiques d'un utilisateur par lab : sessions, réussite, meilleur temps, session en cours. */
async function userLabStats(db: Db, userId: string, labIds: string[]) {
  if (!labIds.length) return new Map<string, { attempts: number; done: boolean; bestSeconds: number | null; inProgress: string | null }>();
  const rows = await db
    .select({
      labId: labAttempts.labId,
      attempts: sql<number>`count(*) filter (where ${labAttempts.status} = 'finished')::int`,
      successes: sql<number>`count(*) filter (where ${labAttempts.success})::int`,
      best: sql<number | null>`min(extract(epoch from (coalesce(${labAttempts.solvedAt}, ${labAttempts.finishedAt}) - ${labAttempts.startedAt}))) filter (where ${labAttempts.success})`,
      inProgress: sql<string | null>`(array_agg(${labAttempts.id} order by ${labAttempts.startedAt} desc) filter (where ${labAttempts.status} = 'in_progress'))[1]`,
    })
    .from(labAttempts)
    .where(and(eq(labAttempts.userId, userId), inArray(labAttempts.labId, labIds)))
    .groupBy(labAttempts.labId);
  return new Map(
    rows.map((r) => [
      r.labId,
      { attempts: r.attempts, done: r.successes > 0, bestSeconds: r.best === null ? null : Math.round(Number(r.best)), inProgress: r.inProgress },
    ]),
  );
}

export async function listLabs(db: Db, userId: string, certCode: string, kind: LabKind = 'lab') {
  const cert = await certificationByCode(db, certCode);
  const rows = await db
    .select({ id: labs.id, definition: labs.definition, domain: domains.code, subtopicName: subtopics.name })
    .from(labs)
    .innerJoin(domains, eq(domains.id, labs.domainId))
    .innerJoin(subtopics, eq(subtopics.id, labs.subtopicId))
    .where(and(eq(labs.certificationId, cert.id), eq(labs.status, 'published'), eq(labs.kind, kind)))
    .orderBy(asc(domains.position), asc(labs.slug));
  const stats = await userLabStats(db, userId, rows.map((r) => r.id));
  return {
    certification: cert.code,
    labs: rows.map((r) => {
      const lab = r.definition;
      const s = stats.get(r.id);
      return {
        slug: lab.slug,
        kind: lab.kind,
        challenge: lab.challenge ? { targetMinutes: lab.challenge.targetMinutes, timeLimitMinutes: lab.challenge.timeLimitMinutes, mode: lab.challenge.mode } : null,
        title: lab.title,
        difficulty: lab.difficulty,
        domain: lab.domain,
        subtopic: lab.subtopic,
        subtopicName: r.subtopicName,
        estimatedMinutes: lab.estimatedMinutes,
        objectiveCount: lab.objectives.length,
        devices: lab.devices.map((d) => d.id),
        attempts: s?.attempts ?? 0,
        done: s?.done ?? false,
        bestSeconds: s?.bestSeconds ?? null,
        inProgress: s?.inProgress ?? null,
      };
    }),
  };
}

export async function getLab(db: Db, userId: string, slug: string) {
  const row = await labRow(db, eq(labs.slug, slug));
  if (!row || row.lab.status !== 'published') throw notFound(`Lab inconnu : ${slug}`);
  const s = (await userLabStats(db, userId, [row.lab.id])).get(row.lab.id);
  return {
    certification: row.certification,
    lab: publicLab(row.lab.definition, row.subtopicName),
    attempts: s?.attempts ?? 0,
    done: s?.done ?? false,
    bestSeconds: s?.bestSeconds ?? null,
    inProgress: s?.inProgress ?? null,
  };
}

export async function startLabAttempt(db: Db, userId: string, slug: string) {
  const row = await labRow(db, eq(labs.slug, slug));
  if (!row || row.lab.status !== 'published') throw notFound(`Lab inconnu : ${slug}`);
  requireProfile(row.certification);
  const def = row.lab.definition;
  const now = new Date();
  if (def.kind === 'challenge') {
    // Un seul essai en cours par challenge : un nouveau départ abandonne le précédent.
    const open = await db
      .select()
      .from(labAttempts)
      .where(and(eq(labAttempts.userId, userId), eq(labAttempts.labId, row.lab.id), eq(labAttempts.status, 'in_progress')));
    for (const a of open) {
      if (!(await expireIfDue(db, a, def, row.certification))) {
        await db.update(labAttempts).set({ status: 'finished', finishedAt: now, success: false }).where(eq(labAttempts.id, a.id));
      }
    }
  }
  const deadlineAt = def.challenge ? new Date(now.getTime() + def.challenge.timeLimitMinutes * 60_000) : null;
  const [attempt] = await db.insert(labAttempts).values({ userId, labId: row.lab.id, startedAt: now, deadlineAt }).returning();
  return getLabAttemptState(db, (attempt as LabAttempt).id, userId);
}

export async function getLabAttemptState(db: Db, attemptId: string, userId: string): Promise<LabAttemptState> {
  const owned = await ownedLabAttempt(db, attemptId, userId);
  if (await expireIfDue(db, owned.attempt, owned.lab.definition, owned.certification)) return getLabAttemptState(db, attemptId, userId);
  const { attempt, lab, certification, subtopicName } = owned;
  const commands = await loadCommands(db, attempt.id);
  return attemptState(attempt, lab.definition, subtopicName, commands, replay(requireProfile(certification), lab.definition, commands));
}

/** Découpe une saisie (collage multi-ligne compris) en lignes. Ctrl+Z (\x1a) forme une ligne à lui seul. */
export function splitInput(input: string): string[] {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/\x1a/g, '\n\x1a\n')
    .split('\n')
    .map((l) => l.replace(/\t/g, ' '))
    .filter((l, i, all) => l.trim() !== '' || (all.length === 1 && i === 0));
}

export async function runLabCommands(db: Db, attemptId: string, userId: string, input: { device?: string; input: string }) {
  const { attempt: owned, lab, certification } = await ownedLabAttempt(db, attemptId, userId);
  if (await expireIfDue(db, owned, lab.definition, certification)) throw conflict('challenge_expired', 'Temps écoulé : le challenge est terminé');
  const profile = requireProfile(certification);
  const def = lab.definition;
  const device = input.device ?? def.devices[0]?.id;
  if (!device || !def.devices.some((d) => d.id === device)) throw badRequest(`Équipement inconnu : ${input.device}`);
  const lines = splitInput(input.input);
  if (lines.length > LAB_LIMITS.linesPerRequest) throw badRequest(`Au plus ${LAB_LIMITS.linesPerRequest} lignes par envoi`);
  if (lines.some((l) => l.length > LAB_LIMITS.lineLength)) throw badRequest(`Une ligne fait au plus ${LAB_LIMITS.lineLength} caractères`);

  const outcome = await db.transaction(async (tx) => {
    // Verrou sur la session : deux envois simultanés sont joués l'un après l'autre, dans l'ordre.
    const [attempt] = await tx.select().from(labAttempts).where(eq(labAttempts.id, owned.id)).for('update');
    if (!attempt) throw notFound('Session de lab introuvable');
    if (attempt.status !== 'in_progress') throw conflict('lab_finished', 'Cette session de lab est terminée');
    // L'échéance a pu passer pendant l'attente du verrou : la session sera close hors de la transaction.
    if (pastDeadline(attempt)) return { expired: true as const };
    if (attempt.commandCount + lines.length > LAB_LIMITS.commandsPerAttempt) {
      throw conflict('too_many_commands', `Au plus ${LAB_LIMITS.commandsPerAttempt} commandes par session`);
    }
    const previous = await tx
      .select({ device: labAttemptCommands.device, input: labAttemptCommands.input })
      .from(labAttemptCommands)
      .where(eq(labAttemptCommands.attemptId, attempt.id))
      .orderBy(asc(labAttemptCommands.seq));
    const { session } = replay(profile, def, previous);
    const wasComplete = session.complete();

    const results = lines.map((line) => {
      const r = session.run(device, line);
      return { device, input: line, echo: r.echo, output: r.output, status: r.status, ...(r.keep !== undefined ? { keep: r.keep } : {}) };
    });
    await tx.insert(labAttemptCommands).values(lines.map((l, i) => ({ attemptId: attempt.id, seq: previous.length + i, device, input: l })));
    const achieved = session.achieved();
    const complete = achieved.length === def.objectives.length;
    const now = new Date();
    // Un challenge s'arrête à la réussite : le chrono est figé, l'écran de fin s'affiche.
    const autoFinish = def.kind === 'challenge' && complete;
    await tx
      .update(labAttempts)
      .set({
        commandCount: previous.length + lines.length,
        ...(complete && !wasComplete && !attempt.solvedAt ? { solvedAt: now } : {}),
        ...(autoFinish ? { status: 'finished' as const, finishedAt: now, success: true } : {}),
      })
      .where(eq(labAttempts.id, attempt.id));
    return {
      expired: false as const,
      finished: autoFinish,
      results,
      device,
      prompt: session.device(device).prompt(),
      prompts: Object.fromEntries(def.devices.map((d) => [d.id, session.device(d.id).prompt()])),
      achieved,
      complete,
      commandCount: previous.length + lines.length,
      // Heure du serveur : le chrono du navigateur se recale à chaque commande.
      serverNow: now.toISOString(),
    };
  });
  if (outcome.expired) {
    await expireIfDue(db, (await ownedLabAttempt(db, attemptId, userId)).attempt, lab.definition, certification);
    throw conflict('challenge_expired', 'Temps écoulé : le challenge est terminé');
  }
  const { expired: _expired, ...result } = outcome;
  return result;
}

/**
 * Complétion d'une ligne (touche Tab d'IOS) dans l'état courant de l'équipement : rien n'est exécuté
 * ni enregistré. Sert la barre d'actions tactile du terminal.
 */
export async function completeLabLine(db: Db, attemptId: string, userId: string, input: { device?: string; input: string }) {
  const { attempt, lab, certification } = await ownedLabAttempt(db, attemptId, userId);
  if (attempt.status !== 'in_progress') throw conflict('lab_finished', 'Cette session de lab est terminée');
  const def = lab.definition;
  const device = input.device ?? def.devices[0]?.id;
  if (!device || !def.devices.some((d) => d.id === device)) throw badRequest(`Équipement inconnu : ${input.device}`);
  if (input.input.length > LAB_LIMITS.lineLength || /[\r\n]/.test(input.input)) throw badRequest('Une seule ligne, de 300 caractères au plus');
  const { session } = replay(requireProfile(certification), def, await loadCommands(db, attempt.id));
  return { device, completed: session.device(device).complete(input.input) };
}

export async function revealHint(db: Db, attemptId: string, userId: string) {
  const { attempt, lab } = await ownedLabAttempt(db, attemptId, userId);
  if (lab.definition.kind === 'challenge') throw conflict('no_hints', 'Un challenge se joue sans indice');
  if (attempt.status !== 'in_progress') throw conflict('lab_finished', 'Cette session de lab est terminée');
  const hints = lab.definition.hints;
  const [updated] = await db
    .update(labAttempts)
    .set({ hintsUsed: sql`least(${labAttempts.hintsUsed} + 1, ${hints.length})` })
    .where(and(eq(labAttempts.id, attempt.id), sql`${labAttempts.hintsUsed} < ${hints.length}`))
    .returning({ hintsUsed: labAttempts.hintsUsed });
  if (!updated) throw conflict('no_more_hints', 'Tous les indices ont déjà été donnés');
  return { level: updated.hintsUsed, hint: hints[updated.hintsUsed - 1], hints: hints.slice(0, updated.hintsUsed), hintsUsed: updated.hintsUsed, hintCount: hints.length };
}

export async function finishLabAttempt(db: Db, attemptId: string, userId: string): Promise<LabAttemptState> {
  const { attempt, lab, certification } = await ownedLabAttempt(db, attemptId, userId);
  // Le navigateur demande la fin quand son compte à rebours (recalé sur le serveur) atteint zéro :
  // à une seconde près de l'échéance, c'est une fin par l'échéance, pas un abandon.
  if (await expireIfDue(db, attempt, lab.definition, certification, -1000)) return getLabAttemptState(db, attempt.id, userId);
  if (attempt.status === 'in_progress') {
    const commands = await loadCommands(db, attempt.id);
    const { session } = replay(requireProfile(certification), lab.definition, commands);
    const success = session.complete();
    await db
      .update(labAttempts)
      .set({ status: 'finished', finishedAt: new Date(), success, ...(success && !attempt.solvedAt ? { solvedAt: new Date() } : {}) })
      .where(and(eq(labAttempts.id, attempt.id), eq(labAttempts.status, 'in_progress')));
  }
  return getLabAttemptState(db, attempt.id, userId);
}

/** Historique des sessions de lab d'un utilisateur. */
export async function listLabAttempts(db: Db, userId: string, opts: { certification?: string; kind?: LabKind; limit?: number } = {}) {
  const rows = await db
    .select({
      attempt: labAttempts,
      slug: labs.slug,
      title: labs.title,
      kind: labs.kind,
      difficulty: labs.difficulty,
      certification: certifications.code,
      subtopic: subtopics.code,
      subtopicName: subtopics.name,
    })
    .from(labAttempts)
    .innerJoin(labs, eq(labs.id, labAttempts.labId))
    .innerJoin(certifications, eq(certifications.id, labs.certificationId))
    .innerJoin(subtopics, eq(subtopics.id, labs.subtopicId))
    .where(
      and(
        eq(labAttempts.userId, userId),
        opts.certification ? eq(certifications.code, opts.certification) : undefined,
        opts.kind ? eq(labs.kind, opts.kind) : undefined,
      ),
    )
    .orderBy(desc(labAttempts.startedAt))
    .limit(opts.limit ?? 50);
  return rows.map((r) => ({
    id: r.attempt.id,
    slug: r.slug,
    kind: r.kind,
    title: r.title,
    difficulty: r.difficulty,
    certification: r.certification,
    subtopic: r.subtopic,
    subtopicName: r.subtopicName,
    status: r.attempt.status,
    startedAt: r.attempt.startedAt,
    finishedAt: r.attempt.finishedAt,
    success: r.attempt.success,
    hintsUsed: r.attempt.hintsUsed,
    commandCount: r.attempt.commandCount,
    expired: r.attempt.expired,
    durationSeconds: labDuration(r.attempt),
  }));
}

/**
 * Classement personnel d'un lab ou d'un challenge : tous les essais terminés, du plus ancien au plus
 * récent (pour la courbe des temps), et le meilleur temps parmi les réussites.
 */
export async function labTimes(db: Db, userId: string, slug: string) {
  const row = await labRow(db, eq(labs.slug, slug));
  if (!row || row.lab.status !== 'published') throw notFound(`Lab inconnu : ${slug}`);
  const rows = await db
    .select()
    .from(labAttempts)
    .where(and(eq(labAttempts.userId, userId), eq(labAttempts.labId, row.lab.id), eq(labAttempts.status, 'finished')))
    .orderBy(asc(labAttempts.startedAt));
  const times = rows.map((a) => ({
    id: a.id,
    startedAt: a.startedAt,
    success: a.success === true,
    expired: a.expired,
    durationSeconds: labDuration(a),
    hintsUsed: a.hintsUsed,
  }));
  const wins = times.filter((t) => t.success && t.durationSeconds !== null).map((t) => t.durationSeconds as number);
  return {
    slug,
    kind: row.lab.definition.kind,
    targetMinutes: row.lab.definition.challenge?.targetMinutes ?? null,
    bestSeconds: wins.length ? Math.min(...wins) : null,
    times,
  };
}
