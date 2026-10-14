import type { QuestionBody, Response } from '@examforge/core';
import { useId } from 'react';
import { optionLetter } from '../../lib/format';
import { moveItem, toggleChoice } from '../../lib/responses';
import { IconDown, IconUp } from '../Icons';

interface Props<B extends QuestionBody> {
  body: B;
  value: Response | null;
  onChange: (r: Response | null) => void;
  disabled?: boolean;
}

type Of<T extends QuestionBody['type']> = Extract<QuestionBody, { type: T }>;

function OptionButton({
  letter,
  text,
  selected,
  multi,
  disabled,
  onClick,
}: {
  letter: string;
  text: string;
  selected: boolean;
  multi: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center gap-3.5 rounded-[10px] border px-4 py-2.5 text-left text-[15px] text-text transition-colors hover:border-line2 disabled:opacity-70"
      style={{
        background: selected ? 'rgba(45,212,232,0.08)' : '#101827',
        borderColor: selected ? '#2DD4E8' : '#223049',
      }}
    >
      <span
        aria-hidden
        className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center border-[1.5px] text-[14px] font-bold text-accent-ink ${
          multi ? 'rounded-[5px]' : 'rounded-full'
        }`}
        style={{ borderColor: selected ? '#2DD4E8' : '#4A5B78', background: selected ? '#2DD4E8' : 'transparent' }}
      >
        {selected ? (multi ? '✓' : '●') : ''}
      </span>
      <span className="shrink-0 font-mono text-[13px] font-semibold text-muted">{letter}.</span>
      <span>{text}</span>
    </button>
  );
}

function McqSingle({ body, value, onChange, disabled }: Props<Of<'mcq_single'>>) {
  const choice = value?.type === 'mcq_single' ? value.choice : null;
  return (
    <div role="radiogroup" aria-label="Réponses (une seule)" className="flex max-w-[900px] flex-col gap-2.5">
      {body.options.map((o, i) => (
        <OptionButton
          key={o.id}
          letter={optionLetter(i)}
          text={o.text}
          multi={false}
          selected={choice === o.id}
          disabled={disabled}
          onClick={() => onChange({ type: 'mcq_single', choice: o.id })}
        />
      ))}
    </div>
  );
}

function McqMulti({ body, value, onChange, disabled }: Props<Of<'mcq_multi'>>) {
  const choices = value?.type === 'mcq_multi' ? value.choices : [];
  return (
    <div className="flex max-w-[900px] flex-col gap-2.5">
      <div role="group" aria-label={`Réponses (choisissez ${body.selectCount})`} className="flex flex-col gap-2.5">
        {body.options.map((o, i) => (
          <OptionButton
            key={o.id}
            letter={optionLetter(i)}
            text={o.text}
            multi
            selected={choices.includes(o.id)}
            disabled={disabled}
            onClick={() => onChange({ type: 'mcq_multi', choices: toggleChoice(choices, o.id, body.selectCount) })}
          />
        ))}
      </div>
      <div aria-live="polite" className="font-mono text-[12px] font-medium text-muted">
        {choices.length} / {body.selectCount} sélectionnées
        {choices.length === body.selectCount ? ' · une nouvelle sélection remplace la plus ancienne' : ''}
      </div>
    </div>
  );
}

function FillBlank({ body, value, onChange, disabled }: Props<Of<'fill_blank'>>) {
  const fields = value?.type === 'fill_blank' ? value.fields : {};
  const uid = useId();
  return (
    <div className="grid max-w-[900px] gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))]">
      {body.fields.map((f) => (
        <div key={f.id} className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-${f.id}`} className="text-[13px] text-text2">
            {f.label}
          </label>
          <span className="field">
            <input
              id={`${uid}-${f.id}`}
              type="text"
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              className="input-bare font-mono text-base font-medium"
              value={fields[f.id] ?? ''}
              onChange={(e) => onChange({ type: 'fill_blank', fields: { ...fields, [f.id]: e.target.value } })}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

function Cli({ body, value, onChange, disabled }: Props<Of<'cli'>>) {
  const lines = value?.type === 'cli' ? value.lines : [];
  const uid = useId();
  const all = Array.from({ length: body.lines }, (_, i) => lines[i] ?? '');
  const setLine = (i: number, v: string) => {
    const next = [...all];
    next[i] = v;
    onChange({ type: 'cli', lines: next });
  };
  return (
    <div className="max-w-[900px] overflow-hidden rounded-[10px] border border-[#223049]">
      <div className="flex items-center gap-2 border-b border-[#223049] bg-surface px-3.5 py-2 font-mono text-[12px] font-medium text-muted">
        <span className="led h-2 w-2 rounded-full bg-accent" aria-hidden />
        Terminal · {body.lines} commande{body.lines > 1 ? 's' : ''} attendue{body.lines > 1 ? 's' : ''}, une par ligne
      </div>
      <div className="flex flex-col gap-1 bg-[#060A11] px-4 py-3.5 font-mono text-[14px]">
        {all.map((line, i) => (
          <div key={i} className="flex min-h-[40px] items-center gap-2">
            <label htmlFor={`${uid}-${i}`} className="shrink-0 text-accent">
              <span className="sr-only">Commande {i + 1}, invite </span>
              {body.prompt}
            </label>
            <input
              id={`${uid}-${i}`}
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={disabled}
              value={line}
              onChange={(e) => setLine(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const next = document.getElementById(`${uid}-${i + 1}`);
                  next?.focus();
                }
              }}
              className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1.5 text-[#C9D4E5] caret-accent outline-none focus:border-line2 focus:bg-[#0B111D]"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function Ordering({ body, value, onChange, disabled }: Props<Of<'ordering'>>) {
  const order = value?.type === 'ordering' && value.order.length === body.items.length ? value.order : body.items.map((i) => i.id);
  const byId = new Map(body.items.map((i) => [i.id, i]));
  const move = (index: number, delta: number) => {
    onChange({ type: 'ordering', order: moveItem(order, index, delta) });
    // Le focus suit l'élément déplacé pour enchaîner au clavier.
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLButtonElement>(
        `[data-order-item="${order[index]}"] [data-dir="${delta < 0 ? 'up' : 'down'}"]:not(:disabled)`,
      );
      target?.focus();
    });
  };
  return (
    <div className="flex max-w-[900px] flex-col gap-2">
      <p className="text-[13px] text-text2">Utilisez les boutons Monter / Descendre pour remettre les éléments dans le bon ordre.</p>
      <ol className="flex flex-col gap-2" aria-label="Ordre actuel">
        {order.map((id, i) => {
          const item = byId.get(id);
          if (!item) return null;
          return (
            <li
              key={id}
              data-order-item={id}
              className="flex min-h-[52px] items-center gap-3 rounded-[10px] border border-[#223049] bg-surface py-1.5 pl-4 pr-1.5"
            >
              <span className="w-6 shrink-0 font-mono text-[13px] font-semibold text-accent">{i + 1}.</span>
              <span className="flex-1">{item.text}</span>
              <span className="flex gap-1">
                <button
                  type="button"
                  data-dir="up"
                  disabled={disabled || i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={`Monter « ${item.text} »`}
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-line2 text-text hover:bg-raised disabled:border-[#1A2539] disabled:text-dim"
                >
                  <IconUp />
                </button>
                <button
                  type="button"
                  data-dir="down"
                  disabled={disabled || i === order.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={`Descendre « ${item.text} »`}
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-line2 text-text hover:bg-raised disabled:border-[#1A2539] disabled:text-dim"
                >
                  <IconDown />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Matching({ body, value, onChange, disabled }: Props<Of<'matching'>>) {
  const pairs = value?.type === 'matching' ? value.pairs : {};
  const uid = useId();
  return (
    <div className="flex max-w-[900px] flex-col gap-2.5">
      {body.left.map((l) => (
        <div
          key={l.id}
          className="grid items-center gap-2 rounded-[10px] border border-[#223049] bg-surface px-4 py-2.5 sm:[grid-template-columns:1fr_minmax(220px,1fr)] sm:gap-4"
        >
          <label htmlFor={`${uid}-${l.id}`}>{l.text}</label>
          <span className="field min-h-[44px]">
            <select
              id={`${uid}-${l.id}`}
              disabled={disabled}
              value={pairs[l.id] ?? ''}
              onChange={(e) => onChange({ type: 'matching', pairs: { ...pairs, [l.id]: e.target.value } })}
              className="input-bare h-11 cursor-pointer bg-chrome"
            >
              <option value="">— Choisir —</option>
              {body.right.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.text}
                </option>
              ))}
            </select>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Composant de réponse adapté au type de question. */
export function AnswerInput(props: Props<QuestionBody>) {
  const { body } = props;
  switch (body.type) {
    case 'mcq_single':
      return <McqSingle {...props} body={body} />;
    case 'mcq_multi':
      return <McqMulti {...props} body={body} />;
    case 'fill_blank':
      return <FillBlank {...props} body={body} />;
    case 'cli':
      return <Cli {...props} body={body} />;
    case 'ordering':
      return <Ordering {...props} body={body} />;
    case 'matching':
      return <Matching {...props} body={body} />;
  }
}
