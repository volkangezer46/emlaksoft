"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { AlarmClock, Check, CheckCircle2, ClipboardList, MessageCircle, Phone, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CALL_LIST_TIER_LABELS, splitCallQueue } from "@/lib/call-list";
import { completeTask, rescheduleTasks } from "@/app/actions/tasks";
import { useToast } from "@/components/app/toast-provider";
import { CONTACT_OUTCOME_LOGGED_EVENT, ContactOutcomePrompt } from "../musteriler/contact-outcome-prompt";
import type { CallListRowVM } from "./data";

const ACTION =
  "focus-ring press inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 text-sm font-semibold transition";

function ContactLinks({ row, primary }: { row: CallListRowVM; primary: boolean }) {
  if (!row.customerId) return null;
  return (
    // Temas sonrası sonuç kaydı: bu kapsayıcıdaki tel:/WhatsApp tıklaması ContactOutcomePrompt'a bildirilir.
    <span
      className="flex flex-wrap gap-2"
      data-contact-outcome=""
      data-customer-id={row.customerId}
      data-customer-name={row.name}
      data-phone={row.phone}
    >
      {row.telHref ? (
        <a
          href={row.telHref}
          aria-label={`${row.name} numarasını ara`}
          className={`${ACTION} ${primary ? "bg-ink-950 text-white hover:bg-ink-800" : "border border-line bg-surface text-ink-950 hover:bg-[var(--surface-hover)]"}`}
        >
          <Phone className="h-4 w-4" aria-hidden /> Ara
        </a>
      ) : null}
      {row.waHref ? (
        <a
          href={row.waHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${row.name} ile WhatsApp görüşmesi`}
          className={`${ACTION} border border-line bg-surface text-[var(--pm-success-text)] hover:bg-[var(--surface-hover)]`}
        >
          <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp
        </a>
      ) : null}
    </span>
  );
}

function lastContactLabel(days: number | null): string {
  if (days == null) return "Temas kaydı yok";
  if (days === 1) return "Son temas dün";
  return `Son temas ${days} gün önce`;
}

/**
 * Arama kuyruğu: en üstte sıradaki müşteri (büyük ara/WhatsApp düğmeleri), altında sıradakiler.
 * Görüşme sonucu kaydedilince (CONTACT_OUTCOME_LOGGED_EVENT) müşteri "Arandı"ya iner ve sayfa sessizce tazelenir;
 * "Atla" müşteriyi bu oturumda sona taşır (kayıt atmaz). Açık arama görevi olan satırda (GA-05) "Yarına at" görevin
 * vadesini yarın 10:00'a taşır; müşterisiz görev satırı "Görevi tamamla" ile kapanır. Sonuç kaydı müşterinin açık
 * arama görevlerini kapatır (ContactOutcomePrompt → settleCustomerCallTasks).
 */
export function CallQueue({ rows }: { rows: CallListRowVM[] }) {
  const router = useRouter();
  const toast = useToast();
  const [logged, setLogged] = useState<ReadonlySet<string>>(() => new Set());
  const [skipped, setSkipped] = useState<readonly string[]>([]);
  const [busy, startTask] = useTransition();

  const markDone = (key: string) => setLogged((prev) => new Set(prev).add(key));
  // GA-05: görev satırında "Yarına at" vadeyi yarın 10:00'a taşır (görevler sayfasıyla aynı eylem); "Tamamla" kapatır.
  const postpone = (row: CallListRowVM) => {
    const taskId = row.task?.id;
    if (!taskId) return;
    markDone(row.key);
    startTask(async () => {
      const res = await rescheduleTasks([taskId], "tomorrow10");
      if (res.error) {
        setLogged((prev) => {
          const next = new Set(prev);
          next.delete(row.key);
          return next;
        });
        toast.push(res.error, "err");
        return;
      }
      toast.push("Arama görevi yarın 10:00'a taşındı.", "ok");
      router.refresh();
    });
  };
  const finishTask = (row: CallListRowVM) => {
    const taskId = row.task?.id;
    if (!taskId) return;
    markDone(row.key);
    startTask(async () => {
      const fd = new FormData();
      fd.set("id", taskId);
      await completeTask(fd);
      toast.push("Arama görevi tamamlandı.", "ok");
      router.refresh();
    });
  };

  useEffect(() => {
    const onLogged = (e: Event) => {
      const id = (e as CustomEvent<{ customerId?: string }>).detail?.customerId;
      if (!id) return;
      setLogged((prev) => new Set(prev).add(id));
      router.refresh();
    };
    window.addEventListener(CONTACT_OUTCOME_LOGGED_EVENT, onLogged);
    return () => window.removeEventListener(CONTACT_OUTCOME_LOGGED_EVENT, onLogged);
  }, [router]);

  const { pending, done } = splitCallQueue(rows, logged);
  const skipRank = (key: string) => skipped.indexOf(key);
  const ordered = [...pending].sort((a, b) => skipRank(a.key) - skipRank(b.key));
  const [current, ...rest] = ordered;

  if (rows.length === 0 || !current) {
    return (
      <>
        <EmptyState
          illustration="arama"
          tone="mint"
          title={done.length > 0 ? "Liste tamamlandı" : "Bugün aranacak müşteri yok"}
          description={
            done.length > 0
              ? `Bu oturumda ${done.length} görüşme sonucu kaydettiniz. Yeni sinyaller geldikçe liste yeniden dolar.`
              : "Sıcak, riskli ya da takip zamanı gelen müşteriler burada öncelik sırasıyla listelenir."
          }
          action={{ href: "/app/musteriler", label: "Müşterilere git" }}
        />
        <ContactOutcomePrompt />
      </>
    );
  }

  return (
    <div className="space-y-4" data-call-queue>
      <section
        aria-labelledby="siradaki-baslik"
        className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5"
      >
        <p className="text-xs font-semibold text-brand-600">
          Sıradaki · {ordered.length} kişi bekliyor{done.length > 0 ? ` · ${done.length} kaydedildi` : ""}
        </p>
        <h2 id="siradaki-baslik" className="mt-1 font-display text-xl font-bold text-ink-950">
          <Link href={current.href} className="focus-ring rounded-sm hover:underline">
            {current.name}
          </Link>
        </h2>
        <p className="mt-0.5 text-sm text-text-muted">
          {current.customerId
            ? `${current.phoneLabel} · ${CALL_LIST_TIER_LABELS[current.tier]} · ${lastContactLabel(current.daysSinceContact)}`
            : CALL_LIST_TIER_LABELS.gorev}
        </p>
        <ul className="mt-3 flex flex-wrap gap-1">
          {current.reasons.map((r) => (
            <li key={r} className="rounded-full border border-line bg-[var(--surface-sunken)] px-2 py-0.5 text-xs text-text-muted">
              {r}
            </li>
          ))}
        </ul>
        {current.nextAction ? (
          <p className="mt-3 text-sm text-ink-950">
            <span className="font-semibold">Önerilen adım:</span>{" "}
            <Link href={current.nextAction.href} className="focus-ring rounded-sm text-[var(--accent-text)] hover:underline">
              {current.nextAction.text}
            </Link>
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <ContactLinks row={current} primary />
          {current.task ? (
            <>
              {!current.customerId ? (
                <Button type="button" variant="secondary" icon={CheckCircle2} disabled={busy} onClick={() => finishTask(current)}>
                  Görevi tamamla
                </Button>
              ) : null}
              <Button type="button" variant="ghost" icon={AlarmClock} disabled={busy} onClick={() => postpone(current)}>
                Yarına at
              </Button>
            </>
          ) : rest.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              icon={SkipForward}
              onClick={() => setSkipped((prev) => [...prev.filter((id) => id !== current.key), current.key])}
            >
              Atla
            </Button>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Görüşmeden döndüğünüzde sonuç penceresi açılır; kaydettiğinizde liste sıradaki müşteriye geçer.
        </p>
      </section>

      {rest.length > 0 ? (
        <section aria-labelledby="kuyruk-baslik" className="rounded-[var(--radius-panel)] border border-line bg-surface">
          <h2 id="kuyruk-baslik" className="px-5 pt-4 text-xs font-bold uppercase tracking-[0.08em] text-text-faint">
            Sıradakiler
          </h2>
          <ol className="divide-y divide-line">
            {rest.map((row, i) => (
              <li key={row.key} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="w-6 text-right text-xs font-semibold tabular-nums text-text-faint">{i + 2}</span>
                <div className="min-w-0 flex-1">
                  <Link href={row.href} className="focus-ring rounded-sm text-sm font-semibold text-ink-950 hover:underline">
                    {row.name}
                  </Link>
                  <p className="truncate text-xs text-text-muted">
                    {CALL_LIST_TIER_LABELS[row.tier]} · {row.reasons.join(" · ")}
                  </p>
                </div>
                {row.customerId ? (
                  <ContactLinks row={row} primary={false} />
                ) : (
                  <Link
                    href={row.href}
                    className={`${ACTION} border border-line bg-surface text-ink-950 hover:bg-[var(--surface-hover)]`}
                  >
                    <ClipboardList className="h-4 w-4" aria-hidden /> Görevi aç
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {done.length > 0 ? (
        <section aria-labelledby="arandi-baslik" className="rounded-[var(--radius-panel)] border border-line bg-canvas/60 px-5 py-4">
          <h2 id="arandi-baslik" className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-text-faint">
            <Check className="h-3.5 w-3.5" aria-hidden /> Arandı (bu oturum)
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {done.map((row) => (
              <li key={row.key}>
                <Link href={row.href} className="focus-ring rounded-sm text-sm text-text-muted hover:text-ink-950">
                  {row.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ContactOutcomePrompt />
    </div>
  );
}
