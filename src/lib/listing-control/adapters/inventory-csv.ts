import type { ObservedListing } from "./types";

/**
 * Genel envanter CSV ayrıştırıcı (SAF, ağ yok). Portal dışa aktarım dosyalarının başlık adları değişebildiği için
 * başlıklar katlanarak (küçük harf, Türkçe karakter, boşluk/altçizgi) takma adlarla eşlenir. Tanınmayan sütun atılır;
 * ilan no sütunu yoksa HİÇ satır üretilmez (yanlış eşleştirme yerine boş sonuç).
 */

const ALIASES: Record<"externalId" | "url" | "title" | "price" | "status" | "advisor", string[]> = {
  externalId: ["ilanno", "ilannumarasi", "ilanid", "listingid", "id", "portalilanno", "ilankodu"],
  url: ["url", "link", "ilanlinki", "baglanti", "ilanurl"],
  title: ["baslik", "ilanbasligi", "title"],
  price: ["fiyat", "price", "ilanfiyati", "tutar"],
  status: ["durum", "status", "ilandurumu", "yayindurumu"],
  advisor: ["danisman", "danismanadi", "sorumlu", "agent", "uzman"],
};

function foldHeader(s: string): string {
  return s
    .replace(/^﻿/, "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]/g, "");
}

/** RFC4180 benzeri; ayraç `,` ya da `;` (ilk satırdan sezilir). */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

/** "1.250.000", "1.250.000,50", "1250000" → sayı; ayrıştırılamazsa null. */
export function parsePriceText(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;
  let normalized = cleaned;
  if (cleaned.includes(",") && cleaned.includes(".")) normalized = cleaned.replace(/\./g, "").replace(",", ".");
  else if (cleaned.includes(",")) normalized = /,\d{1,2}$/.test(cleaned) ? cleaned.replace(",", ".") : cleaned.replace(/,/g, "");
  else if ((cleaned.match(/\./g)?.length ?? 0) > 1 || /\.\d{3}$/.test(cleaned)) normalized = cleaned.replace(/\./g, "");
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function statusOf(raw: string | undefined): ObservedListing["status"] {
  const s = foldHeader(raw ?? "");
  if (!s) return "unknown";
  if (/(pasif|passive|yayindadegil|yayindadeil|durdur)/.test(s)) return "passive";
  if (/(aktif|yayinda|active|live)/.test(s)) return "active";
  if (/(silindi|kaldirildi|removed|sonlandi)/.test(s)) return "removed";
  return "unknown";
}

export function parseInventoryCsv(portal: string, text: string, seenAt: string, maxRows = 50_000): ObservedListing[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map(foldHeader);
  const idx = (key: keyof typeof ALIASES) => header.findIndex((h) => ALIASES[key].includes(h));
  const iId = idx("externalId");
  if (iId < 0) return [];
  const iUrl = idx("url");
  const iTitle = idx("title");
  const iPrice = idx("price");
  const iStatus = idx("status");
  const iAdvisor = idx("advisor");
  const out: ObservedListing[] = [];
  for (const r of rows.slice(1, maxRows + 1)) {
    const id = (r[iId] ?? "").trim();
    if (!id) continue;
    out.push({
      portal,
      externalId: id,
      url: iUrl >= 0 ? (r[iUrl] ?? "").trim() || null : null,
      title: iTitle >= 0 ? (r[iTitle] ?? "").trim().slice(0, 300) || null : null,
      price: iPrice >= 0 ? parsePriceText(r[iPrice]) : null,
      currency: null,
      advisorName: iAdvisor >= 0 ? (r[iAdvisor] ?? "").trim().slice(0, 120) || null : null,
      status: iStatus >= 0 ? statusOf(r[iStatus]) : "unknown",
      seenAt,
    });
  }
  return out;
}
