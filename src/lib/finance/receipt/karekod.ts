/**
 * GİB e-Belge KAREKODU çözümleyici (SAF). Kaynak: GİB "Karekod Standardı Kılavuzu" (Şubat 2023, v1.0).
 *
 * Karekod içeriği düz JSON'dur. e-Fatura / e-Arşiv anahtarları: vkntckn, avkntckn, senaryo, tip, tarih (YYYY-AA-GG),
 * no (3 hane birim + 4 hane yıl + 9 hane sıra), ettn, parabirimi, malhizmettoplam, kdvmatrah(ORAN), hesaplanankdv(ORAN),
 * vergidahil, odenecek. e-SMM: brutucret, tahsilkdv, kdvtevkifat, gvstopaj, kdvtutari, netucret, tahsilat. e-MM: gvstopaj,
 * odenecek. e-Sigorta komisyon: toplamkomisyon. Kılavuz örneklerinde görülen sapmalar da desteklenir: anahtarda boşluk
 * ("hesaplanankdv (8)"), sayının tırnaksız ya da tek tırnaklı yazılması, Türkçe karakterli anahtar ("ödenecek"), virgüllü
 * oran ("kdvmatrah(0,5)"), alan adının büyük harfle yazılması. Bozuk JSON'da anahtar-değer çiftleri tek tek okunur.
 */
import { classifyTaxId } from "./tax-id";
import { parseMachineAmount, round2 } from "./numbers";
import type { LayerFields, ReceiptDocType, VatLine } from "./types";

const CONF = 0.99;

function normalizeKey(k: string): string {
  return k
    .toLocaleLowerCase("tr-TR")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/\s+/g, "");
}

/** JSON değilse (ya da bozuksa) "anahtar":"değer" çiftlerini tek tek toplar. */
function looseObject(raw: string): Record<string, string> | null {
  const text = raw.trim().replace(/^﻿/, "");
  if (!text.startsWith("{")) return null;
  try {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const out: Record<string, string> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (val == null) continue;
        out[normalizeKey(k)] = typeof val === "string" ? val : String(val);
      }
      return out;
    }
  } catch {
    /* gevşek okumaya düş */
  }
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/["']([^"'{}:,]{1,60})["']\s*:\s*(?:"([^"]{0,200})"|'([^']{0,200})'|([-\d.,]+)"?)/g)) {
    out[normalizeKey(m[1]!)] = (m[2] ?? m[3] ?? m[4] ?? "").trim();
  }
  return Object.keys(out).length >= 3 ? out : null;
}

const RATE_KEY = /^(kdvmatrah|hesaplanankdv|matrah|kdv)\((\d{1,2}(?:[.,]\d{1,2})?)\)$/;

/** Karekod içeriği GİB e-belge karekodu mu (en az kimlik + tarih/no/ettn alanlarından ikisi)? */
export function looksLikeGibQr(raw: string): boolean {
  const o = looseObject(raw);
  if (!o) return false;
  const hasId = "vkntckn" in o || "avkntckn" in o;
  const hits = ["tarih", "no", "ettn", "odenecek", "vergidahil", "malhizmettoplam", "tahsilat"].filter((k) => k in o).length;
  return hasId && hits >= 2;
}

function docTypeOf(senaryo: string, tip: string, keys: Record<string, string>): ReceiptDocType {
  const s = senaryo.toUpperCase();
  const t = tip.toUpperCase();
  if ("brutucret" in keys || "netucret" in keys || /SERBESTMESLEK/.test(t)) return "smm";
  if (/EARSIV/.test(s) && /FATURA/.test(s)) return "e_arsiv";
  if (/EARSIV/.test(s)) return "makbuz";
  if (/FATURA/.test(s) || /^(SATIS|IADE|TEVKIFAT|ISTISNA|OZELMATRAH|IHRACKAYITLI|SGK|KOMISYONCU|TEVKIFATIADE)/.test(t)) return "e_fatura";
  return "fatura";
}

/** GİB karekod içeriğini katman alanlarına çevirir; GİB karekodu değilse null. */
export function parseGibQr(raw: string): LayerFields | null {
  if (!raw || raw.length > 8000) return null;
  const o = looseObject(raw);
  if (!o || !looksLikeGibQr(raw)) return null;
  const f: LayerFields = {};
  const src = "karekod" as const;

  const seller = classifyTaxId(o.vkntckn);
  if (seller) f.sellerTaxId = { value: seller.value, confidence: seller.valid ? CONF : 0.6, source: src };
  const buyer = classifyTaxId(o.avkntckn);
  if (buyer) f.buyerTaxId = { value: buyer.value, confidence: buyer.valid ? CONF : 0.6, source: src };
  if (o.unvan) f.sellerName = { value: o.unvan.slice(0, 120), confidence: 0.97, source: src };

  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(o.tarih ?? "") ?? /^(\d{2})[./](\d{2})[./](\d{4})/.exec(o.tarih ?? "");
  if (date) {
    const iso = date[1]!.length === 4 ? `${date[1]}-${date[2]}-${date[3]}` : `${date[3]}-${date[2]}-${date[1]}`;
    if (!Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) f.date = { value: iso, confidence: CONF, source: src };
  }
  const no = (o.no ?? "").trim().toUpperCase();
  if (/^[A-Z0-9]{3}\d{13}$/.test(no) || /^[A-Z0-9-]{4,30}$/.test(no)) f.documentNo = { value: no, confidence: CONF, source: src };
  const ettn = (o.ettn ?? "").trim().toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ettn)) f.ettn = { value: ettn, confidence: CONF, source: src };
  const cur = (o.parabirimi ?? "").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(cur)) f.currency = { value: cur === "TL" ? "TRY" : cur, confidence: CONF, source: src };

  f.docType = { value: docTypeOf(o.senaryo ?? "", o.tip ?? "", o), confidence: 0.97, source: src };

  // KDV kırılımı: kdvmatrah(20) / hesaplanankdv(20)
  const byRate = new Map<number, VatLine>();
  for (const [k, v] of Object.entries(o)) {
    const m = RATE_KEY.exec(k);
    if (!m) continue;
    const rate = Number(m[2]!.replace(",", "."));
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) continue;
    const line = byRate.get(rate) ?? { rate, base: null, amount: null };
    const amount = parseMachineAmount(v);
    if (amount == null) continue;
    if (m[1] === "kdvmatrah" || m[1] === "matrah") line.base = amount;
    else line.amount = amount;
    byRate.set(rate, line);
  }
  const lines = [...byRate.values()].sort((a, b) => b.rate - a.rate);
  if (lines.length) {
    f.vatLines = { value: lines, confidence: CONF, source: src };
    const vat = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
    f.vatTotal = { value: round2(vat), confidence: CONF, source: src };
    const bases = lines.filter((l) => l.base != null);
    if (bases.length === lines.length) f.net = { value: round2(bases.reduce((s, l) => s + (l.base ?? 0), 0)), confidence: CONF, source: src };
  }
  const hesaplanan = parseMachineAmount(o.hesaplanankdv ?? o.kdvtutari);
  if (!f.vatTotal && hesaplanan != null) f.vatTotal = { value: hesaplanan, confidence: CONF, source: src };

  const mal = parseMachineAmount(o.malhizmettoplam ?? o.brutucret);
  if (!f.net && mal != null) f.net = { value: mal, confidence: 0.95, source: src };
  const gross = parseMachineAmount(o.vergidahil);
  if (gross != null) f.grossTotal = { value: gross, confidence: CONF, source: src };
  const payable = parseMachineAmount(o.odenecek ?? o.tahsilat ?? o.toplamkomisyon ?? o.tlkarsiligi);
  const total = payable ?? gross;
  if (total != null) f.total = { value: total, confidence: CONF, source: src };

  const tevkifat = parseMachineAmount(o.kdvtevkifat ?? o.hesaplanankdvtevkifat ?? o.tevkifatkdv);
  if (tevkifat != null && tevkifat > 0) f.vatWithholding = { value: tevkifat, confidence: CONF, source: src };
  else if (gross != null && payable != null && gross - payable > 0.009 && f.docType.value !== "smm") {
    // e-Fatura TEVKIFAT tipinde ödenecek = vergi dahil - tevkif edilen KDV (karekodda ayrı alan yok).
    if (/TEVKIFAT/i.test(o.tip ?? "")) f.vatWithholding = { value: round2(gross - payable), confidence: 0.9, source: src };
  }
  const stopaj = parseMachineAmount(o.gvstopaj);
  if (stopaj != null && stopaj > 0) f.incomeTaxWithholding = { value: stopaj, confidence: CONF, source: src };

  return f;
}
