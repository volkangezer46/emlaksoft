"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { encryptSecretsAction } from "@/app/actions/platform-settings-center";
import type { EncryptPlaintextReport } from "@/lib/settings/write";
import { FormInput } from "@/components/ui/form-controls";

/**
 * Tek seferlik "düz metin sırları şifrele" eylemi (OTOMATİK DEĞİL; yalnız süper admin). Önce durum listelenir (kuru koşu),
 * sonra "ŞİFRELE" yazılarak onaylanır. Düz değer ekrana/loga/geçmişe yazılmaz.
 */
export function SecretsMigration({ plaintextKeys, canRun, keySource }: { plaintextKeys: string[]; canRun: boolean; keySource: "env" | "derived" | "none" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState("");
  const [report, setReport] = useState<EncryptPlaintextReport | null>(null);

  function run(dryRun: boolean) {
    start(async () => {
      const res = await encryptSecretsAction({ dryRun, confirm });
      setReport(res);
      if (!dryRun && res.ok) {
        setConfirm("");
        router.refresh();
      }
    });
  }

  return (
    <section className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4" aria-labelledby="secrets-migration-title">
      <h2 id="secrets-migration-title" className="flex items-center gap-2 text-sm font-semibold text-ink-950">
        <ShieldCheck className="h-4 w-4 text-brand-600" /> Gizli anahtarların şifreli saklanması
      </h2>
      <p className="text-xs text-text-muted">
        Şifreleme anahtarı:{" "}
        <span className="font-semibold text-ink-950">
          {keySource === "env" ? "PLATFORM_SECRETS_KEY (ayrı anahtar)" : keySource === "derived" ? "sunucu sırrından türetilmiş (yedek)" : "TANIMLI DEĞİL"}
        </span>
        {keySource === "none" ? " — gizli anahtar kaydı kapalıdır; düz metin asla yazılmaz." : keySource === "derived" ? " — önerilen: PLATFORM_SECRETS_KEY tanımlayın." : ""}
      </p>
      {plaintextKeys.length === 0 ? (
        <p className="text-xs text-mint-700">Düz metin saklanan gizli anahtar yok.</p>
      ) : (
        <p className="text-xs text-amber-800">
          Düz metin saklanan {plaintextKeys.length} anahtar var: {plaintextKeys.join(", ")}. Okuma şu an bunları kabul eder; şifrelemek önerilir.
        </p>
      )}
      {canRun && plaintextKeys.length > 0 && keySource !== "none" ? (
        <div className="space-y-2">
          <p className="text-xs text-text-faint">
            Doğrulayıcı: her anahtar şifrelenip çözülerek karşılaştırılır; uyuşmazsa eski değer otomatik geri yazılır. Düz metne dönüş yoktur (anahtarı yeniden girmek yeterli).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending} onClick={() => run(true)} className="focus-ring press rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-950">
              Durumu denetle
            </button>
            <FormInput aria-label="Onay metni" placeholder="Onay için ŞİFRELE yazın" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="max-w-48" />
            <button type="button" disabled={pending || confirm !== "ŞİFRELE"} onClick={() => run(false)} className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-ink-950 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Düz metin sırları şifrele
            </button>
          </div>
        </div>
      ) : null}
      {report ? (
        <div role="status" className="rounded-[var(--radius-control)] bg-canvas px-3 py-2 text-xs text-text-muted">
          {report.error ? <p className="font-medium text-danger-600">{report.error}</p> : null}
          {report.found.length > 0 ? (
            <ul className="list-inside list-disc">
              {report.found.map((f) => (
                <li key={f.storage}>
                  {f.key}: {f.state}
                </li>
              ))}
            </ul>
          ) : null}
          {report.encrypted.length > 0 ? <p className="font-medium text-mint-700">Şifrelendi: {report.encrypted.join(", ")}</p> : null}
          {report.failed.length > 0 ? <p className="font-medium text-danger-600">Şifrelenemedi (eski değer korundu): {report.failed.join(", ")}</p> : null}
        </div>
      ) : null}
    </section>
  );
}