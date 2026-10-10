"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { saveOwnTitle } from "@/app/actions/onboarding-wizard";
import { AGENT_TITLE_MAX } from "@/lib/agent-profile";

/** "Sen" adımının unvan alanı: kullanıcının KENDİ unvanı. Uzmanlık ve bölgeler ayrı kaydedilir (mevcut editörler). */
export function TitleForm({ defaultTitle }: { defaultTitle: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function submit(fd: FormData) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveOwnTitle(fd);
      if (res.error) return setError(res.error);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form action={submit} className="space-y-3">
      <div>
        <label htmlFor="sen-unvan" className="mb-1 block text-xs font-semibold text-text-muted">
          Unvanın
        </label>
        <input
          id="sen-unvan"
          name="title"
          required
          maxLength={AGENT_TITLE_MAX}
          defaultValue={defaultTitle}
          autoComplete="organization-title"
          placeholder="Kurucu & Gayrimenkul Danışmanı"
          className="focus-ring min-h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-base text-text sm:text-sm"
        />
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" loading={pending}>
          Unvanı kaydet
        </Button>
        {saved ? (
          <span className="motion-enter flex items-center gap-1 text-xs font-semibold text-mint-600" role="status">
            <Check className="h-3.5 w-3.5" aria-hidden /> Kaydedildi
          </span>
        ) : null}
      </div>
    </form>
  );
}
