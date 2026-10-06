"use server";

import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { checkRateLimit } from "@/lib/rate-limit";
import { logActivity } from "@/lib/activity";
import type { ImportTarget } from "@/lib/import-rows";
import {
  activeRollbackClaims,
  claimWon,
  removeCreated,
  restoreUpdated,
  type RestoreEntry,
} from "@/lib/import-undo";

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
const IMPORT_ACTIONS = ["customer.import", "property.import", "demand.import", "task.import", "appointment.import", "expense.import"] as const;

const TARGET_BY_ACTION: Record<string, ImportTarget> = {
  "customer.import": "customers",
  "property.import": "properties",
  "demand.import": "demands",
  "task.import": "tasks",
  "appointment.import": "appointments",
  "expense.import": "expenses",
};
const MODULE_BY_TARGET = {
  customers: "customers",
  properties: "properties",
  demands: "demands",
  tasks: "tasks",
  appointments: "appointments",
  expenses: "expenses",
} as const;
const PATH_BY_TARGET = {
  customers: "/app/musteriler",
  properties: "/app/portfoyler",
  demands: "/app/talepler",
  tasks: "/app/gorevler",
  appointments: "/app/randevular",
  expenses: "/app/giderler",
} as const;

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
  id?: string | null;
  action: string;
  actor_id: string | null;
  created_at: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Son 30 günün içe aktarma günlüğü (toplu iş bazında, en yeni önce). */
export async function listRecentImports(): Promise<{ batches: ImportBatch[]; error?: string }> {
  const gate = await requirePermission("customers", "view");
  if (!gate.ok) return { batches: [], error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, action, actor_id, created_at, new_value")
    .eq("tenant_id", gate.tenantId)
    .in("action", [...IMPORT_ACTIONS, "import.rollback", "import.rollback.released"])
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
      // Serbest bırakılmış (kısmi/başarısız) talepler "geri alındı" sayılmaz.
      if (activeRollbackClaims(data as LogRow[], batchId).length && !rolled.has(batchId)) rolled.set(batchId, row.created_at);
      continue;
    }
    if (row.action === "import.rollback.released") continue;
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
  /** Bağlı iş verisi (anlaşma, randevu, teklif...) olduğu için dokunulmayan kayıt sayısı. */
  skippedLinked?: number;
  /** İçe aktarmadan sonra düzenlendiği için eski haline döndürülmeyen kayıt sayısı. */
  skippedEdited?: number;
  /** Hata nedeniyle geri alınamayan kayıt sayısı. */
  failed?: number;
  /** Kullanıcıya gösterilecek ek bilgi (atlananlar). */
  warning?: string;
};

function rollbackWarning(skippedLinked: number, skippedEdited: number): string | undefined {
  const parts: string[] = [];
  if (skippedLinked) parts.push(`${skippedLinked} kayıt, bağlı anlaşma/randevu/teklif gibi kayıtlar olduğu için bırakıldı`);
  if (skippedEdited) parts.push(`${skippedEdited} kayıt, içe aktarmadan sonra düzenlendiği için eski haline döndürülmedi`);
  return parts.length ? `${parts.join("; ")}.` : undefined;
}

/** Bir toplu işte oluşan kayıtları geri çeker; güncellenenleri eski haline döndürür. */
export async function rollbackImport(batchId: string): Promise<RollbackResult> {
  if (!UUID_RE.test(String(batchId ?? ""))) return { error: "İçe aktarma kimliği geçersiz." };

  // Hedefi bilmeden yetki kontrolü yapılamaz: önce görüntüleme kapısı, sonra hedefe özel silme kapısı.
  const base = await requirePermission("customers", "view");
  if (!base.ok) return { error: base.error };
  // Hız sınırı: çift tık / döngüyle tekrar geri alma denemelerini keser.
  const rate = await checkRateLimit(`import-rollback:${base.userId}`, { limit: 10, windowSec: 10 * 60, failurePolicy: "deny" });
  if (!rate.allowed) return { error: "Çok fazla geri alma isteği gönderildi. Birkaç dakika sonra tekrar deneyin." };
  const supabase = await createClient();

  const readLogs = () =>
    supabase
      .from("audit_logs")
      .select("id, action, actor_id, created_at, old_value, new_value")
      .eq("tenant_id", base.tenantId)
      .in("action", [...IMPORT_ACTIONS, "import.rollback", "import.rollback.released"])
      .eq("new_value->>batch_id", batchId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(2000);

  const { data, error } = await readLogs();
  if (error) {
    console.error("rollbackImport read", error);
    return { error: "İçe aktarma kaydı okunamadı." };
  }
  const logs = (data ?? []) as LogRow[];
  if (activeRollbackClaims(logs, batchId).length > 0) return { error: "Bu içe aktarma zaten geri alınmış veya geri alınıyor." };
  const imports = logs.filter((r) => r.action in TARGET_BY_ACTION);
  if (!imports.length) return { error: "Bu içe aktarma için geri alınabilir kayıt bulunamadı." };

  const target = TARGET_BY_ACTION[imports[0].action];
  const mod = MODULE_BY_TARGET[target];
  const gate = await requirePermission(mod, "delete");
  if (!gate.ok) return { error: "İçe aktarmayı geri almak için silme yetkisi gerekir." };

  const createdIds = [...new Set(imports.flatMap((r) => ((r.new_value ?? {}).created_ids as string[] | undefined) ?? []))].filter(
    (id) => UUID_RE.test(id),
  );
  // Aynı kayıt birden çok parçada güncellendiyse EN ESKİ eski değer geçerlidir (ilk görülen).
  // `importAt`: o parçanın audit zamanı — kayıt bundan sonra düzenlendiyse eski değer geri yazılmaz.
  const firstPrev = new Map<string, RestoreEntry>();
  for (const r of imports) {
    const list = ((r.old_value ?? {}).updated_prev as { id: string; prev: Record<string, unknown> }[] | undefined) ?? [];
    for (const u of list) {
      if (UUID_RE.test(u.id) && !firstPrev.has(u.id)) firstPrev.set(u.id, { id: u.id, prev: u.prev, importAt: r.created_at });
    }
  }
  if (firstPrev.size) {
    const edit = await requirePermission(mod, "edit");
    if (!edit.ok) return { error: "Güncellenen kayıtları eski haline döndürmek için düzenleme yetkisi gerekir." };
  }

  // Kilit: önce talep kaydı yaz, sonra en eski serbest bırakılmamış talebin bizimki olduğunu doğrula.
  // (Çift tık / iki sekme: yalnız biri kazanır, diğeri hiçbir şeyi değiştirmeden döner.)
  const claim = crypto.randomUUID();
  const claimWrite = await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "import.rollback",
    entityType: target,
    newValue: { batch_id: batchId, target, claim, requested: createdIds.length },
  });
  if (!claimWrite.ok) return { error: "Geri alma kaydı yazılamadı; hiçbir değişiklik yapılmadı. Tekrar deneyin." };
  const recheck = await readLogs();
  if (recheck.error || !claimWon((recheck.data ?? []) as LogRow[], batchId, claim)) {
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "import.rollback.released",
      entityType: target,
      newValue: { batch_id: batchId, claim },
    });
    return {
      error: recheck.error
        ? "Geri alma doğrulanamadı; hiçbir değişiklik yapılmadı. Tekrar deneyin."
        : "Bu içe aktarma şu anda başka bir oturumda geri alınıyor.",
    };
  }

  const removeRes = await removeCreated(supabase, { target, tenantId: gate.tenantId, ids: createdIds, checkLinks: true });
  const restoreRes = firstPrev.size
    ? await restoreUpdated(supabase, { target, tenantId: gate.tenantId, entries: [...firstPrev.values()] })
    : { restored: 0, skippedEdited: 0, failed: 0 };
  const failed = removeRes.failed + restoreRes.failed;

  const summary = {
    batch_id: batchId,
    target,
    claim,
    removed: removeRes.removed,
    restored: restoreRes.restored,
    skipped_linked: removeRes.skippedLinked,
    skipped_edited: restoreRes.skippedEdited,
    failed,
    requested: createdIds.length,
  };
  if (failed > 0) {
    // Kısmi sonuç: kilidi serbest bırak ki kalan kayıtlar için yeniden denenebilsin.
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "import.rollback.released",
      entityType: target,
      newValue: summary,
    });
  } else {
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "import.rollback.result",
      entityType: target,
      newValue: summary,
    });
  }

  revalidatePath(PATH_BY_TARGET[target]);
  revalidatePath("/app/ice-aktarma");
  revalidateTenantData(gate.tenantId);

  const warning = rollbackWarning(removeRes.skippedLinked, restoreRes.skippedEdited);
  if (failed > 0) {
    return {
      error: `Geri alma kısmen tamamlandı: ${removeRes.removed} kayıt kaldırıldı, ${restoreRes.restored} kayıt eski haline döndü, ${failed} kayıt işlenemedi. Tekrar deneyebilirsiniz.${warning ? ` ${warning}` : ""}`,
      removed: removeRes.removed,
      restored: restoreRes.restored,
      skippedLinked: removeRes.skippedLinked,
      skippedEdited: restoreRes.skippedEdited,
      failed,
    };
  }
  return {
    ok: true,
    removed: removeRes.removed,
    restored: restoreRes.restored,
    skippedLinked: removeRes.skippedLinked,
    skippedEdited: restoreRes.skippedEdited,
    failed: 0,
    warning,
  };
}
