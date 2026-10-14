import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAllPaged } from "@/lib/supabase/read-all-paged";
import { readAdsRows } from "@/lib/google/db";
import { isChannel, type Channel } from "@/lib/measure/channel";
import {
  adsSpendByMonth,
  computeChannelRoi,
  roiWindow,
  type ChannelRoiResult,
  type PaymentInput,
  type RefundInput,
  type RoiChannel,
  type SignupInput,
  type SpendInput,
} from "./model";

/**
 * Kanal ROI SUNUCU okuyucusu (service_role; platform verisi, tek `db()` noktası). Hesap saf `model.ts`'tedir.
 * Kaynaklar: marketing_spend (adminden), ads_daily_metrics (Google Ads), tenants + signup_attributions (kayıt ve kanal),
 * invoices (status=paid, KDV hariç amount_try) ve credit_notes (net_try). Tüm okumalar sayfalıdır (1000 satır sınırı yok).
 * Bir kaynak okunamazsa sonuç `partial` taşır; ekran bunu açıkça yazar (eksik veriyle sessiz sayı yok).
 */

function db() {
  return createAdminClient();
}

const IN_CHUNK = 200;
const missing = (msg: string | null) => Boolean(msg && /does not exist|PGRST205|42P01|schema cache/i.test(msg));

export type SpendEntry = { id: string; month: string; channel: Channel; amount: number; note: string | null; updatedAt: string };
export type CohortTenant = { id: string; name: string; createdAt: string; channel: RoiChannel; payer: boolean; revenue: number };

export type ChannelRoiData = {
  months: string[];
  result: ChannelRoiResult;
  spendEntries: SpendEntry[];
  /** marketing_spend tablosu yok (migration 20261014005000 bekliyor): harcama yalnız Google Ads. */
  spendSetupPending: boolean;
  /** Google Ads verisi okunamadı ya da bağlantı/tablo yok. */
  adsAvailable: boolean;
  adsByMonth: SpendInput[];
  tenants: CohortTenant[];
  /** Okunamayan kaynaklar (ekranda uyarı). */
  partial: string[];
};

async function inChunks<T>(ids: string[], readChunk: (chunk: string[]) => Promise<{ rows: T[]; error: string | null }>): Promise<{ rows: T[]; error: string | null }> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const r = await readChunk(ids.slice(i, i + IN_CHUNK));
    if (r.error) return { rows: out, error: r.error };
    out.push(...r.rows);
  }
  return { rows: out, error: null };
}

export async function loadChannelRoi(nowMs: number, period: number): Promise<ChannelRoiData> {
  const client = db();
  const { months, startIso, startDay } = roiWindow(nowMs, period);
  const partial: string[] = [];

  type SpendRow = { id: string; month: string; channel: string; amount_try: number | string; note: string | null; updated_at: string };
  type TenantRow = { id: string; name: string; created_at: string };
  const [spendRes, adsRows, tenantsRes] = await Promise.all([
    readAllPaged<SpendRow>((from, to) =>
      client.from("marketing_spend").select("id, month, channel, amount_try, note, updated_at").gte("month", startDay).order("month", { ascending: false }).order("channel").range(from, to),
    ),
    readAdsRows(startDay),
    readAllPaged<TenantRow>((from, to) => client.from("tenants").select("id, name, created_at").gte("created_at", startIso).order("id").range(from, to)),
  ]);

  const spendSetupPending = missing(spendRes.error);
  if (spendRes.error && !spendSetupPending) partial.push("pazarlama harcaması");
  if (tenantsRes.error) partial.push("ofis kayıtları");
  const spendEntries: SpendEntry[] = spendRes.rows.flatMap((r) =>
    isChannel(r.channel) ? [{ id: r.id, month: String(r.month).slice(0, 7), channel: r.channel, amount: Number(r.amount_try) || 0, note: r.note, updatedAt: r.updated_at }] : [],
  );
  const adsByMonth = adsRows ? adsSpendByMonth(adsRows, months) : [];

  const tenants = tenantsRes.rows;
  const ids = tenants.map((t) => t.id);
  type AttrRow = { tenant_id: string; channel: string | null };
  type InvRow = { tenant_id: string; paid_at: string | null; amount_try: number | string };
  type CreditRow = { tenant_id: string; net_try: number | string };
  const [attrRes, invRes, creditRes] = await Promise.all([
    inChunks<AttrRow>(ids, (chunk) =>
      readAllPaged<AttrRow>((from, to) => client.from("signup_attributions").select("tenant_id, channel").in("tenant_id", chunk).order("tenant_id").range(from, to)),
    ),
    inChunks<InvRow>(ids, (chunk) =>
      readAllPaged<InvRow>((from, to) =>
        client.from("invoices").select("tenant_id, paid_at, amount_try").eq("status", "paid").in("tenant_id", chunk).order("id").range(from, to),
      ),
    ),
    inChunks<CreditRow>(ids, (chunk) =>
      readAllPaged<CreditRow>((from, to) => client.from("credit_notes").select("tenant_id, net_try").in("tenant_id", chunk).order("id").range(from, to)),
    ),
  ]);
  if (attrRes.error) partial.push("kayıt atfı");
  if (invRes.error) partial.push("faturalar");
  // Dekont tablosu yoksa (AD2 migration'ı bekliyor) iade düşülmez; bu bir eksik değil, iade belgesi henüz yok demektir.
  if (creditRes.error && !missing(creditRes.error)) partial.push("alacak dekontları");

  const attr = new Map<string, Channel | null>();
  for (const a of attrRes.rows) attr.set(a.tenant_id, isChannel(a.channel) ? a.channel : null);

  const signups: SignupInput[] = tenants.map((t) => ({ tenantId: t.id, channel: attr.get(t.id) ?? null, attributed: attr.has(t.id), createdAt: t.created_at }));
  const payments: PaymentInput[] = invRes.rows.flatMap((r) => (r.paid_at ? [{ tenantId: r.tenant_id, paidAt: r.paid_at, net: Number(r.amount_try) || 0 }] : []));
  const refunds: RefundInput[] = creditRes.rows.map((r) => ({ tenantId: r.tenant_id, net: Number(r.net_try) || 0 }));
  const spend: SpendInput[] = [...spendEntries.map((e) => ({ month: e.month, channel: e.channel, amount: e.amount, source: "manual" as const })), ...adsByMonth];

  const result = computeChannelRoi({ months, spend, signups, payments, refunds, nowMs });

  const revenue = new Map<string, number>();
  for (const p of payments) revenue.set(p.tenantId, (revenue.get(p.tenantId) ?? 0) + p.net);
  for (const r of refunds) if (revenue.has(r.tenantId)) revenue.set(r.tenantId, (revenue.get(r.tenantId) ?? 0) - r.net);
  const cohort: CohortTenant[] = tenants
    .map((t) => ({
      id: t.id,
      name: t.name,
      createdAt: t.created_at,
      channel: (attr.has(t.id) ? (attr.get(t.id) ?? "unknown") : "bilinmiyor") as RoiChannel,
      payer: revenue.has(t.id),
      revenue: Math.max(0, Math.round((revenue.get(t.id) ?? 0) * 100) / 100),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { months, result, spendEntries, spendSetupPending, adsAvailable: adsRows !== null, adsByMonth, tenants: cohort, partial };
}
