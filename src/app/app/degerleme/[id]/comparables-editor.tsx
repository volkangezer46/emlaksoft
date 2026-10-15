"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { ExternalLink, ListChecks, Plus, RotateCcw, Trash2, UserPen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { FormField, Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/app/toast-provider";
import {
  addManualComparable,
  removeManualComparable,
  resetComparableSelection,
  saveComparableSelection,
  type ComparableSelectionResult,
} from "@/app/actions/valuations";

export type EditorRow = {
  key: string;
  kind: "engine" | "manual";
  label: string;
  href: string | null;
  sourceLabel: string;
  rooms: string | null;
  sqm: number | null;
  price: number;
  sqmPrice: number | null;
  included: boolean;
  manualId?: string;
  sourceUrl?: string | null;
};

function money(n: number | null) {
  if (n == null) return "—";
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

/**
 * PF-02 — Danışmanın emsal seçimi. Anahtar açık = emsal rapora ve hesaba girer. Her değişiklik anında kaydedilir,
 * değerleme (orta değer, bant, güven) sunucuda AYNI kuralla yeniden hesaplanır. Elle emsal "Danışman girdisi"
 * etiketiyle rapora girer; güveni "yüksek"e taşımaz. "Motorun seçimine dön" ilk sonucu geri yükler.
 */
export function ComparablesEditor({
  valuationId,
  rows,
  edited,
  needsTargetSqm,
}: {
  valuationId: string;
  rows: EditorRow[];
  edited: boolean;
  needsTargetSqm: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [excluded, setExcluded] = useState<Set<string>>(
    () => new Set(rows.filter((r) => r.kind === "engine" && !r.included).map((r) => r.key)),
  );
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const engineRows = rows.filter((r) => r.kind === "engine");
  const manualRows = rows.filter((r) => r.kind === "manual");
  const includedCount = engineRows.filter((r) => !excluded.has(r.key)).length + manualRows.length;

  const done = (res: ComparableSelectionResult, okMessage: string) => {
    if (res.error) {
      push(res.error, "err");
      return false;
    }
    push(res.mid != null ? `${okMessage} · Yeni beklenen değer ${money(res.mid)}` : `${okMessage} · Fiyat kanıtı kalmadı, değer üretilmedi`, "ok");
    router.refresh();
    return true;
  };

  const toggle = (key: string, include: boolean) => {
    const prev = excluded;
    const next = new Set(prev);
    if (include) next.delete(key);
    else next.add(key);
    setExcluded(next);
    startTransition(async () => {
      const res = await saveComparableSelection(valuationId, [...next]);
      if (!done(res, include ? "Emsal rapora alındı" : "Emsal rapordan çıkarıldı")) setExcluded(prev);
    });
  };

  const submitManual = (fd: FormData) => {
    setFormError(null);
    startTransition(async () => {
      const res = await addManualComparable(valuationId, fd);
      if (res.error) {
        setFormError(res.error);
        return;
      }
      formRef.current?.reset();
      setAdding(false);
      done(res, "Elle emsal eklendi");
    });
  };

  return (
    <section
      aria-labelledby="emsal-secimi"
      className="no-print rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="emsal-secimi" className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
            <ListChecks className="h-4 w-4 text-brand-600" /> Emsal seçimi
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">
            Rapora girecek emsalleri siz belirleyin. Uygun olmayanı (farklı site, hasarlı daire) kapatın; portalda
            gördüğünüz güncel ilanı elle ekleyin. Değer her değişiklikte aynı kuralla yeniden hesaplanır.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {edited ? (
            <ConfirmDialog
              title="Motorun seçimine dönülsün mü?"
              description="Çıkardığınız emsaller geri alınır, elle eklediğiniz emsaller silinir; değerleme ilk hesaplanan değerlere döner."
              confirmLabel="Motorun seçimine dön"
              onConfirm={async () => {
                const res = await resetComparableSelection(valuationId);
                if (done(res, "Motorun seçimine dönüldü")) setExcluded(new Set());
              }}
              trigger={
                <Button variant="outline" size="sm">
                  <RotateCcw /> Motorun seçimine dön
                </Button>
              }
            />
          ) : null}
          <Button variant={adding ? "secondary" : "primary"} size="sm" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
            {adding ? <X /> : <Plus />} {adding ? "Vazgeç" : "Elle emsal ekle"}
          </Button>
        </div>
      </div>

      <p className="mt-3 text-xs font-semibold text-text-muted" aria-live="polite">
        {includedCount} emsal rapora giriyor
        {engineRows.length - engineRows.filter((r) => !excluded.has(r.key)).length > 0
          ? ` · ${engineRows.filter((r) => excluded.has(r.key)).length} çıkarıldı`
          : ""}
        {manualRows.length > 0 ? ` · ${manualRows.length} danışman girdisi` : ""}
        {pending ? " · kaydediliyor…" : ""}
      </p>

      {adding ? (
        <form
          ref={formRef}
          action={submitManual}
          className="motion-enter mt-4 grid gap-3 rounded-[var(--radius-card)] border border-brand-300/50 bg-brand-600/5 p-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <FormField label="Fiyat (₺)" htmlFor="mc-price" required>
            <Input id="mc-price" name="price" inputMode="numeric" required placeholder="4.250.000" autoComplete="off" />
          </FormField>
          <FormField label="Brüt m²" htmlFor="mc-sqm" required>
            <Input id="mc-sqm" name="sqm" inputMode="decimal" required placeholder="120" autoComplete="off" />
          </FormField>
          <FormField label="Oda" htmlFor="mc-rooms">
            <Input id="mc-rooms" name="rooms" maxLength={20} placeholder="3+1" autoComplete="off" />
          </FormField>
          <FormField label="Kat" htmlFor="mc-floor">
            <Input id="mc-floor" name="floor" inputMode="numeric" placeholder="4" autoComplete="off" />
          </FormField>
          <FormField label="Kısa tanım" htmlFor="mc-title" hint="Kişisel bilgi yazmayın.">
            <Input id="mc-title" name="title" maxLength={120} placeholder="Aynı site, B blok" autoComplete="off" />
          </FormField>
          <FormField label="İlan bağlantısı" htmlFor="mc-url">
            <Input id="mc-url" name="source_url" type="url" inputMode="url" placeholder="https://" autoComplete="off" />
          </FormField>
          {needsTargetSqm ? (
            <FormField label="Değerlenen taşınmazın m²'si" htmlFor="mc-target" required hint="Kayıtta m² yok; hesap için gerekli.">
              <Input id="mc-target" name="target_sqm" inputMode="decimal" required placeholder="110" autoComplete="off" />
            </FormField>
          ) : null}
          {formError ? (
            <p role="alert" className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600 sm:col-span-2 lg:col-span-3">
              {formError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-3">
            <Button type="submit" loading={pending}>
              <Plus /> Emsali ekle
            </Button>
          </div>
        </form>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-muted">
          Bu değerlemede motorun bulduğu emsal yok. Portalda gördüğünüz güncel ilanları elle ekleyerek emsal analizi oluşturabilirsiniz.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line">
          {rows.map((r) => {
            const on = r.kind === "manual" ? true : !excluded.has(r.key);
            return (
              <li
                key={r.key}
                className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3 transition sm:flex-nowrap sm:px-4 ${on ? "bg-surface" : "bg-canvas opacity-70"}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-950">
                    {r.href ? (
                      <Link href={r.href} className="focus-ring rounded-[var(--radius-control)] hover:text-brand-600 hover:underline">
                        {r.label}
                      </Link>
                    ) : (
                      <span className="truncate">{r.label}</span>
                    )}
                    {r.kind === "manual" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-700">
                        <UserPen className="h-3 w-3" /> Danışman girdisi
                      </span>
                    ) : (
                      <span className="rounded-full bg-ink-950/5 px-2 py-0.5 text-xs font-semibold text-text-muted">{r.sourceLabel}</span>
                    )}
                    {r.sourceUrl ? (
                      <a
                        href={r.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] text-xs font-semibold text-brand-600 hover:underline"
                      >
                        İlan <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </p>
                  <p className="numeric mt-0.5 text-xs text-text-muted">
                    {[r.rooms, r.sqm != null ? `${r.sqm} m²` : null, money(r.price), r.sqmPrice != null ? `${money(r.sqmPrice)}/m²` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {r.kind === "manual" ? (
                  <ConfirmDialog
                    title="Elle emsal silinsin mi?"
                    description="Emsal rapordan ve hesaptan çıkarılır."
                    confirmLabel="Sil"
                    onConfirm={async () => {
                      done(await removeManualComparable(valuationId, r.manualId ?? ""), "Elle emsal silindi");
                    }}
                    trigger={
                      <Button variant="ghost" size="icon" aria-label={`${r.label} emsalini sil`}>
                        <Trash2 className="text-danger-500" />
                      </Button>
                    }
                  />
                ) : (
                  <label className="flex shrink-0 items-center gap-2 text-xs font-semibold text-text-muted">
                    <span className="w-16 text-right">{on ? "Raporda" : "Çıkarıldı"}</span>
                    <Switch
                      checked={on}
                      disabled={pending}
                      onCheckedChange={(next) => toggle(r.key, next)}
                      aria-label={`${r.label} emsalini ${on ? "rapordan çıkar" : "rapora al"}`}
                    />
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
