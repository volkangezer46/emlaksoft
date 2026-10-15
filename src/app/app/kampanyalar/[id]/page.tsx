import Link from "@/components/ui/smart-link";
import { FilterChip } from "@/components/ui/filter-chip";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowUpRight, CalendarCheck, CheckCircle2, Clock3, Copy, MessageCircleReply, Pencil, UserMinus, Users } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { getCampaign, getCampaignReport, listCampaignRecipientsPage } from "@/app/actions/campaigns";
import { CAMPAIGN_ATTRIBUTION_DAYS, CAMPAIGN_RECIPIENT_PAGE_SIZE, parseCampaignRecipientDurum, ratePct } from "@/lib/campaign-report";
import { ListPager } from "@/components/ui/list-kit/list-pager";
import { pageWindow } from "@/components/ui/list-kit/list-logic";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatTurkishPhone, toTelHref } from "@/lib/phone";
import { toTrLocalInput } from "@/lib/clock";
import { CampaignSchedule } from "./campaign-schedule";

import { PageHeader } from "@/components/ui/page-header";
export const metadata = { title: "Kampanya detayı" };

const CHANNEL_LABELS: Record<string, string> = {
  sms: "SMS",
  email: "E-posta",
  whatsapp: "WhatsApp",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Taslak",
  scheduled: "Zamanlandı",
  sending: "Gönderiliyor",
  done: "Tamamlandı",
  failed: "Başarısız",
};

/*
 * `campaign_recipients.status` bir ENUM: recipient_status = pending | sent |
 * delivered | failed | opted_out.
 *
 * Ilk yazimda yalnizca uc deger vardi; `delivered` ve `opted_out` ham enum
 * degeri olarak ekrana dusuyordu. `opted_out` ozellikle onemli: IYS izni
 * olmadigi icin GONDERILMEDI demek — "ulasmadi" ile ayni sey degil ve
 * duzeltilecek bir sey de yok.
 */
const RECIPIENT_LABELS: Record<string, string> = {
  pending: "Bekliyor",
  sent: "Gönderildi",
  delivered: "Teslim edildi",
  failed: "Ulaşmadı",
  opted_out: "İzin yok (gönderilmedi)",
};

const RECIPIENT_VARIANT: Record<string, "success" | "warning" | "danger" | "default"> = {
  delivered: "success",
  sent: "success",
  pending: "warning",
  failed: "danger",
  // İzin yoksa bu bir hata değil, doğru davranış — kırmızı göstermek yanıltır.
  opted_out: "default",
};

/*
 * ?durum= kontratı (`src/lib/campaign-report.ts`): ham enum değerleri + "ulasan" (sent+delivered) + 7 gün atıf kümeleri
 * (yanit / randevu / ret). Süzme ve sayfalama SUNUCUDA (`campaign_recipient_page` RPC); satır sınırı yok.
 */
const RECIPIENT_FILTERS = [
  { label: "Tümü", value: "" },
  { label: "Ulaşan", value: "ulasan" },
  { label: "Bekleyen", value: "pending" },
  { label: "Ulaşmayan", value: "failed" },
  { label: "İzin yok", value: "opted_out" },
  { label: "Yanıt veren", value: "yanit" },
  { label: "Randevuya dönen", value: "randevu" },
  { label: "Ret eden", value: "ret" },
] as const;

function tarih(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

/**
 * Kampanya detayı — alıcı bazında teslimat sonucu.
 *
 * NEDEN VAR: `campaign_recipients` tablosu her alıcı için durum ve HATA
 * MESAJI tutuyordu ama hiçbir ekran bu satırları okumuyordu. Liste sayfası
 * yalnızca "12 hata" gibi bir sayı gösteriyordu; kullanıcı HANGİ numaraya
 * ulaşılamadığını ve NEDEN ulaşılamadığını öğrenemiyordu. Başarısız gönderimi
 * düzeltmenin bir yolu yoktu — numarayı düzeltip yeniden denemek için önce
 * hangi numara olduğunu bilmek gerekir.
 */
export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ durum?: string; sayfa?: string }>;
}) {
  const { perms } = await requireModulePage("campaigns", "/app/kampanyalar");
  const canEdit = (perms.campaigns ?? []).includes("edit");
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const durum = parseCampaignRecipientDurum(sp.durum);
  const page = Math.max(1, Number.parseInt(sp.sayfa ?? "", 10) || 1);

  const [campaign, report, recipientPage] = await Promise.all([
    getCampaign(id),
    getCampaignReport(id),
    listCampaignRecipientsPage(id, durum, page),
  ]);
  if (!campaign) notFound();

  const basePath = `/app/kampanyalar/${id}`;
  const durumHref = (value: string) => (value ? `${basePath}?durum=${value}` : basePath);
  const listParams: Record<string, string> = durum ? { durum } : {};

  /*
   * Sayılar `campaign_report` RPC'sinden: durum bazında GERÇEK satır sayısı (eskiden ilk 500 satırdan bellekte sayılıyordu).
   * "Ulaşan" = sent + delivered. `opted_out` ayrı: İYS izni olmadığı için gönderilmedi; bu bir başarısızlık değil.
   * RPC yoksa (migration bekliyor) kampanya satırındaki sayaçlara düşülür.
   */
  const toplam = report?.total ?? campaign.total_count ?? 0;
  const gonderilen = report ? report.sent + report.delivered : (campaign.sent_count ?? 0);
  const basarisiz = report?.failed ?? campaign.failed_count ?? 0;
  const bekleyen = report?.pending ?? 0;
  const izinsiz = report?.opted_out ?? 0;
  const recipients = recipientPage.rows;
  const pager = pageWindow(page, recipientPage.total, CAMPAIGN_RECIPIENT_PAGE_SIZE, recipients.length);

  // Kampanya satırındaki sayaç ile gerçek alıcı satırları ayrışabilir (toplu güncelleme kesintisi): sessizce geçilmez.
  const sayacSent = campaign.sent_count ?? 0;
  const sayacTutarsiz = Boolean(report) && toplam > 0 && sayacSent !== gonderilen;
  const hataGruplari = report?.errors ?? [];
  const ulasilanMusteri = report?.reached_customers ?? 0;
  const days = report?.window_days ?? CAMPAIGN_ATTRIBUTION_DAYS;
  const outcomes = report
    ? [
        { label: "Yanıt veren", value: report.replied, icon: MessageCircleReply, durum: "yanit" },
        { label: "Randevuya dönen", value: report.booked, icon: CalendarCheck, durum: "randevu" },
        { label: "Ret eden (izin geri çekti)", value: report.unsubscribed, icon: UserMinus, durum: "ret" },
      ]
    : [];

  return (
    <div className="space-y-6">
      <Link
        href="/app/kampanyalar"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Kampanyalara dön
      </Link>

      <PageHeader actions={<>{canEdit && campaign.status === "draft" ? <ButtonLink href={`/app/kampanyalar/${id}/duzenle`} variant="secondary" size="sm" icon={Pencil}>Taslağı düzenle</ButtonLink> : null}{(perms.campaigns ?? []).includes("create") ? <ButtonLink href={`/app/kampanyalar/yeni?kopya=${id}`} variant="secondary" size="sm" icon={Copy}>Çoğalt</ButtonLink> : null}</>} title={campaign.title} eyebrow={`${CHANNEL_LABELS[campaign.channel] ?? campaign.channel} kampanyası`} description={`${tarih(campaign.created_at)} tarihinde oluşturuldu${campaign.sent_at ? ` · ${tarih(campaign.sent_at)} tarihinde gönderildi` : ""}`} />
<section className="theme-dark relative overflow-hidden rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-6 text-white"><div className="relative">{/* KPI kartları alıcı tablosunu ?durum= parametresiyle süzer */}
          <div className="relative mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Toplam alıcı", value: toplam.toLocaleString("tr-TR"), icon: Users, durum: "" },
              { label: "Ulaşan", value: gonderilen.toLocaleString("tr-TR"), icon: CheckCircle2, durum: "ulasan" },
              { label: "Ulaşmayan", value: basarisiz.toLocaleString("tr-TR"), icon: AlertTriangle, durum: "failed" },
              {
                label: izinsiz > 0 ? "İzin yok" : "Bekleyen",
                value: (izinsiz > 0 ? izinsiz : bekleyen).toLocaleString("tr-TR"),
                icon: Clock3,
                durum: izinsiz > 0 ? "opted_out" : "pending",
              },
            ].map((k) => (
              <Link
                key={k.label}
                href={durumHref(k.durum)}
                className={`focus-ring press group relative block rounded-[var(--radius-card)] border bg-white/5 p-3 backdrop-blur transition hover:border-white/30 ${
                  durum === k.durum && k.durum !== "" ? "border-white/40" : "border-white/10"
                }`}
              >
                <ArrowUpRight className="hover-action absolute right-2 top-2 h-3.5 w-3.5 text-white/50 opacity-0 transition group-hover:opacity-100" />
                <k.icon className="h-4 w-4 text-mint-400" />
                <p className="numeric mt-2 font-display text-lg font-extrabold text-white">{k.value}</p>
                <p className="text-xs text-white/45 sm:text-xs">{k.label}</p>
              </Link>
            ))}
          </div></div></section>

      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={campaign.status === "done" ? "success" : campaign.status === "failed" ? "danger" : "info"}>
          {STATUS_LABELS[campaign.status] ?? campaign.status}
        </Badge>
        {campaign.status === "scheduled" && campaign.scheduled_at ? (
          <span className="text-xs font-semibold text-text-muted">Planlanan gönderim: {tarih(campaign.scheduled_at)}</span>
        ) : null}
        {sayacTutarsiz ? (
          <span className="text-xs text-amber-600" role="status">
            Kampanya sayacı {sayacSent} diyor, alıcı kayıtlarında {gonderilen} gönderim var. Gerçek satırlar
            gösteriliyor.
          </span>
        ) : null}
      </div>

      {/* Kampanya sonucu: gönderimden sonraki N gün içinde yanıt / randevu / ret (tahmini atıf, etiketli) */}
      {report && ulasilanMusteri > 0 ? (
        <section className="surface-card rounded-[var(--radius-panel)] p-5" aria-labelledby="kampanya-sonucu">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="kampanya-sonucu" className="font-display font-bold text-ink-950">Kampanya sonucu</h2>
            <p className="text-xs text-text-muted">
              Ulaşılan {ulasilanMusteri.toLocaleString("tr-TR")} müşterinin gönderimden sonraki {days} gün içindeki hareketi
            </p>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {outcomes.map((o) => {
              const rate = ratePct(o.value, ulasilanMusteri);
              return (
                <Link
                  key={o.durum}
                  href={durumHref(o.durum)}
                  className={`focus-ring press group flex items-center gap-3 rounded-[var(--radius-card)] border px-4 py-3 transition hover:border-brand-400 ${
                    durum === o.durum ? "border-brand-500 bg-brand-600/5" : "border-line bg-surface"
                  } ${o.value === 0 ? "opacity-70" : ""}`}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
                    <o.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="numeric block font-display text-lg font-extrabold text-ink-950">
                      {o.value.toLocaleString("tr-TR")}
                      {rate ? <span className="ml-1.5 text-xs font-semibold text-text-muted">{rate}</span> : null}
                    </span>
                    <span className="block text-xs text-text-muted">{o.label}</span>
                  </span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-text-faint transition group-hover:text-brand-600" />
                </Link>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-text-faint">
            Tahmini atıf: aynı müşteriden gelen mesaj ya da arama, açılan randevu ve kanal izninin geri çekilmesi {days} gün içinde sayılır.
          </p>
        </section>
      ) : null}

      {/* Teslimat işçisinin son hatası (campaigns.last_error): kampanya düzeyinde, alıcı hatalarından ayrı */}
      {campaign.last_error ? (
        <section className="rounded-[var(--radius-panel)] border border-danger-500/30 bg-danger-500/5 p-4" role="status">
          <h2 className="flex items-center gap-2 text-sm font-bold text-danger-600">
            <AlertTriangle className="h-4 w-4" /> Son gönderim hatası
          </h2>
          <p className="mt-1 text-sm text-ink-950">{campaign.last_error}</p>
          <p className="mt-1 text-xs text-text-muted">Sağlayıcı ayarlarını (SMS/WhatsApp entegrasyonu) kontrol edin; teslimat bir sonraki turda yeniden denenir.</p>
        </section>
      ) : null}

      {canEdit && (campaign.status === "draft" || campaign.status === "scheduled") ? (
        <CampaignSchedule
          campaignId={campaign.id}
          status={campaign.status}
          scheduledLocal={campaign.scheduled_at ? toTrLocalInput(campaign.scheduled_at) : ""}
          scheduledLabel={campaign.scheduled_at ? tarih(campaign.scheduled_at) : null}
        />
      ) : null}

      {/* Gönderilen mesajın kendisi — hangi metnin gittiği kaydın parçası */}
      <section className="surface-card rounded-[var(--radius-panel)] p-5">
        <h2 className="font-display font-bold text-ink-950">Gönderilen mesaj</h2>
        <p className="mt-2 whitespace-pre-line rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3 text-sm leading-relaxed text-ink-950">
          {campaign.message}
        </p>
        <p className="mt-2 text-xs text-text-faint">
          {"{ad}"}, {"{danisman}"} gibi alanlar her alıcıya kendi bilgisiyle doldurularak gönderilir.
        </p>
      </section>

      {/* Hata özeti — aynı hata çoğu zaman tüm başarısızlarda aynı */}
      {hataGruplari.length > 0 ? (
        <section className="rounded-[var(--radius-panel)] border border-danger-500/30 bg-danger-500/5 p-5">
          <h2 className="flex items-center gap-2 font-display font-bold text-danger-600">
            <AlertTriangle className="h-4 w-4" /> Neden ulaşmadı
          </h2>
          <ul className="mt-3 space-y-2">
            {hataGruplari.map(({ msg: mesaj, count: adet }) => (
                <li key={mesaj}>
                  <Link
                    href={durumHref("failed")}
                    className="focus-ring group flex flex-wrap items-start justify-between gap-3 rounded-[var(--radius-card)] border border-danger-500/20 bg-surface px-4 py-2.5 transition hover:border-danger-500/40"
                  >
                    <span className="min-w-0 text-sm text-ink-950">{mesaj}</span>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger-500/10 px-2.5 py-0.5 text-xs font-bold text-danger-600">
                      {adet.toLocaleString("tr-TR")} alıcı
                      <ArrowUpRight className="hover-action h-3 w-3 opacity-0 transition group-hover:opacity-100" />
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <section className="surface-card rounded-[var(--radius-panel)] p-4 sm:p-5" aria-labelledby="alicilar">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="alicilar" className="flex items-center gap-2 font-display font-bold text-ink-950">
            <Users className="h-4 w-4 text-brand-600" /> Alıcılar
          </h2>
          <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-semibold text-brand-600">
            {recipientPage.total.toLocaleString("tr-TR")} kayıt
            {durum && toplam > 0 ? ` · ${toplam.toLocaleString("tr-TR")} içinden` : ""}
          </span>
        </div>

        {/* Durum filtre çipleri — KPI kartlarıyla aynı ?durum= kontratı; mobilde yatay kaydırılır */}
        {toplam > 0 ? (
          <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
            {RECIPIENT_FILTERS.map((f) => (
              <FilterChip active={durum === f.value} key={f.value} href={durumHref(f.value)}>
                {f.label}
              </FilterChip>
            ))}
          </div>
        ) : null}

        {!recipientPage.available ? (
          <p className="mt-3 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-10 text-center text-sm text-text-muted">
            Alıcı listesi için veritabanı güncellemesi bekleniyor. Sayılar kampanya sayaçlarından gösteriliyor.
          </p>
        ) : toplam === 0 ? (
          <p className="mt-3 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-10 text-center text-sm text-text-muted">
            Bu kampanyaya alıcı eklenmemiş.
          </p>
        ) : recipients.length === 0 ? (
          <p className="mt-3 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-10 text-center text-sm text-text-muted">
            Bu durumda alıcı yok.{" "}
            <Link href={basePath} className="font-semibold text-brand-600 hover:underline">
              Filtreyi temizle
            </Link>
          </p>
        ) : (
          <>
            {/* Mobil: kart listesi (yatay kaydırma yok) */}
            <ul className="mt-3 divide-y divide-hairline overflow-hidden rounded-[var(--radius-card)] border border-line md:hidden">
              {recipients.map((r) => {
                const tel = toTelHref(r.phone);
                return (
                  <li key={r.id} className="flex items-start gap-3 px-3 py-3">
                    <div className="min-w-0 flex-1">
                      {r.customer_id ? (
                        <Link href={`/app/musteriler/${r.customer_id}`} className="focus-ring block truncate font-semibold text-ink-950">
                          {r.full_name ?? "İsimsiz"}
                        </Link>
                      ) : (
                        <span className="block truncate font-semibold text-ink-950">{r.full_name ?? "İsimsiz"}</span>
                      )}
                      <span className="numeric block text-xs text-text-muted">{formatTurkishPhone(r.phone)}</span>
                      {r.error_msg ? <span className="mt-0.5 block text-xs text-danger-600">{r.error_msg}</span> : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <Badge variant={RECIPIENT_VARIANT[r.status] ?? "default"}>{RECIPIENT_LABELS[r.status] ?? r.status}</Badge>
                      {tel ? (
                        <a href={tel} className="focus-ring inline-flex min-h-11 items-center text-xs font-semibold text-brand-600" aria-label={`${r.full_name ?? "Alıcıyı"} ara`}>
                          Ara
                        </a>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>

            <TableFrame className="mt-3 hidden md:block" minWidth={620}>
              <Table>
                <THead>
                  <TR>
                    <TH>Alıcı</TH>
                    <TH>Telefon</TH>
                    <TH>Durum</TH>
                    <TH>Hata</TH>
                    <TH>Gönderim</TH>
                  </TR>
                </THead>
                <TBody>
                  {recipients.map((r) => {
                    const tel = toTelHref(r.phone);
                    return (
                      <TR key={r.id}>
                        <TD className="font-semibold text-ink-950">
                          {r.customer_id ? (
                            <Link
                              href={`/app/musteriler/${r.customer_id}`}
                              className="focus-ring inline-flex items-center gap-1 hover:text-brand-600 hover:underline"
                            >
                              {r.full_name ?? "İsimsiz"} <ArrowUpRight className="h-3 w-3" />
                            </Link>
                          ) : (
                            (r.full_name ?? "İsimsiz")
                          )}
                        </TD>
                        <TD>
                          {tel ? (
                            <a href={tel} className="focus-ring numeric hover:text-brand-600 hover:underline">
                              {formatTurkishPhone(r.phone)}
                            </a>
                          ) : (
                            <span className="text-text-faint">—</span>
                          )}
                        </TD>
                        <TD>
                          <Badge variant={RECIPIENT_VARIANT[r.status] ?? "default"}>
                            {RECIPIENT_LABELS[r.status] ?? r.status}
                          </Badge>
                        </TD>
                        <TD className="text-text-muted">{r.error_msg ?? "—"}</TD>
                        <TD className="text-text-muted">{tarih(r.sent_at)}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableFrame>
            <div className="mt-3">
              <ListPager pathname={basePath} params={listParams} window={pager} total={recipientPage.total} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
