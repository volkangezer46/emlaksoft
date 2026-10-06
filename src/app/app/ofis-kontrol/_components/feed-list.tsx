import Link from "next/link";
import { ArrowUpRight, ScrollText } from "lucide-react";
import { riskOf, type RiskLevel } from "@/lib/audit-labels";
import { trDayKey } from "@/lib/clock";
import { dayHeading } from "@/lib/activity-timeline";
import { categoryOf, ENTITY_LABEL, entityHref, feedActionLabel, FEED_CATEGORIES } from "@/lib/oversight/feed";
import { feedParams, hasFeedFilter, type FeedFilters, type FeedPage, type FeedRow } from "@/lib/oversight/feed-query";
import { EmptyState } from "@/components/ui/empty-state";

const RISK_CHIP: Record<Exclude<RiskLevel, "dusuk">, { label: string; cls: string }> = {
  yuksek: { label: "Yüksek risk", cls: "bg-danger-500/10 text-danger-600" },
  orta: { label: "Orta risk", cls: "bg-amber-400/15 text-amber-700" },
};

const money = (n: number) => `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n)} ₺`;

/** Satir ozeti: yalniz bilinen, kisisel veri icermeyen alanlar (telefon/TC vb. ASLA gosterilmez). */
function detailOf(r: FeedRow, names: ReadonlyMap<string, string>): string | null {
  const nv = r.new_value ?? {};
  const parts: string[] = [];
  if (typeof nv.list_price === "number" || typeof nv.list_price === "string") {
    const n = Number(nv.list_price);
    if (Number.isFinite(n)) parts.push(`Fiyat: ${money(n)}`);
  }
  if (typeof nv.rows === "number") parts.push(`${new Intl.NumberFormat("tr-TR").format(nv.rows)} satır`);
  if (typeof nv.count === "number") parts.push(`${nv.count} kayıt`);
  if (typeof nv.assigned_to === "string") parts.push(`Yeni sorumlu: ${names.get(nv.assigned_to) ?? "—"}`);
  else if ("assigned_to" in nv && nv.assigned_to === null) parts.push("Sorumlu kaldırıldı");
  if (typeof nv.stage === "string") parts.push(`Aşama: ${nv.stage}`);
  if (typeof nv.status === "string") parts.push(`Durum: ${nv.status}`);
  return parts.length ? parts.join(" · ") : null;
}

export function feedAssignedIds(rows: readonly FeedRow[]): string[] {
  return rows.map((r) => r.new_value?.assigned_to).filter((v): v is string => typeof v === "string");
}

/** Islem akisi: gun basliklari, her satir ilgili kayda tiklanir. Sunucu bileseni. */
export function FeedList({
  data,
  names,
  filters,
  basePath,
  selfView,
}: {
  data: FeedPage;
  names: ReadonlyMap<string, string>;
  filters: FeedFilters;
  basePath: string;
  /** Danisman kendi akisi: aktor baglantilari gosterilmez. */
  selfView?: boolean;
}) {
  const href = (page: number) => {
    const qs = feedParams(filters, page).toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const filtered = hasFeedFilter(filters);

  if (data.failed) {
    return (
      <EmptyState
        icon={ScrollText}
        tone="danger"
        illustration="error"
        title="Akış yüklenemedi"
        description="Kayıtlar şu an okunamadı. Sayfayı yenileyin; sorun sürerse filtreleri temizleyip tekrar deneyin."
        action={{ href: basePath, label: "Filtreleri temizle" }}
      />
    );
  }
  if (data.rows.length === 0) {
    return (
      <EmptyState
        icon={ScrollText}
        title={filtered ? "Filtreye uyan işlem yok" : "Henüz işlem kaydı yok"}
        description={
          filtered
            ? "Tarih aralığını genişletmeyi ya da filtreleri temizlemeyi deneyin."
            : "İlk ilan, müşteri veya randevu işlemi yapıldığında burada zaman çizelgesi olarak görünür."
        }
        action={filtered ? { href: basePath, label: "Filtreleri temizle" } : undefined}
      />
    );
  }

  const groups: { key: string; heading: string; items: FeedRow[] }[] = [];
  for (const r of data.rows) {
    const key = trDayKey(r.created_at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(r);
    else groups.push({ key, heading: dayHeading(r.created_at), items: [r] });
  }
  const timeFmt = new Intl.DateTimeFormat("tr-TR", { timeStyle: "short", timeZone: "Europe/Istanbul" });
  const catLabel = (id: string) => FEED_CATEGORIES.find((c) => c.id === id)?.label ?? id;

  return (
    <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
      {groups.map((g) => (
        <div key={g.key}>
          <p className="border-y border-line bg-canvas/60 px-5 py-1.5 text-xs font-bold uppercase tracking-[0.08em] text-text-faint first:border-t-0">
            {g.heading}
          </p>
          <ul className="divide-y divide-line">
            {g.items.map((r) => {
              const risk = riskOf(r.action);
              const cat = categoryOf(r.action);
              const target = entityHref(r.entity_type, r.entity_id);
              const detail = detailOf(r, names);
              const actorName = r.actor_id ? (names.get(r.actor_id) ?? "Danışman") : "Sistem";
              return (
                <li key={r.id} className="grid gap-2 px-5 py-3.5 transition hover:bg-brand-600/[0.02] md:grid-cols-[1.4fr_1fr_auto] md:items-center">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-950">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${risk === "yuksek" ? "bg-danger-500" : risk === "orta" ? "bg-amber-400" : "bg-mint-500"}`}
                        aria-hidden
                      />
                      {target ? (
                        <Link href={target} className="focus-ring inline-flex items-center gap-1 hover:text-brand-600 hover:underline">
                          {feedActionLabel(r.action)}
                          <ArrowUpRight className="h-3.5 w-3.5 text-text-faint" aria-hidden />
                        </Link>
                      ) : (
                        feedActionLabel(r.action)
                      )}
                      {risk !== "dusuk" ? (
                        <Link
                          href={`${basePath}?${feedParams({ ...filters, risk }, 1).toString()}`}
                          title="Bu risk seviyesine göre filtrele"
                          className={`rounded-full px-2 py-0.5 text-xs font-bold transition hover:ring-1 hover:ring-brand-300 ${RISK_CHIP[risk].cls}`}
                        >
                          {RISK_CHIP[risk].label}
                        </Link>
                      ) : null}
                      {cat ? (
                        <Link
                          href={`${basePath}?${feedParams({ ...filters, kategori: cat.id }, 1).toString()}`}
                          title="Bu işlem türüne göre filtrele"
                          className="rounded-full bg-ink-950/[0.06] px-2 py-0.5 text-xs font-semibold text-text-muted transition hover:ring-1 hover:ring-brand-300"
                        >
                          {catLabel(cat.id)}
                        </Link>
                      ) : null}
                    </p>
                    {detail || r.entity_type ? (
                      <p className="mt-0.5 truncate text-xs text-text-muted">
                        {r.entity_type ? (ENTITY_LABEL[r.entity_type] ?? r.entity_type) : ""}
                        {detail ? `${r.entity_type ? " · " : ""}${detail}` : ""}
                      </p>
                    ) : null}
                  </div>
                  {selfView || !r.actor_id ? (
                    <p className="text-xs font-semibold text-ink-950">{selfView ? "Siz" : actorName}</p>
                  ) : (
                    <Link
                      href={`${basePath}?${feedParams({ ...filters, aktor: r.actor_id }, 1).toString()}`}
                      title="Bu danışmanın işlemlerini filtrele"
                      className="focus-ring text-xs font-semibold text-ink-950 transition hover:text-brand-600 hover:underline"
                    >
                      {actorName}
                    </Link>
                  )}
                  <time dateTime={r.created_at} className="text-xs font-semibold tabular-nums text-text-muted">
                    {timeFmt.format(new Date(r.created_at))}
                  </time>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {data.totalPages > 1 ? (
        <nav aria-label="Sayfalama" className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          {data.page > 1 ? (
            <Link href={href(data.page - 1)} className="focus-ring press rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
              ← Önceki
            </Link>
          ) : (
            <span className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">← Önceki</span>
          )}
          <span className="text-xs tabular-nums text-text-muted">
            Sayfa {data.page} / {data.totalPages} · toplam {data.total.toLocaleString("tr-TR")} kayıt
          </span>
          {data.page < data.totalPages ? (
            <Link href={href(data.page + 1)} className="focus-ring press rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
              Sonraki →
            </Link>
          ) : (
            <span className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">Sonraki →</span>
          )}
        </nav>
      ) : null}
    </div>
  );
}
