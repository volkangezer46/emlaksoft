import Link from "next/link";
import { ArrowUpRight, Loader2, MessageSquare } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { listCampaigns } from "@/app/actions/campaigns";
import { NewCampaignDialog } from "./new-campaign-dialog";
import { CampaignActions } from "./campaign-actions";
import { EmptyState } from "@/components/app/empty-state";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/ui/data-table";

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
  { label: "E-posta", value: "email" },
] as const;

function filterHref(durum: string, kanal: string) {
  const sp = new URLSearchParams();
  if (durum) sp.set("durum", durum);
  if (kanal) sp.set("kanal", kanal);
  const qs = sp.toString();
  return qs ? `/app/kampanyalar?${qs}` : "/app/kampanyalar";
}

function relativeDate(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return "Bugün";
  if (d === 1) return "Dün";
  if (d < 30) return `${d} gün önce`;
  return new Date(iso).toLocaleDateString("tr-TR");
}

export default async function KampanyalarPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; kanal?: string }>;
}) {
  const { perms } = await requireModulePage("campaigns");
  const params = (await searchParams) ?? {};
  const durum = params.durum ?? "";
  const kanal = params.kanal ?? "";
  const campaigns = await listCampaigns();

  const canCreate = perms.campaigns?.includes("create") ?? false;

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
    dateLabel: relativeDate(c.created_at),
    _href: `/app/kampanyalar/${c.id}`,
  }));

  const campaignActions: Record<string, React.ReactNode> = Object.fromEntries(
    filtered.map((c) => [c.id, <CampaignActions key={c.id} campaign={c} canSend={canCreate} />]),
  );

  const total   = campaigns.length;
  const done    = campaigns.filter((c) => c.status === "done").length;
  const sending = campaigns.filter((c) => c.status === "sending").length;
  const totalSent = campaigns.reduce((s, c) => s + (c.sent_count ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-14 h-52 w-52 rounded-full bg-brand-500/25 blur-[90px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
              <MessageSquare className="h-4 w-4" /> Mesajlaşma
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">
              SMS &amp; WhatsApp Kampanyaları
            </h1>
            <p className="mt-1 max-w-lg text-sm text-white/75">
              Müşterilerinize toplu SMS veya WhatsApp mesajı gönderin. Netgsm entegrasyonu ile İYS uyumlu.
            </p>
          </div>
          <div className="flex gap-3">
            {[
              { label: "Toplam", value: total, href: "/app/kampanyalar" },
              { label: "Gönderildi", value: done, href: "/app/kampanyalar?durum=done" },
              { label: "Gönderilen mesaj", value: totalSent.toLocaleString("tr-TR"), href: "/app/kampanyalar?durum=done" },
            ].map((k) => (
              <Link
                key={k.label}
                href={k.href}
                className="focus-ring press group relative block rounded-[14px] border border-white/12 bg-white/8 p-3 text-center transition hover:border-white/30"
              >
                <ArrowUpRight className="hover-action absolute right-2 top-2 h-3.5 w-3.5 text-white/50 opacity-0 transition group-hover:opacity-100" />
                <p className="font-display text-2xl font-extrabold text-white">{k.value}</p>
                <p className="text-[11px] text-white/70">{k.label}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

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
        {canCreate && <NewCampaignDialog />}
      </div>

      {/* Filtre çipleri — ?durum= & ?kanal= (linkler diğer parametreyi korur) */}
      {campaigns.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex flex-wrap gap-1.5">
            {DURUM_FILTERS.map((f) => (
              <Link
                key={`d-${f.value}`}
                href={filterHref(f.value, kanal)}
                className={`focus-ring rounded-[9px] px-2.5 py-1.5 text-xs font-semibold transition ${
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
                className={`focus-ring rounded-[9px] px-2.5 py-1.5 text-xs font-semibold transition ${
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
        <EmptyState
          icon={MessageSquare}
          title="Henüz kampanya yok"
          description="İlk kampanyanızı oluşturun. Müşteri listenizdeki herkese SMS veya WhatsApp gönderin."
          tone="brand"
          action={canCreate ? { label: "Yeni kampanya", node: <NewCampaignDialog /> } : undefined}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
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
          searchPlaceholder="Kampanya adı, kanal veya durum ara…"
          empty={{ description: "Arama terimini değiştirip tekrar deneyin." }}
        />
      )}

      {/* Bilgi kutusu */}
      <section className="rounded-[16px] border border-dashed border-line-strong bg-surface px-5 py-4 text-sm text-text-muted">
        <p className="font-semibold text-ink-950">Netgsm &amp; WhatsApp API kurulumu</p>
        <p className="mt-1">
          SMS göndermek için{" "}
          <Link href="/app/ayarlar" className="font-medium text-brand-600 hover:underline">Ayarlar</Link>
          {" "}sayfasından Netgsm kullanıcı kodu, şifre ve gönderici başlığını tanımlayın.
          WhatsApp için API URL ve token gereklidir.
        </p>
      </section>
    </div>
  );
}
