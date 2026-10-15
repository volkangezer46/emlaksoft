import { AlertTriangle, BarChart3, FileSearch, Info, Search, Sparkles } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { SegmentTabs } from "@/components/ui/segment-tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { toTrLocalInput } from "@/lib/clock";
import { canAutoOptimize, seoRecordHref } from "@/lib/google/collector";
import { pathOfPage } from "@/lib/google/gsc";
import { PERIODS, fmtInt, fmtPct, fmtPos, isOpportunity, totals, type Period, type PerfRow } from "@/lib/google/performance-model";
import type { ServiceCard } from "@/lib/google/view-model";

/**
 * Arama performansı (Search Console) görünümü — SEO > Arama performansı sekmesi (`/admin/site/seo?sekme=performans`):
 * sorgu ve sayfa tabloları, 28/90 gün, fırsat bayrağı, URL inceleme sonuçları. Alt sekme `alt=`, dönem `donem=`.
 * Yalnız toplanmış tablolardan çizilir; bağlı değilse kurulum kartı (uydurma sayı yok).
 */

export const TABS = [
  { id: "sorgular", label: "Sorgular", icon: Search },
  { id: "sayfalar", label: "Sayfa performansı", icon: BarChart3 },
  { id: "inceleme", label: "Dizin durumu", icon: FileSearch },
] as const;

export const PERFORMANCE_BASE = "/admin/site/seo?sekme=performans";

export type InspectionView = { url: string; checked_at: string; verdict: string; coverage: string | null; google_canonical: string | null; user_canonical: string | null };

export type PerformanceData = {
  card: ServiceCard;
  property: string | null;
  period: Period;
  tab: "sorgular" | "sayfalar" | "inceleme";
  queries: PerfRow[] | null;
  pages: PerfRow[] | null;
  inspections: InspectionView[] | null;
};

const VERDICT: Record<string, string> = { PASS: "Dizinde", PARTIAL: "Kısmen", FAIL: "Dizinde değil", NEUTRAL: "Hariç tutuldu" };

export function SetupCard({ title, description }: { title: string; description: string }) {
  return (
    <EmptyState
      illustration="start"
      title={title}
      description={description}
      action={{ href: "/admin/site/baglantilar", label: "Bağlantılar ve kurulum" }}
    />
  );
}

function periodHref(tab: string, p: Period) {
  const q = new URLSearchParams();
  if (tab !== "sorgular") q.set("alt", tab);
  if (p !== 28) q.set("donem", String(p));
  const s = q.toString();
  return `${PERFORMANCE_BASE}${s ? `&${s}` : ""}`;
}

function OppBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
      <Sparkles className="h-3 w-3" aria-hidden /> Fırsat
    </span>
  );
}

function PerfTable({ rows, kind }: { rows: PerfRow[]; kind: "query" | "page" }) {
  return (
    <div className="overflow-x-auto">
      <table className="adm-tbl-m w-full md:min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
            <th className="py-2 pr-3 font-semibold">{kind === "query" ? "Sorgu" : "Sayfa"}</th>
            <th className="py-2 pr-3 text-right font-semibold">Tıklama</th>
            <th className="py-2 pr-3 text-right font-semibold">Gösterim</th>
            <th className="py-2 pr-3 text-right font-semibold">TO (CTR)</th>
            <th className="py-2 pr-3 text-right font-semibold">Ort. sıra</th>
            <th className="py-2 font-semibold">
              <span className="sr-only">Bayrak</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const path = kind === "page" ? pathOfPage(r.key) : null;
            const editable = path ? canAutoOptimize(path) : false;
            const href =
              kind === "query" ? `https://www.google.com/search?q=${encodeURIComponent(r.key)}&hl=tr` : editable && path ? seoRecordHref(path) : r.key;
            const external = !href.startsWith("/");
            return (
              <tr key={r.key} className="border-b border-border/60">
                <td className="max-w-[360px] truncate py-2 pr-3">
                  {external ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-ink-950 hover:text-brand-700 hover:underline" title={r.key}>
                      {path ?? r.key}
                    </a>
                  ) : (
                    <Link href={href} className="font-medium text-ink-950 hover:text-brand-700 hover:underline" title={r.key}>
                      {path ?? r.key}
                    </Link>
                  )}
                </td>
                <td data-label="Tıklama" className="py-2 pr-3 text-right tabular-nums">{fmtInt(r.clicks)}</td>
                <td data-label="Gösterim" className="py-2 pr-3 text-right tabular-nums">{fmtInt(r.impressions)}</td>
                <td data-label="TO (CTR)" className="py-2 pr-3 text-right tabular-nums">{fmtPct(r.ctr)}</td>
                <td data-label="Ort. sıra" className="py-2 pr-3 text-right tabular-nums">{fmtPos(r.avg_position)}</td>
                <td className="py-2">{isOpportunity(r) ? <OppBadge /> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PerformanceView({ data }: { data: PerformanceData }) {
  const { card } = data;
  const connected = card.status === "bagli" || card.status === "kota" || card.status === "yeniden_bagla";

  return (
    <div className="space-y-6">
      <p className="text-sm text-text-muted">Google aramasında hangi sorgularla ve sayfalarla göründüğünüz (Search Console). Veriler her gece güncellenir.</p>

      {!connected ? (
        <SetupCard
          title="Search Console bağlı değil"
          description="Bağlandığında sorgu, sayfa ve dizin durumu verileri her gece kendiliğinden gelir. Kurulum beş adımdır."
        />
      ) : (
        <>
          {card.status === "yeniden_bagla" ? (
            <p role="alert" className="flex items-center gap-1.5 rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600">
              <AlertTriangle className="h-4 w-4" aria-hidden /> Bağlantı koptu; yeni veri gelmiyor.{" "}
              <Link href="/admin/site/baglantilar" className="underline">
                Yeniden bağlayın
              </Link>
              .
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentTabs
              items={TABS.map((t) => ({ id: t.id, label: t.label, href: t.id === "sorgular" ? PERFORMANCE_BASE : `${PERFORMANCE_BASE}&alt=${t.id}` }))}
              active={data.tab}
              label="Arama performansı alt sekmeleri"
            />
            {data.tab !== "inceleme" ? (
              <nav aria-label="Dönem" className="flex gap-1">
                {PERIODS.map((p) => (
                  <Link
                    key={p}
                    href={periodHref(data.tab, p)}
                    aria-current={p === data.period ? "page" : undefined}
                    className={`rounded-full px-3 py-1 text-xs font-bold ${p === data.period ? "bg-brand-600 text-white" : "bg-surface-hover text-text-muted hover:text-ink-950"}`}
                  >
                    Son {p} gün
                  </Link>
                ))}
              </nav>
            ) : null}
          </div>
          <p className="text-xs text-text-muted">
            Mülk: <span className="font-mono">{data.property ?? "—"}</span> · Son senkron: {card.lastSyncAt ? toTrLocalInput(card.lastSyncAt).replace("T", " ") : "henüz yok"}
          </p>

          {data.tab === "inceleme" ? (
            <InspectionTable rows={data.inspections} />
          ) : (
            <PerfSection rows={data.tab === "sorgular" ? data.queries : data.pages} kind={data.tab === "sorgular" ? "query" : "page"} period={data.period} />
          )}
        </>
      )}
    </div>
  );
}

function PerfSection({ rows, kind, period }: { rows: PerfRow[] | null; kind: "query" | "page"; period: Period }) {
  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        variant="full"
        illustration="list"
        title="Veri birikiyor"
        description="Bağlantıdan sonraki ilk gece senkronunda son 90 günün verisi gelir. Google verisi 2-3 gün gecikmeli olgunlaşır."
      />
    );
  }
  const t = totals(rows);
  const opp = rows.filter(isOpportunity).length;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{kind === "query" ? "Sorgular" : "Sayfalar"} · son {period} gün</CardTitle>
          <CardDescription>
            Listelenen satırlar: {fmtInt(t.clicks)} tıklama, {fmtInt(t.impressions)} gösterim, TO {fmtPct(t.ctr)}
            {opp > 0 ? ` · ${opp} fırsat` : ""}.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="flex items-start gap-2 text-xs text-text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Sorgu toplamı ≠ sayfa toplamı (Google nadir sorguları gizler). &quot;Fırsat&quot;: 4–15. sırada, en az 100 gösterim ve sıraya göre tahmini
          tıklanma oranının yarısından az; başlık ve açıklamayı iyileştirmek tıklamayı artırabilir.
        </p>
        <PerfTable rows={rows} kind={kind} />
      </CardContent>
    </Card>
  );
}

function InspectionTable({ rows }: { rows: InspectionView[] | null }) {
  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        variant="full"
        illustration="list"
        title="Henüz inceleme yok"
        description="Her gece sitemap'teki en çok 50 adres Google'a sorulur: önce yeni ve değişen sayfalar, sonra en eski incelenenler."
      />
    );
  }
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Dizin durumu (URL denetimi)</CardTitle>
          <CardDescription>Google&apos;ın her sayfa için son kararı. &quot;Dizinde değil&quot; ve kanonik farkı Kokpit&apos;e bulgu olarak düşer.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="adm-tbl-m w-full md:min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              <th className="py-2 pr-3 font-semibold">Adres</th>
              <th className="py-2 pr-3 font-semibold">Karar</th>
              <th className="py-2 pr-3 font-semibold">Kapsam</th>
              <th className="py-2 pr-3 font-semibold">Kanonik</th>
              <th className="py-2 font-semibold">İncelendi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const path = pathOfPage(r.url);
              const mismatch = r.google_canonical && r.user_canonical && r.google_canonical.replace(/\/+$/, "") !== r.user_canonical.replace(/\/+$/, "");
              return (
                <tr key={r.url} className="border-b border-border/60">
                  <td className="max-w-[320px] truncate py-2 pr-3">
                    {path && canAutoOptimize(path) ? (
                      <Link href={seoRecordHref(path)} className="font-medium text-ink-950 hover:text-brand-700 hover:underline">
                        {path}
                      </Link>
                    ) : (
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink-950 hover:text-brand-700 hover:underline">
                        {path ?? r.url}
                      </a>
                    )}
                  </td>
                  <td data-label="Karar" className={`py-2 pr-3 font-semibold ${r.verdict === "PASS" ? "text-mint-700" : "text-danger-600"}`}>{VERDICT[r.verdict] ?? r.verdict}</td>
                  <td data-label="Kapsam" className="max-w-[240px] truncate py-2 pr-3 text-text-muted">{r.coverage ?? "—"}</td>
                  <td data-label="Kanonik" className="py-2 pr-3 text-xs">{mismatch ? <span className="font-semibold text-amber-900">Google farklı seçti</span> : "Uyumlu"}</td>
                  <td data-label="İncelendi" className="py-2 text-xs text-text-muted">{toTrLocalInput(r.checked_at).replace("T", " ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
