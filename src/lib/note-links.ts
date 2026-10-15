/**
 * Not metnindeki uygulama içi bağlantılar (B191): görev notlarında ham `/app/...` yolu ve UUID gösterilmez.
 * Desteklenen iki biçim:
 *  - `[etiket](/app/...)` — yeni notlar bu biçimde yazılır (ör. `listing-control/server/escalate.ts`),
 *  - çıplak `/app/...` yolu — eski notlar; render sırasında "Aç" bağlantısına çevrilir (veri göçü gerekmez).
 * Saf modül: bileşen (`components/app/note-text.tsx`) ve test aynı ayrıştırıcıyı kullanır.
 */

export type NotePart = { kind: "text"; text: string } | { kind: "link"; label: string; href: string };

const LINK_RE = /\[([^\]\n]{1,80})\]\((\/app\/[^)\s]*)\)|(\/app\/[^\s)]*[^\s).,;:!?])/g;

/** Uygulama içi bağlantıyı not metnine yazar (`[etiket](/app/...)`). */
export function noteLink(label: string, href: string): string {
  return `[${label.replace(/[[\]]/g, "")}](${href})`;
}

export function splitNoteLinks(text: string): NotePart[] {
  const out: NotePart[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    if (m[2]) out.push({ kind: "link", label: m[1], href: m[2] });
    else out.push({ kind: "link", label: "Aç", href: m[3] });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}
