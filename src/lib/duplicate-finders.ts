import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScopeFilter } from "@/lib/access-control/query-scope";
import {
  PROPERTY_REASON_LABEL,
  demandsSimilar,
  emailLookupKey,
  phoneLookupVariants,
  propertyMatchReasons,
  scopeHit,
  type DuplicateHit,
  type PropertyProbe,
} from "@/lib/duplicate-match";

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

/** Telefon/e-posta eşleşmeleri TEK turda (telefon ∥ e-posta). */
async function customerMatches(
  supabase: SupabaseClient,
  args: { tenantId: string; variants: string[]; email: string },
  cols: string,
): Promise<{ phone: CustomerRow[]; email: CustomerRow[] }> {
  const base = () => supabase.from("customers").select(cols).eq("tenant_id", args.tenantId).is("deleted_at", null);
  const none = Promise.resolve({ data: [] as CustomerRow[] });
  const [byPhone, byEmail] = await Promise.all([
    args.variants.length > 0 ? base().in("phone", args.variants).limit(10) : none,
    args.email ? base().eq("email", args.email).limit(10) : none,
  ]);
  return {
    phone: ((byPhone as { data: unknown }).data ?? []) as CustomerRow[],
    email: ((byEmail as { data: unknown }).data ?? []) as CustomerRow[],
  };
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
