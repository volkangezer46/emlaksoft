import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import type { SeatSubscriberRow } from "@/lib/billing/seat-analytics";

type Admin = ReturnType<typeof createAdminClient>;

export type SeatDataResult = {
  rows: SeatSubscriberRow[];
  /** subscriptions.extra_seats okunabildi mi (migration uygulanmadıysa false: genişleme ölçümü "etkin değil"). */
  extraSeatsEnabled: boolean;
  /** subscriptions.price_lock_try okunabildi mi (false: hiçbir abonelik kilitli sayılmaz). */
  priceLockEnabled: boolean;
};

type RawSub = {
  tenant_id: string;
  plan: string;
  status: string;
  billing_cycle: string | null;
  amount_try: number | string | null;
  extra_seats?: number | null;
  price_lock_try?: number | string | null;
};

const BASE_COLS = "tenant_id, plan, status, billing_cycle, amount_try";

/**
 * Abonelik + aktif kullanıcı sayımı. Şema yoksa (extra_seats / price_lock_try sütunu) sütunsuz sorguya
 * zarifçe düşer ve `*Enabled=false` döner. Mevcut service-role istemcisi çağırandan alınır (yeni istemci açmaz).
 */
export async function loadSeatSubscriberRows(admin: Admin): Promise<SeatDataResult> {
  let extraSeatsEnabled = true;
  let priceLockEnabled = true;
  let subs: RawSub[] | null = null;

  const attempts: { cols: string; extra: boolean; lock: boolean }[] = [
    { cols: `${BASE_COLS}, extra_seats, price_lock_try`, extra: true, lock: true },
    { cols: `${BASE_COLS}, price_lock_try`, extra: false, lock: true },
    { cols: `${BASE_COLS}, extra_seats`, extra: true, lock: false },
    { cols: BASE_COLS, extra: false, lock: false },
  ];
  for (const a of attempts) {
    const { data, error } = await admin.from("subscriptions").select(a.cols).limit(5000);
    if (!error) {
      subs = (data ?? []) as unknown as RawSub[];
      extraSeatsEnabled = a.extra;
      priceLockEnabled = a.lock;
      break;
    }
  }
  if (!subs) return { rows: [], extraSeatsEnabled: false, priceLockEnabled: false };

  const ids = [...new Set(subs.map((s) => s.tenant_id))];
  const names = new Map<string, string>();
  const used = new Map<string, number>();
  if (ids.length > 0) {
    const [{ data: tenants }, { data: profiles }] = await Promise.all([
      admin.from("tenants").select("id, name").limit(5000),
      admin.from("profiles").select("tenant_id").eq("is_active", true).limit(50000),
    ]);
    for (const t of tenants ?? []) names.set(String(t.id), String(t.name ?? ""));
    for (const p of profiles ?? []) {
      const k = String(p.tenant_id);
      used.set(k, (used.get(k) ?? 0) + 1);
    }
  }

  const rows: SeatSubscriberRow[] = subs.map((s) => ({
    tenantId: s.tenant_id,
    tenantName: names.get(s.tenant_id) || "Ofis",
    plan: String(s.plan),
    status: String(s.status),
    cycle: s.billing_cycle === "yearly" ? "yearly" : "monthly",
    amountTry: Number(s.amount_try ?? 0),
    extraSeats: extraSeatsEnabled ? Number(s.extra_seats ?? 0) : null,
    usedSeats: used.get(s.tenant_id) ?? 0,
    locked: priceLockEnabled && Number(s.price_lock_try ?? 0) > 0,
  }));
  return { rows, extraSeatsEnabled, priceLockEnabled };
}
