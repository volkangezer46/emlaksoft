/**
 * BÜYÜME KOKPİTİ sözleşmeleri (TEK kaynak; diğer paketler bu dosyayı import ETMEZ, tipleri KOPYALAR):
 *  - K1 Toplayıcı: bir alanın bulgularını `IssueInput` listesi olarak verir; `scanned` taranan URL'ler (ya da "all").
 *  - K2 Yürütücü: bir öneri türünü (`kind`) önce kuru çalıştırır (`plan`), onaydan sonra uygular (`apply`).
 *  - K3 Yayın sonrası kanca: başarılı yayından sonra `order` sırasıyla çalışır; hatası yayını etkilemez.
 * Saf tipler: ağ/DB yok. Türkçe değerler veritabanı CHECK listeleriyle birebir aynıdır (20261013003000_site_issues.sql).
 */

export type IssueArea = "seo" | "hiz" | "olcum" | "reklam" | "icerik";
export type IssueSeverity = "kritik" | "uyari" | "bilgi";
export type IssueStatus = "acik" | "onerildi" | "taslakta" | "yayinda" | "dogrulandi" | "yeniden_acildi" | "yoksayildi";
export type OptimizerSource = "staff" | "cron" | "otopilot";

export const ISSUE_AREAS: readonly IssueArea[] = ["seo", "hiz", "olcum", "reklam", "icerik"];
export const ISSUE_SEVERITIES: readonly IssueSeverity[] = ["kritik", "uyari", "bilgi"];
export const ISSUE_STATUSES: readonly IssueStatus[] = ["acik", "onerildi", "taslakta", "yayinda", "dogrulandi", "yeniden_acildi", "yoksayildi"];

/** Sınırlar (DB CHECK ile aynı). */
export const ISSUE_LIMITS = { url: 300, code: 64, title: 160, explain: 240, href: 300, reason: 240, collector: 64 } as const;

/** Bir bulgu için hazır düzeltme önerisi (yürütücü `kind` ile eşleşir). */
export type IssueProposal = {
  /** K2 yürütücü türü, ör. "seo_meta_draft:long-description". */
  kind: string;
  /** Teknik olmayan tek cümle: "/kayit açıklaması 178→155 karakter". */
  summary: string;
  before?: string | null;
  after?: string | null;
  params?: Record<string, unknown>;
};

/* ---------- K1: toplayıcı ---------- */

export type IssueInput = {
  area: IssueArea;
  /** Yol ya da mutlak adres; parmak izi için normalleştirilir. */
  url: string;
  code: string;
  severity: IssueSeverity;
  title: string;
  /** Teknik olmayan Türkçe açıklama (≤240). */
  explain: string;
  evidence?: Record<string, unknown> | null;
  proposal?: IssueProposal | null;
  /** "Düzelt" bağlantısı: ilgili yönetim ekranı. */
  href?: string | null;
  /** Otomatik düzeltme ve AI önerisi almaz (üyelik/oturum yolları, kapsam dışı). */
  manualOnly?: boolean;
};

export type CollectorResult = {
  collector: string;
  area: IssueArea;
  /** Bu koşuda taranan URL'ler; "all" = kapsamın tamamı. Kaybolan bulgu YALNIZ burada taranan URL için kapanır. */
  scanned: readonly string[] | "all";
  issues: IssueInput[];
  /** Kaynağın tarihi (ör. SEO robotunun son taraması). */
  sourceAt?: string | null;
  note?: string;
};

export type SyncMode = "audit" | "cron";

export type CollectorContext = { mode: SyncMode; signal?: AbortSignal };

export type IssueCollector = {
  id: string;
  area: IssueArea;
  label: string;
  run(ctx: CollectorContext): Promise<CollectorResult>;
};

/* ---------- Saklanan bulgu ---------- */

export type SiteIssue = {
  id: string;
  area: IssueArea;
  url: string;
  code: string;
  severity: IssueSeverity;
  title: string;
  explain: string;
  fingerprint: string;
  collector: string;
  first_seen: string;
  last_seen: string;
  status: IssueStatus;
  evidence: Record<string, unknown> | null;
  proposal: IssueProposal | null;
  href: string | null;
  manual_only: boolean;
  publish_ref: string | null;
  resolved_at: string | null;
  ignored_by: string | null;
  ignored_reason: string | null;
};

/* ---------- K2: yürütücü ---------- */

export type ExecutorRisk = "guvenli" | "orta" | "yuksek";

export type PlannedFix = {
  issueId: string;
  kind: string;
  /** Hedef yol ya da yüzey. */
  target: string;
  summary: string;
  before: string | null;
  after: string | null;
  risk: ExecutorRisk;
  params?: Record<string, unknown>;
};

export type ApplyOutcome = {
  issueId: string;
  ok: boolean;
  message: string;
  before: string | null;
  after: string | null;
  /** Taslak oluştuysa yayın masasındaki yüzey kimliği (toplu yayın için). */
  draftSurface?: string | null;
  publishRef?: string | null;
  /** Bulgunun yeni durumu (çoğunlukla "taslakta"). */
  status?: IssueStatus;
};

export type ExecutorContext = { actorId: string | null; source: OptimizerSource; reason?: string };

export type IssueExecutor = {
  kind: string;
  label: string;
  risk: ExecutorRisk;
  /** "link": yalnız ekrana götürür (plan/apply yok); "draft": taslak hazırlar; "direct": doğrudan uygular. */
  mode: "link" | "draft" | "direct";
  plan?(issue: SiteIssue): Promise<PlannedFix | null>;
  apply?(fix: PlannedFix, ctx: ExecutorContext): Promise<ApplyOutcome>;
};

/* ---------- K3: yayın sonrası kanca ---------- */

export type AfterPublishEvent = {
  /** Yayın yüzeyi: "sitecontent" | "sitemenu" | "sitepage" | "pricingpage" | ... */
  surface: string;
  kind: "publish" | "restore" | "reset";
  publishRef?: string | null;
  /** Canlıda değişen herkese açık yollar ("/", "/kayit", "/fiyatlar" ...). */
  livePaths: readonly string[];
  actorId: string | null;
  source: OptimizerSource;
  /** Yayın öncesi gövde özetleri (yol → özet); yoksa son doğrulamanın özeti kullanılır. */
  beforeDigests?: Record<string, string>;
};

export type AfterPublishHookResult = { ok: boolean; message: string; detail?: Record<string, unknown> };

export type AfterPublishHook = {
  id: string;
  order: number;
  run(ev: AfterPublishEvent): Promise<AfterPublishHookResult>;
};
