"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarPlus,
  Check,
  Flame,
  Loader2,
  MessageSquare,
  User,
} from "lucide-react";
import {
  confirmSuggestedTask,
  resolveSmsCustomer,
  type AdvisorAction,
} from "@/app/actions/ai-tenant-advisor";
import { SmsDialog } from "@/app/app/gelen-kutusu/sms-dialog";

// ---------------------------------------------------------------------------
// AI asistan eylem kartları — AI yalnızca ÖNERİR, yazma kullanıcı bu
// kartlardaki butonları onaylayınca mevcut kapılı action'larla olur:
//   suggest_task       → confirmSuggestedTask (createTask'a delege)
//   draft_sms          → resolveSmsCustomer + SmsDialog (İYS kapısı dialogda)
//   list_hot_customers → yalnız tıklanabilir liste (eylem butonu yok)
// ---------------------------------------------------------------------------

/** Kart iskeleti — asistan balonuyla uyumlu, hafif vurgulu çerçeve. */
function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-brand-300/40 bg-surface px-3.5 py-3 text-sm shadow-sm">
      {children}
    </div>
  );
}

function TaskSuggestionCard({
  params,
  historical,
}: {
  params: { title: string; due_in_days: number; customer_name?: string };
  /** Geçmiş oturumdan yeniden render — onay durumu izlenmediği için not gösterilir. */
  historical?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<{ customerMatched: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const confirm = () => {
    if (pending || done) return;
    startTransition(async () => {
      const res = await confirmSuggestedTask({
        title: params.title,
        dueInDays: params.due_in_days,
        customerName: params.customer_name,
      });
      if (res.ok) {
        setError(null);
        setDone({ customerMatched: res.customerMatched });
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <CardShell>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-brand-600/10 text-brand-600">
          <CalendarPlus className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink-950">{params.title}</p>
          <p className="mt-0.5 text-xs text-text-muted">
            Termin: {params.due_in_days === 1 ? "yarın" : `${params.due_in_days} gün içinde`}
            {params.customer_name ? (
              <span className="ml-2 inline-flex items-center gap-1">
                <User className="h-3 w-3" /> {params.customer_name}
              </span>
            ) : null}
          </p>

          {done ? (
            <div className="mt-2">
              <p className="inline-flex items-center gap-1.5 rounded-full bg-mint-500/12 px-2.5 py-1 text-xs font-bold text-mint-600">
                <Check className="h-3.5 w-3.5" /> Görev oluşturuldu
                <Link
                  href="/app/gorevler"
                  className="font-semibold text-brand-600 hover:underline"
                >
                  Görevlere git
                </Link>
              </p>
              {params.customer_name && !done.customerMatched ? (
                <p className="mt-1 text-[11px] text-amber-600">
                  Müşteri adı eşleşmedi — görev müşterisiz oluşturuldu.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-2">
              <button
                type="button"
                onClick={confirm}
                disabled={pending}
                className="focus-ring press inline-flex items-center gap-1.5 rounded-[9px] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5" />}
                {pending ? "Oluşturuluyor…" : "Görevi oluştur"}
              </button>
              {historical ? (
                <p className="mt-1.5 text-[11px] text-text-faint">
                  Geçmiş sohbetten öneri — bu görev daha önce oluşturulmuş olabilir.
                </p>
              ) : null}
              {error ? <p className="mt-1.5 text-xs font-medium text-danger-500">{error}</p> : null}
            </div>
          )}
        </div>
      </div>
    </CardShell>
  );
}

function SmsDraftCard({ params }: { params: { customer_name: string; message: string } }) {
  const [pending, startTransition] = useTransition();
  const [resolved, setResolved] = useState<{
    customerId: string;
    customerName: string;
    consentGranted: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Müşteri adı → id + İYS onayı çözümü SUNUCUDA (tenant-scoped) yapılır;
  // ardından ortak SmsDialog taslak metinle açılır (İYS kapısı dialogda).
  const openDraft = () => {
    if (pending || resolved) return;
    startTransition(async () => {
      const res = await resolveSmsCustomer(params.customer_name);
      if (res.ok) {
        setError(null);
        setResolved({
          customerId: res.customerId,
          customerName: res.customerName,
          consentGranted: res.consentGranted,
        });
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <CardShell>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-cyan-500/10 text-cyan-600">
          <MessageSquare className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink-950">SMS taslağı — {params.customer_name}</p>
          <p className="mt-1 rounded-[9px] bg-canvas px-2.5 py-2 text-xs leading-relaxed text-text-muted">
            {params.message}
          </p>
          <div className="mt-2">
            {resolved ? (
              <SmsDialog
                customerId={resolved.customerId}
                customerName={resolved.customerName}
                consentGranted={resolved.consentGranted}
                initialMessage={params.message}
                defaultOpen
                trigger={
                  <button
                    type="button"
                    className="focus-ring press inline-flex items-center gap-1.5 rounded-[9px] border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300 hover:text-brand-600"
                  >
                    <MessageSquare className="h-3.5 w-3.5" /> Taslağı tekrar aç
                  </button>
                }
              />
            ) : (
              <button
                type="button"
                onClick={openDraft}
                disabled={pending}
                className="focus-ring press inline-flex items-center gap-1.5 rounded-[9px] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />}
                {pending ? "Hazırlanıyor…" : "SMS taslağını aç"}
              </button>
            )}
            {error ? <p className="mt-1.5 text-xs font-medium text-danger-500">{error}</p> : null}
          </div>
        </div>
      </div>
    </CardShell>
  );
}

function HotCustomersCard({
  params,
}: {
  params: { customers: { id: string; name: string; score: number }[] };
}) {
  return (
    <CardShell>
      <p className="flex items-center gap-1.5 font-semibold text-ink-950">
        <Flame className="h-4 w-4 text-amber-500" /> Sıcak müşteriler
      </p>
      {params.customers.length === 0 ? (
        <p className="mt-1.5 text-xs text-text-muted">
          Şu an sıcak müşteri görünmüyor.{" "}
          <Link href="/app/musteriler" className="font-semibold text-brand-600 hover:underline">
            Müşteriler
          </Link>
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {params.customers.map((c) => (
            <li key={c.id}>
              <Link
                href={`/app/musteriler/${c.id}`}
                className="focus-ring group flex items-center justify-between gap-2 rounded-[9px] px-2 py-1.5 transition hover:bg-brand-600/8"
              >
                <span className="truncate text-xs font-semibold text-ink-950 group-hover:text-brand-600">
                  {c.name}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-amber-600">
                  skor {c.score}
                  <ArrowUpRight className="h-3 w-3 text-text-faint" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link
        href="/app/musteriler?sort=hot"
        className="mt-1.5 inline-block text-[11px] font-semibold text-brand-600 hover:underline"
      >
        Tam listeyi gör
      </Link>
    </CardShell>
  );
}

/** Bir asistan mesajının altındaki eylem kartları listesi. */
export function AdvisorActionCards({
  actions,
  historical,
}: {
  actions: AdvisorAction[];
  /** Geçmiş oturumdan yüklendi — suggest_task kartında bilgilendirme notu gösterilir. */
  historical?: boolean;
}) {
  if (actions.length === 0) return null;
  return (
    <div className="mt-2.5 space-y-2">
      {actions.map((a, i) =>
        a.type === "suggest_task" ? (
          <TaskSuggestionCard key={i} params={a.params} historical={historical} />
        ) : a.type === "draft_sms" ? (
          <SmsDraftCard key={i} params={a.params} />
        ) : (
          <HotCustomersCard key={i} params={a.params} />
        ),
      )}
    </div>
  );
}
