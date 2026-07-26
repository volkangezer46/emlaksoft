"use client";

import { useActionState, useTransition, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, FilePlus2, FileSignature, LayoutTemplate, Plus } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
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

const init: ContractResult = {};

// Not: eskiden bir `trigger` prop'u vardı ama bileşen onu hiç okumuyordu —
// her iki çağrı yerinde de aynı "Yeni sözleşme" butonu render ediliyor.
// Yanıltıcı olduğu için kaldırıldı (çağrı yeri de güncellendi).
export function NewContractDialog({
  contractTypes = CONTRACT_TYPES,
  templates = [],
}: {
  contractTypes?: { value: string; label: string }[];
  /** DB'den gelen global + ofis şablonları ("Şablondan başla" galerisi). */
  templates?: ContractTemplateOption[];
} = {}) {
  const [open, setOpen] = useState(false);
  // action kullanılmıyor (handleSubmit createContract'i doğrudan çağırıyor);
  // dizi boşluğu ile atlanıyor — isPending gerekli.
  const [state, , isPending] = useActionState(createContract, init);
  const [, startTransition] = useTransition();
  const [localError, setLocalError] = useState<string | null>(null);
  // Teklif/randevu akışından ön dolgu: /app/sozlesmeler?customer=&property=&tur=
  // ile gelindiğinde taslak, ilgili müşteri + portföye bağlanarak oluşturulur.
  const searchParams = useSearchParams();
  const prefillCustomer = searchParams.get("customer") ?? "";
  const prefillProperty = searchParams.get("property") ?? "";
  // ?tur= tanımlı sözleşme türlerinden biriyse seçili gelir — randevudan gelen
  // yer gösterme tutanağı akışı artık GERÇEK "yer_gosterme" türünü kullanır.
  const prefillTur = searchParams.get("tur") ?? "";
  const isYerGosterme = prefillTur === "yer_gosterme";
  const hasPrefill = Boolean(prefillCustomer || prefillProperty || prefillTur);
  const [selectedType, setSelectedType] = useState(
    // Tür seçeneklerde yoksa (eski tanım listesi) "diger"e düşülür.
    contractTypes.some((t) => t.value === prefillTur) ? prefillTur : "diger",
  );
  // Seçili türün çevrimdışı yedek şablonu (yer gösterme dahil).
  const activeTemplate = TEMPLATES[selectedType];

  // "Şablondan başla" adımı: akıştan ön dolguyla gelinmediyse ve şablon
  // varsa önce galeri gösterilir; "Boş başla" ile form adımına geçilir.
  const [step, setStep] = useState<"template" | "form">(
    hasPrefill || templates.length === 0 ? "form" : "template",
  );
  // İçerik controlled: galeriden seçim doğrudan doldurabilsin
  const [body, setBody] = useState(activeTemplate ?? "");
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);

  function applyDbTemplate(t: ContractTemplateOption) {
    setBody(t.content);
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
        if (result.error) setLocalError(result.error);
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
      setOpen(false);
    });
  }

  return (
    /* Radix Dialog: focus trap + Esc (öncesinde yoktu) + scroll lock + ARIA.
       Düz başlık DialogHeader'a geçince gradient başlık + açıklama kazandı. */
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="focus-ring press inline-flex items-center gap-2 rounded-[12px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" /> Yeni sözleşme
        </button>
      </DialogTrigger>

      <DialogContent size="lg">
        <DialogHeader
          icon={step === "template" ? <LayoutTemplate /> : <FileSignature />}
          title={step === "template" ? "Şablondan başla" : "Yeni sözleşme"}
          description={
            step === "template"
              ? "Hazır bir şablon seçin veya boş sözleşmeyle başlayın."
              : "Taslağı oluşturun; imzalayanları ekleyip e-imza linki gönderin."
          }
        />

        {step === "template" ? (
          <div className="max-h-[65vh] space-y-3 overflow-y-auto p-6">
            {/* Boş başlangıç */}
            <button
              type="button"
              onClick={() => setStep("form")}
              className="focus-ring press flex w-full items-center gap-3 rounded-[14px] border border-dashed border-line-strong bg-canvas/60 px-4 py-3 text-left transition hover:border-brand-300"
            >
              <FilePlus2 className="h-5 w-5 shrink-0 text-brand-600" />
              <span>
                <span className="block text-sm font-semibold text-ink-950">Boş sözleşme</span>
                <span className="block text-xs text-text-muted">Şablonsuz başla, metni kendin yaz.</span>
              </span>
            </button>

            {/* Şablon kartları */}
            {templates.map((t) => (
              <div
                key={t.id}
                className="rounded-[14px] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] transition hover:border-brand-300"
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
                  <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-[10px] border border-line bg-canvas/60 p-3 font-mono text-[11px] leading-relaxed text-text-muted">
                    {t.content}
                  </pre>
                </details>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => applyDbTemplate(t)}
                    className="focus-ring press rounded-[9px] bg-brand-600/10 px-3 py-1.5 text-xs font-semibold text-brand-600 transition hover:bg-brand-600/15"
                  >
                    Bu şablonla başla
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 p-6">
              {templates.length > 0 && !hasPrefill ? (
                <button
                  type="button"
                  onClick={() => setStep("template")}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Şablon galerisine dön
                </button>
              ) : null}
              {prefillCustomer ? <input type="hidden" name="customer_id" value={prefillCustomer} /> : null}
              {prefillProperty ? <input type="hidden" name="property_id" value={prefillProperty} /> : null}
              {prefillCustomer || prefillProperty ? (
                <p className="rounded-[8px] bg-brand-600/8 px-3 py-2 text-xs font-medium text-brand-700">
                  {isYerGosterme
                    ? "Randevu akışından gelindi — müşteri ve portföy bağı otomatik eklenecek; içerikte yer gösterme tutanağı şablonu hazır."
                    : "Teklif akışından gelindi — portföy ve müşteri bağı sözleşmeye otomatik eklenecek."}
                </p>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Başlık */}
                <div className="sm:col-span-2">
                  <label htmlFor="sozl-title" className="mb-1.5 block text-sm font-semibold text-ink-950">
                    Sözleşme başlığı
                  </label>
                  <input
                    id="sozl-title"
                    name="title"
                    type="text"
                    required
                    defaultValue={isYerGosterme ? "Yer Gösterme Tutanağı" : undefined}
                    placeholder="ör. Daire Kira Sözleşmesi — Ahmet Yılmaz"
                    className="w-full rounded-[10px] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-300"
                  />
                </div>

                {/* Tür */}
                <div>
                  <label htmlFor="sozl-type" className="mb-1.5 block text-sm font-semibold text-ink-950">
                    Tür
                  </label>
                  <select
                    id="sozl-type"
                    name="contract_type"
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value)}
                    className="w-full appearance-none rounded-[10px] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-300"
                  >
                    {contractTypes.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>

                {/* Son geçerlilik */}
                <div>
                  <label htmlFor="sozl-expires" className="mb-1.5 block text-sm font-semibold text-ink-950">
                    Son geçerlilik tarihi <span className="font-normal text-text-faint">(opsiyonel)</span>
                  </label>
                  <input
                    id="sozl-expires"
                    name="expires_at"
                    type="date"
                    className="w-full rounded-[10px] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-300"
                  />
                </div>
              </div>

              {/* İçerik */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="sozl-body" className="text-sm font-semibold text-ink-950">
                    Sözleşme içeriği
                  </label>
                  {activeTemplate && (
                    <button
                      type="button"
                      onClick={() => setBody(activeTemplate)}
                      className="text-xs font-semibold text-brand-600 hover:underline"
                    >
                      Şablonu uygula
                    </button>
                  )}
                </div>
                <textarea
                  id="sozl-body"
                  name="body"
                  required
                  rows={10}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Sözleşme metnini buraya yazın veya şablonu kullanın…"
                  className="w-full resize-y rounded-[10px] border border-line bg-canvas px-3.5 py-2.5 font-mono text-xs text-ink-950 outline-none focus:border-brand-300"
                />
              </div>

              {/* Ofis şablonu olarak kaydet */}
              <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-line bg-canvas/60 px-3.5 py-2.5">
                <input
                  type="checkbox"
                  checked={saveAsTemplate}
                  onChange={(e) => setSaveAsTemplate(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                />
                <span>
                  <span className="block text-sm font-semibold text-ink-950">
                    Bu içeriği şablon olarak kaydet
                  </span>
                  <span className="block text-xs text-text-muted">
                    Metin, ofisinizin şablon galerisine eklenir; sonraki sözleşmelerde hazır gelir.
                  </span>
                </span>
              </label>

              {/* Palet dışı red-50/red-600 yerine danger tonları */}
              {(localError ?? state?.error) && (
                <p className="rounded-[8px] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
                  {localError ?? state?.error}
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
                  disabled={isPending}
                  className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                >
                  <FileSignature className="h-4 w-4" />
                  {isPending ? "Kaydediliyor…" : "Sözleşme oluştur"}
                </button>
              </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
