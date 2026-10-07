"use client";

import { useCallback, useState } from "react";
import Link from "@/components/ui/smart-link";
import { AlertTriangle, ExternalLink, Lock } from "lucide-react";
import { useDuplicateCheck, type DuplicateKind } from "@/components/app/use-duplicate-check";
import type { DuplicateHit } from "@/lib/duplicate-match";
import { DAY_MS, msSince } from "@/lib/clock";

/** Sunucunun kasıtlı mükerrer onayı olarak okuduğu form alanı (DUPLICATE_CONFIRM_FIELD). */
export const DUPLICATE_CONFIRM_FIELD = "allow_duplicate";

const KIND_META: Record<DuplicateKind, { title: string; base: string; again: string }> = {
  customer: { title: "Bu kişi ofiste kayıtlı olabilir", base: "/app/musteriler", again: "Yine de yeni kayıt" },
  property: { title: "Benzer portföy zaten var", base: "/app/portfoyler", again: "Yine de yeni kayıt" },
  demand: { title: "Bu müşterinin benzer açık talebi var", base: "/app/talepler", again: "Yine de yeni talep" },
};

function lastContactText(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor(msSince(iso) / DAY_MS);
  if (!Number.isFinite(days) || days < 0) return null;
  return days === 0 ? "bugün" : `${days} gün önce`;
}

function hitHref(kind: DuplicateKind, h: DuplicateHit): string | null {
  if (!h.id) return null;
  // Talep için kayıt kimliği talep detayına gider.
  return `${KIND_META[kind].base}/${h.id}`;
}

const priceFmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

/**
 * Satır içi mükerrer uyarı kartı. `<form>` İÇİNDE render edilmelidir (form elemanını kendisi bulur;
 * alanlara dokunmaz). "Yine de yeni kayıt" gizli `allow_duplicate=1` alanını açar; sunucu da bunu ister.
 * Eşleşme yoksa hiçbir şey çizmez.
 */
export function DuplicateHint({ kind }: { kind: DuplicateKind }) {
  const [form, setForm] = useState<HTMLFormElement | null>(null);
  // Kararlı ref geri çağrısı: sentinel bağlanınca içinde bulunduğu <form> bulunur (effect gerekmez).
  const sentinelRef = useCallback((el: HTMLSpanElement | null) => {
    setForm(el?.closest("form") ?? null);
  }, []);

  const { hits, loading } = useDuplicateCheck(form, kind);
  const signature = hits.map((h) => `${h.id ?? "x"}:${h.reasons.join(",")}`).join("|");
  const [confirmedFor, setConfirmedFor] = useState("");
  const confirmed = signature !== "" && confirmedFor === signature;
  const meta = KIND_META[kind];

  return (
    <>
      <span ref={sentinelRef} hidden />
      {confirmed ? <input type="hidden" name={DUPLICATE_CONFIRM_FIELD} value="1" /> : null}
      {hits.length > 0 ? (
        <div
          role="status"
          aria-live="polite"
          aria-busy={loading}
          className="rounded-[var(--radius-control)] border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2"
        >
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {meta.title}
          </p>
          <ul className="mt-2 space-y-2">
            {hits.map((h, i) => {
              const href = hitHref(kind, h);
              const contact = lastContactText(h.lastContact);
              return (
                <li key={h.id ?? `hidden-${i}`} className="rounded-[var(--radius-control)] bg-white/70 px-3 py-2">
                  {h.visible ? (
                    <>
                      <p className="font-medium text-ink-950">
                        {h.code ? <span className="mr-1 font-mono text-xs text-text-muted">{h.code}</span> : null}
                        {h.label ?? "Adsız kayıt"}
                      </p>
                      <p className="text-xs text-amber-900/80">
                        Eşleşme: {h.reasons.join(", ")}
                        {h.advisor ? ` · Danışman: ${h.advisor}` : ""}
                        {contact ? ` · Son temas: ${contact}` : ""}
                        {h.price != null ? ` · ${priceFmt.format(h.price)} ₺` : ""}
                        {h.status ? ` · ${h.status}` : ""}
                      </p>
                      {href ? (
                        <Link
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="focus-ring mt-1 inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-2"
                        >
                          Kaydı aç <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </Link>
                      ) : null}
                    </>
                  ) : (
                    <p className="flex items-center gap-2 text-xs">
                      <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Ofiste {h.reasons.join(" / ")} ile kayıt var; ayrıntıyı görme yetkiniz yok. Yöneticinize danışın.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {confirmed ? (
              <>
                <span className="text-xs font-semibold">Mükerrer olduğunu bilerek kaydedeceksiniz.</span>
                <button
                  type="button"
                  onClick={() => setConfirmedFor("")}
                  className="focus-ring text-xs font-semibold underline underline-offset-2"
                >
                  Vazgeç
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmedFor(signature)}
                className="focus-ring rounded-[var(--radius-control)] border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                {meta.again}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
