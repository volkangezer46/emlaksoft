/**
 * Büyüme Kokpiti sözleşme tiplerinin SEO KOPYASI (K1 toplayıcı, K2 düzeltici, K3 yayın sonrası kanca).
 * Asıl tanım SP1'in `src/lib/site-issues/types.ts` dosyasındadır; paketler birbirini İÇE AKTARMAZ, tipler kopyalanır
 * (yapısal tipler: aynı biçim = uyumlu). Kayıt ve biçim çevirisi `src/lib/site-issues/adapters.ts`'tedir.
 * Burada alan eklenirse SP1 kopyasıyla birlikte güncellenmelidir.
 */

export type IssueArea = "seo" | "hiz" | "olcum" | "reklam" | "icerik";
export type IssueSeverity = "kritik" | "uyari" | "bilgi";
export type FixRisk = "guvenli" | "dikkat" | "riskli";

/** Bulguya bağlı öneri: önce/sonra değeri ve (varsa) uygulanabilir eylem. `action` yoksa yalnız elle düzeltilir. */
export type IssueProposal = {
  /** Öneriyi üreten kural (ör. "long-description", "missing-og-title", "redirect_404", "ai"). */
  rule: string;
  /** Türkçe tek cümle özet ("/kayit açıklaması 178→155 karakter"). */
  summary: string;
  field?: string;
  before?: string | null;
  after?: string | null;
  /** K2 eylemi; manualOnly bulgularda HİÇ verilmez. */
  action?: { kind: string; risk: FixRisk };
};

/** K1 — bir bulgu (site_issues satırının girdisi). */
export type IssueInput = {
  area: IssueArea;
  url: string;
  code: string;
  severity: IssueSeverity;
  /** ≤160 karakter. */
  title: string;
  /** Teknik olmayan Türkçe tek cümle, ≤240 karakter. */
  explain: string;
  /** İlgili düzeltme ekranı (ör. /admin/seo?sekme=sayfalar&sayfa=/kayit). */
  href: string;
  /** true: otomatik eylem (taslak/AI) ALMAZ; yalnız ekrana yönlendirilir. */
  manualOnly: boolean;
  evidence?: Record<string, unknown>;
  proposal?: IssueProposal | null;
};

/** K1 — toplayıcı sonucu. `scanned`: o koşuda taranan adresler; yalnız bunların kaybolan bulgusu "doğrulandı" olur. */
export type CollectorResult = {
  area: IssueArea;
  at: string;
  scanned: string[] | "all";
  issues: IssueInput[];
  note?: string;
};

export type CollectorMode = "read" | "audit";

export type IssueCollector = {
  id: string;
  area: IssueArea;
  label: string;
  collect(mode: CollectorMode): Promise<CollectorResult>;
};

/** K2 — eylem hedefi (kuyruktaki bulgu). */
export type FixTarget = Pick<IssueInput, "url" | "code" | "manualOnly"> & { proposal?: IssueProposal | null; evidence?: Record<string, unknown> };

export type FixPlan = {
  kind: string;
  risk: FixRisk;
  target: string;
  summary: string;
  before: string | null;
  after: string | null;
};

export type FixContext = { actorId: string | null; source: "staff" | "cron" | "otopilot" };

export type FixResult = { ok: true; message: string; before: string | null; after: string | null; publishRef?: string } | { ok: false; error: string };

export type FixExecutor = {
  kind: string;
  label: string;
  /** Bu bulgu için risk (Otopilot yalnız "guvenli" olanları uygular). */
  risk(target: FixTarget): FixRisk;
  canHandle(target: FixTarget): boolean;
  /** Kuru çalışma: hiçbir şey yazmaz. Uygulanamıyorsa null. */
  plan(target: FixTarget): Promise<FixPlan | null>;
  apply(target: FixTarget, ctx: FixContext): Promise<FixResult>;
};

/** K3 — yayın sonrası olay. */
export type AfterPublishEvent = {
  surfaceId: string;
  /** Yayından etkilenen public yollar ("/fiyatlar"). */
  livePaths: readonly string[];
  actorId: string | null;
  source: "staff" | "cron" | "otopilot";
  at: string;
};

export type AfterPublishHookResult = { ok: boolean; message: string };

export type AfterPublishHook = {
  id: string;
  /** Küçük önce çalışır (statik 10, doğrulama 20, SEO 30). */
  order: number;
  run(ev: AfterPublishEvent): Promise<AfterPublishHookResult>;
};
