import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowUpRight, CheckCircle2, Clock3, MessageSquare, Users } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { getCampaign, listCampaignRecipients } from "@/app/actions/campaigns";
import { Badge } from "@/components/ui/badge";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatTurkishPhone, toTelHref } from "@/lib/phone";

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
 * ?durum= kontratı: ham enum değerleri + "ulasan" bileşimi.
 * "Ulaşan" KPI'ı sent+delivered toplamı olduğundan tek enum değerine
 * indirgenemez; bileşik değer bu sayfada tanımlı ve yalnızca burada üretilir.
 */
function matchesRecipientDurum(status: string, durum: string) {
  if (!durum) return true;
  if (durum === "ulasan") return status === "sent" || status === "delivered";
  return status === durum;
}

const RECIPIENT_FILTERS = [
  { label: "Tümü", value: "" },
  { label: "Ulaşan", value: "ulasan" },
  { label: "Bekleyen", value: "pending" },
  { label: "Ulaşmayan", value: "failed" },
  { label: "İzin yok", value: "opted_out" },
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
  searchParams?: Promise<{ durum?: string }>;
}) {
  await requireModulePage("campaigns");
  const { id } = await params;
  const { durum = "" } = (await searchParams) ?? {};

  const [campaign, recipients] = await Promise.all([getCampaign(id), listCampaignRecipients(id)]);
  if (!campaign) notFound();

  const basePath = `/app/kampanyalar/${id}`;
  const durumHref = (value: string) => (value ? `${basePath}?durum=${value}` : basePath);

  /*
   * "Ulasan" hem `sent` hem `delivered` demek. Ilk yazimda yalnizca `sent`
   * sayiliyordu; teslim onayi gelmis bir alici HICBIR sayacta gorunmuyordu ve
   * toplam tutmuyordu.
   *
   * `opted_out` ayri tutuluyor: IYS izni olmadigi icin gonderilmedi — bu bir
   * BASARISIZLIK DEGIL, dogru davranis. "Ulasmayan"a katmak, duzeltilecek bir
   * sorun varmis gibi gosterirdi.
   */
  const gonderilen = recipients.filter((r) => r.status === "sent" || r.status === "delivered").length;
  const basarisiz = recipients.filter((r) => r.status === "failed").length;
  const bekleyen = recipients.filter((r) => r.status === "pending").length;
  const izinsiz = recipients.filter((r) => r.status === "opted_out").length;

  // KPI kartlarından ve hata özetinden URL parametresiyle daraltılan görünüm.
  const visibleRecipients = durum
    ? recipients.filter((r) => matchesRecipientDurum(r.status, durum))
    : recipients;

  /*
   * Kampanya satırındaki sayaçlar ile gerçek alıcı satırları ayrışabilir:
   * toplu güncelleme sırasında kesinti olursa sayaç yazılmadan kalır. Sayfada
   * GERÇEK satır sayısı gösteriliyor; fark varsa sessizce geçmiyoruz.
   */
  const sayacSent = campaign.sent_count ?? 0;
  const sayacTutarsiz = recipients.length > 0 && sayacSent !== gonderilen;

  // Aynı hata metni çoğu zaman tüm başarısızlarda aynı (sağlayıcı hatası).
  // Tek tek okutmak yerine grupluyoruz.
  const hataGruplari = new Map<string, number>();
  for (const r of recipients) {
    if (r.status !== "failed") continue;
    const key = r.error_msg?.trim() || "Neden belirtilmedi";
    hataGruplari.set(key, (hataGruplari.get(key) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <Link
        href="/app/kampanyalar"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Kampanyalara dön
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-brand-600/30 blur-[80px]" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
            <MessageSquare className="h-3.5 w-3.5" /> {CHANNEL_LABELS[campaign.channel] ?? campaign.channel} kampanyası
          </span>
          <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">{campaign.title}</h1>
          <p className="mt-1 text-sm text-white/60">
            {tarih(campaign.created_at)} tarihinde oluşturuldu
            {campaign.sent_at ? ` · ${tarih(campaign.sent_at)} tarihinde gönderildi` : ""}
          </p>

          {/* KPI kartları alıcı tablosunu ?durum= parametresiyle süzer */}
          <div className="relative mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Toplam alıcı", value: String(recipients.length), icon: Users, durum: "" },
              { label: "Ulaşan", value: String(gonderilen), icon: CheckCircle2, durum: "ulasan" },
              { label: "Ulaşmayan", value: String(basarisiz), icon: AlertTriangle, durum: "failed" },
              {
                label: izinsiz > 0 ? "İzin yok" : "Bekleyen",
                value: String(izinsiz > 0 ? izinsiz : bekleyen),
                icon: Clock3,
                durum: izinsiz > 0 ? "opted_out" : "pending",
              },
            ].map((k) => (
              <Link
                key={k.label}
                href={durumHref(k.durum)}
                className={`focus-ring press group relative block rounded-[14px] border bg-white/5 p-3 backdrop-blur transition hover:border-white/30 ${
                  durum === k.durum && k.durum !== "" ? "border-white/40" : "border-white/10"
                }`}
              >
                <ArrowUpRight className="hover-action absolute right-2 top-2 h-3.5 w-3.5 text-white/50 opacity-0 transition group-hover:opacity-100" />
                <k.icon className="h-4 w-4 text-mint-400" />
                <p className="numeric mt-2 font-display text-lg font-extrabold text-white">{k.value}</p>
                <p className="text-[11px] text-white/45 sm:text-xs">{k.label}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={campaign.status === "done" ? "success" : campaign.status === "failed" ? "danger" : "info"}>
          {STATUS_LABELS[campaign.status] ?? campaign.status}
        </Badge>
        {sayacTutarsiz ? (
          <span className="text-xs text-amber-600" role="status">
            Kampanya sayacı {sayacSent} diyor, alıcı kayıtlarında {gonderilen} gönderim var. Gerçek satırlar
            gösteriliyor.
          </span>
        ) : null}
      </div>

      {/* Gönderilen mesajın kendisi — hangi metnin gittiği kaydın parçası */}
      <section className="surface-card rounded-[var(--radius-panel)] p-5">
        <h2 className="font-display font-bold text-ink-950">Gönderilen mesaj</h2>
        <p className="mt-2 whitespace-pre-line rounded-[12px] border border-line bg-canvas px-4 py-3 text-sm leading-relaxed text-ink-950">
          {campaign.message}
        </p>
      </section>

      {/* Hata özeti — aynı hata çoğu zaman tüm başarısızlarda aynı */}
      {hataGruplari.size > 0 ? (
        <section className="rounded-[var(--radius-panel)] border border-danger-500/30 bg-danger-500/5 p-5">
          <h2 className="flex items-center gap-2 font-display font-bold text-danger-600">
            <AlertTriangle className="h-4 w-4" /> Neden ulaşmadı
          </h2>
          <ul className="mt-3 space-y-2">
            {[...hataGruplari.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([mesaj, adet]) => (
                <li key={mesaj}>
                  <Link
                    href={durumHref("failed")}
                    className="focus-ring group flex flex-wrap items-start justify-between gap-3 rounded-[12px] border border-danger-500/20 bg-surface px-4 py-2.5 transition hover:border-danger-500/40"
                  >
                    <span className="min-w-0 text-sm text-ink-950">{mesaj}</span>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger-500/10 px-2.5 py-0.5 text-xs font-bold text-danger-600">
                      {adet} alıcı
                      <ArrowUpRight className="hover-action h-3 w-3 opacity-0 transition group-hover:opacity-100" />
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <section className="surface-card rounded-[var(--radius-panel)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <Users className="h-4 w-4 text-brand-600" /> Alıcılar
          </h2>
          <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-semibold text-brand-600">
            {visibleRecipients.length} kayıt
            {visibleRecipients.length !== recipients.length ? ` · ${recipients.length} içinden` : ""}
          </span>
        </div>

        {/* Durum filtre çipleri — KPI kartlarıyla aynı ?durum= kontratı */}
        {recipients.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {RECIPIENT_FILTERS.map((f) => (
              <Link
                key={f.value}
                href={durumHref(f.value)}
                className={`focus-ring rounded-[9px] px-2.5 py-1.5 text-xs font-semibold transition ${
                  durum === f.value ? "bg-ink-950 text-white" : "border border-line text-text-muted hover:text-ink-950"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
        ) : null}

        {recipients.length === 0 ? (
          <p className="mt-3 rounded-[12px] border border-dashed border-line-strong px-4 py-10 text-center text-sm text-text-muted">
            Bu kampanyaya alıcı eklenmemiş.
          </p>
        ) : visibleRecipients.length === 0 ? (
          <p className="mt-3 rounded-[12px] border border-dashed border-line-strong px-4 py-10 text-center text-sm text-text-muted">
            Bu durumda alıcı yok.{" "}
            <Link href={basePath} className="font-semibold text-brand-600 hover:underline">
              Filtreyi temizle
            </Link>
          </p>
        ) : (
          <>
            <TableFrame className="mt-3" minWidth={620}>
              <Table>
                <THead>
                  <TR>
                    <TH>Alıcı</TH>
                    <TH>Telefon</TH>
                    <TH>Durum</TH>
                    <TH className="hidden md:table-cell">Hata</TH>
                    <TH className="hidden md:table-cell">Gönderim</TH>
                  </TR>
                </THead>
                <TBody>
                  {visibleRecipients.map((r) => {
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
                        <TD className="hidden text-text-muted md:table-cell">{r.error_msg ?? "—"}</TD>
                        <TD className="hidden text-text-muted md:table-cell">{tarih(r.sent_at)}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableFrame>
            {recipients.length >= 500 ? (
              <p className="mt-2 text-[11px] text-text-faint">
                İlk 500 alıcı gösteriliyor. Daha fazlası varsa listede yer almıyor.
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
