"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { BookmarkPlus, Check, Link2, ListChecks, SkipForward } from "lucide-react";
import { applyStatementDecisions } from "@/app/actions/finance-statement";
import { upsertRule } from "@/app/actions/finance-ledger";
import { useToast } from "@/components/app/toast-provider";
import { useAutoAnimate } from "@/components/ui/auto-animate";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/list-kit";
import { categoriesFor, cashCategoryLabel } from "@/lib/finance/cash/categories";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { formatDateTr } from "@/lib/format";
import { buildDecision, ruleTextFromDescription, type Suggestion } from "@/lib/finance/statement/match";

/**
 * "İncelenecek" kuyruğu: tüm hesapların onay bekleyen ekstre satırları, her birinde önerilen eşleşme (mevcut hareket,
 * tahsilat, düzenli ödeme, ofis kuralı, anahtar sözcük). Tek tıkla onay satırı hesaba işler (finance_statement_apply);
 * "Kural olarak kaydet" açıklamadan kural metni çıkarır (upsertRule) ve sonraki benzer satırlar aynı kategoriyi önerir.
 * Hiçbir satır kendiliğinden kaydedilmez.
 */

export type QueueItem = {
  lineId: string;
  accountId: string;
  accountName: string;
  currency: string;
  date: string;
  dir: "in" | "out";
  amount: number;
  description: string;
  suggestion: Suggestion;
  fallbackCategory: string;
  reviewHref: string;
  /** Kişisel hesabın satırından ofis geneli kural (finance_rules) türetilmez: kişisel ekstre yalnız sahibine görünür. */
  scope: "office" | "personal";
};

const PILL: Record<Suggestion["kind"], "success" | "info" | "warning" | "neutral"> = { existing: "success", collection: "info", recurring: "info", rule: "info", category: "warning", none: "neutral" };

function defaultCategory(item: QueueItem): string {
  const s = item.suggestion;
  return s.kind === "collection" || s.kind === "recurring" || s.kind === "rule" || s.kind === "category" ? s.category : item.fallbackCategory;
}

export function ReconcileQueue({ items, total, canSalary, canRule }: { items: readonly QueueItem[]; total: number; canSalary: boolean; canRule: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [cats, setCats] = useState<Record<string, string>>({});
  const listRef = useAutoAnimate<HTMLUListElement>();
  const visible = items.filter((i) => !hidden.has(i.lineId));

  const hide = (id: string, on: boolean) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function decide(item: QueueItem, action: "create" | "match" | "skip") {
    const category = cats[item.lineId] ?? defaultCategory(item);
    setBusy(item.lineId);
    hide(item.lineId, true);
    const res = await applyStatementDecisions(item.accountId, [buildDecision(item.lineId, item.suggestion, { action, category })]);
    setBusy(null);
    if (res.error) {
      hide(item.lineId, false);
      push(res.error, "err");
      return;
    }
    push(action === "skip" ? "Satır atlandı" : res.info ?? "Satır işlendi", "ok");
    router.refresh();
  }

  async function saveRule(item: QueueItem) {
    const category = cats[item.lineId] ?? defaultCategory(item);
    const text = ruleTextFromDescription(item.description);
    if (!text) return push("Açıklamada kurala dönüşecek ayırt edici sözcük yok.", "err");
    setBusy(`rule:${item.lineId}`);
    const res = await upsertRule({ direction: item.dir, matchText: text, setCategory: category, mode: "suggest", active: true });
    setBusy(null);
    if (!res.ok) return push(res.error, "err");
    push(`Kural kaydedildi: "${text}" geçen satırlara ${cashCategoryLabel(category)} önerilecek`, "ok");
    router.refresh();
  }

  if (visible.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-sm text-text-muted">
        <ListChecks className="h-4 w-4 text-success-strong" aria-hidden="true" />
        İncelenecek ekstre satırı kalmadı.
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <ul ref={listRef} className="grid gap-2">
        {visible.map((item) => {
          const s = item.suggestion;
          const category = cats[item.lineId] ?? defaultCategory(item);
          const options = categoriesFor(item.dir).filter((c) => canSalary || c.value !== "maas");
          const isMatch = s.kind === "existing";
          const ruleText = ruleTextFromDescription(item.description);
          return (
            <li key={item.lineId} className="grid gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-[var(--shadow-xs)] md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-text" title={item.description}>{item.description || "Açıklama yok"}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                  <span className="numeric">{formatDateTr(item.date)}</span>
                  <span>· {item.accountName}</span>
                  <span className={`numeric font-bold ${item.dir === "in" ? "text-success-strong" : "text-danger-strong"}`}>
                    {item.dir === "in" ? "+" : "−"}
                    {formatAccountMoney(item.amount, item.currency)}
                  </span>
                  {s.kind !== "none" ? <StatusPill tone={PILL[s.kind]} dot={false}>{s.label}</StatusPill> : <StatusPill tone="neutral" dot={false}>Öneri yok</StatusPill>}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
                {!isMatch ? (
                  <>
                    <label className="sr-only" htmlFor={`rq-cat-${item.lineId}`}>Kategori</label>
                    <select
                      id={`rq-cat-${item.lineId}`}
                      value={category}
                      onChange={(e) => setCats((prev) => ({ ...prev, [item.lineId]: e.target.value }))}
                      className="h-8 max-w-[11rem] rounded-[var(--radius-control)] border border-line bg-surface px-2 text-xs touch:h-11"
                    >
                      {options.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </>
                ) : null}
                <Button
                  variant="primary"
                  size="sm"
                  icon={isMatch ? Link2 : Check}
                  loading={busy === item.lineId}
                  disabled={busy !== null}
                  onClick={() => void decide(item, isMatch ? "match" : "create")}
                  aria-label={`${item.description || "Satır"}: ${isMatch ? "kayıtlı hareketle eşleştir" : "onayla ve hesaba işle"}`}
                >
                  {isMatch ? "Eşleştir" : "Onayla"}
                </Button>
                {canRule && item.scope === "office" && !isMatch && ruleText ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={BookmarkPlus}
                    loading={busy === `rule:${item.lineId}`}
                    disabled={busy !== null}
                    onClick={() => void saveRule(item)}
                    title={`"${ruleText}" geçen satırlara ${cashCategoryLabel(category)} öner`}
                  >
                    Kural olarak kaydet
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" icon={SkipForward} disabled={busy !== null} onClick={() => void decide(item, "skip")} aria-label={`${item.description || "Satır"}: atla`}>
                  Atla
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {total > items.length ? (
        <p className="text-xs text-text-muted">
          İlk {items.length} satır gösteriliyor ({total} satır bekliyor). Tümü için hesabın{" "}
          <Link href={items[0]!.reviewHref} className="font-semibold text-accent-text hover:underline">ekstre onay ekranını</Link> açın.
        </p>
      ) : null}
    </div>
  );
}
