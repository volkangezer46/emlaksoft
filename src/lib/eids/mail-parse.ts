/**
 * Bakanlık (EİDS) bildirim e-postası ayrıştırıcısı — SAF (ağ, DB, saat yok; sunucu ve test güvenle import eder).
 *
 * Adımlar: HTML → düz metin, boşluk ve Türkçe karakter normalleştirme, yasal uyarı metnini atma, sonra iki kalıp:
 *  - VERME (grant):  "<no> taşınmaz numaralı taşınmazın satışına|kiralanmasına ilişkin ... konusunda <AD> tarafından
 *                     <gg.aa.yyyy> tarihine kadar yetkilendirildiniz"
 *  - İPTAL (revoke): "<no> taşınmaz numaralı ... satışına|kiralanmasına ... konusunda <AD> tarafından verilen yetki
 *                     iptal edilmiştir"
 * Kalıba uymayan metin `unknown` döner (çağıran 'unknown_format' işaretler, platforma uyarı düşer, maskeli örnek tutar).
 *
 * Ayrıca: iletme onay e-postaları (Gmail / Yandex / Outlook) için onay kodu ve bağlantı çıkarımı; malik adı maskesi
 * ve eşleştirme için normalleştirme (özet/hash sunucu tarafında, `inbound-crypto.ts`).
 *
 * NOT: Kalıplar tasarım belgesindeki (EP3) metinden alınmıştır. Test fikstürleri bu metinle KURULMUŞ örneklerdir;
 * gerçek bir EİDS .eml'i geldiğinde fikstürler onunla değiştirilmeli (sahip girdisi bekleniyor).
 */

export const EIDS_SENDER = "eids.yetki@ticaret.gov.tr";
export const EIDS_DOMAIN = "ticaret.gov.tr";

export type EidsDealKind = "sale" | "rent";
export type EidsMailKind = "grant" | "revoke" | "unknown";

export type ParsedEidsMail =
  | {
      kind: "grant";
      propertyNo: string;
      dealKind: EidsDealKind;
      grantorName: string;
      /** ISO tarih (yyyy-mm-dd). */
      validUntil: string;
    }
  | { kind: "revoke"; propertyNo: string; dealKind: EidsDealKind; grantorName: string; validUntil: null }
  | { kind: "unknown"; reason: "empty" | "no_pattern" | "bad_date" | "bad_name" };

const GRANTOR_MAX = 120;

/** HTML'i okunur düz metne çevirir (blok etiketleri satır sonu olur, varlıklar çözülür, script/style atılır). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)\s*>/gi, "\n")
      .replace(/<hr\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
}

const NAMED: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  ccedil: "ç",
  Ccedil: "Ç",
  ouml: "ö",
  Ouml: "Ö",
  uuml: "ü",
  Uuml: "Ü",
  scedil: "ş",
  Scedil: "Ş",
  gbreve: "ğ",
  Gbreve: "Ğ",
  inodot: "ı",
  Idot: "İ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, (m, ent: string) => {
    if (ent.startsWith("#x") || ent.startsWith("#X")) {
      const cp = parseInt(ent.slice(2), 16);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : " ";
    }
    if (ent.startsWith("#")) {
      const cp = parseInt(ent.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : " ";
    }
    return NAMED[ent] ?? m;
  });
}

/**
 * Boşluk ve karakter normalleştirme: NFC, bölünmez boşluk/sıfır genişlikli karakterler, birleşik nokta (i̇),
 * tipografik tire; tüm boşluk dizileri tek boşluk. Türkçe harfler KORUNUR (kalıp Türkçe harf içerir).
 */
export function normalizeMailText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[  -   　]/g, " ")
    .replace(/[​-‍⁠﻿­]/g, "")
    .replace(/i̇/g, "i")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Yasal uyarı / otomatik gönderim notu ve sonrasını atar (gövde özeti bu kısımdan etkilenmesin). */
const DISCLAIMER_MARKERS = [
  /yasal uyar[ıi]\s*:?/i,
  /bu (?:elektronik posta|e-posta|e-mail|ileti|mesaj)(?: ve ekleri)? (?:yaln[ıi]zca|sadece) al[ıi]c[ıi]s[ıi]na/i,
  /bu e-posta otomatik olarak g[öo]nderilmi[şs]tir/i,
  /disclaimer\s*:/i,
];

export function stripDisclaimer(text: string): string {
  let cut = text.length;
  for (const re of DISCLAIMER_MARKERS) {
    const m = re.exec(text);
    if (m && m.index < cut) cut = m.index;
  }
  return text.slice(0, cut).trim();
}

/** E-posta gövdesinden (html tercih, yoksa düz metin) karşılaştırılabilir normalleştirilmiş metin. */
export function mailBodyToNormalizedText(parts: { html?: string | null; text?: string | null }): string {
  const base = parts.html ? htmlToText(parts.html) : (parts.text ?? "");
  return stripDisclaimer(normalizeMailText(base));
}

const GRANT_RE =
  /(\d{6,12})\s+taşınmaz numaralı taşınmazın\s+(satışına|kiralanmasına)\s+ilişkin[\s\S]*?konusunda\s+([\s\S]+?)\s+tarafından\s+(\d{2}\.\d{2}\.\d{4})\s+tarihine kadar yetkilendirildiniz/iu;
const REVOKE_RE =
  /(\d{6,12})\s+taşınmaz numaralı[\s\S]*?(satışına|kiralanmasına)[\s\S]*?konusunda\s+([\s\S]+?)\s+tarafından verilen yetki iptal edilmiştir/iu;

function dealKindOf(word: string): EidsDealKind {
  return word.toLocaleLowerCase("tr-TR").startsWith("sat") ? "sale" : "rent";
}

/** gg.aa.yyyy → yyyy-mm-dd (geçersiz tarih null). */
export function parseTrDate(s: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return null;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]!;
  if (d > dim) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function cleanGrantor(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name || name.length > GRANTOR_MAX) return null;
  // Ad alanına cümle kaçmışsa (kalıp yanlış yere oturdu) kabul etme: rakam veya cümle noktalaması olmamalı.
  if (/\d|[.;:!?]\s/.test(name)) return null;
  return name;
}

/** Normalleştirilmiş metinden EİDS olayı çıkarır. */
export function parseEidsText(normalized: string): ParsedEidsMail {
  const text = normalizeMailText(normalized);
  if (!text) return { kind: "unknown", reason: "empty" };
  const g = GRANT_RE.exec(text);
  if (g) {
    const validUntil = parseTrDate(g[4]!);
    if (!validUntil) return { kind: "unknown", reason: "bad_date" };
    const grantorName = cleanGrantor(g[3]!);
    if (!grantorName) return { kind: "unknown", reason: "bad_name" };
    return { kind: "grant", propertyNo: g[1]!, dealKind: dealKindOf(g[2]!), grantorName, validUntil };
  }
  const r = REVOKE_RE.exec(text);
  if (r) {
    const grantorName = cleanGrantor(r[3]!);
    if (!grantorName) return { kind: "unknown", reason: "bad_name" };
    return { kind: "revoke", propertyNo: r[1]!, dealKind: dealKindOf(r[2]!), grantorName, validUntil: null };
  }
  return { kind: "unknown", reason: "no_pattern" };
}

/**
 * Ekranda gösterilecek maskeli ad: her sözcüğün ilk iki harfi + kalan harf sayısı kadar yıldız
 * ("Ahmet Yılmaz" → "Ah*** Yı****"). EP2 defterindeki (`match.ts` maskGrantorName) biçimle aynıdır.
 */
export function maskGrantorName(name: string): string {
  return name
    .normalize("NFKC")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const chars = Array.from(w);
      return chars.length <= 2 ? `${chars[0] ?? ""}*` : `${chars.slice(0, 2).join("")}${"*".repeat(chars.length - 2)}`;
    })
    .join(" ")
    .slice(0, 80);
}

/**
 * Eşleştirme anahtarı (EP2 `canonicalGrantorName` ile AYNI kural): Türkçe katlama (küçük harf, aksansız), yalnız
 * harf/rakam, sözcükler alfabetik sıralı ("DEMİR AYŞE" ≡ "Ayşe Demir" → "ayse demir").
 */
export function normalizePersonName(name: string): string {
  return String(name)
    .normalize("NFKC")
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLocaleLowerCase("tr-TR")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

/**
 * Bilinmeyen biçim örneği (platform şablon izleme): rakamlar `#`, büyük harfle başlayan sözcükler (özel ad olabilir)
 * ilk harf + `*` olarak maskelenir; e-posta adresleri ve bağlantılar atılır. En çok 1500 karakter.
 */
export function maskSample(text: string): string {
  const KEEP = new Set(["Sayın", "Elektronik", "İlan", "Doğrulama", "Sistemi", "EİDS", "Bu", "Ticaret", "Bakanlığı"]);
  return normalizeMailText(text)
    .replace(/[^\s@]+@[^\s@]+/g, "[e-posta]")
    .replace(/https?:\/\/\S+/g, "[bağlantı]")
    .replace(/\d/g, "#")
    .replace(/\p{Lu}[\p{L}'’-]*/gu, (w) => (KEEP.has(w) ? w : `${Array.from(w)[0]}*`))
    .slice(0, 1500);
}

// ---------------------------------------------------------------------------------------------------------------
// İletme onay e-postaları (Gmail / Yandex / Outlook). Gövde SAKLANMAZ; yalnız kod/bağlantı 24 saat kartta görünür.

export type ForwardProvider = "gmail" | "yandex" | "outlook";

export type ForwardConfirmation = { provider: ForwardProvider; code: string | null; url: string | null };

const FORWARD_SENDERS: { provider: ForwardProvider; test: (addr: string) => boolean; domains: string[] }[] = [
  { provider: "gmail", test: (a) => a === "forwarding-noreply@google.com", domains: ["google.com"] },
  { provider: "yandex", test: (a) => /@yandex\.(ru|com|com\.tr|net)$/.test(a) && /noreply|no-reply|forward|robot/.test(a), domains: ["yandex.ru", "yandex.com", "yandex.com.tr", "yandex.net"] },
  { provider: "outlook", test: (a) => /@(microsoft\.com|outlook\.com|accountprotection\.microsoft\.com)$/.test(a), domains: ["microsoft.com", "outlook.com", "accountprotection.microsoft.com"] },
];

/** Göndericiye göre iletme onayı sağlayıcısı (değilse null). */
export function forwardProviderOf(fromAddr: string | null): { provider: ForwardProvider; domains: string[] } | null {
  if (!fromAddr) return null;
  const a = fromAddr.toLowerCase();
  const hit = FORWARD_SENDERS.find((s) => s.test(a));
  return hit ? { provider: hit.provider, domains: hit.domains } : null;
}

const CONFIRM_URL_RE: Record<ForwardProvider, RegExp> = {
  gmail: /https:\/\/(?:mail-settings\.google\.com|mail\.google\.com|isolated\.mail\.google\.com)\/mail\/[^\s"'<>]*vf-[^\s"'<>]+/i,
  yandex: /https:\/\/(?:mail\.)?yandex\.(?:ru|com|com\.tr)\/[^\s"'<>]*(?:confirm|forward|approve)[^\s"'<>]*/i,
  outlook: /https:\/\/(?:account\.live\.com|outlook\.live\.com|login\.live\.com)\/[^\s"'<>]+/i,
};

/** Onay kodu ve bağlantısı (konu + metin). Yalnız sağlayıcının kendi alan adlarındaki https bağlantılar alınır. */
export function extractForwardConfirmation(provider: ForwardProvider, subject: string | null, text: string): ForwardConfirmation {
  const hay = `${subject ?? ""}\n${text}`;
  let code: string | null = null;
  if (provider === "gmail") {
    code = /\(#(\d{6,12})\)/.exec(subject ?? "")?.[1] ?? /(?:confirmation code|onay kodu)\s*:?\s*(\d{6,12})/i.exec(hay)?.[1] ?? null;
  } else {
    code = /(?:code|kod(?:u)?)\s*:?\s*([A-Za-z0-9]{4,12})\b/i.exec(hay)?.[1] ?? null;
  }
  const url = CONFIRM_URL_RE[provider].exec(hay)?.[0]?.replace(/[).,;]+$/, "") ?? null;
  return { provider, code, url: url && url.length <= 600 ? url : null };
}
