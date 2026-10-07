import Link from "@/components/ui/smart-link";
import { redirect } from "next/navigation";
import { AlertTriangle, BarChart3, CheckCircle2, Loader2, MessageSquare, Plus, Send } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { msSince } from "@/lib/clock";
import { listCampaigns } from "@/app/actions/campaigns";
import { ButtonLink } from "@/components/ui/button";
import { CampaignActions } from "./campaign-actions";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/ui/data-table";

import { DistributionCard, ListCharts, ListHero, ListPage } from "@/components/ui/list-page";
import { KpiStrip, type KpiItem } from "@/components/ui/list-kit";
/**
 * Durum/kanal → paylaşılan Badge varyantları.
 * Etiketler artık burada; ayrı STATUS_LABELS/CHANNEL_LABELS haritaları
 * kaldırıldı (aynı bilgiyi iki yerde tutmak kayma üretiyordu).
 * Eskiden yerel StatusBadge palet dışı zinc/blue/emerald/red sınıfları
 * kullanıyordu; artık tasarım sistemi tonları.
 */
const STATUS_BADGES: DataTableColumn["badges"] = {
  draft:     { label: "Taslak",        variant: "default" },
  scheduled: { label: "Zamanlandı",    variant: "info" },
  sending:   { label: "Gönderiliyor",  variant: "warning" },
  done:      { label: "Tamamlandı",    variant: "success" },
  failed:    { label: "Başarısız",     variant: "danger" },
};

const CHANNEL_BADGES: DataTableColumn["badges"] = {
  sms:      { label: "SMS",      variant: "info" },
  whatsapp: { label: "WhatsApp", variant: "success" },
  email:    { label: "E-posta",  variant: "default" },
};

const DURUM_FILTERS = [
  { label: "Tümü", value: "" },
  { label: "Taslak", value: "draft" },
  { label: "Zamanlandı", value: "scheduled" },
  { label: "Gönderiliyor", value: "sending" },
  { label: "Tamamlandı", value: "done" },
  { label: "Başarısız", value: "failed" },
] as const;

const KANAL_FILTERS = [
  { label: "Tüm kanallar", value: "" },
  { label: "SMS", value: "sms" },
  { label: "WhatsApp", value: "whatsapp" },
] as const;

function filterHref(durum: string, kanal: string) {
  const sp = new URLSearchParams();
  if (durum) sp.set("durum", durum);
  if (kanal) sp.set("kanal", kanal);
  const qs = sp.toString();
  return qs ? `/app/kampanyalar?${qs}` : "/app/kampanyalar";
}

function relativeDate(iso: string) {
  const d = Math.floor(msSince(iso) / 86_400_000);
  if (d <= 0) return "Bugün";
  if (d === 1) return "Dün";
  if (d < 30) return `${d} gün önce`;
  return new Date(iso).toLocaleDateString("tr-TR");
}

export default async function KampanyalarPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; kanal?: string; yeni?: string }>;
}) {
  const { perms } = await requireModulePage("campaigns", "/app/kampanyalar");
  const params = (await searchParams) ?? {};
  if (params.yeni) redirect("/app/kampanyalar/yeni");
  const durum = params.durum ?? "";
  const kanal = params.kanal ?? "";
  const campaigns = await listCampaigns();

  const canCreate = perms.campaigns?.includes("create") ?? false;
  const canSend = perms.campaigns?.includes("edit") ?? false;
  const canDelete = perms.campaigns?.includes("delete") ?? false;

  const filtered = campaigns.filter(
    (c) => (!durum || c.status === durum) && (!kanal || c.channel === kanal),
  );
  const hasFilter = Boolean(durum || kanal);

  const CAMPAIGN_COLUMNS: DataTableColumn[] = [
    { key: "title", header: "Kampanya", sortable: true },
    { key: "channel", header: "Kanal", format: "badge", badges: CHANNEL_BADGES, sortable: true },
    { key: "status", header: "Durum", format: "badge", badges: STATUS_BADGES, sortable: true },
    { key: "recipients", header: "Alıcı", align: "right", searchable: false },
    { key: "dateLabel", header: "Tarih", align: "right", searchable: false },
    // Detay bagi: alici bazinda teslimat sonucu ve HATA MESAJI hicbir yerde
    // gorunmuyordu; kullanici "12 hata" sayisini gorup neden oldugunu
    // ogrenemiyordu.
    { key: "_href", header: "", format: "link", linkLabel: "Detay" },
  ];

  const campaignRows: DataTableRow[] = filtered.map((c) => ({
    id:      c.id,
    title:   c.title,
    channel: c.channel,
    status:  c.status,
    // Alıcı metni koşullu (gönderim bitmişse "gönderilen/toplam", değilse
    // "N alıcı") — bildirimsel format bunu üretemez, sunucuda hesaplanıyor.
    recipients:
      c.status === "done" || c.status === "failed"
        ? `${c.sent_count ?? 0}/${c.total_count ?? 0}${(c.failed_count ?? 0) > 0 ? ` · ${c.failed_count} hata` : ""}`
        : `${c.total_count ?? 0} alıcı`,
    // Zamanlanmış kampanyada planlanan gönderim anı gösterilir (TR saati).
    dateLabel:
      c.status === "scheduled" && c.scheduled_at
        ? `Plan: ${new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(c.scheduled_at))}`
        : relativeDate(c.created_at),
    _href: `/app/kampanyalar/${c.id}`,
  }));

  const campaignActions: Record<string, React.ReactNode> = Object.fromEntries(
    filtered.map((c) => [
      c.id,
      <CampaignActions
        key={c.id}
        campaign={c}
        canSend={canSend}
        canDelete={canDelete}
      />,
    ]),
  );

  const total   = campaigns.length;
  const done    = campaigns.filter((c) => c.status === "done").length;
  const sending = campaigns.filter((c) => c.status === "sending").length;
  const failedCampaigns = campaigns.filter((c) => c.status === "failed").length;
  const totalSent   = campaigns.reduce((s, c) => s + (c.sent_count ?? 0), 0);
  const totalFailed = campaigns.reduce((s, c) => s + (c.failed_count ?? 0), 0);
  // Ulaşım oranı — yalnız sonuçlanmış gönderimler üzerinden (sent + failed)
  const deliveryDen  = totalSent + totalFailed;
  const deliveryRate = deliveryDen > 0 ? Math.round((totalSent / deliveryDen) * 100) : null;

  // Kanal dağılımı — kampanya adedi + gönderilen mesaj, kanal başına.
  // Segment renkleri viz token'ları (marka → yeşil → amber sırası; iki temada token çözer).
  const CHANNELS = [
    { value: "sms",      label: "SMS",      color: "var(--viz-1)" },
    { value: "whatsapp", label: "WhatsApp", color: "var(--viz-2)" },
    { value: "email",    label: "E-posta",  color: "var(--viz-5)" },
  ] as const;
  const channelStats = CHANNELS.map((ch) => {
    const list = campaigns.filter((c) => c.channel === ch.value);
    return {
      ...ch,
      count: list.length,
      sent: list.reduce((s, c) => s + (c.sent_count ?? 0), 0),
    };
  });

  const kpis: KpiItem[] = [
    { label: "Toplam kampanya", value: total, icon: <MessageSquare />, tone: "info", href: "/app/kampanyalar", hint: `${sending} gönderiliyor` },
    { label: "Gönderildi", value: done, icon: <CheckCircle2 />, tone: "success", href: "/app/kampanyalar?durum=done", hint: "tamamlanan" },
    { label: "Başarısız", value: failedCampaigns, icon: <AlertTriangle />, tone: "danger", attention: true, href: "/app/kampanyalar?durum=failed", hint: "inceleyin" },
    {
      label: "Gönderilen mesaj",
      value: totalSent,
      icon: <Send />,
      tone: "info",
      href: "/app/kampanyalar?durum=done",
      hint: deliveryRate === null ? "sonuçlanan gönderim yok" : `%${deliveryRate} ulaşım`,
    },
  ];

  return (
    <ListPage>
      <ListHero
        eyebrow="Mesajlaşma"
        art="kampanya"
        title="SMS & WhatsApp kampanyaları"
        description="Kampanyalar küçük partilerle işlenir; her teslimattan hemen önce sistemde kayıtlı kanal izni yeniden doğrulanır."
        actions={canCreate ? <ButtonLink href="/app/kampanyalar/yeni" icon={Plus}>Yeni kampanya</ButtonLink> : undefined}
      />

      <KpiStrip items={kpis} />

      {/* Kanal dağılımı + teslimat (yalnız gerçek veri; kampanya / sonuç yoksa kart çizilmez) */}
      <ListCharts>
        <DistributionCard
          title="Kanal dağılımı"
          subtitle="Kampanya sayısı · kanal başına"
          icon={BarChart3}
          href="/app/kampanyalar"
          centerLabel="kampanya"
          slices={channelStats.map((c) => ({
            label: `${c.label} · ${c.sent.toLocaleString("tr-TR")} mesaj`,
            value: c.count,
            color: c.color,
            href: filterHref("", c.value),
          }))}
        />
        <DistributionCard
          title="Teslimat performansı"
          subtitle={deliveryRate === null ? "Sonuçlanmış gönderim yok" : `%${deliveryRate} ulaşım oranı · sonuçlanan mesajlar`}
          icon={Send}
          tone="success"
          href="/app/kampanyalar?durum=done"
          centerLabel="mesaj"
          slices={[
            { label: "Ulaşan mesaj", value: totalSent, tone: "success", href: "/app/kampanyalar?durum=done" },
            { label: "Ulaşmayan mesaj", value: totalFailed, tone: "danger", href: "/app/kampanyalar?durum=failed" },
          ]}
        />
      </ListCharts>
      {/* Üst toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          {sending > 0 ? (
            <Link
              href="/app/kampanyalar?durum=sending"
              className="focus-ring inline-flex items-center gap-1.5 font-semibold text-amber-600 hover:underline"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {sending} kampanya şu an gönderiliyor…
            </Link>
          ) : hasFilter ? (
            `${filtered.length} / ${total} kampanya`
          ) : (
            `${total} kampanya`
          )}
        </p>
      </div>

      {/* Filtre çipleri — ?durum= & ?kanal= (linkler diğer parametreyi korur) */}
      {campaigns.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex flex-wrap gap-1.5">
            {DURUM_FILTERS.map((f) => (
              <Link
                key={`d-${f.value}`}
                href={filterHref(f.value, kanal)}
                className={`focus-ring rounded-[var(--radius-control)] px-2.5 py-1.5 text-xs font-semibold transition ${
                  durum === f.value ? "bg-ink-950 text-white" : "border border-line text-text-muted hover:text-ink-950"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <span aria-hidden className="hidden h-4 w-px bg-line sm:block" />
          <div className="flex flex-wrap gap-1.5">
            {KANAL_FILTERS.map((f) => (
              <Link
                key={`k-${f.value}`}
                href={filterHref(durum, f.value)}
                className={`focus-ring rounded-[var(--radius-control)] px-2.5 py-1.5 text-xs font-semibold transition ${
                  kanal === f.value ? "bg-brand-600 text-white" : "border border-line text-text-muted hover:text-ink-950"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {/* Liste */}
      {campaigns.length === 0 ? (
        <EmptyState illustration="bildirim"
          icon={MessageSquare}
          title="Henüz kampanya yok"
          description="İlk kampanyanızı oluşturun. Müşteri listenizdeki herkese SMS veya WhatsApp gönderin."
          tone="brand"
          action={canCreate ? { label: "Yeni kampanya", href: "/app/kampanyalar/yeni" } : undefined}
        />
      ) : filtered.length === 0 ? (
        <EmptyState illustration="bildirim"
          icon={MessageSquare}
          title="Bu filtreyle eşleşen kampanya yok"
          description="Filtre seçimini değiştirin veya temizleyin."
          action={{ label: "Filtreyi temizle", href: "/app/kampanyalar" }}
        />
      ) : (
        <DataTable
          columns={CAMPAIGN_COLUMNS}
          rows={campaignRows}
          rowActions={campaignActions}
          minWidth={640}
          mobileCards
          searchPlaceholder="Kampanya adı, kanal veya durum ara…"
          empty={{ description: "Arama terimini değiştirip tekrar deneyin." }}
        />
      )}

      {/* Bilgi kutusu */}
      <section className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-5 py-4 text-sm text-text-muted">
        <p className="font-semibold text-ink-950">Sağlayıcı ve İYS kapsamı</p>
        <p className="mt-1">
          SMS göndermek için{" "}
          <Link href="/app/ayarlar" className="font-medium text-brand-600 hover:underline">Ayarlar</Link>
          {" "}sayfasından Netgsm kullanıcı kodu, şifre ve gönderici başlığını tanımlayın.
          WhatsApp için API URL ve token gereklidir. Gönderim güvenliği, uygulamadaki yerel İYS izin kaydını
          fail-closed kontrol eder: açık izin yoksa mesaj çıkmaz. Resmî İYS dış sistem senkronu, kurum
          kimlik bilgileri bağlanana kadar otomatik değildir.
        </p>
      </section>
    </ListPage>
  );
}
