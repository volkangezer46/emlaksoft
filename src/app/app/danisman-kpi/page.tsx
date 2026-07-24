import Link from "next/link";
import { TrendingUp, Users, Phone, Target, Trophy, BarChart3 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";

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
  await requireModulePage("reports");
  const supabase = await createClient();

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [
    { data: profiles },
    { data: customers },
    { data: calls },
    { data: appointments },
    { data: offers },
    { data: commissions },
  ] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role").limit(50),
    supabase.from("customers").select("id, assigned_to").is("deleted_at", null).limit(5000),
    supabase.from("calls").select("id, handled_by").gte("started_at", monthStart.toISOString()).limit(5000),
    supabase.from("appointments").select("id, assigned_to, status").gte("scheduled_at", monthStart.toISOString()).limit(5000),
    supabase.from("offers").select("id, created_by, status, amount").gte("created_at", monthStart.toISOString()).limit(5000),
    supabase
      .from("commissions")
      .select("id, gross_amount, status, deal:deals(assigned_to)")
      .gte("created_at", monthStart.toISOString())
      .in("status", ["paid", "collected"])
      .limit(5000),
  ]);

  // Danışman bazlı hesapla
  const advisorMap = new Map<string, AdvisorKpi>();

  for (const p of profiles ?? []) {
    if (!["advisor", "team_lead", "branch_manager", "gm", "owner"].includes(p.role)) continue;
    advisorMap.set(p.id, {
      id:             p.id,
      full_name:      p.full_name,
      role:           p.role,
      customerCount:  0,
      callCount:      0,
      appointCount:   0,
      offerCount:     0,
      dealCount:      0,
      revenue:        0,
      conversionRate: "—",
      score:          0,
    });
  }

  for (const c of customers ?? []) {
    if (c.assigned_to && advisorMap.has(c.assigned_to)) {
      advisorMap.get(c.assigned_to)!.customerCount++;
    }
  }
  for (const c of calls ?? []) {
    if (c.handled_by && advisorMap.has(c.handled_by)) {
      advisorMap.get(c.handled_by)!.callCount++;
    }
  }
  for (const a of appointments ?? []) {
    if (a.assigned_to && advisorMap.has(a.assigned_to)) {
      advisorMap.get(a.assigned_to)!.appointCount++;
    }
  }
  for (const o of offers ?? []) {
    if (o.created_by && advisorMap.has(o.created_by)) {
      const adv = advisorMap.get(o.created_by)!;
      adv.offerCount++;
      if (o.status === "accepted") adv.dealCount++;
    }
  }
  for (const c of commissions ?? []) {
    const assignedTo = Array.isArray(c.deal) ? c.deal[0]?.assigned_to : (c.deal as {assigned_to?: string} | null)?.assigned_to;
    if (assignedTo && advisorMap.has(assignedTo)) {
      advisorMap.get(assignedTo)!.revenue += Number(c.gross_amount ?? 0);
    }
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
