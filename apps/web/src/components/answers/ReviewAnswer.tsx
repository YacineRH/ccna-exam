import { commandMatches, grade, type AnswerKey, type QuestionBody, type Response } from '@examforge/core';
import type { ReactNode } from 'react';
import { optionLetter } from '../../lib/format';

type Tone = 'ok' | 'missed' | 'wrong' | 'neutral';

const TONE: Record<Tone, { bg: string; border: string; color: string; symbol: string }> = {
  ok: { bg: 'rgba(61,220,151,0.08)', border: '1px solid rgba(61,220,151,0.35)', color: '#3DDC97', symbol: '✓' },
  missed: { bg: 'rgba(61,220,151,0.08)', border: '1px dashed rgba(61,220,151,0.5)', color: '#3DDC97', symbol: '✓' },
  wrong: { bg: 'rgba(255,107,94,0.08)', border: '1px solid rgba(255,107,94,0.4)', color: '#FF6B5E', symbol: '✕' },
  neutral: { bg: '#0C1320', border: '1px solid #1A2539', color: '#93A1B8', symbol: '' },
};

function Row({ tone, tag, children, note }: { tone: Tone; tag: string; children: ReactNode; note?: string }) {
  const t = TONE[tone];
  return (
    <div className="flex items-start gap-2.5 rounded-lg px-3 py-2.5" style={{ background: t.bg, border: t.border }}>
      <span className="shrink-0 font-mono text-[13px] font-semibold" style={{ color: t.color }}>
        {tag}
        {t.symbol && ` ${t.symbol}`}
      </span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
      {note && (
        <span className="ml-auto shrink-0 font-mono text-[11px] font-medium" style={{ color: tone === 'missed' ? '#93A1B8' : t.color }}>
          {note}
        </span>
      )}
    </div>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px]">{children}</span>;
}

/** Réponse donnée face à la correction, élément par élément, avec ✓ / ✕ (jamais la couleur seule). */
export function ReviewAnswer({ body, answerKey, response }: { body: QuestionBody; answerKey: AnswerKey; response: Response | null }) {
  const unanswered = response === null;
  const content = (() => {
    switch (body.type) {
      case 'mcq_single':
      case 'mcq_multi': {
        const correct = new Set(
          answerKey.type === 'mcq_single' ? [answerKey.correct] : answerKey.type === 'mcq_multi' ? answerKey.correct : [],
        );
        const picked = new Set(
          response?.type === 'mcq_single' ? [response.choice] : response?.type === 'mcq_multi' ? response.choices : [],
        );
        return body.options.map((o, i) => {
          const isKey = correct.has(o.id);
          const isPicked = picked.has(o.id);
          const tone: Tone = isKey ? (isPicked ? 'ok' : 'missed') : isPicked ? 'wrong' : 'neutral';
          const note = isPicked ? 'votre choix' : isKey ? (unanswered ? 'bonne réponse' : 'manquée') : undefined;
          return (
            <Row key={o.id} tone={tone} tag={optionLetter(i)} {...(note ? { note } : {})}>
              {o.text}
            </Row>
          );
        });
      }
      case 'fill_blank': {
        if (answerKey.type !== 'fill_blank') return null;
        const given = response?.type === 'fill_blank' ? response.fields : {};
        return body.fields.map((f) => {
          const spec = answerKey.fields[f.id];
          const value = given[f.id] ?? '';
          const ok = spec
            ? grade({ type: 'fill_blank', fields: { [f.id]: spec } }, { type: 'fill_blank', fields: { [f.id]: value } }).correct
            : false;
          return (
            <Row key={f.id} tone={ok ? 'ok' : 'wrong'} tag={f.label}>
              <span className="flex flex-col gap-0.5">
                <span>
                  Votre réponse : <Mono>{value || '—'}</Mono>
                </span>
                {!ok && spec && (
                  <span className="text-text2">
                    Attendu : <Mono>{spec.accepted.join(' ou ')}</Mono>
                  </span>
                )}
              </span>
            </Row>
          );
        });
      }
      case 'cli': {
        if (answerKey.type !== 'cli') return null;
        const lines = response?.type === 'cli' ? response.lines.map((l) => l.trim()).filter(Boolean) : [];
        const rows = answerKey.commands.map((accepted, i) => {
          const line = answerKey.ordered ? lines[i] : lines.find((l) => commandMatches(l, accepted));
          const ok = line !== undefined && commandMatches(line, accepted);
          return (
            <Row key={i} tone={ok ? 'ok' : 'wrong'} tag={`L${i + 1}`}>
              <span className="flex flex-col gap-0.5">
                <span>
                  Saisi : <Mono>{(answerKey.ordered ? lines[i] : line) ?? '—'}</Mono>
                </span>
                {!ok && (
                  <span className="text-text2">
                    Attendu : <Mono>{accepted.join('  |  ')}</Mono>
                  </span>
                )}
              </span>
            </Row>
          );
        });
        const extra = lines.length - answerKey.commands.length;
        return (
          <>
            {!answerKey.ordered && <p className="font-mono text-[12px] text-muted">Ordre des commandes libre.</p>}
            {rows}
            {extra > 0 && (
              <Row tone="wrong" tag="+">
                {extra} ligne{extra > 1 ? 's' : ''} en trop : <Mono>{lines.slice(answerKey.commands.length).join(' ; ')}</Mono>
              </Row>
            )}
          </>
        );
      }
      case 'ordering': {
        if (answerKey.type !== 'ordering') return null;
        const text = new Map(body.items.map((i) => [i.id, i.text]));
        const given = response?.type === 'ordering' ? response.order : [];
        return answerKey.order.map((id, i) => {
          const ok = given[i] === id;
          return (
            <Row key={id} tone={ok ? 'ok' : 'wrong'} tag={`${i + 1}.`}>
              <span className="flex flex-col gap-0.5">
                <span>{text.get(id)}</span>
                {!ok && (
                  <span className="text-text2">
                    Vous aviez placé ici : {given[i] ? text.get(given[i] as string) : '—'}
                  </span>
                )}
              </span>
            </Row>
          );
        });
      }
      case 'matching': {
        if (answerKey.type !== 'matching') return null;
        const right = new Map(body.right.map((r) => [r.id, r.text]));
        const given = response?.type === 'matching' ? response.pairs : {};
        return body.left.map((l) => {
          const expected = answerKey.pairs[l.id];
          const mine = given[l.id];
          const ok = mine !== undefined && mine === expected;
          return (
            <Row key={l.id} tone={ok ? 'ok' : 'wrong'} tag="→">
              <span className="flex flex-col gap-0.5">
                <span>
                  {l.text} → <strong className="font-medium">{mine ? right.get(mine) : '—'}</strong>
                </span>
                {!ok && expected && <span className="text-text2">Attendu : {right.get(expected)}</span>}
              </span>
            </Row>
          );
        });
      }
    }
  })();

  return (
    <div className="flex flex-col gap-2">
      {unanswered && <p className="font-mono text-[12px] font-medium text-warn">▲ Sans réponse</p>}
      {content}
    </div>
  );
}

/** Notes « pourquoi c'est faux » : lettres d'options pour les QCM. */
export function DistractorNotes({ body, notes }: { body: QuestionBody; notes: Record<string, string> }) {
  const entries = Object.entries(notes);
  if (entries.length === 0) return null;
  const label = (id: string) => {
    if (body.type === 'mcq_single' || body.type === 'mcq_multi') {
      const i = body.options.findIndex((o) => o.id === id);
      return i >= 0 ? optionLetter(i) : id;
    }
    return id;
  };
  return (
    <ul className="flex flex-col gap-1.5">
      {entries.map(([id, note]) => (
        <li key={id} className="text-text2">
          <span className="text-crit">{label(id)} est faux :</span> {note}
        </li>
      ))}
    </ul>
  );
}
