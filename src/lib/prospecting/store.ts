import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS, now } from "@/lib/clock";
import { actionErrorMessage } from "@/lib/action-errors";
import { MANAGER_ROLES } from "@/lib/team/assignable-roles";
import { conflictNotices, ownershipVerdict, type ConflictNotice, type OwnershipVerdict } from "./conflict";
import { initialNextActionMs } from "./cadence";
import { phoneHash } from "./phone-hash";
import { evaluatePriceChange } from "./price";
import { suggestRelist, type RelistSuggestion } from "./relist";
import type { FsboSaveInput } from "./schema";
import { CLAIM_IDLE_DAYS } from "./thresholds";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any, any, any>;
export type SaveCtx = { db: Db; tenantId: string; userId: string; role: string };

export type SaveResult =
  | {
      ok: true;
      id: string;
      /** false: ilan zaten kayıtlıydı (yeni fiyat gözlemi eklendi ya da başkasının kaydı). */
      created: boolean;
      ownership: OwnershipVerdict;
      notices: ConflictNotice[];
      priceDropPct: number | null;
      relist: RelistSuggestion | null;
      doNotCall: boolean;
    }
  | { ok: false; error: string };

type ExistingRow = {
  id: string;
  assigned_to: string | null;
  price: number | string | null;
  phone: string | null;
  price_drop_count: number | null;
  last_activity_at: string;
  claim_expires_at: string | null;
  assignee: { full_name: string | null } | { full_name: string | null }[] | null;
};

const EXISTING_SELECT =
  "id, assigned_to, price, phone, price_drop_count, last_activity_at, claim_expires_at, assignee:profiles!fsbo_leads_assigned_to_fkey(full_name)";

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/**
 * Sahibinden ilan kaydı (elle ekleme + eklenti API'si ortak çekirdeği; idempotent).
 * - Aynı ilan (portal + ilan no, yoksa bağlantı) ofiste varsa: yeni FİYAT GÖZLEMİ olarak işlenir; başkası ilgileniyorsa
 *   ikinci danışman sahiplenemez (yönetici ya da hareketsizlikten düşen sahiplik hariç).
 * - Yeni kayıtta çakışmalar bakılır: aranmasın listesi, mevcut müşteri (telefon), ofisin kendi portföyü, tekrar ilan.
 * Çağıran `requirePermission("prospecting", "create")` ile yetkiyi doğrulamış olmalıdır. Telefon `fsboSaveSchema`
 * (parsePhoneStrict) ile doğrulanmış saklama biçimindedir.
 */
export async function saveFsboLead(ctx: SaveCtx, input: FsboSaveInput): Promise<SaveResult> {
  const { db, tenantId, userId, role } = ctx;
  const nowMs = now();
  const nowIso = new Date(nowMs).toISOString();
  const isManager = (MANAGER_ROLES as readonly string[]).includes(role);
  const hash = input.phone ? phoneHash(tenantId, input.phone) : null;

  // 1) Aynı ilan ofiste kayıtlı mı?
  let existing: ExistingRow | null = null;
  if (input.externalId || input.url) {
    let q = db.from("fsbo_leads").select(EXISTING_SELECT).eq("tenant_id", tenantId).is("deleted_at", null);
    q = input.externalId ? q.eq("portal", input.portal).eq("external_id", input.externalId) : q.eq("url", input.url as string);
    const { data, error } = await q.limit(1).maybeSingle();
    if (error) return { ok: false, error: actionErrorMessage(error, "Kayıt kontrol edilemedi. Lütfen tekrar deneyin.") };
    existing = (data as ExistingRow | null) ?? null;
  }

  if (existing) {
    const verdict = ownershipVerdict(
      {
        assignedTo: existing.assigned_to,
        assignedName: one(existing.assignee)?.full_name ?? null,
        lastActivityMs: Date.parse(existing.last_activity_at),
        claimExpiresMs: existing.claim_expires_at ? Date.parse(existing.claim_expires_at) : null,
      },
      userId,
      nowMs,
      { canOverride: isManager },
    );
    if (verdict.kind === "other") {
      return { ok: true, id: existing.id, created: false, ownership: verdict, notices: [], priceDropPct: null, relist: null, doNotCall: false };
    }
    const prevPrice = existing.price == null ? null : Number(existing.price);
    const change = evaluatePriceChange(prevPrice, input.price);
    const patch: Record<string, unknown> = {
      last_seen_at: nowIso,
      last_activity_at: nowIso,
      listing_status: "active",
      claim_expires_at: new Date(nowMs + CLAIM_IDLE_DAYS * DAY_MS).toISOString(),
    };
    if (verdict.kind === "free") patch.assigned_to = userId;
    if (input.price != null) patch.price = input.price;
    if (input.title) patch.title = input.title;
    if (!existing.phone && input.phone) {
      patch.phone = input.phone;
      patch.phone_hash = hash;
    }
    if (change.dropped) {
      patch.price_drop_count = Number(existing.price_drop_count ?? 0) + 1;
      patch.last_price_drop_pct = change.dropPct;
      patch.last_price_drop_at = nowIso;
    }
    const upd = await db.from("fsbo_leads").update(patch).eq("tenant_id", tenantId).eq("id", existing.id);
    if (upd.error) return { ok: false, error: actionErrorMessage(upd.error, "Kayıt güncellenemedi. Lütfen tekrar deneyin.") };
    await db.from("fsbo_lead_observations").insert({
      tenant_id: tenantId,
      lead_id: existing.id,
      observed_at: nowIso,
      price: input.price,
      listing_status: "active",
      source: input.source === "extension" ? "extension" : "manual",
      observed_by: userId,
    });
    return { ok: true, id: existing.id, created: false, ownership: { kind: "mine" }, notices: [], priceDropPct: change.dropPct, relist: null, doNotCall: false };
  }

  // 2) Yeni kayıt: çakışma olgularını tek turda topla.
  const [dncRes, customerRes, listingRes, relistRes, profileRes] = await Promise.all([
    hash ? db.from("fsbo_do_not_call").select("id").eq("tenant_id", tenantId).eq("phone_hash", hash).limit(1) : Promise.resolve({ data: [], error: null }),
    input.phone
      ? db.from("customers").select("id, full_name, customer_types").eq("tenant_id", tenantId).eq("phone", input.phone).limit(1)
      : Promise.resolve({ data: [], error: null }),
    input.externalId
      ? db.from("portal_listings").select("property_id").eq("tenant_id", tenantId).ilike("portal_name", input.portal).eq("portal_listing_id", input.externalId).limit(1)
      : Promise.resolve({ data: [], error: null }),
    db
      .from("fsbo_leads")
      .select("id, phone_hash, district_id, rooms, gross_m2, price, title")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .or("lost_reason.eq.ilan_kalkti,listing_status.eq.removed")
      .limit(100),
    db.from("profiles").select("branch_id").eq("id", userId).maybeSingle(),
  ]);

  const doNotCall = ((dncRes.data as unknown[] | null) ?? []).length > 0;
  const cust = ((customerRes.data as { id: string; full_name: string; customer_types: string[] | null }[] | null) ?? [])[0] ?? null;
  const own = ((listingRes.data as { property_id: string }[] | null) ?? [])[0] ?? null;
  const candidates = ((relistRes.data as { id: string; phone_hash: string | null; district_id: string | null; rooms: string | null; gross_m2: number | string | null; price: number | string | null; title: string | null }[] | null) ?? []).map((c) => ({
    id: c.id,
    phoneHash: c.phone_hash,
    districtId: c.district_id,
    rooms: c.rooms,
    sqm: c.gross_m2 == null ? null : Number(c.gross_m2),
    price: c.price == null ? null : Number(c.price),
    title: c.title,
  }));
  const relist = suggestRelist(
    { id: "new", phoneHash: hash, districtId: input.districtId, rooms: input.rooms, sqm: input.grossM2, price: input.price, title: input.title },
    candidates,
  );

  // Atama: yöneticiler başkasına atayabilir; diğerleri kendine kaydeder.
  let assignedTo = userId;
  if (input.assignedTo && input.assignedTo !== userId) {
    if (!isManager) return { ok: false, error: "Kaydı başka bir danışmana yalnız yönetici atayabilir." };
    const { data: target } = await db.from("profiles").select("id").eq("id", input.assignedTo).eq("tenant_id", tenantId).eq("is_active", true).maybeSingle();
    if (!target) return { ok: false, error: "Seçilen danışman bu ofiste bulunamadı." };
    assignedTo = input.assignedTo;
  }

  const insert = await db
    .from("fsbo_leads")
    .insert({
      tenant_id: tenantId,
      branch_id: (profileRes.data as { branch_id: string | null } | null)?.branch_id ?? null,
      assigned_to: assignedTo,
      created_by: userId,
      source: input.source,
      portal: input.portal,
      external_id: input.externalId,
      url: input.url,
      title: input.title,
      transaction_type: input.transactionType,
      property_type: input.propertyType,
      price: input.price,
      rooms: input.rooms,
      gross_m2: input.grossM2,
      net_m2: input.netM2,
      province_id: input.provinceId,
      district_id: input.districtId,
      location_text: input.locationText,
      listed_at: input.listedAt,
      first_seen_at: nowIso,
      last_seen_at: nowIso,
      listing_status: "active",
      owner_name: input.ownerName,
      phone: input.phone,
      phone_hash: hash,
      next_action_at: new Date(initialNextActionMs(nowMs)).toISOString(),
      last_activity_at: nowIso,
      claim_expires_at: new Date(nowMs + CLAIM_IDLE_DAYS * DAY_MS).toISOString(),
      customer_id: cust?.id ?? null,
      relist_of: relist?.reason === "phone" ? relist.leadId : null,
    })
    .select("id")
    .single();
  if (insert.error || !insert.data) {
    if (insert.error?.code === "23505") return { ok: false, error: "Bu ilan az önce başka bir kayıtla eklendi. Sayfayı yenileyin." };
    console.error("saveFsboLead", insert.error);
    return { ok: false, error: actionErrorMessage(insert.error, "Kayıt eklenemedi. Lütfen tekrar deneyin.") };
  }
  const id = String((insert.data as { id: string }).id);
  await Promise.all([
    db.from("fsbo_lead_observations").insert({
      tenant_id: tenantId,
      lead_id: id,
      observed_at: nowIso,
      price: input.price,
      listing_status: "active",
      source: input.source === "extension" ? "extension" : "manual",
      observed_by: userId,
    }),
    db.from("fsbo_lead_activities").insert({
      tenant_id: tenantId,
      lead_id: id,
      actor_id: userId,
      kind: "status",
      note: input.source === "extension" ? "Eklentiden kaydedildi." : "Elle eklendi.",
    }),
  ]);

  const notices = conflictNotices({
    doNotCall,
    customer: cust ? { id: cust.id, name: cust.full_name, type: cust.customer_types?.[0] ?? null } : null,
    ownListing: own ? { propertyId: own.property_id } : null,
  });
  return { ok: true, id, created: true, ownership: { kind: "mine" }, notices, priceDropPct: null, relist, doNotCall };
}
