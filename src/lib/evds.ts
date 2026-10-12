import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  discardExternalResponse,
  externalErrorMetadata,
  fetchExternal,
  readExternalJson,
} from "@/lib/external-fetch";
import { daysAgoIso, now, trDayKey, trMonthKey } from "@/lib/clock";
import { setPlatformSetting } from "@/lib/platform-settings";
import { TUFE_SETTING_KEY, mergeEvdsTufe, serializeTufeTable } from "@/lib/tufe";
import { loadTufeTable } from "@/lib/tufe-server";
import {
  annualToMonthlyPct,
  latestPoint,
  parseEvdsItems,
  tufe12mAverageChange,
  type EvdsPoint,
} from "@/lib/evds-calc";

/**
 * TCMB EVDS (Elektronik Veri Dağıtım Sistemi) istemcisi — YALNIZ sunucu, ücretsiz API anahtarı gerekir.
 *
 * Anahtar `EVDS_API_KEY` ortam değişkenindedir ve HTTP başlığında (`key`) gider (URL'ye yazılmaz). Anahtar yoksa
 * hiçbir ağ çağrısı yapılmaz ve hiçbir şey yazılmaz.
 *
 * DOĞRULANMADI: EVDS kılavuzu (SPA) bu ortamdan okunamadı; uç adres/başlık adı EVDS2 belgelerinden bilinen biçimdir
 * (`/service/evds/series=...&startDate=dd-mm-yyyy&endDate=...&type=json`, başlık `key`). EVDS3'e geçişte adres değişirse
 * `EVDS_BASE_URL` ile ayarlanır. Yönlendirme (redirect) güvenlik gereği izlenmez (`fetchExternal`).
 */
const DEFAULT_BASE_URL = "https://evds2.tcmb.gov.tr/service/evds";
/** DOĞRULANMADI: konut kredisi ağırlıklı ortalama faiz (haftalık, TL, akım) seri kodu. Doğru kodu `EVDS_SERIES_HOUSING_LOAN` ile verin. */
const DEFAULT_SERIES_HOUSING_LOAN = "TP.KTF10";
/** DOĞRULANMADI: TÜFE genel endeksi (aylık). Doğru kodu `EVDS_SERIES_CPI` ile verin (endeks tabanı değişse de oran korunur). */
const DEFAULT_SERIES_CPI = "TP.FG.J0";

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 1_000_000;

export const MARKET_KEY_HOUSING_LOAN = "housing_loan_rate_annual";
export const MARKET_KEY_TUFE = "cpi_12m_avg";

export function evdsApiKey(): string | null {
  return process.env.EVDS_API_KEY?.trim() || null;
}

export function evdsSeries(): { housingLoan: string; cpi: string } {
  return {
    housingLoan: process.env.EVDS_SERIES_HOUSING_LOAN?.trim() || DEFAULT_SERIES_HOUSING_LOAN,
    cpi: process.env.EVDS_SERIES_CPI?.trim() || DEFAULT_SERIES_CPI,
  };
}

/** "YYYY-MM-DD" → "dd-mm-yyyy" (EVDS tarih biçimi). */
function evdsDate(iso: string): string {
  return `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
}

/** Tek seriyi çeker. Anahtar yok, ağ/HTTP/ayrıştırma hatası veya boş veri → null. */
export async function fetchEvdsSeries(
  seriesCode: string,
  startIso: string,
  endIso: string,
): Promise<EvdsPoint[] | null> {
  const key = evdsApiKey();
  if (!key) return null;
  const base = (process.env.EVDS_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const url = `${base}/series=${encodeURIComponent(seriesCode)}&startDate=${evdsDate(startIso)}&endDate=${evdsDate(endIso)}&type=json`;
  try {
    const res = await fetchExternal(url, { cache: "no-store", headers: { key, accept: "application/json" } }, { timeoutMs: TIMEOUT_MS });
    if (!res.ok) {
      await discardExternalResponse(res);
      return null;
    }
    return parseEvdsItems(await readExternalJson<unknown>(res, MAX_BYTES), seriesCode);
  } catch (err) {
    console.error("evds fetch", seriesCode, externalErrorMetadata(err).kind);
    return null;
  }
}

export type EvdsSyncResult = {
  skipped: boolean;
  housingLoan: "ok" | "yok" | "hata";
  tufe: "ok" | "yok" | "hata";
  detail: string;
};

async function upsertMarket(
  admin: SupabaseClient,
  key: string,
  value: number,
  asOf: string,
  source: string,
): Promise<boolean> {
  const { error } = await admin
    .from("market_rates")
    .upsert({ key, value, as_of: asOf, source, fetched_at: daysAgoIso(0) }, { onConflict: "key" });
  if (error) console.error("market_rates upsert", key, error.code);
  return !error;
}

/**
 * İki adımı BAĞIMSIZ çalıştırır (biri düşerse diğeri etkilenmez) ve asla fırlatmaz.
 * Anahtar yoksa `skipped: true`.
 */
export async function syncEvds(admin: SupabaseClient): Promise<EvdsSyncResult> {
  if (!evdsApiKey()) return { skipped: true, housingLoan: "yok", tufe: "yok", detail: "EVDS: anahtar yok" };
  const series = evdsSeries();
  const today = trDayKey();
  let housingLoan: EvdsSyncResult["housingLoan"] = "yok";
  let tufe: EvdsSyncResult["tufe"] = "yok";

  // 1) Konut kredisi ağırlıklı ortalama faiz (son ~100 gün; son dolu hafta)
  try {
    const start = trDayKey(now() - 100 * 86_400_000);
    const last = latestPoint(await fetchEvdsSeries(series.housingLoan, start, today));
    if (last && last.value > 0 && last.value < 500) {
      const asOf = last.period.length === 10 ? last.period : `${last.period}-01`;
      housingLoan = (await upsertMarket(admin, MARKET_KEY_HOUSING_LOAN, last.value, asOf, `TCMB EVDS ${series.housingLoan}`))
        ? "ok"
        : "hata";
    }
  } catch (e) {
    console.error("evds housing", e);
    housingLoan = "hata";
  }

  // 2) TÜFE endeksi (36 ay) → 12 aylık ortalama değişim → tufe.table
  try {
    const startMonth = trMonthKey(now(), -36);
    const points = await fetchEvdsSeries(series.cpi, `${startMonth}-01`, today);
    if (points) {
      const idx: Record<string, number> = {};
      for (const p of points) idx[p.period.slice(0, 7)] = p.value;
      const rates = tufe12mAverageChange(idx);
      const months = Object.keys(rates).sort();
      if (months.length > 0) {
        const merged = mergeEvdsTufe(await loadTufeTable(), rates);
        const saved = await setPlatformSetting(TUFE_SETTING_KEY, serializeTufeTable(merged));
        const latest = months[months.length - 1]!;
        if (saved) {
          await upsertMarket(admin, MARKET_KEY_TUFE, rates[latest]!, `${latest}-01`, `TCMB EVDS ${series.cpi}`);
        }
        tufe = saved ? "ok" : "hata";
      }
    }
  } catch (e) {
    console.error("evds tufe", e);
    tufe = "hata";
  }

  return { skipped: false, housingLoan, tufe, detail: `EVDS: faiz ${housingLoan}, TÜFE ${tufe}` };
}

/** Hesaplayıcı varsayılanı: son konut kredisi faizi (yıllık %) ve aylığa çevrilmiş değer. Veri yoksa null. */
export function housingLoanDefault(row: { value: unknown; as_of: unknown } | null | undefined):
  | { annualPct: number; monthlyPct: number; asOf: string }
  | null {
  if (!row) return null;
  const annual = Number(row.value);
  const monthly = annualToMonthlyPct(annual);
  const asOf = typeof row.as_of === "string" ? row.as_of : "";
  if (monthly == null || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;
  return { annualPct: annual, monthlyPct: monthly, asOf };
}
