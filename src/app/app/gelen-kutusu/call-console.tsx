"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/smart-link";
import {
  Check,
  Lock,
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
import { phoneDigitsNeedle } from "@/lib/pgrst";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { lookupCustomerByPhone, searchCustomers, type CallerPhoneLookup } from "@/app/actions/lookup";

type Customer = {
  id: string;
  full_name: string;
  phone: string | null;
  customer_types: string[] | null;
  notes: string | null;
};

export const CALL_DISPOSITIONS = [
  "Ulaşıldı",
  "Randevu aldı",
  "Portföy istedi",
  "Tekrar aranacak",
  "İlgilenmiyor",
  "Kara liste",
] as const;
const dispositions = CALL_DISPOSITIONS;

/** Telefon tamamlandı mı (yerel 10 hane)? Kısmi numarada otomatik eşleme yapılmaz. */
function completeNeedle(phone: string): string | null {
  const n = phoneDigitsNeedle(phone);
  return n && n.length >= 10 ? n : null;
}

/**
 * Çağrı konsolu (B064): parametresiz açılışta müşteri ve telefon BOŞ gelir (listedeki ilk müşteri seçilmez).
 * Numara tamamlanınca arayan otomatik eşlenir: önce sayfadaki liste, yoksa sunucu (müşteri listesiyle aynı kapsam);
 * kapsam dışı tam eşleşmede yalnız "Bu numara X danışmanının müşterisi" yazar. Gösterilen sayılar gerçek veridir
 * (uydurma skor ve "Realtime kayıt" rozeti yok). Kaydet çift tıklamada tek çağrı yazar.
 */
export function CallConsole({
  customers,
  matchCounts = {},
  demandCounts = {},
  initialCustomerId,
}: {
  customers: Customer[];
  /** müşteri id → eşleşen portföy adedi (sunucu hesabı) */
  matchCounts?: Record<string, number>;
  /** müşteri id → açık talep adedi */
  demandCounts?: Record<string, number>;
  /** ?customer= kısayolu — konsol bu müşteriyle açılır */
  initialCustomerId?: string;
}) {
  const initialCustomer = initialCustomerId ? (customers.find((item) => item.id === initialCustomerId) ?? null) : null;
  const [customerId, setCustomerId] = useState(initialCustomer?.id ?? "");
  const [phone, setPhone] = useState(initialCustomer?.phone ?? "");
  const [direction, setDirection] = useState("inbound");
  const [disposition, setDisposition] = useState("Ulaşıldı");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Sunucudan eşlenen (sayfa listesinde olmayan) müşteri: seçici etiketi için. */
  const [remoteMatch, setRemoteMatch] = useState<(ComboboxOption & { phone: string | null }) | null>(null);
  const [lookup, setLookup] = useState<{ needle: string; result: CallerPhoneLookup | null } | null>(null);
  const lookupSeq = useRef(0);
  const inFlight = useRef(false);
  const router = useRouter();

  const customer = useMemo(
    () => customers.find((item) => item.id === customerId) ?? null,
    [customerId, customers],
  );
  const customerLabel = customer?.full_name ?? (remoteMatch && remoteMatch.value === customerId ? remoteMatch.label : null);

  const matchN = customerId ? matchCounts[customerId] ?? 0 : 0;
  const demandN = customerId ? demandCounts[customerId] ?? 0 : 0;

  function selectCustomer(id: string) {
    setCustomerId(id);
    setLookup(null);
    const local = customers.find((item) => item.id === id);
    if (local) setPhone(local.phone ?? "");
    else if (remoteMatch?.value === id) setPhone(remoteMatch.phone ?? "");
  }

  /** Numara yazıldıkça: tamamlanınca arayanı eşle (seçili müşterinin kendi numarasıysa dokunma). */
  function changePhone(next: string) {
    setPhone(next);
    const needle = completeNeedle(next);
    if (!needle) {
      setLookup(null);
      return;
    }
    const current = customers.find((c) => c.id === customerId);
    if (current && completeNeedle(current.phone ?? "") === needle) return;
    const local = customers.filter((c) => completeNeedle(c.phone ?? "") === needle);
    if (local.length === 1) {
      setCustomerId(local[0]!.id);
      setLookup(null);
      return;
    }
    const mine = ++lookupSeq.current;
    setLookup({ needle, result: null });
    void lookupCustomerByPhone(next)
      .then((result) => {
        if (mine !== lookupSeq.current) return;
        setLookup({ needle, result });
        if (result.match) {
          setRemoteMatch(result.match);
          setCustomerId(result.match.value);
        } else {
          setCustomerId("");
        }
      })
      .catch(() => {
        if (mine === lookupSeq.current) setLookup(null);
      });
  }

  async function submit(formData: FormData) {
    // Çift tıklama kilidi (B064): pending bir sonraki render'a kadar güncellenmez; ref anında kilitler.
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await createCall(formData);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error ?? "Çağrı kaydedilemedi.");
      }
    } catch {
      setError("Bağlantı hatası: çağrı kaydedilemedi.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const foreign = lookup?.result?.foreign ?? [];
  const lookupState: "idle" | "searching" | "matched" | "multi" | "foreign" | "new" = !lookup
    ? "idle"
    : !lookup.result
      ? "searching"
      : lookup.result.match
        ? "matched"
        : lookup.result.count > 1
          ? "multi"
          : foreign.length > 0
            ? "foreign"
            : "new";
  const options = useMemo(() => {
    const base = customers.map((item) => ({ value: item.id, label: item.full_name }));
    return remoteMatch && !base.some((o) => o.value === remoteMatch.value) ? [{ value: remoteMatch.value, label: remoteMatch.label }, ...base] : base;
  }, [customers, remoteMatch]);

  return (
    <div className="grid gap-4 xl:grid-cols-[.82fr_1.18fr]">
      <section className="theme-dark relative overflow-hidden rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-5 text-white shadow-[var(--shadow-lg)]">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-14 h-52 w-52 rounded-full bg-mint-500/25 blur-[70px]" />
        <div className="relative flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs font-semibold text-mint-400"><Radio className="h-4 w-4" /> Görüşme kaydı</span>
          <span className="rounded-full bg-mint-400/12 px-2.5 py-1 text-xs font-bold text-mint-400">MANUEL</span>
        </div>

        <div className="relative mt-8 text-center">
          <span className="pulse-ring mx-auto grid h-18 w-18 place-items-center rounded-full bg-mint-500 text-white shadow-[var(--shadow-glow-mint)]">
            <PhoneIncoming className="h-7 w-7" />
          </span>
          <h2 className="mt-5 font-display text-2xl font-extrabold text-white">{customerLabel ?? (phone ? "Yeni arayan" : "Arayan bekleniyor")}</h2>
          <p className="mt-1 text-sm tabular-nums text-white/55">{phone ? formatTurkishPhone(phone) : "Telefon girilmedi"}</p>
          <div className="mt-3 flex justify-center gap-2">
            {(customer?.customer_types ?? (customerLabel ? [] : phone ? ["Yeni arayan"] : [])).slice(0, 2).map((type) => <span key={type} className="rounded-full border border-white/10 bg-white/8 px-2.5 py-1 text-xs font-semibold text-cyan-400">{type}</span>)}
          </div>
        </div>

        <div className="relative mt-7 space-y-2">
          <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-3">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-white/35">Müşteri bağlamı</p>
            <p className="mt-1 text-xs leading-relaxed text-white/70">
              {customer?.notes || (customerId ? "Henüz talep notu bulunmuyor. Görüşme sonunda sonuç kodu ve not ekleyin." : "Numarayı yazın: kayıtlı müşteri otomatik bulunur.")}
            </p>
          </div>
          {customerId ? (
            <div className="grid grid-cols-2 gap-2">
              {/* Gerçek sayılar; her biri o müşterinin süzülmüş listesine gider (uydurma skor yok). */}
              <Link href={`/app/musteriler/${customerId}?sekme=talepler`} className="focus-ring rounded-[var(--radius-control)] border border-white/10 bg-white/5 p-3 transition hover:bg-white/10">
                <p className="text-xs text-white/35">Açık talep</p>
                <p className="mt-1 font-display text-lg font-bold text-white">{demandN}</p>
              </Link>
              <Link href={`/app/talepler?sekme=eslesme&customer=${customerId}`} className="focus-ring rounded-[var(--radius-control)] border border-white/10 bg-white/5 p-3 transition hover:bg-white/10">
                <p className="text-xs text-white/35">Eşleşen portföy</p>
                <p className="mt-1 font-display text-lg font-bold text-mint-400">{matchN}</p>
              </Link>
            </div>
          ) : null}
        </div>
      </section>

      <form action={submit} className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><PhoneCall className="h-4 w-4" /> Görüşme konsolu</p><h2 className="mt-1 font-display text-lg font-bold text-ink-950">Çağrı kaydı ve sonuç kodu</h2></div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="text-sm font-medium text-ink-950">
            Müşteri
            {/* Kontrollü kullanım: seçim telefon alanını da dolduruyor,
                bu yüzden `value` + `onValueChange` (defaultValue değil). */}
            <Combobox
              className="mt-1.5"
              name="customer_id"
              aria-label="Müşteri"
              value={customerId}
              onValueChange={selectCustomer}
              placeholder="Bilinmeyen arayan"
              searchPlaceholder="Ad ya da telefon ara…"
              emptyText="Eşleşen müşteri yok"
              onSearch={searchCustomers}
              options={options}
            />
          </div>
          <label className="text-sm font-medium text-ink-950">
            Telefon *
            <div className="mt-1.5">
              <PhoneInput name="phone" required value={phone} onValueChange={changePhone} />
            </div>
          </label>
        </div>
        {lookupState !== "idle" ? (
          <p role="status" aria-live="polite" className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
            {lookupState === "searching" ? "Numara aranıyor…" : null}
            {lookupState === "matched" ? <><Check className="h-3.5 w-3.5 text-mint-600" aria-hidden /> Kayıtlı müşteri bulundu ve seçildi.</> : null}
            {lookupState === "multi" ? "Bu numarayla birden çok müşteri var; listeden seçin." : null}
            {lookupState === "new" ? "Kayıtlı müşteri yok: yeni arayan olarak kaydedilir." : null}
            {lookupState === "foreign" ? (
              <>
                <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {foreign
                  .map((f) => `Bu numara ${f.advisor ? `${f.advisor} danışmanının` : "başka bir danışmanın"} müşterisi (${f.name}, ${f.phoneMasked})`)
                  .join(" · ")}
              </>
            ) : null}
          </p>
        ) : null}

        <div className="mt-4">
          <p className="text-sm font-medium text-ink-950">Çağrı yönü</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {[
              { value: "inbound", label: "Gelen", icon: PhoneIncoming },
              { value: "outbound", label: "Giden", icon: PhoneOutgoing },
              { value: "missed", label: "Cevapsız", icon: PhoneMissed },
            ].map((item) => (
              <label key={item.value} className={`flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-control)] border px-3 py-2.5 text-xs font-semibold transition ${direction === item.value ? "border-brand-400 bg-brand-600/8 text-brand-600" : "border-line text-text-muted hover:border-brand-300"}`}>
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
              <label key={code} className={`cursor-pointer rounded-[var(--radius-control)] border px-3 py-2.5 text-xs font-medium transition ${disposition === code ? "border-mint-500/40 bg-mint-500/8 text-mint-600" : "border-line bg-canvas text-text-muted hover:border-brand-300"}`}>
                <input type="radio" name="disposition" value={code} checked={disposition === code} onChange={() => setDisposition(code)} className="sr-only" />
                <span className="flex items-center gap-1.5">{disposition === code ? <Check className="h-3.5 w-3.5" /> : null}{code}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-[120px_1fr]">
          {/* Ön dolu 180 sn kaldırıldı: gerçek süre girilmeden kaydedilen çağrılar ortalamayı bozuyordu */}
          <label className="text-sm font-medium text-ink-950">Süre (sn)<input name="duration_sec" inputMode="numeric" placeholder="örn. 120" className="mt-1.5 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" /></label>
          <label className="text-sm font-medium text-ink-950">Görüşme notu<textarea name="notes" rows={2} className="mt-1.5 w-full resize-none rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" placeholder="Talep, itiraz, takip notu…" /></label>
        </div>

        {error ? <p className="mt-3 text-sm text-danger-500" role="alert">{error}</p> : null}

        <div className="mt-5 flex justify-end border-t border-line pt-4">
          <button type="submit" disabled={pending} className="btn-shine inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"><Save className="h-4 w-4" />{pending ? "Kaydediliyor…" : "Görüşmeyi kaydet"}</button>
        </div>
      </form>
    </div>
  );
}
