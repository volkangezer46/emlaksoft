import Link from "next/link";
import {
  ArrowUpRight,
  CheckCircle2,
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
import { DAY_MS, msSince } from "@/lib/clock";
import { relativeTimeTR } from "@/lib/admin-format";
import { NewTicketDialog } from "./new-ticket-dialog";
import type { CSSProperties } from "react";

const RING_C = 2 * Math.PI * 42;

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

/*
 * URL kontratı — üç bağımsız filtre, hepsi bu sayfada okunur:
 *  ?durum=   ham durum değerleri + "acik" bileşimi (open+in_progress+waiting)
 *  ?kategori= talep kategorisi (general|billing|bug|...)
 *  ?ara=     konu içinde serbest metin (tr-küçük harf karşılaştırma)
 */
function matchesDurum(status: string, durum: string) {
  if (!durum) return true;
  if (durum === "acik") return status === "open" || status === "in_progress" || status === "waiting";
  return status === durum;
}

export default async function SupportPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; kategori?: string; ara?: string }>;
}) {
  await requireModulePage("support");
  const sp = (await searchParams) ?? {};
  const durum = sp.durum ?? "";
  const kategori = sp.kategori ?? "";
  const ara = (sp.ara ?? "").trim();

  const supabase = await createClient();
  const [{ data: tickets }, categoryDefs] = await Promise.all([
    supabase
      .from("support_tickets")
      .select("id, subject, category, priority, status, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(100),
    getDefinitions("ticket_category"),
  ]);

  const categoryOptions = categoryDefs.length
    ? categoryDefs.map((d) => ({ value: d.value, label: d.label }))
    : undefined;
  const catName = (v: string) =>
    categoryOptions?.find((c) => c.value === v)?.label ?? catLabel[v] ?? v;

  const rows = tickets ?? [];
  const openCount = rows.filter((t) => t.status === "open" || t.status === "in_progress" || t.status === "waiting").length;
  const resolved = rows.filter((t) => t.status === "resolved").length;
  const waitingCount = rows.filter((t) => t.status === "waiting").length;

  /** Aktif filtreleri koruyarak href üretir — çipler URL'i iki yönlü günceller. */
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

  // KPI/halka tüm kayıtlardan; liste durum + kategori + arama ile daralır.
  const araLower = ara.toLocaleLowerCase("tr-TR");
  const visible = rows.filter(
    (t) =>
      matchesDurum(t.status, durum) &&
      (!kategori || t.category === kategori) &&
      (!araLower || (t.subject ?? "").toLocaleLowerCase("tr-TR").includes(araLower)),
  );

  const statusKeys = ["open", "in_progress", "waiting", "resolved", "closed"] as const;
  const statusCounts = statusKeys.map((k) => ({
    key: k,
    label: statusLabel[k],
    count: rows.filter((t) => t.status === k).length,
    color: statusColor[k],
  }));
  const total = Math.max(1, rows.length);
  let offset = 0;
  const arcs = statusCounts.map((s) => {
    const len = (s.count / total) * RING_C;
    const item = { ...s, dash: len, offset };
    offset += len;
    return item;
  });
  const resolveRate = rows.length ? resolved / rows.length : 0;

  // Kategori dağılımı — çipler ?kategori= ile listeyi süzer.
  const categoryCounts = new Map<string, number>();
  for (const t of rows) categoryCounts.set(t.category, (categoryCounts.get(t.category) ?? 0) + 1);
  const categoryChips = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]);

  // İçgörüler — tamamı gerçek kayıtlardan türetilir.
  const week = rows.filter((t) => msSince(t.created_at) <= 7 * DAY_MS).length;
  const oldestOpen = [...rows]
    .filter((t) => t.status === "open" || t.status === "in_progress" || t.status === "waiting")
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
  const oldestOpenDays = oldestOpen ? Math.floor(msSince(oldestOpen.created_at) / DAY_MS) : null;
  const lastUpdated = [...rows].sort(
    (a, b) => new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime(),
  )[0];

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
                { label: "Toplam talep", value: rows.length, cls: "text-white", durum: "" },
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
                {rows.length === 0 ? (
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
      {rows.length > 0 ? (
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
                {visible.length}/{rows.length}
              </span>
            </h2>
            {rows.length > 0 ? (
              /* Konu içinde arama — GET formu, ?ara= bu sayfada okunur */
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
          {rows.length > 0 ? (
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
        {rows.length === 0 ? (
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
        ) : visible.length === 0 ? (
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
            {visible.map((t) => (
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
      </section>

      {filtersActive && rows.length > 0 ? (
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
