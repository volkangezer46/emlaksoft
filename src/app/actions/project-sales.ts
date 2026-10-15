"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { getBaseUrl } from "@/lib/base-url";
import { verifyImageFile } from "@/lib/file-validation";
import { formatPhoneDisplay } from "@/lib/phone";
import { buildShareHref, whatsappShareGate, type ConsentStatus } from "@/lib/whatsapp-share";
import { sanitizeImportRows } from "@/lib/projects/unit-import";
import {
  PROJECT_MEDIA_BUCKET,
  PROJECT_MEDIA_LIMIT,
  PROJECT_MEDIA_MAX_BYTES,
  isMissingSchemaError,
} from "@/lib/projects/project-media";
import { newProjectShareToken } from "@/lib/projects/project-share";

/**
 * Proje satış araçları (PF-04/05/06): toplu fiyat güncelleme + geri al, fiyat listesi aktarımı, fiyat geçmişi,
 * paylaşım sayfası, galeri ve uygun alıcıya WhatsApp. Her eylem `requirePermission("projects", …)`; DB tarafı RPC'ler
 * kiracı + yetkiyi ayrıca doğrular. Şema yoksa (migration bekliyor) "etkin değil" der, sessizce bozulmaz.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_READY = "Bu özellik bu ortamda henüz etkin değil (veritabanı güncellemesi bekleniyor).";
const RPC_MISSING = new Set(["42883", "PGRST202"]);

const notReady = (error: { code?: string } | null | undefined) =>
  Boolean(error?.code && (RPC_MISSING.has(error.code) || isMissingSchemaError(error)));

function revalidateProject(projectId: string) {
  revalidatePath(`/app/projeler/${projectId}`);
  revalidatePath("/app/projeler");
}

// ============================================================
// PF-05 — Toplu fiyat güncelleme (% / tutar) + 10 dk geri al
// ============================================================

export type RepriceResult = {
  ok?: boolean;
  error?: string;
  batchId?: string;
  updated?: number;
  oldTotal?: number;
  newTotal?: number;
};

export async function repriceProjectUnits(input: {
  projectId: string;
  unitIds: string[];
  mode: "pct" | "fixed";
  value: number;
  roundTo: number;
  reason?: string | null;
}): Promise<RepriceResult> {
  const gate = await requirePermission("projects", "edit");
  if (!gate.ok) return { error: gate.error };
  const projectId = String(input?.projectId ?? "");
  if (!UUID_RE.test(projectId)) return { error: "Proje bulunamadı." };
  const unitIds = Array.isArray(input?.unitIds) ? Array.from(new Set(input.unitIds.filter((x) => typeof x === "string" && UUID_RE.test(x)))) : [];
  if (unitIds.length === 0) return { error: "Güncellenecek daire seçin." };
  if (unitIds.length > 1000) return { error: "Tek seferde en fazla 1000 daire güncellenebilir." };
  const mode = input?.mode === "fixed" ? "fixed" : "pct";
  const value = Number(input?.value);
  if (!Number.isFinite(value) || value === 0) return { error: "Geçerli bir oran ya da tutar girin." };
  if (mode === "pct" && (value < -50 || value > 200)) return { error: "Oran %-50 ile %200 arasında olmalı." };
  const roundTo = [0, 100, 1000, 5000, 10000, 50000, 100000].includes(Number(input?.roundTo)) ? Number(input.roundTo) : 0;
  const reason = String(input?.reason ?? "").trim().slice(0, 200) || null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bulk_reprice_project_units", {
    p_project_id: projectId,
    p_unit_ids: unitIds,
    p_mode: mode,
    p_value: value,
    p_round_to: roundTo,
    p_reason: reason,
  });
  if (error) {
    if (notReady(error)) return { error: NOT_READY };
    console.error("repriceProjectUnits", { code: error.code });
    return { error: actionErrorMessage(error, "Fiyatlar güncellenemedi.") };
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { batch_id: string; updated_count: number; old_total: number | string; new_total: number | string }
    | null;
  const updated = Number(row?.updated_count ?? 0);
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "project_unit.bulk_reprice",
    entityType: "project",
    entityId: projectId,
    newValue: { mode, value, round_to: roundTo, reason, selected: unitIds.length, updated, batch_id: row?.batch_id ?? null },
  });
  revalidateProject(projectId);
  return {
    ok: true,
    batchId: row?.batch_id,
    updated,
    oldTotal: Number(row?.old_total ?? 0),
    newTotal: Number(row?.new_total ?? 0),
  };
}

export async function undoProjectReprice(projectId: string, batchId: string): Promise<{ ok?: boolean; error?: string; restored?: number }> {
  const gate = await requirePermission("projects", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(projectId ?? "")) || !UUID_RE.test(String(batchId ?? ""))) return { error: "Geri alınacak işlem bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("undo_project_unit_reprice", { p_batch_id: batchId });
  if (error) {
    if (notReady(error)) return { error: NOT_READY };
    console.error("undoProjectReprice", { code: error.code });
    return { error: actionErrorMessage(error, "Geri alınamadı.") };
  }
  const restored = Number(data ?? 0);
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "project_unit.bulk_reprice_undo",
    entityType: "project",
    entityId: projectId,
    newValue: { batch_id: batchId, restored },
  });
  revalidateProject(projectId);
  return { ok: true, restored };
}

// ============================================================
// PF-05 — Fiyat listesi aktarımı (Excel / CSV)
// ============================================================

export async function importProjectUnitRows(
  projectId: string,
  rows: unknown,
): Promise<{ ok?: boolean; error?: string; created?: number; updated?: number; skipped?: number }> {
  const gate = await requirePermission("projects", "create");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(projectId ?? ""))) return { error: "Proje bulunamadı." };
  const clean = sanitizeImportRows(rows);
  if (clean.length === 0) return { error: "Aktarılacak geçerli satır yok." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_project_units", { p_project_id: projectId, p_rows: clean });
  if (error) {
    if (notReady(error)) return { error: NOT_READY };
    console.error("importProjectUnitRows", { code: error.code });
    return { error: actionErrorMessage(error, "Fiyat listesi aktarılamadı.") };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { created_count: number; updated_count: number; skipped_count: number } | null;
  const result = { created: Number(row?.created_count ?? 0), updated: Number(row?.updated_count ?? 0), skipped: Number(row?.skipped_count ?? 0) };
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "project_unit.import",
    entityType: "project",
    entityId: projectId,
    newValue: { rows: clean.length, ...result },
  });
  revalidateProject(projectId);
  return { ok: true, ...result };
}

// ============================================================
// PF-05 — Daire fiyat geçmişi
// ============================================================

export type UnitPriceHistoryRow = {
  id: string;
  old_price: number | null;
  new_price: number | null;
  reason: string | null;
  created_at: string;
  actor: string | null;
};

export async function listUnitPriceHistory(unitId: string): Promise<{ available: boolean; rows: UnitPriceHistoryRow[] }> {
  const gate = await requirePermission("projects", "view");
  if (!gate.ok || !UUID_RE.test(String(unitId ?? ""))) return { available: true, rows: [] };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_unit_price_history")
    .select("id, old_price, new_price, reason, created_at, changed_by")
    .eq("tenant_id", gate.tenantId)
    .eq("unit_id", unitId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) {
    if (!isMissingSchemaError(error)) console.error("listUnitPriceHistory", { code: error.code });
    return { available: !isMissingSchemaError(error), rows: [] };
  }
  const rows = (data ?? []) as Array<{ id: string; old_price: number | string | null; new_price: number | string | null; reason: string | null; created_at: string; changed_by: string | null }>;
  const actorIds = Array.from(new Set(rows.map((r) => r.changed_by).filter((x): x is string => Boolean(x))));
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", actorIds);
    for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) if (p.full_name) names.set(p.id, p.full_name);
  }
  return {
    available: true,
    rows: rows.map((r) => ({
      id: r.id,
      old_price: r.old_price != null ? Number(r.old_price) : null,
      new_price: r.new_price != null ? Number(r.new_price) : null,
      reason: r.reason,
      created_at: r.created_at,
      actor: r.changed_by ? names.get(r.changed_by) ?? null : null,
    })),
  };
}

// ============================================================
// PF-04 — Paylaşım sayfası (/proje/[token])
// ============================================================

export type ProjectShareResult = { ok?: boolean; error?: string; url?: string | null; enabled?: boolean };

export async function saveProjectShare(
  projectId: string,
  input: { enabled: boolean; showPrices: boolean },
): Promise<ProjectShareResult> {
  const gate = await requirePermission("projects", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(projectId ?? ""))) return { error: "Proje bulunamadı." };
  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from("projects")
    .select("id, share_token, shared_at")
    .eq("id", projectId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (readError) {
    if (notReady(readError)) return { error: NOT_READY };
    return { error: actionErrorMessage(readError, "Paylaşım ayarı okunamadı.") };
  }
  if (!current) return { error: "Proje bulunamadı." };
  const enabled = input?.enabled === true;
  const token = (current.share_token as string | null) ?? (enabled ? newProjectShareToken() : null);
  const { error } = await supabase
    .from("projects")
    .update({
      share_enabled: enabled,
      share_show_prices: input?.showPrices !== false,
      share_token: token,
      shared_at: enabled && !current.shared_at ? new Date().toISOString() : current.shared_at,
    })
    .eq("id", projectId)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    if (notReady(error)) return { error: NOT_READY };
    console.error("saveProjectShare", { code: error.code });
    return { error: actionErrorMessage(error, "Paylaşım ayarı kaydedilemedi.") };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: enabled ? "project.share" : "project.unshare",
    entityType: "project",
    entityId: projectId,
    newValue: { enabled, show_prices: input?.showPrices !== false },
  });
  revalidateProject(projectId);
  return { ok: true, enabled, url: enabled && token ? `${getBaseUrl()}/proje/${token}` : null };
}

/** Linki yeniler: eski bağlantı anında geçersiz olur (müşteriye gönderilmiş link ölür). */
export async function regenerateProjectShareLink(projectId: string): Promise<ProjectShareResult> {
  const gate = await requirePermission("projects", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(projectId ?? ""))) return { error: "Proje bulunamadı." };
  const token = newProjectShareToken();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .update({ share_token: token })
    .eq("id", projectId)
    .eq("tenant_id", gate.tenantId)
    .select("share_enabled")
    .maybeSingle();
  if (error) {
    if (notReady(error)) return { error: NOT_READY };
    return { error: actionErrorMessage(error, "Bağlantı yenilenemedi.") };
  }
  if (!data) return { error: "Proje bulunamadı." };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "project.share_rotate", entityType: "project", entityId: projectId });
  revalidateProject(projectId);
  return { ok: true, enabled: Boolean(data.share_enabled), url: `${getBaseUrl()}/proje/${token}` };
}

// ============================================================
// PF-04 — Galeri (özel kova; yükleme sunucuda doğrulanır)
// ============================================================

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

async function projectOfTenant(tenantId: string, projectId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select("id").eq("id", projectId).eq("tenant_id", tenantId).maybeSingle();
  return Boolean(data);
}

/** Tek görsel yükler (istemci önce ≤1920 px JPEG'e küçültür). İçerik imzası sunucuda doğrulanır. */
export async function uploadProjectMedia(formData: FormData): Promise<{ ok?: boolean; error?: string; id?: string }> {
  const gate = await requirePermission("projects", "edit");
  if (!gate.ok) return { error: gate.error };
  const projectId = String(formData.get("project_id") ?? "");
  if (!UUID_RE.test(projectId) || !(await projectOfTenant(gate.tenantId, projectId))) return { error: "Proje bulunamadı." };
  const kind = formData.get("kind") === "floorplan" ? "floorplan" : "image";
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Görsel seçin." };
  if (file.size > PROJECT_MEDIA_MAX_BYTES) return { error: "Görsel en fazla 3 MB olabilir." };
  const verified = await verifyImageFile(file, IMAGE_TYPES);
  if (!verified.ok) return { error: verified.error };
  const width = Math.round(Number(formData.get("width")));
  const height = Math.round(Number(formData.get("height")));

  const admin = createAdminClient();
  const { count, error: countError } = await admin
    .from("project_media")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", gate.tenantId)
    .eq("project_id", projectId);
  if (countError) {
    if (notReady(countError)) return { error: NOT_READY };
    return { error: actionErrorMessage(countError, "Galeri okunamadı.") };
  }
  if ((count ?? 0) >= PROJECT_MEDIA_LIMIT) return { error: `Bir projeye en fazla ${PROJECT_MEDIA_LIMIT} görsel eklenebilir.` };

  const ext = verified.type === "image/png" ? "png" : verified.type === "image/webp" ? "webp" : "jpg";
  const path = `${gate.tenantId}/${projectId}/${randomUUID()}.${ext}`;
  const { error: upError } = await admin.storage
    .from(PROJECT_MEDIA_BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: verified.type, upsert: false });
  if (upError) {
    console.error("uploadProjectMedia storage", { name: upError.name });
    return { error: "Görsel yüklenemedi. Birkaç saniye sonra yeniden deneyin." };
  }
  const { data, error } = await admin
    .from("project_media")
    .insert({
      tenant_id: gate.tenantId,
      project_id: projectId,
      kind,
      storage_path: path,
      sort_order: count ?? 0,
      is_cover: (count ?? 0) === 0 && kind === "image",
      width: Number.isFinite(width) && width > 0 && width <= 100_000 ? width : null,
      height: Number.isFinite(height) && height > 0 && height <= 100_000 ? height : null,
      uploaded_by: gate.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    await admin.storage.from(PROJECT_MEDIA_BUCKET).remove([path]);
    console.error("uploadProjectMedia row", { code: error?.code });
    return { error: actionErrorMessage(error, "Görsel kaydedilemedi.") };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "project_media.upload",
    entityType: "project",
    entityId: projectId,
    newValue: { media_id: data.id, kind },
  });
  revalidateProject(projectId);
  return { ok: true, id: data.id as string };
}

export async function deleteProjectMedia(projectId: string, mediaId: string): Promise<{ ok?: boolean; error?: string }> {
  const gate = await requirePermission("projects", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(projectId ?? "")) || !UUID_RE.test(String(mediaId ?? ""))) return { error: "Görsel bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_media")
    .delete()
    .eq("id", mediaId)
    .eq("project_id", projectId)
    .eq("tenant_id", gate.tenantId)
    .select("storage_path, is_cover")
    .maybeSingle();
  if (error) {
    if (notReady(error)) return { error: NOT_READY };
    return { error: actionErrorMessage(error, "Görsel silinemedi.") };
  }
  if (!data) return { error: "Görsel bulunamadı." };
  const path = String(data.storage_path);
  if (path.startsWith(`${gate.tenantId}/${projectId}/`)) {
    const { error: rmError } = await createAdminClient().storage.from(PROJECT_MEDIA_BUCKET).remove([path]);
    if (rmError) console.error("deleteProjectMedia storage", { name: rmError.name });
  }
  // Kapak silindiyse ilk görsel kapak olur.
  if (data.is_cover) {
    const { data: next } = await supabase
      .from("project_media")
      .select("id")
      .eq("project_id", projectId)
      .eq("tenant_id", gate.tenantId)
      .eq("kind", "image")
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (next) await supabase.from("project_media").update({ is_cover: true }).eq("id", next.id).eq("tenant_id", gate.tenantId);
  }
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "project_media.delete", entityType: "project", entityId: projectId, oldValue: { media_id: mediaId } });
  revalidateProject(projectId);
  return { ok: true };
}

export async function setProjectMediaCover(projectId: string, mediaId: string): Promise<{ ok?: boolean; error?: string }> {
  const gate = await requirePermission("projects", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(projectId ?? "")) || !UUID_RE.test(String(mediaId ?? ""))) return { error: "Görsel bulunamadı." };
  const supabase = await createClient();
  const { error: clearError } = await supabase
    .from("project_media")
    .update({ is_cover: false })
    .eq("project_id", projectId)
    .eq("tenant_id", gate.tenantId)
    .eq("is_cover", true);
  if (clearError) {
    if (notReady(clearError)) return { error: NOT_READY };
    return { error: actionErrorMessage(clearError, "Kapak değiştirilemedi.") };
  }
  const { data, error } = await supabase
    .from("project_media")
    .update({ is_cover: true })
    .eq("id", mediaId)
    .eq("project_id", projectId)
    .eq("tenant_id", gate.tenantId)
    .eq("kind", "image")
    .select("id")
    .maybeSingle();
  if (error) return { error: actionErrorMessage(error, "Kapak değiştirilemedi.") };
  if (!data) return { error: "Kapak yalnız fotoğraf olabilir." };
  revalidateProject(projectId);
  return { ok: true };
}

// ============================================================
// PF-06 — Uygun alıcıya proje bağlantısı (WhatsApp, İYS kapılı)
// ============================================================

export type ProjectBuyerShareResult = { ok?: boolean; error?: string; waHref?: string | null; recipient?: string | null };

/**
 * Ticari ileti: alıcının WhatsApp İYS izni kayıtlı değilse gönderim hazırlanmaz (değerleme/sunum paylaşımıyla aynı
 * kapı). Mesaj yalnız proje adı + paylaşım bağlantısı + seçili daire özetini taşır; fiyat paylaşım sayfasındaki
 * "fiyat göster" ayarına uyar.
 */
export async function prepareProjectBuyerWhatsApp(input: {
  projectId: string;
  customerId: string;
  unitLabels: string[];
}): Promise<ProjectBuyerShareResult> {
  const gate = await requirePermission("projects", "view");
  if (!gate.ok) return { error: gate.error };
  const customersGate = await requirePermission("customers", "view");
  if (!customersGate.ok) return { error: customersGate.error };
  const projectId = String(input?.projectId ?? "");
  const customerId = String(input?.customerId ?? "");
  if (!UUID_RE.test(projectId) || !UUID_RE.test(customerId)) return { error: "Kayıt bulunamadı." };

  const supabase = await createClient();
  const [{ data: project, error: projectError }, { data: customer }, { data: consentRow }, { data: tenant }] = await Promise.all([
    supabase.from("projects").select("name, share_token, share_enabled").eq("id", projectId).eq("tenant_id", gate.tenantId).maybeSingle(),
    supabase.from("customers").select("full_name, phone").eq("id", customerId).eq("tenant_id", gate.tenantId).is("deleted_at", null).maybeSingle(),
    supabase.from("iys_consents").select("status").eq("tenant_id", gate.tenantId).eq("customer_id", customerId).eq("channel", "whatsapp").maybeSingle(),
    supabase.from("tenants").select("name").eq("id", gate.tenantId).maybeSingle(),
  ]);
  if (projectError && notReady(projectError)) return { error: NOT_READY };
  if (!project) return { error: "Proje bulunamadı." };
  if (!project.share_enabled || !project.share_token) {
    return { error: "Önce proje paylaşım sayfasını açın (Paylaşım kartı)." };
  }
  if (!customer?.phone) return { error: "Müşterinin kayıtlı telefonu yok." };
  const consent = ((consentRow as { status?: string } | null)?.status as ConsentStatus | undefined) ?? null;
  const decision = whatsappShareGate({ purpose: "commercial", recipientKnown: true, consent });
  if (!decision.allowed) return { error: decision.reason };

  const first = String(customer.full_name ?? "").split(/\s+/)[0];
  const units = (Array.isArray(input?.unitLabels) ? input.unitLabels : []).filter((x) => typeof x === "string").slice(0, 3).map((x) => x.slice(0, 40));
  const office = (tenant?.name as string | null | undefined) ?? null;
  const message = `${first ? `Merhaba ${first},` : "Merhaba,"} aradığınız kriterlere uyan "${String(project.name)}" projesinde müsait daireler var${
    units.length > 0 ? ` (${units.join(", ")})` : ""
  }${office ? ` — ${office}` : ""}: ${getBaseUrl()}/proje/${String(project.share_token)}`;
  const { href } = buildShareHref(customer.phone as string, message);

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "whatsapp.share_prepared",
    entityType: "project",
    entityId: projectId,
    newValue: { kind: "project", purpose: "commercial", customer_id: customerId, units: units.length },
  });
  return { ok: true, waHref: href, recipient: `${customer.full_name ?? ""} (${formatPhoneDisplay(customer.phone as string)})` };
}
