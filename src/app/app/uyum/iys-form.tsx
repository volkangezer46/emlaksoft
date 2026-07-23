"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { upsertIysConsent } from "@/app/actions/compliance";
import { useToast } from "@/components/app/toast-provider";

export function IysForm({ customers }: { customers: { id: string; full_name: string }[] }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, setPending] = useState(false);

  async function onSubmit(fd: FormData) {
    setPending(true);
    const res = await upsertIysConsent(fd);
    setPending(false);
    if (res.ok) {
      push("İYS kaydı güncellendi", "ok");
      router.refresh();
      return;
    }
    push(res.error ?? "Hata", "err");
  }

  return (
    <form action={onSubmit} className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <h2 className="font-display font-bold text-ink-950">İzin kaydı</h2>
      <div className="mt-4 space-y-3">
        <div>
          <label className="mb-1.5 block text-sm text-text-muted">Müşteri *</label>
          <select name="customer_id" required className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm">
            <option value="">Seçiniz</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.full_name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm text-text-muted">Kanal</label>
            <select name="channel" defaultValue="sms" className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm">
              <option value="sms">SMS</option>
              <option value="email">E-posta</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="call">Arama</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-text-muted">Durum</label>
            <select name="status" defaultValue="granted" className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm">
              <option value="granted">İzinli</option>
              <option value="denied">Ret</option>
              <option value="pending">Bekliyor</option>
              <option value="unknown">Bilinmiyor</option>
            </select>
          </div>
        </div>
        <button type="submit" disabled={pending} className="w-full rounded-[11px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </div>
    </form>
  );
}
