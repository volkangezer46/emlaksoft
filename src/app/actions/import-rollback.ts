"use server";

import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import type { ImportTarget } from "@/lib/import-rows";

/**
 * İçe aktarma günlüğü + "son içe aktarmayı geri al".
 *
 * Şema değişikliği YOK: günlük, `importChunk`'ın yazdığı audit kayıtlarından
 * (`customer.import` / `property.import` / `demand.import`, `new_value.batch_id`) okunur.
 * Geri alma yalnız o toplu işte OLUŞAN kayıtları geri çeker:
 *  - müşteri/portföy: yumuşak silme (`deleted_at`) — veri kaybı yok, geri getirilebilir;
 *  - talep: kayıt silinir (silinmiş-işareti yok);
 *  - "güncelle" politikasıyla DEĞİŞEN kayıtlar audit'teki eski değerlerine döndürülür.
 * Yetki: hedef modülde "delete" (+ güncelleme geri almak için "edit"). Her geri alma
 * `import.rollback` audit kaydı bırakır; aynı toplu iş ikinci kez geri alınamaz.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_CHUNK = 200;
const IMPORT_ACTIONS = ["customer.import", "property.import", "demand.import"] as const;

const TARGET_BY_ACTION: Record<string, ImportTarget> = {
  "customer.import": "customers",
  "property.import": "properties",
  "demand.import": "demands",
};
const MODULE_BY_TARGET = { customers: "customers", properties: "properties", demands: "demands" } as const;
const TABLE_BY_TARGET = { customers: "customers", properties: "properties", demands: "customer_demands" } as const;
const PATH_BY_TARGET = { customers: "/app/musteriler", properties: "/app/portfoyler", demands: "/app/talepler" } as const;

export type ImportBatch = {
  batchId: string;
  target: ImportTarget;
  fileName: string;
  createdAt: string;
  actorName: string | null;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  rolledBack: boolean;
  rolledBackAt: string | null;
};

type LogRow = {
  action: string;
  actor_id: string | null;
  created_at: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Son 30 günün içe aktarma günlüğü (toplu iş bazında, en yeni önce). */
export async function listRecentImports(): Promise<{ batches: ImportBatch[]; error?: string }> {
  const gate = await requirePermission("customers", "view");
  if (!gate.ok) return { batches: [], error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("action, actor_id, created_at, new_value")
    .eq("tenant_id", gate.tenantId)
    .in("action", [...IMPORT_ACTIONS, "import.rollback"])
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("listRecentImports", error);
    return { batches: [], error: "İçe aktarma günlüğü okunamadı." };
  }

  const rolled = new Map<string, string>();
  const byBatch = new Map<string, ImportBatch>();
  const actorIds = new Set<string>();
  for (const row of (data ?? []) as LogRow[]) {
    const nv = row.new_value ?? {};
    const batchId = typeof nv.batch_id === "string" ? nv.batch_id : "";
    if (!UUID_RE.test(batchId)) continue;
    if (row.action === "import.rollback") {
      if (!rolled.has(batchId)) rolled.set(batchId, row.created_at);
      continue;
    }
    const target = TARGET_BY_ACTION[row.action];
    if (!target) continue;
    const cur = byBatch.get(batchId);
    if (cur) {
      cur.inserted += num(nv.inserted);
      cur.updated += num(nv.updated);
      cur.skipped += num(nv.skipped);
      cur.failed += num(nv.failed);
      if (row.created_at < cur.createdAt) cur.createdAt = row.created_at;
    } else {
      if (row.actor_id) actorIds.add(row.actor_id);
      byBatch.set(batchId, {
        batchId,
        target,
        fileName: typeof nv.file_name === "string" ? nv.file_name : "",
        createdAt: row.created_at,
        actorName: row.actor_id,
        inserted: num(nv.inserted),
        updated: num(nv.updated),
        skipped: num(nv.skipped),
        failed: num(nv.failed),
        rolledBack: false,
        rolledBackAt: null,
      });
    }
  }

  const names = new Map<string, string>();
  if (actorIds.size) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", [...actorIds]);
    for (const p of profs ?? []) names.set(p.id as string, String(p.full_name ?? ""));
  }
  const batches = [...byBatch.values()]
    .map((b) => ({
      ...b,
      actorName: b.actorName ? (names.get(b.actorName) ?? null) : null,
      rolledBack: rolled.has(b.batchId),
      rolledBackAt: rolled.get(b.batchId) ?? null,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 10);
  return { batches };
}

export type RollbackResult = {
  ok?: boolean;
  error?: string;
  removed?: number;
  restored?: number;
};

/** Bir toplu işte oluşan kayıtları geri çeker; güncellenenleri eski haline döndürür. */
export async function rollbackImport(batchId: string): Promise<RollbackResult> {
  if (!UUID_RE.test(String(batchId ?? ""))) return { error: "İçe aktarma kimliği geçersiz." };

  // Hedefi bilmeden yetki kontrolü yapılamaz: önce görüntüleme kapısı, sonra hedefe özel silme kapısı.
  const base = await requirePermission("customers", "view");
  if (!base.ok) return { error: base.error };
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("audit_logs")
    .select("action, actor_id, created_at, old_value, new_value")
    .eq("tenant_id", base.tenantId)
    .in("action", [...IMPORT_ACTIONS, "import.rollback"])
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error) {
    console.error("rollbackImport read", error);
    return { error: "İçe aktarma kaydı okunamadı." };
  }
  const logs = ((data ?? []) as LogRow[]).filter((r) => (r.new_value ?? {}).batch_id === batchId);
  if (logs.some((r) => r.action === "import.rollback")) return { error: "Bu içe aktarma zaten geri alınmış." };
  const imports = logs.filter((r) => r.action in TARGET_BY_ACTION);
  if (!imports.length) return { error: "Bu içe aktarma için geri alınabilir kayıt bulunamadı." };

  const target = TARGET_BY_ACTION[imports[0].action];
  const mod = MODULE_BY_TARGET[target];
  const gate = await requirePermission(mod, "delete");
  if (!gate.ok) return { error: "İçe aktarmayı geri almak için silme yetkisi gerekir." };

  const createdIds = [...new Set(imports.flatMap((r) => ((r.new_value ?? {}).created_ids as string[] | undefined) ?? []))].filter(
    (id) => UUID_RE.test(id),
  );
  const updates = imports.flatMap(
    (r) => ((r.old_value ?? {}).updated_prev as { id: string; prev: Record<string, unknown> }[] | undefined) ?? [],
  );
  // Aynı kayıt birden çok parçada güncellendiyse EN ESKİ eski değer geçerlidir (ilk görülen).
  const firstPrev = new Map<string, Record<string, unknown>>();
  for (const u of updates) if (UUID_RE.test(u.id) && !firstPrev.has(u.id)) firstPrev.set(u.id, u.prev);
  if (firstPrev.size) {
    const edit = await requirePermission(mod, "edit");
    if (!edit.ok) return { error: "Güncellenen kayıtları eski haline döndürmek için düzenleme yetkisi gerekir." };
  }

  const table = TABLE_BY_TARGET[target];
  let removed = 0;
  for (const part of chunked(createdIds, ID_CHUNK)) {
    if (target === "demands") {
      const { data: gone, error: delErr } = await supabase
        .from(table)
        .delete()
        .in("id", part)
        .eq("tenant_id", gate.tenantId)
        .select("id");
      if (delErr) {
        console.error("rollbackImport delete", delErr);
        return { error: "Geri alma sırasında hata oluştu; işlem kısmen yapılmış olabilir. Tekrar deneyin.", removed };
      }
      removed += gone?.length ?? 0;
    } else {
      const { data: gone, error: delErr } = await supabase
        .from(table)
        .update({ deleted_at: new Date(now()).toISOString() })
        .in("id", part)
        .eq("tenant_id", gate.tenantId)
        .is("deleted_at", null)
        .select("id");
      if (delErr) {
        console.error("rollbackImport soft delete", delErr);
        return { error: "Geri alma sırasında hata oluştu; işlem kısmen yapılmış olabilir. Tekrar deneyin.", removed };
      }
      removed += gone?.length ?? 0;
    }
  }

  let restored = 0;
  for (const part of chunked([...firstPrev.entries()], 10)) {
    await Promise.all(
      part.map(async ([id, prev]) => {
        const { error: upErr } = await supabase.from(table).update(prev).eq("id", id).eq("tenant_id", gate.tenantId);
        if (upErr) console.error("rollbackImport restore", upErr);
        else restored += 1;
      }),
    );
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "import.rollback",
    entityType: target,
    newValue: { batch_id: batchId, target, removed, restored, requested: createdIds.length },
  });

  revalidatePath(PATH_BY_TARGET[target]);
  revalidatePath("/app/ice-aktarma");
  revalidateTenantData(gate.tenantId);
  return { ok: true, removed, restored };
}
