import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock,
  FileSignature,
  FileText,
  User,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { ContractSignPanel } from "./contract-sign-panel";

const TYPE_LABELS: Record<string, string> = {
  satis:    "Satış",
  kira:     "Kira",
  sozlesme: "Sözleşme",
  teklif:   "Teklif",
  diger:    "Diğer",
};

const STATUS_STYLES: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
  draft:    { cls: "bg-zinc-100 text-zinc-600", icon: <Clock className="h-3.5 w-3.5" />, label: "Taslak" },
  sent:     { cls: "bg-blue-50 text-blue-700",  icon: <FileSignature className="h-3.5 w-3.5" />, label: "Gönderildi" },
  signed:   { cls: "bg-emerald-50 text-emerald-700", icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "İmzalandı" },
  rejected: { cls: "bg-red-50 text-red-700",    icon: <XCircle className="h-3.5 w-3.5" />, label: "Reddedildi" },
  cancelled:{ cls: "bg-zinc-50 text-zinc-500",  icon: <XCircle className="h-3.5 w-3.5" />, label: "İptal" },
};

function relDate(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeStyle: "short" }).format(new Date(iso));
}

function entityName(v: { full_name?: string; title?: string; property_code?: string } | { full_name?: string; title?: string; property_code?: string }[] | null) {
  if (!v) return null;
  const item = Array.isArray(v) ? v[0] : v;
  return item?.full_name ?? item?.title ?? item?.property_code ?? null;
}

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { perms } = await requireModulePage("contracts");
  const canEdit = perms.contracts?.includes("edit") ?? false;
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("contracts")
    .select("id, title, contract_type, body, status, signed_at, expires_at, created_at, updated_at, property:properties(id,property_code,title), customer:customers(id,full_name), signers:contract_signers(id,full_name,email,phone,status,signed_at)")
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();

  const contract = data;
  const statusInfo = STATUS_STYLES[contract.status] ?? STATUS_STYLES.draft;
  const signers = Array.isArray(contract.signers) ? contract.signers : [];
  const propertyName = entityName(contract.property as Parameters<typeof entityName>[0]);
  const customerName = entityName(contract.customer as Parameters<typeof entityName>[0]);

  return (
    <div className="space-y-6">
      {/* Geri */}
      <Link
        href="/app/sozlesmeler"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Sözleşmeler
      </Link>

      {/* Hero */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-300">
              <FileSignature className="h-3.5 w-3.5" />
              {TYPE_LABELS[contract.contract_type] ?? contract.contract_type}
            </p>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">{contract.title}</h1>
            <p className="mt-2 text-sm text-white/60">Oluşturuldu: {relDate(contract.created_at)}</p>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${statusInfo.cls}`}>
            {statusInfo.icon} {statusInfo.label}
          </span>
        </div>

        {/* Meta */}
        <div className="relative mt-5 flex flex-wrap gap-4">
          {customerName && (
            <div className="flex items-center gap-2 rounded-[12px] border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <User className="h-4 w-4 text-mint-400" />
              <span className="text-white/80">Müşteri:</span>
              <span className="font-semibold text-white">
                {Array.isArray(contract.customer)
                  ? <Link href={`/app/musteriler/${(contract.customer[0] as {id:string})?.id}`} className="hover:underline">{customerName}</Link>
                  : customerName}
              </span>
            </div>
          )}
          {propertyName && (
            <div className="flex items-center gap-2 rounded-[12px] border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <Building2 className="h-4 w-4 text-cyan-400" />
              <span className="text-white/80">Portföy:</span>
              <span className="font-semibold text-white">{propertyName}</span>
            </div>
          )}
          {contract.expires_at && (
            <div className="flex items-center gap-2 rounded-[12px] border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <Clock className="h-4 w-4 text-amber-400" />
              <span className="text-white/80">Son geçerlilik:</span>
              <span className="font-semibold text-white">
                {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(contract.expires_at))}
              </span>
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Sözleşme içeriği */}
        <section className="rounded-[20px] border border-line bg-surface p-6 shadow-[var(--shadow-xs)]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <FileText className="h-4 w-4 text-brand-600" /> İçerik
            </h2>
            {canEdit && contract.status === "draft" && (
              <Link
                href={`/app/sozlesmeler/${id}/duzenle`}
                className="rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-brand-600 transition hover:bg-brand-600/5"
              >
                Düzenle
              </Link>
            )}
          </div>
          <div className="mt-4 max-h-[60vh] overflow-y-auto">
            {contract.body ? (
              <div className="prose prose-sm max-w-none whitespace-pre-wrap rounded-[12px] border border-line bg-canvas/60 p-4 text-sm leading-relaxed text-ink-950">
                {contract.body}
              </div>
            ) : (
              <p className="rounded-[12px] border border-dashed border-line-strong p-6 text-center text-sm text-text-muted">
                İçerik girilmemiş.
              </p>
            )}
          </div>
        </section>

        {/* İmzalayanlar + gönderme paneli */}
        <div className="space-y-4">
          {/* İmzalayan listesi */}
          <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <FileSignature className="h-4 w-4 text-mint-600" /> İmzalayanlar
              <span className="ml-auto text-xs font-normal text-text-faint">{signers.length} kişi</span>
            </h2>

            {signers.length === 0 ? (
              <p className="mt-3 text-sm text-text-muted">
                Henüz imzalayan eklenmedi.
                {contract.status === "draft" && " Aşağıdan imzaya gönderin."}
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {signers.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 rounded-[12px] border border-line bg-canvas/50 px-3 py-2.5">
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${
                      s.status === "signed" ? "bg-mint-500" : s.status === "rejected" ? "bg-danger-500" : "bg-zinc-400"
                    }`}>
                      {(s.full_name as string).slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink-950">{s.full_name as string}</p>
                      <p className="text-[10px] text-text-faint">
                        {s.email as string | null ?? s.phone as string | null ?? "—"}
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      s.status === "signed" ? "bg-mint-500/12 text-mint-600" :
                      s.status === "rejected" ? "bg-danger-500/12 text-danger-500" :
                      "bg-zinc-100 text-zinc-500"
                    }`}>
                      {s.status === "signed" ? "İmzaladı" : s.status === "rejected" ? "Reddetti" : "Bekliyor"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Gönderme paneli — sadece taslak + yetki varsa */}
          {canEdit && (
            <ContractSignPanel contractId={id} status={contract.status} />
          )}

          {/* İmzalanma tarihi */}
          {contract.signed_at && (
            <div className="rounded-[14px] border border-mint-500/30 bg-mint-500/8 px-4 py-3 text-sm">
              <p className="flex items-center gap-2 font-semibold text-mint-700">
                <CheckCircle2 className="h-4 w-4" /> İmzalandı
              </p>
              <p className="mt-1 text-xs text-mint-700/70">{relDate(contract.signed_at)}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
