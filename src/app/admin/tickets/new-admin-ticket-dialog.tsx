"use client";

import { startTransition, useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LifeBuoy, Send } from "lucide-react";
import { getTicketCategoriesForTenant } from "@/app/actions/admin-ticket-ops";
import { createSupportTicketAsStaff } from "@/app/actions/tickets";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { TICKET_LIMITS } from "@/lib/support/ticket-contract";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  TICKET_PRIORITY_KEYS,
  TICKET_PRIORITY_LABEL,
} from "./ticket-list-model";

type CreateResult = {
  ok?: boolean;
  error?: string;
  ticketId?: string;
};

const initial: CreateResult = {};

export type TicketTenantOption = {
  value: string;
  label: string;
  hint?: string;
};

export type TicketCategoryOption = {
  value: string;
  label: string;
};

function TicketCreateForm({
  tenants,
  categories,
  defaultTenantId,
  requestId,
  onCreated,
}: {
  tenants: TicketTenantOption[];
  categories: TicketCategoryOption[];
  defaultTenantId?: string;
  requestId: string;
  onCreated: (ticketId: string) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const categoryRequest = useRef(0);
  const [tenantId, setTenantId] = useState(defaultTenantId ?? "");
  const [categoryOptions, setCategoryOptions] = useState(categories);
  const [category, setCategory] = useState(
    categories.some((option) => option.value === "general") ? "general" : (categories[0]?.value ?? ""),
  );
  const [categoryError, setCategoryError] = useState("");
  const [categoryPending, startCategoryTransition] = useTransition();
  const [state, action, pending] = useActionState(async (_previous: CreateResult, formData: FormData) => {
    const result = await createSupportTicketAsStaff(initial, formData);
    if (result.ok && result.ticketId) {
      startTransition(() => {
        formRef.current?.reset();
        onCreated(result.ticketId!);
      });
    }
    return result;
  }, initial);

  function applyCategoryOptions(nextOptions: TicketCategoryOption[]) {
    setCategoryOptions(nextOptions);
    setCategory((current) => (
      nextOptions.some((option) => option.value === current)
        ? current
        : (nextOptions.find((option) => option.value === "general")?.value ?? nextOptions[0]?.value ?? "")
    ));
  }

  function onTenantChange(nextTenantId: string) {
    setTenantId(nextTenantId);
    setCategoryError("");
    const request = ++categoryRequest.current;
    if (!nextTenantId) return;

    startCategoryTransition(async () => {
      try {
        const result = await getTicketCategoriesForTenant(nextTenantId);
        if (request !== categoryRequest.current) return;
        if (result.error) {
          setCategoryError(`${result.error} Genel kategori listesi gösteriliyor.`);
          applyCategoryOptions(categories);
          return;
        }

        const nextOptions = result.options?.length ? result.options : categories;
        applyCategoryOptions(nextOptions);
      } catch {
        if (request !== categoryRequest.current) return;
        setCategoryError("Ofise ait kategoriler yüklenemedi. Genel kategori listesi gösteriliyor.");
        applyCategoryOptions(categories);
      }
    });
  }

  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="request_id" value={requestId} />
      <DialogBody className="grid gap-4">
        <div>
          <label htmlFor="admin-ticket-tenant" className="mb-1.5 block text-xs font-bold text-ink-950">
            Ofis <span className="text-danger-500">*</span>
          </label>
          <Combobox
            id="admin-ticket-tenant"
            name="tenant_id"
            options={tenants}
            value={tenantId}
            onValueChange={onTenantChange}
            placeholder="Talebin açılacağı ofisi seçin"
            searchPlaceholder="Ofis ara…"
            emptyText="Uygun ofis bulunamadı"
            required
            clearable={false}
            aria-label="Talebin açılacağı ofis"
          />
          <p className="mt-1.5 text-[11px] text-text-faint">Talep ofis adına açılır ve tüm hareketler denetim kaydına işlenir.</p>
        </div>

        <div>
          <label htmlFor="admin-ticket-subject" className="mb-1.5 block text-xs font-bold text-ink-950">
            Konu <span className="text-danger-500">*</span>
          </label>
          <input
            id="admin-ticket-subject"
            name="subject"
            type="text"
            required
            minLength={3}
            maxLength={TICKET_LIMITS.subjectMax}
            autoComplete="off"
            placeholder="Örn. Portal ilanı gönderim hatası"
            className="focus-ring w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm text-ink-950 outline-none transition placeholder:text-text-faint focus:border-brand-400 focus:bg-surface"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="admin-ticket-category" className="mb-1.5 block text-xs font-bold text-ink-950">Kategori</label>
            <select
              id="admin-ticket-category"
              name="category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              disabled={categoryPending}
              className="focus-ring w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm text-ink-950 outline-none transition focus:border-brand-400 focus:bg-surface"
            >
              {categoryOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {categoryPending ? <p className="mt-1 text-[11px] text-text-faint">Ofis kategorileri yükleniyor…</p> : null}
          </div>
          <div>
            <label htmlFor="admin-ticket-priority" className="mb-1.5 block text-xs font-bold text-ink-950">Öncelik</label>
            <select
              id="admin-ticket-priority"
              name="priority"
              defaultValue="normal"
              className="focus-ring w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm text-ink-950 outline-none transition focus:border-brand-400 focus:bg-surface"
            >
              {[...TICKET_PRIORITY_KEYS].reverse().map((priority) => (
                <option key={priority} value={priority}>{TICKET_PRIORITY_LABEL[priority]}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="admin-ticket-body" className="mb-1.5 block text-xs font-bold text-ink-950">
            Açıklama <span className="text-danger-500">*</span>
          </label>
          <textarea
            id="admin-ticket-body"
            name="body"
            required
            minLength={3}
            maxLength={TICKET_LIMITS.bodyMax}
            rows={6}
            placeholder="Sorunu, beklenen sonucu ve bilinen ayrıntıları yazın…"
            className="focus-ring w-full resize-y rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm leading-relaxed text-ink-950 outline-none transition placeholder:text-text-faint focus:border-brand-400 focus:bg-surface"
          />
        </div>

        {categoryError ? (
          <p role="alert" className="rounded-[10px] border border-amber-400/25 bg-amber-400/[0.08] px-3 py-2.5 text-sm font-semibold text-amber-800">
            {categoryError}
          </p>
        ) : null}

        {state.error ? (
          <p role="alert" className="rounded-[10px] border border-danger-500/20 bg-danger-500/[0.06] px-3 py-2.5 text-sm font-semibold text-danger-700">
            {state.error}
          </p>
        ) : null}
      </DialogBody>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending || categoryPending}>Vazgeç</Button>
        </DialogClose>
        <Button type="submit" icon={Send} loading={pending} disabled={categoryPending}>
          {pending ? "Oluşturuluyor…" : categoryPending ? "Kategoriler yükleniyor…" : "Talebi oluştur"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function NewAdminTicketDialog({
  tenants,
  categories,
  defaultTenantId,
}: {
  tenants: TicketTenantOption[];
  categories: TicketCategoryOption[];
  defaultTenantId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState("");

  function onOpenChange(next: boolean) {
    if (next) setRequestId(crypto.randomUUID());
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button icon={LifeBuoy} className="shadow-[var(--inner-top-dark),var(--elev-2)]">
          Yeni talep oluştur
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader
          icon={<LifeBuoy />}
          title="Ofis adına destek talebi"
          description="Talebi doğru ofis, kategori ve öncelikle destek kuyruğuna ekleyin."
        />
        <TicketCreateForm
          key={requestId}
          tenants={tenants}
          categories={categories}
          defaultTenantId={defaultTenantId}
          requestId={requestId}
          onCreated={(ticketId) => {
            setRequestId(crypto.randomUUID());
            setOpen(false);
            router.push(`/admin/tickets/${ticketId}`);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
