"use client";

import { useActionState, useTransition, useState } from "react";
import { FileSignature, Plus } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createContract, type ContractResult } from "@/app/actions/contracts";

const CONTRACT_TYPES = [
  { value: "satis",    label: "Satış sözleşmesi" },
  { value: "kira",     label: "Kira sözleşmesi" },
  { value: "sozlesme", label: "Genel sözleşme" },
  { value: "teklif",   label: "Teklif mektubu" },
  { value: "diger",    label: "Diğer" },
];

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
};

const init: ContractResult = {};

// Not: eskiden bir `trigger` prop'u vardı ama bileşen onu hiç okumuyordu —
// her iki çağrı yerinde de aynı "Yeni sözleşme" butonu render ediliyor.
// Yanıltıcı olduğu için kaldırıldı (çağrı yeri de güncellendi).
export function NewContractDialog({
  contractTypes = CONTRACT_TYPES,
}: { contractTypes?: { value: string; label: string }[] } = {}) {
  const [open, setOpen] = useState(false);
  // action kullanılmıyor (handleSubmit createContract'i doğrudan çağırıyor);
  // dizi boşluğu ile atlanıyor — isPending gerekli.
  const [state, , isPending] = useActionState(createContract, init);
  const [, startTransition] = useTransition();
  const [selectedType, setSelectedType] = useState("diger");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createContract(init, fd);
      if (result.ok) setOpen(false);
    });
  }

  function applyTemplate(type: string) {
    setSelectedType(type);
    // Template alanını güncelle — ref olmadan controlled textarea
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
          icon={<FileSignature />}
          title="Yeni sözleşme"
          description="Taslağı oluşturun; imzalayanları ekleyip e-imza linki gönderin."
        />
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
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
                    onChange={(e) => applyTemplate(e.target.value)}
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
                  {TEMPLATES[selectedType] && (
                    <button
                      type="button"
                      onClick={() => {
                        const el = document.getElementById("sozl-body") as HTMLTextAreaElement;
                        if (el) el.value = TEMPLATES[selectedType];
                      }}
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
                  defaultValue={TEMPLATES[selectedType] ?? ""}
                  placeholder="Sözleşme metnini buraya yazın veya şablonu kullanın…"
                  className="w-full resize-y rounded-[10px] border border-line bg-canvas px-3.5 py-2.5 font-mono text-xs text-ink-950 outline-none focus:border-brand-300"
                />
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
                  disabled={isPending}
                  className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                >
                  <FileSignature className="h-4 w-4" />
                  {isPending ? "Kaydediliyor…" : "Sözleşme oluştur"}
                </button>
              </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
