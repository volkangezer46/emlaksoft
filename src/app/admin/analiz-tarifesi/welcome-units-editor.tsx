"use client";

import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveEfWelcomeUnits } from "@/app/actions/platform-billing-plans";
import { efCreditsLine } from "@/lib/ef-credits/plan-credits";
import { opFieldClass } from "@/app/admin/billing/inline-op";

const lbl = "block text-xs font-semibold text-text-muted";

/**
 * Hoş geldin analiz bakiyesi (yalnız deneme/yeni ofis, tek sefer): TEK düzenleme yeri Kullanım ve krediler > Analiz tarifesi.
 * Planlar ekranı yalnız salt okunur özet gösterir.
 */
export function WelcomeUnitsEditor({ welcomeUnits, valuationCost, canWrite }: { welcomeUnits: number; valuationCost: number; canWrite: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(String(welcomeUnits));
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = /^\d+$/.test(value.trim()) && Number(value.trim()) <= 1000;

  function submit() {
    if (pending || !valid) return;
    const fd = new FormData();
    fd.set("welcome_units", value.trim());
    start(async () => {
      const r = await saveEfWelcomeUnits(fd);
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.notice ?? "Kaydedildi." });
      setConfirm(false);
      if (!r.error) router.refresh();
    });
  }

  return (
    <section id="hos-geldin" aria-labelledby="hos-geldin-baslik" className="scroll-mt-24 space-y-2 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <h2 id="hos-geldin-baslik" className="font-display font-bold text-ink-950">
        Hoş geldin analiz bakiyesi
      </h2>
      <p className="text-xs text-text-muted">Yalnız deneme/yeni ofise bir kez verilir; mevcut ofislere geriye dönük dağıtılmaz.</p>
      <label className={lbl}>
        Analiz bakiyesi (0 = kapalı)
        <input
          inputMode="numeric"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setConfirm(false);
          }}
          disabled={!canWrite}
          className={`mt-1 w-40 ${opFieldClass}`}
        />
      </label>
      {valid ? (
        <p className="text-xs text-text-muted">
          {Number(value.trim()) === 0 ? "Kapalı: yeni hoş geldin hibesi verilmez." : (efCreditsLine(Number(value.trim()), valuationCost)?.replace("Her ay ", "") ?? "")}
        </p>
      ) : (
        <p role="alert" className="text-xs font-semibold text-danger-600">
          0-1000 arasında tam sayı girin.
        </p>
      )}
      {canWrite ? (
        <div className="flex flex-wrap items-center gap-2">
          {!confirm ? (
            <Button variant="outline" size="sm" type="button" disabled={!valid || pending} onClick={() => setConfirm(true)}>
              Kaydet
            </Button>
          ) : (
            <>
              <span className="text-xs text-text-muted">Değer {value.trim()} olarak kaydedilecek. Onaylıyor musunuz?</span>
              <Button variant="navy" size="sm" type="button" disabled={pending} onClick={submit}>
                {pending ? "Kaydediliyor…" : "Onayla"}
              </Button>
              <Button type="button" disabled={pending} onClick={() => setConfirm(false)} variant="ghost" size="sm">
                Vazgeç
              </Button>
            </>
          )}
          {msg ? (
            <span role={msg.ok ? "status" : "alert"} className={`text-xs font-semibold ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>
              {msg.text}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-text-muted">Bu ayarı yalnız süper admin değiştirir.</p>
      )}
    </section>
  );
}
