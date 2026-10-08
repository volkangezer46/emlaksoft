/**
 * Mülk sahibine ödeme günü hatırlatması — `kira-tahakkuk` cron'u çağırır (yeni cron AÇILMAZ).
 * Mevcut `rent_reminders` desenini kullanır: önce (kira, dönem, tür='owner_payout', kanal='office') satırı "kapılır" (dedupe),
 * sonra ofise tek bildirim yazılır. Koşul: ofis kirayı yönetiyor, ödeme günü geldi (gün aşımı en çok 3 gün tolerans) ve ödenecek bakiye > 0.
 * İstemci cron'un mevcut (kabul listesindeki) istemcisidir; burada `createAdminClient` ÇAĞRILMAZ. Tablolar yoksa sessizce atlanır.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOwnerBalances } from "./load";
import { formatTryDecimal } from "@/lib/format";
import { inPayoutWindow } from "./payments";


export async function runOwnerPayoutReminders(input: {
  admin: SupabaseClient;
  tenantIds: readonly string[];
  /** Türkiye günü `YYYY-MM-DD`. */
  today: string;
}): Promise<{ notified: number; schemaMissing: boolean }> {
  const { admin, today } = input;
  const out = { notified: 0, schemaMissing: false };
  const day = Number(today.slice(8, 10));
  const period = `${today.slice(0, 7)}-01`;

  for (const tenantId of input.tenantIds) {
    const { data: agreements, error } = await admin
      .from("rental_management_agreements")
      .select("rental_id, payout_day")
      .eq("tenant_id", tenantId)
      .eq("managed", true)
      .limit(2000);
    if (error) return { ...out, schemaMissing: true };
    const due = ((agreements ?? []) as { rental_id: string; payout_day: number }[]).filter((a) => inPayoutWindow(day, a.payout_day));
    if (due.length === 0) continue;

    const balances = await loadOwnerBalances(admin, { tenantId, rentalIds: due.map((d) => d.rental_id) });
    if (!balances) continue;
    const payable = balances.rows.filter((r) => r.payable > 0);
    if (payable.length === 0) continue;

    // Aktif kiralar + portföy adı (bildirim metni)
    const { data: rentals } = await admin
      .from("rentals")
      .select("id, status, property:properties!rentals_property_id_fkey(property_code, title)")
      .eq("tenant_id", tenantId)
      .in("id", payable.map((p) => p.rentalId));
    const info = new Map<string, { status: string; name: string }>();
    for (const r of (rentals ?? []) as unknown as { id: string; status: string; property: { property_code?: string; title?: string | null } | { property_code?: string; title?: string | null }[] | null }[]) {
      const prop = Array.isArray(r.property) ? r.property[0] : r.property;
      info.set(r.id, { status: r.status, name: prop?.title ?? prop?.property_code ?? "Portföy" });
    }

    for (const row of payable) {
      const meta = info.get(row.rentalId);
      if (!meta) continue;
      const { data: claimed, error: claimErr } = await admin
        .from("rent_reminders")
        .upsert(
          [{ tenant_id: tenantId, rental_id: row.rentalId, period, kind: "owner_payout", channel: "office", status: "queued" }],
          { onConflict: "rental_id,period,kind,channel", ignoreDuplicates: true },
        )
        .select("id");
      if (claimErr) {
        if (["42P01", "42703", "PGRST205", "23514"].includes(String(claimErr.code))) return { ...out, schemaMissing: true };
        console.error("owner-payout reminder claim", { code: claimErr.code });
        continue;
      }
      if ((claimed ?? []).length === 0) continue; // bu ay zaten hatırlatıldı
      const { error: nErr } = await admin.from("notifications").insert({
        tenant_id: tenantId,
        title: "Mülk sahibine ödeme günü",
        body: `${meta.name} · ödenecek hakediş ${formatTryDecimal(row.payable, 2)}`,
        href: `/app/kiralama/${row.rentalId}?sekme=sahip`,
        kind: "info",
      });
      if (nErr) console.error("owner-payout reminder notification", { code: nErr.code });
      else out.notified += 1;
    }
  }
  return out;
}
