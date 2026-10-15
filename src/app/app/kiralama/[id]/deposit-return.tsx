"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Landmark, Loader2, RotateCcw, X } from "lucide-react";
import { markDepositReturned } from "@/app/actions/rentals";
import { recordDepositCash, voidDepositCash } from "@/app/actions/rental-finance";
import { useToast } from "@/components/app/toast-provider";
import { FinanceAccountPicker } from "@/components/app/finance-account-picker";
import { Button } from "@/components/ui/button";

type DepositCash = { available: boolean; received: boolean; returned: boolean };

/** Koyu hero cam düğmesi (Button ghost üstüne). */
const GLASS =
  "border border-mint-400/30 bg-mint-500/12 font-bold text-mint-300 hover:border-mint-400/50 hover:bg-mint-500/20 hover:text-mint-200";
const GLASS_BTN =
  "focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-mint-400/30 bg-mint-500/12 px-2.5 py-1 text-xs font-bold text-mint-300 transition hover:border-mint-400/50 hover:bg-mint-500/20 disabled:opacity-60";

/**
 * Depozito kontrolü (C.3 + WP4) — kira detayının koyu hero'sunda durur, o yüzden koyu-zemin (cam) stili.
 * Depozito emanettir (kâr/zarar dışı): "Kasaya işle" alınan depozitoyu seçilen ofis hesabına giriş olarak yazar;
 * iade işaretlenirken hesap seçilirse aynı tutar çıkış olarak yazılır. Geri alma hareketi iptal eder (silmez).
 */
export function DepositReturnControl({
  rentalId,
  returned,
  returnedAt,
  canEdit = false,
  cash = { available: false, received: false, returned: false },
}: {
  rentalId: string;
  returned: boolean;
  returnedAt: string | null;
  canEdit?: boolean;
  cash?: DepositCash;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { push } = useToast();
  // Açık satır: "receive" = kasaya işle, "return" = iade onayı (isteğe bağlı çıkış hesabı)
  const [mode, setMode] = useState<"receive" | "return" | null>(null);
  const [accountId, setAccountId] = useState("");

  const close = () => {
    setMode(null);
    setAccountId("");
  };

  const receive = () => {
    if (!accountId) return;
    start(async () => {
      const res = await recordDepositCash({ rentalId, event: "received", accountId });
      if (res.error) push(res.error, "err");
      else {
        push("Depozito hesaba giriş olarak işlendi (emanet, kâr/zarar dışı).", "ok");
        close();
        router.refresh();
      }
    });
  };

  const markReturned = () => {
    start(async () => {
      const res = await markDepositReturned(rentalId, true);
      if (res?.error) {
        push(res.error, "err");
        return;
      }
      if (accountId) {
        const cashRes = await recordDepositCash({ rentalId, event: "returned", accountId });
        if (cashRes.error) push(`İade işaretlendi ancak hesaba çıkış yazılamadı: ${cashRes.error}`, "err");
        else push("Depozito iade edildi; hesaptan çıkış yazıldı.", "ok");
      } else push("Depozito iade edildi olarak işaretlendi.", "ok");
      close();
      router.refresh();
    });
  };

  const undoReturn = () => {
    start(async () => {
      if (cash.returned) {
        const v = await voidDepositCash({ rentalId, event: "returned", reason: "Depozito iadesi geri alındı" });
        if (v.error) {
          push(v.error, "err");
          return;
        }
      }
      const res = await markDepositReturned(rentalId, false);
      if (res?.error) push(res.error, "err");
      else push("Depozito iadesi geri alındı.", "ok");
      router.refresh();
    });
  };

  const receivedChip = cash.received ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold text-white/80" title="Alınan depozito ofis hesabına giriş olarak işlendi">
      <Landmark className="h-3 w-3" /> Kasada
    </span>
  ) : null;

  if (returned) {
    const dateLabel = returnedAt
      ? new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", year: "numeric" }).format(new Date(returnedAt))
      : null;
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-mint-500/20 px-2 py-0.5 text-xs font-bold text-mint-300">
          <CheckCircle2 className="h-3 w-3" /> İade edildi{dateLabel ? ` · ${dateLabel}` : ""}
        </span>
        {cash.returned ? <span className="text-xs text-white/60">hesaptan çıktı</span> : null}
        {canEdit ? (
          <button
            type="button"
            disabled={pending}
            onClick={undoReturn}
            title={cash.returned ? "İadeyi ve çıkış hareketini geri al" : "İadeyi geri al"}
            aria-label="İadeyi geri al"
            className="focus-ring grid h-6 w-6 place-items-center rounded-[var(--radius-control)] text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-50 touch:min-h-11 touch:min-w-11"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          </button>
        ) : null}
      </span>
    );
  }

  if (!canEdit) return receivedChip;

  if (mode) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <FinanceAccountPicker direction={mode === "receive" ? "in" : "out"} value={accountId} onChange={setAccountId} required={mode === "receive"} />
        <Button
          variant="ghost"
          size="xs"
          className={GLASS}
          loading={pending}
          icon={CheckCircle2}
          disabled={mode === "receive" && !accountId}
          onClick={mode === "receive" ? receive : markReturned}
        >
          {mode === "receive" ? "Hesaba işle" : "İadeyi onayla"}
        </Button>
        <Button variant="ghost" size="icon" icon={X} aria-label="Vazgeç" className="text-white/50 hover:bg-white/10 hover:text-white" onClick={close} />
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {receivedChip}
      {cash.available && !cash.received ? (
        <Button variant="ghost" size="xs" className={GLASS} icon={Landmark} disabled={pending} onClick={() => setMode("receive")} title="Alınan depozitoyu ofis hesabına giriş olarak yazar (emanet)">
          Kasaya işle
        </Button>
      ) : null}
      <button type="button" disabled={pending} onClick={() => (cash.available ? setMode("return") : markReturned())} className={GLASS_BTN}>
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
        Depozito iade edildi
      </button>
    </span>
  );
}
