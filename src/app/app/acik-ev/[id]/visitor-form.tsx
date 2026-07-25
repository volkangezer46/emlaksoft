"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { registerOpenHouseVisitor } from "@/app/actions/targets-openhouse-sources";
import { PhoneInput } from "@/components/ui/phone-input";

/**
 * Açık ev ziyaretçi kaydı.
 *
 * TASARIM NOTU: Bu form bir dialog DEĞİL, sayfa içinde açık duruyor. Açık ev
 * günü danışman kapıda telefonla art arda isim giriyor; her seferinde bir
 * pencere açıp kapatmak yavaş. Kaydettikten sonra odak ada geri dönüyor ki
 * sıradaki ziyaretçi doğrudan yazılabilsin.
 */
export function VisitorForm({ openHouseId }: { openHouseId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(fd: FormData) {
    setError(null);
    setOk(false);
    const full_name = String(fd.get("full_name") ?? "").trim();
    if (!full_name) {
      setError("Ziyaretçi adı zorunlu.");
      return;
    }
    startTransition(async () => {
      const res = await registerOpenHouseVisitor(openHouseId, {
        full_name,
        phone: String(fd.get("phone") ?? "").trim() || undefined,
        email: String(fd.get("email") ?? "").trim() || undefined,
        notes: String(fd.get("notes") ?? "").trim() || undefined,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      formRef.current?.reset();
      setOk(true);
      nameRef.current?.focus();
      router.refresh();
    });
  }

  return (
    <form ref={formRef} action={submit} className="mt-3 grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="mb-1.5 block text-sm text-text-muted" htmlFor="visitor-name">
          Ad soyad *
        </label>
        <input
          id="visitor-name"
          ref={nameRef}
          name="full_name"
          required
          autoComplete="off"
          className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400"
          placeholder="Örn. Ayşe Yıldız"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm text-text-muted" htmlFor="visitor-phone">
          Telefon
        </label>
        <PhoneInput id="visitor-phone" name="phone" />
      </div>
      <div>
        <label className="mb-1.5 block text-sm text-text-muted" htmlFor="visitor-email">
          E-posta
        </label>
        <input
          id="visitor-email"
          name="email"
          type="email"
          autoComplete="off"
          className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400"
        />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1.5 block text-sm text-text-muted" htmlFor="visitor-notes">
          Not
        </label>
        <input
          id="visitor-notes"
          name="notes"
          className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400"
          placeholder="İlgilendiği daire, bütçe, geri dönüş isteği…"
        />
      </div>

      {error ? (
        <p className="text-sm font-medium text-danger-600 sm:col-span-2" role="alert">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="text-sm font-medium text-mint-600 sm:col-span-2" role="status">
          Ziyaretçi kaydedildi. Sıradakini yazabilirsiniz.
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
        >
          <UserPlus className="h-4 w-4" /> {pending ? "Kaydediliyor…" : "Ziyaretçiyi kaydet"}
        </button>
      </div>
    </form>
  );
}
