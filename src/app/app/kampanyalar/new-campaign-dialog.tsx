"use client";

import { useActionState, useTransition, useState } from "react";
import { Plus, MessageSquare, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createCampaign, type CampaignResult } from "@/app/actions/campaigns";
import { CAMPAIGN_TEMPLATES } from "@/lib/campaign-templates";

const FILTERS = [
  { value: "all",         label: "Tüm müşteriler" },
  { value: "type:alici",  label: "Sadece alıcılar" },
  { value: "type:satici", label: "Sadece satıcılar" },
  { value: "type:kira",   label: "Sadece kiracılar" },
];

const init: CampaignResult = {};

export function NewCampaignDialog() {
  const [open, setOpen] = useState(false);
  // action kullanılmıyor: form handleSubmit içinde createCampaign'i doğrudan
  // çağırıyor; useActionState burada yalnızca `state` için duruyor.
  const [state] = useActionState(createCampaign, init);
  const [, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const charCount = message.length;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createCampaign(init, fd);
      if (result.ok) setOpen(false);
    });
  }

  // Not: burada `trigger === "button" ? A : B` şeklinde bir üçlü vardı ama
  // A ve B BİREBİR AYNIYDI — yani `trigger` prop'u hiçbir şey yapmıyordu.
  // Yanıltıcı API kaldırıldı. Açma işini artık DialogTrigger üstleniyor,
  // ayrıca onClick de gerekmiyor.
  const triggerBtn = (
    <button
      type="button"
      className="focus-ring press inline-flex items-center gap-2 rounded-[12px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
    >
      <Plus className="h-4 w-4" /> Yeni kampanya
    </button>
  );

  return (
    /* Radix Dialog: focus trap + Esc (öncesinde yoktu) + scroll lock + ARIA.
       Düz başlık DialogHeader'a geçince gradient başlık + açıklama kazandı. */
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{triggerBtn}</DialogTrigger>

      <DialogContent size="md">
        <DialogHeader
          icon={<MessageSquare />}
          title="Yeni kampanya"
          description="SMS veya WhatsApp ile müşteri listenize toplu mesaj gönderin."
        />
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
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
                  <option value="email">E-posta</option>
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

              {/* Hazır şablonlar */}
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-ink-950">
                  <Sparkles className="h-3.5 w-3.5 text-brand-600" /> Hazır şablon
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {CAMPAIGN_TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setMessage(t.message)}
                      className="rounded-full border border-line bg-canvas px-2.5 py-1 text-[11px] font-medium text-text-muted transition hover:border-brand-400 hover:text-brand-600"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
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
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Mesajınızı buraya yazın… ({ad} ve {ofis} otomatik değişir)"
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

              {/* Palet dışı red-50/red-600 yerine danger tonları */}
              {state?.error && (
                <p className="rounded-[8px] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
                  {state.error}
                </p>
              )}

              <div className="hairline-t flex justify-end gap-2 pt-4">
                <DialogClose asChild>
                  <button
                    type="button"
                    className="focus-ring press rounded-[10px] border border-hairline px-4 py-2 text-sm font-semibold text-text-muted transition hover:bg-canvas"
                  >
                    Vazgeç
                  </button>
                </DialogClose>
                <button
                  type="submit"
                  className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" /> Kampanya oluştur
                </button>
              </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
