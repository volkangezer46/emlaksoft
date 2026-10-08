/**
 * Rapor merkezi — ortak tipler. SAF modül (sunucu/istemci bağımlılığı yok): rapor tanımı kayıt defteri,
 * biçim yazıcıları ve arayüz aynı tiplerden beslenir.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppModule } from "@/lib/permissions";
import type { PlatformModule } from "@/lib/platform-access";
import type { EffectivePermissions } from "@/lib/permissions-effective";
import type { SampleKpiScope } from "@/lib/sample-scope";
import type { CustomFieldEntity } from "@/lib/custom-fields/core";

export type ReportScope = "tenant" | "platform";

/**
 * Gevşek sorgu tipi: rapor tanımları 200+ sütunluk dinamik `select` dizeleri yazar; Supabase'in derin generik
 * çıkarımı (TS2589) ve tsc süresi yerine sorgu kurucusu burada bilinçli olarak gevşek tiplenir.
 * Güvenlik zinciri tipe değil kurala dayanır: `report-scope-contract.test.ts` her sorguyu çalıştırıp kiracı ve aktör
 * kapsamını doğrular.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LooseQuery = any;
export type ReportDb = { from: (table: string) => LooseQuery } & SupabaseClient;

/** Hücre değeri. Tarih/zaman ISO metni, para/sayı `number`; biçimleme yazıcıya aittir. */
export type CellValue = string | number | boolean | null | undefined;

export type ColumnType = "text" | "date" | "datetime" | "money" | "number" | "percent" | "bool";

export type ReportColumn<R = Row> = {
  key: string;
  /** Türkçe sütun başlığı (dosyada ve önizlemede görünür). */
  label: string;
  type: ColumnType;
  /** Yaklaşık genişlik (karakter). Verilmezse türden çıkarılır. */
  width?: number;
  /** Ondalık hane (number/money/percent). */
  decimals?: number;
  /** Alt toplam satırı: sütun toplanır (yalnız money/number). */
  total?: boolean;
  get: (row: R, ctx: ReportContext) => CellValue;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export type SelectOption = { value: string; label: string };

/** Filtre alanı bildirimi. Tüm değerler URL'de metin olarak taşınır. */
export type FilterField =
  | { kind: "date"; key: string; label: string }
  | { kind: "select"; key: string; label: string; options: readonly SelectOption[] }
  | { kind: "text"; key: string; label: string; placeholder?: string }
  /** Ofis kullanıcısı (danışman) seçimi; seçenekler çalışma anında ofisin profillerinden gelir. */
  | { kind: "advisor"; key: string; label: string }
  /** Kampanya seçimi (ofisin son kampanyaları). */
  | { kind: "campaign"; key: string; label: string };

export type Filters = Record<string, string | undefined>;

export type PagedQuery = {
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null; count?: number | null }>;
};

export type ReportSource<R = Row> =
  | {
      kind: "query";
      /**
       * Sayfalanabilir PostgREST sorgusu (select(..., { count: "exact" }) ile): kiracı sınırı, aktör kapsamı ve
       * filtreler BURADA uygulanır; deterministik sıra (`order(...).order("id")`) zorunludur.
       */
      build: (ctx: ReportContext, filters: Filters) => PagedQuery;
      /** Her sayfadan sonra çağrılır: ad çözümü gibi ek okumalar (`ctx.names`). */
      enrich?: (rows: R[], ctx: ReportContext) => Promise<void>;
    }
  | {
      kind: "compute";
      /** Bellekte hesaplanan özet raporlar (toplulaştırma). Satır tavanı çağıran tarafından uygulanır. */
      run: (ctx: ReportContext, filters: Filters) => Promise<R[]>;
    };

export type ReportCategory = {
  id: string;
  label: string;
  description: string;
};

export type ReportDef<R = Row> = {
  /** URL parçası ve denetim anahtarı (kebab-case, kararlı). */
  id: string;
  title: string;
  description: string;
  category: string;
  scope: ReportScope;
  /** Tenant raporları için gerekli modül (`requirePermission(module, "view")`). */
  module?: AppModule;
  /** Platform raporları için gerekli departman modülü. */
  platformModule?: PlatformModule;
  /** Yalnız ofis geneli veri kapsamı olan roller (ofis sahibi, GM, muhasebe, şube müdürü...). */
  officeWideOnly?: boolean;
  /** Yalnız bu roller (ör. ofis sahibi ve genel müdür). */
  rolesOnly?: readonly string[];
  /** Kazanç gizliliği: `earnings_all` izni yoksa rapor yalnız kendi kayıtlarını içerir (kapsam kuralı sorgudadır). */
  earnings?: boolean;
  /** Ofisin toplam kazancını gösterir: yalnız `earnings_all` sahibine açılır (kâr/zarar gibi). */
  earningsAllOnly?: boolean;
  /** Arama için ek sözcükler. */
  keywords?: readonly string[];
  filters: readonly FilterField[];
  columns: readonly ReportColumn<R>[];
  source: ReportSource<R>;
  /** Ofisin tanımladığı özel alanlar (`Özel: <etiket>` sütunları) bu varlık için eklenir; sorgu `id` seçmelidir. */
  customFields?: CustomFieldEntity;
  /** Kişisel veri (ad, telefon, e-posta...) içerir: dosya üstbilgisine KVKK notu eklenir. */
  personalData?: boolean;
};

export type ReportContext = {
  scope: ReportScope;
  /** Tenant: RLS'li kullanıcı istemcisi. Platform: servis istemcisi (yalnız platform raporları). */
  supabase: ReportDb;
  tenantId: string | null;
  userId: string;
  role: string;
  /** Ofis geneli veri kapsamı (`hasOfficeWideDataScope`). */
  officeWide: boolean;
  /** `earnings_all` izni (başkasının kazancını görme). */
  seeAllEarnings: boolean;
  /** Etkin izinler (KPI yükleyicileri için). Platform bağlamında boş. */
  perms: EffectivePermissions;
  /** Ofis bayrağıyla çözümlenmiş liste kapsamı (yalnız tenant). */
  listScope: { kind: "none" } | { kind: "self"; userId: string } | { kind: "members"; ids: string[] };
  officeName: string;
  /** Örnek (demo) veri kapsamı: `is_sample` taşıyan tablolarda uygulanır (tek karar noktası: lib/sample-scope). */
  sample: SampleKpiScope;
  /** Kimlik → görünen ad (profil, ofis, personel). `enrich` ve sütunlar kullanır. */
  names: Map<string, string>;
  /** Önbellekli yardımcı tablolar (ör. aşama adları) — rapora özel. */
  memo: Map<string, unknown>;
};

export type ReportMeta = {
  title: string;
  officeName: string;
  filterSummary: { label: string; value: string }[];
  /** Türkiye saatiyle `dd.MM.yyyy HH:mm`. */
  generatedAt: string;
  generatedBy?: string;
  rowCount: number;
  truncated: boolean;
  personalData: boolean;
  /** Platform raporu mu (üst bilgi başlığı "EmlakSoft Platform"). */
  platform: boolean;
};

export type ReportTable = {
  columns: readonly Pick<ReportColumn, "key" | "label" | "type" | "width" | "decimals" | "total">[];
  /** Hücre sırası `columns` ile aynıdır. */
  rows: CellValue[][];
};

export type ReportFormat = "xlsx" | "pdf" | "csv";

export const REPORT_FORMATS: readonly ReportFormat[] = ["xlsx", "pdf", "csv"];
export const REPORT_FORMAT_LABELS: Record<ReportFormat, string> = { xlsx: "Excel (.xlsx)", pdf: "PDF", csv: "CSV" };

/** Biçim başına satır tavanı (güvenlik + dosya boyutu). Aşılırsa dosyada ve arayüzde uyarı gösterilir. */
export const REPORT_ROW_LIMITS: Record<ReportFormat, number> = { xlsx: 100_000, pdf: 3_000, csv: 200_000 };
/** Önizleme satır sayısı. */
export const REPORT_PREVIEW_ROWS = 50;
/** Tek indirmenin en fazla süresi (route maxDuration = 60 sn'nin altında). */
export const REPORT_MAX_MS = 45_000;
