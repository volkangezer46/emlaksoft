"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, BookmarkPlus, Loader2, X } from "lucide-react";
import { useToast } from "@/components/app/toast-provider";
import { createSavedView, deleteSavedView, type SavedView } from "@/app/actions/saved-views";

/**
 * Kayıtlı görünümler şeridi — filtre çubuğunun hemen altına mount edilir.
 *
 * - Mevcut görünümler chip olarak listelenir; tıklayınca route + paramlarla
 *   gidilir. Mevcut URL paramlarıyla birebir eşleşen chip vurgulanır.
 * - "Görünümü kaydet" yalnız en az bir filtre aktifken görünür; küçük popover
 *   ad alır, server action ile kaydeder.
 * - Chip hover'ında × çıkar; silme iki adımlıdır (küçük onay popover'ı).
 * - initial liste SUNUCUDAN prop olarak gelir (sayfa listSavedViews çağırır);
 *   client fetch etmez, create/delete sonrası optimistik günceller +
 *   router.refresh() ile sunucu kopyasına hizalanır.
 */

/** Boş değerleri ve sayfalama paramını atar — karşılaştırma/kayıt öncesi normalize. */
function cleanParams(params: Record<string, string | undefined>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === "sayfa") continue;
    const trimmed = (value ?? "").trim();
    if (trimmed) clean[key] = trimmed;
  }
  return clean;
}

function sameParams(a: Record<string, string>, b: Record<string, string>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => a[key] === b[key]);
}

function hrefOf(route: string, params: Record<string, string>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) usp.set(key, value);
  const qs = usp.toString();
  return qs ? `${route}?${qs}` : route;
}

export function SavedViews({
  route,
  views: initialViews,
  currentParams,
  className,
}: {
  route: string;
  views: SavedView[];
  /** Sayfanın parse ettiği aktif searchParams (sayfa=1 hariç geçirilebilir; burada da ayıklanır). */
  currentParams: Record<string, string | undefined>;
  className?: string;
}) {
  const router = useRouter();
  const { push } = useToast();

  const [views, setViews] = useState<SavedView[]>(initialViews);
  // Sunucu revalidate edince (router.refresh / yeniden gezinme) prop güncellenir;
  // state render sırasında hizalanır (React "adjust state during render" deseni —
  // effect içinde setState cascading render lint kuralına takılır).
  const [prevInitial, setPrevInitial] = useState(initialViews);
  if (prevInitial !== initialViews) {
    setPrevInitial(initialViews);
    setViews(initialViews);
  }

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const active = cleanParams(currentParams);
  const hasFilters = Object.keys(active).length > 0;

  if (views.length === 0 && !hasFilters) return null;

  async function onSave(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const res = await createSavedView(route, trimmed, active);
      if (res.error) {
        push(res.error, "err");
        return;
      }
      if (res.view) {
        const view = res.view;
        setViews((prev) => [...prev.filter((v) => v.id !== view.id), view]);
      }
      setOpen(false);
      setName("");
      push("Görünüm kaydedildi", "ok");
      router.refresh();
    } catch {
      push("Görünüm kaydedilemedi", "err");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    setConfirmId(null);
    // Optimistik: chip hemen düşer; hata olursa refresh geri getirir.
    setViews((prev) => prev.filter((v) => v.id !== id));
    try {
      const res = await deleteSavedView(id);
      if (res.error) push(res.error, "err");
      else push("Görünüm silindi", "ok");
    } catch {
      push("Görünüm silinemedi", "err");
    } finally {
      router.refresh();
    }
  }

  return (
    <div className={className ?? "flex flex-wrap items-center gap-2"}>
      <span className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
        <Bookmark className="h-3.5 w-3.5" /> Kayıtlı görünümler:
      </span>

      {views.length === 0 ? (
        <span className="text-xs text-text-faint">Henüz yok — aktif filtreyi kaydedin.</span>
      ) : null}

      {views.map((view) => {
        const isActive = sameParams(cleanParams(view.params), active);
        return (
          <span key={view.id} className="group/chip relative inline-flex">
            <button
              type="button"
              onClick={() => router.push(hrefOf(route, view.params))}
              aria-current={isActive ? "page" : undefined}
              className={`focus-ring press inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                isActive
                  ? "border-brand-400/50 bg-brand-600/10 text-brand-600"
                  : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-brand-600"
              }`}
            >
              <Bookmark className={`h-3 w-3 ${isActive ? "text-brand-600" : "text-text-faint"}`} />
              {view.name}
            </button>
            <button
              type="button"
              onClick={() => setConfirmId(confirmId === view.id ? null : view.id)}
              aria-label={`${view.name} görünümünü sil`}
              className="absolute -right-1.5 -top-1.5 z-10 hidden h-4 w-4 place-items-center rounded-full bg-ink-950 text-white transition hover:bg-danger-500 group-hover/chip:grid"
            >
              <X className="h-2.5 w-2.5" />
            </button>
            {confirmId === view.id ? (
              <span className="absolute right-0 top-full z-20 mt-1.5 flex items-center gap-1.5 whitespace-nowrap rounded-[10px] border border-line bg-surface px-2.5 py-1.5 shadow-[var(--shadow-card)]">
                <span className="text-[11px] font-semibold text-ink-950">Silinsin mi?</span>
                <button
                  type="button"
                  onClick={() => onDelete(view.id)}
                  className="rounded-[7px] bg-danger-500 px-2 py-0.5 text-[11px] font-bold text-white transition hover:opacity-90"
                >
                  Sil
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmId(null)}
                  className="rounded-[7px] border border-line px-2 py-0.5 text-[11px] font-semibold text-text-muted transition hover:text-ink-950"
                >
                  Vazgeç
                </button>
              </span>
            ) : null}
          </span>
        );
      })}

      {hasFilters ? (
        <span className="relative inline-flex">
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            className="focus-ring press inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-strong px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-400 hover:text-brand-600"
          >
            <BookmarkPlus className="h-3.5 w-3.5" /> Görünümü kaydet
          </button>
          {open ? (
            <form
              onSubmit={onSave}
              className="absolute left-0 top-full z-20 mt-2 w-64 space-y-2 rounded-[14px] border border-line bg-surface p-3 shadow-[var(--shadow-card)]"
            >
              <label className="block text-[11px] font-semibold text-text-muted" htmlFor={`saved-view-name-${route}`}>
                Görünüm adı
              </label>
              <input
                id={`saved-view-name-${route}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
                autoFocus
                placeholder="Ör. Sıcak alıcılar"
                className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-[9px] px-2.5 py-1.5 text-xs font-semibold text-text-muted transition hover:text-ink-950"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={busy || !name.trim()}
                  className="inline-flex items-center gap-1.5 rounded-[9px] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Kaydet
                </button>
              </div>
            </form>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
