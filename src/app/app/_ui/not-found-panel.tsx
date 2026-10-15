"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft, Home, SearchX, Trash2 } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { notFoundTarget } from "./not-found-target";

const PRIMARY =
  "focus-ring press inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-5 text-sm font-semibold text-white transition hover:bg-accent-hover touch:min-h-11";
const SECONDARY =
  "focus-ring press inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-5 text-sm font-semibold text-ink-950 transition hover:border-brand-300 touch:min-h-11";

/**
 * Kabuk İÇİNDE 404 (menü ve üst çubuk yerinde kalır): silinmiş / olmayan kayıtta listeye dönüş + Çöp kutusu,
 * olmayan sayfada ana ekran. Başlık bağlanınca odaklanır (klavye ve ekran okuyucu kullanıcısı ne olduğunu duyar).
 */
export function NotFoundPanel({ lists }: { lists: readonly (readonly [string, string])[] }) {
  const pathname = usePathname() ?? "";
  const target = notFoundTarget(pathname, lists);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [pathname]);
  const record = target.kind === "record";
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4 py-10">
      <section aria-labelledby="app-not-found-title" className="w-full max-w-md text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-[var(--radius-card)] border border-line bg-surface-raised">
          <SearchX className="h-7 w-7 text-text-muted" aria-hidden="true" />
        </div>
        <h2 id="app-not-found-title" ref={headingRef} tabIndex={-1} className="mt-4 font-display text-lg font-bold text-ink-950 outline-none">
          {record ? "Kayıt bulunamadı ya da silinmiş" : "Sayfa bulunamadı"}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-muted">
          {record
            ? "Bağlantı eski olabilir ya da kayıt silinmiş olabilir. Silinen müşteri ve portföyler 90 gün boyunca Çöp kutusundan geri alınabilir."
            : "Adres yanlış yazılmış ya da sayfa kaldırılmış olabilir. Menüden ya da arama kutusundan devam edebilirsiniz."}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {target.kind === "record" ? (
            <>
              <Link href={target.listHref} className={PRIMARY}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                {target.listLabel} listesine dön
              </Link>
              <Link href="/app/ayarlar/cop-kutusu" className={SECONDARY}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Çöp kutusu
              </Link>
            </>
          ) : (
            <Link href="/app" className={PRIMARY}>
              <Home className="h-4 w-4" aria-hidden="true" />
              Ana ekrana dön
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
