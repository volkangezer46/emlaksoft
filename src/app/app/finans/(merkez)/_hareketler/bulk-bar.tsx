"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Tags, UserRound } from "lucide-react";
import { setEntriesReconciled } from "@/app/actions/finance-accounts";
import { updateEntryV2, type EntryV2Patch } from "@/app/actions/finance-ledger";
import { useBulkSelection } from "@/components/app/bulk-selection";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { BulkBar } from "@/components/ui/list-kit";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PartyPicker } from "../cari/party-picker";
import { partyPatchOf, type CategoryOption } from "./inline-edit";
import { bulkOutcomeText } from "./ledger-filters";
import { AdoptLegacyButton, type AdoptAccount } from "./legacy-adopt";

/** Seçim çubuğunun bildiği satır bilgisi (sunucudan gelir). */
export type BulkRowMeta = {
  id: string;
  origin: "entry" | "legacy_expense";
  direction: "in" | "out";
  amount: number;
  currency: string;
  /** Kategori değiştirilebilir: yalnız elle girilmiş gelir/gider (FN1 RPC'si kaynaklı harekette 'locked' döner), kilitli ayda değil, yetkili. */
  categoryEditable: boolean;
  /** Cari atanabilir: transfer değil, kilitli ayda değil, yetkili (kaynaklı hareket de olur). */
  partyEditable: boolean;
  /** Elle mutabık işaretlenebilir (deftere işlenmiş gelir/gider/transfer, expenses:edit). */
  reconcilable: boolean;
  reconciled: boolean;
};

const CONCURRENCY = 4;

/** Kimlik listesine sırayla (en çok 4 eşzamanlı) yama uygular; başarı/hata sayısı + ilk hata döner. */
async function applyAll(ids: readonly string[], patch: EntryV2Patch): Promise<{ ok: number; failed: number; error: string | null }> {
  let ok = 0;
  let failed = 0;
  let error: string | null = null;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const results = await Promise.all(ids.slice(i, i + CONCURRENCY).map((id) => updateEntryV2(id, patch)));
    for (const r of results) {
      if (r.ok) ok += 1;
      else {
        failed += 1;
        error ??= r.error;
      }
    }
  }
  return { ok, failed, error };
}

/**
 * Hareketler toplu işlemleri: kategori ata (yalnız elle girilmiş gelir/gider), cari ata, mutabık işaretle / mutabakatı kaldır
 * (finance_entries_set_reconciled) ve "Hesapsız" eski giderler için "Hesaba taşı".
 * Uygun olmayan satırlar (kaynaklı hareket, transfer, kilitli ay, eski gider) ilgili işlemden sessizce değil, sayısı yazılarak hariç tutulur.
 */
export function LedgerBulkBar({
  rows,
  categoriesIn,
  categoriesOut,
  adoptAccounts,
  canEdit,
  canAdopt,
}: {
  rows: readonly BulkRowMeta[];
  categoriesIn: readonly CategoryOption[];
  categoriesOut: readonly CategoryOption[];
  adoptAccounts: readonly AdoptAccount[];
  canEdit: boolean;
  canAdopt: boolean;
}) {
  const { selected, clear } = useBulkSelection();
  const router = useRouter();
  const { push } = useToast();
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState<null | "category" | "party" | "reconcile">(null);
  const [partyOpen, setPartyOpen] = useState(false);
  if (selected.size === 0) return null;

  const picked = rows.filter((r) => selected.has(r.id));
  const categoryRows = picked.filter((r) => r.origin === "entry" && r.categoryEditable);
  const partyRows = picked.filter((r) => r.origin === "entry" && r.partyEditable);
  const toReconcile = picked.filter((r) => r.origin === "entry" && r.reconcilable && !r.reconciled);
  const toUnreconcile = picked.filter((r) => r.origin === "entry" && r.reconcilable && r.reconciled);
  const legacy = picked.filter((r) => r.origin === "legacy_expense");
  const directions = new Set(categoryRows.map((r) => r.direction));
  const oneDirection = directions.size === 1 ? [...directions][0]! : null;
  const partyDirections = new Set(partyRows.map((r) => r.direction));
  const partyKindHint = partyDirections.size === 1 && partyDirections.has("in") ? "musteri" : "tedarikci";
  const catOptions = oneDirection === "in" ? categoriesIn : oneDirection === "out" ? categoriesOut : [];

  async function run(kind: "category" | "party", ids: readonly string[], patch: EntryV2Patch, done: string) {
    setBusy(kind);
    const res = await applyAll(ids, patch);
    setBusy(null);
    const text = bulkOutcomeText(res.ok, done, picked.length - ids.length, res.failed);
    if (res.ok > 0) push(text, "ok");
    if (res.error) push(res.ok > 0 ? res.error : `${text}. ${res.error}`, "err");
    if (res.ok > 0) {
      clear();
      router.refresh();
    }
  }

  async function reconcile(rowsToChange: readonly BulkRowMeta[], value: boolean) {
    setBusy("reconcile");
    const res = await setEntriesReconciled(rowsToChange.map((r) => r.id), value);
    setBusy(null);
    if (res.error) return push(res.error, "err");
    const changed = res.count ?? 0;
    const text = bulkOutcomeText(changed, value ? "mutabık işaretlendi" : "için mutabakat kaldırıldı", picked.length - rowsToChange.length, rowsToChange.length - changed);
    push(text, changed > 0 ? "ok" : "err");
    if (changed > 0) {
      clear();
      router.refresh();
    }
  }

  async function submitParty(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const patch = partyPatchOf(fd.get("party"));
    if (!patch) return push("Bir cari seçin ya da adını yazın.", "err");
    setPartyOpen(false);
    await run("party", partyRows.map((r) => r.id), patch, "için cari atandı");
  }

  return (
    <BulkBar count={selected.size} noun="satır" onClear={clear}>
      {canEdit && categoryRows.length > 0 ? (
        oneDirection ? (
          <span className="inline-flex items-center gap-1.5">
            <label className="sr-only" htmlFor="ledger-bulk-category">Atanacak kategori</label>
            <select
              id="ledger-bulk-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-8 min-w-0 max-w-[12rem] rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm touch:h-11"
            >
              <option value="">Kategori seçin…</option>
              {catOptions.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              icon={Tags}
              loading={busy === "category"}
              disabled={!category || busy !== null}
              onClick={() => void run("category", categoryRows.map((r) => r.id), { category }, "yeniden kategorilendi")}
            >
              Kategori ata
            </Button>
          </span>
        ) : (
          <span className="text-xs text-text-muted">Kategori için gelir ve gideri ayrı seçin</span>
        )
      ) : null}

      {canEdit && partyRows.length > 0 ? (
        <Popover open={partyOpen} onOpenChange={setPartyOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" icon={UserRound} loading={busy === "party"} disabled={busy !== null}>
              Cari ata
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-3">
            <form onSubmit={submitParty} className="grid gap-2">
              <p className="text-xs font-semibold text-text">{partyRows.length} harekete atanacak cari</p>
              <PartyPicker name="party" kindHint={partyKindHint} allowCreate aria-label="Atanacak cari" />
              <div className="flex justify-end">
                <Button type="submit" variant="primary" size="sm">Ata</Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
      ) : null}

      {canEdit && toReconcile.length > 0 ? (
        <Button variant="outline" size="sm" icon={CheckCheck} loading={busy === "reconcile"} disabled={busy !== null} onClick={() => void reconcile(toReconcile, true)}>
          Mutabık işaretle ({toReconcile.length})
        </Button>
      ) : null}
      {canEdit && toReconcile.length === 0 && toUnreconcile.length > 0 ? (
        <Button variant="ghost" size="sm" loading={busy === "reconcile"} disabled={busy !== null} onClick={() => void reconcile(toUnreconcile, false)}>
          Mutabakatı kaldır ({toUnreconcile.length})
        </Button>
      ) : null}

      {canAdopt && legacy.length > 0 ? (
        <AdoptLegacyButton
          items={legacy.map((r) => ({ id: r.id, amount: r.amount, currency: r.currency }))}
          accounts={adoptAccounts}
          size="sm"
          label={`Hesaba taşı (${legacy.length})`}
          onDone={clear}
        />
      ) : null}
    </BulkBar>
  );
}
