"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerPropertyManagement } from "@/app/actions/modules";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PROPERTY_MANAGEMENT_QUESTION } from "@/lib/onboarding-steps";

/**
 * Kurulum sihirbazı "Mülk yönetimi" adımı: Evet/Hayır -> Mülk Yönetimi (rentals) modülü ofiste açılır/kapanır.
 * Atlanabilir (sihirbazın "sonra yaparım" düğmesi); atlanırsa mevcut davranış sürer. Sonradan Ayarlar > Modüller'den değişir.
 */
export function MulkYonetimiStep({ enabled, canEdit, nextHref }: { enabled: boolean; canEdit: boolean; nextHref: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<boolean | null>(null);

  function answer(yes: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await answerPropertyManagement(yes);
      if (res.error) return setError(res.error);
      setDone(yes);
      router.push(nextHref);
      router.refresh();
    });
  }

  if (!canEdit) {
    return <Alert tone="info">Bu ayarı yalnız ofis sahibi ve genel müdür değiştirir. Bu adımı atlayabilirsin.</Alert>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-text">{PROPERTY_MANAGEMENT_QUESTION}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant={done === true ? "primary" : "secondary"} loading={pending} onClick={() => answer(true)}>
          Evet, mülk yönetimi yapıyoruz
        </Button>
        <Button type="button" variant={done === false ? "primary" : "secondary"} disabled={pending} onClick={() => answer(false)}>
          Hayır, yapmıyoruz
        </Button>
      </div>
      <p className="text-xs text-text-muted">
        Şu an Mülk Yönetimi {enabled ? "açık" : "kapalı"}. Hayır derseniz menüde görünmez ve kira tahakkuku üretilmez; verileriniz silinmez.
        Sonradan Ayarlar &gt; Modüller ekranından değiştirebilirsiniz.
      </p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
