"use client";

import { useState } from "react";
import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Eye, EyeOff, Mail, Phone, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useHiddenGroups } from "@/components/app/hidden-groups-store";
import { formatTurkishPhone } from "@/lib/phone";
import { MergeButton, MergePanel } from "./merge-wizard";

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
 * "Yanlış eşleşme / yoksay" — DB'siz hafif çözüm: grup imzası (signal::key) cihazda tutulur, kart gizlenir
 * (`useHiddenGroups`). Yanlışlıkla gizlenen grup "Gizlenenleri göster" ile geri gelir.
 */
const HIDDEN_KEY = "emlaksoft:cift-kayit:gizli-gruplar";

function tarih(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium" }).format(new Date(iso));
}

export function DuplicateGroupsClient({ groups }: { groups: DuplicateGroup[] }) {
  const { hidden, hide, unhide } = useHiddenGroups(HIDDEN_KEY);
  const [showHidden, setShowHidden] = useState(false);

  const sigOf = (g: DuplicateGroup) => `${g.signal}::${g.key}`;
  const hiddenSet = new Set(hidden);
  const gizliSayisi = groups.filter((g) => hiddenSet.has(sigOf(g))).length;
  const gosterilen = !showHidden ? groups.filter((g) => !hiddenSet.has(sigOf(g))) : groups;

  const hideGroup = (g: DuplicateGroup) => hide(sigOf(g));
  const unhideGroup = (g: DuplicateGroup) => unhide(sigOf(g));

  return (
    <div className="space-y-4">
      {gizliSayisi > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-2.5">
          <p className="text-xs text-text-muted">
            <span className="numeric font-semibold">{gizliSayisi}</span> grup &quot;mükerrer
            değil&quot; olarak işaretlendi (yalnızca bu cihazda gizli).
          </p>
          <Button variant="secondary" size="sm" icon={showHidden ? EyeOff : Eye} onClick={() => setShowHidden((v) => !v)} className="shrink-0">
            {showHidden ? "Gizlenenleri sakla" : "Gizlenenleri göster"}
          </Button>
        </div>
      ) : null}

      {gosterilen.length === 0 ? (
        <div className="grid place-items-center rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
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
              className={`surface-card rounded-[var(--radius-panel)] p-4 sm:p-5 ${gizli ? "opacity-60" : ""}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2">
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    <span className="numeric truncate text-sm font-semibold text-ink-950">
                      {g.signal === "phone" ? formatTurkishPhone(g.key) : g.key}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-text-faint">{meta.desc}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-canvas px-2.5 py-1 text-xs font-semibold text-text-muted">
                    {g.kayitlar.length} kayıt
                  </span>
                  {gizli ? (
                    <Button variant="secondary" size="sm" onClick={() => unhideGroup(g)}>
                      Tekrar göster
                    </Button>
                  ) : (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => hideGroup(g)} title="Grubu bu cihazda gizle; veri silinmez">
                        Bu grup mükerrer değil
                      </Button>
                      {g.kayitlar.length > 1 ? <MergeButton panelId={`merge-${g.kayitlar[0].customer_id}`} /> : null}
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
                        className={`lift-hover focus-ring group flex h-full items-start justify-between gap-3 rounded-[var(--radius-card)] border p-4 transition ${
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
                          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-faint">
                            <span>{tarih(k.created_at)} tarihinde eklendi</span>
                            <span className="numeric">{k.activity} kayıt hareketi</span>
                            {onerilen ? (
                              <span className="font-semibold text-mint-600">en dolu kayıt</span>
                            ) : null}
                          </p>
                        </div>
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-surface text-text-faint transition group-hover:bg-brand-600/10 group-hover:text-brand-600">
                          <ArrowUpRight className="h-4 w-4" />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {g.kayitlar.length > 1 ? (
                <MergePanel panelId={`merge-${g.kayitlar[0].customer_id}`} kayitlar={g.kayitlar} />
              ) : null}
            </section>
          );
        })
      )}
    </div>
  );
}
