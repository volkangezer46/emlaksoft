import Link from "next/link";
import { Building2, Network, TrendingUp, Users, Home, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { computeOfficeScore, loadOfficeScoreInputs } from "@/lib/office-score";
import { moneyTry } from "@/lib/leak-shield";

/**
 * Faz 6 / D1: Franchise BI — gerçek şube rollup.
 * Tek şube varsa ofis skoru + tek özet; çok şube varsa şube bazlı kırılım.
 */
export default async function FranchiseBiPage() {
  await requireModulePage("reports");
  const supabase = await createClient();
  const inputs = await loadOfficeScoreInputs(supabase);
  const office = computeOfficeScore(inputs);

  const [{ data: tenant }, { data: branches }, { data: properties }, { data: customers }, { data: profiles }, { data: deals }, { data: closures }] =
    await Promise.all([
      supabase.from("tenants").select("name, plan").limit(1).maybeSingle(),
      supabase.from("branches").select("id, name, is_active").eq("is_active", true).order("name").limit(50),
      supabase.from("properties").select("id, branch_id").is("deleted_at", null).limit(2000),
      supabase.from("customers").select("id, branch_id").is("deleted_at", null).limit(2000),
      supabase.from("profiles").select("id, branch_id, full_name").eq("is_active", true).limit(200),
      supabase.from("deals").select("id, assigned_to, deal_value, stage").limit(500),
      supabase
        .from("listing_closures")
        .select("estimated_lost_commission, deal_happened, portal_listing:portal_listings(property:properties(branch_id))")
        .limit(500),
    ]);

  const branchList = branches ?? [];
  const advisorBranch = new Map((profiles ?? []).map((p) => [p.id, p.branch_id as string | null]));

  type Row = { id: string; name: string; properties: number; customers: number; advisors: number; won: number; wonValue: number; lost: number };
  const rollup = new Map<string, Row>();
  for (const b of branchList) {
    rollup.set(b.id, { id: b.id, name: b.name, properties: 0, customers: 0, advisors: 0, won: 0, wonValue: 0, lost: 0 });
  }
  const unassigned: Row = { id: "unassigned", name: "Şubesiz", properties: 0, customers: 0, advisors: 0, won: 0, wonValue: 0, lost: 0 };
  const bucket = (id: string | null) => (id && rollup.has(id) ? rollup.get(id)! : unassigned);

  (properties ?? []).forEach((p) => { bucket(p.branch_id as string | null).properties += 1; });
  (customers ?? []).forEach((c) => { bucket(c.branch_id as string | null).customers += 1; });
  (profiles ?? []).forEach((p) => { bucket(p.branch_id as string | null).advisors += 1; });
  (deals ?? []).forEach((d) => {
    if (d.stage !== "won") return;
    const row = bucket(advisorBranch.get(d.assigned_to as string) ?? null);
    row.won += 1;
    row.wonValue += Number(d.deal_value || 0);
  });
  (closures ?? []).forEach((c) => {
    const pl = c.portal_listing as { property?: { branch_id?: string | null } | { branch_id?: string | null }[] } | { property?: { branch_id?: string | null } | { branch_id?: string | null }[] }[] | null;
    const plObj = Array.isArray(pl) ? pl[0] : pl;
    const propRel = plObj?.property;
    const prop = Array.isArray(propRel) ? propRel[0] : propRel;
    bucket(prop?.branch_id ?? null).lost += Number(c.estimated_lost_commission || 0);
  });

  const totalLost = [...rollup.values(), unassigned].reduce((s, r) => s + r.lost, 0);
  const maxLost = Math.max(1, ...[...rollup.values(), unassigned].map((r) => r.lost));

  const rows = [...rollup.values(), ...(unassigned.properties || unassigned.customers || unassigned.advisors ? [unassigned] : [])]
    .sort((a, b) => b.wonValue - a.wonValue);
  const isMultiBranch = branchList.length > 1;

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="relative">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300">
            <Network className="h-3.5 w-3.5" /> Şube analitiği
          </p>
          <h1 className="mt-2 font-display text-3xl font-extrabold">{tenant?.name ?? "Ofis ağı"}</h1>
          <p className="mt-2 max-w-xl text-sm text-white/60">
            {isMultiBranch
              ? "Şube bazlı canlı rollup: portföy, müşteri, danışman ve kazanılan işlem hacmi."
              : "Şu an tek şube aktif. İkinci şubeyi eklediğinizde bu ekran otomatik olarak şube kıyaslamasına geçer."}
          </p>
        </div>
        <div className="relative mt-6 grid gap-3 sm:grid-cols-3">
          {[
            { label: "Ofis skoru", value: office.score, icon: TrendingUp },
            { label: "Şube", value: branchList.length, icon: Building2 },
            { label: "Paket", value: tenant?.plan ?? "—", icon: Network },
          ].map((k) => (
            <div key={k.label} className="rounded-[14px] border border-white/10 bg-white/5 p-4">
              <k.icon className="h-4 w-4 text-mint-400" />
              <p className="mt-2 font-display text-2xl font-extrabold">{k.value}</p>
              <p className="text-[11px] text-white/45">{k.label}</p>
            </div>
          ))}
        </div>
      </section>

      {rows.length === 0 ? (
        <section className="rounded-[20px] border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
          <h2 className="font-display text-lg font-bold text-ink-950">Henüz şube verisi yok</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-text-muted">
            Ayarlar → Ekip bölümünden şube ekleyin; portföy ve müşterileri şubeye atayınca burada rollup görünür.
          </p>
          <Link href="/app/ekip" className="mt-5 inline-flex rounded-[10px] bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white">
            Ekip &amp; şube ayarlarına git
          </Link>
        </section>
      ) : (
        <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Building2 className="h-4 w-4 text-brand-600" /> Şube rollup
            </h2>
            <span className="text-xs text-text-muted">{rows.length} kayıt</span>
          </div>
          <div className="divide-y divide-line">
            {rows.map((r) => (
              <div key={r.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[1.3fr_.7fr_.7fr_.7fr_.9fr] sm:items-center">
                <p className="font-semibold text-ink-950">{r.name}</p>
                <div className="flex items-center gap-1.5 text-xs text-text-muted">
                  <Home className="h-3.5 w-3.5" /> {r.properties} portföy
                </div>
                <div className="flex items-center gap-1.5 text-xs text-text-muted">
                  <Users className="h-3.5 w-3.5" /> {r.customers} müşteri · {r.advisors} danışman
                </div>
                <div className="text-xs text-text-muted">{r.won} kazanılan işlem</div>
                <div className="flex items-center gap-1.5 text-right text-sm font-bold text-mint-600 sm:justify-end">
                  <Wallet className="h-3.5 w-3.5" /> {moneyTry(r.wonValue)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <Wallet className="h-4 w-4 text-danger-500" /> Şube bazlı kayıp-kaçak
          </h2>
          <span className="text-sm font-bold text-danger-500">{moneyTry(totalLost)}</span>
        </div>
        {totalLost <= 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-text-muted">Henüz kayıp-kaçak kaydı yok. Portal kapanışları burada şube bazında konsolide edilir.</p>
            <Link href="/app/kayip-kacak" className="mt-3 inline-flex text-xs font-semibold text-brand-600 hover:underline">
              Kayıp-kaçak modülüne git →
            </Link>
          </div>
        ) : (
          <div className="space-y-3 p-5">
            {[...rollup.values(), unassigned]
              .filter((r) => r.lost > 0)
              .sort((a, b) => b.lost - a.lost)
              .map((r) => (
                <div key={r.id} className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <div className="min-w-0">
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="truncate font-semibold text-ink-950">{r.name}</span>
                      <span className="tabular-nums font-bold text-danger-500">{moneyTry(r.lost)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-canvas">
                      <div className="h-full rounded-full bg-danger-500/70" style={{ width: `${Math.max((r.lost / maxLost) * 100, 4)}%` }} />
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>
    </div>
  );
}
