"use client";

import { useState, useTransition } from "react";
import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { saveEfWelcomeUnits } from "@/app/actions/platform-billing-plans";
import { efCreditsLine } from "@/lib/ef-credits/plan-credits";
import { opFieldClass } from "../inline-op";

const lbl = "block text-xs font-semibold text-text-muted";

type Row = { id: string; name: string; units: number; perExtraSeat?: number };

/** "Kontör hakları": paket başına aylık hak özeti (canlı yaklaşık değerleme) + hoş geldin kontörü ayarı. */
export function EfCreditsSection({
  rows,
  valuationCost,
  welcomeUnits,
  wholesaleKnown,
  canWrite,
}: {
  rows: Row[];
  valuationCost: number;
  welcomeUnits: number;
  /** ef.wholesale tanımlı mı (iki tarife de 0 değilse). */
  wholesaleKnown: boolean;
  canWrite: boolean;
}) {
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
    <section aria-label="Kontör hakları" className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div>
        <h2 className="font-display font-bold text-ink-950">Kontör hakları</h2>
        <p className="text-xs text-text-muted">
          Paket başına aylık EmlakFiyati kontörü plan düzenleyicisinden girilir; günlük çalışma, trialing/active aboneliği olan ofislere ayı için tek sefer verir.
          Kullanılmayan kontör süresiz devreder. Plan yükseltmede ara hak verilmez; yeni paketin hakkı sonraki ay başlar.
          Ek kullanıcı başı kontör, plan düzenleyicisindeki &quot;ek kullanıcı başı kontör&quot; alanından girilir ve satırlarda hakka eklenir.
        </p>
        <p className="mt-1 text-xs text-text-muted">
          Toptan maliyet (EmlakFiyatı işlem başı tarifesi): {wholesaleKnown ? "tanımlı" : "BİLİNMİYOR, varsayılan 0 kullanılıyor; marj gerçek değildir"}.{" "}
          <Link href="/admin/ef-kontor#ekonomi" className="font-semibold text-brand-600 hover:underline">Kontör ekonomisi ve maliyet girişi</Link>
        </p>
      </div>
      <ul className="space-y-1 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap justify-between gap-2 border-b border-line py-1.5 last:border-0">
            <span className="font-semibold text-ink-950">{r.name}</span>
            <span className="tabular-nums text-text-muted">{efCreditsLine(r.units, valuationCost, r.perExtraSeat) ?? "Aylık hak yok"}</span>
          </li>
        ))}
      </ul>
      <div className="space-y-2 border-t border-line pt-4">
        <h3 className="text-sm font-bold text-ink-950">Hoş geldin kontörü (yalnız deneme/yeni ofis, tek sefer)</h3>
        <label className={lbl}>
          Kontör (0 = kapalı)
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
            {Number(value.trim()) === 0
              ? "Kapalı: yeni hoş geldin hibesi verilmez."
              : (efCreditsLine(Number(value.trim()), valuationCost)?.replace("Aylık ", "") ?? "")}
            {" "}Hoş geldin kontörü yalnız deneme/yeni ofise bir kez verilir; mevcut ofislere geriye dönük dağıtılmaz.
          </p>
        ) : (
          <p role="alert" className="text-xs font-semibold text-danger-600">0-1000 arasında tam sayı girin.</p>
        )}
        {canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            {!confirm ? (
              <button
                type="button"
                disabled={!valid || pending}
                onClick={() => setConfirm(true)}
                className="focus-ring press min-h-9 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-1.5 text-xs font-semibold text-ink-950 disabled:opacity-60"
              >
                Kaydet
              </button>
            ) : (
              <>
                <span className="text-xs text-text-muted">Değer {value.trim()} olarak kaydedilecek. Onaylıyor musunuz?</span>
                <button type="button" disabled={pending} onClick={submit} className="focus-ring press min-h-9 rounded-[var(--radius-control)] bg-ink-950 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">
                  {pending ? "Kaydediliyor…" : "Onayla"}
                </button>
                <button type="button" disabled={pending} onClick={() => setConfirm(false)} className="focus-ring min-h-9 px-3 text-xs font-semibold text-text-muted">
                  Vazgeç
                </button>
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
      </div>
    </section>
  );
}
