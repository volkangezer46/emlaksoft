/**
 * ENTEGRASYON MERKEZİ — görünüm modeli (SAF, testli). Admin > Sistem > Entegrasyonlar (`?sekme=entegrasyonlar`).
 *
 * Her dış entegrasyon için tek kart: yapılandırıldı mı, son başarılı/başarısız çağrı, 7 günlük hata oranı, kota/maliyet,
 * son "Test et" sonucu ve "nereden girilir" bağlantısı. Okuyucu `read.ts` (sunucu), yoklayıcı `probe.ts` (sunucu).
 * Sır değerleri bu modele HİÇ girmez: yalnız `secretFingerprint` parmak izi (sha256 öneki, geri çıkarılamaz).
 */

export const INTEGRATIONS_HREF = "/admin/sistem?sekme=entegrasyonlar";

export const HUB_KEYS = [
  "iyzico",
  "netgsm",
  "resend",
  "whatsapp",
  "google_gsc",
  "google_ads",
  "openai",
  "evds",
  "vapid",
  "emlakfiyati",
  "portal_extension",
  "portal_api",
] as const;

export type HubKey = (typeof HUB_KEYS)[number];

export function isHubKey(v: unknown): v is HubKey {
  return typeof v === "string" && (HUB_KEYS as readonly string[]).includes(v);
}

export type HubCategory = "odeme" | "iletisim" | "google" | "veri" | "portal";

export const HUB_CATEGORY_LABELS: Record<HubCategory, string> = {
  odeme: "Ödeme",
  iletisim: "İletişim",
  google: "Google",
  veri: "Veri ve yapay zeka",
  portal: "Portal",
};

export type HubMeta = {
  label: string;
  category: HubCategory;
  description: string;
  /** Anahtarın girildiği ekran (yapılandırılmadıysa kart buraya yönlendirir); null = yalnız sunucu ortamından girilir. */
  configureHref: string | null;
  configureLabel: string;
  /** "Test et" ne yapar (kartta açıklama); null = zararsız test tanımlı değil. */
  testNote: string | null;
};

export const HUB_META: Record<HubKey, HubMeta> = {
  iyzico: {
    label: "iyzico ödeme",
    category: "odeme",
    description: "Abonelik tahsilatı ve güvenli ödeme bağlantıları.",
    configureHref: null,
    configureLabel: "Sunucu ortamı (.env.production): IYZICO_API_KEY, IYZICO_SECRET_KEY, IYZICO_BASE_URL",
    testNote: "Sabit bir BIN sorgusu (ödeme oluşturmaz)",
  },
  netgsm: {
    label: "Netgsm SMS",
    category: "iletisim",
    description: "Platform yedek SMS hesabı (ofisler kendi Netgsm hesabını bağlar).",
    configureHref: `${INTEGRATIONS_HREF}#anahtar-mesaj`,
    configureLabel: "Bu sayfada: SMS ve WhatsApp sağlayıcısı",
    testNote: "Kredi bakiyesi sorgusu (SMS göndermez)",
  },
  resend: {
    label: "E-posta (Resend)",
    category: "iletisim",
    description: "İşlemsel e-postalar: doğrulama, fatura, bildirim.",
    configureHref: `${INTEGRATIONS_HREF}#anahtar-eposta`,
    configureLabel: "Bu sayfada: E-posta kanalı",
    testNote: "Alan adı listesi okunur (e-posta göndermez)",
  },
  whatsapp: {
    label: "WhatsApp (platform)",
    category: "iletisim",
    description: "Platform WhatsApp API'si (ofisler kendi WhatsApp Business hesabını bağlar).",
    configureHref: `${INTEGRATIONS_HREF}#anahtar-mesaj`,
    configureLabel: "Bu sayfada: SMS ve WhatsApp sağlayıcısı",
    testNote: "Meta Graph telefon kaydı okunur (mesaj göndermez)",
  },
  google_gsc: {
    label: "Google Search Console",
    category: "google",
    description: "Arama performansı ve URL denetimi verisi.",
    configureHref: "/admin/site/baglantilar",
    configureLabel: "Site, SEO ve Reklam > Bağlantılar",
    testNote: "Belirteç yenilenir ve mülk listesi okunur",
  },
  google_ads: {
    label: "Google Ads",
    category: "google",
    description: "Kampanya performansı ve reklam önerileri.",
    configureHref: "/admin/site/baglantilar",
    configureLabel: "Site, SEO ve Reklam > Bağlantılar",
    testNote: "Belirteç yenilenir ve hesap adı okunur (değişiklik yapmaz)",
  },
  openai: {
    label: "OpenAI",
    category: "veri",
    description: "Asistan, ilan metni, OCR ve platform AI özellikleri.",
    configureHref: `${INTEGRATIONS_HREF}#anahtar-openai`,
    configureLabel: "Bu sayfada: Yapay zeka anahtarı",
    testNote: "Model listesi okunur (ücretsiz, veri gönderilmez)",
  },
  evds: {
    label: "TCMB EVDS",
    category: "veri",
    description: "Konut kredisi faizi ve TÜFE serileri (tcmb-kur cron'u).",
    configureHref: null,
    configureLabel: "Sunucu ortamı (.env.production): EVDS_API_KEY",
    testNote: "TÜFE serisinin son 2 ayı okunur",
  },
  vapid: {
    label: "Web push (VAPID)",
    category: "iletisim",
    description: "Tarayıcı ve mobil anlık bildirimleri.",
    configureHref: null,
    configureLabel: "Sunucu ortamı (.env.production): NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY",
    testNote: "Anahtar çifti yerelde doğrulanır (bildirim göndermez)",
  },
  emlakfiyati: {
    label: "EmlakFiyati",
    category: "veri",
    description: "Bölge endeksi, değerleme ve analiz raporları.",
    configureHref: `${INTEGRATIONS_HREF}#anahtar-emlakfiyati`,
    configureLabel: "Bu sayfada: EmlakFiyati API anahtarı",
    testNote: "İstanbul konut endeksi okunur",
  },
  portal_extension: {
    label: "Portal eklentisi",
    category: "portal",
    description: "Tarayıcı eklentisi: portala aktarım ve ilan kontrolü.",
    // Mağaza bağlantısı yalnız sunucu ortamından gelir (extension-release.ts); panelde girilecek ekran yok.
    configureHref: null,
    configureLabel: "Sunucu ortamı (.env.production): NEXT_PUBLIC_LISTING_EXTENSION_CWS_URL, NEXT_PUBLIC_LISTING_EXTENSION_EDGE_URL",
    testNote: "İndirme paketi sunucuda var mı denetlenir",
  },
  portal_api: {
    label: "Kurumsal portal API",
    category: "portal",
    description: "Sahibinden, Hepsiemlak, Emlakjet kurumsal ilan API'si.",
    configureHref: `${INTEGRATIONS_HREF}#anahtar-portal`,
    configureLabel: "Bu sayfada: Portal API anahtarları",
    testNote: null,
  },
};

/** Kayıtlı 7 günlük çağrı istatistiği. `source` neyin sayıldığını açıkça söyler (sahte metrik yok). */
export type CallStats = {
  ok: number;
  fail: number;
  source: string;
  /** Sayıların açıldığı süzülmüş hedef (sıfır çıkmaz metrik). */
  href: string;
};

/** `action`: kaydın gerçek denetim eylemi (eski akışlar farklı ad taşır; kart bağlantısı bununla süzer). */
export type LastTest = { at: string; ok: boolean; message: string | null; durationMs: number | null; action: string };

export type Fingerprint = { label: string; value: string };

export type HubTone = "ok" | "warn" | "danger" | "off";

export type HubCard = {
  key: HubKey;
  meta: HubMeta;
  configured: boolean;
  /** Ek durum notu (ör. "Kaynak: sunucu ortamı", "Belirteç geri çekilmiş"). */
  notes: string[];
  /** Sağlayıcının bildirdiği/bilinen alarm (ör. 401). */
  alarm: string | null;
  fingerprints: Fingerprint[];
  /** Kayıtlardan son başarılı / başarısız çağrı (ISO; kayıt yoksa null). */
  lastOkAt: string | null;
  lastFailAt: string | null;
  stats: CallStats | null;
  /** Kota/maliyet satırı (veri yoksa null; uydurulmaz). */
  usage: { text: string; href: string } | null;
  lastTest: LastTest | null;
};

/** 7 günlük hata oranı (%), çağrı yoksa null. */
export function errorRate(stats: Pick<CallStats, "ok" | "fail"> | null): number | null {
  if (!stats) return null;
  const total = stats.ok + stats.fail;
  if (total <= 0) return null;
  return Math.round((stats.fail / total) * 1000) / 10;
}

/** Kart tonu: yapılandırılmadı → off; alarm, son test başarısız ya da hata oranı ≥ %20 → danger; hata var → warn. */
export function cardTone(card: Pick<HubCard, "configured" | "alarm" | "stats" | "lastTest">): HubTone {
  if (!card.configured) return "off";
  if (card.alarm) return "danger";
  if (card.lastTest && !card.lastTest.ok) return "danger";
  const rate = errorRate(card.stats);
  if (rate !== null && rate >= 20) return "danger";
  if (rate !== null && rate > 0) return "warn";
  return "ok";
}

export const TONE_LABELS: Record<HubTone, string> = {
  ok: "Çalışıyor",
  warn: "Hata var",
  danger: "Sorunlu",
  off: "Yapılandırılmadı",
};

/** Test kaydının denetim eylemi (platform_audit_logs.action). EmlakFiyati'nin mevcut eylemiyle aynı biçim. */
export const testAction = (key: HubKey): string => `integration.${key}.test`;

type AuditRow = { action: string; created_at: string; meta: Record<string, unknown> | null };

/** Merkezden önce var olan test akışlarının eylem adları (kartın "son test" satırı bunları da okur). */
export const LEGACY_TEST_ACTIONS: Readonly<Record<string, HubKey>> = {
  "integration.email.test_connection": "resend",
};

function testKeyOf(action: string): HubKey | null {
  const legacy = LEGACY_TEST_ACTIONS[action];
  if (legacy) return legacy;
  const m = action.match(/^integration\.([a-z_]+)\.test$/);
  return m && isHubKey(m[1]) ? m[1] : null;
}

/**
 * Denetim kayıtlarından her entegrasyonun SON test sonucu (satırlar yeniden eskiye sıralı gelir).
 * EmlakFiyati'nin eski kayıtları `meta.state` taşır ("connected" = başarılı); e-posta ayarlarındaki bağlantı testi
 * (`integration.email.test_connection`) Resend kartına sayılır.
 */
export function lastTestsFrom(rows: readonly AuditRow[]): Partial<Record<HubKey, LastTest>> {
  const out: Partial<Record<HubKey, LastTest>> = {};
  for (const r of rows) {
    const key = testKeyOf(r.action);
    if (!key || out[key]) continue;
    const meta = r.meta ?? {};
    const ok = meta.ok === true || meta.state === "connected";
    const message = typeof meta.message === "string" ? meta.message : typeof meta.state === "string" ? `Durum: ${meta.state}` : null;
    const durationMs = typeof meta.duration_ms === "number" ? meta.duration_ms : null;
    out[key] = { at: r.created_at, ok, message, durationMs, action: r.action };
  }
  return out;
}

/** Son başarılı/başarısız zamanını iki adaydan en yeniyle birleştirir (ISO). */
export function latest(...values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const v of values) if (v && (!best || v > best)) best = v;
  return best;
}

/** Yapılandırılmamış kartlar sona, sonra tona göre (sorunlu önce). */
export function sortCards(cards: readonly HubCard[]): HubCard[] {
  const rank: Record<HubTone, number> = { danger: 0, warn: 1, ok: 2, off: 3 };
  return [...cards].sort((a, b) => rank[cardTone(a)] - rank[cardTone(b)] || HUB_KEYS.indexOf(a.key) - HUB_KEYS.indexOf(b.key));
}

/** URL'den yalnız host (webhook adresinin yolu/sorgusu belirteç taşıyabilir; ekrana yalnız host düşer). */
export function hostOf(url: string | null | undefined): string {
  if (!url) return "—";
  try {
    return new URL(url).hostname;
  } catch {
    return "—";
  }
}

/** VAPID anahtar çifti biçim denetimi (SAF): genel anahtar 65 bayt (0x04 ile başlar), özel anahtar 32 bayt, base64url. */
export function validateVapidPair(pub: string | null | undefined, priv: string | null | undefined): { ok: boolean; message: string } {
  if (!pub || !priv) return { ok: false, message: "VAPID anahtarları tanımlı değil." };
  const decode = (s: string): Uint8Array | null => {
    if (!/^[A-Za-z0-9_-]+=*$/.test(s.trim())) return null;
    try {
      return Uint8Array.from(Buffer.from(s.trim().replace(/-/g, "+").replace(/_/g, "/"), "base64"));
    } catch {
      return null;
    }
  };
  const p = decode(pub);
  const k = decode(priv);
  if (!p || p.length !== 65 || p[0] !== 4) return { ok: false, message: "Genel VAPID anahtarı geçersiz (65 baytlık P-256 noktası bekleniyor)." };
  if (!k || k.length !== 32) return { ok: false, message: "Özel VAPID anahtarı geçersiz (32 bayt bekleniyor)." };
  return { ok: true, message: "VAPID anahtar çifti biçimce geçerli." };
}
