"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2, UserPlus, X } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import { searchCustomers } from "@/app/actions/lookup";
import { linkRecordToCustomer } from "@/app/actions/communications";

/**
 * Eşleşmemiş çağrı / iletişim kaydı için satır içi "Müşteriye bağla" paneli (popup yok).
 * Aynı bileşen gelen kutusunda ve çağrı kaydında kullanılır:
 *  - mevcut müşteriyi ara + seç → `linkRecordToCustomer`
 *  - "Bu telefonla müşteri oluştur" → yeni müşteri formu telefon ve bağlanacak kayıtla açılır
 *    (kayıt, müşteri oluşunca otomatik bağlanır; mükerrer uyarısı formda çalışır).
 */
export function LinkToCustomer({
  kind,
  recordId,
  phone,
}: {
  kind: "call" | "comm";
  recordId: string;
  phone: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const params = new URLSearchParams();
  if (phone) params.set("phone", phone);
  params.set("bagla", `${kind === "call" ? "a" : "c"}-${recordId}`);
  const createHref = `/app/musteriler/yeni?${params.toString()}`;

  function submit() {
    if (!customerId) {
      setError("Önce bir müşteri seçin.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await linkRecordToCustomer(kind, recordId, customerId);
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="relative z-10 mt-1.5 w-full basis-full">
      {!open ? (
        <div className="flex flex-wrap items-center gap-3 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={false}
            className="focus-ring inline-flex items-center gap-1 text-brand-600 underline-offset-2 hover:underline"
          >
            <Link2 className="h-3.5 w-3.5" /> Müşteriye bağla
          </button>
          <Link
            href={createHref}
            className="focus-ring inline-flex items-center gap-1 text-brand-600 underline-offset-2 hover:underline"
          >
            <UserPlus className="h-3.5 w-3.5" /> {phone ? "Bu telefonla müşteri oluştur" : "Yeni müşteri oluştur"}
          </Link>
        </div>
      ) : (
        <div
          className="space-y-2 rounded-[var(--radius-control)] border border-brand-300 bg-surface p-3"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-ink-950">Kaydı mevcut bir müşteriye bağla</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Paneli kapat"
              className="focus-ring grid h-6 w-6 place-items-center rounded text-text-faint hover:text-ink-950"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <Combobox
            aria-label="Müşteri"
            placeholder="Müşteri seçin"
            searchPlaceholder="Ad, telefon ya da e-posta ile ara…"
            emptyText="Eşleşen müşteri yok"
            minSearchLength={2}
            clearable={false}
            options={[]}
            onSearch={searchCustomers}
            value={customerId}
            onValueChange={setCustomerId}
          />
          {error ? (
            <p role="alert" className="text-xs text-danger-500">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={pending || !customerId}
              className="focus-ring press rounded-[var(--radius-control)] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {pending ? "Bağlanıyor…" : "Bağla"}
            </button>
            <Link href={createHref} className="focus-ring text-xs font-semibold text-brand-600 underline-offset-2 hover:underline">
              Müşteri yoksa yeni oluştur
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
