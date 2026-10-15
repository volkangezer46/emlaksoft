"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { fetchTenantMatchingWeights, scoreDemandProperty, type MatchDemand, type MatchProperty } from "@/lib/matching";
import { insertPropertyShareLink } from "@/lib/share-links";
import { buildMatchShareMessage } from "@/lib/match-share-message";
import { gateIysRecipients } from "@/lib/iys/gate";
import { isTenantSmsAvailable, prepareTenantSmsSender } from "@/lib/messaging/tenant-providers";
import {
  consentCandidateIds,
  MATCH_BULK_MAX_DEMANDS,
  MATCH_BULK_SEND_CAP,
  planMatchBulkSend,
  strictIysAllowedIds,
  type MatchBulkPlan,
  type MatchBulkRecipient,
  type MatchBulkSkipReason,
} from "@/lib/match-bulk-send";

/**
 * Eşleşmeyi TOPLU gönder (ör. fiyat düşüşünde portföyün eşleştiği tüm alıcılara): tekil "Müşteriye gönder" ile AYNI yol
 * (aynı iki kapı matching:create + properties:edit, aynı paylaşım bağlantısı yardımcısı, aynı mesaj metni, aynı `match.sent`
 * denetim kaydı). Fark: mesaj ofisin SMS hesabından sunucuda, SIRAYLA ve en fazla MATCH_BULK_SEND_CAP kişiye gönderilir.
 * Toplu ileti TİCARİDİR: merkezi İYS kapısı (`kind: "bulk_message"`, kanal sms); ofis "yalnız uyar" modunda olsa bile izni
 * eksik alıcı ATLANIR. İletişim engelli / örnek / telefonsuz müşteri atlanır. Talepler sunucuda yeniden skorlanır
 * (eşleşme eşiği 35 altı alıcı gönderime girmez); önizlemeye güvenilmez, gönderimde karar baştan verilir.
 */

export type BulkMatchCounts = {
  send: number;
  overCap: number;
  notMatching: number;
  counts: Record<MatchBulkSkipReason, number>;
};

export type BulkMatchPreviewResult = { error: string } | ({ ok: true; smsReady: boolean } & BulkMatchCounts);

export type BulkMatchSendResult =
  | { error: string }
  | ({ ok: true; sent: number; failed: number; stoppedReason: string | null } & BulkMatchCounts);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MATCH_MIN_SCORE = 35;

type Gate = { tenantId: string; userId: string };

async function gates(): Promise<{ error: string } | Gate> {
  const gate = await requirePermission("matching", "create");
  if (!gate.ok) return { error: gate.error };
  // share_links INSERT RLS'i properties:edit ister (tekil gönderimle aynı kural).
  const shareGate = await requirePermission("properties", "edit");
  if (!shareGate.ok) return { error: "Paylaşım bağlantısı için portföy düzenleme yetkisi gerekir." };
  return { tenantId: gate.tenantId, userId: gate.userId };
}

function readInput(formData: FormData): { error: string } | { propertyId: string; demandIds: string[] } {
  const propertyId = String(formData.get("property_id") ?? "").trim();
  const demandIds = [
    ...new Set(
      formData
        .getAll("demand_ids")
        .flatMap((v) => String(v).split(","))
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  if (!UUID.test(propertyId)) return { error: "Portföy zorunlu." };
  if (demandIds.length === 0) return { error: "Gönderilecek eşleşme yok." };
  if (demandIds.length > MATCH_BULK_MAX_DEMANDS) return { error: `En fazla ${MATCH_BULK_MAX_DEMANDS} talep seçilebilir.` };
  if (demandIds.some((id) => !UUID.test(id))) return { error: "Geçersiz talep seçimi." };
  return { propertyId, demandIds };
}

type PropertyRow = MatchProperty & { is_sample?: boolean | null };

type Planned = {
  property: PropertyRow;
  plan: MatchBulkPlan;
  notMatching: number;
};

/** Talepleri + portföyü okur, yeniden skorlar, alıcıları ayıklar ve İYS kapısından geçirir. */
async function buildPlan(
  supabase: SupabaseClient,
  gate: Gate,
  input: { propertyId: string; demandIds: string[] },
): Promise<{ error: string } | Planned> {
  const [{ data: property }, { data: demands }, weights] = await Promise.all([
    supabase
      .from("properties")
      .select(
        "id, property_code, title, transaction_type, property_type, status, list_price, province_id, district_id, neighborhood_id, features, is_sample",
      )
      .eq("id", input.propertyId)
      .eq("tenant_id", gate.tenantId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("customer_demands")
      .select(
        "id, transaction_type, property_type, province_id, district_id, neighborhood_id, budget_min, budget_max, rooms, min_sqm, urgency, status, criteria, customer:customers!customer_demands_customer_id_fkey(id, full_name, phone, is_sample, blacklist, deleted_at)",
      )
      .in("id", input.demandIds)
      .eq("tenant_id", gate.tenantId)
      .neq("status", "closed"),
    fetchTenantMatchingWeights(supabase, gate.tenantId),
  ]);
  if (!property) return { error: "Portföy bulunamadı." };
  if (property.is_sample) return { error: "Örnek portföy müşteriye gönderilemez." };

  const matchProperty: PropertyRow = {
    ...(property as unknown as PropertyRow),
    list_price: property.list_price != null ? Number(property.list_price) : null,
    features: (property.features ?? {}) as MatchProperty["features"],
  };

  type Cust = { id: string; full_name: string | null; phone: string | null; is_sample?: boolean | null; blacklist?: boolean | null; deleted_at?: string | null };
  // Seçim sırası korunur (ekrandaki skor sırası): tavan en iyi eşleşmelerden başlar.
  const byId = new Map((demands ?? []).map((d) => [d.id as string, d]));
  const recipients: MatchBulkRecipient[] = [];
  let notMatching = 0;
  for (const id of input.demandIds) {
    const d = byId.get(id);
    if (!d) {
      notMatching += 1;
      continue;
    }
    const md: MatchDemand = {
      id: d.id,
      transaction_type: d.transaction_type,
      property_type: d.property_type,
      province_id: d.province_id,
      district_id: d.district_id,
      neighborhood_id: d.neighborhood_id,
      criteria: d.criteria,
      budget_min: d.budget_min != null ? Number(d.budget_min) : null,
      budget_max: d.budget_max != null ? Number(d.budget_max) : null,
      rooms: d.rooms,
      min_sqm: d.min_sqm != null ? Number(d.min_sqm) : null,
      urgency: d.urgency,
      status: d.status,
    };
    if (scoreDemandProperty(md, matchProperty, weights).score < MATCH_MIN_SCORE) {
      notMatching += 1;
      continue;
    }
    const rel = d.customer as Cust | Cust[] | null;
    const c = Array.isArray(rel) ? rel[0] : rel;
    const live = c && !c.deleted_at ? c : null;
    recipients.push({
      demandId: d.id as string,
      customerId: live?.id ?? null,
      fullName: live?.full_name ?? null,
      phone: live?.phone ?? null,
      blacklist: Boolean(live?.blacklist),
      isSample: Boolean(live?.is_sample),
    });
  }

  const iys = await gateIysRecipients(supabase, {
    tenantId: gate.tenantId,
    kind: "bulk_message",
    channel: "sms",
    customerIds: consentCandidateIds(recipients),
  });
  const plan = planMatchBulkSend(recipients, strictIysAllowedIds(iys), MATCH_BULK_SEND_CAP);
  return { property: matchProperty, plan, notMatching };
}

function countsOf(p: Planned): BulkMatchCounts {
  return { send: p.plan.send.length, overCap: p.plan.overCap.length, notMatching: p.notMatching, counts: p.plan.counts };
}

/** Onay penceresi için sayılar (gönderilecek / izni yok / engelli / telefonsuz / tavan). Hiçbir şey yazılmaz. */
export async function previewBulkMatchSend(formData: FormData): Promise<BulkMatchPreviewResult> {
  const gate = await gates();
  if ("error" in gate) return gate;
  const input = readInput(formData);
  if ("error" in input) return input;
  const supabase = await createClient();
  const [planned, smsReady] = await Promise.all([buildPlan(supabase, gate, input), isTenantSmsAvailable(gate.tenantId)]);
  if ("error" in planned) return planned;
  return { ok: true, smsReady, ...countsOf(planned) };
}

/** Gönderim: SIRAYLA, en fazla MATCH_BULK_SEND_CAP alıcı; bakiye/yapılandırma hatasında kalanlar gönderilmeden durur. */
export async function sendBulkMatchToCustomers(formData: FormData): Promise<BulkMatchSendResult> {
  const gate = await gates();
  if ("error" in gate) return gate;
  const input = readInput(formData);
  if ("error" in input) return input;
  const supabase = await createClient();
  if (!(await isTenantSmsAvailable(gate.tenantId))) {
    return { error: "SMS yapılandırması yok — Ayarlar → Entegrasyonlar bölümünden Netgsm bilgilerinizi girin." };
  }
  const planned = await buildPlan(supabase, gate, input);
  if ("error" in planned) return planned;
  if (planned.plan.send.length === 0) return { error: "Gönderilebilecek alıcı yok (izin, engel ve telefon kontrollerinden sonra)." };

  const [{ data: me }, { data: tenant }, sender] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", gate.userId).maybeSingle(),
    supabase.from("tenants").select("name").eq("id", gate.tenantId).maybeSingle(),
    prepareTenantSmsSender(gate.tenantId, { source: "match_bulk", audience: "contact" }),
  ]);
  const property = planned.property;

  let sent = 0;
  let failed = 0;
  let stoppedReason: string | null = null;
  for (const r of planned.plan.send) {
    const customerId = r.customerId as string;
    const link = await insertPropertyShareLink(supabase, {
      tenantId: gate.tenantId,
      userId: gate.userId,
      propertyId: property.id,
      label: `Eşleşme · ${r.fullName ?? "müşteri"}`,
    });
    if (!link.ok) {
      failed += 1;
      continue;
    }
    const message = buildMatchShareMessage({
      customerName: r.fullName,
      propertyTitle: property.title ?? null,
      propertyCode: property.property_code ?? null,
      listPrice: property.list_price,
      url: link.url,
      advisorName: (me?.full_name as string | null | undefined) ?? null,
      officeName: (tenant?.name as string | null | undefined) ?? null,
    });
    const res = await sender(r.phone as string, message);
    if (!res.ok) {
      failed += 1;
      if (res.code === "50" || res.code === "51") {
        stoppedReason = "SMS kredisi yetersiz — Netgsm bakiyenizi kontrol edin.";
        break;
      }
      if (res.code === "tenant_provider_unconfigured" || res.code === "provider_resolution_error") {
        stoppedReason = res.error ?? "SMS sağlayıcısı çözümlenemedi.";
        break;
      }
      continue;
    }
    sent += 1;
    await supabase.from("communications").insert({
      tenant_id: gate.tenantId,
      customer_id: customerId,
      created_by: gate.userId,
      channel: "sms",
      direction: "outbound",
      subject: "Eşleşme",
      body: message,
    });
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "match.sent",
      entityType: "customer",
      entityId: customerId,
      newValue: { demand_id: r.demandId, property_id: property.id, property_code: property.property_code, share_token: link.token, channel: "sms", bulk: true },
    });
    revalidatePath(`/app/musteriler/${customerId}`);
  }

  const counts = countsOf(planned);
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "match.bulk_sent",
    entityType: "property",
    entityId: property.id,
    newValue: { property_code: property.property_code, sent, failed, stopped: stoppedReason != null, ...counts },
  });
  revalidatePath("/app/gelen-kutusu");
  return { ok: true, sent, failed, stoppedReason, ...counts };
}
