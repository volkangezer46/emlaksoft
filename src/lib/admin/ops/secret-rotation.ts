/**
 * SIR ROTASYON YAŞI (SAF; DB yok). Sistem > Entegrasyonlar > "Anahtar yaşı" bölümünün kataloğu ve kuralı.
 * Değer ASLA bu modele girmez: yalnız ad, tanımlı mı ve son döndürme zamanı (meta veri).
 *  - Panelden girilen anahtarlar (ayar defteri gizli ayarları + EmlakFiyatı + PageSpeed): son döndürme = `settings_history`
 *    içinde değer yazılan (parmak izli) son satır (`write_setting` her gizli yazımda atomik yazar); EmlakFiyatı kendi
 *    `emlakfiyati_key_changed_at` damgasını taşır. Geçmiş satırı yoksa `platform_settings.updated_at` (yalnız sütun).
 *  - Sunucu ortamı anahtarları (.env.production): değer okunmaz, yalnız TANIMLI MI. Döndürme tarihi isteğe bağlı eş
 *    değişkenden okunur: `<AD>_ROTATED_AT=YYYY-MM-DD` (gizli değil; yayıncı anahtarı değiştirince günceller). Yoksa
 *    "izlenmiyor" yazılır, uydurulmaz.
 */

export const SECRET_ROTATION_WARN_DAYS = 180;
const DAY_MS = 86_400_000;

export type SecretGroup = "entegrasyon" | "yapay_zeka" | "portal" | "imza";

export const SECRET_GROUP_LABELS: Record<SecretGroup, string> = {
  entegrasyon: "Entegrasyon anahtarları",
  yapay_zeka: "Yapay zeka",
  portal: "Portal anahtarları",
  imza: "İmza ve şifreleme anahtarları",
};

export type EnvSecretDef = { name: string; label: string; group: SecretGroup };

/** Sunucu ortamı anahtarları (yalnız ad + tanımlı mı; değer okunmaz/basılmaz). */
export const ENV_SECRETS: readonly EnvSecretDef[] = [
  { name: "IYZICO_API_KEY", label: "iyzico API anahtarı", group: "entegrasyon" },
  { name: "IYZICO_SECRET_KEY", label: "iyzico gizli anahtarı", group: "entegrasyon" },
  { name: "EVDS_API_KEY", label: "TCMB EVDS API anahtarı", group: "entegrasyon" },
  { name: "RESEND_API_KEY", label: "Resend API anahtarı (ortam yedeği)", group: "entegrasyon" },
  { name: "META_APP_SECRET", label: "Meta (WhatsApp) uygulama sırrı", group: "entegrasyon" },
  { name: "OPENAI_API_KEY", label: "OpenAI API anahtarı (ortam yedeği)", group: "yapay_zeka" },
  { name: "PORTAL_RULES_SIGNING_KEY", label: "Portal kuralları imza anahtarı", group: "portal" },
  { name: "PLATFORM_SECRETS_KEY", label: "Panel sırları şifreleme anahtarı", group: "imza" },
  { name: "CRON_SECRET", label: "Zamanlanmış iş (cron) anahtarı", group: "imza" },
  { name: "TWO_FACTOR_COOKIE_SECRET", label: "2FA çerez imza anahtarı", group: "imza" },
  { name: "OTP_HMAC_SECRET", label: "Tek kullanımlık kod HMAC anahtarı", group: "imza" },
  { name: "PROPERTY_MEDIA_SIGNING_SECRET", label: "Portföy medyası imzalı bağlantı anahtarı", group: "imza" },
  { name: "WEBHOOK_SIGNING_SECRET", label: "Giden webhook imza anahtarı", group: "imza" },
  { name: "RESEND_WEBHOOK_SECRET", label: "Resend webhook imza anahtarı (ortam)", group: "imza" },
  { name: "NETGSM_WEBHOOK_SECRET", label: "Netgsm webhook anahtarı", group: "imza" },
  { name: "EIDS_INBOUND_SECRET", label: "EİDS gelen e-posta anahtarı", group: "imza" },
  { name: "HEALTHCHECK_SECRET", label: "Sağlık denetimi anahtarı", group: "imza" },
  { name: "FSBO_PHONE_HMAC_KEY", label: "Sahibinden ilan telefon HMAC anahtarı", group: "imza" },
  { name: "ADVISOR_PII_KEY", label: "AI danışmanı kişisel veri anahtarı", group: "imza" },
];

/** Panel anahtarının grubu (depolama anahtarına göre). */
export function panelSecretGroup(storageKey: string): SecretGroup {
  if (/openai/i.test(storageKey)) return "yapay_zeka";
  if (/^(sahibinden|hepsiemlak|emlakjet)_api_/.test(storageKey)) return "portal";
  if (/webhook/i.test(storageKey)) return "imza";
  return "entegrasyon";
}

export type SecretRotationRow = {
  id: string;
  label: string;
  group: SecretGroup;
  source: "panel" | "ortam";
  set: boolean;
  /** Son döndürme (ISO); null = izlenmiyor ya da hiç yazılmamış. */
  rotatedAt: string | null;
  ageDays: number | null;
  warn: boolean;
  href: string | null;
  /** Ortam anahtarında döndürme tarihinin okunduğu eş değişken adı. */
  trackVar?: string;
};

export const rotatedAtVar = (name: string) => `${name}_ROTATED_AT`;

/** "2026-09-01" ya da ISO → ISO; geçersiz/gelecek → null. */
export function parseRotatedAt(raw: string | null | undefined, nowMs: number): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
  if (!Number.isFinite(t) || t > nowMs + DAY_MS) return null;
  return new Date(t).toISOString();
}

export function rotationAge(rotatedAt: string | null, set: boolean, nowMs: number): { ageDays: number | null; warn: boolean } {
  if (!set || !rotatedAt) return { ageDays: null, warn: false };
  const ageDays = Math.max(0, Math.floor((nowMs - new Date(rotatedAt).getTime()) / DAY_MS));
  return { ageDays, warn: ageDays > SECRET_ROTATION_WARN_DAYS };
}

/** Uyarılılar önce, sonra yaşlıdan gence, izlenmeyenler ve tanımsızlar sonda. */
export function sortRotationRows(rows: readonly SecretRotationRow[]): SecretRotationRow[] {
  const rank = (r: SecretRotationRow) => (!r.set ? 3 : r.warn ? 0 : r.ageDays === null ? 2 : 1);
  return [...rows].sort((a, b) => rank(a) - rank(b) || (b.ageDays ?? -1) - (a.ageDays ?? -1) || a.label.localeCompare(b.label, "tr"));
}
