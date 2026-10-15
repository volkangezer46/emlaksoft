"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, FormTextarea } from "@/components/ui/form-controls";
import { StepUpCodeField } from "@/components/admin/step-up";
import { resetOfficeSecurityPolicyByAdmin } from "@/app/actions/admin-office-security";
import { ROLE_LABELS } from "@/lib/role-labels";
import { EXPORT_ROLE_IDS } from "@/lib/office-security/policy";

type PolicyView = {
  mfaRoles: string[];
  ipAllowlist: string;
  ipOwnerExempt: boolean;
  idleMinutes: number;
  maxHours: number;
  newDeviceAlert: boolean;
  exportRoles: string[];
};

/**
 * DG7 Ofis 360 > Yönetim: ofisin güvenlik politikası (salt okunur özet) + süper admin acil sıfırlama (sahip IP
 * listesiyle kilitlendiğinde). Politikayı ofis adına DÜZENLEMEZ; yalnız varsayılana döndürür (gerekçe + doğrulayıcı kodu).
 */
export function OfficeSecurityPanel({ tenantId, policy, active, canReset }: { tenantId: string; policy: PolicyView; active: boolean; canReset: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const ipCount = policy.ipAllowlist.split(/[\n,]+/).map((l) => l.split("#")[0].trim()).filter(Boolean).length;
  const rows: { label: string; value: string }[] = [
    { label: "2FA zorunlu roller", value: policy.mfaRoles.length ? policy.mfaRoles.map((r) => ROLE_LABELS[r] ?? r).join(", ") : "Yok" },
    { label: "İzinli IP kuralı", value: ipCount ? `${ipCount} kural${policy.ipOwnerExempt ? " (sahip muaf)" : " (sahip DAHİL)"}` : "Kısıt yok" },
    { label: "Boşta kalma", value: policy.idleMinutes ? `${policy.idleMinutes} dk` : "Kapalı" },
    { label: "En uzun oturum", value: policy.maxHours ? `${policy.maxHours} saat` : "Sınırsız" },
    { label: "Yeni cihaz bildirimi", value: policy.newDeviceAlert ? "Açık" : "Kapalı" },
    {
      label: "Dışa aktarma rolleri",
      value: policy.exportRoles.length >= EXPORT_ROLE_IDS.length ? "Tüm roller" : policy.exportRoles.map((r) => ROLE_LABELS[r] ?? r).join(", "),
    },
  ];

  return (
    <section className="dashboard-panel space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
        <div>
          <h2 className="font-display font-bold text-ink-950">Güvenlik politikası</h2>
          <p className="text-xs text-text-muted">
            Ofis sahibinin Ayarlar &gt; Güvenlik&apos;te belirlediği kurallar. {active ? "Politika etkin." : "Politika kapalı (varsayılan)."}
          </p>
        </div>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-3 rounded-[var(--radius-control)] border border-line px-3 py-2">
            <dt className="text-text-muted">{r.label}</dt>
            <dd className="font-semibold text-ink-950">{r.value}</dd>
          </div>
        ))}
      </dl>
      {canReset && active ? (
        <details className="rounded-[var(--radius-card)] border border-line px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink-900">Acil kurtarma: politikayı varsayılana döndür</summary>
          <form
            className="mt-3 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              fd.set("id", tenantId);
              startTransition(async () => {
                const res = await resetOfficeSecurityPolicyByAdmin(fd);
                setError(res.error ?? null);
                if (res.ok) {
                  setDone(true);
                  router.refresh();
                }
              });
            }}
          >
            <p className="text-xs text-text-muted">
              Sahip IP listesiyle kendini kilitlediğinde kullanın. 2FA zorunluluğu, IP listesi ve oturum süreleri kapanır; en geç 30 sn içinde etkin.
            </p>
            <FormField label="Gerekçe" htmlFor="sec-reset-reason" hint="En az 10 karakter; denetim izine yazılır.">
              <FormTextarea id="sec-reset-reason" name="reason" rows={2} required minLength={10} />
            </FormField>
            <StepUpCodeField id="sec-reset-step-up" />
            {error ? (
              <p role="alert" className="text-xs font-semibold text-danger-600">
                {error}
              </p>
            ) : null}
            <Button type="submit" variant="danger" loading={pending}>
              Politikayı sıfırla
            </Button>
          </form>
        </details>
      ) : null}
      {done ? <p className="text-xs font-semibold text-mint-600">Politika varsayılana döndürüldü.</p> : null}
    </section>
  );
}
