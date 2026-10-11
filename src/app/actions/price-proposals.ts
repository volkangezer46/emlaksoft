"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { daysAgoIso } from "@/lib/clock";
import {
  buildSnapshot,
  parsePriceInput,
  proposalMessage,
  type ProposalSnapshot,
} from "@/lib/price-proposals/model";

/**
 * Fiyat revizyonu önerisi — DANIŞMAN tarafı. Yazma yalnız SECURITY DEFINER RPC'ler (20261012000800):
 * tenant + properties:edit + aktif malik portalı kontrolü SQL içinde de yapılır. Burada: yetki kapısı, biçim,
 * emsal anlık görüntüsü (mevcut emsal motoru; emsal yoksa snapshot YOK = öneri aralığı yok).
 */

export type PriceProposalResult = { ok: boolean; message: string };

export type PriceProposalDraft = {
  currentPrice: number | null;
  /** Emsal yoksa null: arayüz aralık göstermez. */
  snapshot: ProposalSnapshot | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PropertyRow = {
  list_price: number | string | null;
  district_id: string | null;
  property_type: string | null;
  transaction_type: string | null;
  features: Record<string, unknown> | null;
};

type Db = Awaited<ReturnType<typeof createClient>>;

const num = (v: unknown): number | null => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** Portföyün mevcut emsal motoru çıktısından anonim özet; emsal yetersizse null. */
async function loadSnapshot(supabase: Db, tenantId: string, propertyId: string, prop: PropertyRow): Promise<ProposalSnapshot | null> {
  const f = prop.features ?? {};
  const input = {
    tenantId,
    districtId: prop.district_id,
    propertyType: prop.property_type,
    transactionType: prop.transaction_type,
    sqm: num(f.sqm),
    excludePropertyId: propertyId,
    targetFloor: num(f.floor),
    targetBuildingAge: num(f.building_age),
    targetHeating: typeof f.heating === "string" ? f.heating : null,
    targetFacade: typeof f.facade === "string" ? f.facade : null,
  };
  const { estimateFromComparables, listComparables } = await import("@/lib/comparables");
  const estimate = await estimateFromComparables(supabase, input);
  if (estimate.confidence === "yetersiz") return null;
  const comps = await listComparables(supabase, input, 5);
  return buildSnapshot(estimate, comps, daysAgoIso(0));
}

async function readProperty(supabase: Db, tenantId: string, propertyId: string): Promise<PropertyRow | null> {
  const { data } = await supabase
    .from("properties")
    .select("list_price, district_id, property_type, transaction_type, features")
    .eq("id", propertyId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as PropertyRow | null) ?? null;
}

/** Form açılırken: güncel fiyat + varsa emsal aralığı. */
export async function getPriceProposalDraft(propertyId: string): Promise<PriceProposalDraft | null> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok || !UUID_RE.test(propertyId)) return null;
  const supabase = await createClient();
  const prop = await readProperty(supabase, gate.tenantId, propertyId);
  if (!prop) return null;
  return { currentPrice: num(prop.list_price), snapshot: await loadSnapshot(supabase, gate.tenantId, propertyId, prop) };
}

export async function createPriceProposal(fd: FormData): Promise<PriceProposalResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { ok: false, message: gate.error };

  const propertyId = String(fd.get("property_id") ?? "").trim();
  const newPrice = parsePriceInput(String(fd.get("new_price") ?? ""));
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 1000);
  if (!UUID_RE.test(propertyId)) return { ok: false, message: "Geçersiz istek." };
  if (newPrice === null) return { ok: false, message: proposalMessage("invalid_price").text };
  if (reason.length < 3) return { ok: false, message: proposalMessage("invalid_reason").text };

  const supabase = await createClient();
  const prop = await readProperty(supabase, gate.tenantId, propertyId);
  if (!prop) return { ok: false, message: proposalMessage("not_found").text };
  const snapshot = await loadSnapshot(supabase, gate.tenantId, propertyId, prop);

  const { data, error } = await supabase.rpc("create_property_price_proposal", {
    p_property_id: propertyId,
    p_new_price: newPrice,
    p_reason: reason,
    p_comparables: snapshot,
  });
  if (error) return { ok: false, message: actionErrorMessage(error, "Fiyat önerisi kaydedilemedi") };
  const m = proposalMessage((data as { code?: string } | null)?.code ?? "error");
  if (!m.ok) return { ok: false, message: m.text };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.price_proposal_created",
    entityType: "property",
    entityId: propertyId,
    newValue: { newPrice, hasComparables: snapshot !== null },
  });
  revalidatePath(`/app/portfoyler/${propertyId}`);
  return { ok: true, message: "Öneri mülk sahibinin portalına gönderildi. Yanıt gelince bildirim alacaksınız." };
}

export async function cancelPriceProposal(fd: FormData): Promise<PriceProposalResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { ok: false, message: gate.error };
  const proposalId = String(fd.get("proposal_id") ?? "").trim();
  const propertyId = String(fd.get("property_id") ?? "").trim();
  if (!UUID_RE.test(proposalId) || !UUID_RE.test(propertyId)) return { ok: false, message: "Geçersiz istek." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_property_price_proposal", { p_proposal_id: proposalId });
  if (error) return { ok: false, message: actionErrorMessage(error, "Öneri iptal edilemedi") };
  const m = proposalMessage((data as { code?: string } | null)?.code ?? "error");
  if (!m.ok) return { ok: false, message: m.text };
  revalidatePath(`/app/portfoyler/${propertyId}`);
  return { ok: true, message: "Öneri iptal edildi." };
}
