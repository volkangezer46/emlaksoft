import Link from "next/link";
import { redirect } from "next/navigation";
import { Award, HeartHandshake, MousePointerClick, UserPlus, Wallet, Hourglass, CheckCircle2, Undo2, PiggyBank } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { getBaseUrl } from "@/lib/base-url";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FunnelChart } from "@/components/ui/viz";
import { Celebration } from "@/components/ui/illustrations";
import { isFirstInviteRewardMoment } from "@/lib/celebration-conditions";
import { inviteFunnel } from "@/lib/growth/funnel";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { getReferralOverview } from "@/lib/growth/store";
import {
  INVITE_FILTERS,
  INVITE_FILTER_LABEL,
  INVITE_STAGE_LABEL,
  buildPartnerUrl,
  buildShortInviteUrl,
  filterInvites,
  inviteFilterHref,
  parseInviteFilter,
  tierProgress,
  type InviteStage,
} from "@/lib/growth/program";
import { TRY_WALLET_LINKS } from "@/lib/try-credits/constants";
import { formatDateTr, formatTry } from "@/lib/format";
import { InvitePanel } from "./invite-panel";

export const metadata = { title: "Davet et ve kazan" };

const STAGE_BADGE: Record<InviteStage, BadgeVariant> = {
  trial: "neutral",
  waiting: "warning",
  paid: "success",
  cancelled: "danger",
};

const FUNNEL_LABEL = {
  click: "Bağlantı tıklaması",
  signup: "Kayıt olan",
  trial: "Deneme",
  paid: "Ödedi",
  reward: "Davet ödülü",
} as const;

const FUNNEL_HREF = {
  click: "#davet-baglantisi",
  signup: inviteFilterHref("tumu"),
  trial: inviteFilterHref("deneme"),
  paid: inviteFilterHref("bekliyor"),
  reward: inviteFilterHref("odedi"),
} as const;

function monthsText(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}

export default async function BuyumePage({ searchParams }: { searchParams: Promise<{ durum?: string }> }) {
  const { tenantId, perms, role } = await requireModulePage("settings", "/app/buyume");
  // R1: kazanc/davet verisi yalniz owner/gm (SQL tarafi growth_my_dashboard da ayni kapiyi uygular).
  if (role !== "owner" && role !== "gm") redirect("/app?yetki=yok");
  const sp = await searchParams;
  const durum = parseInviteFilter(sp.durum);

  if (!tenantId) return null;
  const ov = await getReferralOverview(tenantId);
  const base = getBaseUrl();
  const url = ov.code ? buildShortInviteUrl(base, ov.code) : null;
  const canEdit = effectiveHasPermission(perms, "settings", "edit");
  const d = ov.dashboard;

  const shown = d ? filterInvites(d.invites, durum) : [];
  const tiers = d ? tierProgress(d.paid, d.tiers) : null;
  const funnel = inviteFunnel(d ?? { clicks: 0, signups: 0, trial: 0, waiting: 0, paid: 0, cancelled: 0 });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Davet et ve kazan"
        description="Bir meslektaşınız EmlakSoft'u denemek isterse size özel bağlantıyı paylaşın. Meslektaşınız ilk ödemesini yaptığında ve bekleme süresi dolduğunda hesap krediniz yüklenir. Kredi nakde çevrilmez; yalnız EmlakSoft faturalarınızdan düşer."
        icon={<HeartHandshake className="h-6 w-6 text-accent-text" aria-hidden />}
      />

      {!ov.available || !ov.enabled ? (
        <Alert tone="info" title="Davet programı şu an etkin değil">
          Program henüz yayına alınmadı. Açıldığında davet bağlantınızı buradan oluşturup paylaşabilirsiniz.
        </Alert>
      ) : (
        <>
          {d ? (
            <div className="space-y-4">
              <Card className="shadow-[var(--elev-3)]">
                <CardHeader>
                  <CardTitle>Davet hunisi</CardTitle>
                  <CardDescription>
                    Bağlantı tıklamasından ödüle: her aşama kendi filtrelenmiş listesine gider.
                    {funnel.ardisik ? "" : " Doğrudan kayıtlar nedeniyle aşamalar arası dönüşüm oranı gösterilmez."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {isFirstInviteRewardMoment(d.paid) ? (
                    <div className="relative flex items-center gap-3 rounded-[var(--radius-control)] bg-success-soft px-4 py-2" role="status">
                      <Celebration tick label="İlk davet ödülü" />
                      <p className="text-sm font-semibold text-success-strong">İlk davet ödülünüz yüklendi.</p>
                    </div>
                  ) : null}
                  <FunnelChart
                    ariaLabel="Davet hunisi"
                    ardisik={funnel.ardisik}
                    emptyText="Henüz davet hareketi yok: bağlantınızı paylaşınca ilk tıklama burada görünür."
                    stages={funnel.stages.map((s) => ({ label: FUNNEL_LABEL[s.key], value: s.value, href: FUNNEL_HREF[s.key] }))}
                  />
                  <p className="text-xs text-text-muted">
                    <Link href={inviteFilterHref("iptal")} className="font-semibold text-accent-text hover:underline">
                      İptal / iade: {funnel.cancelled}
                    </Link>{" "}
                    (huniye dahil değildir; iptal olan davetin ödülü geri alınır).
                  </p>
                </CardContent>
              </Card>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Ödül yüklendi" value={d.paid} icon={CheckCircle2} tone="mint" href={inviteFilterHref("odedi")} />
                <StatCard label="İptal / iade" value={d.cancelled} icon={Undo2} tone="danger" href={inviteFilterHref("iptal")} />
                <StatCard label="Kazanılan kredi" value={d.money_visible ? formatTry(d.earned_try) : "Ofis sahibine açık"} icon={Wallet} tone="mint" href={TRY_WALLET_LINKS.wallet} />
                <StatCard label="Bekleyen kredi" value={d.money_visible ? formatTry(d.pending_try) : "Ofis sahibine açık"} icon={PiggyBank} tone="warning" href={inviteFilterHref("bekliyor")} />
              </div>
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Davet bağlantınız</CardTitle>
              <CardDescription>
                Kod rastgeledir; ofis adınızı veya kişisel bilginizi içermez. EmlakSoft sizin adınıza e-posta veya SMS göndermez: bağlantıyı siz paylaşırsınız.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InvitePanel url={url} canCreate={canEdit} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Nasıl kazanılır?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-text-muted">
              {ov.rewardText ? (
                <p>
                  Her başarılı davet için: {ov.rewardText}. Ödül, davet ettiğiniz ofis ilk gerçek ödemesini yaptıktan, <strong className="text-text">bir kez yenileyip</strong> aboneliği aktif kaldıktan ve
                  bekleme süresi dolduktan sonra yüklenir; deneme süresi veya kayıt tek başına ödül vermez. İade, iptal ya da ters ibrazda ödül geri alınır.{" "}
                  <Link href="/davet-kosullari" className="font-semibold text-accent-text hover:underline">Davet ve Ortaklık Programı Koşulları</Link>
                </p>
              ) : (
                <p>Şu an tanımlı bir ödül kuralı yok; bu sayfa yalnız davetlerinizi takip eder ve ödül vaat etmez.</p>
              )}
              {d && d.welcome_credit_try > 0 ? (
                <p>
                  Davet ettiğiniz ofis de kazanır: ilk ödemesinden sonra {formatTry(d.welcome_credit_try)} hoş geldin hesap kredisi, sonraki faturasından düşer (yalnız yeni müşteri ve ödeme yapan davetçi için).
                </p>
              ) : null}
              {d && d.tiers.annual_cap_months > 0 ? (
                <p>Bir yılda en çok {monthsText(d.tiers.annual_cap_months)} aylık paket bedeli kadar ödül kazanılabilir.</p>
              ) : null}
            </CardContent>
          </Card>

          {d && tiers && tiers.badges.length > 0 ? (
            <Card id="kademe">
              <CardHeader>
                <CardTitle>Elçi kademeleri</CardTitle>
                <CardDescription>
                  {tiers.current ? `Şu anki rozetiniz: ${tiers.current}.` : "Başarılı davetlerle rozet ve bonus kazanın."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="grid gap-3 sm:grid-cols-2">
                  {tiers.badges.map((b) => (
                    <li
                      key={b.key}
                      className={`rounded-[var(--radius-control)] px-3 py-2.5 text-sm ${b.unlocked ? "bg-success-soft" : "bg-[var(--surface-sunken)]"}`}
                    >
                      <p className="flex items-center gap-2 font-semibold text-text">
                        <Award className={`h-4 w-4 ${b.unlocked ? "text-success-strong" : "text-text-muted"}`} aria-hidden />
                        {b.label}
                        <Badge variant={b.unlocked ? "success" : "neutral"}>{b.unlocked ? "Kazanıldı" : "Kilitli"}</Badge>
                      </p>
                      <p className="mt-1 text-xs text-text-muted">
                        {b.at}. başarılı davette +{monthsText(b.bonusMonths)} aylık paket bedeli bonus.
                      </p>
                    </li>
                  ))}
                </ul>
                {tiers.next ? (
                  <div className="space-y-1.5">
                    <Progress value={tiers.pct} label={`${tiers.next.label} ilerlemesi`} />
                    <p className="text-xs text-text-muted">
                      {tiers.next.label} için {tiers.next.remaining} başarılı davet daha gerekiyor.{" "}
                      <Link className="font-semibold text-accent-text hover:underline" href={inviteFilterHref("odedi")}>
                        Başarılı davetlerim
                      </Link>
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-text-muted">Tüm kademeleri açtınız.</p>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card id="davetler">
            <CardHeader>
              <CardTitle>Davetleriniz</CardTitle>
              <CardDescription>Gizlilik gereği davet ettiğiniz ofislerin adı gösterilmez.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <nav aria-label="Davet filtresi" className="flex flex-wrap gap-2">
                {INVITE_FILTERS.map((f) => (
                  <Link
                    key={f}
                    href={inviteFilterHref(f)}
                    aria-current={durum === f ? "page" : undefined}
                    className={`focus-ring rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      durum === f ? "border-accent bg-surface-accent-soft text-accent-text" : "border-hairline bg-surface text-text-muted hover:bg-surface-hover"
                    }`}
                  >
                    {INVITE_FILTER_LABEL[f]}
                  </Link>
                ))}
              </nav>
              {!d ? (
                <p className="text-sm text-text-muted">Davet durumları motor etkinleştirildiğinde burada listelenir.</p>
              ) : shown.length === 0 ? (
                <EmptyState
                  variant="compact"
                  title={d.invites.length === 0 ? "Henüz bağlantınızla kayıt olan ofis yok" : "Bu filtreye uyan davet yok"}
                  description={
                    d.invites.length === 0
                      ? "Bağlantınızı bir meslektaşınıza WhatsApp ile gönderin; kayıt olduğunda burada görünür."
                      : "Filtreyi değiştirerek diğer davetlere bakın."
                  }
                />
              ) : (
                <ul className="divide-y divide-line">
                  {shown.map((i, idx) => (
                    <li key={`${i.at}-${idx}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="text-text">{shown.length - idx}. davet</span>
                      <span className="flex items-center gap-3">
                        {i.stage === "paid" && i.amount > 0 ? <span className="text-xs font-semibold text-success-strong">{formatTry(i.amount)}</span> : null}
                        <span className="text-xs text-text-muted">{formatDateTr(i.at)}</span>
                        <Badge variant={STAGE_BADGE[i.stage]}>{INVITE_STAGE_LABEL[i.stage]}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {ov.partner ? (
        <Card id="ortak">
          <CardHeader>
            <CardTitle>Ortak panosu: {ov.partner.name}</CardTitle>
            <CardDescription>
              Ortak bağlantınız: <code className="text-xs">{buildPartnerUrl(base, ov.partner.code)}</code>.{" "}
              {ov.partner.program_enabled
                ? "Komisyonlar ilk ödemeden itibaren yinelenen ödemeler için bekleme süresinden sonra onaylanır."
                : "Ortak programı şu an kapalı; komisyon oluşmaz."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Ortak bağlantı tıklaması" value={ov.partner.clicks} icon={MousePointerClick} href="#ortak-baglanti" />
              <StatCard label="Kayıt olan" value={ov.partner.signups} icon={UserPlus} href="#ortak-baglanti" />
              <StatCard label="Ödeyen müşteri" value={ov.partner.payers} icon={CheckCircle2} tone="mint" href="#ortak-komisyon" />
              <StatCard label="Kademe" value={`%${monthsText(ov.partner.tier_pct)}`} icon={Award} href="#ortak-komisyon" />
              <StatCard label="Bekleyen komisyon" value={formatTry(ov.partner.pending_try)} icon={Hourglass} tone="warning" href="#ortak-komisyon" />
              <StatCard label="Ödenebilir komisyon" value={formatTry(ov.partner.payable_try)} icon={PiggyBank} tone="mint" href="#ortak-komisyon" />
              <StatCard label="Ödenen komisyon" value={formatTry(ov.partner.paid_try)} icon={Wallet} tone="mint" href="#ortak-komisyon" />
              <StatCard label="Geri alınacak" value={formatTry(ov.partner.clawback_due_try)} icon={Undo2} tone="danger" href="#ortak-komisyon" />
            </div>
            <div id="ortak-baglanti" className="rounded-[var(--radius-control)] bg-[var(--surface-sunken)] px-3 py-2 text-sm">
              <p className="text-xs font-semibold text-text-muted">Ortak bağlantı</p>
              <code className="block overflow-x-auto text-sm text-text">{buildPartnerUrl(base, ov.partner.code)}</code>
            </div>
            <dl id="ortak-komisyon" className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-3 border-b border-line py-1">
                <dt className="text-text-muted">Bekleme süresindeki komisyon</dt>
                <dd className="font-semibold text-text">{formatTry(ov.partner.pending_try)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-line py-1">
                <dt className="text-text-muted">Ödenebilir (onaylı) komisyon</dt>
                <dd className="font-semibold text-text">{formatTry(ov.partner.payable_try)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-line py-1">
                <dt className="text-text-muted">Ödenen komisyon</dt>
                <dd className="font-semibold text-text">{formatTry(ov.partner.paid_try)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-line py-1">
                <dt className="text-text-muted">Sonraki ödemeden mahsup edilecek</dt>
                <dd className="font-semibold text-text">{formatTry(ov.partner.clawback_due_try)}</dd>
              </div>
            </dl>
            <p className="text-xs text-text-muted">
              {ov.partner.next_tier_at != null ? `${ov.partner.next_tier_at} aktif ücretli müşteriye ulaşınca bir üst kademeye geçersiniz. ` : "En üst kademedesiniz. "}
              Ödemeler yalnız vergi mükellefi ortağa, fatura karşılığı dış ödeme olarak ya da hesap kredisi şeklinde yapılır; minimum ödeme eşiği{" "}
              {formatTry(ov.partner.min_payout_try)}. {ov.partner.cash_enabled ? "" : "Nakit ödeme şu an kapalıdır."}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
