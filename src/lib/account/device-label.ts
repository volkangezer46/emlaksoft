/** user-agent'tan kısa cihaz etiketi (tam parser gerekmez, ipucu yeter). Saf fonksiyon; istemci/sunucu güvenli. */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return "Bilinmiyor";
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad|iOS/i.test(ua)
      ? "iOS"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac OS/i.test(ua)
          ? "macOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Diğer";
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\/|Opera/i.test(ua)
      ? "Opera"
      : /Chrome\//i.test(ua)
        ? "Chrome"
        : /Firefox\//i.test(ua)
          ? "Firefox"
          : /Safari\//i.test(ua)
            ? "Safari"
            : "Tarayıcı";
  return `${os} · ${browser}`;
}

export type LoginEventRow = {
  id: string;
  ip: string | null;
  user_agent: string | null;
  result: string;
  created_at: string;
};

export type DeviceSummary = {
  label: string;
  lastSeenAt: string;
  lastIp: string | null;
  successCount: number;
};

/**
 * Başarılı girişleri cihaz etiketine göre gruplar (en yeni önce). Supabase istemci API'si tekil oturum
 * listesi vermez; bu özet yalnız GİRİŞ KAYITLARINDAN türetilir: "son etkinlik" = o cihazdan son giriş,
 * açık/kapalı oturum bilgisi DEĞİLDİR.
 */
export function summarizeDevices(events: LoginEventRow[]): DeviceSummary[] {
  const map = new Map<string, DeviceSummary>();
  const ordered = [...events]
    .filter((e) => e.result === "success")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const e of ordered) {
    const label = deviceLabel(e.user_agent);
    const hit = map.get(label);
    if (hit) hit.successCount += 1;
    else map.set(label, { label, lastSeenAt: e.created_at, lastIp: e.ip, successCount: 1 });
  }
  return [...map.values()];
}
