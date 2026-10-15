import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScopeFilter } from "@/lib/access-control/query-scope";
import {
  PROPERTY_REASON_LABEL,
  demandsSimilar,
  emailLookupKey,
  groupPropertyDuplicates,
  phoneLookupVariants,
  propertyCompleteness,
  propertyMatchReasons,
  scopeHit,
  type DuplicateHit,
  type PropertyMatchReason,
  type PropertyProbe,
  type PropertyScanRow,
} from "@/lib/duplicate-match";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { readAllPaged } from "@/lib/supabase/read-all-paged";

/**
 * Mükerrer arama sorguları (salt-okunur). Kullanıcı oturumlu client ile çalışır (RLS + açık tenant filtresi);
 * kapsam dışı satırlar `scopeHit` ile maskelenir. İndeks: customers(tenant_id, phone) VAR;
 * e-posta için (tenant_id, email) indeksi YOK (küçük tenant'ta sorun değil; büyürse migration önerilir).
 *
 * KAPSAM (B059): görünürlük müşteri LİSTESİYLE aynı süzgeçtir (`Viewer.scope` = getListScope().filter). Verilmezse eski
 * kural (ofis geneli rol ya da kendine atanmış). Kapsam dışı TAM telefon eşleşmesi SECURITY DEFINER
 * `lookup_customer_by_phone` ile yalnız ad + maskeli telefon + danışman adı olarak gelir ("Bu numara X danışmanının müşterisi").
 */

export type Viewer = { userId: string; officeWide: boolean; scope?: ScopeFilter };

const MAX_HITS = 3;

const EMPTY_HIT: DuplicateHit = {
  id: null, visible: true, label: null, advisor: null, lastContact: null,
  code: null, price: null, status: null, reasons: [],
};

/** Kayıt sahibi (assigned_to) bu bakana açık mı? Liste kapsamı verildiyse O, yoksa eski rol kuralı. */
export function viewerCanSee(viewer: Viewer, ownerId: string | null): boolean {
  const s = viewer.scope;
  if (!s) return viewer.officeWide || (!!ownerId && ownerId === viewer.userId);
  if (s.kind === "none") return true;
  if (s.kind === "self") return !!ownerId && ownerId === s.userId;
  return !!ownerId && s.ids.includes(ownerId);
}

/** scopeHit'e geçen biçim: kapsam kararı burada verilir (duplicate-match saf kalır). */
function scopeViewer(viewer: Viewer, ownerId: string | null): { userId: string; officeWide: boolean } {
  return { userId: viewer.userId, officeWide: viewerCanSee(viewer, ownerId) };
}

async function advisorNames(supabase: SupabaseClient, tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { data } = await supabase.from("profiles").select("id, full_name").eq("tenant_id", tenantId).in("id", ids);
  for (const p of (data ?? []) as { id: string; full_name: string | null }[]) out.set(p.id, p.full_name ?? "");
  return out;
}

/** Kapsam dışı müşteri ipucu (yalnız maskeli bilgi; kimlik/e-posta/not YOK). */
export type ForeignCustomerHint = { name: string; phoneMasked: string; advisor: string | null };

/**
 * Tam telefon eşleşmesi — kapsam dışı dahil, maskeli (SECURITY DEFINER RPC; kiracı + customers:view şartlı).
 * RPC yoksa (migration öncesi) ya da hata olursa boş liste: ipucu atlanır, akış bozulmaz.
 */
export async function lookupForeignCustomersByPhone(
  supabase: SupabaseClient,
  phone: string,
  excludeIds: readonly string[] = [],
): Promise<ForeignCustomerHint[]> {
  const variants = phoneLookupVariants(phone);
  if (variants.length === 0) return [];
  try {
    const { data, error } = await supabase.rpc("lookup_customer_by_phone", { p_phone: variants[0], p_exclude: [...excludeIds] });
    if (error || !Array.isArray(data)) return [];
    // Yalnız RPC sözleşmesine uyan satırlar (ad + maskeli telefon + danışman adı); başka biçim yok sayılır.
    return (data as Record<string, unknown>[])
      .filter((r) => r && typeof r === "object" && "phone_masked" in r && "full_name" in r)
      .map((r) => ({
        name: typeof r.full_name === "string" && r.full_name ? r.full_name : "Adsız kayıt",
        phoneMasked: typeof r.phone_masked === "string" ? r.phone_masked : "",
        advisor: typeof r.advisor_name === "string" && r.advisor_name ? r.advisor_name : null,
      }));
  } catch {
    return [];
  }
}

type CustomerRow = { id: string; full_name: string; phone: string | null; email: string | null; assigned_to: string | null; created_by: string | null };

type ContactHitRow = { kind: string; customer: CustomerRow & { deleted_at?: string | null } | Array<CustomerRow & { deleted_at?: string | null }> | null };

/**
 * Telefon/e-posta eşleşmeleri TEK turda (birincil telefon ∥ birincil e-posta ∥ ek iletişim bilgileri). Ek numaralar
 * (CRM-G7, `customer_contacts`) müşteri gömmesiyle gelir; tablo yoksa (migration öncesi) hata sessizce boş sayılır.
 */
async function customerMatches(
  supabase: SupabaseClient,
  args: { tenantId: string; variants: string[]; email: string },
  cols: string,
): Promise<{ phone: CustomerRow[]; email: CustomerRow[] }> {
  const base = () => supabase.from("customers").select(cols).eq("tenant_id", args.tenantId).is("deleted_at", null);
  const none = Promise.resolve({ data: [] as CustomerRow[] });
  const values = [...args.variants, ...(args.email ? [args.email] : [])];
  const [byPhone, byEmail, byContact] = await Promise.all([
    args.variants.length > 0 ? base().in("phone", args.variants).limit(10) : none,
    args.email ? base().eq("email", args.email).limit(10) : none,
    values.length > 0
      ? Promise.resolve(
          supabase
            .from("customer_contacts")
            .select(`kind, customer:customers!customer_contacts_customer_fkey(${cols}, deleted_at)`)
            .eq("tenant_id", args.tenantId)
            .in("value", values)
            .limit(10),
        ).catch(() => ({ data: null }))
      : Promise.resolve({ data: null }),
  ]);
  const phone = ((byPhone as { data: unknown }).data ?? []) as CustomerRow[];
  const email = ((byEmail as { data: unknown }).data ?? []) as CustomerRow[];
  for (const r of (((byContact as { data: unknown }).data ?? []) as ContactHitRow[])) {
    const c = Array.isArray(r.customer) ? r.customer[0] : r.customer;
    if (!c || c.deleted_at) continue;
    const target = r.kind === "email" ? email : phone;
    if (!target.some((x) => x.id === c.id)) target.push(c);
  }
  return { phone, email };
}

/**
 * Giriş anı mükerrer uyarısı. `detail: false` ilk (hızlı) yanıttır: tek tur (telefon ∥ e-posta ∥ kapsam dışı RPC),
 * ad + eşleşme nedeni; danışman adı ve son temas yok. `detail: true` (varsayılan) ikinci turda bunları ekler.
 */
export async function findCustomerDuplicates(
  supabase: SupabaseClient,
  args: { tenantId: string; phone: string; email: string; excludeId?: string },
  viewer: Viewer,
  opts: { detail?: boolean } = {},
): Promise<DuplicateHit[]> {
  const detail = opts.detail ?? true;
  const variants = phoneLookupVariants(args.phone);
  const email = emailLookupKey(args.email);
  if (variants.length === 0 && !email) return [];

  const [matches, foreign] = await Promise.all([
    customerMatches(supabase, { tenantId: args.tenantId, variants, email }, "id, full_name, phone, email, assigned_to, created_by"),
    variants.length > 0 ? lookupForeignCustomersByPhone(supabase, args.phone) : Promise.resolve([] as ForeignCustomerHint[]),
  ]);

  const found = new Map<string, { row: CustomerRow; reasons: Set<string> }>();
  const add = (rows: CustomerRow[], reason: string) => {
    for (const r of rows) {
      if (args.excludeId && r.id === args.excludeId) continue;
      const e = found.get(r.id) ?? { row: r, reasons: new Set<string>() };
      e.reasons.add(reason);
      found.set(r.id, e);
    }
  };
  add(matches.phone, "telefon");
  add(matches.email, "e-posta");
  const entries = [...found.values()];

  const visible = entries.filter((e) => viewerCanSee(viewer, e.row.assigned_to));
  const hiddenNonPhone = entries.filter((e) => !viewerCanSee(viewer, e.row.assigned_to) && !e.reasons.has("telefon"));
  const hiddenPhone = entries.filter((e) => !viewerCanSee(viewer, e.row.assigned_to) && e.reasons.has("telefon"));
  // Kapsam dışı telefon eşleşmesi: RPC'nin maskeli satırları. Görünen kayıtlar RPC'de de vardır: hepsi görünüyorsa maskeli
  // satır yok; karışıksa (aynı numara hem kapsamda hem dışında — nadir) görünenler hariç tutularak bir kez daha sorulur.
  // RPC yoksa (migration öncesi) RLS'in döndürdüğü kapsam dışı satırlar eskisi gibi maskelenir.
  const visiblePhoneIds = visible.filter((e) => e.reasons.has("telefon")).map((e) => e.row.id);
  const foreignRows =
    visiblePhoneIds.length === 0
      ? foreign
      : foreign.length > visiblePhoneIds.length
        ? await lookupForeignCustomersByPhone(supabase, args.phone, visiblePhoneIds)
        : [];

  const lastContact = new Map<string, string | null>();
  let advisors = new Map<string, string>();
  const visibleIds = visible.map((e) => e.row.id).slice(0, MAX_HITS);
  if (detail && visibleIds.length > 0) {
    const owners = [...new Set(visible.map((e) => e.row.assigned_to).filter((v): v is string => !!v))];
    const [names, heat] = await Promise.all([
      advisorNames(supabase, args.tenantId, owners),
      Promise.resolve(supabase.rpc("customer_heat_signals", { p_tenant_id: args.tenantId, p_customer_ids: visibleIds })).catch(() => ({ data: null })),
    ]);
    advisors = names;
    for (const s of ((heat as { data: unknown }).data ?? []) as { customer_id: string; last_contact: string | null }[]) {
      lastContact.set(s.customer_id, s.last_contact);
    }
  }

  const out: DuplicateHit[] = visible.map(({ row, reasons }) =>
    // Gizlilik: ayrıntı yalnız liste kapsamındaki kayıtta açılır (created_by yetmez).
    scopeHit(
      {
        ...EMPTY_HIT,
        id: row.id,
        label: row.full_name,
        advisor: row.assigned_to ? (advisors.get(row.assigned_to) ?? null) : null,
        lastContact: lastContact.get(row.id) ?? null,
        reasons: [...reasons],
      },
      row.assigned_to,
      scopeViewer(viewer, row.assigned_to),
    ),
  );
  if (foreignRows.length > 0) {
    for (const f of foreignRows) {
      // Kimlik yok (id=null, kayıt açılamaz); yalnız ad + danışman: "Bu numara X danışmanının müşterisi".
      out.push({ ...EMPTY_HIT, visible: false, label: f.name, advisor: f.advisor, reasons: ["telefon"] });
    }
  } else {
    for (const e of hiddenPhone) out.push(scopeHit({ ...EMPTY_HIT, reasons: [...e.reasons] }, e.row.assigned_to, scopeViewer(viewer, e.row.assigned_to)));
  }
  for (const e of hiddenNonPhone) out.push(scopeHit({ ...EMPTY_HIT, reasons: [...e.reasons] }, e.row.assigned_to, scopeViewer(viewer, e.row.assigned_to)));
  return out.slice(0, MAX_HITS);
}

export type DuplicateGate = { duplicate: false } | { duplicate: true; count: number };

/**
 * TEK sunucu mükerrer kapısı (B092): aynı telefon ya da e-posta ofiste (kapsam dışı dahil) kayıtlıysa, kasıtlı onay
 * (`allow_duplicate=1`) olmadan yeni müşteri açılmaz. Tek tur (telefon ∥ e-posta ∥ maskeli RPC). Kapı sorgusu hata
 * verirse kayıt ENGELLENMEZ (fail-open; kayıt kaybı mükerrerden daha kötü), hata günlüğe düşer.
 */
export async function assertCustomerNotDuplicate(
  supabase: SupabaseClient,
  ctx: { tenantId: string },
  input: { phone: string; email: string },
  allowDuplicate: boolean,
): Promise<DuplicateGate> {
  if (allowDuplicate) return { duplicate: false };
  const variants = phoneLookupVariants(input.phone);
  const email = emailLookupKey(input.email);
  if (variants.length === 0 && !email) return { duplicate: false };
  try {
    const [matches, foreign] = await Promise.all([
      customerMatches(supabase, { tenantId: ctx.tenantId, variants, email }, "id"),
      variants.length > 0 ? lookupForeignCustomersByPhone(supabase, input.phone) : Promise.resolve([] as ForeignCustomerHint[]),
    ]);
    const ids = new Set([...matches.phone, ...matches.email].map((r) => r.id));
    const count = Math.max(ids.size, foreign.length);
    return count > 0 ? { duplicate: true, count } : { duplicate: false };
  } catch (e) {
    console.error("assertCustomerNotDuplicate", e instanceof Error ? e.message : "bilinmeyen hata");
    return { duplicate: false };
  }
}

/** Mükerrer reddinin kullanıcı metni (form "Yine de yeni kayıt" / hızlı kayıt "Yine de kaydet" ile onaylanır). */
export const CUSTOMER_DUPLICATE_ERROR =
  "Bu telefon/e-posta ile ofiste kayıt var. Mevcut kaydı kontrol edin; farklı kişiyse onaylayıp yine de yeni kayıt açın.";

type PropertyRow = {
  id: string; property_code: string; title: string | null; address_line: string | null;
  parcel_block: string | null; parcel_lot: string | null; property_type: string | null;
  transaction_type: string | null; district_id: string | null; neighborhood_id: string | null;
  list_price: number | null; status: string | null; assigned_to: string | null;
};

export async function findPropertyDuplicates(
  supabase: SupabaseClient,
  args: { tenantId: string; probe: PropertyProbe },
  viewer: Viewer,
): Promise<DuplicateHit[]> {
  const { probe } = args;
  // Konum bağlamı yoksa (mahalle/ilçe seçilmemiş) eşleşme güvenilmez; sorgu boşa gitmesin.
  if (!probe.neighborhoodId && !probe.districtId) return [];
  let q = supabase
    .from("properties")
    .select(
      "id, property_code, title, address_line, parcel_block, parcel_lot, property_type, transaction_type, district_id, neighborhood_id, list_price, status, assigned_to",
    )
    .eq("tenant_id", args.tenantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  q = probe.neighborhoodId ? q.eq("neighborhood_id", probe.neighborhoodId) : q.eq("district_id", probe.districtId);
  const { data } = await q;

  const hits: { row: PropertyRow; reasons: string[] }[] = [];
  for (const row of (data ?? []) as PropertyRow[]) {
    const reasons = propertyMatchReasons(probe, row).map((r) => PROPERTY_REASON_LABEL[r]);
    if (reasons.length > 0) hits.push({ row, reasons });
    if (hits.length >= MAX_HITS) break;
  }
  const advisors = await advisorNames(
    supabase,
    args.tenantId,
    [...new Set(hits.map((h) => h.row.assigned_to).filter((v): v is string => !!v))],
  );
  return hits.map(({ row, reasons }) =>
    scopeHit(
      {
        ...EMPTY_HIT,
        id: row.id,
        label: row.title,
        advisor: row.assigned_to ? (advisors.get(row.assigned_to) ?? null) : null,
        code: row.property_code,
        price: row.list_price != null ? Number(row.list_price) : null,
        status: row.status,
        reasons,
      },
      row.assigned_to,
      viewer,
    ),
  );
}

export async function findSimilarOpenDemands(
  supabase: SupabaseClient,
  args: { tenantId: string; customerId: string; transactionType: string; propertyType: string; districtId: string },
  viewer: Viewer,
): Promise<DuplicateHit[]> {
  if (!args.customerId || !args.transactionType) return [];
  const { data: cust } = await supabase
    .from("customers")
    .select("assigned_to, created_by")
    .eq("id", args.customerId)
    .eq("tenant_id", args.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!cust) return [];
  const { data } = await supabase
    .from("customer_demands")
    .select("id, transaction_type, property_type, district_id, status, created_at")
    .eq("tenant_id", args.tenantId)
    .eq("customer_id", args.customerId)
    // Bilinçli: yinelenen-talep denetimi yalnız "active" talebe bakar (yeni/eşleşmiş talep çift sayılmaz);
    // OPEN_DEMAND_STATUSES'ten dar olması kasıtlı.
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(20);
  const owner = cust.assigned_to as string | null;
  const rows = ((data ?? []) as { id: string; transaction_type: string | null; property_type: string | null; district_id: string | null }[]).filter(
    (r) => demandsSimilar(args, r),
  );
  return rows.slice(0, MAX_HITS).map((r) =>
    scopeHit(
      {
        ...EMPTY_HIT,
        id: r.id,
        label: [r.transaction_type, r.property_type].filter(Boolean).join(" · ") || "Açık talep",
        reasons: ["açık talep"],
      },
      owner,
      viewer,
    ),
  );
}

// ── Portföy çift kayıt taraması + veri sağlığı (salt-okunur; oturumlu client, RLS + açık tenant filtresi) ────────────

/** Taramaya giren en fazla portföy (en yeniler). Üstündeyse sayfa "son N kayıt tarandı" der. */
export const PROPERTY_SCAN_LIMIT = 3000;

export type PropertyDupRecord = {
  id: string;
  code: string;
  title: string | null;
  address: string | null;
  price: number | null;
  currency: string | null;
  transaction: string | null;
  status: string | null;
  advisor: string | null;
  createdAt: string;
  mediaCount: number;
  hasLocation: boolean;
  completeness: number;
};

export type PropertyDupGroup = { key: string; reasons: PropertyMatchReason[]; records: PropertyDupRecord[] };

type PropertyScanDbRow = PropertyScanRow & {
  property_code: string;
  list_price: number | null;
  currency: string | null;
  status: string | null;
  assigned_to: string | null;
  lat: number | null;
};

/**
 * Ofisteki olası çift portföyleri bulur (aynı ada/parsel, benzer adres, benzer başlık + mahalle; aynı işlem türü).
 * Tek tur portföy okuması + yalnız gruplardaki kayıtlar için danışman adı ve medya sayısı (paralel).
 */
export async function scanPropertyDuplicates(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ groups: PropertyDupGroup[]; scanned: number; truncated: boolean } | { error: string }> {
  // PostgREST sayfa sınırı (max_rows) yüzünden tek .limit() sessizce kesilir: sayfalı oku, üst sınır açık.
  const read = await readAllPaged<PropertyScanDbRow>(
    (from, to) =>
      supabase
        .from("properties")
        .select(
          "id, property_code, title, address_line, parcel_block, parcel_lot, property_type, transaction_type, district_id, neighborhood_id, list_price, currency, status, assigned_to, lat, created_at",
        )
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: PropertyScanDbRow[] | null; error: { message: string } | null }>,
    { maxRows: PROPERTY_SCAN_LIMIT },
  );
  if (read.error) {
    console.error("scanPropertyDuplicates", read.error);
    return { error: "Portföy taraması çalıştırılamadı." };
  }
  const rows = read.rows;
  const raw = groupPropertyDuplicates(rows);
  const ids = [...new Set(raw.flatMap((g) => g.ids))];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const owners = [...new Set(ids.map((id) => byId.get(id)?.assigned_to).filter((v): v is string => !!v))];
  const [names, media] = await Promise.all([
    advisorNames(supabase, tenantId, owners),
    ids.length > 0
      ? readAllPaged<{ property_id: string }>(
          (from, to) =>
            supabase
              .from("property_media")
              .select("property_id")
              .eq("tenant_id", tenantId)
              .in("property_id", ids)
              .order("id", { ascending: true })
              .range(from, to) as unknown as PromiseLike<{ data: { property_id: string }[] | null; error: { message: string } | null }>,
          { maxRows: 5000 },
        )
      : Promise.resolve({ rows: [] as { property_id: string }[] }),
  ]);
  const mediaCount = new Map<string, number>();
  for (const m of media.rows) {
    mediaCount.set(m.property_id, (mediaCount.get(m.property_id) ?? 0) + 1);
  }
  const groups: PropertyDupGroup[] = raw.map((g) => ({
    key: [...g.ids].sort().join(","),
    reasons: g.reasons,
    records: g.ids
      .map((id) => byId.get(id))
      .filter((r): r is PropertyScanDbRow => !!r)
      .map((r) => {
        const count = mediaCount.get(r.id) ?? 0;
        return {
          id: r.id,
          code: r.property_code,
          title: r.title,
          address: r.address_line,
          price: r.list_price != null ? Number(r.list_price) : null,
          currency: r.currency,
          transaction: r.transaction_type,
          status: r.status,
          advisor: r.assigned_to ? (names.get(r.assigned_to) ?? null) : null,
          createdAt: r.created_at,
          mediaCount: count,
          hasLocation: r.lat != null,
          completeness: propertyCompleteness({ ...r, media_count: count }),
        };
      }),
  }));
  return { groups, scanned: rows.length, truncated: read.truncated };
}

/** Veri sağlığı kalemi: sayı + en fazla 5 örnek kayıt (doğrudan kayda gider). */
export type DataHealthItem = {
  key: string;
  label: string;
  desc: string;
  count: number;
  /** Sayı tarama sınırına takıldıysa "en az" anlamındadır. */
  capped: boolean;
  samples: Array<{ id: string; label: string; detail: string | null; href: string }>;
};

const HEALTH_SAMPLE = 5;
/** Geçersiz telefon taraması en çok bu kadar kaydı okur (telefon biçimi SQL'de değil, ortak `parsePhone` ile denetlenir). */
export const PHONE_HEALTH_SCAN = 3000;

/** Müşteri veri sağlığı: telefonsuz kayıtlar ve geçersiz biçimli telefonlar. */
export async function loadCustomerDataHealth(supabase: SupabaseClient, tenantId: string): Promise<DataHealthItem[]> {
  const [noPhone, withPhone] = await Promise.all([
    supabase
      .from("customers")
      .select("id, full_name, email", { count: "exact" })
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .or("phone.is.null,phone.eq.")
      .order("created_at", { ascending: false })
      .limit(HEALTH_SAMPLE),
    readAllPaged<{ id: string; full_name: string | null; phone: string }>(
      (from, to) =>
        supabase
          .from("customers")
          .select("id, full_name, phone")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .not("phone", "is", null)
          .neq("phone", "")
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: { id: string; full_name: string | null; phone: string }[] | null; error: { message: string } | null }>,
      { maxRows: PHONE_HEALTH_SCAN },
    ),
  ]);
  const noPhoneRows = (noPhone.data ?? []) as { id: string; full_name: string | null; email: string | null }[];
  const phoneRows = withPhone.rows;
  // Kayıtla AYNI kural (sunucu kapısı parsePhoneStrict): ülke biçimine uymayan numara "geçersiz".
  const invalid = phoneRows.filter((r) => !parsePhoneStrict(r.phone).ok);
  return [
    {
      key: "telefonsuz",
      label: "Telefonu olmayan müşteri",
      desc: "Aranamaz, WhatsApp ve SMS gönderilemez; çift kayıt taraması da bu kayıtları telefonla eşleyemez.",
      count: noPhone.count ?? noPhoneRows.length,
      capped: false,
      samples: noPhoneRows.map((r) => ({ id: r.id, label: r.full_name || "Adsız kayıt", detail: r.email, href: `/app/musteriler/${r.id}` })),
    },
    {
      key: "gecersiz-telefon",
      label: "Geçersiz telefon biçimi",
      desc: "Numara eksik ya da hatalı yazılmış; arama ve mesaj gönderimi başarısız olur. Kaydı açıp numarayı düzeltin.",
      count: invalid.length,
      capped: withPhone.truncated,
      samples: invalid
        .slice(0, HEALTH_SAMPLE)
        .map((r) => ({ id: r.id, label: r.full_name || "Adsız kayıt", detail: r.phone, href: `/app/musteriler/${r.id}` })),
    },
  ];
}

/** Portföy veri sağlığı: konumu (harita noktası) ve mahallesi olmayan ilanlar. */
export async function loadPropertyDataHealth(supabase: SupabaseClient, tenantId: string): Promise<DataHealthItem[]> {
  const q = () =>
    supabase
      .from("properties")
      .select("id, property_code, title", { count: "exact" })
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(HEALTH_SAMPLE);
  const [noLatLng, noHood] = await Promise.all([q().is("lat", null), q().is("neighborhood_id", null)]);
  type P = { id: string; property_code: string; title: string | null };
  const sample = (rows: unknown) =>
    ((rows ?? []) as P[]).map((r) => ({
      id: r.id,
      label: r.title || "Başlıksız ilan",
      detail: r.property_code,
      href: `/app/portfoyler/${r.id}`,
    }));
  return [
    {
      key: "konumsuz",
      label: "Harita konumu olmayan ilan",
      desc: "Haritada ve yakındaki ilan eşleşmelerinde görünmez; vitrinde konum gösterilemez.",
      count: noLatLng.count ?? 0,
      capped: false,
      samples: sample(noLatLng.data),
    },
    {
      key: "mahallesiz",
      label: "Mahallesi seçilmemiş ilan",
      desc: "Talep eşleştirme, emsal değerleme ve çift kayıt taraması mahalleye göre çalışır.",
      count: noHood.count ?? 0,
      capped: false,
      samples: sample(noHood.data),
    },
  ];
}
