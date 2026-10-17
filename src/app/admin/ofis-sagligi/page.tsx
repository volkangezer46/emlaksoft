import { Activity, AlertTriangle, HeartPulse, TrendingDown, Users } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/list-kit/status-pill";
import { requirePlatformModule } from "@/lib/platform";
import { getSetting } from "@/lib/settings/read";
import { CRM_SETTING_KEYS } from "@/lib/settings/registry/crm";
import { HEALTH_BAND_LABELS, HEALTH_DEFAULT_RISK_THRESHOLD, HEALTH_GOOD_THRESHOLD } from "@/lib/admin/health-score";
import { HEALTH_COMPONENT_LABELS, type HealthComponent, type HealthMover } from "@/lib/admin/ops/health-radar";
import { loadHealthRadar } from "@/lib/admin/ops/read";
import { formatDateTr } from "@/lib/format";
import { OpsCard, OpsGrid, OpsKpis, OpsList, OpsRow, num } from "../_components/ops-kit";
import "@/app/app/_home/kurumsal/home.css";

export const metadata = { title: "Sağlık ve risk" };

const BAND_TONE = { riskli: "danger", izlenmeli: "warning", saglikli: "success" } as const;
const COMPONENT_HREF: Record<HealthComponent, string> = {
  usage: "/admin/tenants/kurulum",
  payment: "/admin/billing/tahsilat",
  support: "/admin/tickets",
};

/**
 * OFİS SAĞLIĞI VE KAYIP RİSKİ (müşteri başarısı kokpiti). Kaynak: gece işi `tenant_health_daily` (skor 0-100 =
 * kullanım + ödeme + destek bileşenleri; ağırlık ve risk eşiği ayar defterinden). Bant dağılımı, son 7 günde en çok
 * düşenler, riskli banda yeni girenler, düşük skorun nedeni (en zayıf bileşen) ve 8 haftalık ortalama. Her satır
 * Ofis 360 İlişki sekmesine, her sayı süzülmüş ofis listesine gider. Liste süzgeci Ofisler > `skor=` ile aynı eşik.
 */
export default async function OfficeHealthPage() {
  await requirePlatformModule("tenants");
  const threshold = await getSetting<number>(CRM_SETTING_KEYS.riskThreshold).catch(() => HEALTH_DEFAULT_RISK_THRESHOLD);
  const data = await loadHealthRadar(threshold);
  const r = data.radar;
  const delta = r.average !== null && r.previousAverage !== null ? Math.round((r.average - r.previousAverage) * 10) / 10 : null;
  const fmtDelta = (d: number | null) => (d === null ? "yeni" : d > 0 ? `+${d}` : String(d));

  const mover = (m: HealthMover) => (
    <OpsRow
      key={m.tenantId}
      primary={data.names.get(m.tenantId) ?? "Ofis"}
      href={`/admin/tenants/${m.tenantId}?sekme=iliski`}
      secondary={`En zayıf: ${HEALTH_COMPONENT_LABELS[m.weakest]} (${m[m.weakest]})${m.reasons?.length ? ` · ${m.reasons.join(" · ")}` : ""}`}
      right={
        <>
          <span className="numeric text-sm font-bold text-[var(--heading)]" title="Bugünkü skor">
            {m.score}
          </span>
          <StatusPill tone={m.delta !== null && m.delta < 0 ? "danger" : "neutral"} title="7 günlük değişim">
            {fmtDelta(m.delta)}
          </StatusPill>
          <StatusPill tone={BAND_TONE[m.band]}>{HEALTH_BAND_LABELS[m.band]}</StatusPill>
        </>
      }
    />
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="pulse"
        icon={HeartPulse}
        eyebrow="Ofisler · müşteri başarısı"
        title="Sağlık ve risk"
        description={
          r.latestDay
            ? `${formatDateTr(r.latestDay)} skorları, ${r.compareDay ? formatDateTr(r.compareDay) : "bir hafta önce"} ile karşılaştırıldı. Riskli eşiği ${threshold}, sağlıklı ${Math.max(threshold, HEALTH_GOOD_THRESHOLD)} ve üstü.`
            : "Gece sağlık işi henüz skor yazmadı."
        }
      />

      {!data.ready ? (
        <EmptyState variant="panel" icon={HeartPulse} title="Sağlık tablosu henüz kurulmadı" description="Platform CRM veritabanı güncellemesi uygulanınca gece işi ofis skorlarını yazar ve bu ekran dolar." />
      ) : r.scored === 0 ? (
        <EmptyState variant="panel" icon={HeartPulse} title="Henüz sağlık skoru yok" description="Gece sağlık işi (görev hatırlatma turu) her ofis için kullanım, ödeme ve destek bileşenlerinden skor üretir; ilk turdan sonra burada görünür." action={{ label: "Zamanlanmış işler", href: "/admin/sistem" }} />
      ) : (
        <>
          <OpsKpis
            label="Sağlık göstergeleri"
            items={[
              { key: "avg", title: "Ortalama skor", value: r.average === null ? "—" : num(r.average), href: "/admin/tenants", icon: Activity, tone: "brand", caption: delta === null ? `${num(r.scored)} ofis skorlandı` : `${delta >= 0 ? "+" : ""}${delta} · 7 güne göre`, series: data.series.map((s) => s.average), seriesLabel: "Son 8 hafta ortalama sağlık skoru" },
              { key: "risk", title: "Riskli ofis", value: num(r.bands.riskli), href: "/admin/tenants?skor=riskli", icon: AlertTriangle, tone: "rose", caption: `${num(r.newlyRisky.length)} bu hafta riskli banda girdi` },
              { key: "watch", title: "İzlenmeli", value: num(r.bands.izlenmeli), href: "/admin/tenants?skor=izlenmeli", icon: Users, tone: "amber", caption: "Eşik ile sağlıklı arası" },
              { key: "drop", title: "Hızlı düşen", value: num(r.decliners.length), href: "#dusenler", icon: TrendingDown, tone: "orange", caption: "7 günde 10+ puan düşüş" },
              { key: "ok", title: "Sağlıklı", value: num(r.bands.saglikli), href: "/admin/tenants?skor=saglikli", icon: HeartPulse, tone: "mint", caption: `${num(r.scored)} ofisin` },
            ]}
          />

          <OpsGrid>
            <OpsCard id="dusenler" icon={TrendingDown} tone="orange" title="En çok düşenler" sub="Son 7 günde skoru en az 10 puan düşen ofisler; hızlı müdahale adayı">
              {r.decliners.length === 0 ? (
                <EmptyState variant="compact" bare icon={TrendingDown} title="Hızlı düşen ofis yok" description="Bir haftada 10 puandan fazla düşen ofis olduğunda burada önem sırasıyla listelenir." />
              ) : (
                <OpsList label="En çok düşen ofisler">{r.decliners.map(mover)}</OpsList>
              )}
            </OpsCard>
            <OpsCard id="yeni-riskli" icon={AlertTriangle} tone="rose" title="Riskli banda yeni girenler" sub="Geçen hafta riskli değilken bugün eşiğin altında olanlar">
              {r.newlyRisky.length === 0 ? (
                <EmptyState variant="compact" bare icon={AlertTriangle} title="Yeni riskli ofis yok" description="Eşiğin altına inen ofis olduğunda burada görünür ve görev kuralları tetiklenir." />
              ) : (
                <OpsList label="Riskli banda yeni girenler">{r.newlyRisky.map(mover)}</OpsList>
              )}
            </OpsCard>
          </OpsGrid>

          <OpsGrid>
            <OpsCard id="neden" icon={Activity} tone="violet" title="Düşük skorun nedeni" sub="Riskli ve izlenmeli ofislerde en zayıf bileşen; satır ilgili iş kuyruğunu açar">
              <OpsList label="Zayıf bileşen dağılımı">
                {(Object.keys(HEALTH_COMPONENT_LABELS) as HealthComponent[]).map((c) => (
                  <OpsRow
                    key={c}
                    primary={HEALTH_COMPONENT_LABELS[c]}
                    href={COMPONENT_HREF[c]}
                    secondary={c === "usage" ? "Giriş günü, aktif kullanıcı, modül yaygınlığı ve kurulum" : c === "payment" ? "Abonelik durumu ve geciken faturalar" : "Açık talepler ve memnuniyet (CSAT)"}
                    right={<span className="numeric text-sm font-bold text-[var(--heading)]">{num(r.weakest[c])} ofis</span>}
                  />
                ))}
              </OpsList>
            </OpsCard>
            <OpsCard id="riskli" icon={HeartPulse} tone="rose" title="En düşük skorlu ofisler" sub="Riskli banttakiler, en düşük skor önce" right={<Link href="/admin/tenants?skor=riskli" className="kh-seeall focus-ring">Tümü</Link>}>
              {r.risky.length === 0 ? (
                <EmptyState variant="compact" bare icon={HeartPulse} title="Riskli ofis yok" description="Tüm ofisler risk eşiğinin üstünde." />
              ) : (
                <OpsList label="Riskli ofisler">{r.risky.map(mover)}</OpsList>
              )}
            </OpsCard>
          </OpsGrid>
          {data.truncated ? <p className="text-xs text-text-muted">Özet okuma üst sınırına ulaştı; sayılar en çok 10.000 ofis üzerinden hesaplandı.</p> : null}
        </>
      )}
    </div>
  );
}
