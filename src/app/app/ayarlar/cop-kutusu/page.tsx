import Link from "next/link";
import { daysAgoIso } from "@/lib/clock";
import { ArrowLeft, Building2, RotateCcw, Trash2, Users2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { Button } from "@/components/ui/button";
import { restoreCustomer, restoreProperty } from "./actions";

export const metadata = { title: "Çöp kutusu" };

const RETENTION_DAYS = 90;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  });
}

/**
 * Silinen (deleted_at dolu) müşteri ve portföyler — son 90 gün.
 * Geri alma silme yetkisine bağlı (requirePermission delete, action'larda).
 * Kalıcı silme bilinçli olarak yok.
 */
export default async function TrashPage() {
  const ctx = await requireModulePage("settings");
  const canRestoreCustomers = effectiveHasPermission(ctx.perms, "customers", "delete");
  const canRestoreProperties = effectiveHasPermission(ctx.perms, "properties", "delete");

  const since = daysAgoIso(RETENTION_DAYS);
  const supabase = await createClient();
  const [{ data: customerRows }, { data: propertyRows }] = await Promise.all([
    supabase
      .from("customers")
      .select("id, full_name, phone, deleted_at")
      .not("deleted_at", "is", null)
      .gte("deleted_at", since)
      .order("deleted_at", { ascending: false })
      .limit(100),
    supabase
      .from("properties")
      .select("id, title, property_code, deleted_at")
      .not("deleted_at", "is", null)
      .gte("deleted_at", since)
      .order("deleted_at", { ascending: false })
      .limit(100),
  ]);

  const customers = customerRows ?? [];
  const properties = propertyRows ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/app/ayarlar"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted transition hover:text-brand-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Ayarlar
        </Link>
        <h1 className="mt-2 flex items-center gap-2 font-display text-2xl font-extrabold text-ink-950">
          <Trash2 className="h-6 w-6 text-danger-500" /> Çöp kutusu
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Son {RETENTION_DAYS} günde silinen müşteri ve portföyler. Geri alınan kayıtlar listelerine döner;
          kalıcı silme yoktur.
        </p>
      </div>

      {/* Müşteriler */}
      <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-6">
        <div className="flex items-center gap-3 border-b border-line pb-4">
          <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-cyan-400/12 text-cyan-500">
            <Users2 className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display font-bold text-ink-950">Silinen müşteriler</h2>
            <p className="text-xs text-text-muted">{customers.length} kayıt</p>
          </div>
        </div>

        {customers.length === 0 ? (
          <p className="mt-5 text-sm text-text-muted">Son {RETENTION_DAYS} günde silinen müşteri yok.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line/60">
            {customers.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-950">{c.full_name || "İsimsiz müşteri"}</p>
                  <p className="text-xs text-text-muted">
                    {c.phone ? `${c.phone} · ` : ""}Silinme: {c.deleted_at ? formatDate(c.deleted_at) : "—"}
                  </p>
                </div>
                {canRestoreCustomers ? (
                  <form action={restoreCustomer}>
                    <input type="hidden" name="id" value={c.id} />
                    <Button type="submit" variant="secondary" size="sm">
                      <RotateCcw className="h-3.5 w-3.5" /> Geri al
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Portföyler */}
      <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-6">
        <div className="flex items-center gap-3 border-b border-line pb-4">
          <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-amber-400/15 text-amber-500">
            <Building2 className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display font-bold text-ink-950">Silinen portföyler</h2>
            <p className="text-xs text-text-muted">{properties.length} kayıt · geri alınan portföy arşivde görünür</p>
          </div>
        </div>

        {properties.length === 0 ? (
          <p className="mt-5 text-sm text-text-muted">Son {RETENTION_DAYS} günde silinen portföy yok.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line/60">
            {properties.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-950">
                    {p.title || p.property_code || "Başlıksız portföy"}
                  </p>
                  <p className="text-xs text-text-muted">
                    {p.property_code ? `${p.property_code} · ` : ""}Silinme: {p.deleted_at ? formatDate(p.deleted_at) : "—"}
                  </p>
                </div>
                {canRestoreProperties ? (
                  <form action={restoreProperty}>
                    <input type="hidden" name="id" value={p.id} />
                    <Button type="submit" variant="secondary" size="sm">
                      <RotateCcw className="h-3.5 w-3.5" /> Geri al
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {!canRestoreCustomers && !canRestoreProperties ? (
        <p className="rounded-[10px] border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5 text-xs font-medium text-amber-700">
          Kayıtları geri almak için silme yetkisi gerekir. Yetki için ofis yöneticinize başvurun.
        </p>
      ) : null}
    </div>
  );
}
