/**
 * İLETİ İZNİ (İYS) UYUMU (saf, yan etkisiz). Kaynaklar: `iys_consents` (müşteri × kanal son durum; ofis yazar) ve
 * `iys_consent_events` (değişiklik kanıtı; silinmez). 6563 sayılı Kanun / İYS: ticari elektronik ileti yalnız ONAYLI
 * alıcıya gönderilir; "bilinmiyor" ve "bekliyor" durumları gönderim için izin SAYILMAZ.
 */

export const CONSENT_CHANNELS = ["sms", "email", "whatsapp", "call"] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];
export const CONSENT_STATUSES = ["granted", "denied", "unknown", "pending"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const CHANNEL_LABELS: Record<ConsentChannel, string> = { sms: "SMS", email: "E-posta", whatsapp: "WhatsApp", call: "Arama" };
export const STATUS_LABELS: Record<ConsentStatus, string> = { granted: "Onaylı", denied: "Ret", unknown: "Bilinmiyor", pending: "Bekliyor" };

export type ConsentCounts = Record<ConsentChannel, Record<ConsentStatus, number | null>>;

export type ChannelCoverage = {
  channel: ConsentChannel;
  total: number;
  granted: number;
  denied: number;
  /** Gönderime engel ama kararı verilmemiş (bilinmiyor + bekliyor). */
  undecided: number;
  /** Onaylı / toplam (yüzde, 1 ondalık); kayıt yoksa null. */
  grantedPct: number | null;
  /** Sayım okunamadıysa true (kanal satırında "—"). */
  unreadable: boolean;
};

export function channelCoverage(counts: ConsentCounts): ChannelCoverage[] {
  return CONSENT_CHANNELS.map((channel) => {
    const c = counts[channel];
    const unreadable = CONSENT_STATUSES.some((s) => c[s] === null);
    const n = (s: ConsentStatus) => c[s] ?? 0;
    const total = n("granted") + n("denied") + n("unknown") + n("pending");
    return {
      channel,
      total,
      granted: n("granted"),
      denied: n("denied"),
      undecided: n("unknown") + n("pending"),
      grantedPct: total > 0 ? Math.round((n("granted") / total) * 1000) / 10 : null,
      unreadable,
    };
  });
}

export type ConsentEventRow = {
  tenantId: string;
  channel: ConsentChannel;
  from: ConsentStatus | null;
  to: ConsentStatus;
  source: string;
  occurredAt: string;
};

export type ConsentActivity = {
  grants: number;
  revocations: number;
  /** Ret'e dönen değişikliği en çok olan ofisler (şikâyet/yanlış gönderim sinyali). */
  revocationOffices: { tenantId: string; revocations: number; grants: number }[];
  /** Kaynak → değişiklik sayısı (ör. "manual", "public_form", "import"). */
  sources: { source: string; count: number }[];
};

export function consentActivity(events: readonly ConsentEventRow[], limit = 10): ConsentActivity {
  let grants = 0;
  let revocations = 0;
  const offices = new Map<string, { revocations: number; grants: number }>();
  const sources = new Map<string, number>();
  for (const e of events) {
    const o = offices.get(e.tenantId) ?? { revocations: 0, grants: 0 };
    if (e.to === "denied" && e.from !== "denied") {
      revocations += 1;
      o.revocations += 1;
    } else if (e.to === "granted" && e.from !== "granted") {
      grants += 1;
      o.grants += 1;
    }
    offices.set(e.tenantId, o);
    const key = (e.source || "bilinmiyor").slice(0, 40);
    sources.set(key, (sources.get(key) ?? 0) + 1);
  }
  return {
    grants,
    revocations,
    revocationOffices: [...offices.entries()]
      .filter(([, o]) => o.revocations > 0)
      .map(([tenantId, o]) => ({ tenantId, ...o }))
      .sort((a, b) => b.revocations - a.revocations)
      .slice(0, limit),
    sources: [...sources.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count).slice(0, 8),
  };
}

/** `iys_consent_events.source` değerleri (tetikleyici: verilmezse `system`; KVKK silmesinde `kvkk_erasure`). */
const SOURCE_LABELS: Record<string, string> = {
  manual: "Elle (ofis)",
  web: "Web formu",
  import: "İçe aktarma",
  system: "Sistem",
  kvkk_erasure: "KVKK silmesi",
  bilinmiyor: "Bilinmiyor",
};

export function consentSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replace(/[_-]+/g, " ");
}
