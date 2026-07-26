"use client";

import { useMemo, useState, useTransition } from "react";
import { Wand2 } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { updateContractBody, type ContractResult } from "@/app/actions/contracts";

/**
 * Değişken doldurma sihirbazı — taslak sözleşme içeriğindeki `___` çizgi
 * blokları ile `{{degisken}}` kalıplarını tespit eder, bağlı müşteri/portföy
 * verisinden önerilen değerlerle listeler. Kullanıcı değerleri düzenler,
 * "Uygula" ile içerik güncellenir (önceki hali sürüm geçmişine yazılır).
 */

export type FieldSuggestions = {
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  propertyLabel?: string | null;
  propertyAddress?: string | null;
  priceText?: string | null;
  todayText: string;
};

type DetectedField = {
  /** Eşleşmenin content içindeki sırası (0-tabanlı) — uygulamada konum anahtarı */
  index: number;
  /** Kullanıcıya gösterilen etiket (satır bağlamından veya {{ad}} içinden) */
  label: string;
  /** Müşteri/portföy verisinden otomatik öneri (yoksa boş) */
  suggestion: string;
};

// ___ (3+ alt çizgi) veya {{degisken}} — tespit ve değiştirme aynı regex'le
const PLACEHOLDER_RE = /\{\{\s*[^}]*\s*\}\}|_{3,}/g;

/** Etiketten (satır bağlamı) öneri türet — TR anahtar kelime eşleştirme. */
function suggestFor(label: string, s: FieldSuggestions): string {
  const l = label
    .toLocaleLowerCase("tr-TR")
    .replace(/i̇/g, "i"); // toLocaleLowerCase İ → i̇ (noktalı) normalize
  const has = (...keys: string[]) => keys.some((k) => l.includes(k));

  // TC kimlik önerilmez — sistemde saklanmıyor, elle girilir
  if (has("t.c", "tc kimlik", "kimlik no")) return "";
  if (has("telefon", "gsm", "cep")) return s.customerPhone ?? "";
  if (has("e-posta", "eposta", "email")) return s.customerEmail ?? "";
  if (has("adres")) return s.propertyAddress ?? "";
  if (has("taşınmaz", "tasinmaz", "portföy", "portfoy", "kira konusu", "konu taşınmaz", "gayrimenkul"))
    return s.propertyLabel ?? "";
  if (has("bedel", "fiyat", "tutar", "kira", "kapora", "bütçe", "butce")) return s.priceText ?? "";
  if (has("tarih")) return s.todayText;
  if (has("müşteri", "musteri", "alıcı", "alici", "kiracı", "kiraci", "sayın", "sayin"))
    return s.customerName ?? "";
  // Mal sahibi / satıcı çoğu akışta sistemdeki müşterinin kendisidir
  if (has("mal sahibi", "satıcı", "satici", "kiraya veren", "iş sahibi", "is sahibi"))
    return s.customerName ?? "";
  return "";
}

/** İçerikteki yer tutucuları satır bağlamıyla birlikte çıkarır. */
function detectFields(content: string, s: FieldSuggestions): DetectedField[] {
  const fields: DetectedField[] = [];
  let m: RegExpExecArray | null;
  let index = 0;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(content)) !== null) {
    const raw = m[0];
    let label: string;
    if (raw.startsWith("{{")) {
      // {{satis_bedeli}} → "satis_bedeli"
      label = raw.replace(/^\{\{\s*|\s*\}\}$/g, "").trim() || `Alan ${index + 1}`;
    } else {
      // ___ → aynı satırda solda kalan metin (ör. "Satıcı:" → "Satıcı")
      const lineStart = content.lastIndexOf("\n", m.index) + 1;
      const before = content.slice(lineStart, m.index).replace(/[:\-–—]\s*$/, "").trim();
      label = before || `Alan ${index + 1}`;
      // Aynı satırda birden çok boşluk varsa (İmza satırları) sıra numarası ekle
    }
    fields.push({ index, label, suggestion: suggestFor(label, s) });
    index += 1;
  }
  return fields;
}

/** i. yer tutucuyu values[i] boş değilse doldurur; boşsa olduğu gibi bırakır. */
function applyValues(content: string, values: Record<number, string>): string {
  let i = -1;
  return content.replace(PLACEHOLDER_RE, (raw) => {
    i += 1;
    const v = (values[i] ?? "").trim();
    return v ? v : raw;
  });
}

const init: ContractResult = {};

export function FillFieldsDialog({
  contractId,
  body,
  suggestions,
}: {
  contractId: string;
  body: string;
  suggestions: FieldSuggestions;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const fields = useMemo(() => detectFields(body, suggestions), [body, suggestions]);
  // Başlangıç değerleri: öneriler önceden dolu gelir, kullanıcı düzenler
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.index, f.suggestion])),
  );

  const filledCount = fields.filter((f) => (values[f.index] ?? "").trim()).length;

  function handleApply() {
    setError(null);
    const next = applyValues(body, values);
    if (next === body) {
      setError("Doldurulacak değer girilmedi — içerik değişmedi.");
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", contractId);
      fd.set("body", next);
      const res = await updateContractBody(init, fd);
      if (res.ok) setOpen(false);
      else setError(res.error ?? "İçerik güncellenemedi.");
    });
  }

  if (fields.length === 0) return null; // Yer tutucu yoksa buton gereksiz

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-brand-600 transition hover:bg-brand-600/5"
        >
          <Wand2 className="h-3.5 w-3.5" /> Alanları doldur
          <span className="rounded-full bg-brand-600/10 px-1.5 text-[10px] font-bold">{fields.length}</span>
        </button>
      </DialogTrigger>

      <DialogContent size="lg">
        <DialogHeader
          icon={<Wand2 />}
          title="Alanları doldur"
          description="İçerikteki boş alanlar tespit edildi; müşteri ve portföy verisinden öneriler hazır."
        />
        <DialogBody className="max-h-[55vh] space-y-3 overflow-y-auto">
          <p className="text-xs text-text-muted">
            {fields.length} alan bulundu. Boş bıraktığınız alanlar içerikte değiştirilmeden kalır.
          </p>
          {fields.map((f) => (
            <div key={f.index} className="grid gap-1.5 sm:grid-cols-[minmax(0,200px)_1fr] sm:items-center">
              <label
                htmlFor={`alan-${f.index}`}
                className="truncate text-sm font-semibold text-ink-950"
                title={f.label}
              >
                {f.label}
              </label>
              <div className="flex items-center gap-2">
                <input
                  id={`alan-${f.index}`}
                  type="text"
                  value={values[f.index] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.index]: e.target.value }))}
                  placeholder="Boş bırak — değiştirme"
                  className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm text-ink-950 outline-none focus:border-brand-300"
                />
                {f.suggestion && (values[f.index] ?? "") !== f.suggestion ? (
                  <button
                    type="button"
                    onClick={() => setValues((v) => ({ ...v, [f.index]: f.suggestion }))}
                    className="shrink-0 text-[11px] font-semibold text-brand-600 hover:underline"
                    title={`Öneri: ${f.suggestion}`}
                  >
                    Öneriyi al
                  </button>
                ) : null}
              </div>
            </div>
          ))}

          {error ? (
            <p className="rounded-[8px] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <span className="mr-auto text-xs text-text-faint">
            {filledCount}/{fields.length} alan dolu
          </span>
          <DialogClose asChild>
            <Button variant="secondary">Vazgeç</Button>
          </DialogClose>
          <Button onClick={handleApply} loading={pending}>
            Uygula ve kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
