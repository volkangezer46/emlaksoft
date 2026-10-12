import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS, now } from "@/lib/clock";
import { actionErrorMessage } from "@/lib/action-errors";
import { MANAGER_ROLES } from "@/lib/team/assignable-roles";
import { conflictNotices, ownershipVerdict, type ConflictNotice, type OwnershipVerdict } from "./conflict";
import { initialNextActionMs } from "./cadence";
import { phoneHash, phoneHashCandidates } from "./phone-hash";
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
};

const EXISTING_SELECT = "id, assigned_to, price, phone, price_drop_count, last_activity_at, claim_expires_at";

/** `fsbo_find_existing` RPC satırı (RLS'i delmeden ofis içi tekilleştirme: yalnız var/yok + sahip adı + sahiplik tarihleri). */
type FindRow = {
  lead_id: string;
  match_kind: "url" | "phone";
  assigned_to: string | null;
  assignee_name: string | null;
  last_activity_at: string;
  claim_expires_at: string | null;
  status: string;
  is_mine: boolean | null;
};

/** İlan anahtarı özeti (SQL'deki `sha256(convert_to(...))` ile aynı anahtar biçimi). */
export function listingKeyHash(input: { portal: string; externalId: string | null; url: string | null }): string | null {
  const key = input.externalId ? `ext|${input.portal}|${input.externalId}` : input.url ? `url|${input.url}` : null;
  return key ? createHash("sha256").update(key, "utf8").digest("hex") : null;
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
  // v1/v2 geçiş dönemi: aranmasın ve tekilleştirme sorguları iki özete de bakar; yeni kayıt `hash` (v2) yazar.
  const hashCandidates = input.phone ? phoneHashCandidates(tenantId, input.phone) : [];

  // 1) Aynı ilan / aynı telefon ofiste kayıtlı mı? SELECT RLS'i danışman kapsamındadır; ofis içi tekilleştirme dar RPC ile yapılır.
  const urlHash = listingKeyHash(input);
  let existingFind: FindRow | null = null;
  let phoneMatch: FindRow | null = null;
  if (urlHash || hashCandidates.length > 0) {
    const { data, error } = await db.rpc("fsbo_find_existing", {
      p_url_hash: urlHash ?? "",
      p_phone_hash: hashCandidates[0] ?? null,
      p_phone_hash_alt: hashCandidates[1] ?? null,
    });
    if (error) return { ok: false, error: actionErrorMessage(error, "Kayıt kontrol edilemedi. Lütfen tekrar deneyin.") };
    const found = (data as FindRow[] | null) ?? [];
    existingFind = found.find((r) => r.match_kind === "url") ?? null;
    phoneMatch = found.find((r) => r.match_kind === "phone" && r.lead_id !== existingFind?.lead_id) ?? null;
  }

  let existing: ExistingRow | null = null;
  if (existingFind) {
    const verdict = ownershipVerdict(
      {
        assignedTo: existingFind.assigned_to,
        assignedName: existingFind.assignee_name,
        lastActivityMs: Date.parse(existingFind.last_activity_at),
        claimExpiresMs: existingFind.claim_expires_at ? Date.parse(existingFind.claim_expires_at) : null,
      },
      userId,
      nowMs,
      { canOverride: isManager },
    );
    if (verdict.kind === "other") {
      return { ok: true, id: existingFind.lead_id, created: false, ownership: verdict, notices: [], priceDropPct: null, relist: null, doNotCall: false };
    }
    // Sahiplenme (sahipsiz / devralma): assigned_to sütununa kullanıcı UPDATE yetkisi yoktur; yetki + kapsam RPC'de.
    if (existingFind.assigned_to !== userId) {
      const claim = await db.rpc("fsbo_assign_lead", { p_lead_id: existingFind.lead_id, p_assignee: userId });
      if (claim.error) return { ok: false, error: actionErrorMessage(claim.error, "Kayıt sahiplenilemedi. Lütfen tekrar deneyin.") };
      if (claim.data !== "ok") return { ok: false, error: "Bu kayıt başka bir danışmanın." };
    }
    // Artık görünür (kendi): ayrıntıyı normal sorguyla oku.
    const { data, error } = await db.from("fsbo_leads").select(EXISTING_SELECT).eq("tenant_id", tenantId).eq("id", existingFind.lead_id).is("deleted_at", null).maybeSingle();
    if (error) return { ok: false, error: actionErrorMessage(error, "Kayıt kontrol edilemedi. Lütfen tekrar deneyin.") };
    existing = (data as ExistingRow | null) ?? null;
    if (!existing) return { ok: false, error: "Kayıt bulunamadı. Lütfen tekrar deneyin." };
  }

  if (existing) {
    const prevPrice = existing.price == null ? null : Number(existing.price);
    const change = evaluatePriceChange(prevPrice, input.price);
    const patch: Record<string, unknown> = {
      last_seen_at: nowIso,
      last_activity_at: nowIso,
      listing_status: "active",
      claim_expires_at: new Date(nowMs + CLAIM_IDLE_DAYS * DAY_MS).toISOString(),
    };
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
    hashCandidates.length > 0 ? db.from("fsbo_do_not_call").select("id").eq("tenant_id", tenantId).in("phone_hash", hashCandidates).limit(1) : Promise.resolve({ data: [], error: null }),
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
    // v1 ile kayıtlı eski özet aynı numaraysa yeni (v2) özete normalleştirilir; aksi halde tekrar ilan eşleşmesi kaçar.
    phoneHash: c.phone_hash && hashCandidates.includes(c.phone_hash) ? hash : c.phone_hash,
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
      // Aranmasın listesindeki ilan sahibi için "ilk arama" zamanı konmaz (içgörü/otomasyon görev üretmesin).
      next_action_at: doNotCall ? null : new Date(initialNextActionMs(nowMs)).toISOString(),
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
    otherLead: phoneMatch && phoneMatch.assigned_to !== userId ? { name: phoneMatch.assignee_name } : null,
    doNotCall,
    customer: cust ? { id: cust.id, name: cust.full_name, type: cust.customer_types?.[0] ?? null } : null,
    ownListing: own ? { propertyId: own.property_id } : null,
  });
  return { ok: true, id, created: true, ownership: { kind: "mine" }, notices, priceDropPct: null, relist, doNotCall };
}
