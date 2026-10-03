"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowLeftRight, CheckCircle2, ClipboardList, Loader2, Lock, ShieldAlert, TriangleAlert } from "lucide-react";
import { getHandoffCounts, handoffMemberWorkload, type HandoffResult } from "@/app/actions/team";
import { useToast } from "@/components/app/toast-provider";
import { MorphTabs, type MorphTabItem } from "@/components/ui/morph-tabs";
import {
  HANDOFF_REASON_MAX,
  HANDOFF_REASON_MIN,
  HANDOFF_SCOPES,
  HANDOFF_SCOPE_LABELS,
  type HandoffScope,
} from "@/lib/team/handoff";

type Advisor = { id: string; full_name: string };
type Counts = Record<HandoffScope, number>;
type Tab = "kapsam" | "onay" | "sonuc";

const SCOPE_TITLES: Record<HandoffScope, string> = {
  customers: "Müşteriler",
  properties: "Portföyler",
  deals: "Açık anlaşmalar",
  tasks: "Açık görevler",
  appointments: "Yaklaşan randevular",
};

const SCOPE_HINTS: Record<HandoffScope, string> = {
  customers: "Aktif müşteriler; açık talepler müşteriyle birlikte taşınır.",
  properties: "Aktif portföy kayıtları.",
  deals: "Kazanıldı/kaybedildi dışındaki anlaşmalar (komisyon eşlemesi yeni danışmana geçer).",
  tasks: "Durumu açık olan görevler.",
  appointments: "Bugünden sonraki bekleyen/onaylı randevular.",
};

/**
 * İş yükü devri paneli (sayfa içi, sekmeli — popup değil). Kapsam sekmesi gerçek sayımları gösterir;
 * onay sekmesi zorunlu gerekçeyi (5–300 karakter) alır; sonuç sekmesi devredilen/atlanan/hata özetini ve sunucunun
 * kısmi durum raporunu gösterir. İzni olmayan kapsam devre dışıdır (sunucu yine her kalem için `edit` izni doğrular).
 */
export function MemberHandoff({
  fromId,
  fromName,
  advisors,
  editableScopes,
}: {
  fromId: string;
  fromName: string;
  advisors: Advisor[];
  /** Devri yapanın düzenleme iznine sahip olduğu kapsamlar. */
  editableScopes: HandoffScope[];
}) {
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [tab, setTab] = useState<Tab>("kapsam");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [countsError, setCountsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<HandoffScope[]>([]);
  const [result, setResult] = useState<{ res: HandoffResult; scopes: HandoffScope[]; targetName: string } | null>(null);
  const [pending, start] = useTransition();
  const { push } = useToast();

  const loadCounts = (cancelled?: { v: boolean }) => {
    getHandoffCounts(fromId).then((r) => {
      if (cancelled?.v) return;
      if (r.counts) {
        const c = r.counts;
        setCounts(c);
        setCountsError(null);
        setSelected(HANDOFF_SCOPES.filter((s) => editableScopes.includes(s) && c[s] > 0));
      } else {
        setCountsError(r.error ?? "Sayımlar okunamadı.");
      }
    });
  };

  useEffect(() => {
    const cancelled = { v: false };
    loadCounts(cancelled);
    return () => {
      cancelled.v = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromId]);

  const targetName = advisors.find((a) => a.id === to)?.full_name ?? "";
  const reasonLen = reason.trim().length;
  const reasonOk = reasonLen >= HANDOFF_REASON_MIN && reasonLen <= HANDOFF_REASON_MAX;
  const canRun = Boolean(to) && selected.length > 0 && reasonOk && !pending;

  const toggle = (s: HandoffScope) =>
    setSelected((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const items: MorphTabItem[] = [
    { id: "kapsam", label: "Kapsam", icon: ClipboardList, count: selected.length },
    { id: "onay", label: "Gerekçe ve onay", icon: ShieldAlert },
    ...(result ? [{ id: "sonuc", label: "Sonuç", icon: CheckCircle2 } satisfies MorphTabItem] : []),
  ];

  const run = () => {
    if (!canRun) return;
    const scopes = [...selected];
    start(async () => {
      const fd = new FormData();
      fd.set("from", fromId);
      fd.set("to", to);
      fd.set("reason", reason.trim());
      for (const s of HANDOFF_SCOPES) fd.set(`scope_${s}`, scopes.includes(s) ? "1" : "0");
      const res = await handoffMemberWorkload(fd);
      setResult({ res, scopes, targetName });
      setTab("sonuc");
      if (res.ok) {
        push("Devir tamamlandı.", "ok");
        setReason("");
        loadCounts();
      } else {
        push(res.error ?? "Devir yapılamadı.", "err");
      }
    });
  };

  const shown = tab === "sonuc" && !result ? "kapsam" : tab;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={to}
          aria-label="Devralan danışman"
          onChange={(e) => setTo(e.target.value)}
          className="min-w-[200px] flex-1 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-400"
        >
          <option value="">Devralan danışmanı seçin…</option>
          {advisors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.full_name}
            </option>
          ))}
        </select>
      </div>

      <MorphTabs
        items={items}
        activeId={shown}
        onSelect={(id) => setTab(id as Tab)}
        orientation="horizontal"
        label="İş yükü devri bölümleri"
        idPrefix={`handoff-${fromId}`}
        inactive="label"
      />

      {shown === "kapsam" ? (
        <div role="tabpanel" id={`handoff-${fromId}-panel-kapsam`} aria-labelledby={`handoff-${fromId}-tab-kapsam`} className="space-y-3">
          {countsError ? (
            <p className="flex items-center gap-2 text-sm text-danger-600" role="alert">
              <TriangleAlert className="h-4 w-4" aria-hidden /> {countsError}
            </p>
          ) : null}
          <ul className="grid gap-2 sm:grid-cols-2">
            {HANDOFF_SCOPES.map((s) => {
              const n = counts?.[s];
              const allowed = editableScopes.includes(s);
              const empty = n === 0;
              const disabled = !allowed || empty || counts === null;
              return (
                <li key={s}>
                  <label
                    className={`flex items-start gap-3 rounded-[var(--radius-card)] border border-line p-3 ${disabled ? "opacity-60" : "cursor-pointer hover:bg-canvas"}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-brand-600"
                      checked={selected.includes(s)}
                      disabled={disabled}
                      onChange={() => toggle(s)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-ink-950">{SCOPE_TITLES[s]}</span>
                        <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-bold text-brand-700">
                          {n === undefined ? "…" : n}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-text-muted">{SCOPE_HINTS[s]}</span>
                      {!allowed ? (
                        <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-danger-600">
                          <Lock className="h-3 w-3" aria-hidden /> Bu kalemi devretme yetkiniz yok
                        </span>
                      ) : empty ? (
                        <span className="mt-1 block text-xs text-text-faint">Devredilecek kayıt yok</span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!to || selected.length === 0}
              onClick={() => setTab("onay")}
              className="focus-ring press inline-flex min-h-[42px] items-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 text-sm font-bold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeftRight className="h-4 w-4" /> Devam
            </button>
          </div>
          {!to ? <p className="text-right text-xs text-text-faint">Önce devralan danışmanı seçin.</p> : null}
        </div>
      ) : null}

      {shown === "onay" ? (
        <div role="tabpanel" id={`handoff-${fromId}-panel-onay`} aria-labelledby={`handoff-${fromId}-tab-onay`} className="space-y-3">
          <p className="text-sm text-text-muted">
            <span className="font-semibold text-ink-950">{fromName}</span> adlı danışmanın{" "}
            {selected.length ? selected.map((s) => `${counts?.[s] ?? 0} ${HANDOFF_SCOPE_LABELS[s]}`).join(", ") : "hiçbir kalemi"}{" "}
            {targetName ? (
              <>
                <span className="font-semibold text-ink-950">{targetName}</span> adlı danışmana devredilecek.
              </>
            ) : (
              "devredilecek (devralan danışman seçilmedi)."
            )}
          </p>
          <div>
            <label htmlFor={`handoff-${fromId}-reason`} className="mb-1 block text-xs font-semibold text-ink-950">
              Devir gerekçesi (zorunlu)
            </label>
            <textarea
              id={`handoff-${fromId}-reason`}
              value={reason}
              maxLength={HANDOFF_REASON_MAX}
              rows={3}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Örn. Danışman ekipten ayrıldı; iş yükü devralana aktarılıyor."
              className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-400"
            />
            <p className={`mt-1 text-xs ${reasonLen > 0 && !reasonOk ? "text-danger-600" : "text-text-faint"}`}>
              {reasonLen}/{HANDOFF_REASON_MAX} · en az {HANDOFF_REASON_MIN} karakter. Gerekçe denetim kaydına yazılır.
            </p>
          </div>
          <p className="text-xs text-danger-600">Bu işlem toplu ve hemen uygulanır; tek tek geri alınmaz.</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => setTab("kapsam")}
              className="focus-ring press inline-flex min-h-[42px] items-center rounded-[var(--radius-control)] border border-line px-3 text-sm font-semibold text-text-muted transition hover:bg-canvas"
            >
              Geri
            </button>
            <button
              type="button"
              disabled={!canRun}
              onClick={run}
              className="focus-ring press inline-flex min-h-[42px] items-center gap-2 rounded-[var(--radius-control)] bg-danger-500 px-4 text-sm font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
              Devri onayla{targetName ? ` — ${targetName}` : ""}
            </button>
          </div>
        </div>
      ) : null}

      {shown === "sonuc" && result ? <HandoffSummary id={fromId} data={result} /> : null}
    </div>
  );
}

function HandoffSummary({
  id,
  data,
}: {
  id: string;
  data: { res: HandoffResult; scopes: HandoffScope[]; targetName: string };
}) {
  const { res, scopes, targetName } = data;
  const counts = res.counts ?? {};
  const moved = scopes.filter((s) => (counts[s] ?? 0) > 0);
  const skipped = HANDOFF_SCOPES.filter((s) => !moved.includes(s));
  const partial = res.partial ?? [];
  return (
    <div role="tabpanel" id={`handoff-${id}-panel-sonuc`} aria-labelledby={`handoff-${id}-tab-sonuc`} className="space-y-3 text-sm">
      {res.error ? (
        <div className="flex items-start gap-2 rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/5 p-3 text-danger-600" role="alert">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Hata</p>
            <p>{res.error}</p>
            {partial.length ? (
              <p className="mt-1 font-semibold">
                Kısmi durum: {partial.map((s) => HANDOFF_SCOPE_LABELS[s]).join(", ")} geri çevrilemedi; elle kontrol edin.
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/5 p-3 text-ink-950">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mint-700" aria-hidden />
          <p>
            Devir tamamlandı{targetName ? <> — alan: <span className="font-semibold">{targetName}</span></> : null}.
          </p>
        </div>
      )}
      {!res.error ? (
        <dl className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-[var(--radius-card)] border border-line p-3">
            <dt className="text-xs font-semibold text-text-muted">Devredilen</dt>
            <dd className="mt-1 text-ink-950">
              {moved.length ? moved.map((s) => `${counts[s]} ${HANDOFF_SCOPE_LABELS[s]}`).join(" · ") : "Hiç kayıt devredilmedi"}
            </dd>
          </div>
          <div className="rounded-[var(--radius-card)] border border-line p-3">
            <dt className="text-xs font-semibold text-text-muted">Atlanan</dt>
            <dd className="mt-1 text-text-muted">
              {skipped.length
                ? skipped.map((s) => HANDOFF_SCOPE_LABELS[s] + (scopes.includes(s) ? " (kayıt yoktu)" : " (seçilmedi)")).join(" · ")
                : "Yok"}
            </dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
