import type { z } from "zod";
import type { AppModule } from "@/lib/permissions";
import type { PlatformModule } from "@/lib/platform-access";

/**
 * Ayar Kayit Defteri tipleri (SAF: sunucu/istemci ortak, yan etkisiz).
 * Tek kaynak: `registry/*.ts`. Okuma `read.ts`, yazma `write.ts`, gecmis `history.ts`.
 */

export type SettingScope = "platform" | "tenant" | "branch" | "user";
export type SettingStorage = "platform_settings" | "tenant_settings" | "tenant_column" | "tenant_table" | "user_prefs";
export type SettingSensitivity = "public" | "internal" | "secret";
export type SettingWorkflow = "direct" | "draft_publish";
export type SettingRisk = "low" | "high";
export type SettingValueType = "bool" | "int" | "number" | "string" | "enum" | "json";

/** Sistem Ayarlari Merkezi kategorileri (12; sira ekran sirasidir). */
export const SETTING_CATEGORIES = [
  { id: "faturalama", label: "Faturalama ve planlar", description: "Plan fiyatları, koltuk, deneme ve otomatik yenileme." },
  { id: "emlakfiyati", label: "EmlakFiyatı ve kontör", description: "Kontör tarifesi, paketler, hoş geldin kontörü ve mutabakat." },
  { id: "buyume", label: "Büyüme ve davet", description: "Referans ve ortak programı bayrakları, kurallar, TL kredi." },
  { id: "uyum", label: "Uyum ve mevzuat", description: "TÜFE, KVKK, KDV ve yetki belgesi sabitleri." },
  { id: "bildirim", label: "Bildirimler ve şablonlar", description: "SMS ve WhatsApp sağlayıcı ayarları." },
  { id: "cron", label: "Cron ve otomasyon", description: "Zamanlanmış görevler (zamanlama kodda; değiştirilemez)." },
  { id: "guvenlik", label: "Güvenlik", description: "İki adımlı doğrulama ve erişim ayarları." },
  { id: "entegrasyon", label: "Entegrasyonlar ve anahtarlar", description: "Üçüncü taraf anahtarları (maskeli) ve e-fatura." },
  { id: "ai", label: "AI ve kota", description: "OpenAI anahtarı ve kredi maliyet tablosu." },
  { id: "gorunum", label: "Görünüm ve marka", description: "Marka, SEO, site menüsü ve içerik (taslak/yayın)." },
  { id: "bayrak", label: "Özellik bayrakları", description: "Bakım modu ve kayıt gibi genel açma/kapama bayrakları." },
  { id: "saglik", label: "Sağlık ve izleme", description: "Sistem sağlığı, hata kayıtları ve cron nabzı." },
] as const;
export type SettingCategoryId = (typeof SETTING_CATEGORIES)[number]["id"];

/** Ofis Tanimlari Merkezi gruplari (yalniz scope=tenant ayarlarda; ekran sirasidir). */
export const OFFICE_SETTING_GROUPS = [
  { id: "sla", label: "SLA süreleri", description: "Müşteriye ne kadar sürede dönüş yapılması gerektiği." },
  { id: "esik", label: "Uyarı eşikleri", description: "Hareketsiz anlaşma ve bekleyen talep gibi uyarıların kaç günde başlayacağı." },
  { id: "komisyon", label: "Komisyon varsayılanları", description: "Komisyon hesaplayıcı ve bölüşüm ekranlarının başlangıç oran ve payları." },
  { id: "bildirim", label: "Bildirim varsayılanları", description: "Kendi tercihini kaydetmemiş kullanıcıların bildirim tercihleri." },
  { id: "atama", label: "Akıllı atama", description: "Ofis Merkezi'nde havuzdan danışman önerisinin ölçüt ağırlıkları ve atanmamış ilan SLA'sı." },
  { id: "dagitim", label: "Talep dağıtımı", description: "Yeni talebin hangi danışmana gideceği, mesai kuralı ve ilk dönüş süresi dolunca yeniden atama." },
  { id: "ai", label: "Yapay zekâ özellikleri", description: "AI ilan metni/çeviri ve sesli not özeti (hepsi varsayılan kapalı; kişisel veri maskelenir)." },
  { id: "erisim", label: "Erişim kapsamı", description: "Liste ekranlarının kullanıcı kapsamıyla (kendi / takım / şube) daraltılması." },
  { id: "iletisim", label: "Malik ve müşteri iletişimi", description: "Malik haftalık raporu, müşteri portalında güncel değer özeti ve vitrin sohbet asistanı (hepsi varsayılan kapalı)." },
  { id: "uyum", label: "Uyum ve veri paylaşımı", description: "Yetki belgesi yıllık harç hatırlatması ve anonim piyasa verisi paylaşım izni (varsayılan kapalı)." },
] as const;
export type OfficeSettingGroupId = (typeof OFFICE_SETTING_GROUPS)[number]["id"];

/** Merkezde duzenleme modu: center = ayar merkezinde duzenlenir; bridge = mevcut ekranda (merkez koprudur); locked = degistirilemez. */
export type SettingEditMode = "center" | "bridge" | "locked";

export type SettingCodec<T> = {
  /** Depodaki ham metni cozer; bozuk/bos = varsayilan (asla firlatmaz). */
  parse(raw: string | null | undefined): T;
  /** Depoya yazilacak metin (platform_settings.value metindir). */
  format(value: T): string;
};

export type SettingPermission = {
  /** Platform personeli icin modul (guardPlatformAction). */
  platformModule?: PlatformModule;
  superAdminOnly?: boolean;
  /** Ofis kapsami icin (requirePermission(mod, "edit")). */
  appModule?: AppModule;
};

export type SettingDef<T = unknown> = {
  /** Noktali kucuk harf (ornek `billing.trial_grace_days`). Eski depo anahtarlari legacy/depo adidir. */
  key: string;
  /** Depodaki gercek anahtar (platform_settings.key). Varsayilan: key. */
  storageKey?: string;
  legacyKeys?: readonly string[];
  type: SettingValueType;
  schema: z.ZodType<T>;
  default: T;
  scope: SettingScope;
  storage: SettingStorage;
  permission: SettingPermission;
  category: SettingCategoryId;
  /** Ofis merkezi grubu (scope=tenant icin zorunlu). */
  group?: OfficeSettingGroupId;
  label: string;
  description: string;
  /** "ETKISI" satiri: bu ayari degistirirsen ne olur. */
  impact: string;
  sensitivity: SettingSensitivity;
  restart?: boolean;
  cacheTags?: readonly string[];
  /** Edge/middleware okuyucusu de bu ayari gorur (<= 30 sn gecikme). */
  edge?: boolean;
  workflow: SettingWorkflow;
  envFallback?: string;
  unit?: string;
  min?: number;
  max?: number;
  risk: SettingRisk;
  codec: SettingCodec<T>;
  editMode: SettingEditMode;
  /** bridge/locked icin gerekce veya hedef ekran. */
  editHref?: string;
  lockedReason?: string;
  options?: readonly { value: string; label: string }[];
  /** Cok satirli metin (bakim mesaji vb.). */
  multiline?: boolean;
  /** Capraz kural: hata metni dondurur, gecerliyse null. */
  crossRule?: (value: T) => string | null;
  /**
   * Ayarin DUZENLENDIGI bolum sayfasi (konuya ait ayar ilgili sayfanin "Ayarlar" kisminda). Doluysa merkez bu ayari
   * duzenleme formu olarak DEGIL, bolume baglanti olarak gosterir: her ayar tek yerde duzenlenir.
   */
  home?: { href: string; label: string };
};

export type AnySettingDef = SettingDef<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Gecmis satiri (istemciye giden; gizli ayarda deger yok). */
export type SettingHistoryEntry = {
  id: string;
  version: number;
  oldValue: unknown;
  newValue: unknown;
  isSecret: boolean;
  fingerprint: string | null;
  summary: string | null;
  changedBy: string | null;
  actorType: string;
  reason: string | null;
  createdAt: string;
};

export type WriteSettingInput = {
  key: string;
  /** Ham deger (form metni ya da tipli); null = varsayilana don. */
  value: unknown;
  scope?: SettingScope;
  tenantId?: string;
  reason?: string;
  /** Iyimser kilit: yalniz bu surumdeyse yaz. */
  expectedVersion?: number;
};

export type WriteSettingResult =
  | { ok: true; version: number; changed: boolean; degraded?: boolean }
  | { ok: false; error: string; conflict?: boolean };

export type SettingView = {
  key: string;
  label: string;
  description: string;
  impact: string;
  category: SettingCategoryId;
  group?: OfficeSettingGroupId;
  type: SettingValueType;
  sensitivity: SettingSensitivity;
  risk: SettingRisk;
  editMode: SettingEditMode;
  editHref?: string;
  lockedReason?: string;
  unit?: string;
  min?: number;
  max?: number;
  options?: readonly { value: string; label: string }[];
  multiline?: boolean;
  /** Metin gosterimi (gizlide maskeli durum: "tanimli"/"tanimli degil"). */
  display: string;
  /** Form baslangic degeri (gizlide bos). */
  formValue: string;
  defaultDisplay: string;
  isDefault: boolean;
  /** Gizli ayar tanimli mi. */
  configured?: boolean;
  /** Plaintext (sifrelenmemis) saklanan gizli deger var mi. */
  plaintext?: boolean;
  envFallback?: string;
};