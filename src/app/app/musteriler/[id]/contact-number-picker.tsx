"use client";

import { ChevronDown, MessageCircle, PhoneCall } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatTurkishPhone, toTelHref } from "@/lib/phone";
import { buildWhatsAppLink } from "@/lib/whatsapp-link";
import type { PhoneChoice } from "@/lib/customer-contacts";

const rowBtn =
  "focus-ring press inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-xs font-semibold text-ink-950 transition hover:border-brand-300 hover:text-brand-700 touch:h-11";

/**
 * Hero "Numara seç" (CRM-G7): müşterinin birden çok numarası varsa hangi numaradan arayacağınızı / WhatsApp'tan
 * yazacağınızı seçtirir. Tek numarada çizilmez (hero'daki Ara/WhatsApp doğrudan çalışır).
 */
export function ContactNumberPicker({ choices, greeting }: { choices: PhoneChoice[]; greeting: string }) {
  if (choices.length < 2) return null;
  return (
    <Popover>
      <PopoverTrigger
        className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10 touch:min-h-11"
        aria-label={`Numara seç (${choices.length} numara)`}
      >
        <PhoneCall className="h-4 w-4" aria-hidden /> {choices.length} numara <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-2">
        <p className="px-2 pb-1 pt-1 text-xs font-semibold text-text-muted">Hangi numarayı kullanacaksınız?</p>
        <ul className="divide-y divide-line">
          {choices.map((c) => {
            const tel = toTelHref(c.value);
            const wa = buildWhatsAppLink(c.value, greeting);
            return (
              <li key={c.value} className="flex flex-wrap items-center gap-2 px-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold tabular-nums text-ink-950">{formatTurkishPhone(c.value)}</p>
                  <p className="text-xs text-text-faint">{c.label}</p>
                </div>
                {tel ? (
                  <a href={tel} className={rowBtn} aria-label={`${formatTurkishPhone(c.value)} numarasını ara`}>
                    <PhoneCall className="h-3.5 w-3.5" aria-hidden /> Ara
                  </a>
                ) : null}
                {wa ? (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className={rowBtn} aria-label={`${formatTurkishPhone(c.value)} numarasına WhatsApp'tan yaz (yeni sekmede açılır)`}>
                    <MessageCircle className={`h-3.5 w-3.5 ${c.whatsapp ? "text-mint-600" : ""}`} aria-hidden /> WhatsApp
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
