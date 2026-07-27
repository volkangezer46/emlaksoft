import Link from "next/link";
import {
  ArrowUpRight,
  Building2,
  CalendarRange,
  Crown,
  Home,
  Network,
  Plus,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { computeOfficeScore, loadOfficeScoreInputs } from "@/lib/office-score";
import { moneyTry } from "@/lib/leak-shield";
import { daysAgoIso } from "@/lib/clock";
import { StatCard } from "@/components/app/stat-card";
import { ChartFrame, BarCompare } from "@/components/ui/chart";
import { Table, TableFrame, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Franchise / Şube Analitiği" };

/**
 * Faz 6 / D1 + R8: Franchise BI — gerçek şube rollup, çok şubeli ofis yönetimi.
 * Tek şube varsa konsolide KPI + şubeleşme yönlendirmesi; çok şube varsa
 * karşılaştırma tablosu ve grafikler. ?from=&to= dönem filtresi işlem akışını
 * (deals/closures) süzer; varsayılan tüm zamanlar (giderler sayfası deseni).
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

  // Hızlı çipler — clock.ts üzerinden bugünün ISO'su; render'da Date kurulmaz.
  const today = daysAgoIso(0).slice(0, 10);
  const yil = today.slice(0, 4);
  const ayNo = Number(today.slice(5, 7));
  const ceyrekAy = String(Math.floor((ayNo - 1) / 3) * 3 + 1).padStart(2, "0");
  const presets = [
    { label: "Bu ay", from: `${today.slice(0, 7)}-01`, to: today },
    { label: "Bu çeyrek", from: `${yil}-${ceyrekAy}-01`, to: today },
    { label: "Bu yıl", from: `${yil}-01-01`, to: today },
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

  // ---- Konsolide KPI'lar — tüm şubelerin toplamı (gerçek tenant verisi) ----
  const totalProps = rows.reduce((s, r) => s + r.properties, 0);
  const totalCust = rows.reduce((s, r) => s + r.customers, 0);
  const totalAdv = rows.reduce((s, r) => s + r.advisors, 0);
  const totalWon = rows.reduce((s, r) => s + r.won, 0);
  const totalWonValue = rows.reduce((s, r) => s + r.wonValue, 0);
  // Karşılaştırma tablosunda lider şube (hacme göre; hacim yoksa vurgusuz)
  const leaderId = isMultiBranch && rows[0] && rows[0].wonValue > 0 ? rows[0].id : null;

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
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-amber-400/20 blur-[70px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
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
          <Link
            href="/app/ekip#subeler"
            className="focus-ring press inline-flex items-center gap-2 rounded-[11px] border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20"
          >
            <Plus className="h-4 w-4" /> Şube ekle / yönet
          </Link>
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

      {/* Konsolide KPI'lar — tüm şubelerin toplamı; her kart ilgili modüle iner */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Toplam portföy" value={totalProps} icon={Home} href="/app/portfoyler" />
        <StatCard label="Toplam müşteri" value={totalCust} icon={Users} href="/app/musteriler" />
        <StatCard label="Aktif danışman" value={totalAdv} icon={Users} href="/app/ekip" />
        <StatCard
          label={`Kazanılan işlem (${donemLabel.toLocaleLowerCase("tr-TR")})`}
          value={totalWon}
          icon={TrendingUp}
          tone="success"
          href="/app/anlasmalar"
        />
        <StatCard
          label={`Kazanılan hacim (${donemLabel.toLocaleLowerCase("tr-TR")})`}
          value={moneyTry(totalWonValue)}
          icon={Wallet}
          tone="success"
          href="/app/anlasmalar"
        />
      </div>

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

      {/* Şubeleşme yönlendirmesi — tek şubeli ofise çok şubeli yönetimin değeri */}
      {!isMultiBranch ? (
        <section className="relative overflow-hidden rounded-[18px] border border-brand-600/20 bg-brand-600/6 p-5">
          <div className="pointer-events-none absolute -right-10 -top-14 h-44 w-44 rounded-full bg-brand-600/10 blur-[60px]" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-brand-600/10 text-brand-600">
                <Building2 className="h-6 w-6" />
              </span>
              <div>
                <p className="font-display text-lg font-extrabold text-ink-950">Çok şubeli yönetime hazır mısınız?</p>
                <p className="mt-1 max-w-2xl text-sm text-text-muted">
                  İkinci şubenizi tanımlayın; portföy, müşteri ve danışmanları şubeye atayın. Bu ekran
                  otomatik olarak şube karşılaştırma tablosuna, hacim grafiklerine ve şube bazlı
                  kayıp-kaçak kırılımına geçer.
                </p>
              </div>
            </div>
            <Link
              href="/app/ekip#subeler"
              className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[11px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              <Plus className="h-4 w-4" /> Yeni şube ekle
            </Link>
          </div>
        </section>
      ) : null}

      {rows.length === 0 ? (
        <section className="relative grid place-items-center overflow-hidden rounded-[20px] border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
          <div className="pointer-events-none absolute -top-10 h-40 w-40 rounded-full bg-brand-600/20 blur-[70px]" />
          <div className="relative">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-[18px] bg-brand-600/10 text-brand-600">
              <Building2 className="h-8 w-8" />
            </span>
            <h2 className="mt-4 font-display text-lg font-bold text-ink-950">Henüz şube verisi yok</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-text-muted">
              Ayarlar → Ekip bölümünden şube ekleyin; portföy ve müşterileri şubeye atayınca burada rollup görünür.
            </p>
            <Link href="/app/ekip" className="btn-shine mt-5 inline-flex rounded-[11px] bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700">
              Ekip &amp; şube ayarlarına git
            </Link>
          </div>
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

          {/* Şube karşılaştırma tablosu — hacme göre sıralı; lider şube taçlı.
              Hücre linkleri ilgili modül listelerine iner (şube bazlı liste
              filtresi henüz yok; hedef sayfalar tam listeyi açar). */}
          <TableFrame minWidth={880}>
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
                <Building2 className="h-4 w-4 text-brand-600" /> Şube karşılaştırma
              </h2>
              <span className="flex items-center gap-2 text-xs text-text-muted">
                <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-[11px] font-bold text-brand-600">{donemLabel}</span>
                {rows.length} kayıt
              </span>
            </div>
            <Table>
              <THead>
                <TR>
                  <TH>Şube</TH>
                  <TH align="right">Portföy</TH>
                  <TH align="right">Müşteri</TH>
                  <TH align="right">Danışman</TH>
                  <TH align="right">Kazanılan işlem</TH>
                  <TH align="right">Hacim / danışman</TH>
                  <TH align="right">Kazanılan hacim</TH>
                  <TH>Hacim payı</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => {
                  const sharePct = totalWonValue > 0 ? Math.round((r.wonValue / totalWonValue) * 100) : 0;
                  return (
                    <TR key={r.id}>
                      <TD className="font-semibold text-ink-950">
                        <span className="inline-flex items-center gap-2">
                          <Link href="/app/ekip#subeler" className="focus-ring rounded-[6px] hover:text-brand-600 hover:underline">
                            {r.name}
                          </Link>
                          {leaderId === r.id ? (
                            <Badge variant="warning" size="sm" className="gap-1">
                              <Crown className="h-3 w-3" /> Lider
                            </Badge>
                          ) : null}
                        </span>
                      </TD>
                      <TD align="right">
                        <Link href="/app/portfoyler" className="focus-ring rounded-[6px] text-text-muted hover:text-brand-600 hover:underline">
                          {r.properties}
                        </Link>
                      </TD>
                      <TD align="right">
                        <Link href="/app/musteriler" className="focus-ring rounded-[6px] text-text-muted hover:text-brand-600 hover:underline">
                          {r.customers}
                        </Link>
                      </TD>
                      <TD align="right">
                        <Link href="/app/ekip" className="focus-ring rounded-[6px] text-text-muted hover:text-brand-600 hover:underline">
                          {r.advisors}
                        </Link>
                      </TD>
                      <TD align="right">
                        <Link href="/app/anlasmalar" className="focus-ring rounded-[6px] text-text-muted hover:text-brand-600 hover:underline">
                          {r.won}
                        </Link>
                      </TD>
                      <TD align="right">
                        <Link
                          href="/app/danisman-kpi"
                          className="focus-ring rounded-[6px] text-text-muted hover:text-brand-600 hover:underline"
                          title="Danışman başına kazanılan hacim"
                        >
                          {r.advisors > 0 ? moneyTry(Math.round(r.wonValue / r.advisors)) : "—"}
                        </Link>
                      </TD>
                      <TD align="right">
                        <Link href="/app/anlasmalar" className="focus-ring rounded-[6px] font-bold text-mint-600 hover:underline">
                          {moneyTry(r.wonValue)}
                        </Link>
                      </TD>
                      <TD>
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-950/8">
                            <span className="block h-full rounded-full bg-brand-500" style={{ width: `${sharePct}%` }} />
                          </span>
                          <span className="numeric text-[11px] font-semibold text-text-muted">%{sharePct}</span>
                        </span>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
              <TFoot>
                <TR>
                  <TD>Konsolide</TD>
                  <TD align="right">{totalProps}</TD>
                  <TD align="right">{totalCust}</TD>
                  <TD align="right">{totalAdv}</TD>
                  <TD align="right">{totalWon}</TD>
                  <TD align="right">{totalAdv > 0 ? moneyTry(Math.round(totalWonValue / totalAdv)) : "—"}</TD>
                  <TD align="right" className="text-mint-600">{moneyTry(totalWonValue)}</TD>
                  <TD>%100</TD>
                </TR>
              </TFoot>
            </Table>
          </TableFrame>
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
