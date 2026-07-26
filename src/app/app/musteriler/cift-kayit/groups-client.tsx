"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowUpRight, Eye, EyeOff, Mail, Phone, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatTurkishPhone } from "@/lib/phone";
import { MergeWizard } from "./merge-wizard";

export type DuplicateRecord = {
  customer_id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
  activity: number;
};

export type DuplicateGroup = {
  signal: "phone" | "email" | "name";
  key: string;
  kayitlar: DuplicateRecord[];
};

const SIGNAL_META: Record<
  DuplicateGroup["signal"],
  { label: string; desc: string; variant: "danger" | "warning" | "info"; icon: typeof Phone }
> = {
  phone: {
    label: "Aynı telefon",
    desc: "Telefon kayıt sırasında normalize ediliyor; aynı numara neredeyse kesin aynı kişidir.",
    variant: "danger",
    icon: Phone,
  },
  email: {
    label: "Aynı e-posta",
    desc: "E-posta adresi paylaşılmadıysa aynı kişidir.",
    variant: "warning",
    icon: Mail,
  },
  name: {
    label: "Aynı ad soyad",
    desc: "Tek başına kanıt değil — “Ali Yılmaz” iki farklı kişi olabilir. Telefon ve geçmişe bakın.",
    variant: "info",
    icon: UserRound,
  },
};

/**
 * "Yanlış eşleşme / yoksay" — DB'siz hafif çözüm: grup imzası
 * (signal::key) localStorage'da tutulur, kart gizlenir. Cihaza özeldir;
 * yanlışlıkla gizlenen grup "Gizlenenleri göster" ile geri gelir.
 */
const HIDDEN_KEY = "emlaksoft:cift-kayit:gizli-gruplar";

function readHidden(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

const HIDDEN_EVENT = "emlaksoft:cift-kayit:hidden-changed";

function writeHidden(list: string[]) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(list));
  } catch {
    // localStorage kapalıysa sessizce geç — gizleme sadece kolaylık
  }
  window.dispatchEvent(new Event(HIDDEN_EVENT));
}

/* useSyncExternalStore ile hydration-güvenli okuma: server snapshot boş liste,
   client snapshot localStorage — effect içinde setState gerekmez. */
const EMPTY_HIDDEN: string[] = [];
let hiddenCache: { raw: string | null; list: string[] } = { raw: null, list: EMPTY_HIDDEN };

function subscribeHidden(cb: () => void) {
  window.addEventListener(HIDDEN_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(HIDDEN_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function getHiddenSnapshot(): string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(HIDDEN_KEY);
  } catch {
    raw = null;
  }
  if (raw !== hiddenCache.raw) {
    let list: string[] = EMPTY_HIDDEN;
    try {
      const arr = raw ? JSON.parse(raw) : [];
      list = Array.isArray(arr) ? arr.filter((s): s is string => typeof s === "string") : EMPTY_HIDDEN;
    } catch {
      list = EMPTY_HIDDEN;
    }
    hiddenCache = { raw, list };
  }
  return hiddenCache.list;
}

function getHiddenServerSnapshot(): string[] {
  return EMPTY_HIDDEN;
}

function tarih(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(iso));
}

export function DuplicateGroupsClient({ groups }: { groups: DuplicateGroup[] }) {
  const hidden = useSyncExternalStore(subscribeHidden, getHiddenSnapshot, getHiddenServerSnapshot);
  const [showHidden, setShowHidden] = useState(false);

  const sigOf = (g: DuplicateGroup) => `${g.signal}::${g.key}`;
  const hiddenSet = new Set(hidden);
  const gizliSayisi = groups.filter((g) => hiddenSet.has(sigOf(g))).length;
  const gosterilen = !showHidden ? groups.filter((g) => !hiddenSet.has(sigOf(g))) : groups;

  function hideGroup(g: DuplicateGroup) {
    writeHidden([...new Set([...readHidden(), sigOf(g)])]);
  }

  function unhideGroup(g: DuplicateGroup) {
    writeHidden(readHidden().filter((s) => s !== sigOf(g)));
  }

  return (
    <div className="space-y-4">
      {gizliSayisi > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-[14px] border border-line bg-canvas px-4 py-2.5">
          <p className="text-xs text-text-muted">
            <span className="numeric font-semibold">{gizliSayisi}</span> grup &quot;mükerrer
            değil&quot; olarak işaretlendi (yalnızca bu cihazda gizli).
          </p>
          <button
            type="button"
            onClick={() => setShowHidden((v) => !v)}
            className="focus-ring press inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-400 hover:text-brand-600"
          >
            {showHidden ? (
              <>
                <EyeOff className="h-3.5 w-3.5" /> Gizlenenleri sakla
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5" /> Gizlenenleri göster
              </>
            )}
          </button>
        </div>
      ) : null}

      {gosterilen.length === 0 ? (
        <div className="grid place-items-center rounded-[20px] border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
          <p className="text-sm text-text-muted">
            Tüm gruplar &quot;mükerrer değil&quot; olarak gizlendi.
          </p>
        </div>
      ) : (
        gosterilen.map((g) => {
          const meta = SIGNAL_META[g.signal];
          const gizli = hiddenSet.has(sigOf(g));
          // En dolu kayıt: birleştirmede genelde bu tutulur.
          const enDolu = Math.max(...g.kayitlar.map((k) => k.activity));
          return (
            <section
              key={sigOf(g)}
              className={`surface-card rounded-[var(--radius-panel)] p-5 ${gizli ? "opacity-60" : ""}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2">
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    <span className="numeric truncate text-sm font-semibold text-ink-950">
                      {g.signal === "phone" ? formatTurkishPhone(g.key) : g.key}
                    </span>
                  </p>
                  <p className="mt-1 text-[11px] text-text-faint">{meta.desc}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded-full bg-canvas px-2.5 py-1 text-xs font-semibold text-text-muted">
                    {g.kayitlar.length} kayıt
                  </span>
                  {gizli ? (
                    <button
                      type="button"
                      onClick={() => unhideGroup(g)}
                      className="focus-ring press rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-400 hover:text-brand-600"
                    >
                      Tekrar göster
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => hideGroup(g)}
                        title="Grubu bu cihazda gizle — veri silinmez"
                        className="focus-ring press rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-400 hover:text-brand-600"
                      >
                        Bu grup mükerrer değil
                      </button>
                      {g.kayitlar.length > 1 ? <MergeWizard kayitlar={g.kayitlar} /> : null}
                    </>
                  )}
                </div>
              </div>

              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {g.kayitlar.map((k) => {
                  const onerilen = k.activity === enDolu && enDolu > 0;
                  return (
                    <li key={k.customer_id}>
                      <Link
                        href={`/app/musteriler/${k.customer_id}`}
                        className={`lift-hover focus-ring group flex h-full items-start justify-between gap-3 rounded-[14px] border p-4 transition ${
                          onerilen ? "border-mint-500/40 bg-mint-500/[0.05]" : "border-line bg-canvas"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink-950">
                            {k.full_name ?? "İsimsiz"}
                          </p>
                          <p className="numeric mt-0.5 text-xs text-text-muted">
                            {k.phone ? formatTurkishPhone(k.phone) : "Telefon yok"}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-text-muted">
                            {k.email ?? "E-posta yok"}
                          </p>
                          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-faint">
                            <span>{tarih(k.created_at)} tarihinde eklendi</span>
                            <span className="numeric">{k.activity} kayıt hareketi</span>
                            {onerilen ? (
                              <span className="font-semibold text-mint-600">en dolu kayıt</span>
                            ) : null}
                          </p>
                        </div>
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-surface text-text-faint transition group-hover:bg-brand-600/10 group-hover:text-brand-600">
                          <ArrowUpRight className="h-4 w-4" />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
