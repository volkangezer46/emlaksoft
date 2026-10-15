"use client";

import { useEffect, useState } from "react";
import { CloudOff, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IntakeCustomerForm } from "@/components/app/intake-customer-form";
import { OFFLINE_NOTES_KEY, parseOfflineNotes, splitByScope, type OfflineNote } from "@/lib/pwa/intake";
import { formatDateTimeTr } from "@/lib/format";
import { formatPhoneDisplay } from "@/lib/phone";

function readNotes(): OfflineNote[] {
  try {
    return parseOfflineNotes(localStorage.getItem(OFFLINE_NOTES_KEY));
  } catch {
    return [];
  }
}

function writeNotes(notes: OfflineNote[]) {
  try {
    if (notes.length === 0) localStorage.removeItem(OFFLINE_NOTES_KEY);
    else localStorage.setItem(OFFLINE_NOTES_KEY, JSON.stringify(notes));
  } catch {
    /* depolama yok */
  }
}

/**
 * Çevrimdışı alınan notlar (public/offline.html) bağlantı gelince burada müşteri kaydına dönüşür (MP9).
 * Yalnız AYNI oturum kapsamında alınan notlar gösterilir; başka oturumun notları içerik gösterilmeden silinebilir.
 * Not yoksa hiçbir şey çizmez.
 */
export function OfflineNotesInbox({ scope, canCreateCustomer }: { scope: string | null; canCreateCustomer: boolean }) {
  const [notes, setNotes] = useState<OfflineNote[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    // Depolama okuması yalnız istemcide (SSR'de localStorage yok); sonraki çizimde gösterilir.
    const id = requestAnimationFrame(() => setNotes(readNotes()));
    return () => cancelAnimationFrame(id);
  }, []);

  if (!notes || notes.length === 0 || !scope) return null;
  const { mine, foreign } = splitByScope(notes, scope);
  if (mine.length === 0 && foreign.length === 0) return null;

  const remove = (ids: string[]) => {
    const next = readNotes().filter((n) => !ids.includes(n.id));
    writeNotes(next);
    setNotes(next);
  };

  return (
    <section aria-labelledby="offline-notes-title" className="rounded-[var(--radius-panel)] border border-amber-500/30 bg-amber-500/6 p-4">
      <h2 id="offline-notes-title" className="flex items-center gap-2 text-sm font-bold text-ink-950">
        <CloudOff className="h-4 w-4 text-amber-600" aria-hidden />
        Çevrimdışı aldığınız notlar ({mine.length})
      </h2>
      {mine.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {mine.map((n) => (
            <li key={n.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-950">{n.name || "İsimsiz not"}</p>
                  {n.phone ? <p className="text-xs text-text-muted">{formatPhoneDisplay(n.phone)}</p> : null}
                  {n.note ? <p className="mt-1 whitespace-pre-line text-sm text-text-muted">{n.note}</p> : null}
                  <p className="mt-1 text-xs text-text-faint">{n.at ? formatDateTimeTr(new Date(n.at).toISOString()) : ""}</p>
                </div>
                <Button variant="ghost" size="icon" aria-label="Notu sil" onClick={() => remove([n.id])}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {canCreateCustomer ? (
                openId === n.id ? (
                  <div className="mt-3 border-t border-line pt-3">
                    <IntakeCustomerForm
                      requestId={n.id}
                      defaultName={n.name}
                      defaultPhone={n.phone}
                      defaultNote={n.note}
                      // Depodan hemen silinir; satır başarı kartıyla bu görünümde kalır (sayfa yenilenince gider).
                      onSaved={() => writeNotes(readNotes().filter((x) => x.id !== n.id))}
                    />
                  </div>
                ) : (
                  <Button variant="outline" size="sm" icon={UserPlus} className="mt-3" onClick={() => setOpenId(n.id)}>
                    Müşteri olarak kaydet
                  </Button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {foreign.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-3 text-sm sm:flex-row sm:items-center">
          <p className="flex-1 text-text-muted">
            Bu cihazda başka bir oturumda alınmış {foreign.length} not var. Gizlilik nedeniyle içerikleri gösterilmez.
          </p>
          <Button variant="outline" size="sm" icon={Trash2} onClick={() => remove(foreign.map((n) => n.id))}>
            Bu notları sil
          </Button>
        </div>
      ) : null}
    </section>
  );
}
