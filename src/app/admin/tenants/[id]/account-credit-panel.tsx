"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Coins, Loader2, Undo2 } from "lucide-react";
import { grantAccountCredit, reverseAccountCredit, type AdminCreditResult } from "@/app/actions/admin-account-credit";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import Link from "@/components/ui/smart-link";
import { formatTry } from "@/lib/format";
import type { TryBalance } from "@/lib/try-credits/config";
import { ADMIN_CREDIT_MAX_TRY, ADMIN_CREDIT_REASON_MAX, ADMIN_CREDIT_REASON_MIN, ADMIN_GRANT_KINDS } from "@/lib/try-credits/admin-credit-input";

/** Defterdeki yükleme kaydı (geri alma seçimi için; tutar yalnız seçim etiketinde, bakiye gösterilmez). */
export type CreditGrantOption = { idem: string; label: string };

/** Son hareket satırı (sunucuda biçimlenir; grantIdem doluysa satırdan "Geri al" açılır). */
export type CreditMovementRow = { entryType: string; amount: number; dateLabel: string; grantIdem: string | null };

const ENTRY_LABEL: Record<string, string> = { grant: "Yükleme", spend: "Harcama", reverse: "Geri alma", expire: "Vade dolumu", adjust: "Düzeltme" };

const KIND_LABEL: Record<(typeof ADMIN_GRANT_KINDS)[number], string> = { manual: "Manuel düzeltme", bonus: "Hediye (bonus)", campaign: "Kampanya" };

type Mode = "grant" | "reverse";

/**
 * Hesap kredisi (₺) — yalnız süper admin. Yükleme ve geri alma `admin-account-credit` eylemleriyle; denetim önce yazılır,
 * çift gönderim `request_id` ile engellenir (ilk gönderimde istemcide crypto.randomUUID ile üretilir, başarıdan sonra yenilenir). Bakiye ve son hareketler
 * sunucudan (page.tsx) gelir; işlem sonucu mesajı eylemden gelir. Gönderimden önce satır içi onay (geri alma geri döndürülemez uyarısı).
 */
export function AccountCreditPanel({
  tenantId,
  grants,
  movements,
  balance,
}: {
  tenantId: string;
  grants: CreditGrantOption[];
  movements: CreditMovementRow[];
  balance: TryBalance | null;
}) {
  const [original, setOriginal] = useState("");
  const [mode, setMode] = useState<Mode>("grant");
  // İstek kimliği ilk gönderimde üretilir ve başarıya kadar korunur (yeniden deneme aynı kimlikle: çift kayıt olmaz).
  const [requestId, setRequestId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<AdminCreditResult | null>(null);
  const [pending, start] = useTransition();

  const submit = (form: HTMLFormElement) => {
    const fd = new FormData(form);
    const id = requestId ?? crypto.randomUUID();
    setRequestId(id);
    fd.set("request_id", id);
    start(async () => {
      const res = await (mode === "grant" ? grantAccountCredit(fd) : reverseAccountCredit(fd));
      setResult(res);
      setConfirming(false);
      if (res.ok) {
        setOriginal("");
        form.reset();
        setRequestId(null);
      }
    });
  };

  return (
    <section id="hesap-kredisi" aria-labelledby="hesap-kredisi-baslik" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="hesap-kredisi-baslik" className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
            <Coins className="h-4 w-4 text-[var(--pm-gold-text)]" aria-hidden /> Hesap kredisi (₺)
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">Ofisin faturalarında kullanılabilen TL kredisi. Her işlem gerekçesiyle denetim kaydına yazılır.</p>
        </div>
        <div role="tablist" aria-label="Kredi işlemi" className="inline-flex rounded-full border border-line bg-surface-sunken p-0.5">
          {(["grant", "reverse"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setConfirming(false);
                setResult(null);
              }}
              className={`focus-ring min-h-9 rounded-full px-3.5 text-xs font-semibold transition ${mode === m ? "bg-accent text-accent-fg" : "text-text-muted hover:text-ink-950"}`}
            >
              {m === "grant" ? "Kredi yükle" : "Geri al"}
            </button>
          ))}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {balance ? (
          [
            ["Kullanılabilir", formatTry(balance.available)],
            ["Bakiye", formatTry(balance.balance)],
            ["Rezerve", formatTry(balance.reserved)],
            ["Toplam yüklenen", formatTry(balance.granted_total)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-[var(--radius-control)] border border-line bg-surface-sunken px-3 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">{k}</dt>
              <dd className="font-display text-base font-bold text-ink-950">
                <Link href="/admin/billing" className="focus-ring hover:underline">
                  {v}
                </Link>
              </dd>
            </div>
          ))
        ) : (
          <p className="col-span-full text-xs text-text-muted">Bakiye okunamadı (cüzdan hazır değil). İşlemler yine de denenebilir.</p>
        )}
      </dl>

      <form
        key={mode}
        className="mt-4 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!confirming) {
            setConfirming(true);
            return;
          }
          submit(e.currentTarget);
        }}
      >
        <input type="hidden" name="tenant_id" value={tenantId} />
        <FormField label="Tutar (₺)" htmlFor="kredi-tutar" required hint={`En fazla ${ADMIN_CREDIT_MAX_TRY.toLocaleString("tr-TR")} ₺; kuruş için virgül.`}>
          <FormInput id="kredi-tutar" name="amount" inputMode="decimal" required autoComplete="off" placeholder="Örn. 500" onChange={() => setConfirming(false)} />
        </FormField>
        {mode === "grant" ? (
          <>
            <FormField label="Tür" htmlFor="kredi-tur">
              <FormSelect id="kredi-tur" name="kind" defaultValue="manual">
                {ADMIN_GRANT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </FormSelect>
            </FormField>
            <FormField label="Son kullanma (isteğe bağlı)" htmlFor="kredi-vade" hint="Boşsa süresiz. Seçilen günün sonuna kadar geçerli.">
              <FormInput id="kredi-vade" name="expires_on" type="date" />
            </FormField>
          </>
        ) : (
          <FormField label="Geri alınacak yükleme" htmlFor="kredi-asil" hint="Seçilirse geri alma o yüklemenin kalanını aşamaz. Boşsa genel geri alma.">
            <FormSelect id="kredi-asil" name="original_idem" value={original} onChange={(e) => setOriginal(e.target.value)}>
              <option value="">Belirli bir yükleme yok</option>
              {grants.map((g) => (
                <option key={g.idem} value={g.idem}>
                  {g.label}
                </option>
              ))}
            </FormSelect>
          </FormField>
        )}
        <div className="sm:col-span-2">
          <FormField label="Neden" htmlFor="kredi-neden" required hint={`${ADMIN_CREDIT_REASON_MIN}-${ADMIN_CREDIT_REASON_MAX} karakter; yalnız platform denetim kaydında saklanır.`}>
            <FormTextarea id="kredi-neden" name="reason" required minLength={ADMIN_CREDIT_REASON_MIN} maxLength={ADMIN_CREDIT_REASON_MAX} rows={2} onChange={() => setConfirming(false)} />
          </FormField>
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          {confirming ? (
            <p role="alert" className="flex items-start gap-1.5 text-xs font-semibold text-amber-800">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              {mode === "grant"
                ? "Kredi ofisin bakiyesine hemen yazılır. Onaylıyor musunuz?"
                : "Geri alma geri döndürülemez; bakiye eksiye düşebilir (eksi bakiye harcanamaz). Onaylıyor musunuz?"}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className={`focus-ring press inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-control)] px-4 text-sm font-semibold transition disabled:opacity-60 ${
              mode === "reverse" ? "bg-danger-600 text-white hover:bg-danger-700" : "bg-accent text-accent-fg hover:bg-accent-hover"
            }`}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : mode === "reverse" ? <Undo2 className="h-4 w-4" aria-hidden /> : <Coins className="h-4 w-4" aria-hidden />}
            {confirming ? (mode === "grant" ? "Evet, yükle" : "Evet, geri al") : mode === "grant" ? "Kredi yükle" : "Krediyi geri al"}
          </button>
          {confirming ? (
            <button type="button" onClick={() => setConfirming(false)} className="focus-ring text-xs font-semibold text-text-muted hover:text-ink-950">
              Vazgeç
            </button>
          ) : null}
        </div>
      </form>

      <div className="mt-5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-text-muted">Son hareketler</h3>
        {movements.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">Bu ofis için henüz TL kredi hareketi yok. Yukarıdan ilk krediyi yükleyebilirsiniz.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-[var(--radius-control)] border border-line">
            {movements.map((m, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="text-ink-950">
                  {ENTRY_LABEL[m.entryType] ?? m.entryType} <span className="text-text-muted">· {m.dateLabel}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className={`font-semibold ${m.amount < 0 ? "text-danger-600" : "text-mint-700"}`}>{formatTry(m.amount)}</span>
                  {m.grantIdem ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMode("reverse");
                        setOriginal(m.grantIdem ?? "");
                        setConfirming(false);
                        setResult(null);
                      }}
                      className="focus-ring text-xs font-semibold text-accent hover:underline"
                    >
                      Geri al
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {result ? (
        <p
          role={result.error ? "alert" : "status"}
          className={`mt-3 flex items-start gap-1.5 text-sm font-semibold ${result.error ? "text-danger-600" : "text-mint-700"}`}
        >
          {result.error ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          {result.error ?? result.message}
        </p>
      ) : null}
    </section>
  );
}
