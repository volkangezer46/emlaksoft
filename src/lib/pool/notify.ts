import "server-only";
import { daysFromNowIso } from "@/lib/clock";
import { notifyTenant } from "@/lib/notify";
import type { PoolDecision } from "./modes";
import { loadOfficeManagers, type Db } from "./server";

const POOL_HREF = "/app/ilan-havuzu";

/** Bildirim hataları iş akışını bozmaz. */
async function safeNotify(input: Parameters<typeof notifyTenant>[0]) {
  try {
    await notifyTenant(input);
  } catch (e) {
    console.error("pool notify", e);
  }
}

async function safeTask(
  db: Db,
  row: { tenantId: string; assignedTo: string; createdBy: string | null; propertyId: string; title: string; notes: string },
) {
  try {
    const { error } = await db.from("tasks").insert({
      tenant_id: row.tenantId,
      title: row.title,
      notes: row.notes,
      kind: "followup",
      priority: "high",
      status: "open",
      due_at: daysFromNowIso(1),
      assigned_to: row.assignedTo,
      property_id: row.propertyId,
      created_by: row.createdBy,
    });
    if (error) console.error("pool task", error);
  } catch (e) {
    console.error("pool task", e);
  }
}

/** Havuza giren ilan: ofis yöneticilerine bildirim (+ atama bekliyorsa görev); sahiplenmede uygun danışmanlara duyuru. */
export async function notifyPoolEntry(
  db: Db,
  input: {
    tenantId: string;
    actorId: string | null;
    propertyId: string;
    label: string;
    decision: PoolDecision;
    claimProfileIds?: string[];
  },
) {
  const managers = await loadOfficeManagers(db, input.tenantId);
  const d = input.decision;
  const waiting = d.kind === "await_owner";
  const reasonText =
    d.kind === "await_owner"
      ? d.reason === "below_threshold"
        ? "Otomatik atama eşiği altında kaldı."
        : d.reason === "no_candidates"
          ? "Uygun danışman bulunamadı (hepsi elendi)."
          : "Önerilen danışmanı onaylayın."
      : d.kind === "open_claim"
        ? "Sahiplenme süresi başladı."
        : "Danışman otomatik atandı.";
  for (const m of managers) {
    if (m.id === input.actorId) continue;
    await safeNotify({
      tenantId: input.tenantId,
      userId: m.id,
      title: `Havuza yeni ilan: ${input.label}`,
      body: reasonText,
      href: POOL_HREF,
      kind: waiting ? "warning" : "info",
    });
  }
  if (waiting && managers[0]) {
    await safeTask(db, {
      tenantId: input.tenantId,
      assignedTo: managers[0].id,
      createdBy: input.actorId,
      propertyId: input.propertyId,
      title: `Havuzdaki ilana danışman ata: ${input.label}`,
      notes: `${reasonText} İlan havuzundan öneri listesine bakıp atama yapın.`,
    });
  }
  if (d.kind === "open_claim") {
    for (const id of (input.claimProfileIds ?? d.eligibleProfileIds).slice(0, 25)) {
      if (id === input.actorId) continue;
      await safeNotify({
        tenantId: input.tenantId,
        userId: id,
        title: `Sahiplenebileceğin ilan: ${input.label}`,
        body: "İlk sahiplenen alır; süre sınırlıdır.",
        href: POOL_HREF,
        kind: "info",
      });
    }
  }
}

/**
 * Toplu havuz girişi (içe aktarma): ilan başına değil TEK özet bildirim (yöneticilere) + tek atama görevi.
 * Görev ilk ilana bağlanır (tasks.property_id tekil); ayrıntı havuz listesindedir.
 */
export async function notifyPoolBatch(
  db: Db,
  input: { tenantId: string; actorId: string | null; count: number; firstPropertyId: string; sourceLabel: string },
) {
  if (input.count <= 0) return;
  const managers = await loadOfficeManagers(db, input.tenantId);
  const title = `${input.sourceLabel}: ${input.count} ilan havuza düştü`;
  const body = "Danışmanı olmayan ilanlar ilan havuzunda öneri listesiyle atama bekliyor.";
  for (const m of managers) {
    if (m.id === input.actorId) continue;
    await safeNotify({ tenantId: input.tenantId, userId: m.id, title, body, href: POOL_HREF, kind: "warning" });
  }
  const target = managers[0]?.id ?? input.actorId;
  if (target) {
    await safeTask(db, {
      tenantId: input.tenantId,
      assignedTo: target,
      createdBy: input.actorId,
      propertyId: input.firstPropertyId,
      title: `Havuzdaki ${input.count} ilana danışman ata`,
      notes: `${body} İlan havuzundan önerilere bakıp atama yapın.`,
    });
  }
}

/** Atama sonrası: atanan danışmana ve (otomatikse) yöneticilere bildirim. */
export async function notifyPoolAssigned(
  db: Db,
  input: { tenantId: string; actorId: string | null; assigneeId: string; propertyId: string; label: string; method: string },
) {
  if (input.assigneeId !== input.actorId) {
    await safeNotify({
      tenantId: input.tenantId,
      userId: input.assigneeId,
      title: `Sana yeni ilan atandı: ${input.label}`,
      body: "İlan sahibi bilgilerini inceleyip yayına hazırla.",
      href: `/app/portfoyler/${input.propertyId}`,
      kind: "success",
    });
  }
  if (input.method === "auto" || input.method === "fallback") {
    for (const m of await loadOfficeManagers(db, input.tenantId)) {
      if (m.id === input.assigneeId) continue;
      await safeNotify({
        tenantId: input.tenantId,
        userId: m.id,
        title: `Havuz ilanı ${input.method === "auto" ? "otomatik" : "yedek zincirle"} atandı: ${input.label}`,
        href: POOL_HREF,
        kind: "info",
      });
    }
  }
}

/** Yeni ilan eklendi: ofis yöneticilerine bildirim; ilan sahibi bilgisi eksikse görev. */
export async function notifyNewListing(
  db: Db,
  input: {
    tenantId: string;
    actorId: string;
    propertyId: string;
    label: string;
    ownerInfoScore: number | null;
    missing: string[];
  },
) {
  const managers = await loadOfficeManagers(db, input.tenantId);
  const incomplete = input.ownerInfoScore != null && input.missing.length > 0;
  for (const m of managers) {
    if (m.id === input.actorId) continue;
    await safeNotify({
      tenantId: input.tenantId,
      userId: m.id,
      title: `Yeni ilan eklendi: ${input.label}`,
      body: input.ownerInfoScore == null ? undefined : `İlan sahibi bilgi tamamlama %${input.ownerInfoScore}${incomplete ? " (yayına alınamaz)" : ""}.`,
      href: `/app/portfoyler/${input.propertyId}`,
      kind: incomplete ? "warning" : "info",
    });
  }
  if (incomplete) {
    const target = managers[0]?.id ?? input.actorId;
    await safeTask(db, {
      tenantId: input.tenantId,
      assignedTo: target,
      createdBy: input.actorId,
      propertyId: input.propertyId,
      title: `İlan sahibi bilgilerini tamamlat: ${input.label}`,
      notes: `Eksik: ${input.missing.join("; ")}. Tamamlanmadan ilan yayına alınamaz.`,
    });
  }
}

/** SLA aşımı / yükseltme uyarısı (yöneticilere). */
export async function notifyPoolBreach(db: Db, input: { tenantId: string; label: string; kind: "sla" | "escalated" }) {
  for (const m of await loadOfficeManagers(db, input.tenantId)) {
    await safeNotify({
      tenantId: input.tenantId,
      userId: m.id,
      title: input.kind === "sla" ? `Havuz SLA aşıldı: ${input.label}` : `Sahiplenilmedi, yönetime döndü: ${input.label}`,
      body: "İlana hâlâ danışman atanmadı.",
      href: POOL_HREF,
      kind: "danger",
    });
  }
}
