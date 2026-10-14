/**
 * STATİK ANA SAYFA DOM DİYETİ (SAF; G/Ç yok → birim testli). Görünür ilk boyamayı DEĞİŞTİRMEDEN, ilk yükte gerekmeyen
 * işaretlemeyi `<template>` içine alır (şablon içeriği belge ağacına girmez: Lighthouse "excessive DOM" sayımı ve stil/
 * yerleşim maliyeti düşer). Şablonları satır içi çalışma zamanı (src/static-home/runtime.ts) gerektiğinde yerine koyar:
 *
 *  1. Mega menü panellerinin İÇİ (`.mk-mega` > şablon): ilk etkileşim niyetinde (fare/klavye/dokunma, mobil menü) açılır.
 *     Panel öğesi (id, inert, aria) yerinde kalır → `aria-controls` hep geçerli. SEO KORUMASI: paneldeki her bağlantının
 *     adresi (parça hariç) sayfada panel dışında da geçmiyorsa o panel şablona ALINMAZ.
 *  2. Hero sahnesinin iki varyantı (masaüstü `.mk-scene`, mobil `.mk-mscene`): ikisi de şablon; hemen arkasındaki küçük
 *     betik ayrıştırma sırasında (ilk boyamadan önce) CSS kırılımıyla AYNI medya sorgusu eşleşen varyantı yerine koyar,
 *     diğeri yalnız sorgu eşleşirse (pencere daralır/genişlerse) açılır. Sarmalayıcı sabit oranlıdır → CLS 0.
 *  3. Altbilgi mobil akordeonu (`.mk-foot-acc`; sütunlarla aynı bağlantılar, masaüstünde display:none): görünür alana
 *     yaklaşınca açılır. Sütunlar (bağlantılar) her zaman HTML'dedir.
 *  4. Seçili olmayan ürün turu ekranlarının cihaz çerçevesi (`.mk-device` içi; display:none): sekme seçilince ya da seçme
 *     niyetinde (fare/odak) aynı olayda açılır. Başlık/açıklama/madde metinleri (SEO) yerinde kalır.
 *  5. Ekran dışı bölümlerdeki (`.mk-section`, altbilgi) SVG'lerin ÇOCUKLARI tek bir depo şablonuna (`#mk-lz`) taşınır;
 *     `<svg>` öğesi (boyut, viewBox, role/aria-label) yerinde kalır → yerleşim değişmez. Görünür alana yaklaşınca dolar
 *     (tur içindekiler ayrıca sekme niyetinde). Kapalı `<details>` ve adacık kökleri (fiyat, koltuk) hariç tutulur.
 *
 * Kimlik güvenliği (tüm adaylar birlikte): şablona giren bir kimliğe dışarıdan başvuru (`url(#x)`, `href="#x"`, aria-*,
 * for) karşılıksız kalacaksa ya da içerideki başvuru başka bir şablondaki kimliğe gidiyorsa o grup yerinde bırakılır.
 * Birebir aynı işaretlemeyle yinelenen kimlikler (ör. iki SVG'de aynı gradyan) eşdeğer sayılır.
 */

/** Hero varyantlarının görünürlük sorguları — src/app/marketing.css `@media (max-width: 767px)` ile birebir (sözleşme testli). */
export const HERO_MQ = { mobile: "(max-width: 767px)", desktop: "not all and (max-width: 767px)" } as const;

/** Depo şablonunun kimliği ve ertelenen SVG işaretçisi (çalışma zamanı aynı adları okur). */
export const LAZY_STORE_ID = "mk-lz";
export const LAZY_SVG_ATTR = "data-mk-lz";

/**
 * Hero şablonunun hemen arkasındaki betik: önceki kardeş şablonu, sorgusu eşleşiyorsa yerine koyar; eşleşmiyorsa sorgu
 * değişince koyar. Kendini siler (ilk boyamada DOM eskisiyle aynı). CSP: script-src 'unsafe-inline' (statik sayfa).
 */
export const HERO_SWAP_SCRIPT =
  "(function(s){var t=s.previousElementSibling,q=matchMedia(t.dataset.mq);s.remove();function f(){t.replaceWith(t.content)}" +
  'q.matches?f():q.addEventListener("change",function g(){q.matches&&(q.removeEventListener("change",g),f())})})(document.currentScript)';

export type LazyDomReport = {
  /** Şablona alınan mega panel kimlikleri. */
  megaPanels: string[];
  /** SEO koruması ya da kimlik başvurusu yüzünden yerinde bırakılan paneller (nedeniyle). */
  megaKept: { id: string; reason: string }[];
  heroVariants: number;
  footerAccordion: boolean;
  /** Şablona alınan (seçili olmayan) tur ekranı çerçeveleri. */
  tourFrames: number;
  /** Çocukları depoya taşınan SVG sayısı. */
  svgs: number;
};

type Range = { start: number; end: number };

/** `openEnd` (açılış etiketinin bitişi) sonrasındaki dengeli `</tag>` kapanışının BİTİŞ konumu (yoksa -1). */
export function matchTagEnd(html: string, tag: string, openEnd: number): number {
  const re = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, "gi");
  re.lastIndex = openEnd;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[0][1] === "/") depth--;
    else if (!m[0].endsWith("/>")) depth++;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

/** Sınıf listesinde `token` olan açılış etiketleri (sırayla) ve dengeli aralıkları. */
function elementsWithClass(html: string, tag: string, token: string): (Range & { open: string; openEnd: number })[] {
  const out: (Range & { open: string; openEnd: number })[] = [];
  const re = new RegExp(`<${tag}\\b[^>]*\\sclass="([^"]*)"[^>]*>`, "gi");
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (!m[1].split(/\s+/).includes(token)) continue;
    const openEnd = m.index + m[0].length;
    const end = matchTagEnd(html, tag, openEnd);
    if (end < 0) continue;
    out.push({ start: m.index, end, open: m[0], openEnd });
  }
  return out;
}

const REF_ATTRS = /\s(?:aria-(?:controls|labelledby|describedby|owns|activedescendant|details|errormessage|flowto)|for|list|form|headers)="([^"]+)"/g;

/** İşaretlemedeki kimlik tanımları ve kimlik başvuruları (url(#x), href="#x", aria-* / for). */
export function idUsage(html: string): { defs: Map<string, number>; refs: Map<string, number> } {
  const defs = new Map<string, number>();
  const refs = new Map<string, number>();
  const add = (map: Map<string, number>, k: string) => map.set(k, (map.get(k) ?? 0) + 1);
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) add(defs, m[1]);
  for (const m of html.matchAll(/url\(\s*['"]?#([^'")\s]+)/g)) add(refs, m[1]);
  for (const m of html.matchAll(/\s(?:xlink:)?href="#([^"]+)"/g)) add(refs, m[1]);
  for (const m of html.matchAll(REF_ATTRS)) for (const id of m[1].split(/\s+/)) if (id) add(refs, id);
  return { defs, refs };
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** `id="x"` özniteliğinin ait olduğu öğenin tam işaretlemesi (yinelenen kimliklerin eşdeğerliğini karşılaştırmak için). */
function elementAround(html: string, attrIndex: number): string {
  const start = html.lastIndexOf("<", attrIndex);
  const openEnd = html.indexOf(">", attrIndex) + 1;
  const tag = /^<([a-zA-Z][\w:-]*)/.exec(html.slice(start, start + 64))?.[1];
  if (!tag || openEnd <= 0) return "";
  if (html[openEnd - 2] === "/" || VOID_TAGS.has(tag.toLowerCase())) return html.slice(start, openEnd);
  const end = matchTagEnd(html, tag, openEnd);
  return end > 0 ? html.slice(start, end) : html.slice(start, openEnd);
}

/** Birden çok kez ve hep BİREBİR aynı işaretlemeyle tanımlanan kimlikler (ör. iki SVG'de aynı gradyan): hangisi önce gelirse gelsin çizim aynıdır. */
function fungibleIds(html: string): Set<string> {
  const seen = new Map<string, string | null>();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) {
    const el = elementAround(html, m.index);
    const prev = seen.get(m[1]);
    if (prev === undefined) seen.set(m[1], el);
    else if (prev !== el) seen.set(m[1], null);
  }
  const counts = idUsage(html).defs;
  return new Set([...seen].filter(([id, el]) => el !== null && (counts.get(id) ?? 0) > 1).map(([id]) => id));
}

/**
 * Grupların (şablona girecek işaretleme parçaları) kimlik açısından güvenli olanları. Grup G güvenlidir:
 *  - G'nin tanımladığı bir kimlik başka yerde de tanımlıysa tanımların hepsi birebir aynıdır;
 *  - G dışında (aday olmayan alanda) o kimliğe başvuru varsa aday olmayan alanda da bir tanımı vardır;
 *  - G içindeki her başvuru G'nin kendi tanımıyla ya da aday olmayan alandaki bir tanımla karşılanır.
 * Elenen grup (yerinde kalır) diğerlerinin koşulunu değiştirebileceği için sabitlenene dek tekrarlanır.
 */
export function idSafeGroups(html: string, groups: string[]): boolean[] {
  const all = idUsage(html);
  const usage = groups.map(idUsage);
  const fungible = fungibleIds(html);
  const ok = groups.map(() => true);
  for (let pass = 0; pass < 8; pass++) {
    const candDefs = new Map<string, number>();
    const candRefs = new Map<string, number>();
    usage.forEach((u, i) => {
      if (!ok[i]) return;
      for (const [id, n] of u.defs) candDefs.set(id, (candDefs.get(id) ?? 0) + n);
      for (const [id, n] of u.refs) candRefs.set(id, (candRefs.get(id) ?? 0) + n);
    });
    const defsOutside = (id: string) => (all.defs.get(id) ?? 0) - (candDefs.get(id) ?? 0);
    const refsOutside = (id: string) => (all.refs.get(id) ?? 0) - (candRefs.get(id) ?? 0);
    let changed = false;
    usage.forEach((u, i) => {
      if (!ok[i]) return;
      const bad =
        [...u.defs].some(([id, n]) => ((all.defs.get(id) ?? 0) > n && !fungible.has(id)) || (refsOutside(id) > 0 && defsOutside(id) <= 0)) ||
        [...u.refs.keys()].some((id) => !u.defs.has(id) && (all.defs.get(id) ?? 0) > 0 && defsOutside(id) <= 0);
      if (bad) {
        ok[i] = false;
        changed = true;
      }
    });
    if (!changed) break;
  }
  return ok;
}

/** Bağlantı adresi → tarama açısından aynı sayfa anahtarı (köken, parça ve sondaki "/" atılır). */
export function crawlKey(href: string): string {
  const h = href.replace(/&amp;/g, "&").trim();
  if (h.startsWith("#")) return "/";
  const noOrigin = h.replace(/^https?:\/\/(?:www\.)?emlaksoft\.com\.tr(?=\/|$)/i, "");
  const noHash = noOrigin.split("#")[0] ?? "";
  if (noHash === "") return "/";
  return noHash.length > 1 ? noHash.replace(/\/+$/, "") || "/" : noHash;
}

function hrefKeys(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*\shref="([^"]*)"/gi)].map((m) => crawlKey(m[1]));
}

type Edit = Range & { text: string };

/** Şablona alınabilecek bir işaretleme parçası (içerik aralığı + o parçanın düzenlemesi). */
type Candidate = Range & { kind: "mega" | "hero" | "footer" | "tour" | "svg"; inner: string; id?: string; open?: string; mq?: string };

const inside = (r: Range, ranges: Range[]) => ranges.some((x) => r.start >= x.start && r.end <= x.end);
const innerOf = (html: string, el: { openEnd: number; end: number }, tag: string): Range & { inner: string } => {
  const end = el.end - `</${tag}>`.length;
  return { start: el.openEnd, end, inner: html.slice(el.openEnd, end) };
};

/** Mega panelleri: içerik adayı; SEO koruması (yalnız panelde geçen bağlantı) burada uygulanır. */
function megaCandidates(html: string, hidden: Range[], report: LazyDomReport): Candidate[] {
  const panels = elementsWithClass(html, "div", "mk-mega").map((p) => ({ ...innerOf(html, p, "div"), open: p.open }));
  if (panels.length === 0) return [];
  // Panel dışındaki bağlantılar: tüm sayfa eksi paneller ve şablona giren diğer bölgeler (altbilgi akordeonu).
  let rest = html;
  for (const r of [...panels, ...hidden].sort((a, b) => b.start - a.start)) rest = rest.slice(0, r.start) + rest.slice(r.end);
  const outside = new Set(hrefKeys(rest));
  const out: Candidate[] = [];
  panels.forEach((p, i) => {
    const id = /\sid="([^"]+)"/.exec(p.open)?.[1] ?? `#${i}`;
    const missing = [...new Set(hrefKeys(p.inner).filter((k) => !outside.has(k)))];
    if (missing.length > 0) return void report.megaKept.push({ id, reason: `yalnız panelde geçen bağlantı: ${missing.join(", ")}` });
    if (p.inner.trim() !== "") out.push({ kind: "mega", start: p.start, end: p.end, inner: p.inner, id });
  });
  return out;
}

/** Hero varyantları: ikisi birden bulunursa ikisi de aday (biri elenirse ikisi de yerinde kalır). */
function heroCandidates(html: string): Candidate[] {
  const mobile = elementsWithClass(html, "div", "mk-mscene");
  const desktop = elementsWithClass(html, "div", "mk-scene");
  if (mobile.length !== 1 || desktop.length !== 1) return [];
  const parts: Candidate[] = [
    { kind: "hero", mq: HERO_MQ.mobile, ...innerOf(html, mobile[0]!, "div") },
    { kind: "hero", mq: HERO_MQ.desktop, ...innerOf(html, desktop[0]!, "div") },
  ];
  return parts.every((p) => p.inner.trim() !== "") ? parts : [];
}

function footerCandidates(html: string): Candidate[] {
  const acc = elementsWithClass(html, "div", "mk-foot-acc");
  if (acc.length !== 1) return [];
  const c: Candidate = { kind: "footer", ...innerOf(html, acc[0]!, "div") };
  return c.inner.trim() === "" ? [] : [c];
}

/** Seçili olmayan tur ekranlarının cihaz çerçevesi (display:none; sekme seçilince/niyetinde aynı olayda açılır). Metin yerinde kalır. */
function tourCandidates(html: string): Candidate[] {
  const devices = elementsWithClass(html, "div", "mk-device");
  const out: Candidate[] = [];
  for (const scr of elementsWithClass(html, "div", "mk-scr").slice(1)) {
    const inScr = devices.filter((d) => d.start > scr.start && d.end <= scr.end);
    if (inScr.length !== 1) continue;
    const c: Candidate = { kind: "tour", ...innerOf(html, inScr[0]!, "div") };
    if (c.inner.trim() !== "") out.push(c);
  }
  return out;
}

/** Ekran dışı bölümlerdeki (`.mk-section`, altbilgi) SVG'ler; açılır kaplar, şablona giren parçalar ve adacık kökleri hariç. */
function svgCandidates(html: string, templated: Range[]): Candidate[] {
  const include: Range[] = [...elementsWithClass(html, "section", "mk-section"), ...elementsWithClass(html, "footer", "mk-foot")];
  if (include.length === 0) return [];
  const exclude: Range[] = [];
  for (const m of html.matchAll(/<details\b[^>]*>/gi)) {
    const end = matchTagEnd(html, "details", m.index + m[0].length);
    if (end > 0) exclude.push({ start: m.index, end });
  }
  for (const m of html.matchAll(/<div\b[^>]*\s(?:id="mk-price-hydrate"|data-island="[^"]*")[^>]*>/gi)) {
    const end = matchTagEnd(html, "div", m.index + m[0].length);
    if (end > 0) exclude.push({ start: m.index, end });
  }
  exclude.push(...templated);

  const out: Candidate[] = [];
  const re = /<svg\b[^>]*>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const openEnd = m.index + m[0].length;
    const end = matchTagEnd(html, "svg", openEnd);
    if (end < 0) break;
    re.lastIndex = end; // iç içe SVG'ler dıştaki ile birlikte taşınır
    const r = { start: m.index, end };
    if (!inside(r, include) || inside(r, exclude) || m[0].includes(LAZY_SVG_ATTR)) continue;
    const inner = html.slice(openEnd, end - "</svg>".length);
    if (/<[a-z]/i.test(inner)) out.push({ kind: "svg", ...r, inner, open: m[0] });
  }
  return out;
}

/**
 * Tam diyet. Beklenen öğeler bulunamazsa ilgili adım sessizce atlanır (ör. hero görseli yüklenmiş sayfa, yasal sayfa);
 * çıktı her zaman geçerli HTML'dir. Depo şablonu son `</body>`'den hemen önce (çalışma zamanı betiğinden önce) yer alır.
 */
export function deferHomeDom(html: string): { html: string; report: LazyDomReport } {
  const report: LazyDomReport = { megaPanels: [], megaKept: [], heroVariants: 0, footerAccordion: false, tourFrames: 0, svgs: 0 };
  const bodyEnd = html.lastIndexOf("</body>");
  if (bodyEnd < 0) return { html, report };
  const footer = footerCandidates(html);
  const tour = tourCandidates(html);
  let cands = [...svgCandidates(html, [...footer, ...tour]), ...megaCandidates(html, footer, report), ...heroCandidates(html), ...footer, ...tour];
  // Kimlik güvenliği tek seferde, tüm adaylar birlikte (bir SVG'nin başvurduğu kimlik başka bir şablonda olabilir).
  let ok = idSafeGroups(html, cands.map((c) => c.inner));
  const heroIdx = cands.flatMap((c, i) => (c.kind === "hero" ? [i] : []));
  if (heroIdx.some((i) => !ok[i]) && heroIdx.some((i) => ok[i])) {
    cands = cands.filter((c) => c.kind !== "hero");
    ok = idSafeGroups(html, cands.map((c) => c.inner));
  }
  const kept = cands.filter((_, i) => ok[i]);
  for (const c of cands) if (c.kind === "mega" && !kept.includes(c)) report.megaKept.push({ id: c.id ?? "?", reason: "kimlik başvurusu" });

  const edits: Edit[] = [];
  const store: string[] = [];
  for (const c of kept) {
    if (c.kind === "mega") {
      edits.push({ start: c.start, end: c.end, text: `<template data-mk-lazy="mega">${c.inner}</template>` });
      report.megaPanels.push(c.id ?? "?");
    } else if (c.kind === "hero") {
      edits.push({ start: c.start, end: c.end, text: `<template data-mq="${c.mq}">${c.inner}</template><script>${HERO_SWAP_SCRIPT}</script>` });
      report.heroVariants++;
    } else if (c.kind === "footer") {
      edits.push({ start: c.start, end: c.end, text: `<template data-mk-lazy="near">${c.inner}</template>` });
      report.footerAccordion = true;
    } else if (c.kind === "tour") {
      edits.push({ start: c.start, end: c.end, text: `<template data-mk-lazy="tour">${c.inner}</template>` });
      report.tourFrames++;
    } else {
      edits.push({ start: c.start, end: c.end, text: `${c.open!.slice(0, -1)} ${LAZY_SVG_ATTR}="${store.length}"></svg>` });
      store.push(`<svg>${c.inner}</svg>`);
    }
  }
  report.svgs = store.length;
  // Aralıklar ayrık olmalı (SVG adayları panel/hero/akordeon dışında); beklenmeyen çakışmada hiçbir şey değiştirilmez.
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  if (sorted.some((e, i) => i > 0 && e.start < sorted[i - 1]!.end)) {
    return { html, report: { megaPanels: [], megaKept: report.megaKept, heroVariants: 0, footerAccordion: false, tourFrames: 0, svgs: 0 } };
  }
  let out = html.slice(0, bodyEnd);
  for (const e of sorted.reverse()) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  const tail = store.length ? `<template id="${LAZY_STORE_ID}">${store.join("")}</template>` : "";
  return { html: out + tail + html.slice(bodyEnd), report };
}
