/**
 * Tam (sayfalı, akışlı) CSV dışa aktarma. Hızlı server action'lar 2000 satırda
 * keser; burada RLS'li oturum client'ı 1000'lik `range` sayfalarıyla tüm veriyi
 * okur ve ReadableStream olarak akıtır. Yetki modülü, kolon eşlemesi ve CSV
 * kaçışı `export-entities.ts`'ten gelir; tenant + aktör kapsamı export.ts ile
 * birebir aynıdır (bkz. export-full.test.ts drift korumaları).
 */
import { applyCustomerFilters, normalizeCustomerFilters } from "@/lib/customer-list-filters";
import type { SupabaseClient } from "@supabase/supabase-js";
import { now } from "@/lib/clock";
import { hasOfficeWideDataScope } from "@/lib/permission-data-scope";
import { csvLine, type ExportEntityDef, type NameMap, type RawRow } from "@/lib/export-entities";

export const FULL_EXPORT_PAGE_SIZE = 1000;
/** Güvenlik üst sınırı: tek indirmede en fazla satır. */
export const FULL_EXPORT_MAX_ROWS = 200_000;
/** Güvenlik üst sınırı: tek indirmenin en fazla süresi (ms). */
export const FULL_EXPORT_MAX_MS = 50_000; // route maxDuration = 60 sn'nin altında

export type ExportGate = {
  tenantId: string;
  userId: string;
  role: string;
  /** `earnings_all` izni: yoksa komisyon/denetim dışa aktarması yalnız kendi kapsamıdır (B1). */
  seeAllEarnings?: boolean;
};

type PageResult = PromiseLike<{ data: unknown[] | null; error: unknown }>;
/** `.range()` çağrılabilir sorgu (PostgREST builder). */
export type PagedQuery = { range: (from: number, to: number) => PageResult };
/** `params`: tam dışa aktarma isteğinin URL parametreleri (ekran filtresi; yalnız filtre destekleyen varlıklar okur). */
type Builder = (sb: SupabaseClient, gate: ExportGate, params?: URLSearchParams) => PagedQuery;

/** Sayfalar arası kayma/yinelenmeyi önlemek için ikincil sıra anahtarı `id`. */
const ID_ORDER = { ascending: true } as const;

export const EXPORT_QUERIES: Record<string, Builder> = {
  musteriler: (sb, gate, params) => {
    const query = sb
      .from("customers")
      .select("full_name, phone, email, customer_types, tags, source, created_at")
      .eq("tenant_id", gate.tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", ID_ORDER);
    // Ekrandaki müşteri filtresi (ortak kurucu: src/lib/customer-list-filters.ts)
    let q = params ? applyCustomerFilters(query, normalizeCustomerFilters(Object.fromEntries(params))) : query;
    if (!hasOfficeWideDataScope(gate.role)) q = q.eq("assigned_to", gate.userId);
    return q;
  },
  komisyonlar: (sb, gate) => {
    let q = sb
      .from("commissions")
      .select("gross_amount, vat_amount, status, created_at, deal:deals!commissions_deal_id_fkey!inner(tenant_id, assigned_to)")
      .eq("tenant_id", gate.tenantId)
      .eq("deal.tenant_id", gate.tenantId)
      .order("created_at", { ascending: false })
      .order("id", ID_ORDER);
    if (!hasOfficeWideDataScope(gate.role) || !gate.seeAllEarnings) q = q.eq("deal.assigned_to", gate.userId);
    return q;
  },
  denetim: (sb, gate) => {
    let q = sb
      .from("audit_logs")
      .select("action, entity_type, entity_id, actor_id, old_value, new_value, created_at")
      .eq("tenant_id", gate.tenantId)
      .order("created_at", { ascending: false })
      .order("id", ID_ORDER);
    if (!hasOfficeWideDataScope(gate.role) || !gate.seeAllEarnings) q = q.eq("actor_id", gate.userId);
    return q;
  },
  portfoyler: (sb, gate) => {
    let q = sb
      .from("properties")
      .select(
        "property_code, title, transaction_type, property_type, status, list_price, assigned_to, created_at, province:geo_provinces(name), district:geo_districts(name)",
      )
      .eq("tenant_id", gate.tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", ID_ORDER);
    if (!hasOfficeWideDataScope(gate.role)) q = q.eq("assigned_to", gate.userId);
    return q;
  },
  giderler: (sb, gate) => {
    let q = sb
      .from("expenses")
      .select("title, amount, category, expense_date, notes, created_at")
      .eq("tenant_id", gate.tenantId)
      .order("expense_date", { ascending: false })
      .order("id", ID_ORDER);
    if (!hasOfficeWideDataScope(gate.role)) q = q.eq("created_by", gate.userId);
    return q;
  },
  teklifler: (sb, gate) => {
    let q = sb
      .from("offers")
      .select(
        "amount, counter_amount, status, created_at, property:properties!offers_property_id_fkey(property_code, title, tenant_id), customer:customers!offers_customer_id_fkey(full_name, tenant_id)",
      )
      .eq("tenant_id", gate.tenantId)
      .eq("property.tenant_id", gate.tenantId)
      .eq("customer.tenant_id", gate.tenantId)
      .order("created_at", { ascending: false })
      .order("id", ID_ORDER);
    if (!hasOfficeWideDataScope(gate.role)) q = q.eq("created_by", gate.userId);
    return q;
  },
  "portal-ilanlari": (sb, gate) => {
    let q = sb
      .from("portal_listings")
      .select(
        "portal_name, portal_listing_id, status, last_confirmed_at, property:properties!portal_listings_property_id_fkey!inner(property_code, tenant_id, assigned_to)",
      )
      .eq("tenant_id", gate.tenantId)
      .eq("property.tenant_id", gate.tenantId)
      .order("created_at", { ascending: false })
      .order("id", ID_ORDER);
    if (!hasOfficeWideDataScope(gate.role)) q = q.eq("property.assigned_to", gate.userId);
    return q;
  },
  // Tam dışa aktarmada ekran filtresi yok: durumdan bağımsız tüm talepler (kapalılar dâhil).
  talepler: (sb, gate) => {
    let q = sb
      .from("customer_demands")
      .select(
        "transaction_type, property_type, budget_min, budget_max, rooms, min_sqm, urgency, status, created_at, customer:customers!customer_demands_customer_id_fkey!inner(full_name, tenant_id, assigned_to), province:geo_provinces(name)",
      )
      .eq("tenant_id", gate.tenantId)
      .eq("customer.tenant_id", gate.tenantId);
    if (!hasOfficeWideDataScope(gate.role)) q = q.eq("customer.assigned_to", gate.userId);
    return q.order("created_at", { ascending: false }).order("id", ID_ORDER);
  },
  randevular: (sb, gate) => {
    let q = sb
      .from("appointments")
      .select(
        "appointment_type, scheduled_at, duration_min, location, status, customer:customers!appointments_customer_id_fkey(full_name, tenant_id), property:properties!appointments_property_id_fkey(property_code, title, tenant_id)",
      )
      .eq("tenant_id", gate.tenantId)
      .eq("customer.tenant_id", gate.tenantId)
      .eq("property.tenant_id", gate.tenantId)
      .neq("status", "cancelled");
    if (!hasOfficeWideDataScope(gate.role)) q = q.eq("assigned_to", gate.userId);
    return q.order("scheduled_at", { ascending: false }).order("id", ID_ORDER);
  },
  anlasmalar: (sb, gate) => {
    let q = sb
      .from("deals")
      .select(
        "stage, deal_type, deal_value, probability, updated_at, property:properties!deals_property_id_fkey(property_code, title, tenant_id), customer:customers!deals_customer_id_fkey(full_name, tenant_id)",
      )
      .eq("tenant_id", gate.tenantId)
      .eq("property.tenant_id", gate.tenantId)
      .eq("customer.tenant_id", gate.tenantId)
      .order("updated_at", { ascending: false })
      .order("id", ID_ORDER);
    if (!hasOfficeWideDataScope(gate.role)) q = q.eq("assigned_to", gate.userId);
    return q;
  },
  projeler: (sb, gate) => {
    let q = sb
      .from("projects")
      .select("name, developer_name, location, status, delivery_date, created_at, units:project_units!project_units_project_id_fkey(status)")
      .eq("tenant_id", gate.tenantId)
      .eq("units.tenant_id", gate.tenantId);
    if (!hasOfficeWideDataScope(gate.role)) q = q.eq("created_by", gate.userId);
    return q.order("created_at", { ascending: false }).order("id", ID_ORDER);
  },
  aidatlar: (sb, gate) => {
    let q = sb
      .from("property_dues")
      .select("title, amount, period, due_date, status, paid_at, property:properties!property_dues_property_id_fkey(property_code, title, tenant_id)")
      .eq("tenant_id", gate.tenantId)
      .eq("property.tenant_id", gate.tenantId)
      .order("period", { ascending: false })
      .order("id", ID_ORDER);
    if (!hasOfficeWideDataScope(gate.role)) q = q.eq("created_by", gate.userId);
    return q;
  },
  sozlesmeler: (sb, gate) => {
    let q = sb
      .from("contracts")
      .select(
        "title, contract_type, status, created_at, signed_at, expires_at, property:properties!contracts_property_id_fkey(property_code, title, tenant_id), customer:customers!contracts_customer_id_fkey(full_name, tenant_id)",
      )
      .eq("tenant_id", gate.tenantId)
      .eq("property.tenant_id", gate.tenantId)
      .eq("customer.tenant_id", gate.tenantId)
      .order("created_at", { ascending: false })
      .order("id", ID_ORDER);
    if (!hasOfficeWideDataScope(gate.role)) q = q.eq("created_by", gate.userId);
    return q;
  },
  tavsiyeler: (sb, gate) => {
    let q = sb
      .from("referrals")
      .select(
        "referred_name, referred_phone, referred_note, staff_note, status, created_at, referrer:customers!referrals_referrer_customer_id_fkey(full_name, tenant_id)",
      )
      .eq("tenant_id", gate.tenantId)
      .eq("referrer.tenant_id", gate.tenantId)
      .order("created_at", { ascending: false })
      .order("id", ID_ORDER);
    if (!hasOfficeWideDataScope(gate.role)) q = q.eq("handled_by", gate.userId);
    return q;
  },
};

export type FullExportSummary = {
  rows: number;
  truncated: boolean;
  /** "rows" | "time" sınırı, "error" sayfa hatası, "aborted" istemci iptali. */
  stopReason: "rows" | "time" | "error" | "aborted" | null;
};

export type FullExportOptions = {
  supabase: SupabaseClient;
  gate: ExportGate;
  def: ExportEntityDef;
  buildQuery: Builder;
  /** İstek URL parametreleri (ekran filtresi) — buildQuery'ye iletilir. */
  params?: URLSearchParams;
  maxRows?: number;
  maxMs?: number;
  pageSize?: number;
  /** Akış bitince (tamam/sınır/hata/iptal) tam bir kez çağrılır — audit için. */
  onDone?: (summary: FullExportSummary) => void | Promise<void>;
};

const BOM = "﻿";

async function resolveNames(
  sb: SupabaseClient,
  gate: ExportGate,
  def: ExportEntityDef,
  rows: RawRow[],
  cache: NameMap,
): Promise<void> {
  if (!def.nameId) return;
  const ids = [...new Set(rows.map((r) => def.nameId!(r)).filter((v): v is string => !!v && !cache.has(v)))];
  if (ids.length === 0) return;
  const { data } = await sb.from("profiles").select("id, full_name").eq("tenant_id", gate.tenantId).in("id", ids);
  for (const p of (data ?? []) as { id: string; full_name: string }[]) cache.set(p.id, p.full_name);
}

/**
 * İlk sayfa EAGER okunur: başlangıç hatası 500 olarak dönebilsin (başlıklar
 * gönderilmeden). Sonraki sayfalar `pull` ile istemci okudukça çekilir.
 */
export async function openFullCsvStream(
  opts: FullExportOptions,
): Promise<{ ok: true; stream: ReadableStream<Uint8Array> } | { ok: false }> {
  const { supabase, gate, def, buildQuery, onDone, params } = opts;
  const maxRows = opts.maxRows ?? FULL_EXPORT_MAX_ROWS;
  const maxMs = opts.maxMs ?? FULL_EXPORT_MAX_MS;
  const pageSize = opts.pageSize ?? FULL_EXPORT_PAGE_SIZE;
  const encoder = new TextEncoder();
  const names: NameMap = new Map();
  const startedAt = now();

  const fetchPage = async (offset: number) => {
    // Her sayfa için taze builder: paylaşılan URL/parametre durumu sızmasın.
    const { data, error } = await buildQuery(supabase, gate, params).range(offset, offset + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as RawRow[];
    await resolveNames(supabase, gate, def, rows, names);
    return rows;
  };

  let firstPage: RawRow[];
  try {
    firstPage = await fetchPage(0);
  } catch (e) {
    console.error("fullExport.first", def.slug, e);
    return { ok: false };
  }

  let pending: RawRow[] | null = firstPage;
  let offset = 0;
  let total = 0;
  let headerKeys: string[] | null = null;
  let finished = false;
  let started = false;

  const finish = async (reason: FullExportSummary["stopReason"]) => {
    if (finished) return;
    finished = true;
    try {
      await onDone?.({ rows: total, truncated: reason === "rows" || reason === "time", stopReason: reason });
    } catch (e) {
      console.error("fullExport.onDone", e);
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const rows = pending ?? (await fetchPage(offset));
        pending = null;
        let out = started ? "" : BOM;
        started = true;
        const remaining = maxRows - total;
        const take = rows.length > remaining ? rows.slice(0, remaining) : rows;
        for (const r of take) {
          const mapped = def.map(r, names);
          if (!headerKeys) {
            headerKeys = Object.keys(mapped);
            out += headerKeys.join(",") + "\n";
          }
          out += csvLine(headerKeys.map((k) => mapped[k])) + "\n";
        }
        total += take.length;
        offset += rows.length;

        const hitRows = total >= maxRows && (rows.length === pageSize || rows.length > take.length);
        const hitTime = !hitRows && rows.length === pageSize && now() - startedAt > maxMs;
        if (hitRows || hitTime) {
          out += csvLine([
            hitRows
              ? `UYARI: Güvenlik sınırı nedeniyle yalnızca ilk ${total} kayıt dışa aktarıldı. Tamamı için lütfen destek ile iletişime geçin.`
              : `UYARI: Süre sınırı nedeniyle yalnızca ilk ${total} kayıt dışa aktarıldı. Tamamı için lütfen tekrar deneyin veya destek ile iletişime geçin.`,
          ]) + "\n";
        }
        if (out) controller.enqueue(encoder.encode(out));
        if (hitRows || hitTime || rows.length < pageSize) {
          controller.close();
          await finish(hitRows ? "rows" : hitTime ? "time" : null);
        }
      } catch (e) {
        console.error("fullExport.page", def.slug, e);
        // Başlıklar gönderildi: sessizce kesmek yerine dosyada açık hata satırı bırak.
        controller.enqueue(encoder.encode(csvLine(["HATA: Dışa aktarma yarıda kesildi, dosya eksik. Lütfen tekrar deneyin."]) + "\n"));
        controller.close();
        await finish("error");
      }
    },
    async cancel() {
      await finish("aborted");
    },
  });

  return { ok: true, stream };
}
