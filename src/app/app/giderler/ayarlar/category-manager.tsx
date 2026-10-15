"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Pencil, Plus, Tags } from "lucide-react";
import { archiveFinanceCategory, upsertFinanceCategory } from "@/app/actions/expense-budgets";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FormError, FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { StatusPill } from "@/components/ui/list-kit/status-pill";
import { cn } from "@/lib/utils";
import Link from "@/components/ui/smart-link";

export type ManagedCategory = {
  id: string;
  direction: "in" | "out";
  key: string;
  label: string;
  defaultVatRate: number | null;
  defaultWithholdingRate: number | null;
  expenseCategory: string | null;
  archived: boolean;
  /** Bu kategoriyle süzülmüş Hareketler. */
  href: string;
};

export type SystemCategory = { value: string; label: string; direction: "in" | "out"; href: string };

type Option = { value: string; label: string };

const VAT = [
  { value: "", label: "Varsayılan (ayarlardaki)" },
  { value: "0", label: "KDV yok (%0)" },
  { value: "1", label: "%1" },
  { value: "10", label: "%10" },
  { value: "20", label: "%20" },
];
const WITHHOLDING = [
  { value: "", label: "Stopaj yok" },
  { value: "20", label: "%20" },
  { value: "15", label: "%15" },
  { value: "10", label: "%10" },
];

/**
 * Ofis kategorileri: sistem kategorileri (sabit, kodda) + ofisin kendi kategorileri (ekle, düzenle, arşivle; varsayılan KDV
 * ve stopaj). Arşivlenen kategori yeni kayıtta çıkmaz, eski hareketlerde etiketi korunur.
 */
export function CategoryManager({
  system,
  custom,
  expenseCategories,
  canEdit,
}: {
  system: readonly SystemCategory[];
  custom: readonly ManagedCategory[];
  expenseCategories: readonly Option[];
  canEdit: boolean;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const active = custom.filter((c) => !c.archived);
  const archived = custom.filter((c) => c.archived);
  return (
    <div className="grid gap-5">
      {(["out", "in"] as const).map((dir) => {
        const sys = system.filter((s) => s.direction === dir);
        const mine = active.filter((c) => c.direction === dir);
        return (
          <section key={dir} aria-label={dir === "out" ? "Gider kategorileri" : "Gelir kategorileri"} className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-text">{dir === "out" ? "Gider kategorileri" : "Gelir kategorileri"}</h3>
              {canEdit ? <CategoryDialogButton direction={dir} expenseCategories={expenseCategories} /> : null}
            </div>
            <ul className="flex flex-wrap gap-1.5" aria-label="Sistem kategorileri">
              {sys.map((s) => (
                <li key={s.value}>
                  <Link href={s.href} className="focus-ring inline-flex min-h-8 items-center rounded-full border border-line bg-canvas px-3 text-xs font-semibold text-text-muted hover:border-brand-300 hover:text-accent-text touch:min-h-11">
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
            {mine.length > 0 ? (
              <ul className="grid gap-2">
                {mine.map((c) => (
                  <CategoryRow key={c.id} category={c} canEdit={canEdit} expenseCategories={expenseCategories} />
                ))}
              </ul>
            ) : (
              <p className="text-xs text-text-faint">Ofise özel {dir === "out" ? "gider" : "gelir"} kategorisi yok. Sistem kategorileri yetmezse ekleyin (ör. Noter masrafı, Danışmanlık geliri).</p>
            )}
          </section>
        );
      })}
      {archived.length > 0 ? (
        <section aria-label="Arşivlenen kategoriler">
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived}>
            {showArchived ? "Arşivlenenleri gizle" : `Arşivlenen ${archived.length} kategoriyi göster`}
          </Button>
          {showArchived ? (
            <ul className="mt-2 grid gap-2">
              {archived.map((c) => (
                <CategoryRow key={c.id} category={c} canEdit={false} expenseCategories={expenseCategories} />
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function CategoryRow({ category: c, canEdit, expenseCategories }: { category: ManagedCategory; canEdit: boolean; expenseCategories: readonly Option[] }) {
  const router = useRouter();
  const { push } = useToast();
  return (
    <li className={cn("flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line px-3 py-2", c.archived ? "bg-canvas opacity-75" : "bg-surface")}>
      <span className="min-w-0">
        <Link href={c.href} className="focus-ring rounded text-sm font-semibold text-text hover:underline">{c.label}</Link>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
          {c.defaultVatRate != null ? <StatusPill tone="neutral" dot={false}>KDV %{c.defaultVatRate}</StatusPill> : null}
          {c.defaultWithholdingRate ? <StatusPill tone="warning" dot={false}>Stopaj %{c.defaultWithholdingRate}</StatusPill> : null}
          {c.archived ? <StatusPill tone="neutral" dot={false}>Arşiv: eski kayıtlarda görünür</StatusPill> : null}
        </span>
      </span>
      {canEdit ? (
        <span className="flex items-center gap-1">
          <CategoryDialogButton direction={c.direction} expenseCategories={expenseCategories} category={c} />
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="xs" icon={Archive} aria-label={`${c.label} kategorisini arşivle`}>
                Arşivle
              </Button>
            }
            title={`"${c.label}" arşivlensin mi?`}
            description="Yeni kayıtta ve kural seçiminde çıkmaz; bu kategoriyle girilmiş eski hareketlerde adı korunur."
            confirmLabel="Arşivle"
            tone="default"
            onConfirm={async () => {
              const res = await archiveFinanceCategory(c.id);
              if (!res.ok) push(res.error, "err");
              else {
                push("Kategori arşivlendi", "ok");
                router.refresh();
              }
            }}
          />
        </span>
      ) : null}
    </li>
  );
}

function CategoryDialogButton({ direction, expenseCategories, category }: { direction: "in" | "out"; expenseCategories: readonly Option[]; category?: ManagedCategory }) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const editing = Boolean(category);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const res = await upsertFinanceCategory({
        id: category?.id ?? null,
        direction,
        label: String(fd.get("label") ?? ""),
        defaultVatRate: String(fd.get("vat") ?? ""),
        defaultWithholdingRate: String(fd.get("wh") ?? ""),
        expenseCategory: String(fd.get("expenseCategory") ?? ""),
      });
      if (!res.ok) return setError(res.error);
      push(editing ? "Kategori güncellendi" : "Kategori eklendi", "ok");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      {editing ? (
        <Button variant="ghost" size="xs" icon={Pencil} onClick={() => setOpen(true)} aria-label={`${category!.label} düzenle`}>
          Düzenle
        </Button>
      ) : (
        <Button variant="outline" size="sm" icon={Plus} onClick={() => setOpen(true)}>
          {direction === "out" ? "Gider kategorisi ekle" : "Gelir kategorisi ekle"}
        </Button>
      )}
      {open ? (
        <Dialog open onOpenChange={(v) => (v ? undefined : setOpen(false))}>
          <DialogContent size="sm">
            <DialogHeader
              title={editing ? "Kategoriyi düzenle" : direction === "out" ? "Gider kategorisi ekle" : "Gelir kategorisi ekle"}
              description="Yeni kayıt sayfasında, Hareketler filtresinde ve otomatik kurallarda görünür."
              icon={<Tags />}
            />
            <form onSubmit={submit}>
              <DialogBody className="grid gap-4">
                <FormField label="Kategori adı" htmlFor="cm-label" required>
                  <FormInput id="cm-label" name="label" maxLength={40} required autoFocus autoComplete="off" defaultValue={category?.label ?? ""} placeholder={direction === "out" ? "ör. Noter masrafı" : "ör. Danışmanlık geliri"} />
                </FormField>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Varsayılan KDV" htmlFor="cm-vat">
                    <FormSelect id="cm-vat" name="vat" defaultValue={category?.defaultVatRate != null ? String(category.defaultVatRate) : ""}>
                      {VAT.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </FormSelect>
                  </FormField>
                  <FormField label="Varsayılan stopaj" htmlFor="cm-wh">
                    <FormSelect id="cm-wh" name="wh" defaultValue={category?.defaultWithholdingRate ? String(category.defaultWithholdingRate) : ""}>
                      {WITHHOLDING.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </FormSelect>
                  </FormField>
                </div>
                {direction === "out" ? (
                  <FormField label="Gider raporunda hangi grupta?" htmlFor="cm-exp" hint="Giderler ve kâr/zarar kırılımı bu gruba göre toplanır.">
                    <FormSelect id="cm-exp" name="expenseCategory" defaultValue={category?.expenseCategory ?? "diger"}>
                      {expenseCategories.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </FormSelect>
                  </FormField>
                ) : null}
                <FormError error={error} nextStep={null} />
              </DialogBody>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Vazgeç</Button>
                <Button type="submit" variant="primary" loading={pending}>
                  {editing ? "Kaydet" : "Kategoriyi ekle"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
