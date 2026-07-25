import Link from "next/link";
import { Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { BarCompare, ChartFrame } from "@/components/ui/chart";

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

function pct(a: number, b: number) {
  if (!b) return "—";
  return `%${Math.round((a / b) * 100)}`;
}

type AdvisorKpi = {
  id:             string;
  full_name:      string;
  role:           string;
  customerCount:  number;
  callCount:      number;
  appointCount:   number;
  offerCount:     number;
  dealCount:      number;
  revenue:        number;
  conversionRate: string;
  score:          number;
};

export default async function DanismanKpiPage() {
  const { tenantId } = await requireModulePage("reports");
  const supabase = await createClient();

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  // Profiller + tek round-trip aggregate RPC (5 tablo, Postgres tarafında toplanır)
  const [{ data: profiles }, { data: kpiRows }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role").limit(50),
    supabase.rpc("advisor_kpis", { p_tenant_id: tenantId, p_month_start: monthStart.toISOString() }),
  ]);

  const kpiByUid = new Map<string, {
    customer_count: number; call_count: number; appoint_count: number;
    offer_count: number; deal_count: number; revenue: number;
  }>();
  for (const r of (kpiRows ?? []) as Array<Record<string, unknown>>) {
    kpiByUid.set(String(r.assigned_to), {
      customer_count: Number(r.customer_count ?? 0),
      call_count:     Number(r.call_count ?? 0),
      appoint_count:  Number(r.appoint_count ?? 0),
      offer_count:    Number(r.offer_count ?? 0),
      deal_count:     Number(r.deal_count ?? 0),
      revenue:        Number(r.revenue ?? 0),
    });
  }

  // Danışman bazlı hesapla
  const advisorMap = new Map<string, AdvisorKpi>();

  for (const p of profiles ?? []) {
    if (!["advisor", "team_lead", "branch_manager", "gm", "owner"].includes(p.role)) continue;
    const k = kpiByUid.get(p.id);
    advisorMap.set(p.id, {
      id:             p.id,
      full_name:      p.full_name,
      role:           p.role,
      customerCount:  k?.customer_count ?? 0,
      callCount:      k?.call_count ?? 0,
      appointCount:   k?.appoint_count ?? 0,
      offerCount:     k?.offer_count ?? 0,
      dealCount:      k?.deal_count ?? 0,
      revenue:        k?.revenue ?? 0,
      conversionRate: "—",
      score:          0,
    });
  }

  // Dönüşüm oranı + skor
  for (const [, adv] of advisorMap) {
    adv.conversionRate = pct(adv.dealCount, adv.offerCount);
    // Skor: ağırlıklı (çağrı×1 + randevu×2 + teklif×3 + satış×10 + gelir/10000)
    adv.score = Math.round(
      adv.callCount * 1 +
      adv.appointCount * 2 +
      adv.offerCount * 3 +
      adv.dealCount * 10 +
      adv.revenue / 10_000,
    );
  }

  const advisors = [...advisorMap.values()]
    .sort((a, b) => b.score - a.score);

  const topScore = Math.max(1, ...advisors.map((a) => a.score));

  // Grafik verisi: geliri olan ilk 8 danışman (düz, serileştirilebilir dizi)
  const revenueChart = advisors
    .filter((a) => a.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8)
    .map((a) => ({ name: a.full_name, revenue: a.revenue }));

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
              <Trophy className="h-4 w-4" /> Bu ay sıralaması
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Danışman KPI Paneli</h1>
            <p className="mt-1 text-sm text-white/75">Bu ayki aktivite, teklif ve gelir performansı.</p>
          </div>
          <div className="flex gap-3">
            {[
              { label: "Danışman", value: advisors.length },
              { label: "Toplam gelir", value: money(advisors.reduce((s, a) => s + a.revenue, 0)) },
              { label: "Toplam satış", value: advisors.reduce((s, a) => s + a.dealCount, 0) },
            ].map((k) => (
              <div key={k.label} className="rounded-[14px] border border-white/12 bg-white/8 p-3 text-center">
                <p className="font-display text-xl font-extrabold text-white">{k.value}</p>
                <p className="text-[10px] text-white/70">{k.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Gelir kırılımı — tabloyu okumadan önce tek bakışta sıralama.
          Bilinçli olarak tek seri: gelir (₺) ile satış adedi aynı eksende
          gösterilse ölçek farkı yüzünden yanıltıcı olurdu. */}
      {revenueChart.length > 0 ? (
        <ChartFrame
          title="Danışman bazlı gelir"
          subtitle="Bu ay · en yüksek 8 danışman"
          height={Math.max(200, revenueChart.length * 38)}
        >
          <BarCompare
            data={revenueChart}
            xKey="name"
            layout="horizontal"
            format="money"
            series={[{ key: "revenue", label: "Gelir" }]}
          />
        </ChartFrame>
      ) : null}

      {advisors.length === 0 ? (
        <p className="py-12 text-center text-sm text-text-muted">Danışman kaydı bulunamadı.</p>
      ) : (
        <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-line bg-canvas/80 text-xs text-text-muted">
                <tr>
                  <th className="px-5 py-3 font-semibold">#</th>
                  <th className="px-4 py-3 font-semibold">Danışman</th>
                  <th className="px-4 py-3 font-semibold">Müşteri</th>
                  <th className="px-4 py-3 font-semibold">Çağrı</th>
                  <th className="px-4 py-3 font-semibold">Randevu</th>
                  <th className="px-4 py-3 font-semibold">Teklif</th>
                  <th className="px-4 py-3 font-semibold">Satış</th>
                  <th className="px-4 py-3 font-semibold">Dönüşüm</th>
                  <th className="px-4 py-3 font-semibold">Gelir</th>
                  <th className="px-4 py-3 font-semibold">Skor</th>
                </tr>
              </thead>
              <tbody>
                {advisors.map((a, i) => (
                  <tr key={a.id} className="group relative cursor-pointer border-b border-line last:border-0 hover:bg-brand-600/[0.03] transition">
                    <td className="px-5 py-3.5">
                      <span className={`font-display font-bold ${i === 0 ? "text-amber-500" : i === 1 ? "text-zinc-400" : i === 2 ? "text-amber-700" : "text-text-faint"}`}>
                        {i + 1}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <Link href={`/app/ekip/${a.id}`} className="absolute inset-0" aria-label={`${a.full_name} danışman detayı`} />
                      <p className="font-semibold text-ink-950 group-hover:text-brand-600">{a.full_name}</p>
                      <p className="text-[10px] text-text-faint capitalize">{a.role}</p>
                    </td>
                    <td className="px-4 py-3.5 text-text-muted">{a.customerCount}</td>
                    <td className="px-4 py-3.5 text-text-muted">{a.callCount}</td>
                    <td className="px-4 py-3.5 text-text-muted">{a.appointCount}</td>
                    <td className="px-4 py-3.5 text-text-muted">{a.offerCount}</td>
                    <td className="px-4 py-3.5 font-semibold text-ink-950">{a.dealCount}</td>
                    <td className="px-4 py-3.5 text-text-muted">{a.conversionRate}</td>
                    <td className="px-4 py-3.5 font-bold text-mint-700">{a.revenue > 0 ? money(a.revenue) : "—"}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-line">
                          <div
                            className="h-full rounded-full bg-brand-600"
                            style={{ width: `${(a.score / topScore) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-ink-950">{a.score}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
