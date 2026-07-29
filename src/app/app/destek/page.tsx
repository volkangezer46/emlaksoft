import Link from "next/link";
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Hourglass,
  LifeBuoy,
  Search,
  Sparkles,
  Tag,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { getDefinitions } from "@/lib/definitions";
import { safeLike } from "@/lib/pgrst";
import { DAY_MS, daysAgoIso, msSince } from "@/lib/clock";
import { relativeTimeTR } from "@/lib/admin-format";
import { NewTicketDialog } from "./new-ticket-dialog";
import type { CSSProperties } from "react";

const RING_C = 2 * Math.PI * 42;

/** Sayfa başına kayıt — gerçek sayfalama, 100'lük dilim + bellek filtresi yerine. */
const PAGE_SIZE = 50;

/** "Açık / bekleyen" bileşimi — tek doğruluk kaynağı (KPI, ring, liste sorgusu). */
const ACIK_STATUSES = ["open", "in_progress", "waiting"] as const;

const statusLabel: Record<string, string> = {
  open: "Açık",
  in_progress: "İşleniyor",
  waiting: "Yanıt bekleniyor",
  resolved: "Çözüldü",
  closed: "Kapalı",
};

const statusCls: Record<string, string> = {
  open: "bg-brand-600/10 text-brand-600",
  in_progress: "bg-cyan-400/12 text-cyan-600",
  waiting: "bg-amber-400/15 text-amber-600",
  resolved: "bg-mint-500/12 text-mint-600",
  closed: "bg-ink-950/8 text-text-muted",
};

const statusColor: Record<string, string> = {
  open: "var(--brand-500)",
  in_progress: "var(--cyan-400)",
  waiting: "var(--amber-400)",
  resolved: "var(--mint-500)",
  closed: "rgba(10,18,36,0.2)",
};

const catLabel: Record<string, string> = {
  general: "Genel",
  billing: "Fatura",
  bug: "Hata",
  feature: "Özellik",
  compliance: "Uyum",
  onboarding: "Kurulum",
};

// Öncelik ham enum değerleri ekrana düşüyordu ("urgent" gibi) — Türkçe karşılık.
const priorityLabel: Record<string, string> = {
  low: "Düşük",
  normal: "Normal",
  high: "Yüksek",
  urgent: "Acil",
};

const priorityCls: Record<string, string> = {
  low: "bg-ink-950/6 text-text-muted",
  normal: "bg-brand-600/8 text-brand-600",
  high: "bg-amber-400/15 text-amber-600",
  urgent: "bg-danger-500/10 text-danger-500",
};

const PAGER_BTN =
  "focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600";
const PAGER_BTN_DISABLED =
  "inline-flex items-center gap-1 rounded-[9px] border border-line px-2.5 py-1.5 text-xs font-semibold text-text-faint opacity-50";

const statusKeys = ["open", "in_progress", "waiting", "resolved", "closed"] as const;

export default async function SupportPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; kategori?: string; ara?: string; sayfa?: string }>;
}) {
  await requireModulePage("support");
  const sp = (await searchParams) ?? {};
  const durum = sp.durum ?? "";
  const kategori = sp.kategori ?? "";
  const ara = (sp.ara ?? "").trim();
  const pageParam = Math.max(1, Number.parseInt(sp.sayfa ?? "1", 10) || 1);
  const offset = (pageParam - 1) * PAGE_SIZE;

  const supabase = await createClient();

  // Kategori tanımlarını önce çekiyoruz: dağılım sayaçları tanım listesinden
  // türeyen aday kategoriler üzerinden (head-count) hesaplanır.
  const categoryDefs = await getDefinitions("ticket_category");
  const categoryOptions = categoryDefs.length
    ? categoryDefs.map((d) => ({ value: d.value, label: d.label }))
    : undefined;
  const catName = (v: string) =>
    categoryOptions?.find((c) => c.value === v)?.label ?? catLabel[v] ?? v;
  const candidateCategories = Array.from(
    new Set([...categoryDefs.map((d) => d.value), ...Object.keys(catLabel)]),
  );

  // ── Sunucu tarafı filtreleme + gerçek sayfalama ───────────────────────────
  // Eskiden 100 kayıt çekilip bellekte (durum/kategori/arama) süzülüyordu;
  // 100'ü aşan ofiste filtre sessizce "sonuç yok" diyordu. Artık tüm filtreler
  // sorguda, liste .range() ile sayfalanır, sayaçlar ayrı head-count'lardan.
  let listQuery = supabase
    .from("support_tickets")
    .select("id, subject, category, priority, status, created_at, updated_at", { count: "exact" })
    .order("created_at", { ascending: false });
  if (durum === "acik") listQuery = listQuery.in("status", ACIK_STATUSES as unknown as string[]);
  else if (durum) listQuery = listQuery.eq("status", durum);
  if (kategori) listQuery = listQuery.eq("category", kategori);
  if (ara) listQuery = listQuery.ilike("subject", safeLike(ara));

  const headCount = (patch: (b: ReturnType<typeof baseCount>) => ReturnType<typeof baseCount>) =>
    patch(baseCount());
  function baseCount() {
    return supabase.from("support_tickets").select("id", { count: "exact", head: true });
  }

  const weekAgoIso = daysAgoIso(7);

  const [
    { data: pageData, count: listCount },
    { count: totalCount },
    statusCountResults,
    { count: weekCount },
    { data: oldestOpenRows },
    { data: lastUpdatedRows },
    categoryCountResults,
  ] = await Promise.all([
    listQuery.range(offset, offset + PAGE_SIZE - 1),
    headCount((b) => b),
    Promise.all(
      statusKeys.map(async (k) => {
        const { count } = await headCount((b) => b.eq("status", k));
        return [k, count ?? 0] as const;
      }),
    ),
    headCount((b) => b.gte("created_at", weekAgoIso)),
    // En eski açık talep — ayrı dar sorgu (en eskiden yeniye, ilk kayıt).
    supabase
      .from("support_tickets")
      .select("id, subject, created_at")
      .in("status", ACIK_STATUSES as unknown as string[])
      .order("created_at", { ascending: true })
      .limit(1),
    // Son hareket — en yeni güncelleme.
    supabase
      .from("support_tickets")
      .select("id, subject, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(1),
    Promise.all(
      candidateCategories.map(async (cat) => {
        const { count } = await headCount((b) => b.eq("category", cat));
        return [cat, count ?? 0] as const;
      }),
    ),
  ]);

  const pageRows = pageData ?? [];
  const filteredCount = listCount ?? 0;
  const grandTotal = totalCount ?? 0;

  const statusCountMap = new Map(statusCountResults);
  const countOf = (k: string) => statusCountMap.get(k as (typeof statusKeys)[number]) ?? 0;
  const openCount = ACIK_STATUSES.reduce((s, k) => s + countOf(k), 0);
  const resolved = countOf("resolved");
  const waitingCount = countOf("waiting");
  const week = weekCount ?? 0;

  const oldestOpen = oldestOpenRows?.[0] ?? null;
  const oldestOpenDays = oldestOpen ? Math.floor(msSince(oldestOpen.created_at) / DAY_MS) : null;
  const lastUpdated = lastUpdatedRows?.[0] ?? null;

  /** Aktif filtreleri koruyarak href üretir — filtre değişince sayfa 1'e döner. */
  const buildHref = (patch: { durum?: string | null; kategori?: string | null; ara?: string | null }) => {
    const params = new URLSearchParams();
    const d = patch.durum === undefined ? durum : patch.durum ?? "";
    const k = patch.kategori === undefined ? kategori : patch.kategori ?? "";
    const a = patch.ara === undefined ? ara : patch.ara ?? "";
    if (d) params.set("durum", d);
    if (k) params.set("kategori", k);
    if (a) params.set("ara", a);
    const qs = params.toString();
    return qs ? `/app/destek?${qs}` : "/app/destek";
  };

  /** Sayfalama linki — aktif filtreler korunur, yalnız sayfa değişir. */
  const pageHref = (n: number) => {
    const params = new URLSearchParams();
    if (durum) params.set("durum", durum);
    if (kategori) params.set("kategori", kategori);
    if (ara) params.set("ara", ara);
    if (n > 1) params.set("sayfa", String(n));
    const qs = params.toString();
    return qs ? `/app/destek?${qs}` : "/app/destek";
  };

  const ringTotal = Math.max(1, grandTotal);
  const statusCounts = statusKeys.map((k) => ({
    key: k,
    label: statusLabel[k],
    count: countOf(k),
    color: statusColor[k],
  }));
  let arcOffset = 0;
  const arcs = statusCounts.map((s) => {
    const len = (s.count / ringTotal) * RING_C;
    const item = { ...s, dash: len, offset: arcOffset };
    arcOffset += len;
    return item;
  });
  const resolveRate = grandTotal ? resolved / grandTotal : 0;

  // Kategori dağılımı — çipler ?kategori= ile listeyi süzer (gerçek sayımlar).
  const categoryChips = categoryCountResults
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  const rangeStart = filteredCount === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + pageRows.length, filteredCount);

  const filtersActive = Boolean(durum || kategori || ara);

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-5 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-mint-500/20 blur-[90px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
                  <LifeBuoy className="h-4 w-4" /> Destek merkezi
                </span>
                <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Talepleriniz</h1>
                <p className="mt-1 text-sm text-white/60">EmlakSoft ekibine fatura, kurulum ve teknik taleplerinizi iletin.</p>
              </div>
              <NewTicketDialog categoryOptions={categoryOptions} />
            </div>
            {/* KPI kartları listeyi ?durum= parametresiyle süzer */}
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Toplam talep", value: grandTotal, cls: "text-white", durum: "" },
                { label: "Açık / bekleyen", value: openCount, cls: "text-amber-300", durum: "acik" },
                { label: "Yanıt bekleyen", value: waitingCount, cls: "text-cyan-400", durum: "waiting" },
                { label: "Çözülen", value: resolved, cls: "text-mint-400", durum: "resolved" },
              ].map((k) => (
                <Link
                  key={k.label}
                  href={buildHref({ durum: k.durum || null })}
                  className={`focus-ring press group relative block rounded-[14px] border bg-white/5 p-3 transition hover:border-white/30 ${
                    durum === k.durum && k.durum !== "" ? "border-white/40" : "border-white/10"
                  }`}
                >
                  <ArrowUpRight className="hover-action absolute right-2 top-2 h-3.5 w-3.5 text-white/50 opacity-0 transition group-hover:opacity-100" />
                  <p className={`numeric font-display text-xl font-extrabold tabular-nums ${k.cls}`}>{k.value}</p>
                  <p className="text-[11px] text-white/45">{k.label}</p>
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-5 rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="relative grid h-28 w-28 place-items-center">
              <div
                className="conic-spin pointer-events-none absolute inset-2 rounded-full opacity-25 blur-md"
                style={{ background: "conic-gradient(from 0deg, var(--mint-400), var(--brand-500), var(--mint-400))" }}
              />
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
                {grandTotal === 0 ? (
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    stroke="var(--mint-400)"
                    strokeWidth="10"
                    strokeLinecap="round"
                    className="ring-sweep"
                    style={{ "--circ": RING_C, "--dash": RING_C * 0.85 } as CSSProperties}
                  />
                ) : (
                  arcs.filter((a) => a.count > 0).map((a) => (
                    /* SVG içi <a>: segment tıklanınca liste o duruma süzülür */
                    <a key={a.key} href={buildHref({ durum: a.key })} aria-label={`${a.label} taleplerini listele`} className="cursor-pointer">
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        fill="none"
                        stroke={a.color}
                        strokeWidth="10"
                        strokeDasharray={`${a.dash} ${RING_C - a.dash}`}
                        strokeDashoffset={-a.offset}
                      />
                    </a>
                  ))
                )}
              </svg>
              <div className="absolute text-center">
                <p className="font-display text-xl font-extrabold text-white">%{Math.round(resolveRate * 100)}</p>
                <p className="text-[10px] text-white/45">çözüm</p>
              </div>
            </div>
            <div className="space-y-1.5 text-xs">
              {statusCounts.map((s) => (
                <Link
                  key={s.key}
                  href={buildHref({ durum: s.key })}
                  className={`focus-ring group flex items-center gap-2 rounded-[6px] px-1 py-0.5 transition hover:bg-white/5 ${
                    durum === s.key ? "bg-white/10 text-white" : "text-white/70"
                  }`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  <span className="flex-1 group-hover:text-white">{s.label}</span>
                  <span className="font-bold text-white">{s.count}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* İçgörü kartları — tümü gerçek kayıtlardan */}
      {grandTotal > 0 ? (
        <section className="grid gap-3 sm:grid-cols-3">
          <Link
            href={buildHref({ durum: null, kategori: null, ara: null })}
            className="focus-ring press lift group relative block rounded-[16px] border border-line bg-surface p-4"
          >
            <ArrowUpRight className="hover-action absolute right-3 top-3 h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
            <span className="flex items-center gap-2 text-xs font-semibold text-text-muted">
              <Sparkles className="h-3.5 w-3.5 text-brand-600" /> Son 7 gün
            </span>
            <p className="numeric mt-1.5 font-display text-lg font-extrabold text-ink-950">{week} yeni talep</p>
            <p className="mt-0.5 text-[11px] text-text-muted">{week > 0 ? "Ekibimiz en geç 1 iş günü içinde döner." : "Bu hafta yeni talep açılmadı."}</p>
          </Link>
          {oldestOpen ? (
            <Link
              href={`/app/destek/${oldestOpen.id}`}
              className="focus-ring press lift group relative block rounded-[16px] border border-line bg-surface p-4"
            >
              <ArrowUpRight className="hover-action absolute right-3 top-3 h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
              <span className="flex items-center gap-2 text-xs font-semibold text-text-muted">
                <Hourglass className="h-3.5 w-3.5 text-amber-600" /> En eski açık talep
              </span>
              <p className="numeric mt-1.5 font-display text-lg font-extrabold text-ink-950">
                {oldestOpenDays === 0 ? "Bugün açıldı" : `${oldestOpenDays} gündür açık`}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-text-muted">{oldestOpen.subject}</p>
            </Link>
          ) : (
            <Link
              href={buildHref({ durum: "resolved" })}
              className="focus-ring press lift group relative block rounded-[16px] border border-line bg-surface p-4"
            >
              <ArrowUpRight className="hover-action absolute right-3 top-3 h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
              <span className="flex items-center gap-2 text-xs font-semibold text-text-muted">
                <CheckCircle2 className="h-3.5 w-3.5 text-mint-600" /> Açık talep yok
              </span>
              <p className="mt-1.5 font-display text-lg font-extrabold text-ink-950">Her şey çözüldü</p>
              <p className="mt-0.5 text-[11px] text-text-muted">Tüm talepleriniz sonuçlandırıldı.</p>
            </Link>
          )}
          {lastUpdated ? (
            <Link
              href={`/app/destek/${lastUpdated.id}`}
              className="focus-ring press lift group relative block rounded-[16px] border border-line bg-surface p-4"
            >
              <ArrowUpRight className="hover-action absolute right-3 top-3 h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
              <span className="flex items-center gap-2 text-xs font-semibold text-text-muted">
                <Clock3 className="h-3.5 w-3.5 text-cyan-600" /> Son hareket
              </span>
              <p className="mt-1.5 font-display text-lg font-extrabold text-ink-950">
                {relativeTimeTR(lastUpdated.updated_at ?? lastUpdated.created_at)}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-text-muted">{lastUpdated.subject}</p>
            </Link>
          ) : null}
        </section>
      ) : null}

      <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="space-y-3 border-b border-line px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Clock3 className="h-4 w-4 text-brand-600" /> Talep geçmişi
              <span className="text-xs font-semibold text-text-faint">
                {filteredCount.toLocaleString("tr-TR")}/{grandTotal.toLocaleString("tr-TR")}
              </span>
            </h2>
            {grandTotal > 0 ? (
              /* Konu içinde arama — GET formu, ?ara= sorguya iner; sayfa sıfırlanır */
              <form action="/app/destek" className="relative">
                {durum ? <input type="hidden" name="durum" value={durum} /> : null}
                {kategori ? <input type="hidden" name="kategori" value={kategori} /> : null}
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
                <input
                  name="ara"
                  type="search"
                  defaultValue={ara}
                  placeholder="Konu içinde ara…"
                  aria-label="Taleplerde ara"
                  className="w-full min-w-[200px] rounded-[10px] border border-line bg-canvas/60 py-2 pl-9 pr-3 text-xs text-ink-950 outline-none transition focus:border-brand-300 sm:w-56"
                />
              </form>
            ) : null}
          </div>
          {grandTotal > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {[{ label: "Tümü", value: "" }, ...statusKeys.map((k) => ({ label: statusLabel[k], value: k as string }))].map((f) => (
                <Link
                  key={f.value}
                  href={buildHref({ durum: f.value || null })}
                  className={`focus-ring rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                    durum === f.value ? "bg-ink-950 text-white" : "border border-line text-text-muted hover:text-ink-950"
                  }`}
                >
                  {f.label}
                </Link>
              ))}
              {categoryChips.length > 1 ? (
                <>
                  <span aria-hidden className="mx-1 h-4 w-px bg-line" />
                  {categoryChips.map(([cat, n]) => (
                    <Link
                      key={cat}
                      href={buildHref({ kategori: kategori === cat ? null : cat })}
                      className={`focus-ring inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                        kategori === cat ? "bg-brand-600 text-white" : "border border-line text-text-muted hover:text-ink-950"
                      }`}
                    >
                      <Tag className="h-3 w-3" /> {catName(cat)} · {n}
                    </Link>
                  ))}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
        {grandTotal === 0 ? (
          <div className="relative grid place-items-center overflow-hidden px-6 py-16 text-center">
            <div className="pointer-events-none absolute left-1/2 top-6 h-32 w-32 -translate-x-1/2 rounded-full bg-mint-500/15 blur-[60px]" />
            <span className="relative grid h-14 w-14 place-items-center rounded-[16px] bg-mint-500/12 text-mint-600">
              <LifeBuoy className="h-7 w-7" />
            </span>
            <p className="relative mt-3 font-display font-bold text-ink-950">Henüz talep yok</p>
            <p className="relative mt-1 max-w-sm text-sm text-text-muted">
              Fatura, kurulum veya teknik bir konuda yardıma mı ihtiyacınız var? Yukarıdaki &quot;Yeni talep&quot;
              düğmesiyle ilk destek talebinizi oluşturun.
            </p>
          </div>
        ) : pageRows.length === 0 ? (
          <div className="grid place-items-center px-6 py-14 text-center">
            <LifeBuoy className="h-8 w-8 text-text-faint" />
            <p className="mt-3 font-display font-bold text-ink-950">
              {ara ? `"${ara}" için sonuç yok` : "Bu filtrede talep yok"}
            </p>
            <Link href="/app/destek" className="mt-1 text-sm font-semibold text-brand-600 hover:underline">
              Filtreleri temizle
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {pageRows.map((t) => (
              <Link
                key={t.id}
                href={`/app/destek/${t.id}`}
                className="grid gap-2 px-5 py-4 transition hover:bg-brand-600/[0.02] sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[11px] ${statusCls[t.status] ?? statusCls.open}`}>
                    {t.status === "resolved" || t.status === "closed" ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <LifeBuoy className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-950">{t.subject}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-text-muted">
                      <span>{catName(t.category)}</span>
                      <span aria-hidden>·</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${priorityCls[t.priority] ?? priorityCls.normal}`}>
                        {priorityLabel[t.priority] ?? t.priority}
                      </span>
                      <span aria-hidden>·</span>
                      <span>
                        {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(t.created_at))}
                      </span>
                      {t.updated_at && t.updated_at !== t.created_at ? (
                        <>
                          <span aria-hidden>·</span>
                          <span className="text-text-faint">güncelleme {relativeTimeTR(t.updated_at)}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                </div>
                <span className={`w-fit rounded-full px-2.5 py-1 text-[11px] font-bold ${statusCls[t.status] ?? statusCls.open}`}>
                  {statusLabel[t.status] ?? t.status}
                </span>
              </Link>
            ))}
          </div>
        )}
        {/* Sayfalama — filtreler linklerde korunur */}
        {filteredCount > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm">
            <p className="numeric text-xs text-text-muted">
              {rangeStart.toLocaleString("tr-TR")}–{rangeEnd.toLocaleString("tr-TR")} / Toplam{" "}
              {filteredCount.toLocaleString("tr-TR")}
            </p>
            <div className="flex items-center gap-1.5">
              {pageParam > 1 ? (
                <Link href={pageHref(pageParam - 1)} className={PAGER_BTN}>
                  <ChevronLeft className="h-4 w-4" /> Önceki
                </Link>
              ) : (
                <span className={PAGER_BTN_DISABLED} aria-disabled="true">
                  <ChevronLeft className="h-4 w-4" /> Önceki
                </span>
              )}
              <span className="numeric px-1 text-xs text-text-faint">
                {Math.min(pageParam, totalPages)} / {totalPages}
              </span>
              {pageParam < totalPages ? (
                <Link href={pageHref(pageParam + 1)} className={PAGER_BTN}>
                  Sonraki <ChevronRight className="h-4 w-4" />
                </Link>
              ) : (
                <span className={PAGER_BTN_DISABLED} aria-disabled="true">
                  Sonraki <ChevronRight className="h-4 w-4" />
                </span>
              )}
            </div>
          </div>
        ) : null}
      </section>

      {filtersActive && grandTotal > 0 ? (
        <p className="px-1 text-xs text-text-muted">
          Aktif filtre:{" "}
          {[
            durum ? `durum "${durum === "acik" ? "Açık / bekleyen" : statusLabel[durum] ?? durum}"` : null,
            kategori ? `kategori "${catName(kategori)}"` : null,
            ara ? `arama "${ara}"` : null,
          ]
            .filter(Boolean)
            .join(" + ")}{" "}
          ·{" "}
          <Link href="/app/destek" className="font-semibold text-brand-600 hover:underline">
            Temizle
          </Link>
        </p>
      ) : null}
    </div>
  );
}
