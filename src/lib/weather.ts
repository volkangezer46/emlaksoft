import { fetchExternal, readExternalJson, requireExternalSuccess } from "@/lib/external-fetch";
import { now } from "@/lib/clock";

/**
 * Ofis şehri için ANLIK HAVA DURUMU (ana ekran kahramanı, küçük çip). Kaynak: Open-Meteo (ücretsiz, anahtarsız,
 * https://open-meteo.com; yalnız koordinat gönderilir, kişisel veri yok). Sunucuda, sertleştirilmiş dış istek sınırından
 * (`fetchExternal`: yönlendirme reddi + 2,5 sn süre sınırı + 16 KB yanıt tavanı) geçer. Süreç içi 30 dk önbellek
 * (koordinat ~1 km'ye yuvarlanır; aynı şehirdeki ofisler tek isteği paylaşır). Hata/süre aşımı → null: çip hiç çizilmez.
 */
export type Weather = { tempC: number; code: number; isDay: boolean; label: string; kind: WeatherKind };
export type WeatherKind = "clear" | "partly" | "cloudy" | "fog" | "rain" | "snow" | "storm";

const TTL_MS = 30 * 60_000;
const FAIL_TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 200;
const memo = new Map<string, { at: number; ttl: number; value: Promise<Weather | null> }>();

/** WMO hava kodu → tür + Türkçe etiket. */
export function describeWeather(code: number): { kind: WeatherKind; label: string } {
  if (code === 0) return { kind: "clear", label: "Açık" };
  if (code === 1 || code === 2) return { kind: "partly", label: "Parçalı bulutlu" };
  if (code === 3) return { kind: "cloudy", label: "Kapalı" };
  if (code === 45 || code === 48) return { kind: "fog", label: "Sisli" };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { kind: "rain", label: code >= 80 ? "Sağanak yağışlı" : "Yağmurlu" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { kind: "snow", label: "Karlı" };
  if (code >= 95) return { kind: "storm", label: "Gök gürültülü" };
  return { kind: "cloudy", label: "Bulutlu" };
}

type OpenMeteo = { current?: { temperature_2m?: number; weather_code?: number; is_day?: number } };

/** Saf ayrıştırıcı (test edilir): eksik/bozuk alanda null. */
export function parseOpenMeteo(raw: unknown): Weather | null {
  const c = (raw as OpenMeteo | null)?.current;
  if (!c || typeof c.temperature_2m !== "number" || !Number.isFinite(c.temperature_2m) || typeof c.weather_code !== "number") return null;
  const d = describeWeather(c.weather_code);
  return { tempC: Math.round(c.temperature_2m), code: c.weather_code, isDay: c.is_day !== 0, ...d };
}

async function request(lat: number, lng: number): Promise<Weather | null> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lng.toFixed(2)}&current=temperature_2m,weather_code,is_day&timezone=Europe%2FIstanbul`;
  const res = await fetchExternal(url, { headers: { accept: "application/json" } }, { timeoutMs: 2500 });
  await requireExternalSuccess(res);
  return parseOpenMeteo(await readExternalJson<unknown>(res, 16 * 1024));
}

export function loadWeather(coords: { lat: number; lng: number } | null): Promise<Weather | null> {
  if (!coords) return Promise.resolve(null);
  const key = `${coords.lat.toFixed(2)},${coords.lng.toFixed(2)}`;
  const t = now();
  const hit = memo.get(key);
  if (hit && t - hit.at < hit.ttl) return hit.value;
  const entry = { at: t, ttl: TTL_MS, value: Promise.resolve<Weather | null>(null) };
  entry.value = request(coords.lat, coords.lng).catch(() => {
    entry.ttl = FAIL_TTL_MS;
    return null;
  });
  if (memo.size >= MAX_ENTRIES) memo.delete(memo.keys().next().value as string);
  memo.set(key, entry);
  return entry.value;
}
