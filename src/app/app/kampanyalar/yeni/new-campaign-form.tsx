"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, Sparkles } from "lucide-react";
import { TAB_ICONS as TI } from "@/lib/icons";
import { FormField, FormInput, FormSelect, fieldClass } from "@/components/ui/form-controls";
import { SummaryGroup, SummaryRow, TabbedFormShell, type FormTab, type TabbedSummaryContext } from "@/components/ui/tabbed-form-shell";
import { useToast } from "@/components/app/toast-provider";
import {
  createCampaign,
  listApprovedWhatsAppTemplates,
  previewCampaignAudience,
  type CampaignAudiencePreview,
  type CampaignResult,
} from "@/app/actions/campaigns";
import { CAMPAIGN_TEMPLATES } from "@/lib/campaign-templates";
import { CAMPAIGN_DRAFT_FIELDS, CAMPAIGN_FORM_ID, CAMPAIGN_REQUIRED_BY_CHANNEL, CAMPAIGN_TABS } from "./campaign-tabs";

const FILTERS = [
  { value: "all",         label: "Tüm müşteriler" },
  { value: "type:alici",  label: "Sadece alıcılar" },
  { value: "type:satici", label: "Sadece satıcılar" },
  { value: "type:kira",   label: "Sadece kiracılar" },
];

const init: CampaignResult = {};
const TAB_ICONS = { kanal: TI.kanal, icerik: TI.mesaj } as const;
const FIELD_LABELS = {
  title: "Kampanya başlığı",
  message: "Mesaj metni",
  whatsappTemplateName: "Onaylı şablon adı",
  whatsappTemplateLanguage: "Dil kodu",
};

/** "Kaydı çoğalt": mevcut kampanyanın içeriğiyle ön doldurma (alıcı kuyruğu yeniden oluşturulur). */
export type CampaignInitial = {
  title: string;
  channel: "sms" | "whatsapp";
  message: string;
  filter: string;
  whatsappTemplateName: string;
  whatsappTemplateLanguage: string;
};

export function NewCampaignForm({ userId, initial }: { userId: string; initial?: CampaignInitial | null }) {
  const router = useRouter();
  const { push } = useToast();
  const [state, setState] = useState<CampaignResult>(init);
  const [isPending, startTransition] = useTransition();
  const [templatesPending, startTemplatesTransition] = useTransition();
  const [channel, setChannel] = useState<"sms" | "whatsapp">(initial?.channel ?? "sms");
  const [message, setMessage] = useState(initial?.message ?? "");
  const [whatsappTemplateName, setWhatsAppTemplateName] = useState(initial?.whatsappTemplateName ?? "");
  const [whatsappTemplateLanguage, setWhatsAppTemplateLanguage] = useState(initial?.whatsappTemplateLanguage || "tr");
  const [approvedTemplates, setApprovedTemplates] = useState<Array<{ name: string; language: string }>>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const charCount = message.length;
  const [filter, setFilter] = useState<string>(
    initial?.filter && FILTERS.some((f) => f.value === initial.filter) ? initial.filter : "all",
  );
  // İYS önizlemesi: izinli / izinsiz alıcı sayısı (merkezi kapı; src/lib/iys/gate.ts).
  const [preview, setPreview] = useState<CampaignAudiencePreview | null>(null);
  const [previewPending, startPreview] = useTransition();
  const previewSeq = useRef(0);

  function refreshPreview(nextChannel: string, nextFilter: string) {
    const seq = ++previewSeq.current;
    startPreview(async () => {
      const result = await previewCampaignAudience(nextChannel, nextFilter);
      if (seq === previewSeq.current) setPreview(result);
    });
  }

  useEffect(() => {
    refreshPreview(initial?.channel ?? "sms", filter);
    // Yalnız ilk açılışta; sonraki değişimler olay işleyicilerinden tetiklenir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        push("Kampanya oluşturuldu", "ok");
        router.push(result.id ? `/app/kampanyalar/${result.id}` : "/app/kampanyalar");
      }
    });
  }

  const tabs: FormTab[] = useMemo(
    () =>
      CAMPAIGN_TABS.map((t) => {
        const extra: readonly string[] =
          (CAMPAIGN_REQUIRED_BY_CHANNEL[channel] as Record<string, readonly string[]>)[t.id] ?? [];
        return {
          id: t.id,
          label: t.label,
          description: t.description,
          icon: TAB_ICONS[t.id],
          fields: [...t.fields],
          required: [...t.required, ...extra],
        };
      }),
    [channel],
  );

  const tabPanels = {
    kanal: (
      <>
        <FormField label="Kampanya başlığı" htmlFor="kamp-title" required className="sm:col-span-2">
          <FormInput name="title" type="text" required defaultValue={initial?.title} placeholder="ör. Temmuz Fırsat Kampanyası" />
        </FormField>

        <FormField
          label="Kanal"
          htmlFor="kamp-channel"
          hint="WhatsApp kampanyaları yalnızca Meta tarafından onaylanmış mesaj şablonuyla gönderilir."
        >
          <FormSelect
            name="channel"
            value={channel}
            onChange={(event) => {
              const nextChannel = event.target.value as "sms" | "whatsapp";
              setChannel(nextChannel);
              setMessage("");
              setState(init);
              refreshPreview(nextChannel, filter);
              if (nextChannel === "whatsapp") loadApprovedTemplates();
            }}
            className="appearance-none"
          >
            <option value="sms">SMS (Netgsm)</option>
            <option value="whatsapp">WhatsApp</option>
          </FormSelect>
        </FormField>

        <FormField label="Hedef kitle" htmlFor="kamp-filter">
          <FormSelect
            name="filter"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              refreshPreview(channel, event.target.value);
            }}
            className="appearance-none"
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </FormSelect>
        </FormField>

        <div className="sm:col-span-2" role="status" aria-live="polite" data-testid="iys-preview">
          {previewPending && !preview ? (
            <p className="text-xs text-text-faint">İYS izin durumu hesaplanıyor…</p>
          ) : preview?.ok ? (
            <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 px-3 py-2.5 text-sm">
              <p className="font-semibold text-ink-950">
                <span className="text-mint-600">{preview.allowed} izinli</span>
                {" · "}
                <span className={preview.skipped > 0 ? "text-amber-600" : "text-text-muted"}>{preview.skipped} izinsiz (atlanacak)</span>
                <span className="font-normal text-text-muted"> · toplam {preview.total}</span>
              </p>
              <p className="mt-0.5 text-xs text-text-muted">
                Yalnız seçilen kanalda İYS izni olan alıcılara teslim edilir; izinsizler atlanır ve kampanya raporunda sayılır.
                {preview.detail ? ` ${preview.detail}.` : ""}{" "}
                {preview.skipped > 0 ? (
                  <Link href="/app/uyum" className="font-semibold text-accent-text hover:underline">İzinleri Uyum sayfasından yönet</Link>
                ) : null}
              </p>
            </div>
          ) : preview && !preview.ok ? (
            <p className="text-xs text-amber-600">{preview.error}</p>
          ) : null}
        </div>
      </>
    ),
    icerik: (
      <>
        {channel === "whatsapp" && (
          <>
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
                className={`${fieldClass} appearance-none`}
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
            <FormField label="Onaylı şablon adı" htmlFor="kamp-whatsapp-template" required>
              <FormInput
                name="whatsappTemplateName"
                type="text"
                required
                pattern="[a-z0-9_]{1,512}"
                maxLength={512}
                value={whatsappTemplateName}
                onChange={(event) => setWhatsAppTemplateName(event.target.value)}
                placeholder="örn. portfoy_duyurusu"
              />
            </FormField>
            <FormField label="Dil kodu" htmlFor="kamp-whatsapp-language" required>
              <FormInput
                name="whatsappTemplateLanguage"
                type="text"
                required
                pattern="[a-z]{2,3}(_[A-Z]{2})?"
                maxLength={6}
                value={whatsappTemplateLanguage}
                onChange={(event) => setWhatsAppTemplateLanguage(event.target.value)}
                placeholder="tr"
              />
            </FormField>
            <p className="text-xs leading-relaxed text-text-faint sm:col-span-2">
              Ad ve dil kodu Meta Business Manager&apos;daki onaylı şablonla birebir aynı olmalıdır. Onaysız veya uyuşmayan şablon gönderilmez.
            </p>
          </>
        )}

        {/* Hazır SMS metinleri; WhatsApp serbest metne düşürülemez. */}
        {channel === "sms" && (
          <div className="sm:col-span-2">
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
          </div>
        )}

        <div className="sm:col-span-2">
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
            rows={5}
            maxLength={612}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={channel === "sms"
              ? "Mesajınızı buraya yazın… ({ad} ve {ofis} otomatik değişir)"
              : "Şablonda tek bir {{1}} gövde alanı varsa değerini yazın"}
            className={`${fieldClass} resize-none`}
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
      </>
    ),
  };

  function renderSummary({ values }: TabbedSummaryContext) {
    const title = (values.title ?? "").trim();
    const filterLabel = FILTERS.find((f) => f.value === (values.filter ?? "all"))?.label ?? FILTERS[0].label;
    const isSms = channel === "sms";
    const credits = charCount === 0 ? null : charCount <= 160 ? 1 : Math.ceil(charCount / 153);
    const templateName = whatsappTemplateName.trim();
    const templateLang = whatsappTemplateLanguage.trim();
    return (
      <>
        <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
          <p className="truncate text-sm font-semibold text-ink-950">{title || "Başlık girilmedi"}</p>
          <p className="truncate text-xs text-text-muted">{isSms ? "SMS" : "WhatsApp"} · {filterLabel}</p>
        </div>
        <SummaryGroup title="Kampanya özeti">
          <SummaryRow label="Kanal" value={isSms ? "SMS (Netgsm)" : "WhatsApp"} tab="kanal" field="channel" />
          <SummaryRow label="Hedef kitle" value={filterLabel} tab="kanal" field="filter" />
          <SummaryRow
            label="İYS izinli alıcı"
            value={preview?.ok ? `${preview.allowed} / ${preview.total}` : previewPending ? "Hesaplanıyor…" : "-"}
            muted={!preview?.ok}
            tab="kanal"
            field="filter"
          />
          <SummaryRow
            label="İzinsiz (atlanacak)"
            value={preview?.ok ? String(preview.skipped) : "-"}
            muted={!preview?.ok || preview.skipped === 0}
            tab="kanal"
            field="filter"
          />
          {isSms ? (
            <>
              <SummaryRow label="Karakter" value={`${charCount}/612`} muted={charCount === 0} tab="icerik" field="message" />
              <SummaryRow
                label="SMS kredisi (alıcı başı)"
                value={credits === null ? "Mesaj girilmedi" : `${credits}`}
                muted={credits === null}
                tab="icerik"
                field="message"
              />
            </>
          ) : (
            <>
              <SummaryRow label="Şablon" value={templateName || "Girilmedi"} muted={!templateName} tab="icerik" field="whatsappTemplateName" />
              <SummaryRow label="Dil" value={templateLang || "Girilmedi"} muted={!templateLang} tab="icerik" field="whatsappTemplateLanguage" />
            </>
          )}
        </SummaryGroup>
        <SummaryGroup title="Mesaj önizleme">
          <div className="rounded-[var(--radius-control)] bg-surface p-2.5 text-xs leading-relaxed text-ink-950 shadow-sm">
            {isSms ? (
              message.trim() || <span className="text-text-faint">Mesaj yazıldığında burada görünür.</span>
            ) : templateName ? (
              `Şablon: ${templateName}${message.trim() ? ` · gövde: ${message.trim()}` : ""}`
            ) : (
              <span className="text-text-faint">Onaylı şablon seçildiğinde burada görünür.</span>
            )}
          </div>
        </SummaryGroup>
      </>
    );
  }

  return (
    <TabbedFormShell
      title="Yeni kampanya"
      description="SMS veya WhatsApp kampanyasını hazırlayın; yalnız açık kanal izni olan alıcılara teslim edilir."
      breadcrumbs={[{ label: "Kampanyalar", href: "/app/kampanyalar" }, { label: "Yeni kampanya" }]}
      cancelHref="/app/kampanyalar"
      submitLabel="Kampanya oluştur"
      pendingLabel="Oluşturuluyor…"
      submitIcon={Plus}
      pending={isPending}
      error={state?.error}
      onSubmit={handleSubmit}
      tabs={tabs}
      tabPanels={tabPanels}
      summary={renderSummary}
      fieldLabels={FIELD_LABELS}
      draft={{ userId, formId: CAMPAIGN_FORM_ID, fields: [...CAMPAIGN_DRAFT_FIELDS] }}
    />
  );
}
