import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SLA_MIN, measureLead, TOUCH_CHANNELS, type LeadResponse, type TouchPoint } from "./core";

const CUSTOMER_LIMIT = 2_000;
const TOUCH_LIMIT = 10_000;

export type LoadLeadResponsesOptions = {
  tenantId: string | null;
  /** Dahil. Kayıt açılış tarihi bu aralıkta olan müşteriler ölçülür. */
  startIso: string;
  /** Hariç. */
  endIso: string;
  /** Verilirse yalnız bu danışmanlara atanmış kayıtlar (ofis geneli kapsamı olmayan rol: kendisi). */
  assignedToIn?: readonly string[] | null;
  slaMin?: number;
  nowMs: number;
};

export type LeadResponsesResult = {
  rows: LeadResponse[];
  /** Okuma hatası: sayılara güvenilmez. */
  failed: boolean;
  /** Tavana dayanıldı: sayılar eksik olabilir. */
  partial: boolean;
};

type Row = Record<string, unknown>;

/**
 * Pencere içinde açılan müşterilerin ilk yanıt ölçümü. TEK okuma yolu: danışman metrikleri
 * (`advisor-metrics.ts`), Aday Hızı raporu ve oyunlaştırma aynı hesabı kullanır.
 * Yalnız okur (RLS ile tenant'a sınırlı; tenantId verilirse ayrıca süzülür).
 */
export async function loadLeadResponses(
  supabase: SupabaseClient,
  opts: LoadLeadResponsesOptions,
): Promise<LeadResponsesResult> {
  const slaMin = opts.slaMin ?? DEFAULT_SLA_MIN;
  let cq = supabase
    .from("customers")
    .select("id, full_name, assigned_to, created_at")
    .is("deleted_at", null)
    .eq("blacklist", false)
    .gte("created_at", opts.startIso)
    .lt("created_at", opts.endIso)
    .order("created_at", { ascending: false })
    .limit(CUSTOMER_LIMIT);
  if (opts.tenantId) cq = cq.eq("tenant_id", opts.tenantId);
  if (opts.assignedToIn && opts.assignedToIn.length > 0) cq = cq.in("assigned_to", [...opts.assignedToIn]);
  const custRes = await cq;
  const customers = (custRes.data ?? []) as Row[];
  let failed = Boolean(custRes.error);
  let partial = customers.length >= CUSTOMER_LIMIT;
  if (customers.length === 0) return { rows: [], failed, partial };

  let mq = supabase
    .from("communications")
    .select("customer_id, created_at")
    .eq("direction", "outbound")
    .in("channel", [...TOUCH_CHANNELS])
    .not("customer_id", "is", null)
    .gte("created_at", opts.startIso)
    .limit(TOUCH_LIMIT);
  let kq = supabase
    .from("calls")
    .select("customer_id, started_at")
    .in("direction", ["outbound", "inbound"])
    .not("customer_id", "is", null)
    .gte("started_at", opts.startIso)
    .limit(TOUCH_LIMIT);
  if (opts.tenantId) {
    mq = mq.eq("tenant_id", opts.tenantId);
    kq = kq.eq("tenant_id", opts.tenantId);
  }
  const [commRes, callRes] = await Promise.all([mq, kq]);
  if (commRes.error || callRes.error) failed = true;
  const comms = (commRes.data ?? []) as Row[];
  const calls = (callRes.data ?? []) as Row[];
  if (comms.length >= TOUCH_LIMIT || calls.length >= TOUCH_LIMIT) partial = true;

  const touches = new Map<string, TouchPoint[]>();
  const push = (id: unknown, at: unknown, kind: TouchPoint["kind"]) => {
    if (typeof id !== "string" || typeof at !== "string") return;
    const list = touches.get(id) ?? [];
    list.push({ at, kind });
    touches.set(id, list);
  };
  for (const r of comms) push(r.customer_id, r.created_at, "comm");
  for (const r of calls) push(r.customer_id, r.started_at, "call");

  const rows: LeadResponse[] = [];
  for (const c of customers) {
    const m = measureLead(
      {
        customerId: String(c.id),
        name: String(c.full_name ?? "Müşteri"),
        assignedTo: (c.assigned_to as string | null) ?? null,
        createdAt: String(c.created_at),
      },
      touches.get(String(c.id)) ?? [],
      slaMin,
      opts.nowMs,
    );
    if (m) rows.push(m);
  }
  return { rows, failed, partial };
}
