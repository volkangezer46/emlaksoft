/**
 * Bina aidatı vade hatırlatması — `kira-tahakkuk` cron'u çağırır (yeni cron AÇILMAZ).
 * Ofise (bildirim) bina başına ÖZET yazar: vadesi 3 gün içinde gelen aidatlar (ay başına bir kez) ve vadesi geçmiş ödenmemişler
 * (haftada bir). Kiracı/malike mesaj GİTMEZ (iletişim izni/IYS kapsamı dışı; yalnız ofis içi bildirim). Mükerrer koruması dedupe_key.
 * Planlama SAF'tır (test edilir); okuma/yazma `runBuildingDueReminders` içindedir.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { dayDiff, fromKurus, toKurus } from "@/lib/property-management/payments";

export const UPCOMING_WINDOW_DAYS = 3;

export type OpenChargeForReminder = {
  tenantId: string;
  buildingId: string;
  buildingName: string;
  amount: number;
  paid: number;
  dueDate: string;
};

export type PlannedReminder = {
  tenantId: string;
  buildingId: string;
  kind: "upcoming" | "overdue";
  count: number;
  amount: number;
  title: string;
  body: string;
  dedupeKey: string;
};

const tl = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);

/** Pazartesi'ye hizalı hafta sırası (2000-01-03 Pazartesi). */
export function weekIndex(day: string): number {
  return Math.floor(dayDiff(day, "2000-01-03") / 7);
}

export function planBuildingDueReminders(rows: readonly OpenChargeForReminder[], today: string): PlannedReminder[] {
  type Acc = { tenantId: string; buildingId: string; name: string; upCount: number; upK: number; lateCount: number; lateK: number };
  const by = new Map<string, Acc>();
  for (const r of rows) {
    const leftK = toKurus(r.amount) - toKurus(r.paid);
    if (leftK <= 0) continue;
    const diff = dayDiff(r.dueDate, today); // pozitif: vade henüz gelmedi
    const upcoming = diff >= 0 && diff <= UPCOMING_WINDOW_DAYS;
    const late = diff < 0;
    if (!upcoming && !late) continue;
    const key = `${r.tenantId}:${r.buildingId}`;
    const a = by.get(key) ?? { tenantId: r.tenantId, buildingId: r.buildingId, name: r.buildingName, upCount: 0, upK: 0, lateCount: 0, lateK: 0 };
    if (upcoming) {
      a.upCount += 1;
      a.upK += leftK;
    } else {
      a.lateCount += 1;
      a.lateK += leftK;
    }
    by.set(key, a);
  }
  const out: PlannedReminder[] = [];
  for (const a of by.values()) {
    if (a.upCount > 0) {
      out.push({
        tenantId: a.tenantId, buildingId: a.buildingId, kind: "upcoming", count: a.upCount, amount: fromKurus(a.upK),
        title: "Bina aidat vadesi yaklaşıyor",
        body: `${a.name} · ${a.upCount} dairenin ${tl(fromKurus(a.upK))} aidatı ${UPCOMING_WINDOW_DAYS} gün içinde vadesinde`,
        dedupeKey: `bldg-due-up:${a.buildingId}:${today.slice(0, 7)}`,
      });
    }
    if (a.lateCount > 0) {
      out.push({
        tenantId: a.tenantId, buildingId: a.buildingId, kind: "overdue", count: a.lateCount, amount: fromKurus(a.lateK),
        title: "Geciken bina aidatları",
        body: `${a.name} · ${a.lateCount} kalemde ${tl(fromKurus(a.lateK))} vadesi geçmiş aidat/gider payı var`,
        dedupeKey: `bldg-due-late:${a.buildingId}:${weekIndex(today)}`,
      });
    }
  }
  return out;
}

/**
 * Cron adımı: açık bina tahakkuklarını okur, planlar ve bildirimleri yazar. Tablolar yoksa (migration uygulanmamış) sessizce 0 döner.
 * `skipTenant`: bina/aidat modülü kapalı ofisleri atlamak için.
 */
export async function runBuildingDueReminders(input: {
  admin: SupabaseClient;
  today: string;
  skipTenant?: (tenantId: string) => boolean;
  /** Bildirim yazıcı (cron'un `insertNotifications` + `findNotifiedKeys` çifti; test için enjekte edilebilir). */
  write: (rows: { tenant_id: string; title: string; body: string; href: string; kind: string; dedupe_key: string }[]) => Promise<number>;
  findSeen: (tenantIds: string[], keys: string[]) => Promise<Set<string> | null>;
}): Promise<{ notified: number; schemaMissing: boolean }> {
  const { admin, today } = input;
  const windowEnd = new Date(Date.parse(`${today}T00:00:00Z`) + UPCOMING_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await admin
    .from("building_charges")
    .select("tenant_id, building_id, amount, paid_amount, due_date, building:buildings!building_charges_building_tenant_fkey(name, archived_at)")
    .neq("status", "paid")
    .is("voided_at", null)
    .lte("due_date", windowEnd)
    .limit(5000);
  if (error) return { notified: 0, schemaMissing: ["42P01", "42703", "PGRST200", "PGRST205"].includes(String(error.code)) };
  const rows: OpenChargeForReminder[] = [];
  for (const r of (data ?? []) as unknown as { tenant_id: string; building_id: string; amount: number | string; paid_amount: number | string; due_date: string; building: { name: string; archived_at: string | null } | { name: string; archived_at: string | null }[] | null }[]) {
    if (input.skipTenant?.(r.tenant_id)) continue;
    const b = Array.isArray(r.building) ? r.building[0] : r.building;
    if (!b || b.archived_at) continue;
    rows.push({ tenantId: r.tenant_id, buildingId: r.building_id, buildingName: b.name, amount: Number(r.amount), paid: Number(r.paid_amount), dueDate: String(r.due_date).slice(0, 10) });
  }
  const plan = planBuildingDueReminders(rows, today);
  if (plan.length === 0) return { notified: 0, schemaMissing: false };
  const seen = (await input.findSeen([...new Set(plan.map((p) => p.tenantId))], plan.map((p) => p.dedupeKey))) ?? new Set<string>();
  const fresh = plan.filter((p) => !seen.has(p.dedupeKey));
  if (fresh.length === 0) return { notified: 0, schemaMissing: false };
  const notified = await input.write(
    fresh.map((p) => ({
      tenant_id: p.tenantId,
      title: p.title,
      body: p.body,
      href: `/app/aidat?sekme=binalar&bina=${p.buildingId}&bolum=tahsilat`,
      kind: p.kind === "overdue" ? "warning" : "info",
      dedupe_key: p.dedupeKey,
    })),
  );
  return { notified, schemaMissing: false };
}
