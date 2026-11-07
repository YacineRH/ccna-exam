import type { AnswerKey, CertificationConfig, QuestionBody, Response } from '@examforge/core';

export type { AnswerKey, CertificationConfig, QuestionBody, Response };

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user' | string;
}

export interface CertificationSummary {
  code: string;
  name: string;
  vendor: string;
  examCode: string;
}

export interface CertificationDetail {
  certification: CertificationConfig;
  bank: {
    questions: number;
    byDomain: Record<string, number>;
    /** Questions publiées par type. */
    byType: Record<string, number>;
    /** Questions publiées par sous-thème (tous les sous-thèmes de la configuration, même vides). */
    bySubtopic: Record<string, number>;
    /** Questions publiées par domaine puis par type. */
    byDomainType: Record<string, Record<string, number>>;
    exams: number;
  };
}

export type AttemptMode = 'exam' | 'practice';
export type AttemptStatus = 'in_progress' | 'submitted' | 'expired';

export interface AttemptQuestion {
  id: string;
  position: number;
  domain: string;
  body: QuestionBody;
  response: Response | null;
  flagged: boolean;
  isCorrect?: boolean;
  explanation?: string;
}

export interface AttemptState {
  id: string;
  /** Code de la certification de la tentative. */
  certification: string;
  mode: AttemptMode;
  status: AttemptStatus;
  startedAt: string;
  deadlineAt: string | null;
  allowBackNavigation: boolean;
  furthestPosition: number;
  totalCount: number;
  /** Heure du serveur au moment de la réponse (ISO), pour corriger l'horloge du poste. */
  serverNow: string;
  questions: AttemptQuestion[];
}

export interface PracticeFeedback {
  correct: boolean;
  partial: number;
  key: AnswerKey;
  explanation: string;
  distractorNotes: Record<string, string>;
}

export interface SaveAnswerResult {
  saved: true;
  /** Heure du serveur à l'enregistrement (ISO) : le chrono se recale à chaque réponse. */
  serverNow: string;
  feedback?: PracticeFeedback;
}

export interface DomainScore {
  domain: string;
  correct: number;
  total: number;
  percent: number;
}

export interface ReviewItem {
  questionId: string;
  position: number;
  slug: string;
  domain: string;
  body: QuestionBody;
  key: AnswerKey;
  response: Response | null;
  isCorrect: boolean | null;
  flagged: boolean;
  secondsSpent: number;
  explanation: string;
  distractorNotes: Record<string, string>;
  reference: string | null;
}

export interface AttemptResult {
  id: string;
  certification: string;
  mode: AttemptMode;
  status: AttemptStatus;
  startedAt: string;
  submittedAt: string | null;
  correctCount: number | null;
  totalCount: number;
  scaledScore: number | null;
  passingScore: number;
  passed: boolean | null;
  domainScores: DomainScore[] | null;
  totalSeconds: number;
  suspicious: boolean;
  review: ReviewItem[];
}

export interface AttemptSummary {
  id: string;
  certification: string;
  mode: AttemptMode;
  status: AttemptStatus;
  startedAt: string;
  submittedAt: string | null;
  scaledScore: number | null;
  passed: boolean | null;
  correctCount: number | null;
  totalCount: number;
}

export type ReadinessLevel = 'ready' | 'almost' | 'not_ready';

export interface Stats {
  certification: string;
  passingScore: number;
  scale: { min: number; max: number };
  readiness: { estimate: number | null; level: ReadinessLevel; gap: number | null; examsConsidered: number };
  exams: { taken: number; lastAt: string | null };
  recentScores: { attemptId: string; scaledScore: number; submittedAt: string }[];
  questions: { answered: number; correct: number };
  labs?: { total: number; attempted: number; solved: number };
  totalSeconds: number;
  domains: { code: string; name: string; weight: number; answered: number; correct: number; percent: number | null }[];
  toReview: { domain: string; subtopic: string | null; subtopicName: string | null; errors: number; answered: number }[];
}

export interface InsufficientQuestionsDetails {
  domain: string;
  needed: number;
  available: number;
  poolSize: number;
}

export type LabDifficulty = 'easy' | 'medium' | 'hard';

export interface LabSummary {
  slug: string;
  title: string;
  difficulty: LabDifficulty;
  domain: string;
  subtopic: string;
  subtopicName: string;
  estimatedMinutes: number;
  objectiveCount: number;
  devices: string[];
  /** Sessions terminées. */
  attempts: number;
  /** Réussi au moins une fois. */
  done: boolean;
  /** Meilleur temps de réussite, en secondes. */
  bestSeconds: number | null;
  /** Session en cours, à reprendre. */
  inProgress: string | null;
}

export interface PublicLab {
  slug: string;
  title: string;
  difficulty: LabDifficulty;
  domain: string;
  subtopic: string;
  subtopicName: string;
  statement: string;
  topology: string;
  estimatedMinutes: number;
  hintCount: number;
  devices: { id: string; type: string }[];
  objectives: { id: string; description: string }[];
}

export interface LabDetail {
  certification: string;
  lab: PublicLab;
  attempts: number;
  done: boolean;
  bestSeconds: number | null;
  inProgress: string | null;
}

export type TerminalStatus = 'ok' | 'error' | 'help' | 'empty';

export interface TerminalLine {
  device: string;
  input: string;
  echo: string;
  output: string;
  status: TerminalStatus;
  keep?: string;
}

export interface LabStep {
  device: string;
  commands: string[];
}

export interface LabAttemptState {
  id: string;
  status: 'in_progress' | 'finished';
  startedAt: string;
  finishedAt: string | null;
  serverNow: string;
  lab: PublicLab;
  hintsUsed: number;
  hints: string[];
  devices: { id: string; type: string; prompt: string }[];
  transcript: TerminalLine[];
  achieved: string[];
  complete: boolean;
  commandCount: number;
  /** Seulement une fois la session terminée. */
  result: null | {
    success: boolean;
    durationSeconds: number | null;
    solution: LabStep[];
    variants: { description: string; solution: LabStep[] }[];
    explanation: string;
    reference: string;
    hints: string[];
    typed: LabStep[];
    runningConfig: Record<string, string>;
  };
}

export interface LabCommandResult {
  results: TerminalLine[];
  device: string;
  prompt: string;
  prompts: Record<string, string>;
  achieved: string[];
  complete: boolean;
  commandCount: number;
  serverNow: string;
}

export interface LabHintResult {
  level: number;
  hint: string;
  hints: string[];
  hintsUsed: number;
  hintCount: number;
}

export interface LabAttemptSummary {
  id: string;
  slug: string;
  title: string;
  difficulty: LabDifficulty;
  certification: string;
  subtopic: string;
  subtopicName: string;
  status: 'in_progress' | 'finished';
  startedAt: string;
  finishedAt: string | null;
  success: boolean | null;
  hintsUsed: number;
  commandCount: number;
  durationSeconds: number | null;
}
