import { BadgeCheck, Ban, CircleHelp, MessageSquareText, Radio, ShieldCheck } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { StatusPill } from "@/components/ui/list-kit/status-pill";
import { requirePlatformModule } from "@/lib/platform";
import { CHANNEL_LABELS, consentSourceLabel } from "@/lib/admin/ops/consent-coverage";
import { CONSENT_WINDOW_DAYS, loadConsentCoverage } from "@/lib/admin/ops/read";
import { OpsCard, OpsGrid, OpsKpis, OpsList, OpsRow, num, pct } from "../_components/ops-kit";
import "@/app/app/_home/kurumsal/home.css";

export const metadata = { title: "İleti izinleri" };

/**
 * İLETİ İZNİ (İYS) UYUMU — platform geneli. 6563 sayılı Kanun: ticari elektronik ileti yalnız onaylı alıcıya. Kaynak
 * `iys_consents` (müşteri × kanal son durum) + `iys_consent_events` (son 30 gün değişiklik kanıtı). Kanal bazında onaylı
 * oranı, kararı verilmemiş (bilinmiyor/bekliyor) kayıtlar, ret dalgası yaşayan ofisler (şikâyet/yanlış gönderim
 * sinyali) ve değişikliklerin kaynağı. Müşteri kişisel verisi bu ekrana gelmez (yalnız sayımlar ve ofis adı).
 */
export default async function ConsentCompliancePage() {
  await requirePlatformModule("members");
  const d = await loadConsentCoverage();
  const sum = (k: "total" | "granted" | "denied" | "undecided") => d.coverage.reduce((s, c) => s + c[k], 0);
  const total = sum("total");
  const sms = d.coverage.find((c) => c.channel === "sms");

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="mail"
        icon={MessageSquareText}
        eyebrow="Güvenlik & veri"
        title="İleti izinleri (İYS)"
        description="Ofislerin müşteri iletişim izinleri: kanal bazında onay oranı, kararı verilmemiş kayıtlar ve son 30 günün ret hareketleri. Bilinmiyor ve bekliyor durumundaki alıcıya ticari ileti gönderilemez."
      />

      {!d.ready ? (
        <EmptyState variant="panel" icon={MessageSquareText} title="İzin tablosu okunamadı" description="iys_consents tablosu bu ortamda yok ya da okunamadı." />
      ) : total === 0 ? (
        <EmptyState variant="panel" icon={MessageSquareText} title="Henüz izin kaydı yok" description="Ofisler müşteri kartında iletişim izni girdikçe ya da web formundan onay geldikçe kanal bazında oranlar burada görünür." />
      ) : (
        <>
          <OpsKpis
            label="İleti izni göstergeleri"
            items={[
              { key: "all", title: "İzin kaydı", value: num(total), href: "#kanallar", icon: ShieldCheck, tone: "brand", caption: "Müşteri × kanal" },
              { key: "ok", title: "Onaylı", value: pct(total ? Math.round((sum("granted") / total) * 1000) / 10 : null), href: "#kanallar", icon: BadgeCheck, tone: "mint", caption: `${num(sum("granted"))} kayıt` },
              { key: "und", title: "Kararsız", value: num(sum("undecided")), href: "#kanallar", icon: CircleHelp, tone: "amber", caption: "Bilinmiyor + bekliyor: gönderim yok" },
              { key: "rev", title: "Yeni ret", value: num(d.activity.revocations), href: "#ret", icon: Ban, tone: d.activity.revocations ? "rose" : "slate", caption: `Son ${CONSENT_WINDOW_DAYS} gün · ${num(d.activity.grants)} yeni onay` },
              { key: "sms", title: "SMS onay oranı", value: pct(sms?.grantedPct ?? null), href: "#kanallar", icon: Radio, tone: "violet", caption: `${num(sms?.total ?? 0)} SMS izni kaydı` },
            ]}
          />

          <OpsGrid>
            <OpsCard id="kanallar" icon={Radio} tone="brand" title="Kanal bazında izin durumu" sub="Onaylı oranı; bilinmiyor ve bekliyor gönderime izin vermez">
              <OpsList label="Kanallar">
                {d.coverage.map((c) => (
                  <OpsRow
                    key={c.channel}
                    primary={CHANNEL_LABELS[c.channel]}
                    secondary={c.unreadable ? "Sayım okunamadı" : `${num(c.granted)} onaylı · ${num(c.denied)} ret · ${num(c.undecided)} kararsız`}
                    right={
                      <div className="flex w-full min-w-0 items-center gap-3 sm:w-56">
                        <div className="min-w-0 flex-1">
                          <Progress value={c.grantedPct ?? 0} label={`${CHANNEL_LABELS[c.channel]} onay oranı`} tone={c.grantedPct !== null && c.grantedPct >= 60 ? "success" : "warning"} />
                        </div>
                        <span className="numeric w-14 shrink-0 text-right text-sm font-bold text-[var(--heading)]">{pct(c.grantedPct)}</span>
                      </div>
                    }
                  />
                ))}
              </OpsList>
            </OpsCard>

            <OpsCard id="ret" icon={Ban} tone="rose" title="Ret hareketi yaşayan ofisler" sub={`Son ${CONSENT_WINDOW_DAYS} günde onaydan rede dönen izinler; yoğunluk şikâyet ya da izinsiz gönderim sinyalidir`}>
              {d.activity.revocationOffices.length === 0 ? (
                <EmptyState variant="compact" bare icon={BadgeCheck} title="Son 30 günde ret yok" description="Bir müşteri iznini geri çektiğinde ofis bazında burada sayılır." />
              ) : (
                <OpsList label="Ret hareketi olan ofisler">
                  {d.activity.revocationOffices.map((o) => (
                    <OpsRow
                      key={o.tenantId}
                      primary={d.names.get(o.tenantId) ?? "Ofis"}
                      href={`/admin/tenants/${o.tenantId}?sekme=yasal`}
                      secondary={`${num(o.grants)} yeni onay aynı dönemde`}
                      right={<StatusPill tone="danger">{num(o.revocations)} ret</StatusPill>}
                    />
                  ))}
                </OpsList>
              )}
            </OpsCard>
          </OpsGrid>

          <OpsCard id="kaynak" icon={ShieldCheck} tone="violet" title="Değişikliklerin kaynağı" sub={`Son ${CONSENT_WINDOW_DAYS} gün izin değişikliği kanıtı (silinmez kayıt)`}>
            {d.activity.sources.length === 0 ? (
              <EmptyState variant="compact" bare icon={ShieldCheck} title="Son 30 günde izin değişikliği yok" />
            ) : (
              <OpsList label="Kaynaklar">
                {d.activity.sources.map((s) => (
                  <OpsRow key={s.source} primary={consentSourceLabel(s.source)} right={<span className="numeric text-sm font-bold text-[var(--heading)]">{num(s.count)} değişiklik</span>} />
                ))}
              </OpsList>
            )}
          </OpsCard>
          {d.truncated ? <p className="text-xs text-text-muted">Değişiklik okuması 20.000 kayıtla sınırlandı; hareket sayıları alt sınırdır.</p> : null}
        </>
      )}
    </div>
  );
}
