"use client";

import { SMS_ENCODING_LABEL, SMS_MAX_SEGMENTS, simplifyForSms, smsInfo } from "@/lib/messaging/sms-segments";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * SMS karakter / kredi sayacı (TEK bileşen: kampanya formu, taslak düzenleme, gelen kutusu SMS yanıtı).
 * Hesap `src/lib/messaging/sms-segments.ts`: GSM-7 160/153, Türkçe karakterli 155/149 (Netgsm `dil="TR"`), Unicode 70/67.
 * `measureText` verilirse kredi o metinle (ör. en uzun alıcı adıyla doldurulmuş kampanya mesajı) hesaplanır.
 * `onSimplify` verilirse metni Unicode'a düşüren karakter (akıllı tırnak, uzun tire, â/î/û) için tek tık düzeltme önerilir;
 * çağıran kendi ham metnine `simplifyForSms` uygular (kampanyada yer tutucular korunur).
 */
export function SmsCounter({
  text,
  measureText,
  onSimplify,
  className,
}: {
  text: string;
  measureText?: string;
  onSimplify?: () => void;
  className?: string;
}) {
  const info = smsInfo(measureText ?? text);
  if (!text) {
    return <p className={cn("text-xs text-text-faint", className)}>Mesaj yazıldığında SMS kredisi burada hesaplanır.</p>;
  }
  const over = info.segments > SMS_MAX_SEGMENTS;
  const simplified = info.encoding === "ucs2" ? simplifyForSms(text) : text;
  const canSimplify = Boolean(onSimplify) && simplified !== text && smsInfo(simplified).encoding !== "ucs2";
  const perSms = info.segments <= 1 ? info.singleLimit : info.multiLimit;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs", className)} aria-live="polite">
      <span
        className={cn(
          "rounded-full px-2 py-0.5 font-semibold",
          info.encoding === "gsm7" && "bg-ink-950/5 text-text-muted",
          info.encoding === "tr" && "bg-cyan-500/12 text-cyan-700",
          info.encoding === "ucs2" && "bg-amber-400/15 text-amber-700",
        )}
      >
        {SMS_ENCODING_LABEL[info.encoding]} · {perSms}/SMS
      </span>
      <span className={cn("numeric", over ? "font-semibold text-danger-600" : info.segments > 1 ? "text-amber-700" : "text-text-muted")}>
        {info.units.toLocaleString("tr-TR")} karakter · {info.segments} SMS kredisi
        {info.segments >= 1 && !over ? ` · bu parçada ${info.remainingInSegment} kaldı` : ""}
        {measureText !== undefined && measureText !== text ? " (en uzun adla)" : ""}
      </span>
      {over ? <span className="font-semibold text-danger-600">En fazla {SMS_MAX_SEGMENTS} SMS olabilir.</span> : null}
      {canSimplify ? (
        <Button variant="ghost" size="xs" onClick={() => onSimplify?.()} className="text-brand-600">
          Özel karakterleri sadeleştir ({info.singleLimit} → {smsInfo(simplified).singleLimit} karakter/SMS)
        </Button>
      ) : null}
    </div>
  );
}
