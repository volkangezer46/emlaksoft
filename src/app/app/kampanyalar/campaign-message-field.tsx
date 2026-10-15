"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { fieldClass } from "@/components/ui/form-controls";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/filter-chip";
import { SmsCounter } from "@/components/app/sms-counter";
import { simplifyForSms } from "@/lib/messaging/sms-segments";
import {
  CAMPAIGN_VARIABLE_HELP,
  recipientVars,
  renderCampaignMessage,
  unknownPlaceholders,
} from "@/lib/campaign-personalize";

/** Önizleme bağlamı: ofis bilgisi (sunucuda hazırlanır) + örnek alıcılar (İYS önizlemesinden) + danışman adları. */
export type CampaignPreviewContext = {
  officeName: string;
  officePhone: string;
  portfolioUrl: string;
  /** Sorumlu danışmanı olmayan alıcıda {danisman} yerine geçen ad (kampanyayı oluşturan kullanıcı). */
  userName: string;
  advisorNames: Record<string, string>;
};

export type CampaignPreviewSample = { name: string; advisorId: string | null };

const FALLBACK_SAMPLE: CampaignPreviewSample = { name: "Ayşe Yılmaz", advisorId: null };

/**
 * Kampanya mesaj alanı: yer tutucu çipleri (imlecin olduğu yere ekler), SMS kredi sayacı (en uzun alıcı adıyla),
 * tanınmayan alan uyarısı ve ALICI BAZLI önizleme (‹ › ile örnek alıcılar arasında gezinilir). Gönderimde aynı
 * `renderCampaignMessage` teslimat işçisinde çalışır (`src/lib/campaign-delivery.ts`).
 */
export function CampaignMessageField({
  id,
  name = "message",
  channel,
  value,
  onChange,
  required,
  placeholder,
  context,
  samples,
  longestName,
}: {
  id: string;
  name?: string;
  channel: "sms" | "whatsapp";
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
  placeholder?: string;
  context: CampaignPreviewContext;
  samples?: CampaignPreviewSample[] | null;
  longestName?: string | null;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [idx, setIdx] = useState(0);
  const list = samples && samples.length > 0 ? samples : [FALLBACK_SAMPLE];
  const current = list[Math.min(idx, list.length - 1)]!;
  const office = {
    name: context.officeName,
    phone: context.officePhone,
    portfolioUrl: context.portfolioUrl,
    fallbackAdvisor: context.userName,
  };
  const varsFor = (s: CampaignPreviewSample) =>
    recipientVars({ fullName: s.name, advisorName: s.advisorId ? context.advisorNames[s.advisorId] : null }, office);
  const rendered = renderCampaignMessage(value, varsFor(current));
  const longest = longestName && longestName.length > current.name.length ? longestName : current.name;
  const measured = renderCampaignMessage(value, varsFor({ name: longest, advisorId: current.advisorId }));
  const unknown = unknownPlaceholders(value);
  const usesFields = rendered !== value;

  function insert(token: string) {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`.slice(0, 612);
    onChange(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = Math.min(start + token.length, next.length);
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Kişiselleştirme alanı ekle">
        <span className="text-xs font-semibold text-text-muted">Alan ekle:</span>
        {CAMPAIGN_VARIABLE_HELP.map((v) => (
          <FilterChip key={v.key} type="button" onClick={() => insert(v.token)} title={v.token}>
            + {v.label}
          </FilterChip>
        ))}
      </div>
      <textarea
        ref={ref}
        id={id}
        aria-label={channel === "sms" ? "Mesaj metni" : "Şablon gövde parametresi"}
        name={name}
        required={required}
        rows={5}
        maxLength={612}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${fieldClass} resize-y`}
      />
      {unknown.length > 0 ? (
        <p className="text-xs font-semibold text-danger-600" role="alert">
          Tanınmayan alan: {unknown.join(", ")}. Yukarıdaki düğmelerle ekleyin.
        </p>
      ) : null}
      {channel === "sms" ? <SmsCounter text={rendered} measureText={measured} onSimplify={() => onChange(simplifyForSms(value))} /> : null}
      {value.trim() ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-text-muted">
              <Eye className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {usesFields ? `${current.name} için önizleme` : "Önizleme"}
                {samples && samples.length > 0 ? "" : usesFields ? " (örnek ad)" : ""}
              </span>
            </p>
            {usesFields && list.length > 1 ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="icon" icon={ChevronLeft} onClick={() => setIdx((i) => (i - 1 + list.length) % list.length)} aria-label="Önceki alıcı" />
                <span className="numeric text-xs text-text-faint">
                  {Math.min(idx, list.length - 1) + 1}/{list.length}
                </span>
                <Button variant="ghost" size="icon" icon={ChevronRight} onClick={() => setIdx((i) => (i + 1) % list.length)} aria-label="Sonraki alıcı" />
              </div>
            ) : null}
          </div>
          <p className="mt-1.5 whitespace-pre-line break-words text-sm leading-relaxed text-ink-950">{rendered}</p>
        </div>
      ) : null}
    </div>
  );
}
