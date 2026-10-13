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
  bank: { questions: number; byDomain: Record<string, number>; exams: number };
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
  mode: AttemptMode;
  status: AttemptStatus;
  startedAt: string;
  deadlineAt: string | null;
  allowBackNavigation: boolean;
  furthestPosition: number;
  totalCount: number;
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
