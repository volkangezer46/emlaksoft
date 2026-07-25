import "server-only";

/**
 * TCMB günlük döviz kuru — resmî açık veri.
 *
 * Neden bu modül var: Türkiye emlak piyasası fiilen dolarize. Bir portföyün
 * "₺ bazında zamlandığı ama döviz bazında ucuzladığı" bilgisi hem danışmanın
 * müşteriyle konuşmasını hem de piyasa analizini değiştiriyor.
 *
 * Kaynak seçimi bilinçli: üçüncü taraf sitelerden veri kazımıyoruz, doğrudan
 * TCMB'nin kendi yayınını okuyoruz. Veri kamuya açık ve serbest.
 *
 * TCMB davranışı — bilinmesi gerekenler:
 *  * Yayın saati ~15:30 (Europe/Istanbul). Öncesinde "today.xml" dünün verisi
 *    olabilir, bu yüzden cron akşam çalışır.
 *  * Hafta sonu ve resmî tatillerde YAYIN YOK → URL 404 döner. Bu bir hata
 *    değil, normal durum; çağıran bunu böyle ele almalı.
 *  * Tarihsel URL biçimi: /kurlar/YYYYMM/DDMMYYYY.xml
 */

export type TcmbRate = {
  /** TCMB'nin yayın tarihi (kurun geçerli olduğu gün) */
  rateDate: string; // YYYY-MM-DD
  usdBuying: number | null;
  usdSelling: number | null;
  eurBuying: number | null;
  eurSelling: number | null;
};

const BASE = "https://www.tcmb.gov.tr/kurlar";

function two(n: number) {
  return String(n).padStart(2, "0");
}

/** Tarihsel yayın URL'i. TCMB dizin yapısı: /kurlar/YYYYMM/DDMMYYYY.xml */
export function tcmbUrlForDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = two(date.getUTCMonth() + 1);
  const d = two(date.getUTCDate());
  return `${BASE}/${y}${m}/${d}${m}${y}.xml`;
}

/**
 * XML'den tek bir kur alanını çeker.
 *
 * Neden hazır XML parser yok: bağımlılık eklemeye değmeyecek kadar dar bir
 * biçim (tek seviye, sabit etiketler) ve sunucu tarafında DOMParser yok.
 * Desen `Kod="USD"` bloğunun içindeki ilgili etiketi hedefler.
 */
function pickRate(xml: string, code: "USD" | "EUR", tag: "ForexBuying" | "ForexSelling"): number | null {
  // Currency bloğunu izole et — başka para biriminin değerini yakalamamak için
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

/** XML'deki yayın tarihini `Tarih="DD.MM.YYYY"` özniteliğinden okur. */
function pickDate(xml: string): string | null {
  const m = /Tarih="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export type TcmbFetchResult =
  | { ok: true; rate: TcmbRate }
  | { ok: false; reason: "no-publication" | "fetch-error" | "parse-error"; detail?: string };

/**
 * Belirli bir günün kurunu çeker.
 *
 * `no-publication` bir HATA DEĞİL: hafta sonu/tatilde TCMB yayın yapmaz.
 * Çağıran bunu sessizce geçmeli, alarm üretmemeli.
 */
export async function fetchTcmbRate(date: Date): Promise<TcmbFetchResult> {
  const url = tcmbUrlForDate(date);

  let res: Response;
  try {
    res = await fetch(url, {
      // Arşiv verisi değişmez; ama cron zaten günde bir çalışıyor.
      cache: "no-store",
      headers: { accept: "application/xml,text/xml,*/*" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { ok: false, reason: "fetch-error", detail: String(err).slice(0, 200) };
  }

  if (res.status === 404) return { ok: false, reason: "no-publication" };
  if (!res.ok) return { ok: false, reason: "fetch-error", detail: `HTTP ${res.status}` };

  const xml = await res.text();

  // TCMB bazen 404 yerine HTML hata sayfası döndürüyor
  if (!xml.includes("<Currency")) return { ok: false, reason: "no-publication" };

  const rateDate = pickDate(xml);
  if (!rateDate) return { ok: false, reason: "parse-error", detail: "Tarih özniteliği bulunamadı" };

  const rate: TcmbRate = {
    rateDate,
    usdBuying: pickRate(xml, "USD", "ForexBuying"),
    usdSelling: pickRate(xml, "USD", "ForexSelling"),
    eurBuying: pickRate(xml, "EUR", "ForexBuying"),
    eurSelling: pickRate(xml, "EUR", "ForexSelling"),
  };

  // Satış kurları olmadan kayıt anlamsız — değerleme onları kullanıyor
  if (rate.usdSelling === null && rate.eurSelling === null) {
    return { ok: false, reason: "parse-error", detail: "USD/EUR satış kuru okunamadı" };
  }

  return { ok: true, rate };
}

/** Bugünden geriye doğru `days` günü tarar; ilk bulduğu yayını döndürür. */
export async function fetchLatestTcmbRate(days = 7): Promise<TcmbFetchResult> {
  for (let i = 0; i < days; i += 1) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const result = await fetchTcmbRate(d);
    if (result.ok) return result;
    if (result.reason === "fetch-error") return result; // ağ sorunu — geriye gitmenin anlamı yok
  }
  return { ok: false, reason: "no-publication", detail: `son ${days} günde yayın bulunamadı` };
}

/** ₺ tutarını verilen kurla çevirir. Kur yok/sıfırsa null (uydurma yapmaz). */
export function convertTry(
  amountTry: number | null | undefined,
  rate: number | null | undefined,
): number | null {
  if (amountTry === null || amountTry === undefined) return null;
  if (!rate || rate <= 0) return null;
  return Math.round((amountTry / rate) * 100) / 100;
}
