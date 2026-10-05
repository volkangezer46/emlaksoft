"use server";

import { revalidatePath } from "next/cache";
import { checkRateLimit } from "@/lib/rate-limit";
import { logPlatformActivity } from "@/lib/platform-activity";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule, type PlatformStaff } from "@/lib/platform";
import { invalidateGeoCache } from "@/lib/geo/cache";
import { applyTenantGeoMatches } from "@/lib/geo/backfill";
import { cleanGeoName } from "@/lib/geo/normalize";
import { GEO_LEVEL_LABEL, type GeoLevel } from "@/lib/geo/types";
import {
  addAlias,
  applyPlan,
  getAdminRow,
  getPathLabel,
  loadExisting,
  mergeEntity,
  moveEntity,
  createEntity,
  removeAlias,
  resolveChangeRequest,
  rollbackVersion,
  setActive,
  updateEntity,
  usageBreakdown,
  usageLabel,
  usageRows,
  listAliases,
  versionsAvailable,
  type AliasItem,
  type UsageItem,
  type UsageRowItem,
} from "@/lib/geo/admin-store";
import {
  buildImportPlan,
  parseImport,
  type ExistingGeo,
  type GeoOp,
  type ImportLevel,
  type ImportMeta,
} from "@/lib/geo/import-plan";

/**
 * Coğrafya yönetimi action'ları. YETKİ: `geo` modülü + yazma yalnız super_admin
 * (ops: okuma ve düzeltme ÖNERİSİ). Her yazma logPlatformActivity ile denetim kaydı bırakır.
 * SİLME YOK: pasife alma, taşıma ve birleştirme vardır.
 */

export type GeoActionResult = { error?: string; ok?: boolean; message?: string };
export type GeoSyncActionResult = GeoActionResult & { jobId?: string; status?: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEVELS: readonly GeoLevel[] = ["province", "district", "neighborhood"];

function level(raw: FormDataEntryValue | null): GeoLevel | null {
  const v = String(raw ?? "");
  return (LEVELS as readonly string[]).includes(v) ? (v as GeoLevel) : null;
}
const text = (raw: FormDataEntryValue | null) => cleanGeoName(String(raw ?? ""));
function coord(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const DENIED = "Coğrafya verisini yalnız süper admin değiştirebilir. Düzeltme önerisi gönderebilirsiniz.";

async function writer(): Promise<{ staff: PlatformStaff } | { error: string }> {
  const staff = await requirePlatformModule("geo");
  if (staff.role !== "super_admin") return { error: DENIED };
  return { staff };
}

function done(): GeoActionResult {
  invalidateGeoCache();
  revalidatePath("/admin/geo");
  revalidatePath("/admin");
  return { ok: true };
}

function auditMeta(l: GeoLevel, extra: Record<string, unknown>) {
  return { level: l, ...extra };
}

// ============================================================== il (geri uyum)

export async function updateProvince(formData: FormData): Promise<GeoActionResult> {
  const w = await writer();
  if ("error" in w) return w;
  const id = String(formData.get("id") ?? "").trim();
  const name = text(formData.get("name"));
  if (!UUID_PATTERN.test(id)) return { error: "İl bulunamadı." };
  if (!name) return { error: "İl adı boş olamaz." };
  const r = await updateEntity("province", id, { name, lat: coord(formData.get("lat")), lng: coord(formData.get("lng")) }, w.staff.id);
  if (!r.ok) return { error: r.error };
  const act = await setActive("province", [id], formData.get("is_active") === "on");
  if (!act.ok) return { error: act.error };
  await logPlatformActivity({ actorId: w.staff.id, action: "geo.update", entityType: "geo_province", entityId: id, meta: auditMeta("province", { name }) });
  return done();
}

/** Yalnız kuyruğa alır; sağlayıcı isteği ve atomik birleştirme kiralamalı cron çalışanında. */
export async function enqueueProvinceGeoSync(formData: FormData): Promise<GeoSyncActionResult> {
  const w = await writer();
  if ("error" in w) return w;
  const staff = w.staff;
  const provinceId = String(formData.get("province_id") ?? "").trim();
  if (!UUID_PATTERN.test(provinceId)) return { error: "Geçersiz il seçimi." };

  const rateLimit = await checkRateLimit(`platform:geo-sync:${staff.id}`, { limit: 12, windowSec: 60, failurePolicy: "deny" });
  if (!rateLimit.allowed) return { error: "Çok sık tarama isteği gönderildi. Lütfen kısa süre sonra tekrar deneyin." };

  const province = await getAdminRow("province", provinceId);
  if (!province) return { error: "İl bulunamadı." };
  if (!province.isActive) return { error: "Pasif bir il otomatik taranamaz." };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("enqueue_geo_province_sync", {
    p_province_id: province.id,
    p_requested_by: staff.id,
    p_priority: province.plateCode === 46 ? 1_000 : 100,
  });
  if (error) {
    console.error("enqueueProvinceGeoSync", { code: error.code || "unknown" });
    return { error: "Tarama kuyruğa alınamadı. Lütfen sistem durumunu kontrol edip yeniden deneyin." };
  }
  const raw = Array.isArray(data) ? data[0] : data;
  const result = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const jobId = typeof result?.id === "string" ? result.id : typeof result?.job_id === "string" ? result.job_id : undefined;
  const status = typeof result?.status === "string" ? result.status : "queued";
  if (!jobId) return { error: "Tarama işi doğrulanamadı; işlem başlatılmadı." };

  await logPlatformActivity({
    actorId: staff.id,
    action: "geo.province_sync.enqueue",
    entityType: "geo_province",
    entityId: province.id,
    meta: { jobId, plateCode: province.plateCode, previousGeoJobsPaused: true },
  });
  done();
  return { ok: true, jobId, status, message: `${province.name} taraması kuyruğa alındı. Diğer il taramaları bekletiliyor.` };
}

// ============================================================ genel kayıt işlemleri

export async function createGeoEntity(formData: FormData): Promise<GeoActionResult> {
  const w = await writer();
  if ("error" in w) return w;
  const lv = level(formData.get("level"));
  if (!lv) return { error: "Geçersiz seviye." };
  const name = text(formData.get("name"));
  const parentId = String(formData.get("parent_id") ?? "").trim();
  if (!name) return { error: `${GEO_LEVEL_LABEL[lv]} adı boş olamaz.` };
  if (lv !== "province" && !UUID_PATTERN.test(parentId)) return { error: "Üst kayıt bulunamadı." };
  const r = await createEntity(lv, {
    name,
    parentId,
    plateCode: coord(formData.get("plate_code")),
    lat: coord(formData.get("lat")),
    lng: coord(formData.get("lng")),
    postalCode: text(formData.get("postal_code")) || null,
    description: text(formData.get("description")) || null,
  }, w.staff.id);
  if (!r.ok) return { error: r.error };
  await logPlatformActivity({ actorId: w.staff.id, action: "geo.create", entityType: `geo_${lv}`, entityId: r.id ?? null, meta: auditMeta(lv, { name, parentId }) });
  return done();
}

export async function updateGeoEntity(formData: FormData): Promise<GeoActionResult> {
  const w = await writer();
  if ("error" in w) return w;
  const lv = level(formData.get("level"));
  const id = String(formData.get("id") ?? "").trim();
  if (!lv || !UUID_PATTERN.test(id)) return { error: "Kayıt bulunamadı." };
  const name = text(formData.get("name"));
  if (!name) return { error: `${GEO_LEVEL_LABEL[lv]} adı boş olamaz.` };
  const before = await getAdminRow(lv, id);
  const r = await updateEntity(lv, id, {
    name,
    lat: coord(formData.get("lat")),
    lng: coord(formData.get("lng")),
    postalCode: text(formData.get("postal_code")) || null,
    plateCode: lv === "province" ? coord(formData.get("plate_code")) : undefined,
    description: formData.has("description") ? text(formData.get("description")) || null : undefined,
  }, w.staff.id);
  if (!r.ok) return { error: r.error };
  await logPlatformActivity({ actorId: w.staff.id, action: "geo.update", entityType: `geo_${lv}`, entityId: id, meta: auditMeta(lv, { before: before?.name, after: name }) });
  return done();
}

/** Pasife al / yeniden etkinleştir (tek ya da toplu). `ids` virgülle ayrılmış. */
export async function setGeoActive(formData: FormData): Promise<GeoActionResult> {
  const w = await writer();
  if ("error" in w) return w;
  const lv = level(formData.get("level"));
  if (!lv) return { error: "Geçersiz seviye." };
  const ids = String(formData.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0 || ids.length > 1000 || ids.some((i) => !UUID_PATTERN.test(i))) return { error: "Geçersiz seçim." };
  const active = String(formData.get("active")) === "true";
  const r = await setActive(lv, ids, active);
  if (!r.ok) return { error: r.error };
  await logPlatformActivity({ actorId: w.staff.id, action: active ? "geo.activate" : "geo.deactivate", entityType: `geo_${lv}`, entityId: ids.length === 1 ? ids[0] : null, meta: auditMeta(lv, { count: ids.length, ids: ids.slice(0, 50) }) });
  return { ...done(), message: `${ids.length} kayıt ${active ? "yeniden etkinleştirildi" : "pasife alındı"}.` };
}

export async function moveGeoEntity(formData: FormData): Promise<GeoActionResult> {
  const w = await writer();
  if ("error" in w) return w;
  const lv = level(formData.get("level"));
  const id = String(formData.get("id") ?? "").trim();
  const target = String(formData.get("new_parent_id") ?? "").trim();
  if ((lv !== "district" && lv !== "neighborhood") || !UUID_PATTERN.test(id) || !UUID_PATTERN.test(target)) return { error: "Geçersiz taşıma isteği." };
  const from = await getPathLabel(lv, id);
  const r = await moveEntity(lv, id, target);
  if (!r.ok) return { error: r.error };
  const to = await getPathLabel(lv, id);
  await logPlatformActivity({ actorId: w.staff.id, action: "geo.move", entityType: `geo_${lv}`, entityId: id, meta: auditMeta(lv, { from, to }) });
  return { ...done(), message: `Taşındı: ${from} → ${to}` };
}

export async function mergeGeoEntity(formData: FormData): Promise<GeoActionResult> {
  const w = await writer();
  if ("error" in w) return w;
  const lv = level(formData.get("level"));
  const from = String(formData.get("from_id") ?? "").trim();
  const to = String(formData.get("to_id") ?? "").trim();
  if ((lv !== "district" && lv !== "neighborhood") || !UUID_PATTERN.test(from) || !UUID_PATTERN.test(to) || from === to) return { error: "Geçersiz birleştirme isteği." };
  const [fromPath, toPath] = await Promise.all([getPathLabel(lv, from), getPathLabel(lv, to)]);
  const r = await mergeEntity(lv, from, to, w.staff.id, w.staff.email);
  if (!r.ok) return { error: r.error };
  await logPlatformActivity({ actorId: w.staff.id, action: "geo.merge", entityType: `geo_${lv}`, entityId: to, meta: auditMeta(lv, { from, to, fromPath, toPath, moved: r.moved, versionId: r.versionId }) });
  return { ...done(), message: `${fromPath} → ${toPath} birleştirildi (${r.moved ?? 0} kayıt taşındı). Sürümler ekranından geri alınabilir.` };
}

// ------------------------------------------------------------------ alias

export async function addGeoAlias(formData: FormData): Promise<GeoActionResult> {
  const w = await writer();
  if ("error" in w) return w;
  const lv = level(formData.get("level"));
  const id = String(formData.get("id") ?? "").trim();
  const alias = text(formData.get("alias"));
  const kind = String(formData.get("kind")) === "old_name" ? "old_name" : "variant";
  const validTo = String(formData.get("valid_to") ?? "").trim();
  if (!lv || !UUID_PATTERN.test(id) || alias.length < 2) return { error: "Takma ad en az 2 karakter olmalı." };
  if (validTo && !/^\d{4}-\d{2}-\d{2}$/.test(validTo)) return { error: "Geçerlilik tarihi biçimi YYYY-AA-GG olmalı." };
  const r = await addAlias(lv, id, alias, kind, validTo || null, w.staff.id);
  if (!r.ok) return { error: r.error };
  await logPlatformActivity({ actorId: w.staff.id, action: "geo.alias.add", entityType: `geo_${lv}`, entityId: id, meta: auditMeta(lv, { alias, kind }) });
  return done();
}

export async function removeGeoAlias(formData: FormData): Promise<GeoActionResult> {
  const w = await writer();
  if ("error" in w) return w;
  const aliasId = String(formData.get("alias_id") ?? "").trim();
  if (!UUID_PATTERN.test(aliasId)) return { error: "Takma ad bulunamadı." };
  const r = await removeAlias(aliasId);
  if (!r.ok) return { error: r.error };
  await logPlatformActivity({ actorId: w.staff.id, action: "geo.alias.remove", entityType: "geo_alias", entityId: aliasId });
  return done();
}

/** Satır içi paneller için (okuma): takma adlar. */
export async function loadGeoAliases(lv: GeoLevel, id: string): Promise<{ aliases: AliasItem[] | null }> {
  await requirePlatformModule("geo");
  if (!LEVELS.includes(lv) || !UUID_PATTERN.test(id)) return { aliases: [] };
  return { aliases: await listAliases(lv, id) };
}

// ------------------------------------------------------- etki özeti / kullanım

export type GeoImpact = { path: string; usage: Array<UsageItem & { label: string }> | null; total: number | null; childCount: number | null };

/** Pasife alma/birleştirme/taşıma ÖNCESİ etki özeti (okuma; ops da görür). */
export async function loadGeoImpact(lv: GeoLevel, id: string): Promise<GeoImpact> {
  await requirePlatformModule("geo");
  if (!LEVELS.includes(lv) || !UUID_PATTERN.test(id)) return { path: "", usage: [], total: 0, childCount: 0 };
  const [path, usage] = await Promise.all([getPathLabel(lv, id), usageBreakdown(lv, id)]);
  const items = usage ? usage.map((u) => ({ ...u, label: usageLabel(u.table) })) : null;
  const child = items?.filter((u) => u.table.startsWith("geo_")).reduce((s, u) => s + u.n, 0) ?? null;
  const total = items ? items.filter((u) => !u.table.startsWith("geo_")).reduce((s, u) => s + u.n, 0) : null;
  return { path, usage: items, total, childCount: child };
}

export async function loadGeoUsageRows(lv: GeoLevel, id: string, table: string): Promise<{ rows: UsageRowItem[] | null }> {
  await requirePlatformModule("geo");
  if (!LEVELS.includes(lv) || !UUID_PATTERN.test(id) || !/^[a-z_]+$/.test(table)) return { rows: [] };
  return { rows: await usageRows(lv, id, table) };
}

// -------------------------------------------------- ops: düzeltme ÖNERİSİ

export async function submitGeoSuggestion(formData: FormData): Promise<GeoActionResult> {
  const staff = await requirePlatformModule("geo");
  const lv = level(formData.get("level"));
  const id = String(formData.get("id") ?? "").trim();
  const note = text(formData.get("note")).slice(0, 500);
  if (!lv || !UUID_PATTERN.test(id) || note.length < 3) return { error: "Öneri en az 3 karakter olmalı." };
  await logPlatformActivity({ actorId: staff.id, action: "geo.suggestion", entityType: `geo_${lv}`, entityId: id, meta: auditMeta(lv, { note, by: staff.email }) });
  return { ok: true, message: "Öneriniz süper admin kuyruğuna iletildi." };
}

// ----------------------------------------------------- ofis bildirimi kuyruğu

export async function resolveGeoRequest(formData: FormData): Promise<GeoActionResult> {
  const w = await writer();
  if ("error" in w) return w;
  const id = String(formData.get("id") ?? "").trim();
  const decision = String(formData.get("decision")) === "approved" ? "approved" : "rejected";
  const note = text(formData.get("note")).slice(0, 500) || null;
  if (!UUID_PATTERN.test(id)) return { error: "Bildirim bulunamadı." };
  const r = await resolveChangeRequest(id, decision, w.staff.id, note);
  if (!r.ok) return { error: r.error };
  await logPlatformActivity({ actorId: w.staff.id, action: `geo.request.${decision}`, entityType: "geo_change_request", entityId: id, meta: { note } });
  return done();
}

// -------------------------------------------------------------- sürüm geri alma

export async function rollbackGeoVersion(formData: FormData): Promise<GeoActionResult> {
  const w = await writer();
  if ("error" in w) return w;
  const id = String(formData.get("id") ?? "").trim();
  if (!UUID_PATTERN.test(id)) return { error: "Sürüm bulunamadı." };
  const r = await rollbackVersion(id, w.staff.id);
  if (!r.ok) return { error: r.error };
  await logPlatformActivity({ actorId: w.staff.id, action: "geo.version.rollback", entityType: "geo_data_version", entityId: id, meta: { reverted: r.reverted ?? null } });
  return { ...done(), message: "Sürümün değişiklikleri geri alındı (silme yapılmadı; referanslar korundu)." };
}

// ------------------------------------------------------------ toplu içe aktarma

export type ImportItem = { kind: "add" | "change" | "deactivate"; level: ImportLevel; path: string; detail: string; href: string | null };
export type GeoImportPreview = GeoActionResult & {
  rowCount?: number;
  meta?: ImportMeta;
  summary?: import("@/lib/geo/import-plan").ImportPlan["summary"];
  items?: ImportItem[];
  itemsTruncated?: boolean;
  errors?: string[];
  warnings?: string[];
  canApply?: boolean;
  versionsReady?: boolean;
};

const MAX_IMPORT_BYTES = 3 * 1024 * 1024; // genel Server Action sınırı 4 MiB; 1 MiB pay bırakılır
const ITEM_CAP = 400;

async function readImportText(formData: FormData): Promise<{ text: string; fileName: string | null } | { error: string }> {
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_IMPORT_BYTES) return { error: "Dosya çok büyük (en çok 3 MB). Daha büyük kaynaklar için `npm run geo:import` komutunu kullanın." };
    return { text: await file.text(), fileName: file.name.slice(0, 120) };
  }
  const pasted = String(formData.get("pasted") ?? "");
  if (pasted.trim()) {
    if (pasted.length > MAX_IMPORT_BYTES) return { error: "Metin çok büyük." };
    return { text: pasted, fileName: null };
  }
  return { error: "Bir CSV/JSON dosyası seçin ya da içeriği yapıştırın." };
}

function describeOps(ops: readonly GeoOp[], existing: ExistingGeo): { items: ImportItem[]; truncated: boolean } {
  const distProv = new Map(existing.districts.map((d) => [d.id, d.province_id]));
  const neighDist = new Map(existing.neighborhoods.map((n) => [n.id, n.district_id]));
  const hrefOf = (lv: ImportLevel, id: string): string | null => {
    if (lv === "province") return `/admin/geo/${id}`;
    if (lv === "district") return distProv.get(id) ? `/admin/geo/${distProv.get(id)}/${id}` : null;
    const d = neighDist.get(id);
    return d && distProv.get(d) ? `/admin/geo/${distProv.get(d)}/${d}` : null;
  };
  const items: ImportItem[] = [];
  let truncated = false;
  for (const o of ops) {
    if (items.length >= ITEM_CAP * 3) { truncated = true; break; }
    if (o.op === "insert") items.push({ kind: "add", level: o.level, path: o.path, detail: "Eklenecek", href: null });
    else if (o.op === "update") items.push({ kind: "change", level: o.level, path: o.path, detail: Object.keys(o.after).map((k) => `${k}: ${String(o.before[k] ?? "—")} → ${String(o.after[k] ?? "—")}`).join("; "), href: hrefOf(o.level, o.id) });
    else items.push({ kind: "deactivate", level: o.level, path: o.path, detail: "Kaynakta yok; pasife alınacak", href: hrefOf(o.level, o.id) });
  }
  // Tür başına kırp (liste gezilebilir kalsın).
  const per: Record<string, number> = {};
  const capped = items.filter((i) => ((per[i.kind] = (per[i.kind] ?? 0) + 1) <= ITEM_CAP));
  return { items: capped, truncated: truncated || capped.length < items.length };
}

/** KURU ÇALIŞTIRMA: hiçbir şey yazmaz; fark özeti ve tıklanabilir liste döner. */
export async function previewGeoImport(formData: FormData): Promise<GeoImportPreview> {
  await requirePlatformModule("geo");
  const src = await readImportText(formData);
  if ("error" in src) return { error: src.error };
  const mode = String(formData.get("mode")) === "full" ? "full" : "merge";
  const parsed = parseImport(src.text);
  if (parsed.errors.length) return { error: parsed.errors[0], errors: parsed.errors };
  if (parsed.rows.length > 120_000) return { error: "Satır sayısı çok fazla." };
  const existing = await loadExisting();
  const plan = buildImportPlan(parsed.rows, existing, { mode });
  const { items, truncated } = describeOps(plan.ops, existing);
  return {
    ok: plan.errors.length === 0,
    rowCount: parsed.rows.length,
    meta: parsed.meta,
    summary: plan.summary,
    items,
    itemsTruncated: truncated,
    errors: plan.errors.slice(0, 50),
    warnings: plan.warnings.slice(0, 50),
    canApply: plan.errors.length === 0 && plan.ops.length > 0,
    versionsReady: await versionsAvailable(),
  };
}

/** UYGULA: planı sunucuda yeniden üretir (istemciye güvenmez), onay ister, partilerle yazar. */
export async function applyGeoImport(formData: FormData): Promise<GeoImportPreview> {
  const w = await writer();
  if ("error" in w) return w;
  if (formData.get("confirm") !== "on") return { error: "Uygulamak için onay kutusunu işaretleyin." };
  const rate = await checkRateLimit(`platform:geo-import:${w.staff.id}`, { limit: 3, windowSec: 300, failurePolicy: "deny" });
  if (!rate.allowed) return { error: "Çok sık içe aktarma denendi. Birkaç dakika bekleyin." };
  const src = await readImportText(formData);
  if ("error" in src) return { error: src.error };
  const mode = String(formData.get("mode")) === "full" ? "full" : "merge";
  const parsed = parseImport(src.text);
  if (parsed.errors.length) return { error: parsed.errors[0] };
  const meta: ImportMeta = {
    source: text(formData.get("source")) || parsed.meta.source || "manual-import",
    version: text(formData.get("version")) || parsed.meta.version || undefined,
    date: text(formData.get("date")) || parsed.meta.date || undefined,
  };
  const existing = await loadExisting();
  const plan = buildImportPlan(parsed.rows, existing, { mode });
  if (plan.errors.length) return { error: plan.errors[0], errors: plan.errors.slice(0, 50) };
  if (plan.ops.length === 0) return { error: "Uygulanacak fark yok." };
  const result = await applyPlan(plan, { actorId: w.staff.id, actorLabel: w.staff.email, meta, mode, fileName: src.fileName });
  await logPlatformActivity({
    actorId: w.staff.id,
    action: result.ok ? "geo.import.apply" : "geo.import.failed",
    entityType: "geo_data_version",
    entityId: result.versionId,
    meta: { mode, source: meta.source, version: meta.version ?? null, summary: plan.summary, error: result.ok ? null : result.error },
  });
  invalidateGeoCache();
  revalidatePath("/admin/geo");
  if (!result.ok) return { error: `${result.error} (Yapılanlar sürüm kaydında; Sürümler ekranından geri alınabilir.)` };
  return { ok: true, summary: result.summary, message: "İçe aktarma uygulandı. Sürümler ekranından geri alınabilir." };
}

// ------------------------------------------------ serbest metin → kimlik eşleştirme

/** Ofis `city` metnini il kimliğine bağlar (kesin eşleşmeler; fuzzy yalnız açık onayla). */
export async function applyTenantGeoBackfill(formData: FormData): Promise<GeoActionResult> {
  const w = await writer();
  if ("error" in w) return w;
  const ids = String(formData.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0 || ids.length > 200 || ids.some((i) => !UUID_PATTERN.test(i))) return { error: "Geçersiz seçim." };
  const allowFuzzy = formData.get("allow_fuzzy") === "on";
  const r = await applyTenantGeoMatches(ids, allowFuzzy);
  await logPlatformActivity({ actorId: w.staff.id, action: "geo.backfill.tenants", entityType: "tenant", entityId: ids.length === 1 ? ids[0] : null, meta: { applied: r.applied, skipped: r.skipped, allowFuzzy } });
  revalidatePath("/admin/geo/eslestir");
  return { ok: true, message: `${r.applied} ofis eşleştirildi, ${r.skipped} atlandı.` };
}
