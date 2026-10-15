"use server";

import type { ActionOutcome } from "@/lib/action-outcome";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { validateTenantReferences } from "@/lib/tenant-references";
import { actionErrorMessage } from "@/lib/action-errors";
import {
  distributeInt,
  distributeMoney,
  isTargetPeriod,
  normalizePeriodStart,
  planCopy,
  previousPeriodStart,
  scopeColumns,
  type TargetPeriod,
  type TargetScope,
} from "@/lib/target-scope";

/**
 * Hedef aksiyonları (OA4; eskiden targets-openhouse-sources.ts içindeydi). Kapsam: kişi · takım · şube · ofis geneli
 * (20261018080001: team_id / branch_id, en çok biri dolu). Toplu hedef ve "geçen dönemden kopyala" idempotenttir:
 * aynı kapsam + dönem + başlangıçta hedef varsa günceller ya da atlar (çift satır üretmez).
 */

export type TargetResult = { ok?: boolean; error?: string; id?: string; created?: number; updated?: number; skipped?: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_INT = 100_000;
const MAX_BULK = 200;

type Supabase = Awaited<ReturnType<typeof createClient>>;

function intOrZero(fd: FormData, key: string) {
  const n = parseInt(String(fd.get(key) ?? "0"));
  return isNaN(n) || n < 0 ? 0 : Math.min(n, MAX_INT);
}

function moneyOrZero(fd: FormData, key: string) {
  const n = parseFloat(String(fd.get(key) ?? "0"));
  return isNaN(n) || n < 0 ? 0 : Math.min(n, 1e12);
}

/** Hedef sayıları. Faaliyet alanları formda yoksa DOKUNULMAZ (eski formlar veri silmesin). */
function parseValues(fd: FormData) {
  const activity: Record<string, number | string | null> = {};
  if (fd.has("target_appointments")) activity.target_appointments = intOrZero(fd, "target_appointments");
  if (fd.has("target_listings")) activity.target_listings = intOrZero(fd, "target_listings");
  if (fd.has("target_calls")) activity.target_calls = intOrZero(fd, "target_calls");
  if (fd.has("notes")) activity.notes = String(fd.get("notes") ?? "").trim().slice(0, 1000) || null;
  return { targetDeals: intOrZero(fd, "target_deals"), targetRevenue: moneyOrZero(fd, "target_revenue"), activity };
}

function parsePeriod(fd: FormData): { period: TargetPeriod; periodStart: string | null } {
  const raw = String(fd.get("period") ?? "monthly").trim();
  return {
    period: isTargetPeriod(raw) ? raw : "monthly",
    periodStart: normalizePeriodStart(String(fd.get("period_start") ?? "")),
  };
}

/** Formdaki kapsam: `kapsam` = kisi|takim|sube|ofis (yoksa eski davranış: profile_id doluysa kişi, değilse ofis). */
function parseScope(fd: FormData): TargetScope | { error: string } {
  const kind = String(fd.get("kapsam") ?? "").trim();
  const profileId = String(fd.get("profile_id") ?? "").trim();
  const teamId = String(fd.get("team_id") ?? "").trim();
  const branchId = String(fd.get("branch_id") ?? "").trim();
  if (kind === "takim") return UUID_RE.test(teamId) ? { kind: "takim", teamId } : { error: "Takım seçin." };
  if (kind === "sube") return UUID_RE.test(branchId) ? { kind: "sube", branchId } : { error: "Şube seçin." };
  if (kind === "ofis") return { kind: "ofis" };
  if (profileId) return UUID_RE.test(profileId) ? { kind: "kisi", profileId } : { error: "Danışman seçin." };
  return kind === "kisi" ? { error: "Danışman seçin." } : { kind: "ofis" };
}

/** Kapsam kimliği bu ofise ait mi (takım/şube RLS'li oturumla; kişi ortak kiracı denetimiyle). */
async function validateScope(supabase: Supabase, tenantId: string, scope: TargetScope): Promise<string | null> {
  if (scope.kind === "kisi") {
    const r = await validateTenantReferences(tenantId, { profileId: scope.profileId });
    return r.ok ? null : r.error;
  }
  if (scope.kind === "takim") {
    const { data } = await supabase.from("teams").select("id").eq("id", scope.teamId).eq("tenant_id", tenantId).maybeSingle();
    return data ? null : "Seçilen takım bulunamadı.";
  }
  if (scope.kind === "sube") {
    const { data } = await supabase.from("branches").select("id").eq("id", scope.branchId).eq("tenant_id", tenantId).maybeSingle();
    return data ? null : "Seçilen şube bulunamadı.";
  }
  return null;
}

function duplicateError(code: string | null | undefined) {
  return code === "23505" ? "Bu kapsam ve dönem için zaten bir hedef tanımlı; mevcut hedefi düzenleyin." : null;
}

function revalidateTargets() {
  revalidatePath("/app/hedefler");
  revalidatePath("/app/danisman-kpi");
  revalidatePath("/app");
}

export async function createTarget(_prev: TargetResult, fd: FormData): Promise<TargetResult> {
  const gate = await requirePermission("targets", "create");
  if (!gate.ok) return { error: gate.error };

  const { period, periodStart } = parsePeriod(fd);
  if (!periodStart) return { error: "Dönem başlangıcı zorunludur." };
  const scope = parseScope(fd);
  if ("error" in scope) return { error: scope.error };
  const supabase = await createClient();
  const scopeError = await validateScope(supabase, gate.tenantId, scope);
  if (scopeError) return { error: scopeError };
  const v = parseValues(fd);

  const { data, error } = await supabase
    .from("targets")
    .insert({
      tenant_id: gate.tenantId,
      ...scopeColumns(scope),
      period,
      period_start: periodStart,
      target_deals: v.targetDeals,
      target_revenue: v.targetRevenue,
      ...v.activity,
    })
    .select("id")
    .single();

  if (error || !data) return { error: duplicateError(error?.code) ?? actionErrorMessage(error, "Hedef oluşturulamadı.") };
  revalidateTargets();
  return { ok: true, id: data.id };
}

export async function updateTarget(_prev: TargetResult, fd: FormData): Promise<TargetResult> {
  const gate = await requirePermission("targets", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "Hedef bulunamadı." };
  const { period, periodStart } = parsePeriod(fd);
  if (!periodStart) return { error: "Dönem başlangıcı zorunludur." };
  const scope = parseScope(fd);
  if ("error" in scope) return { error: scope.error };
  const supabase = await createClient();
  const scopeError = await validateScope(supabase, gate.tenantId, scope);
  if (scopeError) return { error: scopeError };
  const v = parseValues(fd);

  const { error } = await supabase
    .from("targets")
    .update({
      ...scopeColumns(scope),
      period,
      period_start: periodStart,
      target_deals: v.targetDeals,
      target_revenue: v.targetRevenue,
      ...v.activity,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) return { error: duplicateError(error.code) ?? actionErrorMessage(error, "Hedef güncellenemedi.") };
  revalidateTargets();
  return { ok: true, id };
}

/**
 * Toplu kişi hedefi: seçili danışmanlara (ya da tüm aktif danışmanlara) AYNI değer ya da ofis toplamını EŞİT dağıtma.
 * `dagitim` = "ayni" | "esit". Aynı dönem + başlangıçta kişinin hedefi varsa güncellenir (idempotent).
 */
export async function createTargetsBulk(_prev: TargetResult, fd: FormData): Promise<TargetResult> {
  const gate = await requirePermission("targets", "create");
  if (!gate.ok) return { error: gate.error };
  const { period, periodStart } = parsePeriod(fd);
  if (!periodStart) return { error: "Dönem başlangıcı zorunludur." };
  const supabase = await createClient();

  const all = String(fd.get("tum") ?? "") === "1";
  const picked = [...new Set(fd.getAll("profile_ids").map((v) => String(v).trim()).filter((v) => UUID_RE.test(v)))].slice(0, MAX_BULK);
  let q = supabase.from("profiles").select("id").eq("tenant_id", gate.tenantId).eq("is_active", true).limit(MAX_BULK);
  if (!all) {
    if (picked.length === 0) return { error: "En az bir danışman seçin." };
    q = q.in("id", picked);
  } else {
    q = q.in("role", ["advisor", "team_lead", "branch_manager"]);
  }
  const { data: profRows, error: profErr } = await q;
  if (profErr) return { error: actionErrorMessage(profErr, "Danışmanlar okunamadı.") };
  const ids = ((profRows ?? []) as { id: string }[]).map((r) => String(r.id)).sort();
  if (ids.length === 0) return { error: "Seçilen danışmanlar bu ofiste bulunamadı." };
  if (!all && ids.length !== picked.length) return { error: "Seçilen danışmanlardan bazıları bu ofiste bulunamadı." };

  const v = parseValues(fd);
  const equalSplit = String(fd.get("dagitim") ?? "ayni") === "esit";
  const deals = equalSplit ? distributeInt(v.targetDeals, ids.length) : ids.map(() => v.targetDeals);
  const revenue = equalSplit ? distributeMoney(v.targetRevenue, ids.length) : ids.map(() => v.targetRevenue);
  const intField = (k: string) => {
    const n = Number(v.activity[k] ?? 0);
    return equalSplit ? distributeInt(n, ids.length) : ids.map(() => n);
  };
  const appts = intField("target_appointments");
  const listings = intField("target_listings");
  const calls = intField("target_calls");

  const { data: existing, error: exErr } = await supabase
    .from("targets")
    .select("id, profile_id")
    .eq("tenant_id", gate.tenantId)
    .eq("period", period)
    .eq("period_start", periodStart)
    .in("profile_id", ids);
  if (exErr) return { error: actionErrorMessage(exErr, "Mevcut hedefler okunamadı.") };
  const existingBy = new Map(((existing ?? []) as { id: string; profile_id: string }[]).map((r) => [r.profile_id, r.id]));

  const notes = v.activity.notes ?? null;
  const rowOf = (i: number) => ({
    target_deals: deals[i],
    target_revenue: revenue[i],
    target_appointments: appts[i],
    target_listings: listings[i],
    target_calls: calls[i],
    notes,
  });
  const inserts = ids
    .map((pid, i) => ({ pid, i }))
    .filter(({ pid }) => !existingBy.has(pid))
    .map(({ pid, i }) => ({ tenant_id: gate.tenantId, profile_id: pid, team_id: null, branch_id: null, period, period_start: periodStart, ...rowOf(i) }));
  const updates = ids.map((pid, i) => ({ id: existingBy.get(pid), i })).filter((u): u is { id: string; i: number } => Boolean(u.id));

  if (inserts.length > 0) {
    const { error } = await supabase.from("targets").insert(inserts);
    if (error) return { error: duplicateError(error.code) ?? actionErrorMessage(error, "Hedefler oluşturulamadı.") };
  }
  if (updates.length > 0) {
    const stamp = new Date().toISOString();
    const results = await Promise.all(
      updates.map((u) => supabase.from("targets").update({ ...rowOf(u.i), updated_at: stamp }).eq("id", u.id).eq("tenant_id", gate.tenantId)),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) return { error: actionErrorMessage(failed.error, "Mevcut hedefler güncellenemedi.") };
  }
  revalidateTargets();
  return { ok: true, created: inserts.length, updated: updates.length };
}

/**
 * Geçen dönemin hedeflerini (tüm kapsamlar) seçili döneme kopyalar. Seçili dönemde aynı kapsamın hedefi varsa atlanır.
 * Notlar kopyalanmaz (dönem özeldir).
 */
export async function copyTargetsFromPrevious(_prev: TargetResult, fd: FormData): Promise<TargetResult> {
  const gate = await requirePermission("targets", "create");
  if (!gate.ok) return { error: gate.error };
  const { period, periodStart } = parsePeriod(fd);
  if (!periodStart) return { error: "Dönem başlangıcı zorunludur." };
  const prevStart = previousPeriodStart(period, periodStart);
  if (!prevStart) return { error: "Önceki dönem hesaplanamadı." };
  const supabase = await createClient();
  const cols = "profile_id, team_id, branch_id, target_deals, target_revenue, target_appointments, target_listings, target_calls";
  const [prevRes, curRes] = await Promise.all([
    supabase.from("targets").select(cols).eq("tenant_id", gate.tenantId).eq("period", period).eq("period_start", prevStart).limit(500),
    supabase.from("targets").select("profile_id, team_id, branch_id").eq("tenant_id", gate.tenantId).eq("period", period).eq("period_start", periodStart).limit(500),
  ]);
  if (prevRes.error || curRes.error) return { error: actionErrorMessage(prevRes.error ?? curRes.error, "Hedefler okunamadı.") };
  type Row = {
    profile_id: string | null;
    team_id: string | null;
    branch_id: string | null;
    target_deals: number;
    target_revenue: number;
    target_appointments: number | null;
    target_listings: number | null;
    target_calls: number | null;
  };
  const previous = (prevRes.data ?? []) as Row[];
  if (previous.length === 0) return { error: "Önceki dönemde kopyalanacak hedef yok." };
  const { copy, skipped } = planCopy(previous, (curRes.data ?? []) as Row[]);
  if (copy.length > 0) {
    const { error } = await supabase.from("targets").insert(
      copy.map((r) => ({
        tenant_id: gate.tenantId,
        profile_id: r.profile_id,
        team_id: r.team_id,
        branch_id: r.branch_id,
        period,
        period_start: periodStart,
        target_deals: r.target_deals ?? 0,
        target_revenue: r.target_revenue ?? 0,
        target_appointments: r.target_appointments ?? 0,
        target_listings: r.target_listings ?? 0,
        target_calls: r.target_calls ?? 0,
      })),
    );
    if (error) return { error: duplicateError(error.code) ?? actionErrorMessage(error, "Hedefler kopyalanamadı.") };
  }
  revalidateTargets();
  return { ok: true, created: copy.length, skipped };
}

/** ConfirmDialog `formAction` deseniyle uyumlu silme (bkz. `deleteTask`). */
export async function deleteTarget(formData: FormData): Promise<ActionOutcome> {
  const gate = await requirePermission("targets", "delete");
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Hedef bulunamadı." };

  const supabase = await createClient();
  const { error } = await supabase.from("targets").delete().eq("id", id).eq("tenant_id", gate.tenantId);
  if (error) return { error: actionErrorMessage(error, "Hedef silinemedi.") };
  revalidateTargets();
  return { ok: true };
}

export async function listTargets(period?: string) {
  const gate = await requirePermission("targets", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  let query = supabase
    .from("targets")
    .select(
      "id, period, period_start, target_deals, target_revenue, target_appointments, target_listings, target_calls, notes, team_id, branch_id, profile:profiles!targets_profile_id_fkey(id, full_name), team:teams!targets_team_id_fkey(id, name), branch:branches!targets_branch_id_fkey(id, name)",
    )
    .eq("tenant_id", gate.tenantId)
    .order("period_start", { ascending: false })
    .limit(100);

  if (period) query = query.eq("period", period);

  const { data } = await query;
  return data ?? [];
}
