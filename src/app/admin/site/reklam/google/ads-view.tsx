import { AlertTriangle, ExternalLink, Info, Megaphone } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { toTrLocalInput } from "@/lib/clock";
import { adsCampaignUrl, type AdsRecommendation } from "@/lib/google/ads-rules";
import type { AdsDashboard } from "@/lib/google/ads-dashboard";
import type { ServiceCard } from "@/lib/google/view-model";

/**
 * Google Ads panosu (yalnız okuma): harcama, tıklama, dönüşüm, CPA + EmlakSoft'taki gerçek atıflı kayıtlar ve CAC.
 * Bağlı değilse boş durum + sihirbaz bağlantısı (uydurma veri YOK). Değişiklikler Google Ads arayüzünde yapılır.
 */

export const ADS_PERIODS = [30, 90] as const;
export type AdsPeriod = (typeof ADS_PERIODS)[number];

export type AdsViewData = {
  card: ServiceCard;
  period: AdsPeriod;
  customerId: string | null;
  dashboard: AdsDashboard | null;
  recommendations: AdsRecommendation[];
  readonly: boolean;
};

const money = (n: number | null) => (n === null ? "—" : n.toLocaleString("tr-TR", { maximumFractionDigits: 0 }));
const int = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 1 });

function Stat({ label, value, href, hint }: { label: string; value: string; href: string; hint?: string }) {
  const external = !href.startsWith("/") && !href.startsWith("#");
  const cls = "block rounded-[var(--radius-card)] border border-border bg-surface p-4 transition hover:border-border-strong";
  const body = (
    <>
      <span className="block text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      <span className="mt-1 block text-2xl font-bold tabular-nums text-ink-950">{value}</span>
      {hint ? <span className="mt-0.5 block text-xs text-text-muted">{hint}</span> : null}
    </>
  );
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {body}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {body}
    </Link>
  );
}

export function AdsView({ data }: { data: AdsViewData }) {
  const { card } = data;
  const linked = card.status !== "bagli_degil";
  const d = data.dashboard;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Reklam"
        icon={Megaphone}
        title="Google Ads"
        description="Reklam harcamanız ve EmlakSoft'a gerçekten gelen kayıtlar yan yana. Veriler her gece güncellenir."
        art="megaphone"
      />
      <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-brand-600/8 px-3 py-2 text-sm text-ink-950">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" aria-hidden />
        Reklam bütçesi ve teklif değişiklikleri bu sürümde Google Ads içinden yapılır; burada öneri görürsünüz.
      </p>
      {data.readonly ? (
        <p role="status" className="rounded-[var(--radius-control)] bg-surface-hover px-3 py-2 text-sm text-text-muted">
          Salt okunur görünüm.
        </p>
      ) : null}

      {!linked ? (
        <EmptyState
          illustration="start"
          title="Google Ads bağlı değil"
          description="Bağlandığında kampanya harcaması, tıklama, dönüşüm ve kayıt başı maliyet her gece kendiliğinden gelir. Burada uydurma veri gösterilmez."
          action={{ href: "/admin/site/baglantilar", label: "Bağlantılar ve kurulum" }}
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
            <p className="text-xs text-text-muted">Son senkron: {card.lastSyncAt ? toTrLocalInput(card.lastSyncAt).replace("T", " ") : "henüz yok"}</p>
            <nav aria-label="Dönem" className="flex gap-1">
              {ADS_PERIODS.map((p) => (
                <Link
                  key={p}
                  href={p === 30 ? "/admin/site/reklam/google" : `/admin/site/reklam/google?donem=${p}`}
                  aria-current={p === data.period ? "page" : undefined}
                  className={`rounded-full px-3 py-1 text-xs font-bold ${p === data.period ? "bg-brand-600 text-white" : "bg-surface-hover text-text-muted hover:text-ink-950"}`}
                >
                  Son {p} gün
                </Link>
              ))}
            </nav>
          </div>

          {!d || d.campaigns.length === 0 ? (
            <EmptyState
              variant="full"
              illustration="list"
              title="Veri birikiyor"
              description="Bağlantıdan sonraki ilk gece senkronunda son 90 günün kampanya metrikleri gelir."
            />
          ) : (
            <>
              <section aria-label="Özet" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Stat label="Harcama" value={money(d.total.spend)} href="#kampanyalar" />
                <Stat label="Tıklama" value={int(d.total.clicks)} href="#kampanyalar" />
                <Stat label="Dönüşüm (Ads)" value={int(d.total.conversions)} href="#kampanyalar" />
                <Stat label="CPA" value={money(d.total.cpa)} href="#kampanyalar" hint="Harcama / Ads dönüşümü" />
                <Stat
                  label="CAC (gerçek kayıt)"
                  value={money(d.total.cac)}
                  href="/admin/site/reklam#kanallar"
                  hint={`${int(d.total.signups)} atıflı kayıt${d.unmatchedSignups > 0 ? ` · ${d.unmatchedSignups} eşleşmeyen` : ""}`}
                />
              </section>

              <Card id="kampanyalar">
                <CardHeader>
                  <div>
                    <CardTitle>Kampanyalar · son {data.period} gün</CardTitle>
                    <CardDescription>
                      Kayıtlar EmlakSoft&apos;taki gerçek ofis açılışlarıdır: <span className="font-mono">utm_campaign</span> değeri kampanya adı ya da
                      kimliğiyle eşleşir. CAC = harcama / atıflı kayıt; kayıt yoksa hesaplanmaz.
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="adm-tbl-m w-full md:min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                        <th className="py-2 pr-3 font-semibold">Kampanya</th>
                        <th className="py-2 pr-3 text-right font-semibold">Harcama</th>
                        <th className="py-2 pr-3 text-right font-semibold">Tıklama</th>
                        <th className="py-2 pr-3 text-right font-semibold">Dönüşüm</th>
                        <th className="py-2 pr-3 text-right font-semibold">CPA</th>
                        <th className="py-2 pr-3 text-right font-semibold">Kayıt</th>
                        <th className="py-2 text-right font-semibold">CAC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.campaigns.map((c) => (
                        <tr key={c.campaignId} className="border-b border-border/60">
                          <td className="max-w-[280px] truncate py-2 pr-3">
                            <a
                              href={adsCampaignUrl(c.campaignId, data.customerId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-medium text-ink-950 hover:text-brand-700 hover:underline"
                            >
                              {c.campaign || c.campaignId}
                              <ExternalLink className="h-3 w-3" aria-hidden />
                            </a>
                          </td>
                          <td data-label="Harcama" className="py-2 pr-3 text-right tabular-nums">{money(c.spend)}</td>
                          <td data-label="Tıklama" className="py-2 pr-3 text-right tabular-nums">{int(c.clicks)}</td>
                          <td data-label="Dönüşüm" className="py-2 pr-3 text-right tabular-nums">{int(c.conversions)}</td>
                          <td data-label="CPA" className="py-2 pr-3 text-right tabular-nums">{money(c.cpa)}</td>
                          <td data-label="Kayıt" className="py-2 pr-3 text-right tabular-nums">{int(c.signups)}</td>
                          <td data-label="CAC" className="py-2 text-right tabular-nums">{money(c.cac)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Öneriler</CardTitle>
                <CardDescription>Kural tabanlı; son 30 günün verisinden. Uygulamak için Google Ads&apos;te açın.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {data.recommendations.length === 0 ? (
                <p role="status" className="text-sm text-text-muted">
                  Şu an öneri yok: dönüşümsüz harcama, aşırı yüksek dönüşüm maliyeti ya da bütçesi kısıtlı verimli kampanya görülmedi.
                </p>
              ) : (
                <ul className="space-y-3">
                  {data.recommendations.map((r) => (
                    <li key={`${r.code}:${r.adGroupId ?? r.campaignId}`} className="rounded-[var(--radius-control)] border border-border p-3">
                      <p className="text-sm font-semibold text-ink-950">{r.title}</p>
                      <p className="mt-1 text-sm text-text-muted">{r.explain}</p>
                      <a
                        href={r.adsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
                      >
                        Google Ads&apos;te aç <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
