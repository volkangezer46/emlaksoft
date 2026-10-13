"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tags, UserRound } from "lucide-react";
import { updateEntryV2, type EntryV2Patch } from "@/app/actions/finance-ledger";
import { useBulkSelection } from "@/components/app/bulk-selection";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { BulkBar } from "@/components/ui/list-kit";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PartyPicker } from "../cari/party-picker";
import { partyPatchOf, type CategoryOption } from "./inline-edit";
import { AdoptLegacyButton, type AdoptAccount } from "./legacy-adopt";

/** Seçim çubuğunun bildiği satır bilgisi (sunucudan gelir). */
export type BulkRowMeta = {
  id: string;
  origin: "entry" | "legacy_expense";
  direction: "in" | "out";
  amount: number;
  /** Kategori / cari değiştirilebilir (elle girilmiş, transfer değil, kilitli ayda değil, yetkili). */
  editable: boolean;
};

const CONCURRENCY = 4;

/** Kimlik listesine sırayla (en çok 4 eşzamanlı) yama uygular; başarı sayısı + ilk hata döner. */
async function applyAll(ids: readonly string[], patch: EntryV2Patch): Promise<{ ok: number; error: string | null }> {
  let ok = 0;
  let error: string | null = null;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const results = await Promise.all(ids.slice(i, i + CONCURRENCY).map((id) => updateEntryV2(id, patch)));
    for (const r of results) {
      if (r.ok) ok += 1;
      else error ??= r.error;
    }
  }
  return { ok, error };
}

/**
 * Hareketler toplu işlemleri: kategori ata, cari ata ve "Hesapsız" eski giderler için "Hesaba taşı". (Toplu "mutabık işaretle"
 * finance_update_entry_v2 mutabakat anahtarı taşımadığı için yok; mutabakat ekstre onayıyla yapılır.)
 * Uygun olmayan satırlar (transfer, kilitli ay, eski gider) ilgili işlemden sessizce değil, sayısı yazılarak hariç tutulur.
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
  const [busy, setBusy] = useState<null | "category" | "party">(null);
  const [partyOpen, setPartyOpen] = useState(false);
  if (selected.size === 0) return null;

  const picked = rows.filter((r) => selected.has(r.id));
  const editable = picked.filter((r) => r.origin === "entry" && r.editable);
  const legacy = picked.filter((r) => r.origin === "legacy_expense");
  const directions = new Set(editable.map((r) => r.direction));
  const oneDirection = directions.size === 1 ? [...directions][0]! : null;
  const catOptions = oneDirection === "in" ? categoriesIn : oneDirection === "out" ? categoriesOut : [];
  const skipped = (n: number) => (picked.length - n > 0 ? ` (${picked.length - n} satır uygun değil, atlandı)` : "");

  async function run(kind: "category" | "party", ids: readonly string[], patch: EntryV2Patch, done: string) {
    setBusy(kind);
    const res = await applyAll(ids, patch);
    setBusy(null);
    if (res.ok > 0) push(`${res.ok} hareket ${done}${skipped(res.ok)}`, "ok");
    if (res.error) push(res.error, "err");
    if (res.ok > 0) {
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
    await run("party", editable.map((r) => r.id), patch, "için cari atandı");
  }

  return (
    <BulkBar count={selected.size} noun="satır" onClear={clear}>
      {canEdit && editable.length > 0 ? (
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
              onClick={() => void run("category", editable.map((r) => r.id), { category }, "yeniden kategorilendi")}
            >
              Kategori ata
            </Button>
          </span>
        ) : (
          <span className="text-xs text-text-muted">Kategori için gelir ve gideri ayrı seçin</span>
        )
      ) : null}

      {canEdit && editable.length > 0 ? (
        <Popover open={partyOpen} onOpenChange={setPartyOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" icon={UserRound} loading={busy === "party"} disabled={busy !== null}>
              Cari ata
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-3">
            <form onSubmit={submitParty} className="grid gap-2">
              <p className="text-xs font-semibold text-text">{editable.length} harekete atanacak cari</p>
              <PartyPicker name="party" kindHint={oneDirection === "in" ? "musteri" : "tedarikci"} allowCreate aria-label="Atanacak cari" />
              <div className="flex justify-end">
                <Button type="submit" variant="primary" size="sm">Ata</Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
      ) : null}


      {canAdopt && legacy.length > 0 ? (
        <AdoptLegacyButton
          ids={legacy.map((r) => r.id)}
          total={legacy.reduce((s, r) => s + r.amount, 0)}
          accounts={adoptAccounts}
          size="sm"
          label={`Hesaba taşı (${legacy.length})`}
          onDone={clear}
        />
      ) : null}
    </BulkBar>
  );
}
