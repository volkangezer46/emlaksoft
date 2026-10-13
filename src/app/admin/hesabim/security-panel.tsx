"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Plus, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TotpCodeForm, TotpEnrollmentView, TotpError, useTotp, type TotpEnrollment } from "@/app/giris/mfa/totp-core";

export type OwnFactor = { id: string; name: string; createdAt: string };

const dateFmt = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium" });

/**
 * Hesabım > Güvenlik: kendi TOTP doğrulayıcısını kurma, oturumu doğrulama (AAL2) ve yedek doğrulayıcı ekleme.
 * Supabase kurtarma kodu sunmadığı için telefon kaybına karşı ikinci bir authenticator (yedek) önerilir.
 * Doğrulanmış doğrulayıcısı olan hesapta yeni faktör eklemek AAL2 oturum ister; önce mevcut doğrulayıcıyla doğrulanır.
 */
export function SecurityPanel({
  factors,
  sessionAal2,
  mfaRequiredText,
}: {
  factors: OwnFactor[];
  sessionAal2: boolean;
  mfaRequiredText: string;
}) {
  const router = useRouter();
  const totp = useTotp();
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const hasFactor = factors.length > 0;

  async function startEnroll() {
    setDone(null);
    // Ad kullanıcıda benzersiz olmalı: ilk kurulum "EmlakSoft Platform", sonrakiler sıra numaralı yedek.
    const name = hasFactor ? `EmlakSoft Yedek ${factors.length + 1}` : "EmlakSoft Platform";
    const started = await totp.enroll(name);
    if (started) setEnrollment(started);
  }

  async function confirmEnroll(code: string) {
    if (!enrollment) return false;
    const ok = await totp.verify(enrollment.factorId, code);
    if (ok) {
      setEnrollment(null);
      setDone(hasFactor ? "Yedek doğrulayıcı eklendi." : "Doğrulayıcı kuruldu; oturumunuz iki adımlı doğrulandı.");
      router.refresh();
    }
    return ok;
  }

  async function elevate(code: string) {
    const first = factors[0];
    if (!first) return false;
    const ok = await totp.verify(first.id, code);
    if (ok) {
      setDone("Oturum doğrulandı.");
      router.refresh();
    }
    return ok;
  }

  return (
    <section className="space-y-5 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <h2 className="font-display font-bold text-ink-950">İki adımlı doğrulama (TOTP)</h2>
          <p className="text-xs text-text-muted">{mfaRequiredText}</p>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink-950">Kayıtlı doğrulayıcılar</h3>
        {hasFactor ? (
          <ul className="mt-2 divide-y divide-line rounded-[var(--radius-card)] border border-line">
            {factors.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
                <Smartphone className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-semibold text-ink-950">{f.name}</span>
                <span className="text-xs text-text-muted">{dateFmt.format(new Date(f.createdAt))}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 rounded-[var(--radius-card)] border border-dashed border-line px-3.5 py-3 text-sm text-text-muted">
            Henüz doğrulayıcı kurmadınız. Google Authenticator, Microsoft Authenticator veya uyumlu bir uygulamayla kurun.
          </p>
        )}
      </div>

      {hasFactor && !sessionAal2 && !enrollment ? (
        <div className="space-y-3 rounded-[var(--radius-card)] border border-line bg-canvas p-4">
          <p className="text-sm text-text-muted">
            Yedek doğrulayıcı eklemek için önce bu oturumu mevcut doğrulayıcınızla doğrulayın.
          </p>
          <TotpCodeForm id="account-mfa-elevate" busy={totp.busy} onSubmit={elevate} submitLabel="Oturumu doğrula" />
        </div>
      ) : null}

      {enrollment ? (
        <div className="space-y-4">
          <TotpEnrollmentView enrollment={enrollment} />
          <TotpCodeForm id="account-mfa-enroll" busy={totp.busy} autoFocus onSubmit={confirmEnroll} submitLabel="Kodu doğrula ve kaydet" />
        </div>
      ) : !hasFactor || sessionAal2 ? (
        <Button
          variant={hasFactor ? "secondary" : "primary"}
          icon={hasFactor ? Plus : KeyRound}
          loading={totp.busy}
          onClick={() => void startEnroll()}
        >
          {hasFactor ? "Yedek doğrulayıcı ekle" : "Doğrulayıcı kur"}
        </Button>
      ) : null}

      {done ? (
        <p role="status" className="rounded-[var(--radius-control)] border border-mint-500/30 bg-mint-500/10 px-3.5 py-2.5 text-sm font-medium text-mint-700">
          {done}
        </p>
      ) : null}
      <TotpError error={totp.error} />
    </section>
  );
}
