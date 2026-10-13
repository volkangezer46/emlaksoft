"use client";

import { useCallback, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STEP_UP_FIELD, normalizeStepUpCode } from "@/lib/platform-security/step-up-policy";

/**
 * AD11 kritik işlem yeniden doğrulaması (istemci). Sunucu `requireStepUp` ile kodu ayrıca doğrular; ayar kapalıysa
 * kod yok sayılır. İki biçim:
 *  - `<StepUpCodeField />`: `<form>` içine konan 6 haneli kod alanı (FormData'ya `step_up_code` olarak girer).
 *  - `useStepUpPrompt()`: FormData'yı elle kuran satır içi eylemler için kod soran pencere (`await ask()` → kod | null).
 */
export function StepUpCodeField({ id = "step-up-code", className }: { id?: string; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-ink-900">
        <KeyRound className="h-3.5 w-3.5 text-brand-600" aria-hidden /> Doğrulayıcı kodu
      </label>
      <Input
        id={id}
        name={STEP_UP_FIELD}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        placeholder="6 haneli kod"
        className="max-w-[12rem] tabular-nums tracking-widest"
      />
      <p className="mt-1 text-xs text-text-muted">Kritik işlem: doğrulayıcı uygulamanızdaki güncel kodu girin.</p>
    </div>
  );
}

/** Sıkışık satır içi formlar (faturalama işlemleri) için aynı alanın kısa biçimi; stil çağıran formdan gelir. */
export function StepUpInlineField({ labelClassName, inputClassName }: { labelClassName?: string; inputClassName?: string }) {
  return (
    <label className={labelClassName}>
      Doğrulayıcı kodu
      <input
        name={STEP_UP_FIELD}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        placeholder="6 hane"
        className={inputClassName}
      />
    </label>
  );
}

export function useStepUpPrompt(): { ask: (title?: string) => Promise<string | null>; dialog: React.ReactNode } {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("Doğrulayıcı kodu");
  const [code, setCode] = useState("");
  const resolver = useRef<((v: string | null) => void) | null>(null);

  const finish = useCallback((value: string | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpen(false);
    setCode("");
  }, []);

  const ask = useCallback((t?: string) => {
    resolver.current?.(null);
    setTitle(t ?? "Doğrulayıcı kodu");
    setCode("");
    setOpen(true);
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const valid = normalizeStepUpCode(code) !== null;
  const dialog = (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : finish(null))}>
      <DialogContent size="sm">
        <DialogHeader icon={<KeyRound />} title={title} description="Bu kritik işlem için doğrulayıcı uygulamanızdaki 6 haneli kodu girin." />
        <DialogBody>
          <form
            id="step-up-prompt"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) finish(normalizeStepUpCode(code));
            }}
          >
            <label htmlFor="step-up-prompt-code" className="mb-1 block text-sm font-semibold text-ink-900">
              Doğrulayıcı kodu
            </label>
            <Input
              id="step-up-prompt-code"
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6 haneli kod"
              className="max-w-[12rem] tabular-nums tracking-widest"
            />
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Vazgeç</Button>
          </DialogClose>
          <Button type="submit" form="step-up-prompt" disabled={!valid}>
            Onayla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { ask, dialog };
}
