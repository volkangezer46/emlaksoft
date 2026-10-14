/**
 * Küçük, SAF MIME okuyucu (RFC 5322 / 2045-2047) — yalnız EİDS bildirim e-postaları için yeterli olan kadarı.
 *
 * Neden kütüphane yok: uygulama paketine posta ayrıştırıcı eklemek (mailparser vb.) sunucu demetini büyütür ve
 * yalnız bu akış kullanır. Burada: başlık açma (unfold), kodlanmış sözcükler (=?UTF-8?B?...?=), multipart gezinme,
 * base64 / quoted-printable çözme ve karakter kümeleri (utf-8, iso-8859-9, windows-1254; TextDecoder).
 * Ekler (attachment) okunmaz; yalnız ilk text/plain ve text/html gövdeleri döner. Girdi her zaman sınırlıdır
 * (çağıran 256 KB üstünü reddeder), derinlik 8 ile kesilir.
 *
 * GİRDİ SÖZLEŞMESİ: ham mesaj "ikili dize"dir (her karakter bir bayt; `Buffer.toString("latin1")`). Böylece DKIM
 * özetleri baytı baytına hesaplanır ve 8bit gövdeler doğru karakter kümesiyle çözülür.
 */

/** Bayt dizisi → ikili dize (her karakter bir bayt). */
export function bytesToBinary(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}

export type MimeHeader = { name: string; value: string; raw: string };

export type ParsedMime = {
  headers: MimeHeader[];
  /** Başlık değeri (ilk geçen; RFC 2047 çözülmüş). */
  get(name: string): string | null;
  text: string | null;
  html: string | null;
};

const MAX_DEPTH = 8;

/** CRLF'e normalleştirir (indirilen .eml dosyaları çoğu zaman yalnız LF içerir). */
export function toCrlf(raw: string): string {
  return raw.replace(/\r?\n/g, "\r\n");
}

/** Ham mesajı başlık bloğu ve gövdeye böler (CRLF normalleştirilmiş girdi beklenir). */
export function splitHeaderBody(raw: string): { header: string; body: string } {
  const i = raw.indexOf("\r\n\r\n");
  if (i < 0) return { header: raw, body: "" };
  return { header: raw.slice(0, i + 2), body: raw.slice(i + 4) };
}

/** Başlık bloğunu alanlara böler; `raw` katlanmış hâli (CRLF dahil) korur — DKIM kanonikleştirmesi bunu kullanır. */
export function parseHeaderBlock(header: string): MimeHeader[] {
  const out: MimeHeader[] = [];
  const lines = header.split("\r\n");
  let cur: string[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    const raw = cur.join("\r\n") + "\r\n";
    const idx = raw.indexOf(":");
    if (idx > 0) {
      const name = raw.slice(0, idx).trim();
      const value = raw.slice(idx + 1).replace(/\r\n(?=[ \t])/g, "").trim();
      if (/^[\x21-\x39\x3b-\x7e]+$/.test(name)) out.push({ name, value, raw });
    }
    cur = [];
  };
  for (const line of lines) {
    if (line === "") continue;
    if (/^[ \t]/.test(line) && cur.length > 0) cur.push(line);
    else {
      flush();
      cur.push(line);
    }
  }
  flush();
  return out;
}

function decodeBytes(bytes: Uint8Array, charset: string | null): string {
  const cs = (charset ?? "utf-8").trim().toLowerCase().replace(/^"|"$/g, "");
  const label = cs === "latin5" || cs === "iso8859-9" ? "iso-8859-9" : cs === "cp1254" ? "windows-1254" : cs;
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function base64Bytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, "");
  try {
    const bin = atob(clean.length % 4 === 0 ? clean : clean.replace(/=+$/, "").padEnd(Math.ceil(clean.length / 4) * 4, "="));
    return latin1Bytes(bin);
  } catch {
    return new Uint8Array(0);
  }
}

function qpBytes(s: string, header = false): Uint8Array {
  const src = header ? s.replace(/_/g, " ") : s.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) {
      out.push(parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(src.charCodeAt(i) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** RFC 2047 kodlanmış sözcükleri çözer; aradaki boşluklar (iki kodlu sözcük arası) atılır. */
export function decodeWords(value: string): string {
  return value
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?[^?]+\?[BbQq]\?[^?]*\?=)/g, "$1")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset: string, enc: string, data: string) => {
      const cs = charset.split("*")[0] ?? "utf-8";
      const bytes = enc.toUpperCase() === "B" ? base64Bytes(data) : qpBytes(data, true);
      return decodeBytes(bytes, cs);
    });
}

/** `text/html; charset="utf-8"; boundary=x` → { type, params }. */
export function parseContentType(value: string | null): { type: string; params: Record<string, string> } {
  const v = value ?? "text/plain";
  const [head, ...rest] = v.split(";");
  const params: Record<string, string> = {};
  for (const p of rest) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    const k = p.slice(0, eq).trim().toLowerCase();
    let val = p.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    params[k] = val;
  }
  return { type: (head ?? "text/plain").trim().toLowerCase(), params };
}

function decodeBody(body: string, transferEncoding: string | null, charset: string | null): string {
  const te = (transferEncoding ?? "7bit").trim().toLowerCase();
  if (te === "base64") return decodeBytes(base64Bytes(body), charset);
  if (te === "quoted-printable") return decodeBytes(qpBytes(body), charset);
  // 7bit/8bit/binary: ikili dize → karakter kümesiyle çöz.
  return decodeBytes(latin1Bytes(body), charset);
}

function headerGetter(headers: MimeHeader[]) {
  return (name: string): string | null => {
    const n = name.toLowerCase();
    const h = headers.find((x) => x.name.toLowerCase() === n);
    // Ham 8bit başlık (standart dışı ama yaygın) UTF-8 kabul edilir; sonra RFC 2047 sözcükleri çözülür.
    return h ? decodeWords(decodeBytes(latin1Bytes(h.value), "utf-8")) : null;
  };
}

function walk(raw: string, depth: number, acc: { text: string | null; html: string | null }) {
  if (depth > MAX_DEPTH) return;
  const { header, body } = splitHeaderBody(raw);
  const headers = parseHeaderBlock(header);
  const get = headerGetter(headers);
  const ct = parseContentType(get("content-type"));
  const disposition = (get("content-disposition") ?? "").toLowerCase();
  if (ct.type.startsWith("multipart/") && ct.params.boundary) {
    const b = `--${ct.params.boundary}`;
    const parts = body.split(new RegExp(`(?:^|\\r\\n)${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?[ \\t]*(?:\\r\\n|$)`));
    // İlk parça önsöz, son parça kapanış sonrası metin olabilir; boş olmayan her parça gezilir.
    for (const p of parts.slice(1)) if (p.trim()) walk(p, depth + 1, acc);
    return;
  }
  if (ct.type === "message/rfc822") {
    walk(decodeBody(body, get("content-transfer-encoding"), null), depth + 1, acc);
    return;
  }
  if (disposition.startsWith("attachment")) return;
  if (ct.type === "text/plain" && acc.text === null) acc.text = decodeBody(body, get("content-transfer-encoding"), ct.params.charset ?? null);
  else if (ct.type === "text/html" && acc.html === null) acc.html = decodeBody(body, get("content-transfer-encoding"), ct.params.charset ?? null);
}

/** Ham mesajı ayrıştırır (asla fırlatmaz; bozuk girdide boş gövde döner). */
export function parseMime(rawInput: string): ParsedMime {
  const raw = toCrlf(rawInput);
  const { header } = splitHeaderBody(raw);
  const headers = parseHeaderBlock(header);
  const acc: { text: string | null; html: string | null } = { text: null, html: null };
  try {
    walk(raw, 0, acc);
  } catch {
    /* bozuk MIME: gövdesiz döner */
  }
  return { headers, get: headerGetter(headers), text: acc.text, html: acc.html };
}

/** `Ad Soyad <a@b.c>` / `a@b.c` → küçük harfli adres (yoksa null). */
export function extractAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const angle = value.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/);
  const bare = angle?.[1] ?? value.match(/([^\s<>"',;:]+@[^\s<>"',;:]+)/)?.[1] ?? null;
  return bare ? bare.trim().toLowerCase() : null;
}
