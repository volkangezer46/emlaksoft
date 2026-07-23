"use client";

import { useState, useTransition } from "react";
import {
  Building2,
  Headphones,
  Loader2,
  Shield,
  Sparkles,
  UserRound,
  Wallet,
} from "lucide-react";
import { quickDemoLogin } from "@/app/actions/demo-login";
import { DEMO_PERSONAS, type DemoPersona } from "@/lib/demo-personas";

const ICONS: Record<string, typeof Shield> = {
  super_admin: Shield,
  ops: Sparkles,
  support: Headphones,
  billing: Wallet,
  owner: Building2,
  gm: Building2,
  branch_manager: Building2,
  team_lead: UserRound,
  advisor: UserRound,
  call_center: Headphones,
  accounting: Wallet,
  readonly: UserRound,
};

function PersonaButton({
  persona,
  active,
  pending,
  onPick,
}: {
  persona: DemoPersona;
  active: boolean;
  pending: boolean;
  onPick: (id: string) => void;
}) {
  const Icon = ICONS[persona.id] ?? UserRound;
  const busy = pending && active;

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => onPick(persona.id)}
      className={`group flex items-start gap-3 rounded-[12px] border px-3 py-2.5 text-left transition ${
        busy
          ? "border-brand-400 bg-brand-600/8"
          : "border-line bg-canvas/60 hover:border-brand-300 hover:bg-canvas"
      } disabled:opacity-60`}
    >
      <span
        className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[9px] ${
          persona.kind === "platform"
            ? "bg-amber-400/15 text-amber-600"
            : "bg-brand-600/10 text-brand-600"
        }`}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink-950">{persona.label}</span>
        <span className="block text-[11px] text-text-faint">{persona.hint}</span>
      </span>
    </button>
  );
}

export function DemoQuickLogin() {
  const [pending, startTransition] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const platform = DEMO_PERSONAS.filter((p) => p.kind === "platform");
  const office = DEMO_PERSONAS.filter((p) => p.kind === "office");

  const pick = (id: string) => {
    setError(null);
    setActiveId(id);
    startTransition(async () => {
      const res = await quickDemoLogin(id);
      if (res?.error) {
        setError(res.error);
        setActiveId(null);
      }
    });
  };

  return (
    <div className="mt-8 border-t border-line pt-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-amber-600">Hızlı test girişi</p>
          <p className="mt-0.5 text-[11px] text-text-muted">
            Tek tıkla rol bazlı oturum — hesaplar otomatik hazırlanır.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-amber-400/15 px-2.5 py-1 text-[10px] font-bold text-amber-700">
          Geliştirme
        </span>
      </div>

      {error ? (
        <p className="mt-3 rounded-[10px] border border-danger-500/30 bg-danger-500/8 px-3 py-2 text-xs font-medium text-danger-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-4 space-y-4">
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-text-faint">
            <Shield className="h-3.5 w-3.5 text-amber-600" /> EmlakSoft personeli
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {platform.map((p) => (
              <PersonaButton key={p.id} persona={p} active={activeId === p.id} pending={pending} onPick={pick} />
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-text-faint">
            <Building2 className="h-3.5 w-3.5 text-brand-600" /> Ofis kullanıcıları
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {office.map((p) => (
              <PersonaButton key={p.id} persona={p} active={activeId === p.id} pending={pending} onPick={pick} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
