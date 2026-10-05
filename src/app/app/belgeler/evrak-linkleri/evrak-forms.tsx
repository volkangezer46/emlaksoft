"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, Copy, Download, LinkIcon, ScanText } from "lucide-react";
import {
  createDocumentRequest,
  getDocumentRequestFileUrl,
  revokeDocumentRequest,
  suggestDocumentFields,
  type DocRequestOcrResult,
  type DocRequestResult,
} from "@/app/actions/document-requests";
import { applyDocFieldsToProperty, type PropertyDocFields } from "@/app/actions/property-media";
import { searchCustomers, searchProperties } from "@/app/actions/lookup";
import { Alert } from "@/components/ui/alert";
import { Combobox } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import {
  DEFAULT_EXPIRY_DAYS,
  DEFAULT_MAX_FILES,
  DOC_TYPES,
  DOC_TYPE_LABELS,
  EXPIRY_DAY_OPTIONS,
  MAX_FILES_LIMIT,
} from "@/lib/doc-request/doc-request";

const initial: DocRequestResult = {};

/** Yeni evrak linki; üretilen link YALNIZ bir kez gösterilir ve panelde kopyalanır (SMS gönderilmez). */
export function NewRequestForm({
  prefillCustomer,
  prefillProperty,
}: {
  /** ?musteri= ön dolgusu (tek kayıt); diğer müşteriler sunucu aramasıyla seçilir. */
  prefillCustomer: { id: string; full_name: string } | null;
  /** ?portfoy= ön dolgusu (tek kayıt). */
  prefillProperty: { id: string; title: string | null; property_code?: string } | null;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(async (prev: DocRequestResult, fd: FormData) => {
    const res = await createDocumentRequest(prev, fd);
    if (res.ok) router.refresh();
    return res;
  }, initial);
  const [copied, setCopied] = useState(false);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-4 sm:grid-cols-2">
        <FormField label="Başlık" htmlFor="dr-title" required hint="Müşteri sayfada görür; kişi adı yazmayın.">
          <FormInput id="dr-title" name="title" maxLength={160} placeholder="Örn. Satış evrakları" />
        </FormField>
        <FormField label="Geçerlilik" htmlFor="dr-expiry">
          <FormSelect id="dr-expiry" name="expiry_days" defaultValue={String(DEFAULT_EXPIRY_DAYS)}>
            {EXPIRY_DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>{d} gün</option>
            ))}
          </FormSelect>
        </FormField>
        <FormField label="Müşteri" htmlFor="dr-customer" inject={false} hint="Müşteri veya portföyden en az biri.">
          <Combobox
            id="dr-customer"
            name="customer_id"
            aria-label="Müşteri"
            placeholder="Seçilmedi"
            searchPlaceholder="Müşteri ara…"
            emptyText="Eşleşen müşteri yok"
            defaultValue={prefillCustomer?.id ?? ""}
            options={prefillCustomer ? [{ value: prefillCustomer.id, label: prefillCustomer.full_name }] : []}
            onSearch={searchCustomers}
          />
        </FormField>
        <FormField label="Portföy" htmlFor="dr-property" inject={false} hint="Tapu okuma önerisi için portföy seçin.">
          <Combobox
            id="dr-property"
            name="property_id"
            aria-label="Portföy"
            placeholder="Seçilmedi"
            searchPlaceholder="Kod ya da başlık ara…"
            emptyText="Eşleşen portföy yok"
            defaultValue={prefillProperty?.id ?? ""}
            options={
              prefillProperty
                ? [{ value: prefillProperty.id, label: prefillProperty.title ?? "Başlıksız portföy", hint: prefillProperty.property_code }]
                : []
            }
            onSearch={searchProperties}
          />
        </FormField>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-semibold text-ink-950">İstenen evraklar</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {DOC_TYPES.map((t) => (
              <label key={t} className="flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-canvas px-3 text-sm">
                <input type="checkbox" name="types" value={t} defaultChecked={t === "title_deed"} className="h-4 w-4 accent-brand-600" />
                {DOC_TYPE_LABELS[t]}
              </label>
            ))}
          </div>
        </fieldset>
        <FormField label="En çok dosya" htmlFor="dr-max" hint={`1-${MAX_FILES_LIMIT}; gönderilince link kapanır.`}>
          <FormInput id="dr-max" name="max_files" type="number" min={1} max={MAX_FILES_LIMIT} defaultValue={DEFAULT_MAX_FILES} />
        </FormField>
        <div className="flex items-end">
          <Button type="submit" icon={LinkIcon} loading={pending}>Link oluştur</Button>
        </div>
      </form>

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.ok && state.url ? (
        <Alert tone="success" title="Link hazır">
          <p className="mb-2 text-sm">{state.message}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              readOnly
              aria-label="Evrak linki"
              value={state.url}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-xs"
            />
            <Button type="button" size="sm" variant="secondary" icon={copied ? Check : Copy} onClick={() => copy(state.url!)}>
              {copied ? "Kopyalandı" : "Kopyala"}
            </Button>
          </div>
        </Alert>
      ) : null}
    </div>
  );
}

/** Satır içi iki adımlı iptal (popup yok). */
export function RevokeButton({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await revokeDocumentRequest(id);
    setBusy(false);
    if (res.error) setError(res.error);
    else router.refresh();
  }

  if (!confirming) {
    return (
      <Button type="button" size="sm" variant="secondary" icon={Ban} onClick={() => setConfirming(true)}>
        Linki iptal et
      </Button>
    );
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-ink-950">Link hemen kapanır. Emin misiniz?</span>
        <Button type="button" size="sm" variant="danger" loading={busy} onClick={run}>Evet, iptal et</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>Vazgeç</Button>
      </div>
      {error ? <p className="text-xs text-danger-600">{error}</p> : null}
    </div>
  );
}

const OCR_LABELS: { key: keyof PropertyDocFields; label: string }[] = [
  { key: "ada", label: "Ada" },
  { key: "parsel", label: "Parsel" },
  { key: "yuzolcumu_m2", label: "Yüzölçümü (m²)" },
  { key: "bagimsiz_bolum", label: "Bağımsız bölüm" },
  { key: "il", label: "İl" },
  { key: "ilce", label: "İlçe" },
  { key: "mahalle", label: "Mahalle" },
  { key: "malik_ad_soyad", label: "Malik" },
  { key: "tapu_tarihi", label: "Tapu tarihi" },
];

/** Dosya satırı: indir + (uygunsa) okuma önerisi. Öneri kullanıcı onaylayana dek KAYDEDİLMEZ. */
export function FileActions({
  fileId,
  fileName,
  ocrEligible,
  ocrEnabled,
  hasProperty,
}: {
  fileId: string;
  fileName: string;
  ocrEligible: boolean;
  ocrEnabled: boolean;
  hasProperty: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"dl" | "ocr" | "apply" | null>(null);
  const [suggestion, setSuggestion] = useState<DocRequestOcrResult | null>(null);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<string | null>(null);

  async function download() {
    setBusy("dl");
    setError(null);
    const res = await getDocumentRequestFileUrl(fileId);
    setBusy(null);
    if (res.error || !res.url) setError(res.error ?? "Dosya açılamadı.");
    else window.location.assign(res.url);
  }

  async function suggest() {
    setBusy("ocr");
    setError(null);
    setApplied(null);
    const res = await suggestDocumentFields(fileId);
    setBusy(null);
    if (res.error || !res.fields) {
      setError(res.error ?? "Belge okunamadı.");
      return;
    }
    setSuggestion(res);
    setEdited(
      Object.fromEntries(OCR_LABELS.map(({ key }) => [key, res.fields?.[key] == null ? "" : String(res.fields[key])])),
    );
  }

  async function apply() {
    if (!suggestion?.propertyId) return;
    setBusy("apply");
    setError(null);
    const fields = Object.fromEntries(
      OCR_LABELS.map(({ key }) => [key, edited[key]?.trim() ? edited[key]!.trim() : null]),
    ) as unknown as Partial<PropertyDocFields>;
    const res = await applyDocFieldsToProperty(suggestion.propertyId, fields);
    setBusy(null);
    if (res.error) setError(res.error);
    else {
      setApplied(`Portföye uygulandı: ${[...(res.applied ?? []), ...(res.noted ?? [])].join(", ")}`);
      setSuggestion(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" icon={Download} loading={busy === "dl"} onClick={download} aria-label={`${fileName} indir`}>
          İndir
        </Button>
        {ocrEligible ? (
          ocrEnabled && hasProperty ? (
            <Button type="button" size="sm" variant="secondary" icon={ScanText} loading={busy === "ocr"} onClick={suggest}>
              Alanları oku (öneri)
            </Button>
          ) : (
            <span className="text-xs text-text-muted">
              {ocrEnabled ? "Okuma için linke portföy bağlayın." : "Belge okuma (OCR) bu ortamda etkin değil."}
            </span>
          )
        ) : null}
      </div>
      {error ? <p className="text-xs text-danger-600">{error}</p> : null}
      {applied ? <p className="text-xs font-semibold text-mint-700">{applied}</p> : null}
      {suggestion?.fields ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-canvas p-3">
          <p className="text-xs font-semibold text-ink-950">
            Okuma önerisi (güven: {suggestion.guven}). Henüz kaydedilmedi: kontrol edip düzeltin, sonra uygulayın.
          </p>
          {suggestion.note ? <p className="mt-1 text-xs text-text-muted">{suggestion.note}</p> : null}
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {OCR_LABELS.map(({ key, label }) => (
              <label key={key} className="text-xs font-semibold text-text-muted">
                {label}
                <FormInput
                  value={edited[key] ?? ""}
                  onChange={(e) => setEdited((s) => ({ ...s, [key]: e.target.value }))}
                  className="mt-1"
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button type="button" size="sm" loading={busy === "apply"} onClick={apply}>Onayla ve portföye uygula</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSuggestion(null)}>Vazgeç</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
