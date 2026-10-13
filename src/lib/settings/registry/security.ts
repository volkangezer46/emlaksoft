import type { AnySettingDef } from "../types";
import { defineBool, defineEnum, defineInt, defineString } from "./define";
import {
  ADMIN_IP_ALLOWLIST_KEY,
  DEFAULT_IDLE_MINUTES,
  DEFAULT_MAX_HOURS,
  SESSION_IDLE_MINUTES_KEY,
  SESSION_MAX_HOURS_KEY,
  validateAllowlist,
} from "@/lib/platform-security/admin-access";
import { STEP_UP_REQUIRED_KEY } from "@/lib/platform-security/step-up-policy";
import {
  BACKUP_AGE_RECIPIENT_KEY,
  BACKUP_REMOTE_KIND_KEY,
  BACKUP_REMOTE_PORT_KEY,
  BACKUP_REMOTE_TARGET_KEY,
  RESTORE_DRILL_WEEKDAY_KEY,
  validateAgeRecipient,
  validateRemoteTarget,
} from "@/lib/ops/backup-settings";

/**
 * AD11 güvenlik ve yedek ayarları (platform kapsamı, `platform_settings` deposu). Erişim politikası Personel >
 * Güvenlik politikası ekranında (merkez bağlantı gösterir), yedek ayarları Sistem Ayarları Merkezi > Sağlık ve izleme'de düzenlenir.
 * Güvenli varsayılanlar: IP listesi boş (kısıt yok), boşta 60 dk, oturum 12 saat, kritik işlemde TOTP AÇIK,
 * yedek şifreleme/uzak kopya anahtar girilene kadar KAPALI, tatbikat Pazar.
 */
const SECURITY_HOME = { href: "/admin/personel/guvenlik#erisim", label: "Personel > Güvenlik politikası" } as const;
const SUPER_SECURITY = { platformModule: "personel", superAdminOnly: true } as const;

export const SECURITY_SETTING_DEFS: AnySettingDef[] = [
  defineString({
    key: ADMIN_IP_ALLOWLIST_KEY,
    home: SECURITY_HOME,
    permission: SUPER_SECURITY,
    default: "",
    maxLength: 4000,
    multiline: true,
    category: "guvenlik",
    label: "Yönetim paneli IP izin listesi",
    description: "Satır ya da virgülle IPv4/IPv6 adres veya CIDR (ör. 203.0.113.7, 10.0.0.0/8). Boş = her IP'den erişim.",
    impact:
      "Doluysa listede olmayan IP /admin ve /api/admin'de 403 alır (≤30 sn içinde). Kendinizi kilitlerseniz: .env.production'da ADMIN_IP_ALLOWLIST=off.",
    risk: "high",
    crossRule: (v: string) => validateAllowlist(v),
  }),
  defineInt({
    key: SESSION_IDLE_MINUTES_KEY,
    home: SECURITY_HOME,
    permission: SUPER_SECURITY,
    default: DEFAULT_IDLE_MINUTES,
    min: 0,
    max: 1440,
    unit: "dk",
    category: "guvenlik",
    label: "Yönetim oturumu boşta kalma süresi",
    description: "Personel bu süre boyunca yönetim panelinde işlem yapmazsa oturumu kapanır. 0 = kapalı.",
    impact: "Düşürmek terk edilmiş oturum riskini azaltır; çok düşük değer personeli sık sık yeniden girişe zorlar.",
    risk: "high",
  }),
  defineInt({
    key: SESSION_MAX_HOURS_KEY,
    home: SECURITY_HOME,
    permission: SUPER_SECURITY,
    default: DEFAULT_MAX_HOURS,
    min: 0,
    max: 168,
    unit: "saat",
    category: "guvenlik",
    label: "Yönetim oturumu en uzun ömrü",
    description: "Girişten bu kadar saat sonra personel oturumu (etkinlikten bağımsız) kapanır. 0 = sınırsız.",
    impact: "Süre dolunca personel yeniden parola + doğrulayıcı ile girer; bürünme (destek erişimi) kendi 4 saat sınırıyla sürer.",
    risk: "high",
  }),
  defineBool({
    key: STEP_UP_REQUIRED_KEY,
    home: SECURITY_HOME,
    permission: SUPER_SECURITY,
    default: true,
    category: "guvenlik",
    label: "Kritik işlemlerde doğrulayıcı kodu iste",
    description: "İade, kredi, sahiplik devri, ofis kapatma ve rol değişikliği tamamlanmadan önce TOTP kodu istenir.",
    impact: "Kapatılırsa bu işlemler yalnız oturumla yapılır (çalınan oturum para/rol işlemi yapabilir). Kapatmak önerilmez.",
    risk: "high",
  }),
  defineString({
    key: BACKUP_AGE_RECIPIENT_KEY,
    default: "",
    maxLength: 120,
    category: "saglik",
    label: "Yedek şifreleme açık anahtarı (age)",
    description: "age alıcı anahtarı (age1…). Gece yedeği bu anahtarla .age olarak şifrelenir; gizli anahtar sunucuda TUTULMAZ.",
    impact: "Boşsa yedek şifresiz yazılır (kart uyarır). Yanlış anahtar girilirse yedekler o anahtarın sahibince açılabilir.",
    risk: "high",
    crossRule: (v: string) => validateAgeRecipient(v),
  }),
  defineEnum({
    key: BACKUP_REMOTE_KIND_KEY,
    default: "off",
    options: [
      { value: "off", label: "Kapalı" },
      { value: "ssh", label: "Hetzner Storage Box (rsync/ssh)" },
      { value: "rclone", label: "S3 uyumlu (rclone uzak adı)" },
    ],
    category: "saglik",
    label: "Yedek uzak kopya türü",
    description: "Gece yedeğinin sunucu dışına kopyalanma yolu. Anahtarlar (ssh anahtarı, rclone yapılandırması) yalnız sunucuda durur.",
    impact: "Kapalıyken yedekler yalnız bu sunucuda kalır (disk kaybında yedek de gider).",
    risk: "high",
  }),
  defineString({
    key: BACKUP_REMOTE_TARGET_KEY,
    default: "",
    maxLength: 300,
    category: "saglik",
    label: "Yedek uzak hedefi",
    description: "Storage Box: kullanici@kullanici.your-storagebox.de:klasor · S3: rclone uzak adı ve yol (ör. yedek:emlaksoft-yedek).",
    impact: "Yanlış hedefte uzak kopya başarısız olur, yedek yerelde kalır ve nabız 'hata' yazar.",
    risk: "high",
    crossRule: (v: string) => validateRemoteTarget(v),
  }),
  defineInt({
    key: BACKUP_REMOTE_PORT_KEY,
    default: 23,
    min: 1,
    max: 65535,
    category: "saglik",
    label: "Storage Box ssh portu",
    description: "rsync/ssh uzak kopya portu (Hetzner Storage Box: 23).",
    impact: "Yalnız Storage Box türünde kullanılır.",
  }),
  defineEnum({
    key: RESTORE_DRILL_WEEKDAY_KEY,
    default: "0",
    options: [
      { value: "off", label: "Kapalı" },
      { value: "1", label: "Pazartesi" },
      { value: "2", label: "Salı" },
      { value: "3", label: "Çarşamba" },
      { value: "4", label: "Perşembe" },
      { value: "5", label: "Cuma" },
      { value: "6", label: "Cumartesi" },
      { value: "0", label: "Pazar" },
    ],
    category: "saglik",
    label: "Haftalık geri yükleme tatbikatı günü",
    description: "Bu gün gece yedeği alındıktan sonra yedek geçici bir veritabanı konteynerine yüklenir ve satır sayıları karşılaştırılır.",
    impact: "Kapalıyken yedeğin gerçekten geri yüklenebildiği düzenli doğrulanmaz. Başarısız tatbikat süper adminlere bildirim düşer.",
    risk: "high",
  }),
];
