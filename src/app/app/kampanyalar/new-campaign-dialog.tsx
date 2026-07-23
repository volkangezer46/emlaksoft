"use client";

import { useActionState, useTransition, useState } from "react";
import { Plus, MessageSquare, X } from "lucide-react";
import { createCampaign, type CampaignResult } from "@/app/actions/campaigns";

const FILTERS = [
  { value: "all",         label: "Tüm müşteriler" },
  { value: "type:alici",  label: "Sadece alıcılar" },
  { value: "type:satici", label: "Sadece satıcılar" },
  { value: "type:kira",   label: "Sadece kiracılar" },
];

const init: CampaignResult = {};

export function NewCampaignDialog({ trigger }: { trigger?: "button" | "icon" } = {}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(createCampaign, init);
  const [, startTransition] = useTransition();
  const [charCount, setCharCount] = useState(0);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createCampaign(init, fd);
      if (result.ok) setOpen(false);
    });
  }

  const triggerBtn =
    trigger === "button" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-[12px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
      >
        <Plus className="h-4 w-4" /> Yeni kampanya
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-[12px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
      >
        <Plus className="h-4 w-4" /> Yeni kampanya
      </button>
    );

  return (
    <>
      {triggerBtn}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Kapat"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm"
          />
          <div className="relative w-full max-w-lg rounded-[20px] border border-line bg-surface p-6 shadow-[var(--shadow-xl)]">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-brand-600/10 text-brand-600">
                  <MessageSquare className="h-4 w-4" />
                </span>
                <h2 className="font-display text-lg font-bold text-ink-950">Yeni Kampanya</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-[8px] text-text-muted transition hover:bg-canvas hover:text-ink-950"
                aria-label="Kapat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Başlık */}
              <div>
                <label htmlFor="kamp-title" className="mb-1.5 block text-sm font-semibold text-ink-950">
                  Kampanya başlığı
                </label>
                <input
                  id="kamp-title"
                  name="title"
                  type="text"
                  required
                  placeholder="ör. Temmuz Fırsat Kampanyası"
                  className="w-full rounded-[10px] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-300"
                />
              </div>

              {/* Kanal */}
              <div>
                <label htmlFor="kamp-channel" className="mb-1.5 block text-sm font-semibold text-ink-950">
                  Kanal
                </label>
                <select
                  id="kamp-channel"
                  name="channel"
                  defaultValue="sms"
                  className="w-full appearance-none rounded-[10px] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-300"
                >
                  <option value="sms">SMS (Netgsm)</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
              </div>

              {/* Hedef kitle */}
              <div>
                <label htmlFor="kamp-filter" className="mb-1.5 block text-sm font-semibold text-ink-950">
                  Hedef kitle
                </label>
                <select
                  id="kamp-filter"
                  name="filter"
                  defaultValue="all"
                  className="w-full appearance-none rounded-[10px] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-300"
                >
                  {FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>

              {/* Mesaj */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="kamp-message" className="text-sm font-semibold text-ink-950">
                    Mesaj metni
                  </label>
                  <span className={`text-xs ${charCount > 160 ? "text-amber-600" : "text-text-faint"}`}>
                    {charCount}/612 karakter
                  </span>
                </div>
                <textarea
                  id="kamp-message"
                  name="message"
                  required
                  rows={4}
                  maxLength={612}
                  onChange={(e) => setCharCount(e.target.value.length)}
                  placeholder="Mesajınızı buraya yazın…"
                  className="w-full resize-none rounded-[10px] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-300"
                />
                {charCount > 0 && charCount <= 160 && (
                  <p className="mt-1 text-[11px] text-text-faint">1 SMS kredisi kullanılacak</p>
                )}
                {charCount > 160 && (
                  <p className="mt-1 text-[11px] text-amber-600">
                    {Math.ceil(charCount / 153)} SMS kredisi kullanılacak (uzun mesaj)
                  </p>
                )}
              </div>

              {state?.error && (
                <p className="rounded-[8px] bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-[10px] border border-line px-4 py-2 text-sm font-semibold text-text-muted transition hover:bg-canvas"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" /> Kampanya oluştur
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
