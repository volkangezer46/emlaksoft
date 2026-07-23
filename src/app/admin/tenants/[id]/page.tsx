import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, Download, ShieldAlert, Users, Wallet } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { stopImpersonation } from "@/app/actions/platform";

export default async function AdminTenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformModule("tenants");
  const { id } = await params;
  const admin = createAdminClient();

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, plan, status, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!tenant) notFound();

  const [{ count: customers }, { count: properties }, { data: sub }, { count: tickets }] = await Promise.all([
    admin.from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", id).is("deleted_at", null),
    admin.from("properties").select("id", { count: "exact", head: true }).eq("tenant_id", id),
    admin.from("subscriptions").select("status, amount_try, plan").eq("tenant_id", id).maybeSingle(),
    admin.from("support_tickets").select("id", { count: "exact", head: true }).eq("tenant_id", id).in("status", ["open", "in_progress", "waiting"]),
  ]);

  return (
    <div className="space-y-6">
      <Link href="/admin/tenants" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Ofis listesi
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300">Ofis kimliğiyle önizleme</p>
            <h1 className="mt-2 font-display text-3xl font-extrabold">{tenant.name}</h1>
            <p className="mt-1 text-sm text-white/60">
              {tenant.plan} · {tenant.status} · yönetici erişimiyle güvenli okuma
            </p>
          </div>
          <form action={stopImpersonation}>
            <button type="submit" className="rounded-[10px] bg-white px-4 py-2.5 text-sm font-semibold text-ink-950">
              Önizlemeyi bitir
            </button>
          </form>
        </div>
        <div className="relative mt-6 grid gap-3 sm:grid-cols-4">
          {[
            { label: "Müşteri", value: customers ?? 0, icon: Users },
            { label: "Portföy", value: properties ?? 0, icon: Building2 },
            { label: "Açık talep", value: tickets ?? 0, icon: Wallet },
            { label: "Abonelik", value: sub?.status ?? "—", icon: Wallet },
          ].map((k) => (
            <div key={k.label} className="rounded-[14px] border border-white/10 bg-white/5 p-4">
              <k.icon className="h-4 w-4 text-mint-400" />
              <p className="mt-2 font-display text-xl font-extrabold">{k.value}</p>
              <p className="text-[11px] text-white/45">{k.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[20px] border border-warn-500/30 bg-warn-500/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-warn-500/15 text-warn-600">
              <ShieldAlert className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display font-bold text-ink-950">Ayrılış & arşiv kasası</h2>
              <p className="mt-0.5 max-w-md text-xs text-text-muted">
                Sözleşme sonu / iptal durumunda tüm ofis verisini (müşteri, portföy, anlaşma, komisyon, dosya
                listesi) tek veri paketi olarak indirin — müşteriye teslim veya arşivleme için.
              </p>
            </div>
          </div>
          <a
            href={`/api/admin/tenants/${tenant.id}/export`}
            className="inline-flex shrink-0 items-center gap-2 rounded-[10px] bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-800"
          >
            <Download className="h-4 w-4" /> Veri paketini indir
          </a>
        </div>
      </section>
    </div>
  );
}
