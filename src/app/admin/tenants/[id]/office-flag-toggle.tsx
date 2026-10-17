"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStepUpPrompt } from "@/components/admin/step-up";
import { setOfficeFlagMembership } from "@/app/actions/admin-ops";

/**
 * Ofisi bayrağın seçili ofis listesine ekle / listeden çıkar. Satır içi: gerekçe alanı (≥10 karakter) → doğrulayıcı
 * kodu → sunucu eylemi (süper admin, hız sınırı, platform + ofis denetim kaydı).
 */
export function OfficeFlagToggle({ flagKey, label, tenantId, inList }: { flagKey: string; label: string; tenantId: string; inList: boolean }) {
  const router = useRouter();
  const stepUp = useStepUpPrompt();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = reason.trim().length >= 10;

  async function submit() {
    const code = await stepUp.ask(inList ? "Ofisi bayrak listesinden çıkar" : "Ofisi bayrak listesine ekle");
    if (!code) return;
    const fd = new FormData();
    fd.set("flag_key", flagKey);
    fd.set("tenant_id", tenantId);
    fd.set("include", inList ? "0" : "1");
    fd.set("reason", reason.trim());
    fd.set("step_up_code", code);
    start(async () => {
      const res = await setOfficeFlagMembership(fd);
      setResult(res.error ? { ok: false, text: res.error } : { ok: true, text: inList ? "Ofis listeden çıkarıldı." : "Ofis listeye eklendi." });
      if (!res.error) {
        setOpen(false);
        setReason("");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex min-w-0 flex-col items-stretch gap-1.5 sm:items-end">
      {open ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <label className="sr-only" htmlFor={`flag-reason-${flagKey}`}>
            {label}: gerekçe
          </label>
          <Input
            id={`flag-reason-${flagKey}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            placeholder="Gerekçe (en az 10 karakter)"
            className="h-8 min-w-0 flex-1 text-xs sm:w-56 sm:flex-none"
          />
          <Button type="button" size="xs" variant="navy" disabled={!valid || pending} onClick={submit}>
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            {inList ? "Çıkar" : "Ekle"}
          </Button>
          <Button type="button" size="xs" variant="outline" onClick={() => setOpen(false)}>
            Vazgeç
          </Button>
        </div>
      ) : (
        <Button type="button" size="xs" variant="outline" onClick={() => setOpen(true)} aria-label={`${label}: ${inList ? "ofisi listeden çıkar" : "ofisi listeye ekle"}`}>
          {inList ? "Listeden çıkar" : "Listeye ekle"}
        </Button>
      )}
      {result ? (
        <p role={result.ok ? "status" : "alert"} className={`text-xs font-medium ${result.ok ? "text-mint-700" : "text-danger-600"}`}>
          {result.text}
        </p>
      ) : null}
      {stepUp.dialog}
    </div>
  );
}
