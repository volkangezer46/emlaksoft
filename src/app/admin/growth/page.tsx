import Link from "next/link";
import { Handshake, Hourglass, Megaphone, ShieldAlert, Sprout, Users, Wallet, CheckCircle2, AlertTriangle } from "lucide-react";
import { requirePlatformModule } from "@/lib/platform";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { FunnelChart, RadialGauge } from "@/components/ui/viz";
import { AdminStatCard, AdminStatGrid } from "@/components/admin/admin-stat-card";
import { AdminEmpty, AdminFilterChip, AdminPanel, AdminScrollArea } from "@/components/admin/admin-table";
import { describeRewardRule } from "@/lib/growth/settings";
import { getAdminGrowthOverview, type GrowthReadiness } from "@/lib/growth/store";
import { QUEUE_FILTERS, parseQueueFilter, type QueueFilter } from "@/lib/growth/engine";
import {
  CLAIM_COMPONENT_LABEL,
  CLAIM_STATUS_LABEL,
  flagLabel,
  formatDecimal,
  formatPercent,
  type ClaimStatus,
  type ReadinessCheck,
} from "@/lib/growth/program";
import { formatDateTr, formatTry } from "@/lib/format";
import { buildGrowthFunnel, growthIsIdle, kFactorParts, readinessSummary } from "./funnel-model";
import { ClaimActions, FlagsForm, PartnerDetailsForm, PartnerForm, PartnerStatus, PayoutForm, RuleForm, RuleToggle, SettingsForm } from "./growth-forms";

export const metadata = { title: "Büyüme" };

const SOURCE_LABEL: Record<string, string> = {
  referral: "Ofis daveti",
  partner: "Ortak",
  powered_by: "Vitrin imzası",
  none: "Yalnız kaynak etiketi",
};
const PARTNER_TYPE_LABEL: Record<string, string> = {
  trainer: "Eğitmen",
  agency: "Ajans",
  accountant: "Mali müşavir",
  creator: "İçerik üreticisi",
  institution: "Kurum",
  other: "Diğer",
};
const QUEUE_LABEL: Record<QueueFilter, string> = {
  pending: "İncelemede",
  held: "Bekleme süresinde",
  due: "Vadesi gelen",
  flagged: "Bayraklı",
  approved: "Onaylı",
  paid: "Ödenen",
  reversed: "Geri alınan",
  rejected: "Reddedilen",
};
const SHOW_LIMIT = 100;

function hrefFor(p: { kaynak?: string; ortak?: string }) {
  const q = new URLSearchParams();
  if (p.kaynak) q.set("kaynak", p.kaynak);
  if (p.ortak) q.set("ortak", p.ortak);
  const s = q.toString();
  return s ? `/admin/growth?${s}#kayitlar` : "/admin/growth#kayitlar";
}

function queueHref(f: QueueFilter | null) {
  return f ? `/admin/growth?kuyruk=${f}#kuyruk` : "/admin/growth#kuyruk";
}

function ReadinessList({ title, checks }: { title: string; checks: ReadinessCheck[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-bold text-ink-950">{title}</h3>
      <ul className="space-y-1.5">
        {checks.map((c) => (
          <li key={c.key} className="flex items-start gap-2 text-sm">
            {c.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mint-600" aria-label="Tamam" />
            ) : (
              <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${c.blocking ? "text-danger-500" : "text-amber-600"}`} aria-label={c.blocking ? "Engelleyici" : "Uyarı"} />
            )}
            <span>
              <span className="font-semibold text-ink-950">{c.label}</span>
              <span className="text-text-muted"> — {c.detail}</span>
              {!c.ok && c.blocking ? <span className="ml-1 text-xs font-bold text-danger-500">(açmadan önce gerekli)</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReadinessPanel({ readiness }: { readiness: GrowthReadiness }) {
  const summary = readinessSummary([readiness.referral, readiness.partner, readiness.cash]);
  return (
    <div className="@container p-5">
      <div className="mb-4 flex items-center gap-4">
        <RadialGauge value={summary.ok} max={Math.max(1, summary.total)} size={64} stroke={7} tone={summary.blocking > 0 ? "danger" : "success"} ariaLabel="Hazırlık maddeleri">
          <span className="text-xs font-bold tabular-nums text-ink-950">
            {summary.ok}/{summary.total}
          </span>
        </RadialGauge>
        <p className="text-sm text-text-muted">
          {summary.blocking > 0 ? `${summary.blocking} engelleyici madde açmadan önce tamamlanmalı.` : "Engelleyici madde yok."}
        </p>
      </div>
      <div className="grid gap-5 @3xl:grid-cols-3">
        <ReadinessList title="Müşteri-getir-müşteri" checks={readiness.referral} />
        <ReadinessList title="Profesyonel ortak (komisyon)" checks={readiness.partner} />
        <ReadinessList title="Nakit ortak ödemesi" checks={readiness.cash} />
      </div>
    </div>
  );
}

export default async function AdminGrowthPage({
  searchParams,
}: {
  searchParams: Promise<{ kaynak?: string; ortak?: string; kuyruk?: string }>;
}) {
  const staff = await requirePlatformModule("sales");
  const sp = await searchParams;
  const kaynak = sp.kaynak && (sp.kaynak in SOURCE_LABEL || sp.kaynak === "odeyen") ? sp.kaynak : "";
  const ortak = /^[0-9a-f-]{36}$/i.test(sp.ortak ?? "") ? (sp.ortak as string) : "";
  const kuyruk = parseQueueFilter(sp.kuyruk);
  const isSuper = staff.role === "super_admin";

  const ov = await getAdminGrowthOverview({ queue: kuyruk });
  const m = ov.metrics;

  let rows = ov.rows;
  if (kaynak === "odeyen") rows = rows.filter((r) => r.paying);
  else if (kaynak) rows = rows.filter((r) => r.refKind === kaynak);
  if (ortak) rows = rows.filter((r) => r.partnerId === ortak);
  const shown = rows.slice(0, SHOW_LIMIT);
  const partnerRules = ov.rules.filter((r) => r.kind === "partner").map((r) => ({ id: r.id, name: r.name }));
  const pending = ov.statusCounts.pending ?? 0;
  const idle = growthIsIdle(ov.flags, ov.rules.filter((r) => r.is_active).length);
  const funnel = m
    ? buildGrowthFunnel(m, ov.statusCounts.paid ?? 0, {
        clicks: hrefFor({ kaynak: "referral" }),
        signups: hrefFor({ kaynak: "referral" }),
        payers: hrefFor({ kaynak: "odeyen" }),
        rewards: queueHref("paid"),
      })
    : [];
  const kf = m ? kFactorParts(m) : { invites: null, conversion: null, k: null, selfSustaining: false };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="EmlakSoft · Organik büyüme"
        icon={Sprout}
        title="Büyüme"
        description="Müşteri-getir-müşteri ve profesyonel ortak programı: kayıt kaynakları, talep (ödül/komisyon) kuyruğu, ölçüm ve aktivasyon. Ödül kuralları ve kademe sayıları yalnız burada tanımlanır; kodda sabit tutar yoktur."
        glow="mint"
      >
        <AdminStatGrid className="mt-5">
          <AdminStatCard label="Atıflı kayıt" value={ov.available ? ov.counts.total : null} href="/admin/growth#kayitlar" icon={Users} tone="dark" emptyHint="Tablolar etkin değil" />
          <AdminStatCard label="Ofis daveti" value={ov.available ? ov.counts.referral : null} href={hrefFor({ kaynak: "referral" })} icon={Megaphone} tone="dark" emptyHint="Tablolar etkin değil" />
          <AdminStatCard label="Ortak" value={ov.available ? ov.counts.partner : null} href={hrefFor({ kaynak: "partner" })} icon={Handshake} tone="dark" emptyHint="Tablolar etkin değil" />
          <AdminStatCard label="Ödeyen" value={ov.available ? ov.counts.payers : null} href={hrefFor({ kaynak: "odeyen" })} icon={Wallet} tone="dark" emptyHint="Tablolar etkin değil" />
        </AdminStatGrid>
      </AdminPageHeader>

      {!ov.available ? (
        <div role="status" className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-sm text-text-muted">
          Büyüme tabloları henüz etkin değil: 20260825000800 / 20260825000900 migration&apos;ları uygulanana kadar kayıt atfı yazılmaz ve
          sayılar gösterilmez. Uygulama normal çalışır.
        </div>
      ) : !ov.engine ? (
        <div role="status" className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-sm text-text-muted">
          Referans motoru (20260826000600) henüz etkin değil: talep kuyruğu, ölçüm ve ödül işleyicisi çalışmaz. Aşağıdaki hazırlık kontrolü
          programın açılmasını engeller.
        </div>
      ) : null}

      <AdminPanel title="Ölçüm" description="Referans programının hunisi. Her aşama ve her rakam ilgili süzgece gider; değerler ölçümdür, tahmin değildir." bodyClassName="p-5">
        <section id="olcum" className="@container">
          {!m ? (
            <p role="status" className="py-6 text-center text-sm text-text-muted">
              {idle ? "Program kapalı ve etkin ödül kuralı yok: ölçülecek davet akışı henüz başlamadı." : "Motor etkin değil: ölçüm referans motoru açılınca hesaplanır."}
            </p>
          ) : (
            <div className="grid gap-6 @3xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <div className="rounded-[var(--radius-card)] p-4" style={{ boxShadow: "var(--elev-3)" }}>
                <h3 className="mb-2 text-sm font-bold text-ink-950">Referans hunisi</h3>
                <FunnelChart
                  stages={funnel}
                  ariaLabel="Referans hunisi: tıklama, kayıt, ödeyen, ödül"
                  emptyText="Henüz tıklama ya da kayıt yok"
                />
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <RadialGauge value={kf.k ?? 0} max={Math.max(1, kf.k ?? 0)} target={1} size={96} tone={kf.selfSustaining ? "success" : "brand"} ariaLabel="K-faktör">
                    <span className="text-lg font-bold tabular-nums text-ink-950">{formatDecimal(kf.k)}</span>
                  </RadialGauge>
                  <div className="min-w-0 text-sm">
                    <p className="font-bold text-ink-950">K-faktör</p>
                    <p className="tabular-nums text-text-muted">
                      <Link className="hover:underline" href={hrefFor({ kaynak: "referral" })}>
                        {formatDecimal(kf.invites)} davet/davetçi
                      </Link>{" "}
                      ×{" "}
                      <Link className="hover:underline" href={hrefFor({ kaynak: "odeyen" })}>
                        {formatPercent(kf.conversion)} dönüşüm
                      </Link>
                    </p>
                    <p className="text-xs text-text-faint">
                      {kf.selfSustaining ? "1 ve üstü: kendi kendini büyüten döngü." : "1 altı: büyüme tek başına döngüye girmedi."} Gerçek kayıtlardan ölçülür.
                    </p>
                  </div>
                </div>
                <ul className="divide-y divide-line text-sm">
                  <li>
                    <Link href={hrefFor({ kaynak: "odeyen" })} className="flex h-10 items-center justify-between gap-3 hover:bg-surface-hover">
                      <span className="text-text-muted">Deneme → ödeme dönüşümü</span>
                      <span className="font-semibold tabular-nums text-ink-950">{formatPercent(m.signupToPaid)}</span>
                    </Link>
                  </li>
                  <li>
                    <Link href={hrefFor({ kaynak: "referral" })} className="flex h-10 items-center justify-between gap-3 hover:bg-surface-hover">
                      <span className="text-text-muted">Davetçi başına ödeyen</span>
                      <span className="font-semibold tabular-nums text-ink-950">{formatDecimal(m.payersPerReferrer)}</span>
                    </Link>
                  </li>
                  <li>
                    <Link href={queueHref("paid")} className="flex h-10 items-center justify-between gap-3 hover:bg-surface-hover">
                      <span className="text-text-muted">Ödül maliyeti ({formatPercent(m.costRatio)} gelir payı)</span>
                      <span className="font-semibold tabular-nums text-[color:var(--viz-gold)]">{formatTry(m.rewardCostTry)}</span>
                    </Link>
                  </li>
                  <li>
                    <Link href={queueHref("paid")} className="flex h-10 items-center justify-between gap-3 hover:bg-surface-hover">
                      <span className="text-text-muted">CAC geri dönüşü (ilk ödeme {formatTry(m.firstPaymentRevenueTry)})</span>
                      <span className="font-semibold tabular-nums text-[color:var(--viz-gold)]">{m.paybackMultiple == null ? "-" : `${formatDecimal(m.paybackMultiple, 1)}x`}</span>
                    </Link>
                  </li>
                  <li>
                    <Link href={queueHref("flagged")} className="flex h-10 items-center justify-between gap-3 hover:bg-surface-hover">
                      <span className="text-text-muted">Kötüye kullanım oranı</span>
                      <span className={`font-semibold tabular-nums ${m.abuseRate != null && m.abuseRate > 0 ? "text-danger-500" : "text-ink-950"}`}>{formatPercent(m.abuseRate)}</span>
                    </Link>
                  </li>
                </ul>
              </div>
            </div>
          )}
        </section>
      </AdminPanel>

      {idle ? (
        <p role="status" className="text-sm text-text-muted">
          Ofis daveti ve ortak programı kapalı, etkin ödül kuralı yok: ofislere ödül vaadi gösterilmez. Aşağıdaki hazırlık kontrolü açılışı yönlendirir.
        </p>
      ) : null}

      <AdminPanel
        title="Aktivasyon"
        description="Varsayılan: ofis daveti açık, ortaklık ve nakit ödeme kapalıdır (ayar tablosundan değişir). Kapalıdan açığa geçişte engelleyici hazırlık maddesi varsa program açılmaz."
      >
        <ReadinessPanel readiness={ov.readiness} />
        <div className="border-t border-line p-5">
          {isSuper ? (
            <FlagsForm referral={ov.flags.referralEnabled} partner={ov.flags.partnerEnabled} cash={ov.flags.cashPayoutEnabled} />
          ) : (
            <p className="text-sm text-text-muted">
              Ofis daveti: {ov.flags.referralEnabled ? "açık" : "kapalı"} · Ortak programı: {ov.flags.partnerEnabled ? "açık" : "kapalı"} · Nakit ödeme:{" "}
              {ov.flags.cashPayoutEnabled ? "açık" : "kapalı"}. Değiştirmek için süper admin gerekir.
            </p>
          )}
        </div>
      </AdminPanel>

      <section id="kuyruk">
        <AdminPanel
          title="Talep kuyruğu (referans inceleme)"
          description="Her ödül/komisyon talebi burada izlenir. Bayraklı talepler (aynı vergi no, telefon, kurumsal e-posta alan adı, hız sınırı) ödül almaz; yalnız süper admin onaylayabilir. Onaylanan kredi bir sonraki işleyici çalışmasında yüklenir."
          actions={kuyruk ? <AdminFilterChip href="/admin/growth#kuyruk">Filtreyi kaldır</AdminFilterChip> : undefined}
        >
          <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
            {QUEUE_FILTERS.map((f) => {
              const count = f === "due" ? ov.dueNow : f === "flagged" ? null : (ov.statusCounts[f] ?? 0);
              return (
                <Link
                  key={f}
                  href={queueHref(f)}
                  aria-current={kuyruk === f ? "page" : undefined}
                  className={`focus-ring rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    kuyruk === f ? "border-brand-600 bg-brand-600/10 text-brand-700" : "border-hairline bg-surface text-text-muted hover:bg-canvas"
                  }`}
                >
                  {QUEUE_LABEL[f]}
                  {count != null ? ` (${count})` : ""}
                </Link>
              );
            })}
          </div>
          {!ov.engine || !ov.queue ? (
            <AdminEmpty icon={ShieldAlert} title="Motor etkin değil" description="Referans motoru migration'ı uygulanınca talepler burada listelenir." />
          ) : ov.queue.length === 0 ? (
            <AdminEmpty
              icon={Hourglass}
              title="Bu süzgece uyan talep yok"
              description={pending > 0 ? "İncelemede bekleyen talepler için 'İncelemede' süzgecini seçin." : "Talepler ilk gerçek ödemeden sonra otomatik oluşur."}
            />
          ) : (
            <AdminScrollArea minWidth={900}>
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-text-muted">
                  <tr>
                    <th className="px-5 py-2">Talep</th>
                    <th className="py-2 pr-3">Tür</th>
                    <th className="py-2 pr-3">Tutar</th>
                    <th className="py-2 pr-3">Durum</th>
                    <th className="py-2 pr-3">Bayrak / not</th>
                    <th className="py-2 pr-3">Vade</th>
                    <th className="py-2 pr-5">Karar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line align-middle">
                  {ov.queue.map((c) => (
                    <tr key={c.id} className="h-10">
                      <td className="px-5 py-1">
                        <p className="font-semibold text-ink-950">
                          {c.partner_name ? (
                            c.partner_name
                          ) : (
                            <Link className="text-brand-600 hover:underline" href={`/admin/tenants/${c.beneficiary_tenant_id}`}>
                              {c.beneficiary_name ?? "Davetçi"}
                            </Link>
                          )}
                        </p>
                        <p className="text-xs text-text-muted">
                          <Link className="hover:underline" href={`/admin/tenants/${c.referred_tenant_id}`}>
                            {c.referred_name ?? "Ofis"}
                          </Link>{" "}
                          · {formatDateTr(c.created_at)}
                        </p>
                      </td>
                      <td className="py-2 pr-3 text-text-muted">{CLAIM_COMPONENT_LABEL[c.component] ?? c.component}</td>
                      <td className="py-1 pr-3 font-semibold tabular-nums text-[color:var(--viz-gold)]">{formatTry(c.amount_try)}</td>
                      <td className="py-2 pr-3">
                        {CLAIM_STATUS_LABEL[c.status as ClaimStatus] ?? c.status}
                        {c.clawed_back_at ? <span className="block text-xs text-text-muted">kredi geri alındı</span> : null}
                      </td>
                      <td className="py-2 pr-3 text-xs text-text-muted">
                        {c.flags.length ? c.flags.map(flagLabel).join(", ") : "-"}
                        {c.note || c.reversal_reason ? <span className="block">{c.reversal_reason ?? c.note}</span> : null}
                      </td>
                      <td className="py-2 pr-3 text-xs text-text-muted">{c.eligible_at ? formatDateTr(c.eligible_at) : "-"}</td>
                      <td className="py-2 pr-5">{isSuper ? <ClaimActions id={c.id} status={c.status} flags={c.flags} /> : <span className="text-xs text-text-muted">Süper admin</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminScrollArea>
          )}
        </AdminPanel>
      </section>

      <AdminPanel
        title="Ödül kuralları"
        description="Ofislere yalnız aktif kuralın metni gösterilir. Kural yoksa ödül vaadi gösterilmez. Davet için önerilen tip: paket aylık bedelinin katı; bekleme süresi iade/iptal penceresini kapsamalıdır."
        bodyClassName="p-5 space-y-4"
      >
        {ov.rules.length === 0 ? (
          <p className="text-sm text-text-muted">Tanımlı kural yok.</p>
        ) : (
          <ul className="divide-y divide-line">
            {ov.rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <strong className="text-ink-950">{r.name}</strong>{" "}
                  <span className="text-text-muted">
                    ({r.kind === "referral" ? "ofis daveti" : "ortak"}) · {describeRewardRule(r) ?? "değer yok"}
                    {r.monthly_cap_try != null ? ` · aylık tavan ${r.monthly_cap_try} TL` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-text-muted">{r.is_active ? "Aktif" : "Kapalı"}</span>
                  {isSuper ? <RuleToggle id={r.id} active={r.is_active} /> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        {isSuper ? <RuleForm /> : null}
      </AdminPanel>

      <AdminPanel
        title="Program ayarları"
        description="Kademe, rozet, yıllık tavan, hız sınırı, hoş geldin kredisi ve ortak komisyon kademeleri. Değişiklikler denetim kaydına yazılır."
        bodyClassName="p-5"
      >
        {ov.settings ? (
          isSuper ? (
            <SettingsForm values={ov.settings as unknown as Record<string, string | number>} />
          ) : (
            <p className="text-sm text-text-muted">Ayarları görmek ve değiştirmek için süper admin gerekir.</p>
          )
        ) : (
          <p className="text-sm text-text-muted">Motor etkin değil: ayar satırı henüz yok.</p>
        )}
      </AdminPanel>

      <AdminPanel title="Ortaklar" description="Eğitmen, ajans, mali müşavir, içerik üreticisi, kurum. Bağlantı: /p/<kod>." bodyClassName="p-5 space-y-4">
        {ov.partners.length === 0 ? (
          <p className="text-sm text-text-muted">Henüz ortak tanımlı değil.</p>
        ) : (
          <div className="space-y-5">
            <AdminScrollArea minWidth={760}>
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-text-muted">
                  <tr>
                    <th className="py-2 pr-3">Ortak</th>
                    <th className="py-2 pr-3">Tür</th>
                    <th className="py-2 pr-3">Kod</th>
                    <th className="py-2 pr-3">Kayıt</th>
                    <th className="py-2 pr-3">Ödeyen</th>
                    <th className="py-2 pr-3">Bekleyen</th>
                    <th className="py-2 pr-3">Ödenebilir</th>
                    <th className="py-2 pr-3">Ödenen</th>
                    <th className="py-2">Durum</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ov.partners.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2 pr-3 font-semibold text-ink-950">{p.name}</td>
                      <td className="py-2 pr-3 text-text-muted">{PARTNER_TYPE_LABEL[p.type] ?? p.type}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{p.code}</td>
                      <td className="py-2 pr-3">
                        <Link className="font-semibold text-brand-600 hover:underline" href={hrefFor({ ortak: p.id })}>
                          {p.signups}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">
                        <Link className="font-semibold text-brand-600 hover:underline" href={hrefFor({ ortak: p.id, kaynak: "odeyen" })}>
                          {p.payers}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">
                        <Link className="text-brand-600 hover:underline" href={queueHref("held")}>
                          {formatTry(p.pendingTry)}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">
                        <Link className="text-brand-600 hover:underline" href={queueHref("approved")}>
                          {formatTry(p.payableTry)}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">
                        <Link className="text-brand-600 hover:underline" href={queueHref("paid")}>
                          {formatTry(p.paidTry)}
                        </Link>
                      </td>
                      <td className="py-2">{isSuper ? <PartnerStatus id={p.id} status={p.status} /> : p.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminScrollArea>
            {isSuper && ov.engine
              ? ov.partners.map((p) => (
                  <details key={p.id} className="rounded-[var(--radius-card)] border border-line p-3">
                    <summary className="cursor-pointer text-sm font-semibold text-ink-950">
                      {p.name}: vergi, bağlı ofis ve ödeme {p.isTaxPayer ? "· vergi mükellefi" : "· vergi bilgisi yok"}
                    </summary>
                    <div className="mt-3 space-y-4">
                      <PartnerDetailsForm partnerId={p.id} isTaxPayer={p.isTaxPayer} ownerTenantId={p.ownerTenantId} ruleId={p.ruleId} partnerRules={partnerRules} />
                      <PayoutForm partnerId={p.id} cashEnabled={ov.flags.cashPayoutEnabled} />
                    </div>
                  </details>
                ))
              : null}
          </div>
        )}
        {isSuper ? <PartnerForm /> : null}
        {ov.payouts.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-ink-950">Son ortak ödemeleri</h3>
            <AdminScrollArea minWidth={640}>
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-text-muted">
                  <tr>
                    <th className="py-2 pr-3">Ortak</th>
                    <th className="py-2 pr-3">Tutar</th>
                    <th className="py-2 pr-3">Yöntem</th>
                    <th className="py-2 pr-3">Belge no</th>
                    <th className="py-2 pr-3">Tarih</th>
                    <th className="py-2">Durum</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ov.payouts.map((po) => (
                    <tr key={po.id}>
                      <td className="py-2 pr-3 font-semibold text-ink-950">{po.partnerName}</td>
                      <td className="py-2 pr-3">{formatTry(po.amountTry)}</td>
                      <td className="py-2 pr-3 text-text-muted">{po.method === "account_credit" ? "Hesap kredisi" : "Dış ödeme (fatura karşılığı)"}</td>
                      <td className="py-2 pr-3 text-text-muted">{po.documentNo ?? "-"}</td>
                      <td className="py-2 pr-3 text-text-muted">{po.paidAt ? formatDateTr(po.paidAt) : formatDateTr(po.createdAt)}</td>
                      <td className="py-2">{po.status === "paid" ? "Ödendi" : po.status === "requested" ? "İşleyici bekliyor" : "İptal"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminScrollArea>
          </div>
        ) : null}
      </AdminPanel>

      <section id="kayitlar">
        <AdminPanel
          title="Kayıt kaynakları"
          description={ov.capped ? "Son 1000 atıflı kayıt üzerinden." : "Atıflı kayıtlar (ilk dokunuş)."}
          actions={
            kaynak || ortak ? (
              <AdminFilterChip href="/admin/growth#kayitlar">Filtreyi kaldır</AdminFilterChip>
            ) : undefined
          }
        >
          {shown.length === 0 ? (
            <AdminEmpty
              icon={Sprout}
              title={ov.available ? "Kayıt yok" : "Veri henüz yok"}
              description={
                ov.available
                  ? "Bu süzgece uyan atıflı kayıt bulunmuyor. Atıf, kayıt formuna gelen davet/ortak/UTM bilgisinden oluşur."
                  : "Tablolar uygulanınca kayıt kaynakları burada listelenir."
              }
            />
          ) : (
            <AdminScrollArea minWidth={640}>
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-text-muted">
                  <tr>
                    <th className="px-5 py-2">Ofis</th>
                    <th className="py-2 pr-3">Kaynak</th>
                    <th className="py-2 pr-3">UTM</th>
                    <th className="py-2 pr-3">Tarih</th>
                    <th className="py-2 pr-5">Durum</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map((r) => (
                    <tr key={r.tenantId}>
                      <td className="px-5 py-2">
                        <Link className="font-semibold text-brand-600 hover:underline" href={`/admin/tenants/${r.tenantId}`}>
                          {r.tenantName}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-text-muted">
                        {SOURCE_LABEL[r.refKind] ?? r.refKind}
                        {r.partnerName ? ` · ${r.partnerName}` : ""}
                      </td>
                      <td className="py-2 pr-3 text-text-muted">{[r.utmSource, r.utmCampaign].filter(Boolean).join(" / ") || "-"}</td>
                      <td className="py-2 pr-3 text-text-muted">{formatDateTr(r.at)}</td>
                      <td className="py-2 pr-5">{r.paying ? "Ödeyen" : "Deneme/diğer"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminScrollArea>
          )}
        </AdminPanel>
      </section>
    </div>
  );
}
