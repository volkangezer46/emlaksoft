"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Loader2 } from "lucide-react";
import { confirmPortalListingsBulk } from "@/app/actions/portal-listings";
import { useToast } from "@/components/app/toast-provider";
import { ConfirmedListingsContext } from "./confirm-listing-button";

/**
 * Toplu teyit sarmalayıcısı — sayfaya özel client bileşen.
 * Satırlar sunucuda render edilir ve children olarak gelir; buradaki form
 * yalnızca `name="ids"` checkbox'larını toplar. Seçim sayacı, change
 * olayının forma kabarcıklanmasıyla (onChange) güncellenir — satır başına
 * client state gerekmez.
 *
 * React 19 optimistic desen: "Seçilenleri teyit et" tıklanır tıklanmaz seçili
 * satırların teyit butonları ConfirmedListingsContext üzerinden yeşil
 * "Teyit edildi ✓" durumuna geçer; action arkada çalışır. Başarıda kalıcı
 * state ile teyitli kalırlar, hatada optimistic küme kendiliğinden geri
 * sarılır (+ toast ve refresh).
 */
export function BulkConfirmForm({
  selectableCount,
  children,
}: {
  /** Bu sayfada checkbox'ı olan (canlı) ilan sayısı */
  selectableCount: number;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { push } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [selected, setSelected] = useState(0);
  const [pending, startTransition] = useTransition();
  const [savedConfirmed, setSavedConfirmed] = useState<ReadonlySet<string>>(new Set());
  const [optimisticConfirmed, markConfirmed] = useOptimistic(
    savedConfirmed,
    (prev, ids: readonly string[]) => new Set([...prev, ...ids]) as ReadonlySet<string>,
  );

  function boxes() {
    return [...(formRef.current?.querySelectorAll<HTMLInputElement>('input[name="ids"]') ?? [])];
  }

  function recount() {
    setSelected(boxes().filter((b) => b.checked).length);
  }

  function toggleAll() {
    const all = boxes();
    const target = !all.every((b) => b.checked);
    all.forEach((b) => (b.checked = target));
    recount();
  }

  function submitBulk() {
    const form = formRef.current;
    if (!form || pending) return; // çifte tıklama koruması
    const fd = new FormData(form);
    const ids = fd.getAll("ids").map(String);
    if (ids.length === 0) return;
    startTransition(async () => {
      markConfirmed(ids); // seçili satırlar ANINDA teyitli görünür
      boxes().forEach((b) => (b.checked = false));
      setSelected(0);
      try {
        await confirmPortalListingsBulk(fd);
        setSavedConfirmed((prev) => new Set([...prev, ...ids])); // revalidate sonrası da kalıcı
      } catch {
        push("Teyit edilemedi", "err");
        router.refresh();
      }
    });
  }

  return (
    <ConfirmedListingsContext.Provider value={optimisticConfirmed}>
      <form ref={formRef} onChange={recount}>
        {selectableCount > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-canvas/60 px-5 py-2.5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleAll}
                className="focus-ring text-[11px] font-semibold text-text-muted underline-offset-2 transition hover:text-brand-600 hover:underline"
              >
                {selected === selectableCount ? "Seçimi bırak" : "Tümünü seç"}
              </button>
              <span className="text-[11px] tabular-nums text-text-faint">
                {selected > 0 ? `${selected} ilan seçildi` : `${selectableCount} canlı ilan`}
              </span>
            </div>
            <button
              type="button"
              onClick={submitBulk}
              disabled={pending || selected === 0}
              className="focus-ring press inline-flex items-center gap-1.5 rounded-[9px] bg-mint-500/12 px-3 py-1.5 text-xs font-semibold text-mint-600 transition hover:bg-mint-500/20 disabled:opacity-45"
            >
              {pending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Teyit ediliyor…
                </>
              ) : (
                <>
                  <CheckCheck className="h-3.5 w-3.5" /> Seçilenleri teyit et{selected > 0 ? ` (${selected})` : ""}
                </>
              )}
            </button>
          </div>
        ) : null}
        {children}
      </form>
    </ConfirmedListingsContext.Provider>
  );
}
