"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { Bookmark, BookmarkPlus, X } from "lucide-react";
import { deleteView, saveView } from "@/app/actions/finance-ledger";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Hareketler kayıtlı görünümleri (finance_saved_views; kullanıcıya özel). Görünüm = filtre parametreleri. Çipe tıklamak o
 * filtreli adrese gider; aynı filtre açıksa çip vurgulanır. "Bu görünümü kaydet" yalnız en az bir filtre açıkken görünür.
 */

export type SavedLedgerView = { id: string; name: string; params: Record<string, string> };

function sameViewParams(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

function viewHref(base: string, sekme: string, params: Record<string, string>): string {
  const sp = new URLSearchParams({ sekme });
  for (const [k, v] of Object.entries(params)) if (v && k !== "sekme" && k !== "sayfa") sp.set(k, v);
  return `${base}?${sp.toString()}`;
}

export function LedgerSavedViews({
  base,
  sekme,
  views,
  current,
}: {
  base: string;
  sekme: string;
  views: readonly SavedLedgerView[];
  current: Record<string, string>;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const hasFilter = Object.keys(current).length > 0;
  const already = views.some((v) => sameViewParams(v.params, current));
  if (views.length === 0 && !hasFilter) return null;

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const n = name.trim().slice(0, 60);
    if (!n) return;
    setBusy(true);
    const res = await saveView({ tab: "hareketler", name: n, params: current });
    setBusy(false);
    if (!res.ok) return push(res.error, "err");
    push("Görünüm kaydedildi", "ok");
    setOpen(false);
    setName("");
    router.refresh();
  }

  async function remove(v: SavedLedgerView) {
    const res = await deleteView(v.id);
    if (!res.ok) return push(res.error, "err");
    push(`"${v.name}" görünümü silindi`, "ok");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Kayıtlı görünümler" role="group">
      <Bookmark className="h-3.5 w-3.5 text-text-faint" aria-hidden="true" />
      {views.map((v) => {
        const active = sameViewParams(v.params, current);
        return (
          <span key={v.id} className={cn("group inline-flex items-center rounded-full border text-xs font-semibold transition", active ? "border-brand-300 bg-surface-selected text-brand-700" : "border-line bg-surface text-text-muted hover:text-text")}>
            <Link href={viewHref(base, sekme, v.params)} aria-current={active ? "page" : undefined} className="focus-ring inline-flex min-h-8 items-center rounded-full pl-3 pr-1.5 touch:min-h-11">
              {v.name}
            </Link>
            <Button
              variant="ghost"
              size="icon"
              icon={X}
              onClick={() => void remove(v)}
              aria-label={`${v.name} görünümünü sil`}
              className="rounded-full text-text-faint hover:text-danger-strong"
            />
          </span>
        );
      })}
      {hasFilter && !already ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="xs" icon={BookmarkPlus}>Bu görünümü kaydet</Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-3">
            <form onSubmit={save} className="grid gap-2">
              <label htmlFor="ledger-view-name" className="text-xs font-semibold text-text">Görünüm adı</label>
              <input
                id="ledger-view-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                autoFocus
                placeholder="ör. Bu ayın portal giderleri"
                className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-sm focus:border-brand-400 focus:outline-none touch:h-11"
              />
              <div className="flex justify-end">
                <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!name.trim()}>Kaydet</Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
