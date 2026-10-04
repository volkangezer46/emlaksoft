import { PageHeader } from "@/components/ui/page-header";
import { EmptyStateV3 } from "@/components/ui/empty-state-v3";
import Link from "next/link";
import { daysAgoIso } from "@/lib/clock";
import { Building2, RotateCcw, Trash2, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { Button } from "@/components/ui/button";
import { restoreCustomer, restoreProperty } from "./actions";
import { formatDateTimeTr } from "@/lib/format";

export const metadata = { title: "Çöp kutusu" };

const RETENTION_DAYS = 90;

function formatDate(iso: string): string {
  return formatDateTimeTr(iso, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Silinen (deleted_at dolu) müşteri ve portföyler — son 90 gün.
 * Geri alma silme yetkisine bağlı (requirePermission delete, action'larda).
 * Kalıcı silme bilinçli olarak yok.
 */
export default async function TrashPage() {
  // Kapı müşteri modülüdür (ayar yetkisi aranmaz): kaydı silen danışman kendi kaydını geri alabilir.
  // Geri alma yetkisi her varlıkta kendi modülünün silme izniyle action içinde de doğrulanır.
  const ctx = await requireModulePage("customers");
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

  // Kim sildi: denetim kaydından (okuma yetkisi yoksa boş kalır, sayfa bozulmaz)
  const ids = [...customers.map((c) => c.id), ...properties.map((p) => p.id)];
  const deleters = new Map<string, string>();
  if (ids.length > 0) {
    const { data: logs } = await supabase
      .from("audit_logs")
      .select("entity_id, actor_id, created_at")
      .in("action", ["customer.delete", "customer.bulk_delete", "property.delete"])
      .in("entity_id", ids)
      .order("created_at", { ascending: false })
      .limit(500);
    const actorIds = [...new Set((logs ?? []).map((l) => l.actor_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", actorIds);
      for (const pr of profs ?? []) names.set(pr.id, pr.full_name);
    }
    for (const l of logs ?? []) {
      if (l.entity_id && l.actor_id && !deleters.has(l.entity_id)) deleters.set(l.entity_id, names.get(l.actor_id) ?? "");
    }
  }
  const byLine = (id: string) => (deleters.get(id) ? ` · Silen: ${deleters.get(id)}` : "");

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Ayarlar", href: "/app/ayarlar" }, { label: "Çöp kutusu" }]}
        icon={
          <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-danger-500/10 text-danger-600">
            <Trash2 className="h-5 w-5" />
          </span>
        }
        title="Çöp kutusu"
        description={`Son ${RETENTION_DAYS} günde silinen müşteri ve portföyler. Geri alınan kayıtlar listelerine döner; kalıcı silme yoktur.`}
        className="mb-0"
      />

      {/* Müşteriler */}
      <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:p-6">
        <div className="flex items-center gap-3 border-b border-line pb-4">
          <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-cyan-400/12 text-cyan-500">
            <Users className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display font-bold text-ink-950">Silinen müşteriler</h2>
            <p className="text-xs text-text-muted">{customers.length} kayıt</p>
          </div>
        </div>

        {customers.length === 0 ? (
          <EmptyStateV3 className="mt-4" variant="compact" icon={<Users />} title="Silinen müşteri yok" description={`Son ${RETENTION_DAYS} günde silinen müşteri bulunmuyor.`} action={<Link href="/app/musteriler" className="text-xs font-semibold text-brand-600 hover:underline">Müşterilere git</Link>} />
        ) : (
          <ul className="mt-4 divide-y divide-line/60">
            {customers.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-950">{c.full_name || "İsimsiz müşteri"}</p>
                  <p className="text-xs text-text-muted">
                    {c.phone ? `${c.phone} · ` : ""}Silinme: {c.deleted_at ? formatDate(c.deleted_at) : "—"}{byLine(c.id)}
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
      <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:p-6">
        <div className="flex items-center gap-3 border-b border-line pb-4">
          <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-amber-400/15 text-amber-500">
            <Building2 className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display font-bold text-ink-950">Silinen portföyler</h2>
            <p className="text-xs text-text-muted">{properties.length} kayıt · geri alınan portföy arşivde görünür</p>
          </div>
        </div>

        {properties.length === 0 ? (
          <EmptyStateV3 className="mt-4" variant="compact" icon={<Trash2 />} title="Silinen portföy yok" description={`Son ${RETENTION_DAYS} günde silinen portföy bulunmuyor.`} action={<Link href="/app/portfoyler" className="text-xs font-semibold text-brand-600 hover:underline">Portföylere git</Link>} />
        ) : (
          <ul className="mt-4 divide-y divide-line/60">
            {properties.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-950">
                    {p.title || p.property_code || "Başlıksız portföy"}
                  </p>
                  <p className="text-xs text-text-muted">
                    {p.property_code ? `${p.property_code} · ` : ""}Silinme: {p.deleted_at ? formatDate(p.deleted_at) : "—"}{byLine(p.id)}
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
        <p className="rounded-[var(--radius-control)] border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5 text-xs font-medium text-amber-700">
          Kayıtları geri almak için silme yetkisi gerekir. Yetki için ofis yöneticinize başvurun.
        </p>
      ) : null}
    </div>
  );
}
