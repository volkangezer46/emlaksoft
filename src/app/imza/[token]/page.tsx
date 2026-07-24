import { notFound } from "next/navigation";
import { CheckCircle2, Clock3, FileText, ShieldCheck } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { SignPanel } from "./sign-panel";

export const metadata = {
  title: "Sözleşme imzası",
  robots: { index: false, follow: false },
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

type SignerRow = { id: string; full_name: string; status: string; signed_at: string | null };

export default async function PublicContractSignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: signer } = await admin
    .from("contract_signers")
    .select("id, full_name, status, contract_id")
    .eq("token", token)
    .maybeSingle();

  if (!signer) notFound();

  const { data: contract } = await admin
    .from("contracts")
    .select("id, title, contract_type, body, status, expires_at, created_at, tenant:tenants(name), signers:contract_signers(id, full_name, status, signed_at)")
    .eq("id", signer.contract_id)
    .maybeSingle();

  if (!contract) notFound();

  const tenant = contract.tenant as { name?: string } | { name?: string }[] | null;
  const office = (Array.isArray(tenant) ? tenant[0]?.name : tenant?.name) || "EmlakSoft";
  const signers = ((contract.signers ?? []) as SignerRow[]).slice().sort((a, b) => a.full_name.localeCompare(b.full_name, "tr"));
  const expired = contract.expires_at ? new Date(contract.expires_at).getTime() < Date.now() : false;
  const cancelled = contract.status === "cancelled";
  const alreadySigned = signer.status === "signed";

  return (
    <div className="min-h-screen bg-[image:var(--grad-ink)] px-4 py-10">
      <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-[22px] border border-white/15 bg-surface shadow-[var(--shadow-lg)]">
        {/* Başlık */}
        <div className="theme-dark bg-[image:var(--grad-ink)] px-6 py-6 text-white sm:px-8">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-400">
            <ShieldCheck className="h-3.5 w-3.5" /> {office}
          </p>
          <h1 className="mt-2 font-display text-2xl font-extrabold sm:text-3xl">{contract.title}</h1>
          <p className="mt-2 flex items-center gap-2 text-sm text-white/60">
            <FileText className="h-4 w-4" /> Elektronik imza · Sayın {signer.full_name}
          </p>
        </div>

        <div className="space-y-6 p-6 sm:p-8">
          {/* Sözleşme metni */}
          <section>
            <h2 className="mb-2 text-sm font-bold text-ink-950">Sözleşme metni</h2>
            <div className="max-h-80 overflow-y-auto rounded-[14px] border border-line bg-canvas px-5 py-4 text-sm leading-relaxed text-ink-800 whitespace-pre-wrap">
              {contract.body?.trim() ? contract.body : "Sözleşme metni eklenmemiş."}
            </div>
          </section>

          {/* İmzalayanlar durumu */}
          <section>
            <h2 className="mb-2 text-sm font-bold text-ink-950">İmzalayanlar</h2>
            <ul className="space-y-2">
              {signers.map((s) => (
                <li key={s.id} className="flex items-center justify-between rounded-[10px] border border-line bg-surface px-4 py-2.5 text-sm">
                  <span className="font-medium text-ink-950">
                    {s.full_name}
                    {s.id === signer.id ? <span className="ml-2 text-xs text-brand-600">(siz)</span> : null}
                  </span>
                  {s.status === "signed" ? (
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-mint-600">
                      <CheckCircle2 className="h-3.5 w-3.5" /> İmzaladı · {formatDate(s.signed_at)}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
                      <Clock3 className="h-3.5 w-3.5" /> Bekleniyor
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* İmza aksiyonu / durum mesajları */}
          {alreadySigned ? (
            <div className="rounded-[14px] border border-mint-500/30 bg-mint-500/10 px-5 py-6 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-mint-600" />
              <p className="mt-3 font-display text-lg font-bold text-ink-950">Bu sözleşmeyi zaten imzaladınız</p>
              <p className="mt-1 text-sm text-text-muted">Onayınız kayıtlıdır, tekrar işlem yapmanıza gerek yok.</p>
            </div>
          ) : cancelled ? (
            <p className="rounded-[12px] border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-600">
              Bu sözleşme iptal edilmiştir; imza alınamaz.
            </p>
          ) : expired ? (
            <p className="rounded-[12px] border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-600">
              Bu imza linkinin geçerlilik süresi dolmuştur. Lütfen ofisle iletişime geçin.
            </p>
          ) : (
            <SignPanel token={token} signerName={signer.full_name} />
          )}

          <p className="text-center text-[11px] text-text-faint">
            Bu sayfa {office} tarafından EmlakSoft üzerinden güvenli olarak sunulmaktadır.
          </p>
        </div>
      </div>
    </div>
  );
}
