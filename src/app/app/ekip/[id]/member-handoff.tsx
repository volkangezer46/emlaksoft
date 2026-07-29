"use client";

import { useState, useTransition } from "react";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { handoffMemberWorkload } from "@/app/actions/team";
import { useToast } from "@/components/app/toast-provider";

type Advisor = { id: string; full_name: string };

/**
 * İş yükü devri paneli — ekipten ayrılan/pasife alınan danışmanın TÜM müşteri ve
 * portföylerini başka bir danışmana tek işlemde aktarır (C.5). Onay adımı var:
 * geri alınması zor, toplu sahiplik değişimi.
 */
export function MemberHandoff({
  fromId,
  fromName,
  advisors,
  customerCount,
  propertyCount,
}: {
  fromId: string;
  fromName: string;
  advisors: Advisor[];
  customerCount: number;
  propertyCount: number;
}) {
  const [to, setTo] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const { push } = useToast();

  const total = customerCount + propertyCount;
  const targetName = advisors.find((a) => a.id === to)?.full_name ?? "";

  if (total === 0) {
    return (
      <p className="text-sm text-text-muted">
        Bu danışmanda devredilecek aktif müşteri veya portföy yok.
      </p>
    );
  }

  const run = () => {
    if (!to) {
      push("Devralan danışman seçin.", "err");
      return;
    }
    start(async () => {
      const fd = new FormData();
      fd.set("from", fromId);
      fd.set("to", to);
      const res = await handoffMemberWorkload(fd);
      if (res?.error) {
        push(res.error, "err");
      } else {
        push(`Devir tamam: ${customerCount} müşteri · ${propertyCount} portföy → ${targetName}`, "ok");
        setConfirming(false);
        setTo("");
      }
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        <span className="font-semibold text-ink-950">{customerCount}</span> müşteri ve{" "}
        <span className="font-semibold text-ink-950">{propertyCount}</span> portföy başka bir danışmana devredilir.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setConfirming(false);
          }}
          className="min-w-[200px] flex-1 rounded-[11px] border border-line bg-canvas px-3 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-400"
        >
          <option value="">Devralan danışmanı seçin…</option>
          {advisors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.full_name}
            </option>
          ))}
        </select>

        {!confirming ? (
          <button
            type="button"
            disabled={!to}
            onClick={() => setConfirming(true)}
            className="focus-ring press inline-flex min-h-[42px] items-center gap-2 rounded-[11px] bg-brand-600 px-4 text-sm font-bold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowLeftRight className="h-4 w-4" /> Devret
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={run}
              className="focus-ring press inline-flex min-h-[42px] items-center gap-2 rounded-[11px] bg-danger-500 px-4 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Onayla — {targetName}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(false)}
              className="focus-ring press inline-flex min-h-[42px] items-center rounded-[11px] border border-line px-3 text-sm font-semibold text-text-muted transition hover:bg-canvas"
            >
              Vazgeç
            </button>
          </div>
        )}
      </div>

      {confirming ? (
        <p className="text-xs text-danger-600">
          {fromName} adlı danışmanın tüm müşteri ve portföyleri {targetName}’e aktarılacak. Bu işlem toplu ve
          hemen uygulanır.
        </p>
      ) : null}
    </div>
  );
}
