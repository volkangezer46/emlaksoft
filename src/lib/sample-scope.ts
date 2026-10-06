/**
 * Demo (örnek) veri kapsamı — TEK merkez.
 *
 * Kural özeti (docs/MIMARI.md "Demo veri kuralları"):
 *  1. PUBLIC yüzeylerde (vitrin, sitemap, OG, sunum, paylaş, portallar, feed...)
 *     is_sample=true kayıt ASLA görünmez → `notSample` / `publicPropertyFilter`.
 *  2. Dış gönderimde (SMS/WhatsApp/e-posta/webhook) demo alıcıya GERÇEK
 *     gönderim yapılmaz → `isSampleRecipient` + `demo_blocked` günlüğü.
 *  3. KPI/rapor/lig/TV: demo kayıtlar YALNIZ ofiste gerçek (is_sample=false)
 *     müşteri/portföy sayısı eşiğin altındaysa dahil edilir → `includeSample`.
 *
 * Bu dosya istemciden de import edilebilsin diye sunucu modülü İÇERMEZ.
 */

/** Gerçek müşteri VE portföy sayısı bu eşiğin altındaysa demo kayıtlar KPI'a girer. */
export const SAMPLE_KPI_THRESHOLD = 5;

export type SampleCounts = {
  /** is_sample=false müşteri sayısı */
  realCustomers: number;
  /** is_sample=false portföy sayısı */
  realProperties: number;
};

/**
 * KPI/rapor/lig/TV demo kayıtları içersin mi? Ofis "gerçek kullanıma" geçtiyse
 * (gerçek müşteri VEYA portföy sayısı eşiğe ulaştıysa) demo dışlanır.
 */
export function includeSample(
  counts: SampleCounts,
  threshold: number = SAMPLE_KPI_THRESHOLD,
): boolean {
  const c = Math.max(0, Number(counts.realCustomers) || 0);
  const p = Math.max(0, Number(counts.realProperties) || 0);
  return c < threshold && p < threshold;
}

type EqBuilder = { eq: (column: string, value: boolean | string) => unknown };

/** Sorguya `is_sample = false` ekler (public yüzeylerin zorunlu süzgeci). */
export function notSample<Q>(query: Q): Q {
  return (query as unknown as EqBuilder).eq("is_sample", false) as Q;
}

/**
 * Public portföy sorgusu süzgeci: yayında (live) + silinmemiş + demo değil.
 * Public yüzeylerde `from("properties")` sorgusu bu yardımcıdan (veya en az
 * `notSample`) geçmek ZORUNDADIR — sözleşme testi kaynak taramasıyla zorlar.
 */
export function publicPropertyFilter<Q>(query: Q): Q {
  const q = (query as unknown as EqBuilder).eq("status", "live") as unknown as {
    is: (column: string, value: null) => unknown;
  };
  return notSample(q.is("deleted_at", null) as Q);
}

/** KPI sorgusu süzgeci: demo kapsam dışıysa `is_sample=false`, içindeyse dokunmaz. */
export function applySampleScope<Q>(query: Q, include: boolean): Q {
  return include ? query : notSample(query);
}

/**
 * `.in("is_sample", sampleValues(include))` — koşullu süzgeci zincire satır içi ekler:
 * include=true → [false,true] (demo dahil), false → [false] (demo dışlanır).
 */
export function sampleValues(include: boolean): boolean[] {
  return include ? [false, true] : [false];
}

/** Dış gönderim son savunması: kayıt demo mu? (`is_sample === true`) */
export function isSampleRecipient(row: { is_sample?: boolean | null } | null | undefined): boolean {
  return row?.is_sample === true;
}

/** Gönderim günlüğünde kullanılan sabit neden kodu. */
export const DEMO_BLOCKED = "demo_blocked";

type SelectClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
};

/**
 * Dış gönderim son savunması: müşteri kaydı demo (is_sample=true) mi?
 * Sorgu hatasında false döner (mevcut davranış korunur, gerçek ofis bloklanmaz).
 */
export async function isSampleCustomer(
  client: unknown,
  customerId: string | null | undefined,
): Promise<boolean> {
  if (!customerId) return false;
  const res = await (client as SelectClient)
    .from("customers")
    .select("is_sample")
    .eq("id", customerId)
    .maybeSingle();
  if (res.error) return false;
  return isSampleRecipient(res.data as { is_sample?: boolean | null } | null);
}

/** Kampanya alıcısı (campaign_recipients.customer_id) demo müşteriye mi bağlı? */
export async function isSampleCampaignRecipient(
  client: unknown,
  recipientId: string,
): Promise<boolean> {
  const res = await (client as SelectClient)
    .from("campaign_recipients")
    .select("customer_id")
    .eq("id", recipientId)
    .maybeSingle();
  if (res.error) return false;
  const customerId = (res.data as { customer_id?: string | null } | null)?.customer_id;
  return isSampleCustomer(client, customerId);
}

type CountClient = {
  from: (table: string) => {
    select: (
      cols: string,
      opts: { count: "exact"; head: true },
    ) => {
      eq: (c: string, v: boolean) => {
        is: (c: string, v: null) => PromiseLike<{ count: number | null }>;
      };
    };
  };
};

/**
 * Ofisin gerçek (is_sample=false, silinmemiş) müşteri/portföy sayısı ve
 * `includeSample` kararı. Tenant izolasyonu çağıranın client'ına (RLS) bağlıdır;
 * admin client verilirse çağıran `tenantId` ile süzmelidir — bu yüzden
 * `scopeTenantId` opsiyonel olarak sorguya eklenir.
 */
export async function getSampleScope(
  client: unknown,
  scopeTenantId?: string,
): Promise<{ include: boolean; counts: SampleCounts }> {
  const c = client as CountClient;
  const run = async (table: "customers" | "properties") => {
    let q = c.from(table).select("id", { count: "exact", head: true }) as unknown as {
      eq: (col: string, v: boolean | string) => unknown;
    };
    if (scopeTenantId) q = q.eq("tenant_id", scopeTenantId) as typeof q;
    const res = (await (q.eq("is_sample", false) as unknown as {
      is: (col: string, v: null) => PromiseLike<{ count: number | null }>;
    }).is("deleted_at", null)) as { count: number | null };
    return res.count ?? 0;
  };
  const [realCustomers, realProperties] = await Promise.all([run("customers"), run("properties")]);
  const counts = { realCustomers, realProperties };
  return { include: includeSample(counts), counts };
}

/** KPI ekranlarında örnek veri dahilken gösterilen sabit etiket (ana ekran, rapor, TV, ekip). */
export const SAMPLE_DATA_LABEL = "Örnek veri dahil";

/** Etiketin açıklaması: neden dahil, ne zaman çıkar. */
export function sampleDataHint(threshold: number = SAMPLE_KPI_THRESHOLD): string {
  return `Gerçek müşteri veya portföy sayınız ${threshold} olana kadar rakamlara örnek (demo) kayıtlar da dahildir; sonrasında otomatik dışlanır.`;
}

/**
 * SQL toplulaştırma RPC'leri (tenant_reporting_aggregates / tenant_commission_aggregates, 20261006000710) örnek veri
 * kararını kendi içinde AYNI kuralla verir ve `sample_included` döner. Etiket: örnek veri yüklü VE RPC dahil ettiyse.
 * `sample_included` yoksa (migration uygulanmadı: RPC is_sample süzmüyor) yüklü örnek veri her zaman etiketlenir.
 */
export function aggregateSampleLabel(seeded: boolean, sampleIncluded: unknown): string | null {
  if (!seeded) return null;
  return sampleIncluded === false ? null : SAMPLE_DATA_LABEL;
}

/**
 * KPI kapsamı — TEK karar noktası. Ana ekran, danışman metrikleri, pano-tv, ofis raporları
 * ve ofis skoru AYNI nesneyi kullanır; eşik/süzgeç mantığı başka yerde kopyalanmaz.
 */
export type SampleKpiScope = {
  /** Örnek kayıtlar rakamlara girer mi (eşik altı). */
  include: boolean;
  counts: SampleCounts;
  /** Ofiste örnek veri yüklenmiş mi (`tenants.sample_seeded_at`). */
  seeded: boolean;
  /** Örnek veri gerçekten rakamlara karışıyorsa gösterilecek etiket, aksi halde null. */
  label: string | null;
  /** `.in("is_sample", values)` için. */
  values: boolean[];
  /** Sorguya kapsamı uygular (include=false → is_sample=false). */
  apply: <Q>(query: Q) => Q;
};

/** Saf kurucu: sayımlar ve tohum bilgisinden kapsam üretir. */
export function buildSampleKpiScope(
  counts: SampleCounts,
  seeded: boolean,
  threshold: number = SAMPLE_KPI_THRESHOLD,
): SampleKpiScope {
  const include = includeSample(counts, threshold);
  return {
    include,
    counts,
    seeded,
    label: include && seeded ? SAMPLE_DATA_LABEL : null,
    values: sampleValues(include),
    apply: <Q>(query: Q) => applySampleScope(query, include),
  };
}

type SeedClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (c: string, v: string) => { maybeSingle: () => PromiseLike<{ data: unknown }> };
      limit: (n: number) => { maybeSingle: () => PromiseLike<{ data: unknown }> };
    };
  };
};

/**
 * Ofisin KPI kapsamını yükler: gerçek müşteri/portföy sayısı + örnek veri yüklenmiş mi.
 * `tenantId` yoksa (RLS'li oturum istemcisi) tenants satırı RLS ile tek satıra iner.
 */
export async function loadSampleKpiScope(client: unknown, tenantId?: string | null): Promise<SampleKpiScope> {
  const tid = tenantId || undefined;
  const sel = (client as SeedClient).from("tenants").select("sample_seeded_at");
  const seedQuery = tid ? sel.eq("id", tid).maybeSingle() : sel.limit(1).maybeSingle();
  const [{ counts }, seedRes] = await Promise.all([getSampleScope(client, tid), Promise.resolve(seedQuery)]);
  const seeded = Boolean((seedRes?.data as { sample_seeded_at?: string | null } | null)?.sample_seeded_at);
  return buildSampleKpiScope(counts, seeded);
}
