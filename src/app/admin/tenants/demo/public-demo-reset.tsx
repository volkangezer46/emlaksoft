"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, FormTextarea } from "@/components/ui/form-controls";
import { StepUpCodeField } from "@/components/admin/step-up";
import { adminResetPublicDemo, type AdminDemoResult } from "@/app/actions/admin-demo-data";

/** Genel demo ofisini hemen ilk haline döndürür (gece sıfırlamasıyla aynı RPC). Gerekçe + doğrulayıcı kodu. */
export function PublicDemoReset() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<AdminDemoResult | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await adminResetPublicDemo(fd);
          setRes(r);
          if (r.ok) router.refresh();
        });
      }}
    >
      <FormField label="Gerekçe" htmlFor="public-demo-reason" hint="En az 10 karakter; denetim izine yazılır.">
        <FormTextarea id="public-demo-reason" name="reason" rows={2} required minLength={10} />
      </FormField>
      <StepUpCodeField id="public-demo-step-up" />
      {res?.error ? (
        <p role="alert" className="text-xs font-semibold text-danger-600">
          {res.error}
        </p>
      ) : null}
      {res?.ok ? <p className="text-xs font-semibold text-mint-600">{res.message}</p> : null}
        {res?.notice ? (
          <p role="status" className="break-words text-xs font-semibold text-amber-800">
            {res.notice}
          </p>
        ) : null}
      <Button type="submit" variant="secondary" icon={RotateCcw} loading={pending}>
        Şimdi ilk haline döndür
      </Button>
    </form>
  );
}
