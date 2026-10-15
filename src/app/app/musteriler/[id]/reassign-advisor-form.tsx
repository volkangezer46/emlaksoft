"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserCog } from "lucide-react";
import { reassignCustomer } from "@/app/actions/customers";
import { PersonSelect } from "@/components/ui/person-select";
import { useToast } from "@/components/app/toast-provider";
import type { AssignableAdvisor } from "@/lib/team/assignable-roles";

/**
 * Müşteri kartı "Danışmanı değiştir" (B063): KONTROLLÜ seçim + `useTransition`. Eylem sonuç döner: başarıda
 * "Danışman X olarak değişti" bildirimi ve tek `router.refresh()`; hatada seçim eski danışmana döner ve neden yazılır.
 * Sunucu değeri değişince üst bileşen `key={current}` ile yeniden bağlar (form.reset() eski değeri geri yazamaz).
 * Seçenekler yalnız satış rolleri (B070); takım lideri kendi takımını "Önerilen" olarak üstte görür.
 */
export function ReassignAdvisorForm({
  customerId,
  current,
  advisors,
}: {
  customerId: string;
  current: string | null;
  advisors: readonly AssignableAdvisor[];
}) {
  const router = useRouter();
  const { push } = useToast();
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const featuredIds = advisors.filter((a) => a.featured).map((a) => a.id);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    if ((value || null) === (current ?? null)) return;
    inFlight.current = true;
    setError(null);
    const fd = new FormData();
    fd.set("id", customerId);
    fd.set("assigned_to", value);
    startTransition(async () => {
      try {
        const res = await reassignCustomer(fd);
        if (res.ok) {
          const name = res.advisorName ?? advisors.find((a) => a.id === value)?.full_name ?? null;
          push(value ? `Danışman ${name ?? "seçilen kişi"} olarak değişti` : "Müşteri danışmansız bırakıldı", "ok");
          router.refresh();
        } else {
          setValue(current ?? "");
          setError(res.error ?? "Danışman değiştirilemedi.");
        }
      } catch {
        setValue(current ?? "");
        setError("Bağlantı hatası: danışman değiştirilemedi.");
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <form onSubmit={submit} className="inline-flex flex-wrap items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/5 py-1 pl-3 pr-1 text-sm text-white">
      <UserCog className="h-4 w-4 shrink-0" aria-hidden="true" />
      <label htmlFor={`reassign-${customerId}`} className="sr-only">
        Danışman
      </label>
      <PersonSelect
        id={`reassign-${customerId}`}
        value={value}
        onValueChange={(next) => {
          setValue(next);
          setError(null);
        }}
        people={advisors.map((a) => ({ id: a.id, name: a.full_name }))}
        featuredIds={featuredIds}
        emptyLabel="Danışmansız"
        clearable={false}
        disabled={pending}
        className="w-auto min-w-[11rem] max-w-[14rem] border-0 bg-transparent font-semibold text-white hover:border-0"
      />
      <button
        type="submit"
        disabled={pending || (value || null) === (current ?? null)}
        aria-busy={pending}
        className="focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-white/10 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-white/20 disabled:opacity-50 touch:min-h-11"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
        Danışmanı değiştir
      </button>
      {error ? (
        <span role="alert" className="w-full px-1 pb-1 text-xs font-semibold text-danger-300">
          {error}
        </span>
      ) : null}
    </form>
  );
}
