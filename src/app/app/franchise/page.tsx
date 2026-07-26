import Link from "next/link";
import { ArrowUpRight, Building2, CalendarRange, Network, TrendingUp, Users, Home, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { computeOfficeScore, loadOfficeScoreInputs } from "@/lib/office-score";
import { moneyTry } from "@/lib/leak-shield";
import { ChartFrame, BarCompare } from "@/components/ui/chart";

/**
 * Faz 6 / D1: Franchise BI — gerçek şube rollup.
 * Tek şube varsa ofis skoru + tek özet; çok şube varsa şube bazlı kırılım.
 * ?from=&to= dönem filtresi: anlaşma (kazanılan hacim) ve kayıp-kaçak sorguları
 * aralıkla süzülür; varsayılan davranış tüm zamanlar (giderler sayfası deseni).
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function tarihKisa(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${iso}T00:00:00`));
}

/** Boş olmayan paramlardan query string üretir. */
function qs(params: Record<string, string | null | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export default async function FranchiseBiPage({
  searchParams,
}: {
  searchParams?: Promise<{ from?: string; to?: string }>;
}) {
  await requireModulePage("reports");
  const supabase = await createClient();

  // Dönem filtresi — geçersiz değer sessizce yok sayılır, tüm zamanlara düşer.
  const params = (await searchParams) ?? {};
  const fromF = ISO_DATE.test(params.from ?? "") ? params.from! : null;
  const toF = ISO_DATE.test(params.to ?? "") ? params.to! : null;
  const hasRange = Boolean(fromF || toF);
  // timestamptz kolonlara kapalı gün aralığı: from günü 00:00'dan, to günü sonuna dek.
  const fromIso = fromF ? `${fromF}T00:00:00` : null;
  const toIso = toF ? `${toF}T23:59:59.999` : null;

  // Hızlı çipler — sunucu saatine göre (giderler sayfası deseni)
  const bugun = new Date();
  const ceyrekBas = new Date(bugun.getFullYear(), Math.floor(bugun.getMonth() / 3) * 3, 1);
  const presets = [
    { label: "Bu ay", from: fmtDate(new Date(bugun.getFullYear(), bugun.getMonth(), 1)), to: fmtDate(bugun) },
    { label: "Bu çeyrek", from: fmtDate(ceyrekBas), to: fmtDate(bugun) },
    { label: "Bu yıl", from: fmtDate(new Date(bugun.getFullYear(), 0, 1)), to: fmtDate(bugun) },
  ];

  // Rollup tablosundaki dönem etiketi
  const donemLabel = !hasRange
    ? "Tüm zamanlar"
    : presets.find((p) => p.from === fromF && p.to === toF)?.label ??
      `${fromF ? tarihKisa(fromF) : "…"} — ${toF ? tarihKisa(toF) : "…"}`;

  // Dönem yalnız işlem akışına uygulanır (deals/closures); portföy, müşteri ve
  // danışman sayıları anlık envanterdir — tarihle süzülmez.
  let dealsQuery = supabase.from("deals").select("id, assigned_to, deal_value, stage, created_at").limit(500);
  if (fromIso) dealsQuery = dealsQuery.gte("created_at", fromIso);
  if (toIso) dealsQuery = dealsQuery.lte("created_at", toIso);
  let closuresQuery = supabase
    .from("listing_closures")
    .select("estimated_lost_commission, deal_happened, created_at, portal_listing:portal_listings(property:properties(branch_id))")
    .limit(500);
  if (fromIso) closuresQuery = closuresQuery.gte("created_at", fromIso);
  if (toIso) closuresQuery = closuresQuery.lte("created_at", toIso);

  const [inputs, { data: tenant }, { data: branches }, { data: properties }, { data: customers }, { data: profiles }, { data: deals }, { data: closures }] =
    await Promise.all([
      loadOfficeScoreInputs(supabase),
      supabase.from("tenants").select("name, plan").limit(1).maybeSingle(),
      supabase.from("branches").select("id, name, is_active").eq("is_active", true).order("name").limit(50),
      supabase.from("properties").select("id, branch_id").is("deleted_at", null).limit(2000),
      supabase.from("customers").select("id, branch_id").is("deleted_at", null).limit(2000),
      supabase.from("profiles").select("id, branch_id, full_name").eq("is_active", true).limit(200),
      dealsQuery,
      closuresQuery,
    ]);

  const office = computeOfficeScore(inputs);
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

  // Dönem korunarak link üretici (çip + temizle)
  const href = (next: { from?: string | null; to?: string | null }) =>
    `/app/franchise${qs({
      from: next.from === undefined ? fromF : next.from,
      to: next.to === undefined ? toF : next.to,
    })}`;

  // Şube karşılaştırma grafikleri — düz, serileştirilebilir diziler.
  // Hacim grafiği yalnız kazanılan hacmi olan şubeleri, portföy grafiği yalnız
  // portföyü olan şubeleri gösterir; ikisi de boşsa grafik bölümü tümden gizli.
  const volumeChart = rows.filter((r) => r.wonValue > 0).map((r) => ({ name: r.name, hacim: Math.round(r.wonValue) }));
  const portfolioChart = rows.filter((r) => r.properties > 0).map((r) => ({ name: r.name, portfoy: r.properties }));

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
            { label: "Ofis skoru", value: office.score, icon: TrendingUp, href: "/app/raporlar" },
            { label: "Şube", value: branchList.length, icon: Building2, href: "/app/ekip#subeler" },
            { label: "Paket", value: tenant?.plan ?? "—", icon: Network, href: "/app/abonelik" },
          ].map((k) => (
            <Link
              key={k.label}
              href={k.href}
              className="focus-ring press lift group block rounded-[14px] border border-white/10 bg-white/5 p-4 hover:border-white/30"
            >
              <span className="flex items-start justify-between">
                <k.icon className="h-4 w-4 text-mint-400" />
                <ArrowUpRight className="hover-action h-4 w-4 text-white/30 opacity-0 transition group-hover:text-white group-hover:opacity-100" />
              </span>
              <p className="mt-2 font-display text-2xl font-extrabold">{k.value}</p>
              <p className="text-[11px] text-white/45">{k.label}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Dönem seçici — GET formu (?from=&to=) + hızlı çipler; varsayılan tüm zamanlar */}
      <div className="flex flex-wrap items-center gap-2 rounded-[16px] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-text-muted"><CalendarRange className="h-3.5 w-3.5" /> Dönem:</span>
        <Link
          href="/app/franchise"
          aria-current={!hasRange ? "page" : undefined}
          className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
            !hasRange
              ? "border-brand-400/50 bg-brand-600/10 text-brand-600"
              : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-brand-600"
          }`}
        >
          Tüm zamanlar
        </Link>
        {presets.map((p) => {
          const active = fromF === p.from && toF === p.to;
          return (
            <Link
              key={p.label}
              href={href({ from: p.from, to: p.to })}
              aria-current={active ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                active
                  ? "border-brand-400/50 bg-brand-600/10 text-brand-600"
                  : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-brand-600"
              }`}
            >
              {p.label}
            </Link>
          );
        })}
        <form action="/app/franchise" className="flex flex-wrap items-center gap-2">
          <input
            name="from"
            type="date"
            defaultValue={fromF ?? ""}
            aria-label="Başlangıç tarihi"
            className="rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-xs outline-none focus:border-brand-400"
          />
          <span className="text-xs text-text-faint">—</span>
          <input
            name="to"
            type="date"
            defaultValue={toF ?? ""}
            aria-label="Bitiş tarihi"
            className="rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-xs outline-none focus:border-brand-400"
          />
          <button type="submit" className="rounded-[9px] bg-brand-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-brand-700">
            Filtrele
          </button>
          {hasRange ? (
            <Link href={href({ from: null, to: null })} className="text-[11px] font-semibold text-text-muted hover:text-danger-500">
              Dönemi temizle
            </Link>
          ) : null}
        </form>
      </div>

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
        <>
          {/* Şube karşılaştırma — kazanılan hacim (₺) ve portföy sayısı ayrı
              grafiklerde: iki ölçek aynı eksende yanıltıcı olurdu. */}
          {volumeChart.length > 0 || portfolioChart.length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {volumeChart.length > 0 ? (
                <ChartFrame
                  title="Şube × kazanılan hacim"
                  subtitle={donemLabel}
                  height={Math.max(180, volumeChart.length * 44)}
                >
                  <BarCompare
                    data={volumeChart}
                    xKey="name"
                    series={[{ key: "hacim", label: "Kazanılan hacim" }]}
                    format="money"
                    layout="horizontal"
                  />
                </ChartFrame>
              ) : null}
              {portfolioChart.length > 0 ? (
                <ChartFrame
                  title="Şube × portföy sayısı"
                  subtitle="Anlık envanter · dönemden bağımsız"
                  height={Math.max(180, portfolioChart.length * 44)}
                >
                  <BarCompare
                    data={portfolioChart}
                    xKey="name"
                    series={[{ key: "portfoy", label: "Portföy", color: "var(--mint-500)" }]}
                    format="number"
                    layout="horizontal"
                  />
                </ChartFrame>
              ) : null}
            </div>
          ) : null}

          <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
                <Building2 className="h-4 w-4 text-brand-600" /> Şube rollup
              </h2>
              <span className="flex items-center gap-2 text-xs text-text-muted">
                <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-[11px] font-bold text-brand-600">{donemLabel}</span>
                {rows.length} kayıt
              </span>
            </div>
            <div className="divide-y divide-line">
              {rows.map((r) => (
                <div key={r.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[1.2fr_.65fr_.65fr_.6fr_.75fr_.85fr] sm:items-center">
                  {/* Rollup hücreleri ilgili modül listelerine iner (şube bazlı liste
                      filtresi henüz yok; hedef sayfalar tam listeyi açar) */}
                  <Link href="/app/ekip#subeler" className="focus-ring rounded-[6px] font-semibold text-ink-950 hover:text-brand-600 hover:underline">
                    {r.name}
                  </Link>
                  <Link href="/app/portfoyler" className="focus-ring flex items-center gap-1.5 rounded-[6px] text-xs text-text-muted hover:text-brand-600 hover:underline">
                    <Home className="h-3.5 w-3.5" /> {r.properties} portföy
                  </Link>
                  <Link href="/app/musteriler" className="focus-ring flex items-center gap-1.5 rounded-[6px] text-xs text-text-muted hover:text-brand-600 hover:underline">
                    <Users className="h-3.5 w-3.5" /> {r.customers} müşteri · {r.advisors} danışman
                  </Link>
                  <Link href="/app/anlasmalar" className="focus-ring rounded-[6px] text-xs text-text-muted hover:text-brand-600 hover:underline">
                    {r.won} kazanılan işlem
                  </Link>
                  {/* Danışman verimi: kazanılan hacim / danışman sayısı (danışmansız şubede —) */}
                  <Link
                    href="/app/danisman-kpi"
                    className="focus-ring rounded-[6px] text-xs text-text-muted hover:text-brand-600 hover:underline"
                    title="Danışman başına kazanılan hacim"
                  >
                    {r.advisors > 0 ? `${moneyTry(Math.round(r.wonValue / r.advisors))} / danışman` : "— / danışman"}
                  </Link>
                  <Link href="/app/anlasmalar" className="focus-ring flex items-center gap-1.5 rounded-[6px] text-right text-sm font-bold text-mint-600 hover:underline sm:justify-end">
                    <Wallet className="h-3.5 w-3.5" /> {moneyTry(r.wonValue)}
                  </Link>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <Wallet className="h-4 w-4 text-danger-500" /> Şube bazlı kayıp-kaçak
          </h2>
          <span className="flex items-center gap-2">
            <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-semibold text-text-muted">{donemLabel}</span>
            <span className="text-sm font-bold text-danger-500">{moneyTry(totalLost)}</span>
          </span>
        </div>
        {totalLost <= 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-text-muted">
              {hasRange
                ? "Seçili dönemde kayıp-kaçak kaydı yok."
                : "Henüz kayıp-kaçak kaydı yok. Portal kapanışları burada şube bazında konsolide edilir."}
            </p>
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
                <Link key={r.id} href="/app/kayip-kacak" className="focus-ring group block rounded-[10px] p-1 -m-1">
                  <div className="min-w-0">
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="flex items-center gap-1 truncate font-semibold text-ink-950">
                        {r.name}
                        <ArrowUpRight className="hover-action h-3.5 w-3.5 shrink-0 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                      </span>
                      <span className="tabular-nums font-bold text-danger-500">{moneyTry(r.lost)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-canvas">
                      <div className="h-full rounded-full bg-danger-500/70" style={{ width: `${Math.max((r.lost / maxLost) * 100, 4)}%` }} />
                    </div>
                  </div>
                </Link>
              ))}
          </div>
        )}
      </section>
    </div>
  );
}
