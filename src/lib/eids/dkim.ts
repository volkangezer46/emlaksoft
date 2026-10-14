import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { parseHeaderBlock, splitHeaderBody, toCrlf, type MimeHeader } from "./mime";
import type { ArcSetEvidence, DkimEvidence, MailAuthEvidence } from "./mail-auth";

/**
 * DKIM (RFC 6376) ve ARC (RFC 8617) DOĞRULAYICI — yalnız sunucu (node:crypto + DNS). Elle yüklenen .eml dosyası
 * SMTP alıcısındaki mailauth ile AYNI kanıtı üretsin diye yazıldı (uygulama paketine posta kütüphanesi eklenmez).
 * Desteklenen: rsa-sha256 ve ed25519-sha256; simple/relaxed kanonikleştirme. rsa-sha1, 1024 bitten kısa anahtar ve
 * gövdenin bir kısmını imzalayan l= etiketi (sonradan eklenen metin imzalı sayılmasın) BAŞARISIZ sayılır.
 * SPF/DMARC burada yoktur: yüklenen dosyada SMTP oturumu yoktur, kaynak ancak DKIM ya da ARC ile kanıtlanır.
 * Çapraz doğrulama: test fikstürleri mailauth ile imzalandı/mühürlendi (`fixtures/eids-mail.fixture.json`).
 */

export type TxtResolver = (name: string) => Promise<string[][]>;

const MAX_SIGNATURES = 5;
const MAX_ARC_SETS = 10;
const MIN_RSA_BITS = 1024;

async function defaultResolver(name: string): Promise<string[][]> {
  const dns = await import("node:dns/promises");
  return dns.resolveTxt(name);
}

/** `a=b; c=d` etiket listesi (değerdeki FWS atılır). */
export function parseTags(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of value.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim().toLowerCase();
    if (!k || k in out) continue;
    out[k] = part.slice(eq + 1).replace(/\s+/g, "").trim();
  }
  return out;
}

function relaxedHeader(h: MimeHeader): string {
  const idx = h.raw.indexOf(":");
  const name = h.raw.slice(0, idx).trim().toLowerCase();
  const value = h.raw
    .slice(idx + 1)
    .replace(/\r\n/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
  return `${name}:${value}\r\n`;
}

function canonHeader(h: MimeHeader, mode: string): string {
  return mode === "simple" ? h.raw : relaxedHeader(h);
}

export function canonBody(body: string, mode: string): string {
  if (mode === "relaxed") {
    let b = body
      .split("\r\n")
      .map((l) => l.replace(/[ \t]+/g, " ").replace(/[ \t]+$/, ""))
      .join("\r\n");
    b = b.replace(/(\r\n)*$/, "");
    return b.length ? `${b}\r\n` : "";
  }
  const b = body.replace(/(\r\n)*$/, "");
  return `${b}\r\n`;
}

/** İmza başlığındaki b= değerini boşaltır (bh= etkilenmez). */
function blankB(h: MimeHeader): MimeHeader {
  const idx = h.raw.indexOf(":");
  const head = h.raw.slice(0, idx + 1);
  const value = h.raw.slice(idx + 1).replace(/(^|;)([ \t\r\n]*b[ \t\r\n]*=)[^;]*/i, "$1$2");
  return { ...h, raw: head + value };
}

/** Başlık listesinden h= sırasına göre alanları alttan yukarı seçer (aynı adın her geçişi bir kez kullanılır). */
function selectHeaders(headers: MimeHeader[], names: string[], exclude: MimeHeader): MimeHeader[] {
  const used = new Set<MimeHeader>();
  const out: MimeHeader[] = [];
  for (const n of names) {
    const ln = n.trim().toLowerCase();
    for (let i = headers.length - 1; i >= 0; i--) {
      const h = headers[i]!;
      if (h === exclude || used.has(h) || h.name.toLowerCase() !== ln) continue;
      used.add(h);
      out.push(h);
      break;
    }
  }
  return out;
}

type KeyResult = { ok: true; key: KeyObject; kind: "rsa" | "ed25519" } | { ok: false; reason: string };

async function fetchKey(resolver: TxtResolver, selector: string, domain: string): Promise<KeyResult> {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(selector) || !/^[A-Za-z0-9.-]{3,253}$/.test(domain)) return { ok: false, reason: "bad_selector" };
  let records: string[][];
  try {
    records = await resolver(`${selector}._domainkey.${domain}`);
  } catch {
    return { ok: false, reason: "dns_fail" };
  }
  const txt = records.map((r) => r.join("")).find((r) => /(^|;)\s*p\s*=/.test(r));
  if (!txt) return { ok: false, reason: "no_key" };
  const tags = parseTags(txt);
  if (!tags.p) return { ok: false, reason: "key_revoked" };
  const der = Buffer.from(tags.p, "base64");
  const k = (tags.k ?? "rsa").toLowerCase();
  try {
    if (k === "ed25519") {
      if (der.length !== 32) return { ok: false, reason: "bad_key" };
      const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), der]);
      return { ok: true, key: createPublicKey({ key: spki, format: "der", type: "spki" }), kind: "ed25519" };
    }
    let key: KeyObject;
    try {
      key = createPublicKey({ key: der, format: "der", type: "spki" });
    } catch {
      key = createPublicKey({ key: der, format: "der", type: "pkcs1" });
    }
    const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
    if (bits < MIN_RSA_BITS) return { ok: false, reason: "key_too_short" };
    return { ok: true, key, kind: "rsa" };
  } catch {
    return { ok: false, reason: "bad_key" };
  }
}

function verifySig(alg: string, key: KeyResult & { ok: true }, data: string, sigB64: string): boolean {
  const sig = Buffer.from(sigB64, "base64");
  try {
    if (alg === "rsa-sha256" && key.kind === "rsa") return cryptoVerify("sha256", Buffer.from(data, "latin1"), key.key, sig);
    if (alg === "ed25519-sha256" && key.kind === "ed25519") {
      return cryptoVerify(null, createHash("sha256").update(data, "latin1").digest(), key.key, sig);
    }
  } catch {
    return false;
  }
  return false;
}

type SigCheck = { domain: string; result: "pass" | "fail" | "neutral" | "permerror" | "temperror"; reason: string };

/** Tek bir DKIM-Signature / ARC-Message-Signature başlığını doğrular. */
async function verifyMessageSignature(
  sigHeader: MimeHeader,
  headers: MimeHeader[],
  body: string,
  resolver: TxtResolver,
): Promise<SigCheck> {
  const tags = parseTags(sigHeader.value);
  const domain = (tags.d ?? "").toLowerCase();
  const alg = (tags.a ?? "").toLowerCase();
  if (!domain || !tags.s || !tags.b || !tags.bh || !tags.h) return { domain, result: "permerror", reason: "missing_tag" };
  if (alg !== "rsa-sha256" && alg !== "ed25519-sha256") return { domain, result: "permerror", reason: `alg_${alg || "none"}` };
  const [hc = "simple", bc = "simple"] = (tags.c ?? "simple/simple").toLowerCase().split("/");
  const names = tags.h.split(":").map((n) => n.trim().toLowerCase());
  if (sigHeader.name.toLowerCase() === "dkim-signature" && !names.includes("from")) return { domain, result: "permerror", reason: "from_not_signed" };

  const canonicalBody = canonBody(body, bc);
  if (tags.l !== undefined) {
    const l = Number(tags.l);
    if (!Number.isFinite(l) || l < canonicalBody.length) return { domain, result: "fail", reason: "partial_body" };
  }
  const bh = createHash("sha256").update(canonicalBody, "latin1").digest("base64");
  if (bh !== tags.bh) return { domain, result: "neutral", reason: "body_hash_mismatch" };

  const selected = selectHeaders(headers, names, sigHeader);
  const sigCanon = canonHeader(blankB(sigHeader), hc).replace(/\r\n$/, "");
  const data = selected.map((h) => canonHeader(h, hc)).join("") + sigCanon;

  const key = await fetchKey(resolver, tags.s, domain);
  if (!key.ok) return { domain, result: key.reason === "dns_fail" ? "temperror" : "permerror", reason: key.reason };
  return verifySig(alg, key, data, tags.b) ? { domain, result: "pass", reason: "ok" } : { domain, result: "fail", reason: "signature" };
}

type ArcVerify = { result: "pass" | "fail" | "none"; reason: string; sets: ArcSetEvidence[] };

/** ARC zinciri: kümeler 1..n eksiksiz, cv kuralları, son AMS ve tüm AS imzaları. */
async function verifyArc(headers: MimeHeader[], body: string, resolver: TxtResolver): Promise<ArcVerify> {
  const byI = new Map<number, { as?: MimeHeader; ams?: MimeHeader; aar?: MimeHeader }>();
  let count = 0;
  for (const h of headers) {
    const n = h.name.toLowerCase();
    const key = n === "arc-seal" ? "as" : n === "arc-message-signature" ? "ams" : n === "arc-authentication-results" ? "aar" : null;
    if (!key) continue;
    count += 1;
    const i = Number(/(?:^|;)\s*i\s*=\s*(\d+)/.exec(h.value)?.[1] ?? NaN);
    if (!Number.isInteger(i) || i < 1 || i > MAX_ARC_SETS) return { result: "fail", reason: "bad_instance", sets: [] };
    const slot = byI.get(i) ?? {};
    if (slot[key]) return { result: "fail", reason: "duplicate_set", sets: [] };
    slot[key] = h;
    byI.set(i, slot);
  }
  if (count === 0) return { result: "none", reason: "no_arc", sets: [] };
  const n = byI.size;
  for (let i = 1; i <= n; i++) {
    const s = byI.get(i);
    if (!s?.as || !s.ams || !s.aar) return { result: "fail", reason: "incomplete_set", sets: [] };
  }
  const sets: ArcSetEvidence[] = [];
  for (let i = 1; i <= n; i++) {
    const s = byI.get(i)!;
    const asTags = parseTags(s.as!.value);
    const cv = (asTags.cv ?? "").toLowerCase();
    if ((i === 1 && cv !== "none") || (i > 1 && cv !== "pass")) return { result: "fail", reason: `cv_${cv || "none"}_${i}`, sets: [] };
    sets.push({ i, sealer: (asTags.d ?? "").toLowerCase(), aar: s.aar!.value });
  }
  // En son AMS gövde + başlıkları kapsar (öncekiler iletimde bozulabilir; RFC 8617 §5.2).
  const ams = await verifyMessageSignature(byI.get(n)!.ams!, headers, body, resolver);
  if (ams.result !== "pass") return { result: "fail", reason: `ams_${ams.reason}`, sets };
  // Her mühür (AS i), 1..i kümelerinin AAR, AMS, AS başlıklarını (relaxed) imzalar; AS(i) b= boş ve sonda CRLF yok.
  for (let i = n; i >= 1; i--) {
    const as = byI.get(i)!.as!;
    const tags = parseTags(as.value);
    const alg = (tags.a ?? "").toLowerCase();
    if (alg !== "rsa-sha256" && alg !== "ed25519-sha256") return { result: "fail", reason: "as_alg", sets };
    let data = "";
    for (let j = 1; j <= i; j++) {
      const s = byI.get(j)!;
      data += relaxedHeader(s.aar!) + relaxedHeader(s.ams!);
      data += j === i ? relaxedHeader(blankB(s.as!)).replace(/\r\n$/, "") : relaxedHeader(s.as!);
    }
    const key = await fetchKey(resolver, tags.s ?? "", (tags.d ?? "").toLowerCase());
    if (!key.ok) return { result: "fail", reason: `as_key_${key.reason}`, sets };
    if (!verifySig(alg, key, data, tags.b ?? "")) return { result: "fail", reason: `as_sig_${i}`, sets };
  }
  return { result: "pass", reason: "ok", sets };
}

/**
 * Ham .eml (ikili dize; `Buffer.toString("latin1")`) → mail-auth kanıtı (DKIM sonuçları + ARC). SPF/DMARC null (SMTP oturumu yok). Asla fırlatmaz.
 * `resolver` testte enjekte edilir; üretimde sistem DNS'i.
 */
export async function verifyEmlAuth(rawInput: string, resolver: TxtResolver = defaultResolver): Promise<MailAuthEvidence> {
  try {
    const raw = toCrlf(rawInput);
    const { header, body } = splitHeaderBody(raw);
    const headers = parseHeaderBlock(header);
    const sigs = headers.filter((h) => h.name.toLowerCase() === "dkim-signature").slice(0, MAX_SIGNATURES);
    const dkim: DkimEvidence[] = [];
    for (const s of sigs) {
      const r = await verifyMessageSignature(s, headers, body, resolver);
      dkim.push({ domain: r.domain, result: r.result });
    }
    const arc = await verifyArc(headers, body, resolver);
    return { dkim, arc: arc.result === "none" ? null : { result: arc.result, sets: arc.sets }, spf: null, dmarc: null };
  } catch {
    return { dkim: [], arc: null, spf: null, dmarc: null };
  }
}
