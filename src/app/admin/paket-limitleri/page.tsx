import { Bot, Building2, Gauge, Home, ShieldAlert, Users } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChip } from "@/components/ui/filter-chip";
import { StatusPill } from "@/components/ui/list-kit/status-pill";
import { requirePlatformModule } from "@/lib/platform";
import { planLabel } from "@/lib/billing/plans";
import {
  LIMIT_METRICS,
  LIMIT_METRIC_META,
  LIMIT_THRESHOLDS,
  groupLimitRows,
  isLimitMetric,
  limitTone,
  parseThreshold,
  summarizeLimits,
  type LimitMetric,
  type LimitThreshold,
} from "@/lib/admin/ops/limits";
import { loadLimits } from "@/lib/admin/ops/limits-read";
import { OpsCard, OpsKpis, num } from "../_components/ops-kit";
import "@/app/app/_home/kurumsal/home.css";

export const metadata = { title: "Paket limitleri" };

const BASE = "/admin/paket-limitleri";
const OFFICES_MAX = 100;

function href(esik: LimitThreshold, olcu: LimitMetric | null): string {
  const q = new URLSearchParams();
  if (esik !== 80) q.set("esik", String(esik));
  if (olcu) q.set("olcu", olcu);
  const s = q.toString();
  return s ? `${BASE}?${s}` : BASE;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * PAKET LİMİTLERİ (genişleme sinyali): paket limitine yaklaşan ofisler, ölçü bazında. Kaynak `limits-read.ts`
 * (`platform_tenant_limit_usage` + AI kredi defteri). Süzgeçler (`?esik=80|90|100`, `?olcu=`) sunucu sorgusuna yansır.
 * Her satır Ofis 360 > Kullanım'a, ofis adı Ofis 360'a gider. Eylem yok: paket/istisna değişikliği Ofis 360 > Abonelik'tedir.
 */
export default async function PlanLimitsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePlatformModule("tenants");
  const sp = (await searchParams) ?? {};
  const esik = parseThreshold(one(sp.esik));
  const rawMetric = one(sp.olcu);
  const olcu: LimitMetric | null = isLimitMetric(rawMetric) ? rawMetric : null;

  const d = await loadLimits(esik);
  const all = d.rows;
  const summary = summarizeLimits(all);
  const filtered = olcu ? all.filter((r) => r.metric === olcu) : all;
  const groups = groupLimitRows(filtered);
  const shown = groups.slice(0, OFFICES_MAX);
  const seatsPlus = summary.byMetric.seats;
  const listingsPlus = summary.byMetric.active_properties + summary.byMetric.customers + summary.byMetric.branches;
  const quotaPlus = summary.byMetric.ai + summary.byMetric.valuation;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="chart"
        icon={Gauge}
        eyebrow="Ofisler"
        title="Paket limitleri"
        description={`Paket limitinin %${esik} ve üstünü kullanan ofisler: kullanıcı, portföy, müşteri, şube ve bu ayın AI kredisi. Genişleme adayı ya da paket yükseltme konuşması için.`}
      />

      {!d.capsReady && !d.quotasReady ? (
        <EmptyState variant="panel" icon={Gauge} title="Limit verisi okunamadı" description="Kullanım fonksiyonu ya da kredi defteri bu ortamda okunamadı; sayı uydurulmaz." />
      ) : (
        <>
          <OpsKpis
            label="Limit göstergeleri"
            items={[
              { key: "o", title: "Limitine yakın ofis", value: num(summary.offices), href: href(esik, null), icon: Building2, tone: "brand", caption: `%${esik}+ en az bir ölçüde` },
              { key: "x", title: "Limiti dolan ölçü", value: num(summary.over), href: href(100, olcu), icon: ShieldAlert, tone: summary.over ? "rose" : "slate", caption: "%100 ve üstü" },
              { key: "s", title: "Koltuk", value: num(seatsPlus), href: href(esik, "seats"), icon: Users, tone: "mint", caption: "Kullanıcı limitine yakın" },
              { key: "l", title: "Portföy / müşteri / şube", value: num(listingsPlus), href: href(esik, "active_properties"), icon: Home, tone: "amber", caption: "Kayıt limitlerine yakın ölçü" },
              { key: "a", title: "AI ve değerleme", value: num(quotaPlus), href: href(esik, "ai"), icon: Bot, tone: "violet", caption: d.quotasReady ? `Bu ay (${d.monthKey})` : "Kredi defteri okunamadı" },
            ]}
          />

          <div className="space-y-2">
            <nav aria-label="Eşik" className="flex flex-wrap gap-2">
              {LIMIT_THRESHOLDS.map((t) => (
                <FilterChip key={t} href={href(t, olcu)} active={esik === t}>
                  %{t}+
                </FilterChip>
              ))}
            </nav>
            <nav aria-label="Ölçü" className="flex flex-wrap gap-2">
              <FilterChip href={href(esik, null)} active={!olcu} count={all.length}>
                Tümü
              </FilterChip>
              {LIMIT_METRICS.map((m) => (
                <FilterChip key={m} href={href(esik, m)} active={olcu === m} count={summary.byMetric[m]}>
                  {LIMIT_METRIC_META[m].label}
                </FilterChip>
              ))}
            </nav>
          </div>

          {!d.capsReady ? (
            <p role="status" className="text-xs text-text-muted">Koltuk / portföy / müşteri / şube kullanımı okunamadı (kullanım fonksiyonu bekliyor); yalnız AI kredisi gösteriliyor.</p>
          ) : null}
          {!d.quotasReady ? <p role="status" className="text-xs text-text-muted">AI kredi defteri okunamadı; yalnız kayıt limitleri gösteriliyor.</p> : null}

          <OpsCard
            id="ofisler"
            icon={Gauge}
            tone="brand"
            title={olcu ? `${LIMIT_METRIC_META[olcu].label}: %${esik}+` : `Limitine yakın ofisler: %${esik}+`}
            sub="Etkin limit = paket + ofise özel istisna + ek koltuk. Satır Ofis 360 > Kullanım'ı açar."
          >
            {shown.length === 0 ? (
              <EmptyState variant="compact" bare icon={Gauge} title="Bu eşikte limitine yakın ofis yok" description="Bir ofis paket limitinin bu oranına ulaştığında burada görünür." />
            ) : (
              <ul className="divide-y divide-line" aria-label="Limitine yakın ofisler">
                {shown.map((g) => {
                  const t = d.names.get(g.tenantId);
                  const name = t?.name ?? "Ofis";
                  return (
                    <li key={g.tenantId} className="py-3">
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                        <Link href={`/admin/tenants/${g.tenantId}`} className="focus-ring min-w-0 max-w-full rounded-[var(--radius-control)] hover:underline">
                          <span className="block truncate text-sm font-semibold text-[var(--heading)]" title={name}>
                            {name}
                          </span>
                          <span className="block truncate text-xs text-text-muted">{t?.plan ? planLabel(t.plan) : "Paket bilinmiyor"}</span>
                        </Link>
                      </div>
                      <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2" aria-label={`${name} ölçüleri`}>
                        {g.rows.map((r) => (
                          <li key={r.metric} className="min-w-0">
                            <Link
                              href={`/admin/tenants/${g.tenantId}?sekme=kullanim`}
                              className="focus-ring flex min-w-0 items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line px-3 py-2 hover:bg-ink-950/[0.03]"
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-xs font-semibold text-[var(--heading)]">{LIMIT_METRIC_META[r.metric].label}</span>
                                <span className="numeric block truncate text-xs text-text-muted">
                                  {num(r.used)} / {num(r.cap)} {LIMIT_METRIC_META[r.metric].unit}
                                </span>
                                <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-ink-950/8" aria-hidden>
                                  <span className={`block h-full rounded-full ${r.pct >= 100 ? "bg-danger-500" : r.pct >= 90 ? "bg-amber-500" : "bg-brand-500"}`} style={{ width: `${Math.min(100, r.pct)}%` }} />
                                </span>
                              </span>
                              <StatusPill tone={limitTone(r.pct)}>%{r.pct}</StatusPill>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}
            {groups.length > shown.length ? (
              <p className="pt-2 text-xs text-text-muted">En dolu {num(OFFICES_MAX)} ofis gösteriliyor ({num(groups.length)} ofisten); eşiği yükseltin ya da ölçü seçin.</p>
            ) : null}
          </OpsCard>

          <p className="text-xs text-text-muted">
            SMS: paketlerde SMS sınırı yoktur; ofisler kendi Netgsm hesabını bağlar (gönderim ve bakiye ofisin sağlayıcısındadır). Platform yedek SMS hesabının bakiyesi{" "}
            <Link href="/admin/sistem?sekme=entegrasyonlar" className="focus-ring rounded-sm font-semibold text-accent-text hover:underline">
              Entegrasyonlar
            </Link>{" "}
            kartında.
          </p>
        </>
      )}
    </div>
  );
}
