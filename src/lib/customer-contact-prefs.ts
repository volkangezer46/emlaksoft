/**
 * Müşteri iletişim tercihi (CRM-G11) — TEK KAYNAK: kanal, uygun zaman dilimi ve dil.
 * Sütunlar: customers.preferred_channel / contact_window / preferred_language
 * (migration 20261018030030_customer_contact_prefs). Sütun yoksa okuyucu `null` döner ve
 * hiçbir yüzey tercih uydurmaz.
 *
 * SAF modül (istemci + sunucu): yalnız sabitler, doğrulama ve İstanbul saatine göre pencere hesabı.
 */

export const CONTACT_CHANNELS = ["call", "whatsapp", "sms", "email"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export const CONTACT_CHANNEL_LABELS: Record<ContactChannel, string> = {
  call: "Telefon",
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "E-posta",
};

export const CONTACT_WINDOWS = ["sabah", "ogle", "ogleden_sonra", "aksam", "hafta_sonu"] as const;
export type ContactWindow = (typeof CONTACT_WINDOWS)[number];

/** Saat aralıkları İstanbul saatiyle [başlangıç, bitiş) — "hafta_sonu" gün koşuludur, saat değil. */
export const CONTACT_WINDOW_HOURS: Record<Exclude<ContactWindow, "hafta_sonu">, [number, number]> = {
  sabah: [9, 12],
  ogle: [12, 14],
  ogleden_sonra: [14, 18],
  aksam: [18, 21],
};

export const CONTACT_WINDOW_LABELS: Record<ContactWindow, string> = {
  sabah: "Sabah (09:00–12:00)",
  ogle: "Öğle (12:00–14:00)",
  ogleden_sonra: "Öğleden sonra (14:00–18:00)",
  aksam: "Akşam (18:00–21:00)",
  hafta_sonu: "Hafta sonu",
};

export const CONTACT_WINDOW_SHORT: Record<ContactWindow, string> = {
  sabah: "sabah",
  ogle: "öğle",
  ogleden_sonra: "öğleden sonra",
  aksam: "akşam",
  hafta_sonu: "hafta sonu",
};

/** Sık kullanılan diller (ISO 639-1). Yabancı alıcı akışı (is_foreign) için. */
export const CONTACT_LANGUAGES = [
  { code: "tr", label: "Türkçe" },
  { code: "en", label: "İngilizce" },
  { code: "ru", label: "Rusça" },
  { code: "ar", label: "Arapça" },
  { code: "de", label: "Almanca" },
  { code: "fa", label: "Farsça" },
  { code: "uk", label: "Ukraynaca" },
  { code: "az", label: "Azerice" },
  { code: "fr", label: "Fransızca" },
  { code: "zh", label: "Çince" },
] as const;

export type ContactPrefs = {
  channel: ContactChannel | null;
  windows: ContactWindow[];
  language: string | null;
};

export const EMPTY_CONTACT_PREFS: ContactPrefs = { channel: null, windows: [], language: null };

export function isContactChannel(v: unknown): v is ContactChannel {
  return typeof v === "string" && (CONTACT_CHANNELS as readonly string[]).includes(v);
}

export function isContactWindow(v: unknown): v is ContactWindow {
  return typeof v === "string" && (CONTACT_WINDOWS as readonly string[]).includes(v);
}

export function isLanguageCode(v: unknown): v is string {
  return typeof v === "string" && /^[a-z]{2}$/.test(v);
}

/** Ham satır/form değerinden güvenli tercih; tanınmayan değerler atılır (sıra CONTACT_WINDOWS sırasıdır). */
export function sanitizeContactPrefs(input: { channel?: unknown; windows?: unknown; language?: unknown }): ContactPrefs {
  const rawWindows = Array.isArray(input.windows) ? input.windows : [];
  const set = new Set(rawWindows.filter(isContactWindow));
  return {
    channel: isContactChannel(input.channel) ? input.channel : null,
    windows: CONTACT_WINDOWS.filter((w) => set.has(w)),
    language: isLanguageCode(input.language) ? input.language : null,
  };
}

/** DB satırı (`preferred_channel`, `contact_window`, `preferred_language`) → tercih. */
export function contactPrefsFromRow(row: Record<string, unknown> | null | undefined): ContactPrefs {
  if (!row) return EMPTY_CONTACT_PREFS;
  return sanitizeContactPrefs({ channel: row.preferred_channel, windows: row.contact_window, language: row.preferred_language });
}

export function hasContactPrefs(p: ContactPrefs | null | undefined): p is ContactPrefs {
  return Boolean(p && (p.channel || p.windows.length > 0 || p.language));
}

export function languageLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return CONTACT_LANGUAGES.find((l) => l.code === code)?.label ?? code.toUpperCase();
}

/** Kısa rozet metni: "WhatsApp tercih · akşam · İngilizce". Tercih yoksa null. */
export function contactPrefsSummary(p: ContactPrefs | null | undefined): string | null {
  if (!hasContactPrefs(p)) return null;
  const parts: string[] = [];
  if (p.channel) parts.push(`${CONTACT_CHANNEL_LABELS[p.channel]} tercih`);
  if (p.windows.length) parts.push(p.windows.map((w) => CONTACT_WINDOW_SHORT[w]).join(", "));
  if (p.language && p.language !== "tr") parts.push(languageLabel(p.language) ?? p.language);
  return parts.join(" · ") || null;
}

/** İstanbul saatine göre gün (0=Pazar) ve saat. */
function istanbulDayHour(nowMs: number): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowMs));
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "12");
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  return { day: day < 0 ? 1 : day, hour: Number.isFinite(hour) ? hour : 12 };
}

/**
 * Şu an müşterinin uygun penceresi içinde mi? Pencere seçilmemişse `true` (kısıt yok).
 * Kural: saat dilimlerinden biri tutmalı; yalnız "hafta sonu" seçiliyse cumartesi/pazar her saat (09–21) uygundur;
 * "hafta sonu" + saat dilimi seçiliyse hafta sonu da hafta içi de saat dilimine bakılır, hafta sonu ayrıca 09–21 açıktır.
 */
export function isWithinContactWindow(windows: readonly ContactWindow[], nowMs: number): boolean {
  if (windows.length === 0) return true;
  const { day, hour } = istanbulDayHour(nowMs);
  const weekend = day === 0 || day === 6;
  const hourWindows = windows.filter((w): w is Exclude<ContactWindow, "hafta_sonu"> => w !== "hafta_sonu");
  if (weekend && windows.includes("hafta_sonu") && hour >= 9 && hour < 21) return true;
  if (hourWindows.length === 0) return false; // yalnız hafta sonu seçili, bugün hafta içi
  return hourWindows.some((w) => hour >= CONTACT_WINDOW_HOURS[w][0] && hour < CONTACT_WINDOW_HOURS[w][1]);
}

/** Pencere dışındaysa uyarı metni ("Uygun saat: akşam (18:00–21:00)"); içindeyse ya da pencere yoksa null. */
export function contactWindowNote(windows: readonly ContactWindow[], nowMs: number): string | null {
  if (windows.length === 0 || isWithinContactWindow(windows, nowMs)) return null;
  return `Uygun saat: ${windows.map((w) => CONTACT_WINDOW_LABELS[w].toLocaleLowerCase("tr-TR")).join(", ")}`;
}

/** "Tercih sütunu yok" hatası mı (migration 20261018030030 uygulanmamış)? PG 42703 / PostgREST PGRST204. */
export function isMissingContactPrefsColumn(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "42703" || code === "PGRST204") return true;
  const msg = (error.message ?? "").toLowerCase();
  return (
    /preferred_channel|contact_window|preferred_language/.test(msg) &&
    (msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("could not find"))
  );
}

/** Müşteri 360 okuması için sütun listesi. */
export const CONTACT_PREFS_COLUMNS = "preferred_channel, contact_window, preferred_language";
