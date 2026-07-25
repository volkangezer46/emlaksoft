import Link from "next/link";
import { MessageSquare, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { listCampaigns } from "@/app/actions/campaigns";
import { NewCampaignDialog } from "./new-campaign-dialog";
import { CampaignActions } from "./campaign-actions";
import { EmptyState } from "@/components/app/empty-state";

const STATUS_LABELS: Record<string, string> = {
  draft:     "Taslak",
  scheduled: "Zamanlandı",
  sending:   "Gönderiliyor",
  done:      "Tamamlandı",
  failed:    "Başarısız",
};

const CHANNEL_LABELS: Record<string, string> = {
  sms:       "SMS",
  whatsapp:  "WhatsApp",
};

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft:     "bg-zinc-100 text-zinc-600 ring-zinc-500/10",
    scheduled: "bg-blue-50 text-blue-700 ring-blue-600/20",
    sending:   "bg-amber-50 text-amber-700 ring-amber-600/20",
    done:      "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    failed:    "bg-red-50 text-red-700 ring-red-600/20",
  };
  const icons: Record<string, React.ReactNode> = {
    draft:     <Clock className="h-3 w-3" />,
    scheduled: <Clock className="h-3 w-3" />,
    sending:   <Loader2 className="h-3 w-3 animate-spin" />,
    done:      <CheckCircle2 className="h-3 w-3" />,
    failed:    <XCircle className="h-3 w-3" />,
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${styles[status] ?? styles.draft}`}>
      {icons[status]}
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function relativeDate(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return "Bugün";
  if (d === 1) return "Dün";
  if (d < 30) return `${d} gün önce`;
  return new Date(iso).toLocaleDateString("tr-TR");
}

export default async function KampanyalarPage() {
  const { perms } = await requireModulePage("campaigns");
  const campaigns = await listCampaigns();

  const canCreate = perms.campaigns?.includes("create") ?? false;

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
              { label: "Toplam", value: total },
              { label: "Gönderildi", value: done },
              { label: "Gönderilen mesaj", value: totalSent.toLocaleString("tr-TR") },
            ].map((k) => (
              <div key={k.label} className="rounded-[14px] border border-white/12 bg-white/8 p-3 text-center">
                <p className="font-display text-2xl font-extrabold text-white">{k.value}</p>
                <p className="text-[10px] text-white/70">{k.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Üst toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">
          {sending > 0 ? `${sending} kampanya şu an gönderiliyor…` : `${total} kampanya`}
        </p>
        {canCreate && <NewCampaignDialog />}
      </div>

      {/* Liste */}
      {campaigns.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="Henüz kampanya yok"
          description="İlk kampanyanızı oluşturun. Müşteri listenizdeki herkese SMS veya WhatsApp gönderin."
          tone="brand"
          action={canCreate ? { label: "Yeni kampanya", node: <NewCampaignDialog trigger="button" /> } : undefined}
        />
      ) : (
        <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-line bg-canvas/80 text-text-muted">
                <tr>
                  <th className="px-5 py-3 font-semibold">Kampanya</th>
                  <th className="px-4 py-3 font-semibold">Kanal</th>
                  <th className="px-4 py-3 font-semibold">Durum</th>
                  <th className="px-4 py-3 font-semibold">Alıcı</th>
                  <th className="px-4 py-3 font-semibold">Tarih</th>
                  <th className="px-4 py-3 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0 hover:bg-canvas/40 transition">
                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-ink-950">{c.title}</p>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${
                        c.channel === "whatsapp"
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                          : "bg-blue-50 text-blue-700 ring-blue-600/20"
                      }`}>
                        {CHANNEL_LABELS[c.channel] ?? c.channel}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3.5 text-text-muted">
                      {c.status === "done" || c.status === "failed" ? (
                        <span>
                          {c.sent_count ?? 0}/{c.total_count ?? 0}
                          {(c.failed_count ?? 0) > 0 && (
                            <span className="ml-1 text-red-500">({c.failed_count} hata)</span>
                          )}
                        </span>
                      ) : (
                        <span>{c.total_count ?? 0} alıcı</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-text-muted">
                      {relativeDate(c.created_at)}
                    </td>
                    <td className="px-4 py-3.5">
                      <CampaignActions campaign={c} canSend={canCreate} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
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
