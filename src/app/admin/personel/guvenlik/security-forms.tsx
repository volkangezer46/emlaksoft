"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setDemoLoginMode, setMfaEnforcement, type DemoModeInput } from "@/app/actions/platform-security";
import { ReasonDialog } from "./reason-dialog";

/** Kopyalanabilir komut/metin satırı (düz metin). */
export function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2">
      <code className="min-w-0 flex-1 break-all text-xs text-ink-900">{text}</code>
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0"
        aria-label={copied ? "Kopyalandı" : "Kopyala"}
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-mint-600" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

type DemoOption = { value: DemoModeInput; label: string; hint: string; disabledText: string | null };

/** Demo girişi seçici: üç mod + sunucu varsayılanı. Env tavanı kapalı seçenekler devre dışı ve gerekçesi kopyalanabilir. */
export function DemoModeForm({ current, options }: { current: DemoModeInput; options: DemoOption[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<DemoModeInput>(current);
  const [hours, setHours] = useState(4);
  const changed = mode !== current || mode === "tenant_platform";

  return (
    <div className="space-y-3">
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">Demo girişi modu</legend>
        {options.map((o) => {
          const disabled = Boolean(o.disabledText);
          return (
            <label
              key={o.value}
              className={`flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-card)] border p-3 text-sm transition ${
                mode === o.value ? "border-brand-500 bg-brand-600/[0.06] ring-2 ring-brand-500/25" : "border-line bg-canvas"
              } ${disabled ? "cursor-not-allowed opacity-60" : "hover:border-brand-300"}`}
            >
              <input
                type="radio"
                name="demo-mode"
                value={o.value}
                checked={mode === o.value}
                disabled={disabled}
                onChange={() => setMode(o.value)}
                className="mt-1"
              />
              <span className="min-w-0">
                <span className="block font-semibold text-ink-950">{o.label}</span>
                <span className="block text-xs text-text-muted">{o.hint}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {options
        .filter((o) => o.disabledText)
        .map((o) => (
          <div key={o.value} className="space-y-1">
            <p className="text-xs text-text-muted">{o.label}: sunucu bunu kapatmış. Açmak için:</p>
            <CopyLine text={o.disabledText!} />
          </div>
        ))}
      {mode === "tenant_platform" ? (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-ink-900">Süre</span>
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-sm"
          >
            {[1, 2, 4, 8, 12, 24].map((h) => (
              <option key={h} value={h}>
                {h} saat
              </option>
            ))}
          </select>
          <span className="text-xs text-text-muted">En çok 24 saat; süre dolunca platform kartları kendiliğinden kapanır.</span>
        </label>
      ) : null}
      <ReasonDialog
        tone={mode === "tenant_platform" ? "danger" : "default"}
        title="Demo girişi değiştirilsin mi?"
        description={
          mode === "tenant_platform"
            ? `Giriş sayfasında ${hours} saat boyunca herkes tek tıkla süper admin olabilecek.`
            : "Giriş sayfasındaki hızlı demo kartları hemen değişir."
        }
        confirmLabel="Kaydet"
        trigger={
          <Button variant="primary" size="sm" disabled={!changed}>
            Kaydet
          </Button>
        }
        onConfirm={async (reason) => {
          const res = await setDemoLoginMode({ mode, hours, reason });
          if (res.error) return { error: res.error };
          router.refresh();
        }}
      />
    </div>
  );
}

/** MFA anahtarı: aç (0/7 gün geçiş) / kapat. Açma, kendi doğrulayıcısı olmayan süper admine sunucuda reddedilir. */
export function MfaEnforcementForm({ enforced, canEnable }: { enforced: boolean; canEnable: boolean }) {
  const router = useRouter();
  const [grace, setGrace] = useState<0 | 7>(7);

  if (enforced) {
    return (
      <ReasonDialog
        tone="danger"
        title="Personel MFA zorunluluğu kapatılsın mı?"
        description="Personel yalnız parolayla yönetim paneline girebilir; veritabanı kapıları da AAL2 istemez."
        confirmLabel="Zorunluluğu kapat"
        trigger={
          <Button variant="outline" size="sm" className="text-danger-600">
            Zorunluluğu kapat
          </Button>
        }
        onConfirm={async (reason) => {
          const res = await setMfaEnforcement({ on: false, graceDays: 0, reason });
          if (res.error) return { error: res.error };
          router.refresh();
        }}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm">
        <span className="font-semibold text-ink-900">Geçiş süresi</span>
        <select
          value={grace}
          onChange={(e) => setGrace(Number(e.target.value) === 0 ? 0 : 7)}
          className="rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-sm"
        >
          <option value={7}>7 gün (önerilen)</option>
          <option value={0}>Hemen</option>
        </select>
      </label>
      <ReasonDialog
        title="Personel için iki adımlı doğrulama zorunlu olsun mu?"
        description={
          grace === 7
            ? "7 gün boyunca doğrulayıcısı olmayan personel parolayla panele girer ve geri sayım şeridi görür; sonra kod zorunludur. Dikkat: geçiş süresinde de veritabanı kapılı işlemler (ör. büyüme ekranları) doğrulayıcı ister."
            : "Doğrulayıcısı olmayan personel bir sonraki girişte kurulum ekranına yönlenir."
        }
        confirmLabel="Zorunlu yap"
        trigger={
          <Button variant="primary" size="sm" disabled={!canEnable}>
            Zorunlu yap
          </Button>
        }
        onConfirm={async (reason) => {
          const res = await setMfaEnforcement({ on: true, graceDays: grace, reason });
          if (res.error) return { error: res.error };
          router.refresh();
        }}
      />
    </div>
  );
}
