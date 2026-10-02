"use client";

import { useTransition, useState } from "react";
import { Plus, MessageSquare, RefreshCw, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  createCampaign,
  listApprovedWhatsAppTemplates,
  type CampaignResult,
} from "@/app/actions/campaigns";
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
  const [state, setState] = useState<CampaignResult>(init);
  const [isPending, startTransition] = useTransition();
  const [templatesPending, startTemplatesTransition] = useTransition();
  const [channel, setChannel] = useState<"sms" | "whatsapp">("sms");
  const [message, setMessage] = useState("");
  const [whatsappTemplateName, setWhatsAppTemplateName] = useState("");
  const [whatsappTemplateLanguage, setWhatsAppTemplateLanguage] = useState("tr");
  const [approvedTemplates, setApprovedTemplates] = useState<Array<{ name: string; language: string }>>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const charCount = message.length;

  function loadApprovedTemplates(force = false) {
    if (templatesPending || (templatesLoaded && !force)) return;
    setTemplatesError(null);
    startTemplatesTransition(async () => {
      const result = await listApprovedWhatsAppTemplates();
      setTemplatesLoaded(true);
      if (!result.ok) {
        setApprovedTemplates([]);
        setTemplatesError(result.error);
        return;
      }
      setApprovedTemplates(result.templates);
      setTemplatesError(null);
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createCampaign(init, fd);
      setState(result);
      if (result.ok) {
        setChannel("sms");
        setMessage("");
        setWhatsAppTemplateName("");
        setWhatsAppTemplateLanguage("tr");
        setOpen(false);
      }
    });
  }

  // Not: burada `trigger === "button" ? A : B` şeklinde bir üçlü vardı ama
  // A ve B BİREBİR AYNIYDI — yani `trigger` prop'u hiçbir şey yapmıyordu.
  // Yanıltıcı API kaldırıldı. Açma işini artık DialogTrigger üstleniyor,
  // ayrıca onClick de gerekmiyor.
  const triggerBtn = (
    <button
      type="button"
      className="focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-card)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
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
          description="SMS veya WhatsApp kampanyasını hazırlayın; yalnız açık kanal izni olan alıcılara teslim edilir."
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
                  className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-300"
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
                  value={channel}
                  onChange={(event) => {
                    const nextChannel = event.target.value as "sms" | "whatsapp";
                    setChannel(nextChannel);
                    setMessage("");
                    setState(init);
                    if (nextChannel === "whatsapp") loadApprovedTemplates();
                  }}
                  className="w-full appearance-none rounded-[var(--radius-control)] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-300"
                >
                  <option value="sms">SMS (Netgsm)</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email" disabled>E-posta (yakında)</option>
                </select>
                <p className="mt-1.5 text-xs text-text-faint">
                  WhatsApp kampanyaları yalnızca Meta tarafından onaylanmış mesaj şablonuyla gönderilir.
                </p>
              </div>

              {channel === "whatsapp" && (
                <div className="grid gap-3 rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3 sm:grid-cols-[1fr_120px]">
                  <div className="sm:col-span-2">
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <label htmlFor="kamp-approved-whatsapp-template" className="text-sm font-semibold text-ink-950">
                        Meta onaylı şablonlar
                      </label>
                      <button
                        type="button"
                        onClick={() => loadApprovedTemplates(true)}
                        disabled={templatesPending}
                        className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] px-2 py-1 text-xs font-semibold text-brand-600 transition hover:bg-brand-600/8 disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3 w-3 ${templatesPending ? "animate-spin" : ""}`} />
                        {templatesLoaded ? "Yenile" : "Meta'dan getir"}
                      </button>
                    </div>
                    <select
                      id="kamp-approved-whatsapp-template"
                      value=""
                      disabled={templatesPending || approvedTemplates.length === 0}
                      onChange={(event) => {
                        const selected = approvedTemplates.find(
                          (template) => `${template.name}:${template.language}` === event.target.value,
                        );
                        if (!selected) return;
                        setWhatsAppTemplateName(selected.name);
                        setWhatsAppTemplateLanguage(selected.language);
                      }}
                      className="w-full appearance-none rounded-[var(--radius-control)] border border-line bg-surface px-3.5 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-300 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">
                        {templatesPending
                          ? "Onaylı şablonlar yükleniyor…"
                          : approvedTemplates.length > 0
                            ? "Onaylı şablon seçin"
                            : "Onaylı şablon bulunamadı"}
                      </option>
                      {approvedTemplates.map((template) => (
                        <option
                          key={`${template.name}:${template.language}`}
                          value={`${template.name}:${template.language}`}
                        >
                          {template.name} · {template.language}
                        </option>
                      ))}
                    </select>
                    {templatesError ? (
                      <p className="mt-1.5 text-xs leading-relaxed text-amber-600" role="status">
                        {templatesError} Güvenli manuel giriş alanları kullanılabilir.
                      </p>
                    ) : templatesLoaded && approvedTemplates.length === 0 ? (
                      <p className="mt-1.5 text-xs leading-relaxed text-text-faint">
                        Hesapta onaylı şablon bulunamadı; Meta&apos;da onaylandıysa adı ve dili elle girin.
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label htmlFor="kamp-whatsapp-template" className="mb-1.5 block text-sm font-semibold text-ink-950">
                      Onaylı şablon adı
                    </label>
                    <input
                      id="kamp-whatsapp-template"
                      name="whatsappTemplateName"
                      type="text"
                      required
                      pattern="[a-z0-9_]{1,512}"
                      maxLength={512}
                      value={whatsappTemplateName}
                      onChange={(event) => setWhatsAppTemplateName(event.target.value)}
                      placeholder="örn. portfoy_duyurusu"
                      className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-3.5 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-300"
                    />
                  </div>
                  <div>
                    <label htmlFor="kamp-whatsapp-language" className="mb-1.5 block text-sm font-semibold text-ink-950">
                      Dil kodu
                    </label>
                    <input
                      id="kamp-whatsapp-language"
                      name="whatsappTemplateLanguage"
                      type="text"
                      required
                      pattern="[a-z]{2,3}(_[A-Z]{2})?"
                      maxLength={6}
                      value={whatsappTemplateLanguage}
                      onChange={(event) => setWhatsAppTemplateLanguage(event.target.value)}
                      placeholder="tr"
                      className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-3.5 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-300"
                    />
                  </div>
                  <p className="text-xs leading-relaxed text-text-faint sm:col-span-2">
                    Ad ve dil kodu Meta Business Manager&apos;daki onaylı şablonla birebir aynı olmalıdır. Onaysız veya uyuşmayan şablon gönderilmez.
                  </p>
                </div>
              )}

              {/* Hedef kitle */}
              <div>
                <label htmlFor="kamp-filter" className="mb-1.5 block text-sm font-semibold text-ink-950">
                  Hedef kitle
                </label>
                <select
                  id="kamp-filter"
                  name="filter"
                  defaultValue="all"
                  className="w-full appearance-none rounded-[var(--radius-control)] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-300"
                >
                  {FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>

              {/* Hazır SMS metinleri; WhatsApp serbest metne düşürülemez. */}
              {channel === "sms" && <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-ink-950">
                  <Sparkles className="h-3.5 w-3.5 text-brand-600" /> Hazır şablon
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {CAMPAIGN_TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setMessage(t.message)}
                      className="rounded-full border border-line bg-canvas px-2.5 py-1 text-xs font-medium text-text-muted transition hover:border-brand-400 hover:text-brand-600"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>}

              {/* Mesaj */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="kamp-message" className="text-sm font-semibold text-ink-950">
                    {channel === "sms" ? "Mesaj metni" : "Şablon gövde parametresi (isteğe bağlı)"}
                  </label>
                  <span className={`text-xs ${charCount > 160 ? "text-amber-600" : "text-text-faint"}`}>
                    {charCount}/612 karakter
                  </span>
                </div>
                <textarea
                  id="kamp-message"
                  name="message"
                  required={channel === "sms"}
                  rows={4}
                  maxLength={612}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={channel === "sms"
                    ? "Mesajınızı buraya yazın… ({ad} ve {ofis} otomatik değişir)"
                    : "Şablonda tek bir {{1}} gövde alanı varsa değerini yazın"}
                  className="w-full resize-none rounded-[var(--radius-control)] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-300"
                />
                {channel === "sms" && charCount > 0 && charCount <= 160 && (
                  <p className="mt-1 text-xs text-text-faint">1 SMS kredisi kullanılacak</p>
                )}
                {channel === "sms" && charCount > 160 && (
                  <p className="mt-1 text-xs text-amber-600">
                    {Math.ceil(charCount / 153)} SMS kredisi kullanılacak (uzun mesaj)
                  </p>
                )}
              </div>

              {/* Palet dışı red-50/red-600 yerine danger tonları */}
              {state?.error && (
                <p className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
                  {state.error}
                </p>
              )}

              <div className="hairline-t flex justify-end gap-2 pt-4">
                <DialogClose asChild>
                  <button
                    type="button"
                    className="focus-ring press rounded-[var(--radius-control)] border border-hairline px-4 py-2 text-sm font-semibold text-text-muted transition hover:bg-canvas"
                  >
                    Vazgeç
                  </button>
                </DialogClose>
                <button
                  type="submit"
                  disabled={isPending}
                  className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" /> {isPending ? "Oluşturuluyor…" : "Kampanya oluştur"}
                </button>
              </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
