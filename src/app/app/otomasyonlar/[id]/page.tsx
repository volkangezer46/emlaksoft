import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Play, Pause, Zap, Filter, Bolt, Activity } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";

const TRIGGER_LABELS: Record<string, string> = {
  authority_expiring: "Yetki belgesi bitiyor",
  portal_stale: "Portal teyidi gecikti",
  demand_created: "Yeni talep oluştu",
  property_created: "Yeni portföy eklendi",
  birthday: "Doğum günü / yıldönümü",
  no_activity: "Uzun süre etkileşim yok",
  deal_stage: "Anlaşma aşaması değişti",
};

const ACTION_LABELS: Record<string, string> = {
  send_sms: "SMS gönder",
  send_whatsapp: "WhatsApp gönder",
  send_email: "E-posta gönder",
  create_task: "Görev oluştur",
  notify_office: "Ofise bildirim",
  notify_advisor: "Danışmana bildirim",
};

const STATUS_LABELS: Record<string, string> = { active: "Aktif", draft: "Taslak", paused: "Pasif" };

function dateTime(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export default async function AutomationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { perms } = await requireModulePage("settings");
  const canEdit = (perms.settings ?? []).includes("edit");
  const { id } = await params;
  const supabase = await createClient();

  const { data: rule } = await supabase
    .from("automations")
    .select("id, name, description, trigger_type, trigger_config, conditions, actions, status, run_count, last_run_at, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (!rule) notFound();

  const actions = Array.isArray(rule.actions) ? rule.actions : [];
  const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
  const triggerConfig = (rule.trigger_config ?? {}) as Record<string, unknown>;
  const isActive = rule.status === "active";

  return (
    <div className="space-y-6">
      <Link href="/app/otomasyonlar" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Otomasyonlar
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-[14px] ${isActive ? "bg-mint-500/20 text-mint-300" : "bg-white/10 text-white/50"}`}>
              {isActive ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
            </span>
            <div>
              <span className="flex items-center gap-2 text-xs font-semibold text-cyan-400"><Zap className="h-4 w-4" /> Otomasyon kuralı</span>
              <h1 className="mt-1 font-display text-2xl font-extrabold md:text-3xl">{rule.name}</h1>
              {rule.description ? <p className="mt-1 max-w-xl text-sm text-white/60">{rule.description}</p> : null}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">{STATUS_LABELS[rule.status] ?? rule.status}</span>
            <p className="text-xs text-white/50">{rule.run_count} kez çalıştı</p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Tetikleyici */}
        <section className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-950"><Bolt className="h-4 w-4 text-amber-500" /> Tetikleyici</h2>
          <p className="rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm font-semibold text-ink-950">
            {TRIGGER_LABELS[rule.trigger_type] ?? rule.trigger_type}
          </p>
          {Object.keys(triggerConfig).length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs text-text-muted">
              {Object.entries(triggerConfig).map(([k, v]) => (
                <li key={k} className="flex justify-between rounded-[8px] bg-canvas px-2.5 py-1.5">
                  <span>{k}</span><span className="font-semibold text-ink-950">{String(v)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {/* Koşullar */}
        <section className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-950"><Filter className="h-4 w-4 text-brand-600" /> Koşullar</h2>
          {conditions.length === 0 ? (
            <p className="text-sm text-text-muted">Koşul yok — tetiklenince her zaman çalışır.</p>
          ) : (
            <ul className="space-y-1.5">
              {conditions.map((c: Record<string, unknown>, i: number) => (
                <li key={i} className="rounded-[8px] bg-canvas px-2.5 py-1.5 text-xs text-ink-950">
                  {String(c.field ?? "")} {String(c.op ?? "")} <span className="font-semibold">{String(c.value ?? "")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Aksiyonlar */}
        <section className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-950"><Zap className="h-4 w-4 text-mint-600" /> Aksiyonlar</h2>
          {actions.length === 0 ? (
            <p className="text-sm text-text-muted">Aksiyon tanımlanmamış.</p>
          ) : (
            <ul className="space-y-1.5">
              {actions.map((a: Record<string, unknown>, i: number) => (
                <li key={i} className="flex items-center gap-2 rounded-[8px] bg-mint-500/8 px-2.5 py-2 text-sm font-medium text-mint-700">
                  <Zap className="h-3.5 w-3.5" /> {ACTION_LABELS[String(a.type)] ?? String(a.type)}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="flex flex-wrap items-center gap-4 rounded-[16px] border border-line bg-surface p-4 text-sm text-text-muted shadow-[var(--shadow-xs)]">
        <span className="flex items-center gap-1.5"><Activity className="h-4 w-4 text-brand-600" /> Son çalışma: <strong className="text-ink-950">{dateTime(rule.last_run_at)}</strong></span>
        <span>Oluşturuldu: {dateTime(rule.created_at)}</span>
        {canEdit ? <Link href="/app/otomasyonlar" className="ml-auto text-xs font-semibold text-brand-600 hover:underline">Kuralları yönet →</Link> : null}
      </section>
    </div>
  );
}
