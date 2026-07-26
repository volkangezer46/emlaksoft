/**
 * TCMB kur backfill — son N günün EKSİK kur kayıtlarını doldurur.
 *
 * Usage:
 *   npm run kur:backfill                # varsayılan: son 365 gün
 *   npx tsx scripts/tcmb-backfill.ts --days 90
 *   npx tsx scripts/tcmb-backfill.ts --days 0   # kuru test: DB/ağ taraması yok
 *
 * Davranış (route ile bire bir aynı kaynak/mantık — /api/cron/tcmb-kur):
 *  * Kaynak: TCMB resmî XML yayını (www.tcmb.gov.tr/kurlar/YYYYMM/DDMMYYYY.xml).
 *  * Zaten kayıtlı tarihler HİÇ istenmez (kota/nezaket) → idempotent.
 *  * Hafta sonu/tatilde yayın yoktur; 404 "atlandı" sayılır, hata değil.
 *  * Yazım `upsert(onConflict: rate_date)` — tekrar çalıştırmak güvenlidir.
 *
 * NEDEN src/lib/tcmb.ts import EDİLMİYOR: o modül `import "server-only"`
 * taşıyor ve tsx altında (react-server koşulu yok) import anında fırlatır.
 * Diğer scriptlerdeki desen gibi (seed-demo.ts → doğrudan supabase-js) dar
 * parse mantığı burada kopyalanır. DEĞİŞİKLİKTE İKİSİNİ BİRLİKTE GÜNCELLE:
 * tcmbUrlForDate / pickRate / pickDate ↔ src/lib/tcmb.ts.
 */
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

// --- Argümanlar -----------------------------------------------------------
function parseDaysArg(): number {
  const i = process.argv.indexOf("--days");
  if (i === -1) return 365;
  const n = Number(process.argv[i + 1]);
  if (!Number.isInteger(n) || n < 0 || n > 3650) {
    console.error(`Geçersiz --days değeri: '${process.argv[i + 1]}' (0–3650 tam sayı olmalı)`);
    process.exit(1);
  }
  return n;
}
const days = parseDaysArg();

// --- TCMB fetch/parse (src/lib/tcmb.ts kopyası — üstteki nota bak) --------
const BASE = "https://www.tcmb.gov.tr/kurlar";

function two(n: number) {
  return String(n).padStart(2, "0");
}

function tcmbUrlForDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = two(date.getUTCMonth() + 1);
  const d = two(date.getUTCDate());
  return `${BASE}/${y}${m}/${d}${m}${y}.xml`;
}

function pickRate(xml: string, code: "USD" | "EUR", tag: "ForexBuying" | "ForexSelling"): number | null {
  const block = new RegExp(
    `<Currency[^>]*(?:Kod|CurrencyCode)="${code}"[^>]*>([\\s\\S]*?)</Currency>`,
    "i",
  ).exec(xml);
  if (!block) return null;
  const value = new RegExp(`<${tag}>([^<]*)</${tag}>`, "i").exec(block[1]);
  if (!value) return null;
  const raw = value[1].trim();
  if (raw === "") return null;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function pickDate(xml: string): string | null {
  const m = /Tarih="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

type FetchResult =
  | { ok: true; rate: { rateDate: string; usdBuying: number | null; usdSelling: number | null; eurBuying: number | null; eurSelling: number | null } }
  | { ok: false; reason: "no-publication" | "fetch-error" | "parse-error"; detail?: string };

async function fetchTcmbRate(date: Date): Promise<FetchResult> {
  const url = tcmbUrlForDate(date);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/xml,text/xml,*/*" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { ok: false, reason: "fetch-error", detail: String(err).slice(0, 200) };
  }
  if (res.status === 404) return { ok: false, reason: "no-publication" };
  if (!res.ok) return { ok: false, reason: "fetch-error", detail: `HTTP ${res.status}` };

  const xml = await res.text();
  if (!xml.includes("<Currency")) return { ok: false, reason: "no-publication" };

  const rateDate = pickDate(xml);
  if (!rateDate) return { ok: false, reason: "parse-error", detail: "Tarih özniteliği bulunamadı" };

  const rate = {
    rateDate,
    usdBuying: pickRate(xml, "USD", "ForexBuying"),
    usdSelling: pickRate(xml, "USD", "ForexSelling"),
    eurBuying: pickRate(xml, "EUR", "ForexBuying"),
    eurSelling: pickRate(xml, "EUR", "ForexSelling"),
  };
  if (rate.usdSelling === null && rate.eurSelling === null) {
    return { ok: false, reason: "parse-error", detail: "USD/EUR satış kuru okunamadı" };
  }
  return { ok: true, rate };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Ana akış -------------------------------------------------------------
async function main() {
  if (days === 0) {
    // Kuru test: ağ/DB'ye dokunmadan tarih→URL üretimini gösterir.
    const today = new Date();
    console.log("Kuru test (--days 0): hiçbir istek atılmadı.");
    console.log(`Örnek yayın URL'i (bugün): ${tcmbUrlForDate(today)}`);
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY eksik (.env.local)");
    process.exit(1);
  }

  // --- Kazara prod'a çalıştırma freni (seed-demo.ts deseni) ---------------
  // Hedef host her koşulda yazdırılır; local değilse SEED_CONFIRM=1 şart.
  const dbHost = new URL(url).hostname;
  const isLocalDb = ["localhost", "127.0.0.1", "0.0.0.0", "kong"].includes(dbHost);
  console.log(`Hedef DB: ${dbHost} · tablo: tcmb_rates · pencere: son ${days} gün`);
  if (!isLocalDb && process.env.SEED_CONFIRM !== "1") {
    console.error(
      `DURDURULDU: '${dbHost}' local bir Supabase değil. Bu hedefe kur backfill yazmak` +
        ` istediğinden eminsen SEED_CONFIRM=1 ile tekrar çalıştır.`,
    );
    process.exit(1);
  }

  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  // Zaten kayıtlı tarihleri çıkar — TCMB'ye gereksiz istek atmayalım.
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const { data: existing, error: readErr } = await admin
    .from("tcmb_rates")
    .select("rate_date")
    .gte("rate_date", since.toISOString().slice(0, 10));
  if (readErr) {
    console.error(`tcmb_rates okunamadı: ${readErr.message}`);
    process.exit(1);
  }
  const have = new Set((existing ?? []).map((r) => String(r.rate_date)));
  console.log(`Kayıtlı gün: ${have.size} — eksikler taranıyor…`);

  let inserted = 0;
  let skippedHave = 0;
  let skippedNoPublication = 0;
  let failed = 0;

  for (let i = 0; i < days; i += 1) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    if (have.has(iso)) {
      skippedHave += 1;
      continue;
    }

    const result = await fetchTcmbRate(d);
    if (!result.ok) {
      if (result.reason === "no-publication") {
        skippedNoPublication += 1; // hafta sonu/tatil — normal
      } else {
        failed += 1;
        console.warn(`${iso}: ${result.reason}${result.detail ? ` (${result.detail})` : ""}`);
      }
      // Nezaket arası — TCMB'ye seri istek yağdırma
      await sleep(150);
      continue;
    }

    const { error } = await admin.from("tcmb_rates").upsert(
      {
        rate_date: result.rate.rateDate,
        usd_buying: result.rate.usdBuying,
        usd_selling: result.rate.usdSelling,
        eur_buying: result.rate.eurBuying,
        eur_selling: result.rate.eurSelling,
      },
      { onConflict: "rate_date" },
    );
    if (error) {
      failed += 1;
      console.warn(`${iso}: DB yazım hatası (${error.message})`);
    } else {
      inserted += 1;
    }
    await sleep(150);
  }

  console.log(
    `Bitti — eklenen: ${inserted} · zaten kayıtlı: ${skippedHave} · yayın yok (tatil): ${skippedNoPublication} · hata: ${failed}`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("tcmb-backfill beklenmedik hata:", err);
  process.exit(1);
});
