"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowRight, Check, Copy, FileText, Info, KeyRound, PartyPopper, Star, X } from "lucide-react";
import { SmsDialog } from "@/app/app/gelen-kutusu/sms-dialog";
import { createSurveyForDeal } from "@/app/actions/surveys";
import type { BoardDeal } from "./deal-board";

/**
 * Kazanma sihirbazı — anlaşma "Kazanıldı"ya İLK taşındığında (buton veya DnD)
 * toast yerine açılan küçük kutlama dialogu + sonraki adımlar listesi.
 *
 * - Konfeti: 9 parça, 600ms, CSS keyframes bileşen içi <style> ile (globals'a
 *   sınıf eklenmez). Parçalar taban durumda opacity-0; animasyon yalnız
 *   prefers-reduced-motion: no-preference'ta çalışır — azaltılmış harekette
 *   konfeti hiç görünmez.
 * - Optimistic akışı bozmaz: server onayı beklenmeden açılır; hata durumunda
 *   deal-board mevcut geri sarmayı yapar ve bu dialogu kapatır.
 */

// Deterministik konfeti parçaları — render'da Math.random yok (React Compiler saflığı)
const CONFETTI: { left: string; delay: string; color: string; height: string }[] = [
  { left: "8%", delay: "0ms", color: "var(--mint-500)", height: "10px" },
  { left: "19%", delay: "60ms", color: "var(--brand-600)", height: "8px" },
  { left: "31%", delay: "120ms", color: "var(--amber-500)", height: "9px" },
  { left: "43%", delay: "30ms", color: "var(--brand-400)", height: "8px" },
  { left: "55%", delay: "90ms", color: "var(--mint-400)", height: "10px" },
  { left: "66%", delay: "150ms", color: "var(--amber-400)", height: "8px" },
  { left: "77%", delay: "45ms", color: "var(--brand-600)", height: "9px" },
  { left: "87%", delay: "110ms", color: "var(--mint-500)", height: "8px" },
  { left: "94%", delay: "75ms", color: "var(--amber-500)", height: "10px" },
];

/**
 * Memnuniyet anketi adımı — mevcut `createSurveyForDeal` action'ı yeniden
 * kullanılır (yeni action yazılmadı). Action SMS GÖNDERMEZ (İYS kapsam dışı):
 * link burada üretilip kopyalanır, danışmana bildirim düşer. unique(deal_id)
 * ihlali "zaten oluşturulmuş" mesajıyla döner.
 */
function SurveyStep({ dealId }: { dealId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const create = () => {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("deal_id", dealId);
      const res = await createSurveyForDeal(fd);
      if (res.error || !res.url) setError(res.error ?? "Anket oluşturulamadı.");
      else setUrl(res.url);
    });
  };

  if (url) {
    return (
      <div className="rounded-[12px] border border-amber-400/40 bg-amber-400/5 px-3 py-2.5">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink-950">
          <Star className="h-4 w-4 text-amber-500" /> Anket linki hazır
        </p>
        <p className="numeric mt-1.5 select-all break-all rounded-[8px] border border-line bg-canvas px-2 py-1.5 text-[11px] text-ink-950">
          {url}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                setError("Panoya kopyalanamadı — linki elle seçip kopyalayın.");
              }
            }}
            className="focus-ring press inline-flex items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-ink-950 hover:bg-canvas"
          >
            {copied ? <Check className="h-3 w-3 text-mint-600" /> : <Copy className="h-3 w-3" />}
            {copied ? "Kopyalandı" : "Linki kopyala"}
          </button>
          <Link href="/app/raporlar/memnuniyet" className="text-[11px] font-semibold text-brand-600 hover:underline">
            Anketler →
          </Link>
        </div>
        {error ? <p className="mt-2 text-[11px] font-semibold text-danger-500">{error}</p> : null}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={create}
        disabled={pending}
        className="focus-ring group flex w-full items-center gap-3 rounded-[12px] border border-line bg-canvas px-3 py-2.5 text-left transition hover:border-amber-400/50 hover:bg-surface disabled:opacity-60"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-400/15 text-amber-600">
          <Star className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink-950">
            {pending ? "Anket oluşturuluyor…" : "Memnuniyet anketi gönder"}
          </span>
          <span className="block text-[11px] text-text-muted">Link üretilir, müşteriye siz iletirsiniz</span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-text-faint transition group-hover:text-amber-600" />
      </button>
      {error ? <p className="px-1 text-[11px] font-semibold text-danger-500">{error}</p> : null}
    </>
  );
}

export function WinCelebrationDialog({
  deal,
  onClose,
}: {
  deal: BoardDeal;
  onClose: () => void;
}) {
  const title = deal.property_title ?? deal.property_code ?? "Anlaşma";
  const isRent = deal.deal_type === "rent";
  const contractHref = `/app/sozlesmeler?customer=${deal.customer_id ?? ""}&property=${deal.property_id ?? ""}&tur=${isRent ? "kira" : "satis"}`;
  /*
   * Kira anlaşmasında sözleşme taslağı YETMEZ: kira takibi (aylık tahakkuk,
   * vade, artış, bakım) /app/kiralama kaydına bağlıdır ve o kayıt sıfırdan
   * portföy/kiracı/kira/vade istiyordu. Köprü: kazanılan anlaşmanın portföyü,
   * müşterisi ve değeri ön dolgu olarak taşınır.
   */
  const rentalHref = (() => {
    const q = new URLSearchParams();
    if (deal.property_id) q.set("portfoy", deal.property_id);
    if (deal.customer_id) q.set("musteri", deal.customer_id);
    if (deal.deal_value != null && deal.deal_value > 0) q.set("tutar", String(Math.round(deal.deal_value)));
    const s = q.toString();
    return s ? `/app/kiralama?${s}` : "/app/kiralama";
  })();
  const smsText = `Sayın ${deal.customer_name ?? "müşterimiz"}, ${title} için anlaşmanız tamamlandı. Hayırlı olsun! 🎉 Sürecin kalanında yanınızdayız.`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/40 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Anlaşma kazanıldı"
        className="relative w-full max-w-sm overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Tek seferlik ölçülü konfeti — yalnız hareket tercihi açık kullanıcıda */}
        <style>{`
          @media (prefers-reduced-motion: no-preference) {
            @keyframes es-win-confetti {
              0% { transform: translateY(-12px) rotate(0deg); opacity: 1; }
              100% { transform: translateY(96px) rotate(210deg); opacity: 0; }
            }
            .es-win-confetti { animation: es-win-confetti 600ms ease-out forwards; }
          }
        `}</style>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28">
          {CONFETTI.map((p) => (
            <span
              key={p.left}
              className="es-win-confetti absolute top-0 w-1.5 rounded-[2px] opacity-0"
              style={{ left: p.left, height: p.height, backgroundColor: p.color, animationDelay: p.delay }}
            />
          ))}
        </div>

        <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-mint-500/12 text-mint-600">
              <PartyPopper className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-lg font-bold text-ink-950">✅ Anlaşma kazanıldı!</h2>
              <p className="text-xs text-text-muted">
                {title}
                {deal.customer_name ? ` · ${deal.customer_name}` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-text-muted hover:bg-canvas"
            aria-label="Kapat"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-2.5 p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-faint">Sonraki adımlar</p>

          {/* a) Komisyon — updateDealStage won'a ilk geçişte portföy bağlıysa otomatik üretir */}
          {deal.property_id ? (
            <Link
              href="/app/komisyon"
              className="focus-ring group flex items-center gap-3 rounded-[12px] border border-mint-500/30 bg-mint-500/5 px-3 py-2.5 transition hover:border-mint-500/50"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-mint-500/15 text-mint-600">
                <Check className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink-950">Komisyon kaydı oluşturuldu ✓</span>
                <span className="block text-[11px] text-text-muted">Tutarı ve paylaşımı kontrol edin</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-text-faint transition group-hover:text-mint-600" />
            </Link>
          ) : (
            <div className="flex items-center gap-3 rounded-[12px] border border-line bg-canvas px-3 py-2.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-400/15 text-amber-600">
                <Info className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 text-[11px] text-text-muted">
                Portföy bağlı olmadığı için komisyon otomatik oluşmadı —{" "}
                <Link href="/app/komisyon" className="font-semibold text-brand-600 hover:underline">
                  komisyon sayfasından
                </Link>{" "}
                elle ekleyebilirsiniz.
              </span>
            </div>
          )}

          {/* b) Sözleşme taslağı — müşteri/portföy/tür ön dolgulu */}
          <Link
            href={contractHref}
            className="focus-ring group flex items-center gap-3 rounded-[12px] border border-line bg-canvas px-3 py-2.5 transition hover:border-brand-300 hover:bg-surface"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-600/10 text-brand-600">
              <FileText className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold text-ink-950">Sözleşme taslağı oluştur</span>
            <ArrowRight className="h-4 w-4 shrink-0 text-text-faint transition group-hover:text-brand-600" />
          </Link>

          {/* b2) Kira anlaşmasıysa kira kaydı — tahakkuk/vade/artış takibi buradan başlar */}
          {isRent ? (
            <Link
              href={rentalHref}
              className="focus-ring group flex items-center gap-3 rounded-[12px] border border-cyan-400/35 bg-cyan-400/5 px-3 py-2.5 transition hover:border-cyan-400/60"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-cyan-400/15 text-cyan-600">
                <KeyRound className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink-950">Kira sözleşmesi oluştur</span>
                <span className="block text-[11px] text-text-muted">
                  Portföy, kiracı ve kira tutarı ön dolgulu gelir — vade gününü seçin
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-text-faint transition group-hover:text-cyan-600" />
            </Link>
          ) : null}

          {/* c) Tebrik SMS'i — yalnız telefonu olan müşteride; İYS kapısı SmsDialog içinde */}
          {deal.customer_id && deal.customer_phone ? (
            <SmsDialog
              customerId={deal.customer_id}
              customerName={deal.customer_name ?? "Müşteri"}
              consentGranted={deal.sms_consent}
              initialMessage={smsText}
              trigger={
                <button
                  type="button"
                  className="focus-ring group flex w-full items-center gap-3 rounded-[12px] border border-line bg-canvas px-3 py-2.5 text-left transition hover:border-brand-300 hover:bg-surface"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-cyan-500/10 text-cyan-600">
                    <span className="text-sm" aria-hidden>💬</span>
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-semibold text-ink-950">Tebrik SMS&apos;i gönder</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-text-faint transition group-hover:text-brand-600" />
                </button>
              }
            />
          ) : null}

          {/* d) Memnuniyet anketi — yalnız müşterisi bağlı anlaşmada
                 (createSurveyForDeal müşterisiz anlaşmayı reddeder) */}
          {deal.customer_id ? <SurveyStep dealId={deal.id} /> : null}

          {/* e) Kapat */}
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[10px] border border-line px-4 py-2.5 text-sm font-semibold text-text-muted transition hover:bg-canvas"
            >
              Kapat
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
