"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Clock3,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Radio,
  Save,
} from "lucide-react";
import { createCall } from "@/app/actions/calls";
import { PhoneInput } from "@/components/ui/phone-input";
import { formatTurkishPhone } from "@/lib/phone";

type Customer = {
  id: string;
  full_name: string;
  phone: string | null;
  customer_types: string[] | null;
  notes: string | null;
};

const dispositions = [
  "Ulaşıldı",
  "Randevu aldı",
  "Portföy istedi",
  "Tekrar aranacak",
  "İlgilenmiyor",
  "Kara liste",
];

export function CallConsole({
  customers,
  matchCounts = {},
  demandCounts = {},
}: {
  customers: Customer[];
  /** müşteri id → eşleşen portföy adedi (sunucu hesabı) */
  matchCounts?: Record<string, number>;
  /** müşteri id → açık talep adedi */
  demandCounts?: Record<string, number>;
}) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [phone, setPhone] = useState(customers[0]?.phone ?? "");
  const [direction, setDirection] = useState("inbound");
  const [disposition, setDisposition] = useState("Ulaşıldı");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const customer = useMemo(
    () => customers.find((item) => item.id === customerId) ?? null,
    [customerId, customers],
  );

  const matchN = customerId ? matchCounts[customerId] ?? 0 : 0;
  const demandN = customerId ? demandCounts[customerId] ?? 0 : 0;
  const score = Math.min(96, 40 + demandN * 12 + matchN * 8);

  function selectCustomer(id: string) {
    setCustomerId(id);
    setPhone(customers.find((item) => item.id === id)?.phone ?? "");
  }

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await createCall(formData);
    setPending(false);
    if (result.ok) {
      router.refresh();
    } else {
      setError(result.error ?? "Çağrı kaydedilemedi.");
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[.82fr_1.18fr]">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-5 text-white shadow-[var(--shadow-lg)]">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-14 h-52 w-52 rounded-full bg-mint-500/25 blur-[70px]" />
        <div className="relative flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs font-semibold text-mint-400"><Radio className="h-4 w-4" /> Görüşme kaydı</span>
          <span className="rounded-full bg-mint-400/12 px-2.5 py-1 text-[10px] font-bold text-mint-400">MANUEL</span>
        </div>

        <div className="relative mt-8 text-center">
          <span className="pulse-ring mx-auto grid h-18 w-18 place-items-center rounded-full bg-mint-500 text-white shadow-[var(--shadow-glow-mint)]">
            <PhoneIncoming className="h-7 w-7" />
          </span>
          <h2 className="mt-5 font-display text-2xl font-extrabold text-white">{customer?.full_name ?? "Bilinmeyen arayan"}</h2>
          <p className="mt-1 text-sm tabular-nums text-white/55">{phone ? formatTurkishPhone(phone) : "Telefon girilmedi"}</p>
          <div className="mt-3 flex justify-center gap-2">
            {(customer?.customer_types ?? ["Yeni arayan"]).slice(0, 2).map((type) => <span key={type} className="rounded-full border border-white/10 bg-white/8 px-2.5 py-1 text-[10px] font-semibold text-cyan-400">{type}</span>)}
          </div>
        </div>

        <div className="relative mt-7 space-y-2">
          <div className="rounded-[12px] border border-white/10 bg-white/5 p-3">
            <p className="text-[10px] font-bold uppercase tracking-[.1em] text-white/35">Müşteri bağlamı</p>
            <p className="mt-1 text-xs leading-relaxed text-white/70">{customer?.notes || "Henüz talep notu bulunmuyor. Görüşme sonunda sonuç kodu ve not ekleyin."}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-[11px] border border-white/10 bg-white/5 p-3">
              <p className="text-[9px] text-white/35">Açık talep</p>
              <p className="mt-1 font-display text-lg font-bold text-white">{demandN}</p>
            </div>
            <div className="rounded-[11px] border border-white/10 bg-white/5 p-3">
              <p className="text-[9px] text-white/35">Müşteri skoru</p>
              <p className="mt-1 font-display text-lg font-bold text-mint-400">{customer ? score : "—"}</p>
            </div>
          </div>
        </div>
      </section>

      <form action={submit} className="dashboard-panel rounded-[22px] border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><PhoneCall className="h-4 w-4" /> Görüşme konsolu</p><h2 className="mt-1 font-display text-lg font-bold text-ink-950">Çağrı kaydı ve sonuç kodu</h2></div>
          <span className="flex items-center gap-1.5 rounded-full bg-brand-600/8 px-2.5 py-1 text-[10px] font-semibold text-brand-600"><Clock3 className="h-3.5 w-3.5" /> Realtime kayıt</span>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-ink-950">
            Müşteri
            <select name="customer_id" value={customerId} onChange={(event) => selectCustomer(event.target.value)} className="mt-1.5 w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400">
              <option value="">Bilinmeyen arayan</option>
              {customers.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-ink-950">
            Telefon *
            <div className="mt-1.5">
              <PhoneInput name="phone" required value={phone} onValueChange={setPhone} />
            </div>
          </label>
        </div>

        <div className="mt-4">
          <p className="text-sm font-medium text-ink-950">Çağrı yönü</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {[
              { value: "inbound", label: "Gelen", icon: PhoneIncoming },
              { value: "outbound", label: "Giden", icon: PhoneOutgoing },
              { value: "missed", label: "Cevapsız", icon: PhoneMissed },
            ].map((item) => (
              <label key={item.value} className={`flex cursor-pointer items-center justify-center gap-2 rounded-[10px] border px-3 py-2.5 text-xs font-semibold transition ${direction === item.value ? "border-brand-400 bg-brand-600/8 text-brand-600" : "border-line text-text-muted hover:border-brand-300"}`}>
                <input type="radio" name="direction" value={item.value} checked={direction === item.value} onChange={() => setDirection(item.value)} className="sr-only" />
                <item.icon className="h-4 w-4" /> {item.label}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <p className="text-sm font-medium text-ink-950">Görüşme sonucu {direction !== "missed" ? "*" : ""}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {dispositions.map((code) => (
              <label key={code} className={`cursor-pointer rounded-[10px] border px-3 py-2.5 text-xs font-medium transition ${disposition === code ? "border-mint-500/40 bg-mint-500/8 text-mint-600" : "border-line bg-canvas text-text-muted hover:border-brand-300"}`}>
                <input type="radio" name="disposition" value={code} checked={disposition === code} onChange={() => setDisposition(code)} className="sr-only" />
                <span className="flex items-center gap-1.5">{disposition === code ? <Check className="h-3.5 w-3.5" /> : null}{code}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-[120px_1fr]">
          <label className="text-sm font-medium text-ink-950">Süre (sn)<input name="duration_sec" inputMode="numeric" defaultValue="180" className="mt-1.5 w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" /></label>
          <label className="text-sm font-medium text-ink-950">Görüşme notu<textarea name="notes" rows={2} className="mt-1.5 w-full resize-none rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" placeholder="Talep, itiraz, takip notu…" /></label>
        </div>

        {error ? <p className="mt-3 text-sm text-danger-500" role="alert">{error}</p> : null}

        <div className="mt-5 flex justify-end border-t border-line pt-4">
          <button type="submit" disabled={pending} className="btn-shine inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"><Save className="h-4 w-4" />{pending ? "Kaydediliyor…" : "Görüşmeyi kaydet"}</button>
        </div>
      </form>
    </div>
  );
}
