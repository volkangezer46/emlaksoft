"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { saveOfficeProfile } from "@/app/actions/onboarding-setup";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LICENSE_NO_MAX, TTBS_BELGE_SORGULA_URL, licenseNoFormatHint } from "@/lib/license";

const inputCls =
  "focus-ring min-h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-base text-text sm:max-w-xs sm:text-sm";

const HINT_TONE = { ok: "text-mint-700", warning: "text-amber-700", danger: "text-danger-500" } as const;

/**
 * Kurulum adımı "Yetki belgesi no" (EİDS): malikler e-Devlet'te ofise bu numarayla yetki verir. Kayıt `saveOfficeProfile`
 * (yalnız license_no; diğer alanlara dokunmaz, katı kural sunucuda `normalizeLicenseNo`). Atlanabilir; boş kalırsa ofis
 * sahibine tek seferlik kurulum görevi açılır (gunluk-ozet cron'u, src/lib/eids/license-setup.ts).
 */
export function YetkiBelgesiStep({ canEdit, nextHref, licenseNo }: { canEdit: boolean; nextHref: string; licenseNo: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(licenseNo ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const hint = licenseNoFormatHint(value);

  if (!canEdit) {
    return <Alert tone="info">Yetki belgesi numarasını ofis sahibi ya da ayar yetkisi olan kullanıcı girer. Bu adımı atlayabilirsiniz.</Alert>;
  }

  function submit(fd: FormData) {
    setError(null);
    if (!value.trim()) {
      setError("Numara boş. Belgenizdeki yetki belge numarasını yazın ya da bu adımı şimdilik atlayın.");
      return;
    }
    startTransition(async () => {
      const res = await saveOfficeProfile(fd);
      if (res.error) return setError(res.error);
      router.push(nextHref);
      router.refresh();
    });
  }

  return (
    <form action={submit} className="space-y-4">
      <p className="text-sm text-text-muted">
        Malikler e-Devlet&apos;te ilan yetkisi verirken ofisini bu numarayla seçer. Numara ilan, vitrin, sunum ve broşürde de görünür.
        Numaranızı TTBS&apos;de &quot;Yetki Belgelerim&quot; bölümünde ya da BelgeSorgula ekranında bulursunuz.
      </p>
      <div>
        <label htmlFor="kurulum-yetki-no" className="mb-1 block text-xs font-semibold text-text-muted">
          Yetki belgesi no
        </label>
        <input
          id="kurulum-yetki-no"
          name="license_no"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={LICENSE_NO_MAX}
          autoComplete="off"
          placeholder="3401234"
          aria-describedby="kurulum-yetki-ipucu"
          aria-invalid={hint.tone === "danger" || undefined}
          className={inputCls}
        />
        <p id="kurulum-yetki-ipucu" className={`mt-1 text-xs ${HINT_TONE[hint.tone]}`}>
          {hint.message}
        </p>
      </div>
      <a
        href={TTBS_BELGE_SORGULA_URL}
        target="_blank"
        rel="noreferrer"
        className="focus-ring inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline"
      >
        TTBS BelgeSorgula ekranını aç <ExternalLink className="h-4 w-4" aria-hidden />
      </a>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div>
        <Button type="submit" loading={pending}>
          Kaydet ve devam et
        </Button>
      </div>
    </form>
  );
}
