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

/** Dış gönderim son savunması: kayıt demo mu? (`is_sample === true`) */
export function isSampleRecipient(row: { is_sample?: boolean | null } | null | undefined): boolean {
  return row?.is_sample === true;
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
