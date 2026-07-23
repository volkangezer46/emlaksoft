"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";

export type OwnerPortalResult = { ok?: boolean; error?: string; token?: string; url?: string };

// ---------------------------------------------------------------------------
// Malik için portal token oluştur
// ---------------------------------------------------------------------------

export async function createOwnerPortalToken(
  propertyId: string,
  ownerName: string,
  ownerPhone?: string,
): Promise<OwnerPortalResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();

  // Portföy bu tenanta ait mi?
  const { data: property } = await supabase
    .from("properties")
    .select("id, property_code")
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!property) return { error: "Portföy bulunamadı." };
  if (!ownerName.trim()) return { error: "Malik adı zorunludur." };

  // Aktif token var mı?
  const { data: existing } = await supabase
    .from("owner_portal_tokens")
    .select("token, expires_at")
    .eq("property_id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const url = buildOwnerPortalUrl(existing.token);
    return { ok: true, token: existing.token, url };
  }

  // Yeni token
  const { data: newToken, error } = await supabase
    .from("owner_portal_tokens")
    .insert({
      tenant_id:   gate.tenantId,
      property_id: propertyId,
      owner_name:  ownerName.trim(),
      owner_phone: ownerPhone?.trim() || null,
      created_by:  gate.userId,
    })
    .select("token")
    .single();

  if (error || !newToken) return { error: "Token oluşturulamadı." };

  const url = buildOwnerPortalUrl(newToken.token);
  revalidatePath(`/app/portfoyler/${propertyId}`);
  return { ok: true, token: newToken.token, url };
}

function buildOwnerPortalUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/malik-portali/${token}`;
}

// ---------------------------------------------------------------------------
// Malik portal verilerini token ile getir (public — service role)
// ---------------------------------------------------------------------------

export type OwnerPortalData = {
  property: {
    id:          string;
    code:        string;
    title:       string | null;
    listPrice:   number | null;
    status:      string | null;
    province:    string | null;
    district:    string | null;
    description: string | null;
  };
  tenant: { name: string };
  ownerName: string;
  portalListings: {
    id:           string;
    portalName:   string;
    status:       string;
    confirmedAt:  string | null;
    publishedAt:  string | null;
    portalUrl:    string | null;
  }[];
  offers: {
    id:          string;
    amount:      number;
    status:      string;
    submittedAt: string | null;
    notes:       string | null;
  }[];
  appointments: {
    id:         string;
    type:       string;
    scheduledAt: string;
    status:     string;
  }[];
};

export async function getOwnerPortalData(token: string): Promise<OwnerPortalData | null> {
  const admin = createAdminClient();

  const { data: portalToken } = await admin
    .from("owner_portal_tokens")
    .select("property_id, tenant_id, owner_name, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!portalToken) return null;
  if (new Date(portalToken.expires_at) < new Date()) return null;

  // Son görülme zamanını güncelle
  await admin
    .from("owner_portal_tokens")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("token", token);

  const { propertyId, tenantId, ownerName } = {
    propertyId: portalToken.property_id,
    tenantId:   portalToken.tenant_id,
    ownerName:  portalToken.owner_name,
  };

  const [
    { data: property },
    { data: tenant },
    { data: listings },
    { data: offers },
    { data: appointments },
  ] = await Promise.all([
    admin.from("properties")
      .select("id, property_code, title, list_price, status, description, province:provinces(name), district:districts(name)")
      .eq("id", propertyId)
      .single(),
    admin.from("tenants")
      .select("name")
      .eq("id", tenantId)
      .single(),
    admin.from("portal_listings")
      .select("id, portal_name, status, last_confirmed_at, published_at, portal_url")
      .eq("property_id", propertyId)
      .eq("tenant_id", tenantId)
      .order("published_at", { ascending: false }),
    admin.from("offers")
      .select("id, amount, status, submitted_at, notes")
      .eq("property_id", propertyId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(20),
    admin.from("appointments")
      .select("id, appointment_type, scheduled_at, status")
      .eq("property_id", propertyId)
      .eq("tenant_id", tenantId)
      .gte("scheduled_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
      .order("scheduled_at", { ascending: false })
      .limit(10),
  ]);

  if (!property || !tenant) return null;

  const provinceName = Array.isArray(property.province)
    ? property.province[0]?.name ?? null
    : (property.province as { name?: string } | null)?.name ?? null;
  const districtName = Array.isArray(property.district)
    ? property.district[0]?.name ?? null
    : (property.district as { name?: string } | null)?.name ?? null;

  return {
    property: {
      id:          property.id,
      code:        property.property_code,
      title:       property.title ?? null,
      listPrice:   property.list_price != null ? Number(property.list_price) : null,
      status:      property.status ?? null,
      province:    provinceName,
      district:    districtName,
      description: property.description ?? null,
    },
    tenant: { name: tenant.name },
    ownerName,
    portalListings: (listings ?? []).map((l) => ({
      id:          l.id,
      portalName:  l.portal_name,
      status:      l.status,
      confirmedAt: l.last_confirmed_at ?? null,
      publishedAt: l.published_at ?? null,
      portalUrl:   l.portal_url ?? null,
    })),
    offers: (offers ?? []).map((o) => ({
      id:          o.id,
      amount:      Number(o.amount),
      status:      o.status,
      submittedAt: o.submitted_at ?? null,
      notes:       o.notes ?? null,
    })),
    appointments: (appointments ?? []).map((a) => ({
      id:          a.id,
      type:        a.appointment_type,
      scheduledAt: a.scheduled_at,
      status:      a.status,
    })),
  };
}
