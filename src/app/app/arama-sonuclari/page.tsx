import Link from "next/link";
import {
  ArrowUpRight,
  Building2,
  Handshake,
  Lightbulb,
  LifeBuoy,
  ListChecks,
  Search,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { searchWorkspace, type SearchHit } from "@/app/actions/search";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { NlPanel } from "./nl-panel";

/**
 * Global arama sonuç sayfası — komut paletindeki "Tüm sonuçları gör" hedefi.
 * Aynı searchWorkspace aksiyonunu daha yüksek limitle çağırır; sonuçlar türe
 * göre gruplu bölümlerde listelenir, boş gruplar gizlenir.
 *
 * URL kontratı: ?q= arama sorgusu, ?tur= tür filtresi (customer|property|...).
 * Hero'daki tür sayaçları hem KPI hem filtre — tıklanınca liste daralır.
 */

// Bölüm sırası ve görünümü — komut paletindeki kindMeta ile aynı dil.
// Palet: Ink / Brand / Mint / Amber / Cyan (mor kullanılmaz).
const GROUPS: Array<{
  kind: SearchHit["kind"];
  title: string;
  icon: typeof Users;
  tone: string;
}> = [
  { kind: "customer", title: "Müşteriler", icon: Users, tone: "text-brand-600 bg-brand-600/10" },
  { kind: "property", title: "Portföyler", icon: Building2, tone: "text-mint-600 bg-mint-500/12" },
  { kind: "demand", title: "Talepler", icon: Target, tone: "text-cyan-600 bg-cyan-400/12" },
  { kind: "deal", title: "Anlaşmalar", icon: Handshake, tone: "text-ink-950 bg-ink-950/8" },
  { kind: "task", title: "Görevler", icon: ListChecks, tone: "text-amber-600 bg-amber-400/15" },
  { kind: "ticket", title: "Destek", icon: LifeBuoy, tone: "text-danger-500 bg-danger-500/10" },
];

const VALID_KINDS = new Set(GROUPS.map((g) => g.kind));

// Örnek hızlı aramalar — kullanıcıyı boş sayfada yönlendirir (?q= bu sayfada okunur).
const QUICK_SEARCHES = ["3+1", "Satılık", "Kiralık", "Daire", "Arsa"];

function buildHref(q: string, tur?: string | null) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (tur) params.set("tur", tur);
  const qs = params.toString();
  return qs ? `/app/arama-sonuclari?${qs}` : "/app/arama-sonuclari";
}

export default async function AramaSonuclariPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; tur?: string; haric?: string }>;
}) {
  await requireModulePage("dashboard");
  const params = (await searchParams) ?? {};
  const q = (params.q ?? "").trim();
  const tur = params.tur && VALID_KINDS.has(params.tur as SearchHit["kind"]) ? (params.tur as SearchHit["kind"]) : undefined;

  // En az 2 karakter — searchWorkspace ile aynı eşik; kısa sorgu boş döner.
  const hits = q.length >= 2 ? await searchWorkspace(q, 60) : [];

  const byKind = new Map<SearchHit["kind"], SearchHit[]>();
  for (const h of hits) byKind.set(h.kind, [...(byKind.get(h.kind) ?? []), h]);
  const allSections = GROUPS.map((g) => ({ ...g, items: byKind.get(g.kind) ?? [] }));
  const nonEmpty = allSections.filter((g) => g.items.length > 0);
  const sections = tur ? nonEmpty.filter((g) => g.kind === tur) : nonEmpty;
  const visibleCount = sections.reduce((sum, s) => sum + s.items.length, 0);
  const topGroup = nonEmpty.length
    ? nonEmpty.reduce((a, b) => (b.items.length > a.items.length ? b : a))
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Global arama"
        title="Arama sonuçları"
        className="mb-0"
        description={
          q.length >= 2 ? (
            <>
              &quot;{q}&quot; için {hits.length} sonuç{tur ? ` · ${GROUPS.find((g) => g.kind === tur)?.title} filtresinde ${visibleCount}` : ""}{" "}
              bulundu.
            </>
          ) : (
            "Müşteri, portföy, talep, anlaşma, görev ve destek kayıtlarında arayın."
          )
        }
      />

      <section>
        {/* GET formu — sorgu URL'e yazılır (?q=), sunucu tarafında aranır */}
        <form action="/app/arama-sonuclari" className="mt-0 flex max-w-xl items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
            <input
              name="q"
              type="search"
              defaultValue={q}
              placeholder="En az 2 karakter — ad, telefon, ilan no…"
              aria-label="Arama sorgusu"
              className="w-full rounded-[var(--radius-control)] border border-line bg-surface py-2.5 pl-10 pr-3 text-sm text-text placeholder:text-text-faint outline-none transition focus:border-brand-400"
            />
          </div>
          {/* Aktif tür filtresi formda korunur */}
          {tur ? <input type="hidden" name="tur" value={tur} /> : null}
          <button
            type="submit"
            className="focus-ring press min-h-[42px] rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            Ara
          </button>
        </form>

        {/* Tür sayaçları — KPI + filtre bir arada; tıklanınca liste daralır */}
        {hits.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href={buildHref(q, null)}
              aria-current={!tur ? "page" : undefined}
              className={`focus-ring press rounded-full px-3 py-1.5 text-xs font-bold transition ${
                !tur ? "bg-brand-600 text-white" : "border border-line text-text-muted hover:border-brand-300 hover:text-brand-600"
              }`}
            >
              Tümü · {hits.length}
            </Link>
            {nonEmpty.map((g) => {
              const Icon = g.icon;
              const active = tur === g.kind;
              return (
                <Link
                  key={g.kind}
                  href={buildHref(q, active ? null : g.kind)}
                  aria-current={active ? "page" : undefined}
                  className={`focus-ring press inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                    active ? "bg-brand-600 text-white" : "border border-line text-text-muted hover:border-brand-300 hover:text-brand-600"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" /> {g.title} · {g.items.length}
                </Link>
              );
            })}
          </div>
        ) : null}
      </section>

      {/* Doğal dil: "ne anladım" chip'leri (kural tabanlı), mevcut listelere filtre kontratıyla gider */}
      <NlPanel q={q} haric={params.haric} />

      {/* İçgörü şeridi — sonuç dağılımı özeti */}
      {q.length >= 2 && topGroup ? (
        <section className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-sm shadow-[var(--shadow-xs)]">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-amber-400/15 text-amber-600">
            <Sparkles className="h-4 w-4" />
          </span>
          <p className="min-w-0 flex-1 text-text-muted">
            Eşleşmelerin çoğu <span className="font-semibold text-ink-950">{topGroup.title}</span> grubunda (
            {topGroup.items.length}/{hits.length}).{" "}
            {nonEmpty.length > 1 ? `Toplam ${nonEmpty.length} farklı kayıt türünde sonuç var.` : "Tek kayıt türünde sonuç var."}
          </p>
          <Link
            href={buildHref(q, tur === topGroup.kind ? null : topGroup.kind)}
            className="focus-ring press inline-flex min-h-[36px] items-center gap-1 rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-brand-600 transition hover:border-brand-300"
          >
            {tur === topGroup.kind ? "Filtreyi kaldır" : `Yalnız ${topGroup.title.toLocaleLowerCase("tr-TR")}`}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </section>
      ) : null}

      {sections.length === 0 ? (
        <div className="space-y-4">
          <EmptyState illustration="aramaYok"
            icon={Search}
            title={q.length >= 2 ? (tur ? "Bu türde sonuç yok" : "Sonuç bulunamadı") : "Aramaya başlayın"}
            description={
              q.length >= 2
                ? tur
                  ? `"${q}" için ${GROUPS.find((g) => g.kind === tur)?.title.toLocaleLowerCase("tr-TR")} grubunda eşleşme yok. Filtreyi kaldırıp diğer türlere bakabilirsiniz.`
                  : `"${q}" için eşleşen kayıt yok. Yazımı kontrol edin veya daha kısa bir terim deneyin. İpucu: Ctrl+K ile her sayfadan hızlı arama açabilirsiniz.`
                : "Yukarıdaki kutuya en az 2 karakter yazın. İpucu: Ctrl+K ile her sayfadan hızlı arama açabilirsiniz."
            }
            action={q.length >= 2 && tur ? { href: buildHref(q, null), label: "Filtreyi kaldır" } : undefined}
          />
          {/* Hızlı arama önerileri — boş durumda yönlendirme */}
          {q.length < 2 ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
              <p className="flex items-center gap-2 text-xs font-semibold text-text-muted">
                <Lightbulb className="h-3.5 w-3.5 text-amber-600" /> Örnek aramalar
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {QUICK_SEARCHES.map((s) => (
                  <Link
                    key={s}
                    href={buildHref(s, null)}
                    className="focus-ring press rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
                  >
                    {s}
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {sections.map((s) => {
            const Icon = s.icon;
            return (
              <section key={s.kind} className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
                <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                  <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
                    <span className={`grid h-7 w-7 place-items-center rounded-[var(--radius-control)] ${s.tone}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    {s.title}
                  </h2>
                  <Link
                    href={buildHref(q, tur === s.kind ? null : s.kind)}
                    title={tur === s.kind ? "Filtreyi kaldır" : `Yalnız ${s.title.toLocaleLowerCase("tr-TR")} göster`}
                    className={`focus-ring press rounded-full px-2 py-0.5 text-xs font-bold transition ${s.tone} hover:opacity-80`}
                  >
                    {s.items.length}
                  </Link>
                </div>
                <ul className="divide-y divide-line">
                  {s.items.map((hit) => (
                    <li key={`${hit.kind}-${hit.id}`}>
                      <Link
                        href={hit.href}
                        className="focus-ring group flex min-h-[48px] items-center gap-3 px-5 py-3 transition hover:bg-canvas"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink-950 group-hover:text-brand-600">
                            {hit.title}
                          </span>
                          <span className="block truncate text-xs text-text-muted">{hit.subtitle}</span>
                        </span>
                        <ArrowUpRight className="hover-action h-4 w-4 shrink-0 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <p className="px-1 text-xs text-text-muted">
            İpucu: <kbd className="rounded-[var(--radius-control)] border border-hairline bg-canvas px-1 py-0.5 text-xs">Ctrl</kbd>+
            <kbd className="rounded-[var(--radius-control)] border border-hairline bg-canvas px-1 py-0.5 text-xs">K</kbd> ile her
            sayfadan hızlı arama açabilirsiniz.
          </p>
        </div>
      )}
    </div>
  );
}
