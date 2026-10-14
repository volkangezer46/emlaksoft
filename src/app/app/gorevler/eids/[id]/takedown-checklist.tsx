"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleDashed, ExternalLink, RotateCcw, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTimeTr } from "@/lib/format";
import { useToast } from "@/components/app/toast-provider";
import { completeTakedownTask, markTakedownItem, restoreTakedownSurfaces, type TakedownActionResult } from "@/app/actions/eids-takedown";
import {
  TAKEDOWN_ITEM_STATUS_LABELS,
  TAKEDOWN_VERIFIED_LABELS,
  canCloseTakedown,
  isTakedownItemStatus,
  takedownTargetLabel,
} from "@/lib/eids/actions-core";

export type ChecklistItem = {
  id: string;
  target: string;
  status: string;
  verified_by: string | null;
  done_at: string | null;
  portal_url: string | null;
};

/**
 * Kaldırma kontrol listesi (istemci adası). Her kalem "Kaldırıldı" ya da "Yayında değildi" ile işaretlenir; eklentinin
 * doğruladığı kalem kendiliğinden işaretli gelir. Görev yalnız tüm kalemler işaretlenince kapanır.
 */
export function TakedownChecklist({
  taskId,
  items,
  open,
  canEdit,
  canRestore,
  hasExtension,
}: {
  taskId: string;
  items: ChecklistItem[];
  open: boolean;
  canEdit: boolean;
  canRestore: boolean;
  hasExtension: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const done = canCloseTakedown(items);
  const left = items.filter((i) => i.status === "pending").length;
  const hasAuto = items.some((i) => i.verified_by === "system" && i.status === "removed");

  function run(fn: () => Promise<TakedownActionResult>, okMsg?: string) {
    start(async () => {
      try {
        const r = await fn();
        if (r.error) push(r.error, "err");
        else {
          push(r.info ?? okMsg ?? "Kaydedildi", "ok");
          router.refresh();
        }
      } catch {
        push("İşlem tamamlanamadı: bağlantı sorunu olabilir; birkaç saniye sonra tekrar deneyin.", "err");
      }
    });
  }

  return (
    <section aria-labelledby="kontrol-listesi" className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="kontrol-listesi" className="font-display text-base font-bold text-ink-950">
          Kaldırma kontrol listesi
        </h2>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${left > 0 ? "bg-danger-500/10 text-danger-600" : "bg-mint-500/12 text-mint-700"}`}>
          {left > 0 ? `${left} kalem bekliyor` : "Tüm kalemler işaretlendi"}
        </span>
      </div>
      <p className="text-xs text-text-muted">
        {hasExtension
          ? "Ofisinizde ilan kontrol eklentisi var: portaldaki ilan kalktığında kalem kendiliğinden işaretlenir. Beklemeden elle de işaretleyebilirsiniz."
          : "Ofisinizde ilan kontrol eklentisi yok: her kalemi ilanı kaldırdıktan sonra elle işaretleyin."}
      </p>
      <ul className="divide-y divide-line">
        {items.map((it) => {
          const st = isTakedownItemStatus(it.status) ? it.status : "pending";
          const Icon = st === "pending" ? CircleDashed : st === "removed" ? CheckCircle2 : XCircle;
          return (
            <li key={it.id} className="flex flex-wrap items-center gap-3 py-3">
              <Icon aria-hidden="true" className={`h-5 w-5 shrink-0 ${st === "pending" ? "text-amber-600" : "text-mint-600"}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-950">{takedownTargetLabel(it.target)}</p>
                <p className="text-xs text-text-muted">
                  {TAKEDOWN_ITEM_STATUS_LABELS[st]}
                  {it.verified_by ? ` · ${TAKEDOWN_VERIFIED_LABELS[it.verified_by] ?? it.verified_by}` : ""}
                  {it.done_at ? ` · ${formatDateTimeTr(it.done_at)}` : ""}
                </p>
              </div>
              {it.portal_url ? (
                <a
                  href={it.portal_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="focus-ring inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline touch:min-h-11"
                >
                  <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /> İlanı aç
                </a>
              ) : null}
              {st === "pending" && open && canEdit ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="navy" icon={CheckCircle2} disabled={pending} onClick={() => run(() => markTakedownItem(it.id, "removed"), "Kalem işaretlendi")}>
                    Kaldırıldı
                  </Button>
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => markTakedownItem(it.id, "not_found"), "Kalem işaretlendi")}>
                    Yayında değildi
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {open && canEdit ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Button variant="primary" icon={ShieldCheck} loading={pending} disabled={!done} onClick={() => run(() => completeTakedownTask(taskId))}>
            Görevi tamamla
          </Button>
          {!done ? <span className="text-xs text-text-muted">Tüm kalemler işaretlenmeden görev kapanmaz.</span> : null}
          {canRestore && hasAuto ? (
            <Button variant="ghost" size="sm" icon={RotateCcw} disabled={pending} onClick={() => run(() => restoreTakedownSurfaces(taskId))}>
              Vitrini ve paylaşımı geri aç
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
