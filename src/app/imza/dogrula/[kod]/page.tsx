import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock3, ShieldCheck, TriangleAlert } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { formatDateTimeTr } from "@/lib/format";
import { contractContentSha256, formatVerifyCode, normalizeVerifyCode } from "@/lib/contract-evidence";

// Doğrulama kodu kişiye özel bir belgeye işaret eder → arama motorlarına kapalı (/imza öneki zaten indekslenmez).
export const metadata: Metadata = {
  title: "İmza doğrulama",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = { sent: "İmza sürecinde", signed: "Tüm imzalar tamamlandı", rejected: "Reddedildi", cancelled: "İptal edildi", draft: "Taslak" };

function when(iso: string | null | undefined) {
  if (!iso) return "—";
  return formatDateTimeTr(iso, { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

type TenantRel = { name?: string | null; status?: string | null } | { name?: string | null; status?: string | null }[] | null;

/**
 * Herkese açık imza doğrulama (SP8): sözleşme sertifikasındaki kodla açılır. KİŞİSEL VERİ GÖSTERMEZ — yalnız ofis adı,
 * belge başlığı, durum, imza tarihleri ve içerik özetinin (SHA-256) kilitlenen özetle eşleşip eşleşmediği.
 * Elindeki belgenin özetini (sertifikadaki SHA-256) yapıştıran kişi eşleşmeyi de denetleyebilir (?ozet=).
 * Kaba kuvvet frenlemesi: IP başına dakikada 30 sorgu; kod 60 bit rastgeledir.
 */
export default async function ContractVerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ kod: string }>;
  searchParams: Promise<{ ozet?: string | string[] }>;
}) {
  const [{ kod }, sp] = await Promise.all([params, searchParams]);
  const code = normalizeVerifyCode(decodeURIComponent(kod));
  if (!code) notFound();

  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`imza-dogrula:${ip}`, { limit: 30, windowSec: 60, failurePolicy: "deny" });
  if (!allowed) {
    return (
      <Shell>
        <p className="text-sm text-text-muted">Çok fazla sorgu yapıldı. Lütfen bir dakika sonra yeniden deneyin.</p>
      </Shell>
    );
  }

  const admin = createAdminClient();
  const { data: contract, error } = await admin
    .from("contracts")
    .select("id, title, body, status, signed_at, body_sha256, evidence_locked_at, tenant:tenants(name, status)")
    .eq("verify_code", code)
    .maybeSingle();
  if (error || !contract) notFound();
  const tenantRaw = contract.tenant as TenantRel;
  const tenant = Array.isArray(tenantRaw) ? tenantRaw[0] : tenantRaw;
  if (!tenant || !isPublicTenantActive(tenant.status)) notFound();

  const [{ data: signerRows }, evidenceRes] = await Promise.all([
    admin.from("contract_signers").select("id, status, signed_at, verified_at").eq("contract_id", contract.id).order("created_at", { ascending: true }),
    admin.from("contract_signers").select("id, signed_body_sha256").eq("contract_id", contract.id),
  ]);
  const signers = (signerRows ?? []) as { id: string; status: string; signed_at: string | null; verified_at: string | null }[];
  const signedHashById = new Map<string, string | null>(
    evidenceRes.error ? [] : ((evidenceRes.data ?? []) as { id: string; signed_body_sha256: string | null }[]).map((r) => [r.id, r.signed_body_sha256]),
  );

  const lockedHash = (contract.body_sha256 as string | null) ?? null;
  const intact = lockedHash ? lockedHash === contractContentSha256(String(contract.title), String(contract.body ?? "")) : null;
  const providedRaw = Array.isArray(sp.ozet) ? sp.ozet[0] : sp.ozet;
  const provided = providedRaw ? providedRaw.trim().toLowerCase().replace(/[^0-9a-f]/g, "") : "";
  const providedValid = /^[0-9a-f]{64}$/.test(provided);

  return (
    <Shell office={tenant.name ?? undefined}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Doğrulama kodu</p>
        <p className="font-mono text-lg font-bold tracking-wider text-ink-950">{formatVerifyCode(code)}</p>
      </div>
      <dl className="grid gap-x-3 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-text-muted">Belge</dt>
        <dd className="font-semibold text-ink-950">{String(contract.title)}</dd>
        <dt className="text-text-muted">Durum</dt>
        <dd className="text-ink-950">{STATUS_LABELS[String(contract.status)] ?? String(contract.status)}</dd>
        {contract.signed_at ? (
          <>
            <dt className="text-text-muted">Tamamlanma</dt>
            <dd className="text-ink-950">{when(contract.signed_at as string)}</dd>
          </>
        ) : null}
        <dt className="text-text-muted">İçerik kilitlenme</dt>
        <dd className="text-ink-950">{when(contract.evidence_locked_at as string | null)}</dd>
        <dt className="text-text-muted">İçerik özeti (SHA-256)</dt>
        <dd className="break-all font-mono text-xs text-ink-950">{lockedHash ?? "—"}</dd>
      </dl>

      {intact != null ? (
        <p
          className={`flex items-center gap-2 rounded-[var(--radius-card)] px-3 py-2 text-sm font-semibold ${
            intact ? "bg-mint-500/[0.08] text-mint-700" : "bg-danger-500/[0.08] text-danger-600"
          }`}
        >
          {intact ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <TriangleAlert className="h-4 w-4" aria-hidden />}
          {intact ? "Kayıtlı metin, imzaya gönderilen metinle aynı." : "Kayıtlı metin kilitlenen özetle eşleşmiyor; ofisle iletişime geçin."}
        </p>
      ) : null}

      <section aria-labelledby="imzalar">
        <h2 id="imzalar" className="mb-2 text-sm font-bold text-ink-950">İmzalar</h2>
        <ul className="space-y-2">
          {signers.map((s, i) => {
            const signedHash = signedHashById.get(s.id) ?? null;
            return (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line px-3 py-2.5 text-sm">
                <span className="font-medium text-ink-950">İmzacı {i + 1}</span>
                {s.status === "signed" ? (
                  <span className="flex flex-wrap items-center justify-end gap-1.5 text-xs font-semibold text-mint-700">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {when(s.signed_at)}
                    {s.verified_at ? <span className="rounded-full bg-mint-500/12 px-2 py-0.5">SMS kodu doğrulandı</span> : null}
                    {signedHash && lockedHash ? (
                      <span className={signedHash === lockedHash ? "text-mint-700" : "text-danger-600"}>
                        {signedHash === lockedHash ? "· aynı metni imzaladı" : "· farklı metin"}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs text-text-muted">
                    <Clock3 className="h-3.5 w-3.5" aria-hidden /> {s.status === "rejected" ? "Reddetti" : "Bekliyor"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {lockedHash ? (
        <section aria-labelledby="ozet-karsilastir" className="space-y-2 rounded-[var(--radius-card)] border border-line bg-canvas p-3">
          <h2 id="ozet-karsilastir" className="text-sm font-bold text-ink-950">Elinizdeki belgeyi karşılaştırın</h2>
          <form method="get" className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="ozet" className="sr-only">Sertifikadaki içerik özeti (SHA-256)</label>
            <input
              id="ozet"
              name="ozet"
              defaultValue={providedRaw ?? ""}
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Sertifikadaki 64 karakterlik özeti yapıştırın"
              className="focus-ring min-h-11 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-3 font-mono text-xs"
            />
            <button type="submit" className="focus-ring press min-h-11 rounded-[var(--radius-control)] bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
              Karşılaştır
            </button>
          </form>
          {providedRaw ? (
            <p className={`text-sm font-semibold ${providedValid && provided === lockedHash ? "text-mint-700" : "text-danger-600"}`}>
              {!providedValid
                ? "Özet 64 karakterlik onaltılık (0-9, a-f) bir değer olmalı."
                : provided === lockedHash
                  ? "Eşleşiyor: elinizdeki belge imzalanan belgeyle aynı."
                  : "Eşleşmiyor: elinizdeki belge imzalanan belgeden farklı."}
            </p>
          ) : null}
        </section>
      ) : null}

      <p className="text-xs leading-relaxed text-text-faint">
        Bu sayfa kişisel veri göstermez. İmza, SMS ile tek kullanımlık kod doğrulamalı basit elektronik imzadır; nitelikli
        elektronik imza değildir.
      </p>
    </Shell>
  );
}

function Shell({ children, office }: { children: React.ReactNode; office?: string }) {
  return (
    <main id="main-content" className="min-h-screen bg-canvas px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-xl space-y-5 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-sm)] sm:p-7">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-brand-700">
          <ShieldCheck className="h-4 w-4" aria-hidden /> {office ? `${office} · ` : ""}İmza doğrulama
        </p>
        {children}
      </div>
    </main>
  );
}
