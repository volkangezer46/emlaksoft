/**
 * Not metnindeki uygulama içi bağlantılar (B191): görev notlarında ham `/app/...` yolu ve UUID gösterilmez.
 * Desteklenen iki biçim:
 *  - `[etiket](/app/...)` — yeni notlar bu biçimde yazılır (ör. `listing-control/server/escalate.ts`),
 *  - çıplak `/app/...` yolu — eski notlar; render sırasında "Aç" bağlantısına çevrilir (veri göçü gerekmez).
 * Saf modül: bileşen (`components/app/note-text.tsx`) ve test aynı ayrıştırıcıyı kullanır.
 */

export type NotePart = { kind: "text"; text: string } | { kind: "link"; label: string; href: string };

/**
 * Etiket: kaçışlı karakter (`\]`, `\[`, `\\`), TEK düzey dengeli köşeli parantez (`Daire [3+1]`) ya da `]`/`\`/satır sonu
 * dışındaki herhangi bir karakter. Eski notlarda etiket köşeli parantezsiz yazılırdı (geriye uyumlu).
 * Yol: `)` ve boşluk içermez (`noteLink` `)` karakterini %29 olarak kodlar).
 */
const LABEL = String.raw`(?:\\.|\[[^\[\]\n]{0,78}\]|[^\[\]\\\n])`;
const LINK_RE = new RegExp(String.raw`\[(${LABEL}{1,120})\]\((\/app\/[^)\s]*)\)|(\/app\/[^\s)]*[^\s).,;:!?])`, "g");

/** Etiketteki kaçışları çözer (`\]` → `]`); bilinmeyen kaçış (`\n` gibi) olduğu gibi kalır. */
function unescapeLabel(raw: string): string {
  return raw.replace(/\\([\\[\]])/g, "$1");
}

/**
 * Uygulama içi bağlantıyı not metnine yazar (`[etiket](/app/...)`). Etiketteki `\`, `[` ve `]` ters eğik çizgiyle
 * kaçışlanır (ör. "Daire [3+1]" kaybolmadan geri okunur); satır sonu boşluğa çevrilir; yoldaki boşluk ve `)` kodlanır.
 */
export function noteLink(label: string, href: string): string {
  const safeLabel = label.replace(/[\r\n]+/g, " ").replace(/[\\[\]]/g, (c) => `\\${c}`);
  const safeHref = href.replace(/\)/g, "%29").replace(/\s/g, "%20");
  return `[${safeLabel}](${safeHref})`;
}

export function splitNoteLinks(text: string): NotePart[] {
  const out: NotePart[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    if (m[2]) out.push({ kind: "link", label: unescapeLabel(m[1]!), href: m[2] });
    else out.push({ kind: "link", label: "Aç", href: m[3]! });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}
