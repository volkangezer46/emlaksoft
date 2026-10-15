import { notFound } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { CheckCircle2, ShieldCheck, TriangleAlert } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PrintButton } from "@/components/ui/print-button";
import { getBaseUrl } from "@/lib/base-url";
import { contractContentSha256, formatVerifyCode, maskPhoneForCertificate, shortHash } from "@/lib/contract-evidence";

export const metadata = { title: "İmza tamamlama sertifikası" };

const STATUS_LABELS: Record<string, string> = { draft: "Taslak", sent: "İmzada", signed: "İmzalandı", rejected: "Reddedildi", cancelled: "İptal" };

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

type SignerRow = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  status: string;
  signed_at: string | null;
  verified_at: string | null;
  ip_address: string | null;
};
type SignerEvidence = {
  id: string;
  signed_body_sha256: string | null;
  signed_user_agent: string | null;
  signed_ip_hash: string | null;
  otp_channel: string | null;
};

/**
 * İmza tamamlama sertifikası (SP8) — ofis içi, yazdırılabilir. Sözleşme metni + içerik özeti (SHA-256) + imzacı başına
 * kanıt (OTP doğrulama, imza zamanı, IP ve özeti, tarayıcı, imzalanan metnin özeti) + herkese açık doğrulama kodu.
 * Ham IP ve tam ad yalnız bu ofis içi sayfada; herkese açık doğrulama sayfası kişisel veri göstermez.
 * SMS OTP basit elektronik imzadır; nitelikli elektronik imza değildir (metin bunu açıkça yazar).
 */
export default async function ContractCertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ tenantId }, { id }] = await Promise.all([requireModulePage("contracts", "/app/sozlesmeler"), params]);
  const supabase = await createClient();
  // İmzacı satırları RLS ile ofis kullanıcısına açık değildir (imza bağlantısı = taşıyıcı kimlik); bu sayfa yalnız
  // kanıt alanlarını okur (token/OTP alanları SEÇİLMEZ) ve sözleşmenin bu ofise ait olduğu RLS'li sorguyla doğrulanır.
  const admin = createAdminClient();

  const [contractRes, evidenceRes, tenantRes] = await Promise.all([
    supabase.from("contracts").select("id, title, body, status, signed_at, created_at, tenant_id").eq("id", id).maybeSingle(),
    supabase.from("contracts").select("body_sha256, verify_code, evidence_locked_at").eq("id", id).maybeSingle(),
    supabase.from("tenants").select("name").eq("id", tenantId ?? "").maybeSingle(),
  ]);
  const contract = contractRes.data as { id: string; title: string; body: string; status: string; signed_at: string | null; created_at: string; tenant_id: string } | null;
  if (!contract || (tenantId && contract.tenant_id !== tenantId)) notFound();

  const [signersRes, signerEvidenceRes] = await Promise.all([
    admin
      .from("contract_signers")
      .select("id, full_name, phone, email, status, signed_at, verified_at, ip_address")
      .eq("contract_id", contract.id)
      .order("created_at", { ascending: true }),
    admin
      .from("contract_signers")
      .select("id, signed_body_sha256, signed_user_agent, signed_ip_hash, otp_channel")
      .eq("contract_id", contract.id),
  ]);
  const signers = (signersRes.data ?? []) as SignerRow[];
  const signerEvidence = new Map<string, SignerEvidence>(
    signerEvidenceRes.error ? [] : ((signerEvidenceRes.data ?? []) as SignerEvidence[]).map((e) => [e.id, e]),
  );
  const evidence = evidenceRes.error
    ? null
    : (evidenceRes.data as { body_sha256: string | null; verify_code: string | null; evidence_locked_at: string | null } | null);

  const currentHash = contractContentSha256(contract.title, contract.body ?? "");
  const lockedHash = evidence?.body_sha256 ?? null;
  const intact = lockedHash ? lockedHash === currentHash : null;
  const verifyUrl = evidence?.verify_code ? `${getBaseUrl()}/imza/dogrula/${evidence.verify_code}` : null;

  return (
    <main id="main-content" className="mx-auto max-w-3xl space-y-5 p-4 py-6 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/app/sozlesmeler/${contract.id}?sekme=imza`} className="text-sm font-semibold text-brand-600 hover:underline">
          ← Sözleşmeye dön
        </Link>
        <PrintButton tone="brand" size="sm" />
      </div>

      <article className="space-y-6 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)] sm:p-6 print:border-0 print:shadow-none">
        <header className="border-b border-line pb-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{(tenantRes.data as { name?: string } | null)?.name ?? "Ofis"}</p>
          <h1 className="font-display text-xl font-extrabold text-ink-950">İmza tamamlama sertifikası</h1>
          <p className="mt-1 text-sm text-ink-950">{contract.title}</p>
          <p className="mt-0.5 text-xs text-text-muted">
            Durum: {STATUS_LABELS[contract.status] ?? contract.status} · Oluşturuldu: {when(contract.created_at)}
            {contract.signed_at ? ` · Tamamlandı: ${when(contract.signed_at)}` : ""}
          </p>
        </header>

        <section aria-labelledby="butunluk" className="space-y-2">
          <h2 id="butunluk" className="flex items-center gap-2 text-sm font-bold text-ink-950">
            <ShieldCheck className="h-4 w-4 text-brand-600" aria-hidden /> Belge bütünlüğü
          </h2>
          {lockedHash ? (
            <>
              <dl className="grid gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[11rem_1fr]">
                <dt className="text-text-muted">Kilitlenen içerik özeti</dt>
                <dd className="break-all font-mono text-xs text-ink-950">{lockedHash}</dd>
                <dt className="text-text-muted">Kilitlenme zamanı</dt>
                <dd className="text-ink-950">{when(evidence?.evidence_locked_at)}</dd>
                <dt className="text-text-muted">Şu anki metnin özeti</dt>
                <dd className="break-all font-mono text-xs text-ink-950">{currentHash}</dd>
              </dl>
              <p
                className={`flex items-center gap-2 rounded-[var(--radius-card)] px-3 py-2 text-sm font-semibold ${
                  intact ? "bg-mint-500/[0.08] text-mint-700" : "bg-danger-500/[0.08] text-danger-600"
                }`}
              >
                {intact ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <TriangleAlert className="h-4 w-4" aria-hidden />}
                {intact ? "Metin imzaya gönderildiğinden beri değişmedi." : "Metin kilitlenen özetle eşleşmiyor."}
              </p>
            </>
          ) : (
            <p className="text-sm text-text-muted">
              Bu sözleşmenin içerik özeti henüz kilitlenmedi (imzaya gönderimde ya da ilk imzada kilitlenir). Şu anki metnin özeti:{" "}
              <span className="break-all font-mono text-xs text-ink-950">{currentHash}</span>
            </p>
          )}
          {evidence?.verify_code && verifyUrl ? (
            <div className="rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2 text-sm">
              <p className="text-text-muted">Herkese açık doğrulama</p>
              <p className="font-mono text-base font-bold tracking-wider text-ink-950">{formatVerifyCode(evidence.verify_code)}</p>
              <p className="break-all text-xs text-brand-700">{verifyUrl}</p>
              <p className="mt-1 text-xs text-text-muted">Doğrulama sayfası kişisel veri göstermez: yalnız başlık, imza tarihleri ve özet eşleşmesi.</p>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="imzacilar" className="space-y-3">
          <h2 id="imzacilar" className="text-sm font-bold text-ink-950">İmzacılar ve kanıtlar</h2>
          {signers.length === 0 ? (
            <p className="text-sm text-text-muted">İmzacı eklenmemiş.</p>
          ) : (
            <ol className="space-y-3">
              {signers.map((s, i) => {
                const e = signerEvidence.get(s.id);
                const signedMatches = e?.signed_body_sha256 && lockedHash ? e.signed_body_sha256 === lockedHash : null;
                return (
                  <li key={s.id} className="break-inside-avoid rounded-[var(--radius-card)] border border-line p-3">
                    <p className="text-sm font-bold text-ink-950">
                      {i + 1}. {s.full_name}{" "}
                      <span className="font-medium text-text-muted">
                        · {s.status === "signed" ? "İmzaladı" : s.status === "rejected" ? "Reddetti" : "Bekliyor"}
                      </span>
                    </p>
                    <dl className="mt-2 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[10rem_1fr]">
                      <dt className="text-text-muted">Telefon</dt>
                      <dd className="text-ink-950">{maskPhoneForCertificate(s.phone) ?? "—"}</dd>
                      <dt className="text-text-muted">Kimlik doğrulama</dt>
                      <dd className="text-ink-950">
                        {s.verified_at ? `SMS tek kullanımlık kod · ${when(s.verified_at)}` : e?.otp_channel === "none" || s.status === "signed" ? "SMS doğrulaması yok (bağlantı ile)" : "—"}
                      </dd>
                      <dt className="text-text-muted">İmza zamanı</dt>
                      <dd className="text-ink-950">{when(s.signed_at)}</dd>
                      <dt className="text-text-muted">IP adresi</dt>
                      <dd className="font-mono text-ink-950">{s.ip_address ?? "—"}</dd>
                      <dt className="text-text-muted">IP özeti</dt>
                      <dd className="break-all font-mono text-ink-950">{e?.signed_ip_hash ? shortHash(e.signed_ip_hash) : "—"}</dd>
                      <dt className="text-text-muted">Tarayıcı</dt>
                      <dd className="break-words text-ink-950">{e?.signed_user_agent ?? "—"}</dd>
                      <dt className="text-text-muted">İmzalanan metnin özeti</dt>
                      <dd className="break-all font-mono text-ink-950">
                        {e?.signed_body_sha256 ? shortHash(e.signed_body_sha256) : "—"}
                        {signedMatches === true ? <span className="ml-1 font-sans font-semibold text-mint-700">· eşleşiyor</span> : null}
                        {signedMatches === false ? <span className="ml-1 font-sans font-semibold text-danger-600">· eşleşmiyor</span> : null}
                      </dd>
                    </dl>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section aria-labelledby="metin" className="space-y-2 print:break-before-page">
          <h2 id="metin" className="text-sm font-bold text-ink-950">Sözleşme metni</h2>
          <div className="whitespace-pre-wrap rounded-[var(--radius-card)] border border-line bg-canvas/60 p-4 text-sm leading-relaxed text-ink-950 print:border-0 print:bg-transparent print:p-0">
            {contract.body}
          </div>
        </section>

        <footer className="border-t border-line pt-3 text-xs leading-relaxed text-text-faint">
          Bu sertifika imza sürecinin teknik kayıtlarını özetler. İmza, SMS ile tek kullanımlık kod doğrulamalı basit elektronik
          imzadır; 5070 sayılı Kanun kapsamında nitelikli elektronik imza değildir. Hukuki değerlendirme için avukatınıza danışın.
        </footer>
      </article>
    </main>
  );
}
