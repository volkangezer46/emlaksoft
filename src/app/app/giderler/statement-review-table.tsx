"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Trash2 } from "lucide-react";
import { applyStatementDecisions, discardStatementImport, type StatementDecision } from "@/app/actions/finance-statement";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormError, FormSelect } from "@/components/ui/form-controls";
import { StatusPill } from "@/components/ui/list-kit";
import { categoriesFor } from "@/lib/finance/cash/categories";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { formatDateTr } from "@/lib/format";
import { buildDecision, type Suggestion } from "@/lib/finance/statement/match";

export type ReviewLine = {
  id: string;
  importId: string;
  date: string;
  dir: "in" | "out";
  amount: number;
  description: string;
  suggestion: Suggestion;
  /** Öneri yoksa ya da "yeni hareket" seçilirse varsayılan kategori. */
  fallbackCategory: string;
};

type RowState = { checked: boolean; action: "create" | "match" | "skip"; category: string };

function initial(l: ReviewLine): RowState {
  const s = l.suggestion;
  if (s.kind === "existing") return { checked: true, action: "match", category: l.fallbackCategory };
  if (s.kind === "collection" || s.kind === "recurring" || s.kind === "category") return { checked: true, action: "create", category: s.category };
  return { checked: false, action: "create", category: l.fallbackCategory };
}

const PILL: Record<Suggestion["kind"], "success" | "info" | "warning" | "neutral"> = { existing: "success", collection: "info", recurring: "info", category: "warning", none: "neutral" };

/** Tek ekranda onay/düzeltme: her satır için öneri, işlem (hareket oluştur / mevcutla eşle / atla) ve kategori. */
export function StatementReviewTable({ accountId, importIds, currency, canSalary, lines }: { accountId: string; importIds: readonly string[]; currency: string; canSalary: boolean; lines: readonly ReviewLine[] }) {
  const router = useRouter();
  const { push } = useToast();
  const [rows, setRows] = useState<Record<string, RowState>>(() => Object.fromEntries(lines.map((l) => [l.id, initial(l)])));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const checkedCount = useMemo(() => lines.filter((l) => rows[l.id]?.checked).length, [lines, rows]);
  const patch = (id: string, p: Partial<RowState>) => setRows((prev) => ({ ...prev, [id]: { ...prev[id]!, ...p } }));

  async function apply() {
    const decisions: StatementDecision[] = [];
    for (const l of lines) {
      const st = rows[l.id];
      if (!st?.checked) continue;
      decisions.push(buildDecision(l.id, l.suggestion, st));
    }
    if (decisions.length === 0) return setError("Önce onaylanacak satırları işaretleyin.");
    setBusy(true);
    setError(null);
    const res = await applyStatementDecisions(accountId, decisions);
    setBusy(false);
    if (res.error) setError(res.error);
    if (res.ok) push(res.info ?? "Ekstre işlendi", "ok");
    if (res.ok) router.refresh();
  }

  async function discard() {
    setBusy(true);
    for (const id of importIds) {
      const res = await discardStatementImport(accountId, id);
      if (res.error) {
        setBusy(false);
        setConfirmDiscard(false);
        return setError(res.error);
      }
    }
    setBusy(false);
    setConfirmDiscard(false);
    push("Taslak atıldı", "ok");
    router.refresh();
  }

  const setAll = (checked: boolean) => setRows((prev) => Object.fromEntries(Object.entries(prev).map(([id, st]) => [id, { ...st, checked }])));

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setAll(true)}>Tümünü seç</Button>
        <Button variant="ghost" size="sm" onClick={() => setAll(false)}>Seçimi temizle</Button>
        <span className="text-xs text-text-muted">{checkedCount} / {lines.length} satır seçili</span>
      </div>

      <ul className="grid gap-2">
        {lines.map((l) => {
          const st = rows[l.id]!;
          const s = l.suggestion;
          const cats = categoriesFor(l.dir).filter((c) => canSalary || c.value !== "maas");
          return (
            <li key={l.id} className={`grid gap-2 rounded-[var(--radius-card)] border p-3 sm:grid-cols-[auto_1fr_auto] sm:items-center ${st.checked ? "border-accent/40 bg-surface" : "border-line bg-canvas"}`}>
              <Checkbox checked={st.checked} onChange={(e) => patch(l.id, { checked: e.target.checked })} aria-label={`${l.description || "Satır"} satırını seç`} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-text">{l.description || "Açıklama yok"}</p>
                <p className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                  {formatDateTr(l.date)}
                  {s.kind !== "none" ? <StatusPill tone={PILL[s.kind]} dot={false}>{s.label}</StatusPill> : <StatusPill tone="neutral" dot={false}>Öneri yok</StatusPill>}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <span className={`numeric text-sm font-bold ${l.dir === "in" ? "text-success-strong" : "text-danger-strong"}`}>
                  {l.dir === "in" ? "+" : "−"}{formatAccountMoney(l.amount, currency)}
                </span>
                <FormSelect aria-label="İşlem" className="w-auto" value={st.action} onChange={(e) => patch(l.id, { action: e.target.value as RowState["action"] })}>
                  {s.kind === "existing" ? <option value="match">Kayıtlıyla eşle</option> : null}
                  <option value="create">Hareket oluştur</option>
                  <option value="skip">Atla</option>
                </FormSelect>
                {st.action === "create" ? (
                  <FormSelect aria-label="Kategori" className="w-auto" value={st.category} onChange={(e) => patch(l.id, { category: e.target.value })}>
                    {cats.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </FormSelect>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <FormError error={error} nextStep={null} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" icon={Trash2} onClick={() => setConfirmDiscard(true)} disabled={busy}>Taslağı at</Button>
        <Button variant="primary" icon={CheckCheck} onClick={() => void apply()} loading={busy} disabled={checkedCount === 0}>
          Seçilen {checkedCount} satırı onayla
        </Button>
      </div>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Taslak atılsın mı?"
        description="Onaylanmamış ekstre satırları silinir. Daha önce oluşturduğunuz hareketlere dokunulmaz; dosyayı yeniden yükleyebilirsiniz."
        confirmLabel="Taslağı at"
        tone="danger"
        onConfirm={() => void discard()}
      />
    </div>
  );
}
