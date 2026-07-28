"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Gift,
  Link2,
  Loader2,
  MessageSquarePlus,
  Search,
  Sparkles,
  UserPlus,
  Wand2,
} from "lucide-react";
import {
  addReferralNote,
  convertReferralToCustomer,
  createReferralLink,
  setReferralStatus,
  toggleReferralLink,
} from "@/app/actions/referrals";
import { formatTurkishPhone } from "@/lib/phone";

export type CustomerOption = { id: string; full_name: string; phone: string | null };
export type StaffOption = { id: string; full_name: string };

const inputCls =
  "w-full rounded-[11px] border border-line bg-canvas px-3 py-2.5 text-sm text-ink-950 placeholder:text-text-faint outline-none transition focus:border-brand-400";

const SMALL_BTN =
  "focus-ring press inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-hairline-strong bg-surface px-2.5 text-xs font-semibold text-ink-950 transition hover:bg-canvas disabled:pointer-events-none disabled:opacity-55";

/** Tavsiye linkini panoya kopyalar — 2 sn "Kopyalandı" (CopySurveyLinkButton deseni). */
export function CopyReferralLinkButton({ url, label }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Pano izni yoksa prompt en garantili yedek (eski Safari/kiosk).
          window.prompt("Linki kopyalayın:", url);
        }
      }}
      title={url}
      className={SMALL_BTN}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-mint-600" /> : <Link2 className="h-3.5 w-3.5" />}
      {copied ? "Kopyalandı" : (label ?? "Linki kopyala")}
    </button>
  );
}

const STATUS_OPTIONS = [
  { value: "yeni", label: "Yeni" },
  { value: "iletisim", label: "İletişimde" },
  { value: "musteri", label: "Müşteri" },
  { value: "kazanildi", label: "Kazanıldı" },
  { value: "kayip", label: "Kayıp" },
] as const;

/** Durum değiştirici — tek tık, sunucu action + router.refresh. */
export function ReferralStatusPills({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="inline-flex flex-wrap gap-1 rounded-[10px] border border-hairline bg-canvas p-0.5">
        {STATUS_OPTIONS.map((opt) => {
          const active = current === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={pending || active}
              aria-pressed={active}
              onClick={() => {
                setError(null);
                const prev = current;
                setCurrent(opt.value);
                const fd = new FormData();
                fd.set("id", id);
                fd.set("status", opt.value);
                startTransition(async () => {
                  const res = await setReferralStatus(fd);
                  if (res.error) {
                    setCurrent(prev);
                    setError(res.error);
                    return;
                  }
                  router.refresh();
                });
              }}
              className={`focus-ring rounded-[8px] px-2 py-1 text-[11px] font-semibold transition ${
                active
                  ? "bg-brand-600 text-white shadow-[var(--elev-1)]"
                  : "text-text-muted hover:bg-surface hover:text-ink-950"
              } disabled:pointer-events-none`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {error ? (
        <span className="text-[11px] font-semibold text-danger-500" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Tavsiyeyi müşteri kaydına dönüştürür; mükerrer telefonda mevcuda bağlar ve bunu söyler. */
export function ConvertReferralButton({ id, done }: { id: string; done: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done && !message) {
    return <span className="text-[11px] font-semibold text-mint-600">Müşteriye dönüştürüldü</span>;
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      {message ? null : (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            const fd = new FormData();
            fd.set("id", id);
            startTransition(async () => {
              const res = await convertReferralToCustomer(fd);
              if (res.error) {
                setError(res.error);
                return;
              }
              setMessage(res.message ?? "Müşteri kaydı açıldı.");
              router.refresh();
            });
          }}
          className="focus-ring press inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-brand-600 px-2.5 text-xs font-bold text-white transition hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-55"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
          Müşteriye dönüştür
        </button>
      )}
      {message ? (
        <span className="max-w-[240px] text-[11px] font-semibold leading-relaxed text-mint-600" role="status">
          {message}
        </span>
      ) : null}
      {error ? (
        <span className="max-w-[240px] text-[11px] font-semibold text-danger-500" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** Ofis içi not ekleme — açılır küçük alan, kaydedince listeyi tazeler. */
export function ReferralNoteButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={SMALL_BTN}>
        <MessageSquarePlus className="h-3.5 w-3.5" />
        Not ekle
      </button>
    );
  }

  return (
    <div className="w-[240px] space-y-1.5">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={2000}
        autoFocus
        placeholder="Örn. Aradım, cumartesi bakacak."
        className={`${inputCls} resize-none text-xs`}
      />
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={pending || !note.trim()}
          onClick={() => {
            setError(null);
            const fd = new FormData();
            fd.set("id", id);
            fd.set("note", note);
            startTransition(async () => {
              const res = await addReferralNote(fd);
              if (res.error) {
                setError(res.error);
                return;
              }
              setNote("");
              setOpen(false);
              router.refresh();
            });
          }}
          className="focus-ring press inline-flex h-7 items-center gap-1.5 rounded-[8px] bg-brand-600 px-2.5 text-[11px] font-bold text-white transition hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-55"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Kaydet
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="text-[11px] font-semibold text-text-muted transition hover:text-ink-950"
        >
          Vazgeç
        </button>
      </div>
      {error ? (
        <p className="text-[11px] font-semibold text-danger-500" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Aktif/pasif anahtarı — kapalı linkte public sayfa form göstermez. */
export function ReferralLinkToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(active);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={on ? "Linki kapat" : "Linki aç"}
        disabled={pending}
        onClick={() => {
          setError(null);
          const next = !on;
          setOn(next);
          const fd = new FormData();
          fd.set("id", id);
          fd.set("active", next ? "1" : "0");
          startTransition(async () => {
            const res = await toggleReferralLink(fd);
            if (res.error) {
              setOn(!next);
              setError(res.error);
              return;
            }
            router.refresh();
          });
        }}
        className={`focus-ring relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-55 ${
          on ? "bg-mint-500" : "bg-ink-950/15"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-[var(--elev-1)] transition ${
            on ? "translate-x-[18px]" : "translate-x-[2px]"
          }`}
        />
      </button>
      {error ? (
        <span className="max-w-[160px] text-[11px] font-semibold text-danger-500" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Tavsiye linki üretici — aramalı müşteri seçici + danışman + ödül notu.
 *
 * Müşteri listesi sunucudan ilk 300 kayıt olarak gelir ve arama istemcide
 * yapılır: seçim anlık olsun, her tuşta sunucuya gidilmesin.
 */
export function ReferralLinkCreator({
  customers,
  staff,
}: {
  customers: CustomerOption[];
  staff: StaffOption[];
}) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<CustomerOption | null>(null);
  const [staffId, setStaffId] = useState("");
  const [reward, setReward] = useState("");
  const [result, setResult] = useState<{ url: string; existed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const t = term.trim().toLocaleLowerCase("tr");
    const list = t
      ? customers.filter(
          (c) =>
            c.full_name.toLocaleLowerCase("tr").includes(t) ||
            (c.phone ?? "").replace(/\D/g, "").includes(t.replace(/\D/g, "")),
        )
      : customers;
    return list.slice(0, 8);
  }, [customers, term]);

  return (
    <div className="rounded-[16px] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
      <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
        <Wand2 className="h-4 w-4 text-brand-600" />
        Tavsiye linki üret
      </h2>
      <p className="mt-1 text-xs text-text-muted">
        Müşteriyi seçin, linki kopyalayıp kendisine gönderin. Link kişiye özeldir; gelen tavsiyeler
        otomatik olarak o müşterinin hanesine yazılır.
      </p>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div>
          <label htmlFor="ref-customer-search" className="mb-1.5 block text-xs font-semibold text-text-muted">
            Tavsiye edecek müşteri *
          </label>
          {selected ? (
            <div className="flex items-center justify-between gap-2 rounded-[11px] border border-brand-300/50 bg-brand-600/5 px-3 py-2.5">
              <span className="truncate text-sm font-semibold text-ink-950">{selected.full_name}</span>
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setResult(null);
                }}
                className="shrink-0 text-[11px] font-semibold text-text-muted transition hover:text-danger-500"
              >
                Değiştir
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-[13px] h-4 w-4 text-text-faint" />
              <input
                id="ref-customer-search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Ad veya telefon ara…"
                className={`${inputCls} pl-9`}
              />
              {term.trim() ? (
                <ul className="mt-1.5 max-h-56 space-y-1 overflow-y-auto rounded-[11px] border border-line bg-canvas p-1">
                  {filtered.length === 0 ? (
                    <li className="px-2.5 py-2 text-xs text-text-muted">Eşleşen müşteri yok.</li>
                  ) : (
                    filtered.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(c);
                            setTerm("");
                            setResult(null);
                          }}
                          className="focus-ring flex w-full items-center justify-between gap-2 rounded-[8px] px-2.5 py-2 text-left text-xs transition hover:bg-surface"
                        >
                          <span className="truncate font-semibold text-ink-950">{c.full_name}</span>
                          <span className="numeric shrink-0 text-[11px] text-text-faint">
                            {formatTurkishPhone(c.phone)}
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </div>
          )}
        </div>

        <div>
          <label htmlFor="ref-staff" className="mb-1.5 block text-xs font-semibold text-text-muted">
            Gelen tavsiyeleri alacak danışman
          </label>
          <select
            id="ref-staff"
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            className={inputCls}
          >
            <option value="">İşlemi yapan üstlensin</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="ref-reward" className="mb-1.5 block text-xs font-semibold text-text-muted">
            Ödül notu <span className="font-normal text-text-faint">(sayfada görünür)</span>
          </label>
          <input
            id="ref-reward"
            value={reward}
            onChange={(e) => setReward(e.target.value)}
            maxLength={300}
            placeholder="Örn. Anlaşma olursa 1.000 TL hediye çeki"
            className={inputCls}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending || !selected}
          onClick={() => {
            if (!selected) return;
            setError(null);
            const fd = new FormData();
            fd.set("customer_id", selected.id);
            fd.set("staff_id", staffId);
            fd.set("reward_note", reward);
            startTransition(async () => {
              const res = await createReferralLink(fd);
              if (res.error) {
                setError(res.error);
                return;
              }
              setResult({ url: res.url ?? "", existed: res.existed === true });
              router.refresh();
            });
          }}
          className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[11px] bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-55"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
          Link üret
        </button>

        {result ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-mint-600">
              {result.existed ? "Bu müşterinin zaten aktif linki var" : "Link hazır"}
            </span>
            <CopyReferralLinkButton url={result.url} />
            <code className="max-w-[320px] truncate rounded-[8px] bg-canvas px-2 py-1 text-[11px] text-text-muted">
              {result.url}
            </code>
          </span>
        ) : null}

        {error ? (
          <span className="text-xs font-semibold text-danger-500" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * NPS entegrasyonu: ankette 9-10 veren ("destekleyen") ama henüz linki olmayan
 * müşteri için tek tık link üretimi.
 */
export function SuggestedReferralButton({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (url) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-[11px] font-semibold text-mint-600">Link hazır</span>
        <CopyReferralLinkButton url={url} label="Kopyala" />
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        aria-label={`${customerName} için tavsiye linki üret`}
        onClick={() => {
          setError(null);
          const fd = new FormData();
          fd.set("customer_id", customerId);
          startTransition(async () => {
            const res = await createReferralLink(fd);
            if (res.error) {
              setError(res.error);
              return;
            }
            setUrl(res.url ?? null);
            router.refresh();
          });
        }}
        className="focus-ring press inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-brand-600 px-3 text-xs font-bold text-white transition hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-55"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        Link üret
      </button>
      {error ? (
        <span className="text-[11px] font-semibold text-danger-500" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
