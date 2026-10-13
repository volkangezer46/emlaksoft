/**
 * SÜRÜMLÜ YASAL BELGELER — SAF çekirdek (G/Ç yok; sunucu/istemci ortak, testli).
 *
 * 8 herkese açık yasal sayfa DB'de sürümlenir (`legal_documents`, migration 20261013005100). Yayında satır yoksa sayfa
 * koddaki JSX sürümünü (v1) gösterir. Metin biçimi "yasal işaretleme" (bilinçli olarak küçük, HTML YOK):
 *   ## 1. Başlık          → numaralı bölüm (LegalSection)
 *   boş satırla ayrılan   → paragraf
 *   - madde               → madde işaretli liste
 *   **kalın**, [metin](/yol | https://… | mailto:… | tel:…)
 *   {{sirket_kimligi}}    → şirket kimliği satırları (ayar defterinden; tek başına satırda)
 *   {{destek_eposta}}     → destek e-postası bağlantısı (satır içi)
 * Bilinmeyen/güvensiz bağlantı düz metin olur; ham HTML asla çizilmez (XSS yok).
 */

export const LEGAL_DOCS = [
  { slug: "kullanim-sartlari", title: "Kullanım Şartları" },
  { slug: "gizlilik", title: "Gizlilik Politikası" },
  { slug: "kvkk-aydinlatma", title: "KVKK Aydınlatma Metni" },
  { slug: "cerez-politikasi", title: "Çerez Politikası" },
  { slug: "mesafeli-satis", title: "Mesafeli Satış Sözleşmesi" },
  { slug: "on-bilgilendirme", title: "Ön Bilgilendirme Formu" },
  { slug: "iptal-iade", title: "İptal ve İade Koşulları" },
  { slug: "davet-kosullari", title: "Davet ve Ortaklık Programı Koşulları" },
] as const;

export type LegalDocSlug = (typeof LEGAL_DOCS)[number]["slug"];

export function isLegalDocSlug(v: unknown): v is LegalDocSlug {
  return typeof v === "string" && LEGAL_DOCS.some((d) => d.slug === v);
}

export function legalDocTitle(slug: LegalDocSlug): string {
  return LEGAL_DOCS.find((d) => d.slug === slug)!.title;
}

export const LEGAL_LIMITS = { titleMax: 200, introMax: 1000, bodyMax: 200_000, noteMax: 500 } as const;

// ---------------------------------------------------------------------------------------------------------------------
// İşaretleme ayrıştırıcı
// ---------------------------------------------------------------------------------------------------------------------

export type Inline =
  | { t: "text"; v: string }
  | { t: "bold"; v: Inline[] }
  | { t: "link"; href: string; v: string }
  | { t: "token"; name: "destek_eposta" };

export type Block =
  | { t: "heading"; no: string | null; title: string }
  | { t: "para"; v: Inline[] }
  | { t: "list"; items: Inline[][] }
  | { t: "entity" };

const SAFE_HREF = /^(\/(?!\/)[^\s]*|#[\w-]*|https:\/\/[^\s]+|mailto:[^\s]+|tel:\+?[0-9]+)$/;

export function isSafeHref(href: string): boolean {
  return SAFE_HREF.test(href.trim());
}

/** Satır içi: **kalın**, [metin](href), {{destek_eposta}}. İç içe kalın içinde bağlantı desteklenir. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("{{destek_eposta}}", i)) {
      flush();
      out.push({ t: "token", name: "destek_eposta" });
      i += "{{destek_eposta}}".length;
      continue;
    }
    if (src.startsWith("**", i)) {
      const end = src.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: "bold", v: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (src[i] === "[") {
      const close = src.indexOf("](", i + 1);
      const paren = close > -1 ? src.indexOf(")", close + 2) : -1;
      if (close > i && paren > close) {
        const text = src.slice(i + 1, close);
        const href = src.slice(close + 2, paren).trim();
        flush();
        if (text && isSafeHref(href)) out.push({ t: "link", href, v: text });
        else out.push({ t: "text", v: text || href });
        i = paren + 1;
        continue;
      }
    }
    buf += src[i];
    i++;
  }
  flush();
  return out;
}

const HEADING_RE = /^##\s+(?:(\d+(?:\.\d+)*\.?)\s+)?(.+)$/;
const LIST_RE = /^\s*[-*]\s+(.*)$/;

/** Blok ayrıştırıcı. Satır sonları normalize edilir; tek satır sonu paragraf içinde boşluk sayılır. */
export function parseLegalMarkup(body: string): Block[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ t: "para", v: parseInline(para.join(" ").trim()) });
    para = [];
  };
  const flushList = () => {
    if (list && list.length) blocks.push({ t: "list", items: list.map((l) => parseInline(l.trim())) });
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    if (line.trim() === "{{sirket_kimligi}}") {
      flushPara();
      flushList();
      blocks.push({ t: "entity" });
      continue;
    }
    const h = HEADING_RE.exec(line.trim());
    if (h) {
      flushPara();
      flushList();
      const no = h[1] ? (h[1].endsWith(".") ? h[1] : `${h[1]}.`) : null;
      blocks.push({ t: "heading", no, title: h[2]!.trim() });
      continue;
    }
    const li = LIST_RE.exec(line);
    if (li) {
      flushPara();
      (list ??= []).push(li[1]!);
      continue;
    }
    if (list) {
      // Liste maddesinin devam satırı.
      list[list.length - 1] += ` ${line.trim()}`;
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

export type LegalSectionBlocks = { no: string | null; title: string | null; blocks: Block[] };

/** Başlıklara göre bölümler (ilk başlıktan önceki içerik başlıksız bölümdür). */
export function groupSections(blocks: readonly Block[]): LegalSectionBlocks[] {
  const out: LegalSectionBlocks[] = [];
  let cur: LegalSectionBlocks | null = null;
  for (const b of blocks) {
    if (b.t === "heading") {
      cur = { no: b.no, title: b.title, blocks: [] };
      out.push(cur);
      continue;
    }
    if (!cur) {
      cur = { no: null, title: null, blocks: [] };
      out.push(cur);
    }
    cur.blocks.push(b);
  }
  return out;
}

/** Biçim denetimi: yayından önce yazara gösterilir (en az bir bölüm başlığı, güvensiz bağlantı yok). */
export function lintLegalMarkup(body: string): string[] {
  const issues: string[] = [];
  const blocks = parseLegalMarkup(body);
  if (!blocks.some((b) => b.t === "heading")) issues.push("Metinde hiç bölüm başlığı yok (## 1. Başlık biçiminde yazın).");
  for (const m of body.matchAll(/\[([^\]]*)\]\(([^)]*)\)/g)) {
    if (!isSafeHref(m[2]!)) issues.push(`Bağlantı adresi kabul edilmedi: ${m[2]} (yalnız /yol, https://, mailto:, tel:).`);
  }
  if (/<[a-z][\s\S]*?>/i.test(body)) issues.push("HTML etiketi yazılamaz; biçim için ## başlık, - madde, **kalın** kullanın.");
  return issues;
}

// ---------------------------------------------------------------------------------------------------------------------
// Fark görünümü (satır bazlı LCS)
// ---------------------------------------------------------------------------------------------------------------------

export type DiffLine = { op: "same" | "add" | "del"; text: string };

/** Satır farkı. Büyük metinde (> 4000 satır çarpımı sınırı) kaba moda düşer: tümü sil + ekle. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n?/g, "\n").split("\n");
  const b = after.replace(/\r\n?/g, "\n").split("\n");
  if (a.length * b.length > 4_000_000) {
    return [...a.map((text) => ({ op: "del" as const, text })), ...b.map((text) => ({ op: "add" as const, text }))];
  }
  const n = a.length;
  const m = b.length;
  // dp[i][j] = a[i..] ile b[j..] LCS uzunluğu (tek boyutlu satırlarla bellek tasarrufu yok; sınır yukarıda).
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "same", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ op: "del", text: a[i]! });
      i++;
    } else {
      out.push({ op: "add", text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ op: "del", text: a[i++]! });
  while (j < m) out.push({ op: "add", text: b[j++]! });
  return out;
}

export function diffStats(lines: readonly DiffLine[]): { added: number; removed: number } {
  return { added: lines.filter((l) => l.op === "add").length, removed: lines.filter((l) => l.op === "del").length };
}

// ---------------------------------------------------------------------------------------------------------------------
// Koddaki sayfadan taslak (HTML → işaretleme)
// ---------------------------------------------------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function inlineHtmlToMarkup(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
    const h = decodeEntities(href);
    const t = decodeEntities(text.replace(/<[^>]+>/g, "")).trim();
    if (h.startsWith("mailto:")) return "{{destek_eposta}}";
    return isSafeHref(h) ? `[${t}](${h})` : t;
  });
  s = s.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, inner: string) => {
    const t = inner.replace(/<[^>]+>/g, "").trim();
    return t ? `**${t}**` : "";
  });
  s = s.replace(/<br\s*\/?>/gi, " ");
  s = s.replace(/<[^>]+>/g, "");
  return decodeEntities(s).replace(/\s+/g, " ").trim();
}

/** Şirket kimliği listesi (sayfada `legalEntityFields` ile çizilen <ul>) tek simgeye indirilir. */
const ENTITY_LIST_HINT = /(Ticari ünvan|MERSİS|KEP adresi)/;

/**
 * Yayındaki yasal sayfanın HTML'inden (`<article class="legal-body">`) işaretleme taslağı üretir. Kodu elle kopyalamadan
 * "koddaki sürümden taslak başlat" içindir; çıktı yazara gösterilir, yayınlamadan önce gözden geçirilir.
 */
export function legalHtmlToMarkup(html: string): string | null {
  const start = html.search(/<article\b[^>]*class="[^"]*legal-body[^"]*"[^>]*>/i);
  if (start < 0) return null;
  const openEnd = html.indexOf(">", start) + 1;
  const end = html.indexOf("</article>", openEnd);
  if (end < 0) return null;
  const inner = html.slice(openEnd, end);
  const out: string[] = [];
  const re = /<(h2|p|ul|ol)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner))) {
    const tag = m[1]!.toLowerCase();
    const attrs = m[2]!;
    const body = m[3]!;
    if (tag === "h2") {
      const no = /<span\b[^>]*>([\s\S]*?)<\/span>/i.exec(body);
      const noText = no ? decodeEntities(no[1]!.replace(/<[^>]+>/g, "")).trim() : "";
      const title = inlineHtmlToMarkup(no ? body.replace(no[0], "") : body).replace(/\*\*/g, "");
      out.push(`## ${noText ? `${noText} ` : ""}${title}`);
    } else if (tag === "p") {
      const t = inlineHtmlToMarkup(body);
      if (t) out.push(t);
    } else {
      const text = body.replace(/<[^>]+>/g, " ");
      if (/data-legal-entity/.test(attrs) || ENTITY_LIST_HINT.test(decodeEntities(text))) {
        out.push("{{sirket_kimligi}}");
        continue;
      }
      const items = [...body.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((x) => inlineHtmlToMarkup(x[1]!)).filter(Boolean);
      if (items.length) out.push(items.map((i) => `- ${i}`).join("\n"));
    }
  }
  return out.length ? out.join("\n\n") : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Yeniden onay
// ---------------------------------------------------------------------------------------------------------------------

export type ReconsentDocRow = {
  slug: LegalDocSlug;
  /** Yayındaki (en yeni) sürüm. */
  version: number;
  title: string;
  /** Onay istenen en yeni "yeniden onay gerekli" sürüm ve yayın anı. */
  requiredVersion: number;
  requiredPublishedAt: string;
};

export type PendingReconsent = { slug: LegalDocSlug; version: number; title: string };

/**
 * Kullanıcının onaylaması gereken belgeler. Kural: belgenin en yeni "yeniden onay gerekli" sürümü R ise kullanıcının
 * bu belge için R veya daha yeni sürüme onayı yoksa ve hesap R yayınlandıktan ÖNCE açıldıysa bekler (sonradan kayıt
 * olan, kayıt anında güncel metni görmüştür). Onay, yayındaki en yeni sürüm için alınır.
 */
export function pendingReconsents(
  docs: readonly ReconsentDocRow[],
  consents: readonly { document: string; version: number }[],
  userCreatedAt: string | null,
): PendingReconsent[] {
  const best = new Map<string, number>();
  for (const c of consents) best.set(c.document, Math.max(best.get(c.document) ?? 0, c.version));
  const created = userCreatedAt ? Date.parse(userCreatedAt) : NaN;
  const out: PendingReconsent[] = [];
  for (const d of docs) {
    if ((best.get(d.slug) ?? 0) >= d.requiredVersion) continue;
    const published = Date.parse(d.requiredPublishedAt);
    if (Number.isFinite(created) && Number.isFinite(published) && created >= published) continue;
    out.push({ slug: d.slug, version: d.version, title: d.title });
  }
  return out;
}
