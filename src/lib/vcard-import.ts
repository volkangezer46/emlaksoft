/**
 * vCard (.vcf) → içe aktarma tablosu (SAF; DOM/DB yok, birim testli).
 *
 * Telefon rehberi dışa aktarımları (Android "Kişileri dışa aktar", iPhone/iCloud, Google Kişiler vCard) vCard 2.1, 3.0
 * ve 4.0 karışık gelir. Kapsanan gerçekler:
 *  - satır katlama (CRLF + boşluk/sekme) ve QUOTED-PRINTABLE yumuşak satır sonu ("=" ile biten satır);
 *  - QUOTED-PRINTABLE + CHARSET (UTF-8 / windows-1254 / ISO-8859-9) Türkçe karakterler;
 *  - "item1.TEL" grup önekleri, TYPE=CELL / TYPE=cell,voice / 2.1 tarzı çıplak "CELL" parametresi;
 *  - FN yoksa N (soyad;ad;ikinci ad;önek;sonek) bileşiminden ad;
 *  - kişi başına birden çok telefon: cep (CELL/MOBILE) öncelikli, sonra tercih edilen (PREF), sonra ilk.
 * Çıktı CSV ayrıştırıcısıyla AYNI biçimdir (başlık + metin satırlar) → kolon eşleme / doğrulama / önizleme hattı değişmez.
 */

export const VCARD_HEADERS = ["Ad Soyad", "Telefon", "E-posta", "Notlar", "Etiketler", "İl / bölge", "Diğer telefonlar"] as const;

export type VCardContact = {
  fullName: string;
  phones: { value: string; types: string[] }[];
  emails: string[];
  note: string;
  categories: string[];
  city: string;
  org: string;
};

export type VCardTable = { headers: string[]; rows: string[][]; delimiter: ","; contacts: number; skipped: number };

export function isVCardFile(file: { name: string; type?: string }): boolean {
  return /\.(vcf|vcard)$/i.test(file.name) || /^text\/(x-)?vcard$/i.test(file.type ?? "");
}

export function looksLikeVCard(text: string): boolean {
  return /^\s*BEGIN:VCARD/im.test(text.slice(0, 2000));
}

/** Satır katlamasını açar (RFC 6350 §3.2) ve QP yumuşak satır sonlarını birleştirir. */
export function unfoldVCardLines(text: string): string[] {
  const raw = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  const out: string[] = [];
  for (const line of raw) {
    const prev = out.length ? out[out.length - 1]! : null;
    if (prev !== null && /^[ \t]/.test(line)) {
      out[out.length - 1] = prev + line.slice(1);
      continue;
    }
    // QUOTED-PRINTABLE: "=" ile biten satır bir sonrakine devam eder (2.1 dışa aktarımları).
    if (prev !== null && /QUOTED-PRINTABLE/i.test(prev.split(":", 1)[0] ?? "") && /=$/.test(prev)) {
      out[out.length - 1] = prev.slice(0, -1) + line;
      continue;
    }
    out.push(line);
  }
  return out;
}

function decodeBytes(bytes: number[], charset: string): string {
  const cs = charset.toLowerCase();
  const label = cs === "iso-8859-9" || cs === "latin5" || cs === "windows-1254" || cs === "cp1254" ? "windows-1254" : "utf-8";
  try {
    return new TextDecoder(label).decode(new Uint8Array(bytes));
  } catch {
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  }
}

export function decodeQuotedPrintable(value: string, charset = "utf-8"): string {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(value.slice(i + 1, i + 3))) {
      bytes.push(parseInt(value.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const enc = new TextEncoder().encode(ch);
      for (const b of enc) bytes.push(b);
    }
  }
  return decodeBytes(bytes, charset);
}

/** vCard metin kaçışları: \n, \, \; \\ */
function unescapeText(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

/** Kaçışlı ";" ile ayrılmış bileşenler (N, ADR). */
function splitComponents(v: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < v.length; i++) {
    const ch = v[i]!;
    if (ch === "\\" && i + 1 < v.length) {
      cur += ch + v[i + 1];
      i += 1;
    } else if (ch === ";") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => unescapeText(c).trim());
}

type Prop = { name: string; params: Record<string, string[]>; bare: string[]; value: string };

function parseProp(line: string): Prop | null {
  // Ad ve parametreler ':' öncesinde; parametre değerlerinde tırnaklı ':' olabilir.
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ":" && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const head = line.slice(0, colon);
  let value = line.slice(colon + 1);
  const [rawName, ...paramParts] = head.split(";");
  const name = (rawName ?? "").replace(/^[^.]*\./, "").toUpperCase(); // "item1.TEL" → TEL
  const params: Record<string, string[]> = {};
  const bare: string[] = [];
  for (const p of paramParts) {
    const eq = p.indexOf("=");
    if (eq === -1) {
      bare.push(p.toUpperCase());
      continue;
    }
    const k = p.slice(0, eq).toUpperCase();
    const vals = p
      .slice(eq + 1)
      .replace(/"/g, "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    params[k] = [...(params[k] ?? []), ...vals];
  }
  const encoding = (params.ENCODING?.[0] ?? (bare.includes("QUOTED-PRINTABLE") ? "QUOTED-PRINTABLE" : "")).toUpperCase();
  const charset = params.CHARSET?.[0] ?? "utf-8";
  if (encoding === "QUOTED-PRINTABLE") value = decodeQuotedPrintable(value, charset);
  else if (encoding === "B" || encoding === "BASE64") value = ""; // fotoğraf vb. ikili veri: alınmaz
  return { name, params, bare, value };
}

function typesOf(p: Prop): string[] {
  return [...(p.params.TYPE ?? []), ...p.bare].map((t) => t.toUpperCase());
}

export function parseVCards(text: string): VCardContact[] {
  const contacts: VCardContact[] = [];
  let cur: (VCardContact & { n: string[] }) | null = null;
  for (const line of unfoldVCardLines(text)) {
    if (/^BEGIN:VCARD/i.test(line.trim())) {
      cur = { fullName: "", phones: [], emails: [], note: "", categories: [], city: "", org: "", n: [] };
      continue;
    }
    if (/^END:VCARD/i.test(line.trim())) {
      if (cur) {
        if (!cur.fullName) {
          const [family = "", given = "", middle = "", prefix = "", suffix = ""] = cur.n;
          cur.fullName = [prefix, given, middle, family, suffix].filter(Boolean).join(" ");
        }
        if (!cur.fullName && cur.org) cur.fullName = cur.org;
        const { n: _n, ...contact } = cur;
        void _n;
        contacts.push({ ...contact, fullName: contact.fullName.replace(/\s+/g, " ").trim() });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const p = parseProp(line);
    if (!p) continue;
    switch (p.name) {
      case "FN":
        cur.fullName = unescapeText(p.value).trim();
        break;
      case "N":
        cur.n = splitComponents(p.value);
        break;
      case "TEL": {
        const v = p.value.replace(/^tel:/i, "").trim();
        if (v) cur.phones.push({ value: v, types: typesOf(p) });
        break;
      }
      case "EMAIL": {
        const v = p.value.replace(/^mailto:/i, "").trim();
        if (v) cur.emails.push(v);
        break;
      }
      case "NOTE":
        cur.note = [cur.note, unescapeText(p.value).trim()].filter(Boolean).join("\n");
        break;
      case "CATEGORIES":
        for (const c of p.value.split(/(?<!\\),/)) {
          const t = unescapeText(c).trim();
          if (t && !cur.categories.includes(t)) cur.categories.push(t);
        }
        break;
      case "ORG":
        cur.org = splitComponents(p.value).filter(Boolean).join(" ");
        break;
      case "ADR": {
        // pobox;ext;street;locality;region;code;country → "İlçe / İl"
        const c = splitComponents(p.value);
        if (!cur.city) cur.city = [c[3], c[4]].filter(Boolean).join(" / ");
        break;
      }
    }
  }
  return contacts;
}

/** Cep → tercih edilen → ilk sırada; geri kalanı "Diğer telefonlar". */
export function pickPrimaryPhone(phones: VCardContact["phones"]): { primary: string; others: string[] } {
  if (!phones.length) return { primary: "", others: [] };
  const score = (t: string[]) => (t.some((x) => x === "CELL" || x === "MOBILE" || x === "IPHONE") ? 2 : 0) + (t.includes("PREF") ? 1 : 0);
  const sorted = phones.map((p, i) => ({ ...p, i })).sort((a, b) => score(b.types) - score(a.types) || a.i - b.i);
  const seen = new Set<string>();
  const uniq = sorted.filter((p) => {
    const k = p.value.replace(/\D/g, "").slice(-10);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { primary: uniq[0]?.value ?? "", others: uniq.slice(1).map((p) => p.value) };
}

/** Kişiler → tablo. Adı ve iletişimi olmayan kart atlanır (sayısı döner). */
export function contactsToTable(contacts: readonly VCardContact[]): VCardTable {
  const rows: string[][] = [];
  let skipped = 0;
  for (const c of contacts) {
    const { primary, others } = pickPrimaryPhone(c.phones);
    const name = c.fullName || primary || c.emails[0] || "";
    if (!name || (!primary && !c.emails.length)) {
      skipped += 1;
      continue;
    }
    rows.push([name, primary, c.emails[0] ?? "", c.note, c.categories.join("; "), c.city, others.join("; ")]);
  }
  return { headers: [...VCARD_HEADERS], rows, delimiter: ",", contacts: contacts.length, skipped };
}

export function vcardToTable(text: string): VCardTable {
  return contactsToTable(parseVCards(text));
}

/** Contact Picker API sonucu (Android Chrome) → aynı tablo. */
export type PickedContact = { name?: string[]; tel?: string[]; email?: string[] };
export function pickedContactsToTable(picked: readonly PickedContact[]): VCardTable {
  return contactsToTable(
    picked.map((p) => ({
      fullName: (p.name?.find((n) => n.trim()) ?? "").trim(),
      phones: (p.tel ?? []).filter((t) => t.trim()).map((value) => ({ value: value.trim(), types: [] })),
      emails: (p.email ?? []).filter((e) => e.trim()).map((e) => e.trim()),
      note: "",
      categories: [],
      city: "",
      org: "",
    })),
  );
}
