"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FilePlus2, FileSignature } from "lucide-react";
import { TAB_ICONS as TI } from "@/lib/icons";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { FormActions, FormPage } from "@/components/ui/form-page";
import { FormField, FormInput, FormSelect, fieldClass } from "@/components/ui/form-controls";
import {
  SummaryGroup,
  SummaryRow,
  TabbedFormShell,
  type FormTab,
  type TabbedSummaryContext,
} from "@/components/ui/tabbed-form-shell";
import { useToast } from "@/components/app/toast-provider";
import { Combobox } from "@/components/ui/combobox";
import { searchCustomers, searchProperties } from "@/app/actions/lookup";
import { DAY_MS, msUntil } from "@/lib/clock";
import { GOS_CLAUSE_MARKER, appendGosClause, gosClauseApplies } from "@/lib/gos-info";
import { CONTRACT_DRAFT_FIELDS, CONTRACT_FORM_ID, CONTRACT_TABS } from "./contract-tabs";
import type { RentalContractContext } from "./rental-context";
import {
  INCREASE_BASES,
  buildRentalContractBody,
  fillRentalTokens,
  parseFixedPct,
  type IncreaseBasis,
} from "@/lib/rental-contract/build";
import {
  createContract,
  saveContractTemplate,
  type ContractResult,
  type ContractTemplateOption,
} from "@/app/actions/contracts";

const CONTRACT_TYPES = [
  { value: "satis",        label: "Satış sözleşmesi" },
  { value: "kira",         label: "Kira sözleşmesi" },
  { value: "sozlesme",     label: "Genel sözleşme" },
  { value: "teklif",       label: "Teklif mektubu" },
  { value: "yer_gosterme", label: "Yer gösterme tutanağı" },
  { value: "kapora",       label: "Kapora sözleşmesi" },
  { value: "diger",        label: "Diğer" },
];

/** Şablon kartı rozetinde kullanılan kısa tür etiketleri. */
const TYPE_BADGES: Record<string, string> = {
  satis:        "Satış",
  kira:         "Kira",
  sozlesme:     "Sözleşme",
  teklif:       "Teklif",
  yer_gosterme: "Yer gösterme",
  kapora:       "Kapora",
  diger:        "Diğer",
};

/* Çevrimdışı yedek: DB şablonları yüklenemezse tür seçimine bağlı
   "Şablonu uygula" kısayolu bu metinleri kullanmaya devam eder. */
const TEMPLATES: Record<string, string> = {
  satis: `TAŞINMAZ SATIM SÖZLEŞMESİ

Satıcı: ___________________________
Alıcı:  ___________________________
Taşınmaz: ___________________________
Satış Bedeli: ___________________________

MADDE 1 — Konu
Yukarıda belirtilen taşınmaz, belirlenen bedel karşılığında satıcı tarafından alıcıya devredilecektir.

MADDE 2 — Ödeme Planı
___________________________

MADDE 3 — Tapu Devri
Tapu devri _____ tarihi itibarıyla gerçekleştirilecektir.

MADDE 4 — Tarafların Taahhütleri
___________________________

İmzalar:
Satıcı: ___________________________  Tarih: _______
Alıcı:  ___________________________  Tarih: _______`,

  kira: `KİRA SÖZLEŞMESİ

Kiraya Veren: ___________________________
Kiracı:       ___________________________
Kira Konusu:  ___________________________
Aylık Kira:   ___________________________  TL
Kira Süresi:  _____ tarihinden _____ tarihine kadar

MADDE 1 — Kira Bedeli
Aylık kira bedeli her ayın ___ inci günü ödenecektir.

MADDE 2 — Depozito
Kiracı ___ aylık kira bedeli tutarında depozito ödeyecektir.

MADDE 3 — Tarafların Yükümlülükleri
___________________________

MADDE 4 — Kira Artışı
Kira bedeli her yıl, bir önceki kira yılının on iki aylık ortalama TÜFE oranını geçmeyecek şekilde artırılır (TBK m.344).

İmzalar:
Kiraya Veren: ___________________________  Tarih: _______
Kiracı:       ___________________________  Tarih: _______`,

  teklif: `TEKLİF MEKTUBU

Tarih: ___________________________
Sayın: ___________________________

İlgilendiğiniz taşınmaz için teklifimiz aşağıdaki gibidir:

Taşınmaz: ___________________________
Teklif Bedeli: ___________________________ TL
Geçerlilik: ___________________________ tarihine kadar
Ödeme Şekli: ___________________________

Bu teklif yukarıda belirtilen tarihe kadar geçerlidir. Olumlu değerlendirmeniz durumunda süreç birlikte yürütülecektir.

Saygılarımızla,
___________________________ (Danışman / Ofis)`,

  sozlesme: `HİZMET / ARACILIK SÖZLEŞMESİ

Hizmet Veren (Emlak Ofisi): ___________________________
Hizmet Alan (Müşteri):      ___________________________
Konu:                       ___________________________

MADDE 1 — Kapsam
Emlak ofisi, müşteriye taşınmaz alım/satım/kiralama sürecinde aracılık ve danışmanlık hizmeti verir.

MADDE 2 — Hizmet Bedeli (Komisyon)
İşlem gerçekleştiğinde, taraflarca kabul edilen oran üzerinden hizmet bedeli ödenir.

MADDE 3 — Süre ve Yetki
Bu sözleşme _____ tarihinden itibaren _____ süreyle geçerlidir.

MADDE 4 — Gizlilik ve KVKK
Taraflar, kişisel verilerin 6698 sayılı KVKK kapsamında korunacağını kabul eder.

İmzalar:
Emlak Ofisi: ___________________________  Tarih: _______
Müşteri:     ___________________________  Tarih: _______`,

  yer_gosterme: `YER GÖSTERME TUTANAĞI

Tarih: ___________________________
Emlak Ofisi / Danışman: ___________________________
Müşteri (Alıcı / Kiracı Adayı): ___________________________
Gösterilen Portföy: ___________________________
Adres: ___________________________

MADDE 1 — Konu
Yukarıda bilgileri yazılı taşınmaz, belirtilen tarihte emlak ofisi danışmanı eşliğinde müşteriye gezdirilerek gösterilmiştir.

MADDE 2 — Beyan
Müşteri, taşınmazın kendisine ilk kez bu ofis aracılığıyla gösterildiğini ve taşınmazla ilgili alım/kiralama görüşmelerini bu ofis aracılığıyla yürüteceğini kabul ve beyan eder.

MADDE 3 — Hizmet Bedeli
İşlemin gerçekleşmesi hâlinde, taraflarca kararlaştırılan oran üzerinden hizmet bedeli (komisyon) ödenir.

İmzalar:
Danışman: ___________________________  Tarih: _______
Müşteri:  ___________________________  Tarih: _______`,
};

const TAB_ICONS = { bilgiler: TI.sozlesme, icerik: TI.icerik } as const;
const FIELD_LABELS = { title: "Sözleşme başlığı", body: "Sözleşme içeriği" };

const init: ContractResult = {};

export function NewContractForm({
  contractTypes = CONTRACT_TYPES,
  templates = [],
  prefillCustomer = "",
  prefillProperty = "",
  prefillTur = "",
  rentalContext = null,
  userId,
}: {
  contractTypes?: { value: string; label: string }[];
  /** DB'den gelen global + ofis şablonları ("Şablondan başla" galerisi). */
  templates?: ContractTemplateOption[];
  /** Teklif/randevu akışından ön dolgu: ?customer=&property=&tur= */
  prefillCustomer?: string;
  prefillProperty?: string;
  prefillTur?: string;
  /** Kiralama kaydından gelindiyse (?kira=): ön dolgu ve artış maddesi alanı. */
  rentalContext?: RentalContractContext | null;
  userId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [localError, setLocalError] = useState<string | null>(null);
  const { push } = useToast();
  const router = useRouter();
  // Randevudan gelen yer gösterme tutanağı akışı GERÇEK "yer_gosterme" türünü kullanır.
  const isYerGosterme = prefillTur === "yer_gosterme";
  const hasPrefill = Boolean(prefillCustomer || prefillProperty || prefillTur);
  const [selectedType, setSelectedType] = useState(
    // Tür seçeneklerde yoksa (eski tanım listesi) "diger"e düşülür.
    contractTypes.some((t) => t.value === prefillTur) ? prefillTur : "diger",
  );
  // Seçili türün çevrimdışı yedek şablonu (yer gösterme dahil).
  const activeTemplate = TEMPLATES[selectedType];

  // "Şablondan başla" adımı: ön dolguyla gelinmediyse ve şablon varsa önce galeri.
  // Kiralamadan gelindiyse ofisin kira şablonları varsa galeri önce açılır (hazır taslak da orada); yoksa doğrudan form.
  const hasKiraTemplates = templates.some((t) => t.type === "kira");
  const [step, setStep] = useState<"template" | "form">(
    rentalContext ? (hasKiraTemplates ? "template" : "form") : hasPrefill || templates.length === 0 ? "form" : "template",
  );
  const [body, setBody] = useState(rentalContext?.defaultBody ?? activeTemplate ?? "");
  const [generatedBody, setGeneratedBody] = useState(rentalContext?.defaultBody ?? "");
  const [increaseBasis, setIncreaseBasis] = useState<IncreaseBasis>("tufe");
  const [fixedPct, setFixedPct] = useState("");
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);

  /** Kira kaydı verisi + seçili artış maddesiyle sözleşme verisi. */
  function rentalData(basis: IncreaseBasis, pct: string) {
    const parsed = parseFixedPct(pct);
    return { ...rentalContext!.data, increaseBasis: basis, fixedPct: parsed.ok ? parsed.value : null };
  }

  /** Artış maddesi değişince: metin hâlâ otomatik üretilen taslaksa güncellenir (elle düzenlenmiş metne dokunulmaz). */
  function changeIncrease(basis: IncreaseBasis, pct: string) {
    setIncreaseBasis(basis);
    setFixedPct(pct);
    if (rentalContext && body === generatedBody) {
      const next = buildRentalContractBody(rentalData(basis, pct));
      setBody(next);
      setGeneratedBody(next);
    }
  }

  function applyBuiltInRentalDraft() {
    const next = buildRentalContractBody(rentalData(increaseBasis, fixedPct));
    setBody(next);
    setGeneratedBody(next);
    setStep("form");
  }

  function applyDbTemplate(t: ContractTemplateOption) {
    // Kiralamadan gelindiyse ofis şablonundaki {kiraci}, {kira_bedeli} gibi alanlar kira kaydıyla dolar.
    setBody(rentalContext ? fillRentalTokens(t.content, rentalData(increaseBasis, fixedPct)) : t.content);
    if (contractTypes.some((ct) => ct.value === t.type)) setSelectedType(t.type);
    setStep("form");
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLocalError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createContract(init, fd);
      if (!result.ok) {
        setLocalError(result.error ?? "Sözleşme oluşturulamadı.");
        return;
      }
      // "Bu içeriği şablon olarak kaydet" — ofis (tenant) şablonu oluşur
      if (saveAsTemplate) {
        const tfd = new FormData();
        tfd.set("title",   String(fd.get("title") ?? "Şablon"));
        tfd.set("type",    String(fd.get("contract_type") ?? "diger"));
        tfd.set("content", String(fd.get("body") ?? ""));
        const tRes = await saveContractTemplate(init, tfd);
        if (tRes.error) console.error("saveContractTemplate", tRes.error);
      }
      push("Sözleşme taslağı oluşturuldu", "ok");
      router.push(result.id ? `/app/sozlesmeler/${result.id}` : "/app/sozlesmeler");
      router.refresh();
    });
  }

  const tabs: FormTab[] = useMemo(
    () =>
      CONTRACT_TABS.map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        icon: TAB_ICONS[t.id],
        fields: [...t.fields],
        required: [...t.required],
      })),
    [],
  );

  const crumbs = [{ label: "Sözleşmeler", href: "/app/sozlesmeler" }, { label: "Yeni sözleşme" }];

  if (step === "template") {
    return (
      <FormPage
        title="Şablondan başla"
        description="Hazır bir şablon seçin veya boş sözleşmeyle başlayın."
        breadcrumbs={crumbs}
      >
        <div className="space-y-3">
          {rentalContext ? (
            <>
              <button
                type="button"
                onClick={applyBuiltInRentalDraft}
                className="focus-ring press flex w-full items-center gap-3 rounded-[var(--radius-card)] border border-brand-300 bg-brand-600/5 px-4 py-3 text-left transition hover:border-brand-400"
              >
                <FileSignature className="h-5 w-5 shrink-0 text-brand-600" />
                <span>
                  <span className="block text-sm font-semibold text-ink-950">Hazır kira taslağı (kira kaydı bilgileriyle dolu)</span>
                  <span className="block text-xs text-text-muted">Kiracı, bedel, vade, depozito ve süre otomatik gelir; artış maddesini sonraki adımda seçersiniz.</span>
                </span>
              </button>
              <p className="rounded-[var(--radius-control)] bg-canvas/70 px-3 py-2 text-xs text-text-muted">
                Kendi avukat onaylı şablonunuz mu var? <Link href="/app/ayarlar/sozlesme-sablonlari" className="font-semibold text-brand-600 hover:underline">Ayarlar &gt; Sözleşme şablonları</Link>’ndan ekleyin; metindeki {"{kiraci}"}, {"{kira_bedeli}"}, {"{vade_gunu}"}, {"{baslangic}"}, {"{bitis}"}, {"{depozito}"}, {"{kiraya_veren}"}, {"{artis_maddesi}"} alanları kira kaydıyla otomatik dolar.
              </p>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (rentalContext) setBody("");
              setStep("form");
            }}
            className="focus-ring press flex w-full items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line-strong bg-canvas/60 px-4 py-3 text-left transition hover:border-brand-300"
          >
            <FilePlus2 className="h-5 w-5 shrink-0 text-brand-600" />
            <span>
              <span className="block text-sm font-semibold text-ink-950">Boş sözleşme</span>
              <span className="block text-xs text-text-muted">Şablonsuz başla, metni kendin yaz.</span>
            </span>
          </button>
          {templates.map((t) => (
            <div
              key={t.id}
              className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] transition hover:border-brand-300"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-950">{t.title}</p>
                <Badge variant="outline" size="sm">{TYPE_BADGES[t.type] ?? t.type}</Badge>
                <Badge variant={t.isGlobal ? "info" : "success"} size="sm">
                  {t.isGlobal ? "Hazır şablon" : "Ofis şablonu"}
                </Badge>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-semibold text-brand-600 hover:underline">
                  Önizleme
                </summary>
                <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3 font-mono text-xs leading-relaxed text-text-muted">
                  {t.content}
                </pre>
              </details>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => applyDbTemplate(t)}
                  className="focus-ring press rounded-[var(--radius-control)] bg-brand-600/10 px-3 py-1.5 text-xs font-semibold text-brand-600 transition hover:bg-brand-600/15"
                >
                  Bu şablonla başla
                </button>
              </div>
            </div>
          ))}
        </div>
        <FormActions>
          <ButtonLink href="/app/sozlesmeler" variant="secondary">İptal</ButtonLink>
        </FormActions>
      </FormPage>
    );
  }

  const tabPanels = {
    bilgiler: (
      <>
        {rentalContext ? <input type="hidden" name="rental_id" value={rentalContext.rentalId} /> : null}
        {prefillCustomer ? <input type="hidden" name="customer_id" value={prefillCustomer} /> : null}
        {prefillProperty ? <input type="hidden" name="property_id" value={prefillProperty} /> : null}
        {/* Ön dolgu yoksa müşteri / portföy aramalı seçiciyle bağlanabilir (bağsız sözleşme kalmasın). */}
        {!prefillCustomer ? (
          <FormField label="Müşteri (opsiyonel)" htmlFor="sozl-customer">
            <Combobox
              name="customer_id"
              aria-label="Müşteri"
              placeholder="Seçiniz"
              searchPlaceholder="Müşteri ara…"
              emptyText="Eşleşen müşteri yok"
              onSearch={searchCustomers}
              options={[]}
            />
          </FormField>
        ) : null}
        {!prefillProperty ? (
          <FormField label="Portföy (opsiyonel)" htmlFor="sozl-property">
            <Combobox
              name="property_id"
              aria-label="Portföy"
              placeholder="Seçiniz"
              searchPlaceholder="Portföy ara…"
              emptyText="Eşleşen portföy yok"
              onSearch={searchProperties}
              options={[]}
            />
          </FormField>
        ) : null}
        {prefillCustomer || prefillProperty ? (
          <p className="rounded-[var(--radius-control)] bg-brand-600/8 px-3 py-2 text-xs font-medium text-brand-700 sm:col-span-2">
            {rentalContext
              ? "Kiralama kaydından gelindi — kiracı, portföy ve kira kaydı bağı sözleşmeye otomatik eklenecek; sözleşme sayfasından kiralamaya geri dönülebilir."
              : isYerGosterme
              ? "Randevu akışından gelindi — müşteri ve portföy bağı otomatik eklenecek; içerikte yer gösterme tutanağı şablonu hazır."
              : "Teklif akışından gelindi — portföy ve müşteri bağı sözleşmeye otomatik eklenecek."}
          </p>
        ) : null}
        <FormField label="Sözleşme başlığı" htmlFor="sozl-title" required className="sm:col-span-2">
          <FormInput
            name="title"
            type="text"
            required
            defaultValue={rentalContext ? rentalContext.title : isYerGosterme ? "Yer Gösterme Tutanağı" : undefined}
            placeholder="ör. Daire Kira Sözleşmesi — Ahmet Yılmaz"
          />
        </FormField>
        <FormField label="Tür" htmlFor="sozl-type">
          <FormSelect
            name="contract_type"
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="appearance-none"
          >
            {contractTypes.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </FormSelect>
        </FormField>
        <FormField label="Son geçerlilik tarihi (opsiyonel)" htmlFor="sozl-expires">
          <FormInput name="expires_at" type="date" defaultValue={rentalContext?.expiresAt ?? undefined} />
        </FormField>
        {rentalContext ? (
          <>
            <FormField label="Kira artışı maddesi" htmlFor="sozl-increase" hint="TBK m.344: yenileme döneminde artış, bir önceki 12 aylık TÜFE ortalamasını aşamaz.">
              <FormSelect
                id="sozl-increase"
                name="rent_increase_basis"
                value={increaseBasis}
                onChange={(e) => changeIncrease(e.target.value as IncreaseBasis, fixedPct)}
                className="appearance-none"
              >
                {INCREASE_BASES.map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </FormSelect>
            </FormField>
            {increaseBasis === "sabit" ? (
              <FormField label="Sabit artış yüzdesi (%)" htmlFor="sozl-increase-pct" required>
                <FormInput
                  id="sozl-increase-pct"
                  name="rent_increase_fixed_pct"
                  inputMode="decimal"
                  placeholder="ör. 25"
                  value={fixedPct}
                  onChange={(e) => changeIncrease(increaseBasis, e.target.value)}
                />
              </FormField>
            ) : null}
          </>
        ) : null}
      </>
    ),
    icerik: (
      <>
        <div className="sm:col-span-2">
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="sozl-body" className="text-sm font-semibold text-ink-950">Sözleşme içeriği</label>
            {activeTemplate && (
              <button
                type="button"
                onClick={() => {
                  if (rentalContext) {
                    const next = buildRentalContractBody(rentalData(increaseBasis, fixedPct));
                    setBody(next);
                    setGeneratedBody(next);
                  } else setBody(activeTemplate);
                }}
                className="text-xs font-semibold text-brand-600 hover:underline"
              >
                Şablonu uygula
              </button>
            )}
          </div>
          {gosClauseApplies(selectedType) ? (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-line bg-canvas/60 px-3 py-2 text-xs text-text-muted">
              <button
                type="button"
                onClick={() => setBody((b) => appendGosClause(b))}
                disabled={body.includes(GOS_CLAUSE_MARKER)}
                className="font-semibold text-brand-600 hover:underline disabled:cursor-not-allowed disabled:text-text-faint disabled:no-underline"
              >
                {body.includes(GOS_CLAUSE_MARKER) ? "GÖS maddesi eklendi" : "Güvenli Ödeme Sistemi (GÖS) maddesi ekle"}
              </button>
              <span>İsteğe bağlı; metni ofisiniz gözden geçirir, hukuki danışmanlık değildir.</span>
            </div>
          ) : null}
          <textarea
            id="sozl-body"
            name="body"
            required
            rows={14}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Sözleşme metnini buraya yazın veya şablonu kullanın…"
            className={`${fieldClass} resize-y font-mono text-xs`}
          />
        </div>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-control)] border border-line bg-canvas/60 px-3.5 py-2.5 sm:col-span-2">
          <input
            type="checkbox"
            checked={saveAsTemplate}
            onChange={(e) => setSaveAsTemplate(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
          />
          <span>
            <span className="block text-sm font-semibold text-ink-950">Bu içeriği şablon olarak kaydet</span>
            <span className="block text-xs text-text-muted">
              Metin, ofisinizin şablon galerisine eklenir; sonraki sözleşmelerde hazır gelir.
            </span>
          </span>
        </label>
      </>
    ),
  };

  function renderSummary({ values }: TabbedSummaryContext) {
    const title = (values.title ?? "").trim();
    const typeLabel = contractTypes.find((t) => t.value === selectedType)?.label ?? selectedType;
    const expires = (values.expires_at ?? "").trim();
    const days = expires ? Math.ceil(msUntil(expires) / DAY_MS) : null;
    const text = values.body ?? "";
    const trimmed = text.trim();
    const lines = trimmed ? trimmed.split(/\r?\n/).length : 0;
    const blanks = (text.match(/_{3,}/g) ?? []).length;
    return (
      <>
        <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
          <p className="line-clamp-2 text-sm font-semibold text-ink-950">{title || "Sözleşme başlığı girilmedi"}</p>
          <p className="mt-0.5 truncate text-xs text-text-muted">{typeLabel}</p>
        </div>
        <SummaryGroup title="Sözleşme">
          <SummaryRow label="Başlık" value={title || "Zorunlu"} muted={!title} tab="bilgiler" field="title" />
          <SummaryRow label="Tür" value={typeLabel} tab="bilgiler" field="contract_type" />
          <SummaryRow
            label="Bitiş"
            value={
              days == null || Number.isNaN(days)
                ? "Süresiz"
                : days < 0
                  ? `${expires.split("-").reverse().join(".")} · süresi geçmiş`
                  : `${expires.split("-").reverse().join(".")} · ${days} gün kaldı`
            }
            muted={!expires}
            tab="bilgiler"
            field="expires_at"
          />
          <SummaryRow label="Müşteri bağı" value={prefillCustomer ? "Eklenecek" : "Yok"} muted={!prefillCustomer} tab="bilgiler" />
          <SummaryRow label="Portföy bağı" value={prefillProperty ? "Eklenecek" : "Yok"} muted={!prefillProperty} tab="bilgiler" />
        </SummaryGroup>
        <SummaryGroup title="İçerik">
          <SummaryRow label="Metin" value={trimmed ? trimmed.replace(/\s+/g, " ") : "Zorunlu"} muted={!trimmed} tab="icerik" field="sozl-body" />
          <SummaryRow
            label="Uzunluk"
            value={trimmed ? `${new Intl.NumberFormat("tr-TR").format(trimmed.length)} karakter · ${lines} satır` : "Metin girilince"}
            muted={!trimmed}
            tab="icerik"
            field="sozl-body"
          />
          <SummaryRow
            label="Doldurulacak boşluk"
            value={trimmed ? (blanks > 0 ? `${blanks} alan (___)` : "Yok") : "Metin girilince"}
            muted={!trimmed || blanks === 0}
            tab="icerik"
            field="sozl-body"
          />
          <SummaryRow
            label="Şablon olarak kaydet"
            value={saveAsTemplate ? "Evet" : "Hayır"}
            muted={!saveAsTemplate}
            tab="icerik"
          />
        </SummaryGroup>
      </>
    );
  }

  return (
    <TabbedFormShell
      title="Yeni sözleşme"
      description="Taslağı oluşturun; imzalayanları ekleyip imza linki gönderin."
      breadcrumbs={crumbs}
      headerActions={
        templates.length > 0 && !hasPrefill ? (
          <button
            type="button"
            onClick={() => setStep("template")}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Şablon galerisine dön
          </button>
        ) : undefined
      }
      cancelHref="/app/sozlesmeler"
      submitLabel="Sözleşme oluştur"
      pendingLabel="Kaydediliyor…"
      submitIcon={FileSignature}
      pending={isPending}
      error={localError}
      onSubmit={handleSubmit}
      tabs={tabs}
      tabPanels={tabPanels}
      summary={renderSummary}
      fieldLabels={FIELD_LABELS}
      draft={{ userId, formId: CONTRACT_FORM_ID, fields: [...CONTRACT_DRAFT_FIELDS] }}
    />
  );
}
