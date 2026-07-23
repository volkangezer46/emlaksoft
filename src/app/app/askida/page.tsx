import { Lock, Mail, ShieldAlert } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/server";
import { getPlatformStaff } from "@/lib/platform";
import Link from "next/link";
import type { CSSProperties } from "react";

const RING_C = 2 * Math.PI * 42;

export default async function SuspendedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("full_name, tenants(name, status, plan)")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };

  const tenant = profile?.tenants as
    | { name?: string; status?: string; plan?: string }
    | { name?: string; status?: string; plan?: string }[]
    | null
    | undefined;
  const office = (Array.isArray(tenant) ? tenant[0] : tenant) ?? undefined;
  const staff = await getPlatformStaff();
  const isCancelled = office?.status === "cancelled";

  return (
    <div className="relative grid min-h-[78vh] place-items-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(239,68,68,0.08),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(20,99,255,0.06),transparent_50%)]" />
      <div className="pointer-events-none absolute left-1/2 top-16 h-40 w-40 -translate-x-1/2 rounded-full bg-danger-500/15 blur-[70px]" />

      <div className="relative w-full max-w-lg overflow-hidden rounded-[24px] border border-line bg-surface p-8 text-center shadow-[var(--shadow-card)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-danger-500 via-amber-400 to-danger-500" />

        <div className="relative mx-auto grid h-24 w-24 place-items-center">
          <div
            className="conic-spin pointer-events-none absolute inset-0 rounded-full opacity-30 blur-md"
            style={{ background: "conic-gradient(from 0deg, var(--danger-500), var(--amber-400), var(--danger-500))" }}
          />
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" stroke="var(--line)" strokeWidth="6" />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="var(--danger-500)"
              strokeWidth="6"
              strokeLinecap="round"
              className="ring-sweep"
              style={{ "--circ": RING_C, "--dash": RING_C * 0.35 } as CSSProperties}
            />
          </svg>
          <span className="relative grid h-14 w-14 place-items-center rounded-[16px] bg-danger-500/10 text-danger-500">
            <ShieldAlert className="h-7 w-7" />
          </span>
        </div>

        <p className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-danger-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[.14em] text-danger-500">
          <Lock className="h-3 w-3" /> Erişim kilitli
        </p>
        <h1 className="mt-3 font-display text-2xl font-extrabold text-ink-950">Hesap erişimi kısıtlandı</h1>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">
          <span className="font-semibold text-ink-950">{office?.name ?? "Ofisiniz"}</span> aboneliği şu an{" "}
          <span className="font-semibold text-danger-500">{isCancelled ? "iptal" : "askıda"}</span>. Ofis
          paneline erişim kapalı. Destek veya faturalama için EmlakSoft ile iletişime geçin.
        </p>

        <div className="mt-6 grid gap-2 rounded-[14px] border border-line bg-canvas/70 p-3 text-left text-xs text-text-muted">
          <div className="flex items-center justify-between">
            <span>Ofis</span>
            <span className="font-semibold text-ink-950">{office?.name ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Durum</span>
            <span className="font-semibold text-danger-500">{isCancelled ? "İptal" : "Askıda"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Paket</span>
            <span className="font-semibold text-ink-950">{office?.plan ?? "—"}</span>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <a
            href="mailto:destek@emlaksoft.com.tr"
            className="inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            <Mail className="h-4 w-4" /> Destek yaz
          </a>
          {staff ? (
            <Link
              href="/admin"
              className="rounded-[10px] border border-amber-400/40 px-4 py-2.5 text-sm font-semibold text-amber-700"
            >
              Ops paneline git
            </Link>
          ) : null}
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-[10px] border border-line px-4 py-2.5 text-sm font-semibold text-text-muted"
            >
              Çıkış yap
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
