"use client";

import { useState } from "react";
import { Coins, Loader2, ShieldAlert, Star } from "lucide-react";
import { startCreditPackPurchase } from "@/app/actions/billing";
import { WalletCreditToggle, type WalletCheckoutInfo } from "@/components/app/wallet-credit-toggle";

const fmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tl = (n: number) => `${fmt.format(n)} ₺`;
const tl2 = (n: number) => `${fmt2.format(n)} ₺`;

/** Sunucuda `quoteCreditPack` ile hesaplanmış kart verisi (istemci tutar HESAPLAMAZ; yalnız gösterir). */
export type KontorPackCard = {
  id: string;
  name: string;
  units: number;
  /** Geçerlilik (ay): süre sonunda kullanılmayan kontör yanar. */
  months: number;
  netTry: number;
  taxTry: number;
  totalTry: number;
  unitNetTry: number;
  unitGrossTry: number;
  popular: boolean;
  suggested: boolean;
};

export function KontorPanel({
  packs,
  canBuy,
  blockReason,
  wallet = null,
  autoOpenId = null,
}: {
  /** "Önerilen paketi al" bağlantısı: bu paketin onay paneli açık gelir (ödeme yine ayrı onayla başlar). */
  autoOpenId?: string | null;
  /** TL hesap kredisi cüzdanı (yoksa/etkin değilse null: onay kutusu gösterilmez). */
  wallet?: WalletCheckoutInfo | null;
  packs: KontorPackCard[];
  /** owner/gm. */
  canBuy: boolean;
  /** Satın almayı kapatan açıklama (hazır değil, ödeme yok vb.); null = açık. */
  blockReason: string | null;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(canBuy && !blockReason ? autoOpenId : null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useCredit, setUseCredit] = useState(false);
  const reason = !canBuy ? "Kontör paketini yalnızca ofis sahibi veya genel müdür satın alabilir." : blockReason;

  async function buy(p: KontorPackCard) {
    if (pending || reason) return;
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("pack_id", p.id);
    fd.set("confirm_try", String(p.totalTry));
    if (useCredit && wallet) fd.set("use_credit", "1");
    try {
      const result = await startCreditPackPurchase(fd);
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      setError(result.error ?? "Ödeme başlatılamadı.");
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    }
    setPending(false);
  }

  return (
    <div className="space-y-3">
      {reason ? (
        <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-medium text-warning-strong">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> {reason}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {packs.map((p) => {
          const open = confirmId === p.id;
          return (
            <div
              key={p.id}
              className={`rounded-[var(--radius-card)] p-4 ${p.popular ? "bg-surface-accent-soft ring-1 ring-[var(--accent)]" : "bg-[var(--surface-sunken)]"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-control)] bg-surface-accent-soft text-accent-text">
                  <Coins className="h-4.5 w-4.5" />
                </span>
                <span className="flex flex-wrap justify-end gap-1">
                  {p.popular ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold text-white">
                      <Star className="h-3 w-3" /> Popüler
                    </span>
                  ) : null}
                  {p.suggested && !p.popular ? (
                    <span className="rounded-full bg-mint-500/12 px-2 py-0.5 text-xs font-bold text-success-strong">Önerilen</span>
                  ) : null}
                </span>
              </div>
              <p className="mt-3 text-xs font-semibold text-text-muted">{p.name}</p>
              <p className="numeric font-display text-2xl font-extrabold text-text">
                {fmt.format(p.units)} <span className="text-sm font-semibold text-text-faint">kontör</span>
              </p>
              <p className="mt-1 text-xs font-semibold text-accent-text">
                {p.months} ay geçerli · aylık ~{fmt.format(Math.round(p.units / p.months))} kontör
              </p>
              <p className="numeric mt-1 text-sm font-bold text-text">
                {tl(p.netTry)} <span className="text-xs font-semibold text-text-faint">+ KDV</span>
              </p>
              <p className="numeric text-xs text-text-muted">
                KDV dahil {tl2(p.totalTry)} · kontör başı {tl2(p.unitNetTry)} (KDV hariç)
              </p>
              {open ? (
                <div className="mt-3 space-y-2 rounded-[var(--radius-control)] border border-line bg-surface p-3 text-xs">
                  <p className="font-semibold text-text">
                    {fmt.format(p.units)} kontör için {tl2(p.totalTry)} (KDV dahil) ödeyeceksiniz.
                  </p>
                  <p className="text-text-muted">
                    Net {tl2(p.netTry)} + KDV {tl2(p.taxTry)}. Ödeme iyzico güvenli sayfasında alınır; ödeme onaylanınca kontör
                    bakiyenize eklenir ve {p.months} ay sonra kullanılmayan kısmı yanar (devretmez).
                  </p>
                  <WalletCreditToggle
                    wallet={wallet}
                    checked={useCredit}
                    onChange={setUseCredit}
                    totalTry={p.totalTry}
                    disabled={pending}
                    idPrefix={`pack-${p.id}`}
                  />
                  {error ? <p role="alert" className="font-semibold text-danger-600">{error}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => buy(p)}
                      className="focus-ring press inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-3 py-1.5 font-semibold text-white disabled:opacity-60"
                    >
                      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Onayla ve öde
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setConfirmId(null);
                        setError(null);
                      }}
                      className="focus-ring press min-h-9 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-1.5 font-semibold text-text disabled:opacity-60"
                    >
                      Vazgeç
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={Boolean(reason)}
                  onClick={() => {
                    setError(null);
                    setConfirmId(p.id);
                  }}
                  className="focus-ring press mt-3 min-h-9 w-full rounded-[var(--radius-control)] bg-ink-950 px-3 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Satın al
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
