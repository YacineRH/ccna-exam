import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { historyStep, inputHistory, pastedLines } from '../lib/labs';
import type { TerminalLine } from '../lib/types';
import { IconTerminal } from './Icons';

/**
 * Terminal du lab : une console par équipement, sortie en `aria-live`, saisie au clavier.
 * Entrée exécute, ↑/↓ parcourent l'historique, `?` affiche l'aide sans valider la ligne,
 * Ctrl+Z quitte la configuration, un collage multi-ligne est envoyé d'un bloc.
 * Tout est exécuté côté serveur : ce composant n'interprète aucune commande.
 */
export function LabTerminal({
  devices,
  active,
  onActiveChange,
  transcript,
  onSubmit,
  onComplete,
  readOnly = false,
}: {
  devices: { id: string; type: string; prompt: string }[];
  active: string;
  onActiveChange: (id: string) => void;
  transcript: TerminalLine[];
  /** Envoie une ou plusieurs lignes ; renvoie le texte à remettre dans la saisie (après `?`). */
  onSubmit: (device: string, input: string) => Promise<string | undefined>;
  /** Complétion d'un mot (Tab d'IOS), sans rien exécuter ; renvoie la ligne complétée. */
  onComplete?: (device: string, input: string) => Promise<string>;
  readOnly?: boolean;
}) {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState<number | null>(null);
  const draft = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const helpId = useId();
  const inputId = useId();
  const device = devices.find((d) => d.id === active) ?? devices[0];
  const lines = useMemo(() => transcript.filter((t) => t.device === device?.id), [transcript, device?.id]);
  // Historique ↑/↓ : celui de la session, plus ce qui vient d'être envoyé (avant même la réponse du serveur).
  const [sent, setSent] = useState<Record<string, string[]>>({});
  const history = useMemo(() => {
    if (!device) return [];
    const base = inputHistory(transcript, device.id);
    const extra = (sent[device.id] ?? []).slice(base.length);
    return [...base, ...extra];
  }, [transcript, device, sent]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [lines.length, active]);

  useEffect(() => {
    setCursor(null);
    setValue('');
  }, [active]);

  if (!device) return null;

  const send = async (input: string) => {
    setCursor(null);
    setValue('');
    const typed = input.endsWith('?') ? [] : input.split('\n').map((l) => l.trim()).filter((l) => l && l !== '\x1a');
    if (typed.length) {
      setSent((all) => {
        const mine = all[device.id] ?? inputHistory(transcript, device.id);
        const next = [...mine];
        for (const t of typed) if (next[next.length - 1] !== t) next.push(t);
        return { ...all, [device.id]: next };
      });
    }
    const restored = await onSubmit(device.id, input);
    if (restored !== undefined) setValue(restored);
    inputRef.current?.focus();
  };

  const browse = (direction: 'up' | 'down') => {
    if (!history.length) return;
    const from = cursor ?? history.length;
    if (cursor === null) draft.current = value;
    const next = historyStep(history, from, direction);
    setCursor(next === history.length ? null : next);
    setValue(next === history.length ? draft.current : (history[next] as string));
  };

  const complete = async () => {
    if (!onComplete || !value.trim()) return;
    const done = await onComplete(device.id, value);
    setValue(done);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void send(value);
    } else if (e.key === '?') {
      // Comme IOS : `?` affiche l'aide tout de suite et la ligne reste à compléter.
      e.preventDefault();
      void send(`${value}?`);
    } else if ((e.key === 'z' || e.key === 'Z') && e.ctrlKey) {
      e.preventDefault();
      void send('\x1a');
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!history.length) return;
      e.preventDefault();
      browse(e.key === 'ArrowUp' ? 'up' : 'down');
    }
    // Tab garde son rôle de navigation au clavier (pas de piège) : la complétion passe par la barre tactile.
  };

  /** Barre d'actions tactile : le bouton ne prend pas le focus, pour garder le clavier virtuel ouvert. */
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  const actions: { label: string; text: string; run: () => void }[] = [
    { label: 'Ctrl+Z : quitter la configuration', text: 'Ctrl+Z', run: () => void send('\x1a') },
    { label: 'Aide de la commande (?)', text: '?', run: () => void send(`${value}?`) },
    { label: 'Commande précédente', text: '↑', run: () => browse('up') },
    { label: 'Commande suivante', text: '↓', run: () => browse('down') },
    ...(onComplete ? [{ label: 'Compléter le mot (Tab)', text: 'Tab', run: () => void complete() }] : []),
  ];

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!/[\r\n]/.test(text)) return;
    e.preventDefault();
    const input = e.currentTarget;
    const before = value.slice(0, input.selectionStart ?? value.length);
    const after = value.slice(input.selectionEnd ?? value.length);
    const all = pastedLines(`${before}${text}${after}`);
    if (all.length) void send(all.join('\n'));
  };

  const promptOf = (l: TerminalLine) => (l.input === '\x1a' ? l.echo.slice(0, -2) : l.echo.slice(0, l.echo.length - l.input.length));

  return (
    <section className="panel-deep overflow-hidden" aria-label={`Terminal de ${device.id}`}>
      <div className="chrome flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 font-mono text-[12px] text-muted">
        <IconTerminal size={16} className="text-accent" />
        {devices.length > 1 ? (
          <div role="tablist" aria-label="Équipement" className="flex flex-wrap gap-1">
            {devices.map((d) => (
              <button
                key={d.id}
                type="button"
                role="tab"
                aria-selected={d.id === device.id}
                onClick={() => onActiveChange(d.id)}
                className={`min-h-[44px] rounded-md border px-3 font-mono text-[12px] font-semibold ${
                  d.id === device.id ? 'border-accent text-text' : 'border-[#223049] text-muted hover:text-text'
                }`}
              >
                {d.id}
              </button>
            ))}
          </div>
        ) : (
          <span className="font-semibold text-text2">{device.id}</span>
        )}
        <span className="ml-auto">console · simulée</span>
      </div>
      <div
        ref={scroller}
        // Terminée, la transcription n'a plus de champ : on peut la faire défiler au clavier.
        tabIndex={readOnly ? 0 : undefined}
        role={readOnly ? 'region' : undefined}
        aria-label={readOnly ? `Transcription de ${device.id}` : undefined}
        className="max-h-[62vh] min-h-[300px] overflow-auto bg-[#060A11] px-4 py-4 font-mono text-[13px] leading-[1.6] text-[#C9D4E5] sm:text-[13.5px]"
        onClick={() => {
          if (!window.getSelection()?.toString()) inputRef.current?.focus();
        }}
      >
        <pre role="log" aria-live="polite" aria-label={`Sortie de ${device.id}`} className="m-0 whitespace-pre font-mono">
          <span className="text-muted">{`${device.id} con0 is now available\n\nPress RETURN to get started.\n\n`}</span>
          {lines.map((l, i) => (
            <span key={i}>
              <span className="text-accent">{promptOf(l)}</span>
              {l.input === '\x1a' ? '^Z' : l.echo.slice(promptOf(l).length)}
              {'\n'}
              {l.output && <span className={l.status === 'error' ? 'text-warn' : undefined}>{`${l.output}\n`}</span>}
            </span>
          ))}
        </pre>
        {readOnly ? (
          <div className="font-mono text-muted">— session terminée —</div>
        ) : (
          <form
            className="flex items-center"
            onSubmit={(e) => {
              e.preventDefault();
              void send(value);
            }}
          >
            <label htmlFor={inputId} className="whitespace-pre text-accent">
              <span aria-hidden>{device.prompt}</span>
              <span className="sr-only">{`Commande pour ${device.id}, invite ${device.prompt}`}</span>
            </label>
            <input
              id={inputId}
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setCursor(null);
              }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              aria-describedby={helpId}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              inputMode="text"
              // 16 px sur mobile : en dessous, iOS zoome sur le champ à chaque saisie.
              className="min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[16px] text-[#E7EDF6] caret-accent outline-none focus-visible:outline-none sm:text-[13.5px]"
            />
          </form>
        )}
      </div>
      {!readOnly && (
        <div role="toolbar" aria-label="Touches du terminal" className="touch-bar gap-1.5 overflow-x-auto border-t border-line bg-chrome px-3 py-2">
          {actions.map((a) => (
            <button
              key={a.text}
              type="button"
              aria-label={a.label}
              title={a.label}
              onPointerDown={keep}
              onMouseDown={keep}
              onClick={() => {
                a.run();
                inputRef.current?.focus();
              }}
              className="min-h-[44px] min-w-[52px] shrink-0 rounded-md border border-line2 px-3 font-mono text-[14px] font-semibold text-text active:bg-raised"
            >
              {a.text}
            </button>
          ))}
        </div>
      )}
      {!readOnly && (
        <p id={helpId} className="m-0 border-t border-line px-4 py-2 font-mono text-[11.5px] text-muted">
          Entrée : exécuter · ↑/↓ : historique · ? : aide · Ctrl+Z : quitter la configuration · collage multi-ligne accepté
        </p>
      )}
    </section>
  );
}
