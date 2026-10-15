"use client";

import { useState, useTransition } from "react";
import { MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/filter-chip";
import { useToast } from "@/components/app/toast-provider";
import { updateCustomerContactPrefs } from "@/app/actions/customer-contact-prefs";
import {
  CONTACT_CHANNELS,
  CONTACT_CHANNEL_LABELS,
  CONTACT_LANGUAGES,
  CONTACT_WINDOWS,
  CONTACT_WINDOW_LABELS,
  contactPrefsSummary,
  type ContactChannel,
  type ContactPrefs,
  type ContactWindow,
} from "@/lib/customer-contact-prefs";

/**
 * İletişim tercihi kartı (CRM-G11): tercih edilen kanal (tek seçim), uygun zaman dilimleri (çoklu) ve dil.
 * `available=false`: sütunlar henüz yok (migration bekliyor) — kart açıkça "kurulum bekliyor" der, tercih uydurmaz.
 * Kaydedilen tercih künyedeki rozete ve "Sonraki en iyi eylem"in birincil düğmesine yansır.
 */
export function ContactPrefsCard({
  customerId,
  initial,
  available,
  canEdit,
}: {
  customerId: string;
  initial: ContactPrefs;
  available: boolean;
  canEdit: boolean;
}) {
  const { push } = useToast();
  const [prefs, setPrefs] = useState<ContactPrefs>(initial);
  const [saved, setSaved] = useState<ContactPrefs>(initial);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(prefs) !== JSON.stringify(saved);
  const editable = available && canEdit;

  function toggleWindow(w: ContactWindow) {
    setPrefs((p) => {
      const has = p.windows.includes(w);
      const next = has ? p.windows.filter((x) => x !== w) : [...p.windows, w];
      return { ...p, windows: CONTACT_WINDOWS.filter((x) => next.includes(x)) };
    });
  }

  function setChannel(c: ContactChannel) {
    setPrefs((p) => ({ ...p, channel: p.channel === c ? null : c }));
  }

  function save() {
    startTransition(async () => {
      const res = await updateCustomerContactPrefs(customerId, prefs);
      if (!res.ok) {
        push(res.error, "err");
        return;
      }
      setPrefs(res.prefs);
      setSaved(res.prefs);
      push("İletişim tercihi kaydedildi", "ok");
    });
  }

  const summary = contactPrefsSummary(saved);

  return (
    <section
      id="iletisim-tercihi"
      aria-labelledby="iletisim-tercihi-baslik"
      className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]"
    >
      <h2 id="iletisim-tercihi-baslik" className="flex items-center gap-2 font-display font-bold text-ink-950">
        <MessagesSquare className="h-4 w-4 text-brand-600" aria-hidden /> İletişim tercihi
      </h2>
      <p className="mt-1 text-xs text-text-muted">
        {available
          ? summary
            ? `Kayıtlı tercih: ${summary}.`
            : "Müşterinin nasıl ve ne zaman ulaşılmak istediğini kaydedin; öneriler buna göre değişir."
          : "Bu özellik için veritabanı güncellemesi bekleniyor; tercih henüz kaydedilemez."}
      </p>

      {available ? (
        <div className="mt-4 space-y-4">
          <fieldset>
            <legend className="text-xs font-semibold text-text-muted">Tercih edilen kanal</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {CONTACT_CHANNELS.map((c) => (
                <FilterChip key={c} active={prefs.channel === c} disabled={!editable || pending} onClick={() => setChannel(c)}>
                  {CONTACT_CHANNEL_LABELS[c]}
                </FilterChip>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-xs font-semibold text-text-muted">Uygun zaman (birden çok seçilebilir)</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {CONTACT_WINDOWS.map((w) => (
                <FilterChip key={w} active={prefs.windows.includes(w)} disabled={!editable || pending} onClick={() => toggleWindow(w)}>
                  {CONTACT_WINDOW_LABELS[w]}
                </FilterChip>
              ))}
            </div>
          </fieldset>

          <label className="block text-xs font-semibold text-text-muted">
            İletişim dili
            <select
              value={prefs.language ?? ""}
              disabled={!editable || pending}
              onChange={(e) => setPrefs((p) => ({ ...p, language: e.target.value || null }))}
              className="focus-ring mt-1.5 block w-full max-w-xs rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm font-semibold text-ink-950 touch:min-h-11 touch:text-base"
            >
              <option value="">Belirtilmedi (Türkçe)</option>
              {CONTACT_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>

          {editable ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={save} loading={pending} disabled={!dirty || pending}>
                {pending ? "Kaydediliyor…" : "Tercihi kaydet"}
              </Button>
              {dirty && !pending ? (
                <Button size="sm" variant="ghost" onClick={() => setPrefs(saved)}>
                  Vazgeç
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-text-faint">Tercihi değiştirmek için müşteri düzenleme yetkisi gerekir.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
