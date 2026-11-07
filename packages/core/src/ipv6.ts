/** Outils IPv6 sans dépendance : forme canonique d'une adresse (RFC 5952). */

/** Les 8 groupes de 16 bits d'une adresse IPv6, ou null si elle est invalide. */
export function parseIpv6(input: string): number[] | null {
  const s = input.trim().toLowerCase();
  if (!/^[0-9a-f:]+$/.test(s) || !s.includes(':')) return null;
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const group = (part: string) => (part === '' ? [] : part.split(':'));
  const head = group(halves[0] as string);
  const tail = halves.length === 2 ? group(halves[1] as string) : [];
  if ([...head, ...tail].some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  return [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail].map((g) => parseInt(g, 16));
}

/**
 * Forme canonique RFC 5952 : minuscules, zéros de tête retirés, « :: » sur la plus longue
 * suite d'au moins deux groupes nuls (la première en cas d'égalité). Null si l'adresse est invalide.
 */
export function compressIpv6(input: string): string | null {
  const groups = parseIpv6(input);
  if (!groups) return null;
  let best = { start: -1, len: 0 };
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > best.len) best = { start: i, len: j - i };
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (best.len < 2) return hex.join(':');
  return `${hex.slice(0, best.start).join(':')}::${hex.slice(best.start + best.len).join(':')}`;
}
