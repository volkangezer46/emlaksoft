"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { fetchTenantMatchingWeights, scoreDemandProperty, type MatchDemand, type MatchProperty } from "@/lib/matching";
import { getBaseUrl } from "@/lib/base-url";
import { buildPortalTabs, signerMatchesCustomer, type PortalOwnerProperty, type PortalRental, type PortalDocuments, type PortalTab } from "@/lib/customer-portal/portal-model";

function relName(v: unknown): string | null {
  if (!v) return null;
  const o = Array.isArray(v) ? v[0] : v;
  return (o as { name?: string } | null)?.name ?? null;
}

export type PortalTokenResult = { ok?: boolean; error?: string; token?: string; url?: string };

// ---------------------------------------------------------------------------
// Müşteri için portal token oluştur (veya mevcut olanı döndür)
// ---------------------------------------------------------------------------

export async function createCustomerPortalToken(
  customerId: string,
): Promise<PortalTokenResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();

  // Müşteri bu tenanta ait mi?
  // Örnek (is_sample) müşteriye portal bağlantısı ÜRETİLMEZ: token'lı yüzeyler demo kaydı hiç göstermez.
  const { data: customer } = await supabase
    .from("customers")
    .select("id, full_name")
    .eq("id", customerId)
    .eq("tenant_id", gate.tenantId)
    .eq("is_sample", false)
    .is("deleted_at", null)
    .maybeSingle();

  if (!customer) return { error: "Müşteri bulunamadı (örnek kayıtlar için portal bağlantısı üretilmez)." };

  // Aktif token var mı?
  const { data: existing } = await supabase
    .from("customer_portal_tokens")
    .select("token, expires_at")
    .eq("customer_id", customerId)
    .eq("tenant_id", gate.tenantId)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const url = buildPortalUrl(existing.token);
    return { ok: true, token: existing.token, url };
  }

  // Yeni token oluştur
  const { data: newToken, error } = await supabase
    .from("customer_portal_tokens")
    .insert({
      tenant_id:   gate.tenantId,
      customer_id: customerId,
      created_by:  gate.userId,
    })
    .select("token")
    .single();

  if (error || !newToken) return { error: "Token oluşturulamadı." };

  const url = buildPortalUrl(newToken.token);
  revalidatePath(`/app/musteriler/${customerId}`);
  return { ok: true, token: newToken.token, url };
}

function buildPortalUrl(token: string): string {
  return `${getBaseUrl()}/musteri-portali/${token}`;
}

// ---------------------------------------------------------------------------
// Müşteri portal linkini iptal et
// ---------------------------------------------------------------------------

/**
 * Tabloda ayrı bir `revoked_at` kolonu YOK; iptal, geçerlilik damgasını
 * "şimdi"ye çekerek yapılır. Public taraf (`getCustomerPortalData`) zaten
 * `expires_at < now()` olan token'ı reddediyor — tek doğruluk kaynağı
 * expires_at, ikinci bir durum kolonu eklemeye gerek yok.
 */
export async function revokeCustomerPortalToken(formData: FormData): Promise<PortalTokenResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Portal linki bulunamadı." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("customer_portal_tokens")
    .update({ expires_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("revokeCustomerPortalToken", error);
    return { error: "Link iptal edilemedi." };
  }

  revalidatePath("/app/portfoyler/sunumlar");
  revalidatePath("/app/musteriler");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Portal verilerini token ile getir (public — service role)
// ---------------------------------------------------------------------------

export type CustomerPortalData = {
  customer: {
    id:       string;
    fullName: string;
    email:    string | null;
    phone:    string | null;
  };
  tenant: {
    id:   string;
    name: string;
  };
  demands: {
    id:          string;
    type:        string;
    province:    string | null;
    minPrice:    number | null;
    maxPrice:    number | null;
    status:      string;
    createdAt:   string;
  }[];
  appointments: {
    id:         string;
    type:       string;
    scheduledAt: string;
    status:     string;
    location:   string | null;
  }[];
  matches: {
    id:         string;
    score:      number | null;
    property: {
      title:    string | null;
      code:     string;
      price:    number | null;
      province: string | null;
    };
  }[];
  /** TEK PORTAL: kişinin rolleri (alıcı / malik / kiracı / belgeler) — yalnız veri olan sekme döner. */
  tabs: PortalTab[];
  /** Malik: `properties.owner_customer_id` bu kişi olan portföyler (en çok 5). */
  owner: PortalOwnerProperty[];
  /** Kiracı: `rentals.renter_customer_id` bu kişi olan aktif kira kayıtları. */
  renter: PortalRental[];
  documents: PortalDocuments;
  /** İstek RPC'si (20261007000620) var mı: yoksa teklif/erteleme/bakım formları çizilmez. */
  requestsEnabled: boolean;
};

export async function getCustomerPortalData(
  token: string,
): Promise<CustomerPortalData | null> {
  const admin = createAdminClient();

  // Token geçerli mi?
  const { data: portalToken } = await admin
    .from("customer_portal_tokens")
    .select("customer_id, tenant_id, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!portalToken) return null;
  if (new Date(portalToken.expires_at) < new Date()) return null;

  const { customerId, tenantId } = {
    customerId: portalToken.customer_id,
    tenantId:   portalToken.tenant_id,
  };

  // last_seen güncelleme + müşteri + tenant + talepler + randevular + aktif portföyler paralel
  const [
    ,
    { data: customer },
    { data: tenant },
    { data: demands },
    { data: appointments },
    { data: propRows },
    weights,
  ] = await Promise.all([
    // Son görülme zamanını güncelle (yalnızca token'a bağlı)
    admin.from("customer_portal_tokens")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("token", token)
      .eq("tenant_id", tenantId),
    admin.from("customers")
      .select("id, full_name, email, phone")
      .eq("id", customerId)
      .eq("tenant_id", tenantId)
      .eq("is_sample", false)
      .is("deleted_at", null)
      .single(),
    admin.from("tenants")
      .select("name, status")
      .eq("id", tenantId)
      .single(),
    admin.from("customer_demands")
      .select("id, transaction_type, property_type, province_id, district_id, budget_min, budget_max, rooms, min_sqm, urgency, status, created_at, province:geo_provinces(name)")
      .eq("customer_id", customerId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(10),
    admin.from("appointments")
      .select("id, appointment_type, scheduled_at, status, location")
      .eq("customer_id", customerId)
      .eq("tenant_id", tenantId)
      .gte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(5),
    // Eşleşme için tenant'ın aktif portföyleri (matches tablosu yok → anlık skorlanır)
    admin.from("properties")
      .select("id, property_code, title, transaction_type, property_type, status, list_price, province_id, district_id, features, province:geo_provinces(name)")
      .eq("tenant_id", tenantId)
      .eq("is_sample", false)
      .is("deleted_at", null)
      .in("status", ["live", "reserved", "Yayında"])
      .order("created_at", { ascending: false })
      .limit(200),
    // Ofise özel eşleştirme ağırlıkları — panel/eşleştirme sayfasıyla aynı skor
    fetchTenantMatchingWeights(admin, tenantId),
  ]);

  if (!customer || !tenant || !isPublicTenantActive(tenant.status)) return null;

  const demandRows = demands ?? [];

  // Aktif taleplere göre portföyleri anlık skorla — en iyi 6 eşleşme
  const activeDemands = demandRows.filter((d) => ["new", "active", "matched"].includes(d.status));
  const scored: { id: string; score: number; title: string | null; code: string; price: number | null; province: string | null }[] = [];
  const seen = new Set<string>();
  for (const d of activeDemands) {
    for (const p of propRows ?? []) {
      const result = scoreDemandProperty(d as MatchDemand, p as unknown as MatchProperty, weights);
      if (result.score >= 50 && !seen.has(p.id)) {
        seen.add(p.id);
        scored.push({
          id: p.id,
          score: result.score,
          title: p.title,
          code: p.property_code,
          price: p.list_price,
          province: relName(p.province),
        });
      }
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const topMatches = scored.slice(0, 6);

  // TEK PORTAL ekleri (aynı service_role istemcisi; her sorgu token'ın müşteri + ofis kimliğine bağlı, örnek kayıt süzülür).
  const extras = await loadPortalRoles(admin, tenantId, customerId, customer.phone ?? null);

  return {
    customer: {
      id:       customer.id,
      fullName: customer.full_name,
      email:    customer.email ?? null,
      phone:    customer.phone ?? null,
    },
    tenant: { id: tenantId, name: tenant.name },
    demands: demandRows.map((d) => ({
      id:        d.id,
      type:      [d.transaction_type, d.property_type].filter(Boolean).join(" · "),
      province:  relName(d.province),
      minPrice:  d.budget_min ?? null,
      maxPrice:  d.budget_max ?? null,
      status:    d.status ?? "",
      createdAt: d.created_at,
    })),
    appointments: (appointments ?? []).map((a) => ({
      id:          a.id,
      type:        a.appointment_type,
      scheduledAt: a.scheduled_at,
      status:      a.status,
      location:    a.location ?? null,
    })),
    matches: topMatches.map((m) => ({
      id:    m.id,
      score: m.score,
      property: {
        title:    m.title,
        code:     m.code,
        price:    m.price,
        province: m.province,
      },
    })),
    tabs: buildPortalTabs({
      buyer: topMatches.length + demandRows.length + (appointments ?? []).length,
      owner: extras.owner.length,
      renter: extras.renter.length,
      documents: extras.documents.pendingSign.length + extras.documents.signed.length,
    }),
    owner: extras.owner,
    renter: extras.renter,
    documents: extras.documents,
    requestsEnabled: extras.requestsEnabled,
  };
}

type AdminDb = ReturnType<typeof createAdminClient>;

/**
 * Kişinin malik / kiracı / belge verisi. KVKK: yalnız bu müşterinin kayıtları — malik portföyleri `owner_customer_id`,
 * kira kayıtları `renter_customer_id`, sözleşmeler `customer_id` + imzacı telefonu eşleşmesi. Malik tarafında alıcı adı/notu
 * gösterilmez (yalnız tutar/durum), taslak teklif gösterilmez. Belge DOSYASI gösterilmez (yalnız imza bağlantısı/durum).
 * Tablo/sütun yoksa ilgili bölüm boş döner (hata sayfası yok).
 */
async function loadPortalRoles(admin: AdminDb, tenantId: string, customerId: string, customerPhone: string | null) {
  const nowIso = new Date().toISOString();
  const [ownedRes, rentalsRes, contractsRes, readyRes] = await Promise.all([
    admin
      .from("properties")
      .select("id, property_code, title, list_price, status")
      .eq("tenant_id", tenantId)
      .eq("owner_customer_id", customerId)
      .eq("is_sample", false)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("rentals")
      .select("id, monthly_rent, due_day, start_date, end_date, property:properties!rentals_property_id_fkey(title, property_code)")
      .eq("tenant_id", tenantId)
      .eq("renter_customer_id", customerId)
      .eq("is_sample", false)
      .eq("status", "active")
      .limit(3),
    admin
      .from("contracts")
      .select("id, title, status, expires_at, signers:contract_signers(token, status, phone, signed_at)")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId)
      .eq("is_sample", false)
      .in("status", ["sent", "signed"])
      .order("created_at", { ascending: false })
      .limit(10),
    admin.rpc("portal_customer_request_ready"),
  ]);

  const owned = ownedRes.error ? [] : ((ownedRes.data ?? []) as { id: string; property_code: string; title: string | null; list_price: number | null; status: string }[]);
  const ownedIds = owned.map((o) => o.id);
  const [offersRes, listingsRes, ownerTokensRes] = ownedIds.length
    ? await Promise.all([
        admin.from("offers").select("property_id, amount, status, submitted_at").eq("tenant_id", tenantId).in("property_id", ownedIds).neq("status", "draft").order("created_at", { ascending: false }).limit(50),
        admin.from("portal_listings").select("property_id, status").eq("tenant_id", tenantId).in("property_id", ownedIds).eq("status", "live"),
        admin.from("owner_portal_tokens").select("property_id, token, expires_at").eq("tenant_id", tenantId).in("property_id", ownedIds).gt("expires_at", nowIso).order("created_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const offerRows = (offersRes.data ?? []) as { property_id: string; amount: number; status: string; submitted_at: string | null }[];
  const liveRows = (listingsRes.data ?? []) as { property_id: string }[];
  const tokenRows = (ownerTokensRes.data ?? []) as { property_id: string; token: string }[];
  const owner: PortalOwnerProperty[] = owned.map((o) => ({
    id: o.id,
    label: o.title || o.property_code,
    listPrice: o.list_price != null ? Number(o.list_price) : null,
    status: o.status,
    livePortals: liveRows.filter((l) => l.property_id === o.id).length,
    offers: offerRows.filter((x) => x.property_id === o.id).slice(0, 5).map((x) => ({ amount: Number(x.amount), status: x.status, at: x.submitted_at })),
    ownerPortalHref: (() => {
      const t = tokenRows.find((r) => r.property_id === o.id);
      return t ? `/malik-portali/${t.token}` : null;
    })(),
  }));

  type RentalRaw = { id: string; monthly_rent: number; due_day: number; start_date: string; end_date: string | null; property: { title: string | null; property_code: string } | { title: string | null; property_code: string }[] | null };
  const rentals = rentalsRes.error ? [] : ((rentalsRes.data ?? []) as RentalRaw[]);
  const rentalIds = rentals.map((r) => r.id);
  const [chargesRes, maintRes] = rentalIds.length
    ? await Promise.all([
        admin.from("rent_charges").select("rental_id, period, amount, status").eq("tenant_id", tenantId).in("rental_id", rentalIds).order("period", { ascending: false }).limit(24),
        admin.from("maintenance_requests").select("rental_id, title, status, created_at").eq("tenant_id", tenantId).in("rental_id", rentalIds).order("created_at", { ascending: false }).limit(20),
      ])
    : [{ data: [] }, { data: [] }];
  const charges = (chargesRes.data ?? []) as { rental_id: string; period: string; amount: number; status: string }[];
  const maint = (maintRes.data ?? []) as { rental_id: string; title: string; status: string; created_at: string }[];
  const renter: PortalRental[] = rentals.map((r) => {
    const p = Array.isArray(r.property) ? r.property[0] : r.property;
    return {
      id: r.id,
      label: p?.title || p?.property_code || "Kiralık mülk",
      monthlyRent: Number(r.monthly_rent),
      dueDay: r.due_day,
      startDate: r.start_date,
      endDate: r.end_date,
      charges: charges.filter((c) => c.rental_id === r.id).slice(0, 6).map((c) => ({ period: c.period, amount: Number(c.amount), status: c.status })),
      maintenance: maint.filter((m) => m.rental_id === r.id).slice(0, 5).map((m) => ({ title: m.title, status: m.status, at: m.created_at })),
    };
  });

  type ContractRaw = { id: string; title: string | null; status: string; expires_at: string | null; signers: { token: string; status: string; phone: string | null; signed_at: string | null }[] | null };
  const contracts = contractsRes.error ? [] : ((contractsRes.data ?? []) as ContractRaw[]);
  const documents: PortalDocuments = { pendingSign: [], signed: [] };
  for (const c of contracts) {
    const mine = (c.signers ?? []).filter((sg) => signerMatchesCustomer(sg.phone, customerPhone));
    const pending = mine.find((sg) => sg.status === "pending");
    if (c.status === "sent" && pending && !(c.expires_at && c.expires_at < nowIso)) {
      documents.pendingSign.push({ id: c.id, title: c.title || "Sözleşme", href: `/imza/${pending.token}` });
    } else if (mine.some((sg) => sg.status === "signed")) {
      documents.signed.push({ id: c.id, title: c.title || "Sözleşme", signedAt: mine.find((sg) => sg.signed_at)?.signed_at ?? null });
    }
  }

  return { owner, renter, documents, requestsEnabled: !readyRes.error && readyRes.data === true };
}
