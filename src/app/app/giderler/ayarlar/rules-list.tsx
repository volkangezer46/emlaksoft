"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pause, Pencil, Play, Plus, Trash2, Wand2 } from "lucide-react";
import { deleteFinanceRule, upsertFinanceRule } from "@/app/actions/expense-budgets";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FormError, FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { StatusPill } from "@/components/ui/list-kit/status-pill";

export type FinanceRuleRow = {
  id: string;
  direction: "in" | "out" | null;
  matchText: string | null;
  matchIbanLast4: string | null;
  amountMin: number | null;
  amountMax: number | null;
  setCategory: string;
  setCategoryLabel: string;
  setPartyId: string | null;
  setPartyLabel: string | null;
  mode: "suggest" | "auto";
  active: boolean;
  hits: number;
};

export type RuleCategoryOption = { value: string; label: string; direction: "in" | "out" };
export type RulePartyChoice = { value: string; label: string; hint?: string };

const tl = (n: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n);

function conditionText(r: FinanceRuleRow): string {
  const parts: string[] = [];
  if (r.direction) parts.push(r.direction === "in" ? "Giriş" : "Çıkış");
  if (r.matchText) parts.push(`açıklamada “${r.matchText}”`);
  if (r.matchIbanLast4) parts.push(`IBAN …${r.matchIbanLast4}`);
  if (r.amountMin != null && r.amountMax != null) parts.push(`${tl(r.amountMin)}–${tl(r.amountMax)} TL`);
  else if (r.amountMin != null) parts.push(`≥ ${tl(r.amountMin)} TL`);
  else if (r.amountMax != null) parts.push(`≤ ${tl(r.amountMax)} TL`);
  return parts.join(" · ") || "Her satır";
}

/**
 * Otomatik kategori kuralları: banka ekstresi / yeni kayıt satırı koşula uyarsa kategori (ve cari) önerilir ya da
 * otomatik atanır. "Öner" kipinde kullanıcı onaylar; "otomatik" kipinde doğrudan uygulanır. Eşleşme sayısı gösterilir.
 */
export function RulesList({
  rules,
  categories,
  parties,
  canEdit,
}: {
  rules: readonly FinanceRuleRow[];
  categories: readonly RuleCategoryOption[];
  parties: readonly RulePartyChoice[];
  canEdit: boolean;
}) {
  return (
    <div className="grid gap-3">
      {canEdit ? (
        <div>
          <RuleDialogButton categories={categories} parties={parties} />
        </div>
      ) : null}
      {rules.length === 0 ? (
        <p className="text-sm text-text-muted">
          Henüz kural yok. Örnek: açıklamasında “SAHIBINDEN” geçen çıkışları <strong>Portal üyeliği</strong> olarak öner; IBAN’ı …1234 olan girişleri bir cariye bağla.
        </p>
      ) : (
        <ul className="grid gap-2">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2">
              <span className="min-w-0">
                <span className="block text-sm text-text">
                  <span className="text-text-muted">{conditionText(r)}</span> → <strong>{r.setCategoryLabel}</strong>
                  {r.setPartyLabel ? <span className="text-text-muted"> · {r.setPartyLabel}</span> : null}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                  <StatusPill tone={r.mode === "auto" ? "success" : "info"} dot={false}>{r.mode === "auto" ? "Otomatik" : "Öner"}</StatusPill>
                  {!r.active ? <StatusPill tone="neutral" dot={false}>Durduruldu</StatusPill> : null}
                  <span className="numeric">{r.hits} eşleşme</span>
                </span>
              </span>
              {canEdit ? <RuleActions rule={r} categories={categories} parties={parties} /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RuleActions({ rule, categories, parties }: { rule: FinanceRuleRow; categories: readonly RuleCategoryOption[]; parties: readonly RulePartyChoice[] }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const toggle = () =>
    start(async () => {
      const res = await upsertFinanceRule({
        id: rule.id,
        direction: rule.direction,
        matchText: rule.matchText,
        matchIbanLast4: rule.matchIbanLast4,
        amountMin: rule.amountMin,
        amountMax: rule.amountMax,
        setCategory: rule.setCategory,
        setPartyId: rule.setPartyId,
        mode: rule.mode,
        active: !rule.active,
      });
      if (!res.ok) push(res.error, "err");
      else {
        push(rule.active ? "Kural durduruldu" : "Kural sürdürülüyor", "ok");
        router.refresh();
      }
    });
  return (
    <span className="flex items-center gap-1">
      <RuleDialogButton categories={categories} parties={parties} rule={rule} />
      <Button variant="ghost" size="xs" icon={rule.active ? Pause : Play} loading={pending} onClick={toggle} aria-label={rule.active ? "Kuralı durdur" : "Kuralı sürdür"}>
        {rule.active ? "Durdur" : "Sürdür"}
      </Button>
      <ConfirmDialog
        trigger={<Button variant="ghost" size="xs" icon={Trash2} aria-label="Kuralı sil">Sil</Button>}
        title="Kural silinsin mi?"
        description="Daha önce bu kuralla kategorilenen hareketler değişmez; yalnız yeni satırlara uygulanmaz."
        confirmLabel="Sil"
        tone="danger"
        onConfirm={async () => {
          const res = await deleteFinanceRule(rule.id);
          if (!res.ok) push(res.error, "err");
          else {
            push("Kural silindi", "ok");
            router.refresh();
          }
        }}
      />
    </span>
  );
}

function RuleDialogButton({ categories, parties, rule }: { categories: readonly RuleCategoryOption[]; parties: readonly RulePartyChoice[]; rule?: FinanceRuleRow }) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"" | "in" | "out">(rule?.direction ?? "out");
  const [category, setCategory] = useState(rule?.setCategory ?? "");
  const [partyId, setPartyId] = useState(rule?.setPartyId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const options = categories.filter((c) => !direction || c.direction === direction);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const res = await upsertFinanceRule({
        id: rule?.id ?? null,
        direction: direction || null,
        matchText: String(fd.get("matchText") ?? ""),
        matchIbanLast4: String(fd.get("iban") ?? ""),
        amountMin: String(fd.get("amountMin") ?? ""),
        amountMax: String(fd.get("amountMax") ?? ""),
        setCategory: category,
        setPartyId: partyId || null,
        mode: String(fd.get("mode") ?? "suggest"),
        active: rule?.active ?? true,
      });
      if (!res.ok) return setError(res.error);
      push(rule ? "Kural güncellendi" : "Kural eklendi", "ok");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      {rule ? (
        <Button variant="ghost" size="xs" icon={Pencil} onClick={() => setOpen(true)} aria-label="Kuralı düzenle">
          Düzenle
        </Button>
      ) : (
        <Button variant="outline" size="sm" icon={Plus} onClick={() => setOpen(true)}>
          Kural ekle
        </Button>
      )}
      {open ? (
        <Dialog open onOpenChange={(v) => (v ? undefined : setOpen(false))}>
          <DialogContent size="md">
            <DialogHeader title={rule ? "Kuralı düzenle" : "Otomatik kural ekle"} description="Koşula uyan banka ve kayıt satırlarına kategori (ve cari) önerilir ya da otomatik atanır." icon={<Wand2 />} />
            <form onSubmit={submit}>
              <DialogBody className="grid gap-4">
                <FormField label="Yön" htmlFor="fr-dir">
                  <FormSelect
                    id="fr-dir"
                    value={direction}
                    onChange={(e) => {
                      setDirection(e.target.value as "" | "in" | "out");
                      setCategory("");
                    }}
                  >
                    <option value="out">Çıkış (gider)</option>
                    <option value="in">Giriş (gelir)</option>
                    <option value="">Her ikisi</option>
                  </FormSelect>
                </FormField>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Açıklamada geçen" htmlFor="fr-text" hint="Büyük/küçük harf fark etmez.">
                    <FormInput id="fr-text" name="matchText" maxLength={80} autoComplete="off" defaultValue={rule?.matchText ?? ""} placeholder="ör. SAHIBINDEN" />
                  </FormField>
                  <FormField label="IBAN son 4 hane" htmlFor="fr-iban">
                    <FormInput id="fr-iban" name="iban" inputMode="numeric" maxLength={4} autoComplete="off" defaultValue={rule?.matchIbanLast4 ?? ""} placeholder="1234" />
                  </FormField>
                  <FormField label="En az tutar" htmlFor="fr-min">
                    <FormInput id="fr-min" name="amountMin" inputMode="decimal" autoComplete="off" defaultValue={rule?.amountMin != null ? String(rule.amountMin).replace(".", ",") : ""} />
                  </FormField>
                  <FormField label="En çok tutar" htmlFor="fr-max">
                    <FormInput id="fr-max" name="amountMax" inputMode="decimal" autoComplete="off" defaultValue={rule?.amountMax != null ? String(rule.amountMax).replace(".", ",") : ""} />
                  </FormField>
                </div>
                <FormField label="Atanacak kategori" htmlFor="fr-cat" required inject={false}>
                  <Combobox
                    id="fr-cat"
                    value={category}
                    onValueChange={setCategory}
                    clearable={false}
                    required
                    options={options.map((c) => ({ value: c.value, label: c.label, hint: c.direction === "in" ? "Gelir" : "Gider" }))}
                    placeholder="Kategori seçin"
                    searchPlaceholder="Kategori ara…"
                    emptyText="Eşleşen kategori yok"
                  />
                </FormField>
                {parties.length > 0 ? (
                  <FormField label="Bağlanacak cari (isteğe bağlı)" htmlFor="fr-party" inject={false}>
                    <Combobox id="fr-party" value={partyId} onValueChange={setPartyId} options={[...parties]} placeholder="Cari seçin" searchPlaceholder="Cari ara…" emptyText="Eşleşen cari yok" />
                  </FormField>
                ) : null}
                <FormField label="Nasıl uygulansın?" htmlFor="fr-mode">
                  <FormSelect id="fr-mode" name="mode" defaultValue={rule?.mode ?? "suggest"}>
                    <option value="suggest">Öner (ben onaylarım)</option>
                    <option value="auto">Otomatik uygula</option>
                  </FormSelect>
                </FormField>
                <FormError error={error} nextStep={null} />
              </DialogBody>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Vazgeç</Button>
                <Button type="submit" variant="primary" loading={pending} disabled={!category}>
                  {rule ? "Kaydet" : "Kuralı ekle"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
