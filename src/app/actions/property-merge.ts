"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { revalidateTenantData } from "@/lib/revalidate";
import { actionErrorMessage } from "@/lib/action-errors";
import { PROPERTY_MERGE_REF_LABELS, summarizeMergeRefs } from "@/lib/merge-labels";
import { buildFieldChoices, sanitizeOverrides, type MergeFieldChoice } from "@/lib/merge-plan";
import { getDistrictNameMap, getNeighborhoodsByIds, getProvinceNameMap } from "@/lib/geo/reader";

/**
 * Portföy birleştirme (/app/portfoyler/cift-kayit). Yazma işi TEK transaction'da `public.merge_properties`
 * (20261018010001): properties(id)'ye FK veren TÜM tablolar (medya, portal ilanları, randevu, teklif, anlaşma,
 * sözleşme, görev, fiyat/durum geçmişi, anahtar, EİDS ...) + share_links ana portföye taşınır, medya kapağı korunur,
 * alan seçimi uygulanır, boş alanlar doldurulur, kopyalar soft-delete edilir, tek audit kaydı yazılır.
 * RPC oturumlu istemciyle çağrılır (service_role yok): oturum + ofis + properties:delete gövdede yeniden doğrulanır.
 */

const MERGE_DUP_LIMIT = 10;

const PROPERTY_OVERRIDE_FIELDS: ReadonlyArray<{ field: "title" | "address_line" | "assigned_to" | "branch_id"; label: string }> = [
  { field: "title", label: "İlan başlığı" },
  { field: "address_line", label: "Adres" },
  { field: "assigned_to", label: "Danışman" },
  { field: "branch_id", label: "Şube" },
];

type PropertyMergeRow = {
  id: string;
  property_code: string;
  title: string | null;
  address_line: string | null;
  parcel_block: string | null;
  parcel_lot: string | null;
  province_id: string | null;
  district_id: string | null;
  neighborhood_id: string | null;
  lat: number | null;
  branch_id: string | null;
  assigned_to: string | null;
  owner_customer_id: string | null;
  created_at: string;
};

/** SQL doldurma listesiyle aynı sıra (ana portföyde boşsa en eski kopyadan). `ref`: kimlik, adla gösterilir. */
const FILL_FIELDS: ReadonlyArray<{ field: keyof PropertyMergeRow; label: string; ref?: boolean }> = [
  { field: "title", label: "Başlık" },
  { field: "address_line", label: "Adres" },
  { field: "parcel_block", label: "Ada" },
  { field: "parcel_lot", label: "Parsel" },
  { field: "province_id", label: "İl", ref: true },
  { field: "district_id", label: "İlçe", ref: true },
  { field: "neighborhood_id", label: "Mahalle", ref: true },
  { field: "lat", label: "Harita konumu", ref: true },
  { field: "branch_id", label: "Şube", ref: true },
  { field: "assigned_to", label: "Danışman", ref: true },
  { field: "owner_customer_id", label: "Mülk sahibi", ref: true },
];

const SELECT_COLS =
  "id, property_code, title, address_line, parcel_block, parcel_lot, province_id, district_id, neighborhood_id, lat, branch_id, assigned_to, owner_customer_id, created_at";

const txt = (v: unknown) => (v == null ? "" : String(v).trim());

function normalizeIds(primaryId: string, duplicateIds: string[]) {
  const primary = String(primaryId ?? "").trim();
  const dups = [...new Set((duplicateIds ?? []).map((s) => String(s).trim()).filter(Boolean))];
  if (!primary || dups.length === 0) return { error: "Birleştirilecek portföy seçilmedi." } as const;
  if (dups.includes(primary)) return { error: "Ana portföy kopya listesinde olamaz." } as const;
  if (dups.length > MERGE_DUP_LIMIT) return { error: `Tek seferde en fazla ${MERGE_DUP_LIMIT} portföy birleştirilebilir.` } as const;
  return { primary, dups } as const;
}

async function loadParties(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  primaryId: string,
  duplicateIds: string[],
): Promise<{ primary: PropertyMergeRow; dups: PropertyMergeRow[] } | { error: string }> {
  const { data, error } = await supabase
    .from("properties")
    .select(SELECT_COLS)
    .eq("tenant_id", tenantId)
    .in("id", [primaryId, ...duplicateIds])
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("property-merge loadParties", error.message);
    return { error: actionErrorMessage(error, "Portföyler yüklenemedi. Lütfen tekrar deneyin.") };
  }
  const rows = (data ?? []) as PropertyMergeRow[];
  const primary = rows.find((r) => r.id === primaryId);
  const dups = rows.filter((r) => duplicateIds.includes(r.id));
  if (!primary || dups.length !== duplicateIds.length) return { error: "Portföylerden bazıları bulunamadı veya silinmiş." };
  return { primary, dups };
}

/** Danışman, şube, mülk sahibi ve konum kimliklerinin adları (yalnız gösterim). */
async function loadNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  rows: PropertyMergeRow[],
): Promise<Map<string, string>> {
  const ids = (k: keyof PropertyMergeRow) => [...new Set(rows.map((r) => r[k]).filter((v): v is string => typeof v === "string" && !!v))];
  type R = { id: string; name?: string | null; full_name?: string | null };
  const none = Promise.resolve({ data: [] as R[] });
  const q = (list: string[], run: () => PromiseLike<{ data: unknown }>) => (list.length ? Promise.resolve(run()) : none);
  const adv = ids("assigned_to");
  const br = ids("branch_id");
  const own = ids("owner_customer_id");
  const pr = ids("province_id");
  const di = ids("district_id");
  const ne = ids("neighborhood_id");
  const noMap = Promise.resolve(new Map<string, string>());
  const [adR, brR, owR, prMap, diMap, neList] = await Promise.all([
    q(adv, () => supabase.from("profiles").select("id, full_name").eq("tenant_id", tenantId).in("id", adv)),
    q(br, () => supabase.from("branches").select("id, name").eq("tenant_id", tenantId).in("id", br)),
    q(own, () => supabase.from("customers").select("id, full_name").eq("tenant_id", tenantId).in("id", own)),
    pr.length ? getProvinceNameMap(pr) : noMap,
    di.length ? getDistrictNameMap(di) : noMap,
    ne.length ? getNeighborhoodsByIds(ne) : Promise.resolve([]),
  ]);
  const out = new Map<string, string>([...prMap, ...diMap, ...neList.map((n) => [n.id, n.name] as [string, string])]);
  for (const res of [adR, brR, owR]) {
    for (const r of ((res as { data: unknown }).data ?? []) as R[]) {
      const label = txt(r.full_name ?? r.name);
      if (label) out.set(r.id, label);
    }
  }
  return out;
}

export type PropertyMergePreview = {
  ok?: boolean;
  error?: string;
  counts?: Array<{ label: string; count: number }>;
  totalMoves?: number;
  filled?: Array<{ label: string; value: string }>;
  choices?: MergeFieldChoice[];
};

/** Sihirbaz önizlemesi: taşınacak bağlı kayıt sayıları (DB, tüm FK'ler), alan seçimi, doldurulacak alanlar. Yazmaz. */
export async function getPropertyMergePreview(
  primaryId: string,
  duplicateIds: string[],
  overrides?: Record<string, string>,
): Promise<PropertyMergePreview> {
  const gate = await requirePermission("properties", "delete");
  if (!gate.ok) return { error: gate.error };
  const ids = normalizeIds(primaryId, duplicateIds);
  if ("error" in ids) return { error: ids.error };
  const sel = sanitizeOverrides(overrides, PROPERTY_OVERRIDE_FIELDS.map((f) => f.field), ids.primary, ids.dups);
  if (!sel.ok) return { error: sel.error };

  const supabase = await createClient();
  const parties = await loadParties(supabase, gate.tenantId, ids.primary, ids.dups);
  if ("error" in parties) return { error: parties.error };
  const all = [parties.primary, ...parties.dups];
  const [refs, names] = await Promise.all([
    supabase.rpc("merge_preview_counts", {
      p_target: "properties",
      p_tenant_id: gate.tenantId,
      p_primary: ids.primary,
      p_duplicates: ids.dups,
    }),
    loadNames(supabase, gate.tenantId, all),
  ]);
  if (refs.error) {
    console.error("getPropertyMergePreview rpc", refs.error.message);
    return { error: "Taşınacak kayıtlar sayılamadı. Lütfen tekrar deneyin." };
  }
  const { counts, total } = summarizeMergeRefs(PROPERTY_MERGE_REF_LABELS, (refs.data as { moved?: unknown } | null)?.moved);

  const choices = buildFieldChoices(
    ids.primary,
    all.map((r) => ({
      id: r.id,
      values: Object.fromEntries(PROPERTY_OVERRIDE_FIELDS.map(({ field }) => [field, r[field]])),
      display: {
        assigned_to: r.assigned_to ? (names.get(r.assigned_to) ?? "Danışman") : null,
        branch_id: r.branch_id ? (names.get(r.branch_id) ?? "Şube") : null,
      },
    })),
    PROPERTY_OVERRIDE_FIELDS,
  );

  const effective: PropertyMergeRow = { ...parties.primary };
  for (const [field, source] of Object.entries(sel.overrides)) {
    const src = parties.dups.find((d) => d.id === source);
    if (src) (effective as Record<string, unknown>)[field] = src[field as keyof PropertyMergeRow];
  }
  const filled: Array<{ label: string; value: string }> = [];
  for (const { field, label, ref } of FILL_FIELDS) {
    if (txt(effective[field])) continue;
    const donor = parties.dups.find((d) => txt(d[field]));
    if (!donor) continue;
    const raw = txt(donor[field]);
    filled.push({ label, value: field === "lat" ? `${donor.property_code} kaydındaki nokta` : ref ? (names.get(raw) ?? "eklenecek") : raw });
  }
  return { ok: true, counts, totalMoves: total, filled, choices };
}

export type PropertyMergeResult = { ok?: boolean; error?: string; primaryId?: string; movedTotal?: number; deletedCount?: number };

/** Portföy birleştirme — geri alınamaz; tek transaction (merge_properties). */
export async function mergeProperties(
  primaryId: string,
  duplicateIds: string[],
  overrides?: Record<string, string>,
): Promise<PropertyMergeResult> {
  const gate = await requirePermission("properties", "delete");
  if (!gate.ok) return { error: gate.error };
  const ids = normalizeIds(primaryId, duplicateIds);
  if ("error" in ids) return { error: ids.error };
  const sel = sanitizeOverrides(overrides, PROPERTY_OVERRIDE_FIELDS.map((f) => f.field), ids.primary, ids.dups);
  if (!sel.ok) return { error: sel.error };

  const supabase = await createClient();
  const parties = await loadParties(supabase, gate.tenantId, ids.primary, ids.dups);
  if ("error" in parties) return { error: parties.error };

  const { data, error } = await supabase.rpc("merge_properties", {
    p_tenant_id: gate.tenantId,
    p_primary: ids.primary,
    p_duplicates: ids.dups,
    p_overrides: sel.overrides,
  });
  if (error) {
    console.error("mergeProperties rpc", error.message);
    return { error: "Birleştirme tamamlanamadı; hiçbir kayıt değişmedi. Lütfen tekrar deneyin." };
  }
  const result = (data ?? {}) as { moved_total?: number; deleted_count?: number };

  revalidatePath("/app/portfoyler");
  revalidatePath("/app/portfoyler/cift-kayit");
  revalidatePath(`/app/portfoyler/${ids.primary}`);
  revalidateTenantData(gate.tenantId);
  return { ok: true, primaryId: ids.primary, movedTotal: result.moved_total ?? 0, deletedCount: result.deleted_count ?? ids.dups.length };
}
