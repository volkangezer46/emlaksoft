import { FileSignature } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { getDefinitions } from "@/lib/definitions";
import { listContracts } from "@/app/actions/contracts";
import { NewContractDialog } from "./new-contract-dialog";
import { EmptyState } from "@/components/app/empty-state";
import {
  DataTable,
  ROW_HREF,
  type DataTableColumn,
  type DataTableRow,
} from "@/components/ui/data-table";

const TYPE_LABELS: Record<string, string> = {
  satis:     "Satış",
  kira:      "Kira",
  sozlesme:  "Sözleşme",
  teklif:    "Teklif",
  diger:     "Diğer",
};

const STATUS_LABELS: Record<string, string> = {
  draft:     "Taslak",
  sent:      "Gönderildi",
  signed:    "İmzalandı",
  rejected:  "Reddedildi",
  cancelled: "İptal",
};

/**
 * Durum → tasarım sistemi rozet tonu.
 * Eskiden yerel bir StatusBadge bileşeni palet dışı zinc/blue/emerald/red
 * sınıfları kullanıyordu; artık paylaşılan Badge varyantları.
 */
const STATUS_BADGES: DataTableColumn["badges"] = {
  draft:     { label: STATUS_LABELS.draft,     variant: "default" },
  sent:      { label: STATUS_LABELS.sent,      variant: "info" },
  signed:    { label: STATUS_LABELS.signed,    variant: "success" },
  rejected:  { label: STATUS_LABELS.rejected,  variant: "danger" },
  cancelled: { label: STATUS_LABELS.cancelled, variant: "outline" },
};

const TYPE_BADGES: DataTableColumn["badges"] = Object.fromEntries(
  Object.entries(TYPE_LABELS).map(([k, label]) => [k, { label, variant: "outline" as const }]),
);

const CONTRACT_COLUMNS: DataTableColumn[] = [
  { key: "title", header: "Sözleşme", sortable: true, subtitleKey: "propertyTitle" },
  { key: "contract_type", header: "Tür", format: "badge", badges: TYPE_BADGES, sortable: true },
  { key: "status", header: "Durum", format: "badge", badges: STATUS_BADGES, sortable: true },
  { key: "customer", header: "Taraf", sortable: true },
  { key: "dateLabel", header: "Tarih", searchable: false },
  { key: "open", header: "", format: "link", linkLabel: "Aç" },
];

function relativeDate(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return "Bugün";
  if (d === 1) return "Dün";
  if (d < 30) return `${d} gün önce`;
  return new Date(iso).toLocaleDateString("tr-TR");
}

function propertyTitle(p: { property_code: string; title: string | null } | { property_code: string; title: string | null }[] | null) {
  if (!p) return null;
  const item = Array.isArray(p) ? p[0] : p;
  return item ? (item.title ?? item.property_code) : null;
}

function customerName(c: { full_name: string } | { full_name: string }[] | null) {
  if (!c) return null;
  return Array.isArray(c) ? c[0]?.full_name : c.full_name;
}

export default async function SozlesmelerPage() {
  const { perms } = await requireModulePage("contracts");
  const [contracts, contractTypeDefs] = await Promise.all([
    listContracts(),
    getDefinitions("contract_type"),
  ]);

  const canCreate = perms.contracts?.includes("create") ?? false;
  const contractTypeOptions = contractTypeDefs.length
    ? contractTypeDefs.map((d) => ({ value: d.value, label: d.label }))
    : undefined;

  const total   = contracts.length;
  const signed  = contracts.filter((c) => c.status === "signed").length;
  const pending = contracts.filter((c) => c.status === "sent").length;

  // DataTable'a geçen düz (serileştirilebilir) satırlar
  const contractRows: DataTableRow[] = contracts.map((c) => ({
    id:            c.id,
    [ROW_HREF]:    `/app/sozlesmeler/${c.id}`,
    title:         c.title,
    propertyTitle: propertyTitle(c.property),
    contract_type: c.contract_type,
    status:        c.status,
    customer:      customerName(c.customer) ?? null,
    // Tarih metni sunucuda hesaplanıyor: "İmzalandı: 3 gün önce" gibi koşullu
    // ifadeyi bildirimsel format ile üretmek mümkün değil.
    dateLabel:
      c.status === "signed" && c.signed_at
        ? `İmzalandı: ${relativeDate(c.signed_at)}`
        : relativeDate(c.created_at),
  }));

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-14 h-52 w-52 rounded-full bg-brand-500/25 blur-[90px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
              <FileSignature className="h-4 w-4" /> Sözleşmeler
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">
              Sözleşme &amp; E-İmza
            </h1>
            <p className="mt-1 max-w-lg text-sm text-white/75">
              Kira, satış ve diğer sözleşme taslakları oluşturun. İmza linki ile dijital onay alın.
            </p>
          </div>
          <div className="flex gap-3">
            {[
              { label: "Toplam", value: total },
              { label: "İmzalandı", value: signed },
              { label: "İmza bekliyor", value: pending },
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
        <p className="text-sm text-text-muted">{total} sözleşme</p>
        {canCreate && <NewContractDialog contractTypes={contractTypeOptions} />}
      </div>

      {/* Liste */}
      {contracts.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title="Henüz sözleşme yok"
          description="İlk sözleşme taslağınızı oluşturun, imzalayanları ekleyin ve dijital onay alın."
          tone="brand"
          action={canCreate ? { label: "Yeni sözleşme", node: <NewContractDialog contractTypes={contractTypeOptions} /> } : undefined}
        />
      ) : (
        <DataTable
          columns={CONTRACT_COLUMNS}
          rows={contractRows}
          minWidth={700}
          searchPlaceholder="Sözleşme, portföy veya taraf ara…"
          empty={{ description: "Arama terimini değiştirip tekrar deneyin." }}
        />
      )}

      {/* Bilgi kutusu */}
      <section className="rounded-[16px] border border-dashed border-line-strong bg-surface px-5 py-4 text-sm text-text-muted">
        <p className="font-semibold text-ink-950">E-imza nasıl çalışır?</p>
        <p className="mt-1">
          Sözleşme taslağı oluşturun → imzalayan kişileri ekleyin → sistem benzersiz bir imza linki oluşturur →
          kişi linke tıklayıp onayladığında sözleşme “İmzalandı” durumuna geçer.
          Tüm imzalayanlar onayladığında sözleşme tamamlanır.
        </p>
      </section>
    </div>
  );
}
