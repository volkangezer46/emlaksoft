"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { scoreDemandProperty, type MatchDemand, type MatchProperty } from "@/lib/matching";

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
  const { data: customer } = await supabase
    .from("customers")
    .select("id, full_name")
    .eq("id", customerId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!customer) return { error: "Müşteri bulunamadı." };

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
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/musteri-portali/${token}`;
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

  // Son görülme zamanını güncelle
  await admin
    .from("customer_portal_tokens")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("token", token);

  const { customerId, tenantId } = {
    customerId: portalToken.customer_id,
    tenantId:   portalToken.tenant_id,
  };

  // Müşteri + tenant + talepler + randevular + aktif portföyler paralel çek
  const [
    { data: customer },
    { data: tenant },
    { data: demands },
    { data: appointments },
    { data: propRows },
  ] = await Promise.all([
    admin.from("customers")
      .select("id, full_name, email, phone")
      .eq("id", customerId)
      .single(),
    admin.from("tenants")
      .select("name")
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
      .is("deleted_at", null)
      .in("status", ["live", "reserved", "Yayında"])
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (!customer || !tenant) return null;

  const demandRows = demands ?? [];

  // Aktif taleplere göre portföyleri anlık skorla — en iyi 6 eşleşme
  const activeDemands = demandRows.filter((d) => ["new", "active", "matched"].includes(d.status));
  const scored: { id: string; score: number; title: string | null; code: string; price: number | null; province: string | null }[] = [];
  const seen = new Set<string>();
  for (const d of activeDemands) {
    for (const p of propRows ?? []) {
      const result = scoreDemandProperty(d as MatchDemand, p as unknown as MatchProperty);
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

  return {
    customer: {
      id:       customer.id,
      fullName: customer.full_name,
      email:    customer.email ?? null,
      phone:    customer.phone ?? null,
    },
    tenant: { name: tenant.name },
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
  };
}
