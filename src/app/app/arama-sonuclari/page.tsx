import Link from "next/link";
import {
  ArrowUpRight,
  Building2,
  Handshake,
  LifeBuoy,
  ListChecks,
  Search,
  Target,
  Users,
} from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { searchWorkspace, type SearchHit } from "@/app/actions/search";
import { EmptyState } from "@/components/app/empty-state";

/**
 * Global arama sonuç sayfası — komut paletindeki "Tüm sonuçları gör" hedefi.
 * Aynı searchWorkspace aksiyonunu daha yüksek limitle çağırır; sonuçlar türe
 * göre gruplu bölümlerde listelenir, boş gruplar gizlenir.
 */

// Bölüm sırası ve görünümü — komut paletindeki kindMeta ile aynı dil.
const GROUPS: Array<{
  kind: SearchHit["kind"];
  title: string;
  icon: typeof Users;
  tone: string;
}> = [
  { kind: "customer", title: "Müşteriler", icon: Users, tone: "text-brand-600 bg-brand-600/10" },
  { kind: "property", title: "Portföyler", icon: Building2, tone: "text-mint-600 bg-mint-500/12" },
  { kind: "demand", title: "Talepler", icon: Target, tone: "text-cyan-600 bg-cyan-400/12" },
  { kind: "deal", title: "Anlaşmalar", icon: Handshake, tone: "text-violet-600 bg-violet-500/12" },
  { kind: "task", title: "Görevler", icon: ListChecks, tone: "text-amber-600 bg-amber-400/15" },
  { kind: "ticket", title: "Destek", icon: LifeBuoy, tone: "text-amber-600 bg-amber-400/15" },
];

export default async function AramaSonuclariPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  await requireModulePage("dashboard");
  const params = (await searchParams) ?? {};
  const q = (params.q ?? "").trim();

  // En az 2 karakter — searchWorkspace ile aynı eşik; kısa sorgu boş döner.
  const hits = q.length >= 2 ? await searchWorkspace(q, 60) : [];

  const byKind = new Map<SearchHit["kind"], SearchHit[]>();
  for (const h of hits) byKind.set(h.kind, [...(byKind.get(h.kind) ?? []), h]);
  const sections = GROUPS.map((g) => ({ ...g, items: byKind.get(g.kind) ?? [] })).filter(
    (g) => g.items.length > 0,
  );

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
            <Search className="h-4 w-4" /> Global arama
          </span>
          <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Arama sonuçları</h1>
          <p className="mt-1 text-sm text-white/75">
            {q.length >= 2 ? (
              <>
                &quot;{q}&quot; için {hits.length} sonuç bulundu.
              </>
            ) : (
              "Müşteri, portföy, talep, anlaşma, görev ve destek kayıtlarında arayın."
            )}
          </p>
          {/* GET formu — sorgu URL'e yazılır (?q=), sunucu tarafında aranır */}
          <form action="/app/arama-sonuclari" className="relative mt-4 flex max-w-xl items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                name="q"
                type="search"
                defaultValue={q}
                placeholder="En az 2 karakter — ad, telefon, ilan no…"
                aria-label="Arama sorgusu"
                className="w-full rounded-[11px] border border-white/15 bg-white/8 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-white/40 outline-none backdrop-blur transition focus:border-white/40"
              />
            </div>
            <button
              type="submit"
              className="focus-ring press rounded-[11px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Ara
            </button>
          </form>
        </div>
      </section>

      {sections.length === 0 ? (
        <EmptyState
          icon={Search}
          title={q.length >= 2 ? "Sonuç bulunamadı" : "Aramaya başlayın"}
          description={
            q.length >= 2
              ? `"${q}" için eşleşen kayıt yok. Yazımı kontrol edin veya daha kısa bir terim deneyin. İpucu: Ctrl+K ile her sayfadan hızlı arama açabilirsiniz.`
              : "Yukarıdaki kutuya en az 2 karakter yazın. İpucu: Ctrl+K ile her sayfadan hızlı arama açabilirsiniz."
          }
        />
      ) : (
        <div className="space-y-4">
          {sections.map((s) => {
            const Icon = s.icon;
            return (
              <section key={s.kind} className="overflow-hidden rounded-[20px] border border-line bg-surface">
                <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                  <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
                    <span className={`grid h-7 w-7 place-items-center rounded-[8px] ${s.tone}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    {s.title}
                  </h2>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${s.tone}`}>{s.items.length}</span>
                </div>
                <ul className="divide-y divide-line">
                  {s.items.map((hit) => (
                    <li key={`${hit.kind}-${hit.id}`}>
                      <Link
                        href={hit.href}
                        className="focus-ring group flex items-center gap-3 px-5 py-3 transition hover:bg-canvas"
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
            İpucu: <kbd className="rounded-[5px] border border-hairline bg-canvas px-1 py-0.5 text-[10px]">Ctrl</kbd>+
            <kbd className="rounded-[5px] border border-hairline bg-canvas px-1 py-0.5 text-[10px]">K</kbd> ile her
            sayfadan hızlı arama açabilirsiniz.
          </p>
        </div>
      )}
    </div>
  );
}
