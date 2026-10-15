"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ListPlus, RotateCcw, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormInput } from "@/components/ui/form-controls";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/app/toast-provider";
import { saveOrientationTemplate, type RecruitResult } from "@/app/actions/recruiting";
import { ORIENTATION_MAX_ITEMS, type OrientationTemplateItem } from "@/lib/recruiting/logic";

const init: RecruitResult = {};

/** Sabit alanları gönderimde FormData'ya ekler (ham gizli alan yerine; dokunma hedefi sözleşmesi). */
function withFields(action: (fd: FormData) => void, fields: Record<string, string>) {
  return (fd: FormData) => {
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    action(fd);
  };
}

type Row = OrientationTemplateItem & { key: number };

/**
 * Oryantasyon şablonu düzenleyici: adım (başlık + kısa açıklama + "kaçıncı gün") ekle/çıkar/sırala. Kaydedilen liste
 * yeni üyede oryantasyon başlatıldığında kopyalanır; zaten başlamış listeler değişmez.
 */
export function OrientationTemplateEditor({ items, custom }: { items: OrientationTemplateItem[]; custom: boolean }) {
  const { push } = useToast();
  const [state, action, pending] = useActionState(saveOrientationTemplate, init);
  const nextKey = useRef(items.length);
  const resetForm = useRef<HTMLFormElement>(null);
  const [rows, setRows] = useState<Row[]>(() => items.map((it, i) => ({ ...it, key: i })));

  useEffect(() => {
    if (state.ok && state.info) push(state.info, "ok");
    else if (state.error) push(state.error, "err");
  }, [state, push]);

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (index: number, dir: -1 | 1) =>
    setRows((rs) => {
      const j = index + dir;
      if (j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[index], copy[j]] = [copy[j]!, copy[index]!];
      return copy;
    });

  return (
    <div className="space-y-3">
      <form action={action} className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:p-5">
        <div>
          <h2 className="font-display text-base font-bold text-ink-950">Yeni danışman oryantasyonu</h2>
          <p className="text-xs text-text-muted">
            {custom ? "Ofisinizin şablonu." : "Önerilen varsayılan şablon; değiştirip kaydedebilirsiniz."} Oryantasyon, aday &quot;Katıldı&quot;ya
            bağlanınca ya da danışman sayfasından başlatılır; her adım danışmana görev olarak atanır ve ilerleme danışman sayfasında görünür.
          </p>
        </div>
        <ol className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.key} className="rounded-[var(--radius-card)] border border-line bg-canvas p-2.5">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-start">
                <div className="space-y-2">
                  <label className="sr-only" htmlFor={`tpl-title-${r.key}`}>
                    Adım {i + 1} başlığı
                  </label>
                  <FormInput id={`tpl-title-${r.key}`} name="title" value={r.title} onChange={(e) => update(r.key, { title: e.target.value })} maxLength={160} placeholder="Örn. Portal hesaplarının açılması" required />
                  <label className="sr-only" htmlFor={`tpl-desc-${r.key}`}>
                    Adım {i + 1} açıklaması
                  </label>
                  <FormInput
                    id={`tpl-desc-${r.key}`}
                    name="description"
                    value={r.description ?? ""}
                    onChange={(e) => update(r.key, { description: e.target.value })}
                    maxLength={500}
                    placeholder="Kısa açıklama (isteğe bağlı)"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-text-muted" htmlFor={`tpl-day-${r.key}`}>
                    Kaçıncı gün
                  </label>
                  <FormInput
                    id={`tpl-day-${r.key}`}
                    name="offset_days"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={180}
                    value={r.offsetDays}
                    onChange={(e) => update(r.key, { offsetDays: Math.max(0, Math.min(180, Number(e.target.value) || 0)) })}
                  />
                </div>
                <div className="flex items-center gap-1 sm:flex-col sm:pt-5">
                  <Button type="button" size="icon" variant="ghost" icon={ArrowUp} aria-label={`Adım ${i + 1} yukarı`} disabled={i === 0} onClick={() => move(i, -1)} />
                  <Button type="button" size="icon" variant="ghost" icon={ArrowDown} aria-label={`Adım ${i + 1} aşağı`} disabled={i === rows.length - 1} onClick={() => move(i, 1)} />
                  <Button type="button" size="icon" variant="ghost" icon={X} aria-label={`Adım ${i + 1} kaldır`} disabled={rows.length <= 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} />
                </div>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {rows.length < ORIENTATION_MAX_ITEMS ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={ListPlus}
              onClick={() => setRows((rs) => [...rs, { key: nextKey.current++, title: "", description: null, offsetDays: rs.at(-1)?.offsetDays ?? 0 }])}
            >
              Adım ekle
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" icon={Save} loading={pending} className="w-full sm:w-auto">
            Şablonu kaydet
          </Button>
        </div>
      </form>
      {custom ? (
        <form ref={resetForm} action={withFields(action, { reset: "1" })}>
          <ConfirmDialog
            title="Varsayılan şablona dönülsün mü?"
            description="Ofisinizin şablonu silinir, önerilen varsayılan liste kullanılır. Başlamış oryantasyonlar değişmez."
            confirmLabel="Varsayılana dön"
            onConfirm={() => resetForm.current?.requestSubmit()}
            trigger={
              <Button type="button" variant="ghost" size="sm" icon={RotateCcw}>
                Varsayılan şablona dön
              </Button>
            }
          />
        </form>
      ) : null}
    </div>
  );
}
