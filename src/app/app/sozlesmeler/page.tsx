import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  FileSignature,
  FileText,
  Plus,
  XCircle,
} from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { listContracts } from "@/app/actions/contracts";
import { NewContractDialog } from "./new-contract-dialog";

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

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft:     "bg-zinc-100 text-zinc-600 ring-zinc-500/10",
    sent:      "bg-blue-50 text-blue-700 ring-blue-600/20",
    signed:    "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    rejected:  "bg-red-50 text-red-700 ring-red-600/20",
    cancelled: "bg-zinc-50 text-zinc-500 ring-zinc-400/10",
  };
  const icons: Record<string, React.ReactNode> = {
    draft:     <Clock className="h-3 w-3" />,
    sent:      <FileSignature className="h-3 w-3" />,
    signed:    <CheckCircle2 className="h-3 w-3" />,
    rejected:  <XCircle className="h-3 w-3" />,
    cancelled: <XCircle className="h-3 w-3" />,
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
  const contracts = await listContracts();

  const canCreate = perms.contracts?.includes("create") ?? false;

  const total   = contracts.length;
  const signed  = contracts.filter((c) => c.status === "signed").length;
  const pending = contracts.filter((c) => c.status === "sent").length;

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
        {canCreate && <NewContractDialog />}
      </div>

      {/* Liste */}
      <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
        {contracts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 rounded-full bg-muted p-4">
              <FileText className="h-8 w-8 text-text-muted" />
            </div>
            <h3 className="text-lg font-semibold text-ink-950">Henüz sözleşme yok</h3>
            <p className="mt-1 max-w-sm text-sm text-text-muted">
              İlk sözleşme taslağınızı oluşturun, imzalayanları ekleyin ve dijital onay alın.
            </p>
            {canCreate && (
              <div className="mt-4">
                <NewContractDialog trigger="button" />
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="border-b border-line bg-canvas/80 text-text-muted">
                <tr>
                  <th className="px-5 py-3 font-semibold">Sözleşme</th>
                  <th className="px-4 py-3 font-semibold">Tür</th>
                  <th className="px-4 py-3 font-semibold">Durum</th>
                  <th className="px-4 py-3 font-semibold">Taraf</th>
                  <th className="px-4 py-3 font-semibold">Tarih</th>
                  <th className="px-4 py-3 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <tr key={c.id} className="group relative cursor-pointer border-b border-line last:border-0 hover:bg-brand-600/[0.03] transition">
                    <td className="px-5 py-3.5">
                      <Link href={`/app/sozlesmeler/${c.id}`} className="absolute inset-0" aria-label={`${c.title} sözleşmesini aç`} />
                      <p className="font-semibold text-ink-950 group-hover:text-brand-600">{c.title}</p>
                      {propertyTitle(c.property) && (
                        <p className="text-xs text-text-faint">{propertyTitle(c.property)}</p>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-text-muted">
                      {TYPE_LABELS[c.contract_type] ?? c.contract_type}
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3.5 text-text-muted">
                      {customerName(c.customer) ?? "—"}
                    </td>
                    <td className="px-4 py-3.5 text-text-muted">
                      {c.status === "signed" && c.signed_at
                        ? `İmzalandı: ${relativeDate(c.signed_at)}`
                        : relativeDate(c.created_at)}
                    </td>
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/app/sozlesmeler/${c.id}`}
                        className="inline-flex items-center gap-1.5 rounded-[8px] border border-line px-3 py-1.5 text-xs font-semibold text-brand-600 transition hover:bg-brand-600/5"
                      >
                        <FileText className="h-3.5 w-3.5" /> Aç
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Bilgi kutusu */}
      <section className="rounded-[16px] border border-dashed border-line-strong bg-surface px-5 py-4 text-sm text-text-muted">
        <p className="font-semibold text-ink-950">E-imza nasıl çalışır?</p>
        <p className="mt-1">
          Sözleşme taslağı oluşturun → imzalayan kişileri ekleyin → sistem benzersiz bir imza linki oluşturur →
          kişi linke tıklayıp onayladığında sözleşme "İmzalandı" durumuna geçer.
          Tüm imzalayanlar onayladığında sözleşme tamamlanır.
        </p>
      </section>
    </div>
  );
}
