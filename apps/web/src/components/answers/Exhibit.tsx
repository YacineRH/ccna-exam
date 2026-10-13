/** Exhibit : sortie de commande ou extrait de configuration, en monospace. */
export function Exhibit({ text }: { text: string }) {
  // Met en évidence les invites IOS en début de ligne (R1#, SW1(config)#…).
  const lines = text.split('\n');
  return (
    <figure className="m-0 max-w-[900px] overflow-hidden rounded-[10px] border border-[#223049]">
      <figcaption className="flex items-center gap-2 border-b border-[#223049] bg-surface px-3.5 py-2 font-mono text-[12px] font-medium text-muted">
        <span className="led h-2 w-2 rounded-full bg-accent" aria-hidden />
        Exhibit
      </figcaption>
      <pre className="m-0 overflow-x-auto bg-[#070B13] px-[18px] py-4 font-mono text-[13px] leading-[1.65] text-[#C9D4E5]">
        {lines.map((line, i) => {
          const m = /^(\S+?[>#])(\s.*|$)/.exec(line);
          return (
            <span key={i}>
              {m ? (
                <>
                  <span className="text-accent">{m[1]}</span>
                  {m[2]}
                </>
              ) : (
                line
              )}
              {i < lines.length - 1 ? '\n' : ''}
            </span>
          );
        })}
      </pre>
    </figure>
  );
}
