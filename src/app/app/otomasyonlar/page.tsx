import Link from "next/link";
import {
  Zap,
  Play,
  Pause,
  BarChart3,
  ArrowUpRight,
  Bolt,
  ChevronDown,
  Filter,
  History,
  Plus,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { daysAgoIso, msSince } from "@/lib/clock";
import { ApplyTemplateButton, AutomationRowActions } from "./automation-actions";
import { AutomationWizard } from "./automation-wizard";
import { TRIGGER_LABELS, ACTION_LABELS } from "./labels";

type AutomationRow = {
  id:           string;
  name:         string;
  description:  string | null;
  trigger_type: string;
  conditions:   unknown[] | null;
  actions:      { type: string }[];
  status:       string;
  run_count:    number;
  last_run_at:  string | null;
  updated_at:   string;
};

type RecentLog = {
  id:            string;
  automation_id: string;
  result:        string;
  error_msg:     string | null;
  created_at:    string;
};

const LOG_RESULT_BADGES: Record<string, { label: string; className: string }> = {
  ok:    { label: "Çalıştı", className: "bg-mint-50 text-mint-700" },
  skip:  { label: "Atlandı", className: "bg-zinc-100 text-zinc-500" },
  error: { label: "Hata",    className: "bg-danger-500/10 text-danger-500" },
};

/** Bağıl zaman — clock.msSince üzerinden (render'da Date.now yok). */
function relativeTime(iso: string): string {
  const mins = Math.floor(msSince(iso) / 60_000);
  if (mins < 1) return "az önce";
  if (mins < 60) return `${mins} dk önce`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} sa önce`;
  return `${Math.floor(hrs / 24)} gün önce`;
}

// ?durum= kontratı: aktif | pasif. "pasif" active olmayan her durumu kapsar
// (inactive/paused/draft) — KPI sayısı ile tıklama sonucu aynı kümeyi görsün.
const DURUM_FILTERS = [
  { label: "Tümü",  value: "" },
  { label: "Aktif", value: "aktif" },
  { label: "Pasif", value: "pasif" },
] as const;

function matchesDurum(status: string, durum: string) {
  if (durum === "aktif") return status === "active";
  if (durum === "pasif") return status !== "active";
  return true;
}

export default async function OtomasyonlarPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string }>;
}) {
  const { perms } = await requireModulePage("settings");
  const canEdit = (perms.settings ?? []).includes("edit");
  const params = (await searchParams) ?? {};
  const durum = params.durum ?? "";
  const supabase = await createClient();

  const [{ data }, { data: staffData }, { data: logData }] = await Promise.all([
    supabase
      .from("automations")
      .select("id, name, description, trigger_type, conditions, actions, status, run_count, last_run_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50),
    // Sihirbazdaki "Danışmana ata" aksiyonu için aktif ekip listesi
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    // Son 7 günün çalışma geçmişi — KPI + "Son çalışmalar" özeti
    supabase
      .from("automation_logs")
      .select("id, automation_id, result, error_msg, created_at")
      .gte("created_at", daysAgoIso(7))
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  const staff = (staffData ?? []) as { id: string; full_name: string }[];

  const rows = (data ?? []) as AutomationRow[];
  const active   = rows.filter((r) => r.status === "active").length;
  const inactive = rows.length - active;
  const visible  = durum ? rows.filter((r) => matchesDurum(r.status, durum)) : rows;

  const logs = (logData ?? []) as RecentLog[];
  const runs7  = logs.length;
  const err7   = logs.filter((l) => l.result === "error").length;
  const nameById = new Map(rows.map((r) => [r.id, r.name]));
  const recentLogs = logs.slice(0, 6);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
              <Zap className="h-4 w-4" /> Otomasyon motoru
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Otomasyonlar</h1>
            <p className="mt-1 text-sm text-white/75">
              Tetikleyici → koşul → aksiyon zinciriyle tekrar eden işleri otomatikleştirin.
            </p>
            {canEdit && (
              <div className="mt-3">
                <AutomationWizard
                  staff={staff}
                  trigger={
                    <button
                      type="button"
                      className="btn-shine focus-ring press inline-flex items-center gap-1.5 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white"
                    >
                      <Plus className="h-4 w-4" /> Yeni otomasyon
                    </button>
                  }
                />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:flex">
            {([
              { label: "Aktif", value: active, href: "/app/otomasyonlar?durum=aktif" },
              { label: "Pasif", value: inactive, href: "/app/otomasyonlar?durum=pasif" },
              { label: "Toplam çalışma", value: rows.reduce((s, r) => s + r.run_count, 0), href: "/app/otomasyonlar" },
              { label: "Çalışma (7g)", value: runs7, href: "#son-calismalar" },
              { label: "Hata (7g)", value: err7, href: "#son-calismalar", danger: err7 > 0 },
            ] as { label: string; value: number; href: string; danger?: boolean }[]).map((k) => (
              <Link
                key={k.label}
                href={k.href}
                className={`focus-ring press group relative block min-w-[92px] rounded-[14px] border p-3 text-center transition hover:border-white/30 ${
                  k.danger ? "border-danger-500/40 bg-danger-500/15" : "border-white/12 bg-white/8"
                }`}
              >
                <ArrowUpRight className="hover-action absolute right-2 top-2 h-3.5 w-3.5 text-white/50 opacity-0 transition group-hover:opacity-100" />
                <p className="numeric font-display text-2xl font-extrabold text-white">{k.value}</p>
                <p className="text-[11px] text-white/70">{k.label}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Hazır şablonlar */}
      <section className="rounded-[20px] border border-dashed border-brand-300/40 bg-brand-600/[0.02] p-5">
        <h2 className="mb-3 flex flex-wrap items-center gap-2 font-display font-bold text-ink-950">
          <Zap className="h-4 w-4 text-brand-600" /> Hızlı başlangıç şablonları
          <Link href="/app/ayarlar/is-akislari" className="focus-ring ml-auto rounded-[8px] text-xs font-semibold text-brand-600 hover:underline">
            Çok adımlı görev paketi mi lazım? İş akışları →
          </Link>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { key: "no_contact_days",  name: "14 gün dokunulmamış müşteri uyarısı", trigger: "no_contact_days",  action: "notify_manager", description: "14 gün iletişim kurulmayan müşteriler için müdüre bildirim gönderir." },
            { key: "auth_expiring",    name: "Yetki belgesi bitişi — görev oluştur",  trigger: "auth_expiring",    action: "create_task",    description: "Yetki belgesi 15 gün içinde dolacak portföyler için otomatik görev açar." },
            { key: "new_customer",     name: "Yeni müşteriyle 5 dk içinde iletişim",  trigger: "new_customer",     action: "create_task",    description: "Yeni müşteri eklendiğinde sorumlu danışmana görev oluşturur." },
            { key: "deal_won",         name: "Satış sonrası teşekkür WhatsApp'ı",     trigger: "deal_won",         action: "send_whatsapp",  description: "Satış kapandığında müşteriye otomatik teşekkür mesajı gönderir." },
            { key: "property_matched", name: "Eşleşen portföyü müşteriye gönder",     trigger: "property_matched", action: "send_sms",       description: "Müşteri talebine portföy eşleşince SMS ile bildirir." },
            { key: "demand_stale",     name: "30 gün hareketsiz talep uyarısı",       trigger: "demand_stale",     action: "notify_manager", description: "30 gün güncelleme olmayan talepler için müdüre bildirim gönderir." },
            { key: "offer_received",   name: "Teklif girildiğinde yöneticiye bildirim", trigger: "offer_received",  action: "notify_manager", description: "Yeni bir teklif alındığında değerlendirme için yöneticiye anında bildirim gönderir." },
            { key: "new_demand",       name: "Yeni talep için eşleştirme görevi",     trigger: "new_demand",       action: "create_task",    description: "Yeni talep kaydedildiğinde uygun portföyleri tarayıp önermek için görev açar." },
            { key: "new_property",     name: "Yeni portföyü ekibe duyur",             trigger: "new_property",     action: "send_notification", description: "Yeni portföy eklendiğinde ekibe uygulama içi bildirim gönderir." },
            { key: "appointment_missed", name: "Kaçırılan randevu telafi görevi",     trigger: "appointment_missed", action: "create_task",  description: "Randevu kaçırıldığında müşteriyi yeniden aramak için sorumlu danışmana görev açar." },
            { key: "deal_lost",        name: "Kaybedilen satış geri kazanım görevi",  trigger: "deal_lost",        action: "create_task",    description: "Satış kaybedildiğinde kayıp nedenini analiz edip müşteriyi geri kazanmak için görev açar." },
          ].map((t) => (
            /* Kartın tamamı klavyeyle de açılabilir bir önizleme tetikleyicisi:
               summary etiketli buton gibi davranır, açılınca şablon açıklaması
               görünür. Uygula butonu preventDefault ile toggle'ı bastırır. */
            <details key={t.key} className="group/tpl rounded-[12px] border border-line bg-surface">
              <summary
                aria-label={`${t.name} şablon önizlemesi`}
                className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-brand-600/10 text-brand-600">
                  <Zap className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-ink-950">{t.name}</p>
                  <p className="text-[11px] text-text-faint">
                    {TRIGGER_LABELS[t.trigger]} → {ACTION_LABELS[t.action]}
                  </p>
                </div>
                <ApplyTemplateButton templateKey={t.key} />
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-faint transition group-open/tpl:rotate-180" />
              </summary>
              <p className="border-t border-line px-3 py-2.5 text-[11px] leading-relaxed text-text-muted">
                {t.description}
              </p>
            </details>
          ))}
        </div>
      </section>

      {/* Mevcut otomasyonlar */}
      <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-950">
            <BarChart3 className="h-4 w-4 text-brand-600" /> Kayıtlı otomasyonlar
          </p>
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              {DURUM_FILTERS.map((f) => (
                <Link
                  key={f.value}
                  href={f.value ? `/app/otomasyonlar?durum=${f.value}` : "/app/otomasyonlar"}
                  className={`focus-ring rounded-[8px] px-2.5 py-1 text-[11px] font-semibold transition ${
                    durum === f.value
                      ? "bg-ink-950 text-white"
                      : "border border-line text-text-muted hover:text-ink-950"
                  }`}
                >
                  {f.label}
                </Link>
              ))}
            </div>
            <span className="text-xs text-text-faint">
              {visible.length} kural{visible.length !== rows.length ? ` · ${rows.length} içinden` : ""}
            </span>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Zap className="h-10 w-10 text-text-faint" />
            {rows.length === 0 ? (
              <>
                <p className="mt-3 font-semibold text-ink-950">Henüz otomasyon yok</p>
                <p className="mt-1 text-sm text-text-muted">Yukarıdaki şablonlardan birini uygulayarak başlayın.</p>
              </>
            ) : (
              <>
                <p className="mt-3 font-semibold text-ink-950">Bu filtreyle eşleşen otomasyon yok</p>
                <Link href="/app/otomasyonlar" className="mt-1 text-sm font-semibold text-brand-600 hover:underline">
                  Filtreyi temizle
                </Link>
              </>
            )}
          </div>
        ) : (
          <div className="divide-y divide-line">
            {visible.map((r) => {
              const acts = Array.isArray(r.actions) ? r.actions : [];
              const condCount = Array.isArray(r.conditions) ? r.conditions.length : 0;
              return (
                <div key={r.id} className="group relative flex items-center gap-3 px-5 py-3.5 transition hover:bg-brand-600/[0.03]">
                  <Link href={`/app/otomasyonlar/${r.id}`} className="absolute inset-0" aria-label={`${r.name} otomasyon detayı`} />
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[9px] ${
                    r.status === "active" ? "bg-mint-500/12 text-mint-600" : "bg-zinc-100 text-zinc-400"
                  }`}>
                    {r.status === "active" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink-950 group-hover:text-brand-600">{r.name}</p>
                    {/* Tetikleyici → koşul → aksiyon zinciri görselleştirmesi */}
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 font-semibold text-amber-700">
                        <Bolt className="h-3 w-3" /> {TRIGGER_LABELS[r.trigger_type] ?? r.trigger_type}
                      </span>
                      <span aria-hidden className="text-text-faint">→</span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                        condCount > 0 ? "bg-brand-600/10 text-brand-700" : "bg-ink-950/5 text-text-faint"
                      }`}>
                        <Filter className="h-3 w-3" /> {condCount > 0 ? `${condCount} koşul` : "Koşulsuz"}
                      </span>
                      {acts.map((a, i) => (
                        <span key={i} className="inline-flex items-center gap-1">
                          <span aria-hidden className="text-text-faint">→</span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-mint-500/12 px-2 py-0.5 font-semibold text-mint-700">
                            <Zap className="h-3 w-3" /> {ACTION_LABELS[a.type] ?? a.type}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="relative z-10 shrink-0 text-right">
                    <Link
                      href={`/app/otomasyonlar/${r.id}#calisma-gecmisi`}
                      className="focus-ring rounded-[6px] text-xs font-semibold text-ink-950 underline-offset-2 hover:text-brand-600 hover:underline"
                    >
                      {r.run_count} çalışma
                    </Link>
                    {r.last_run_at && (
                      <p className="text-[11px] text-text-faint">
                        Son: {new Date(r.last_run_at).toLocaleDateString("tr-TR")}
                      </p>
                    )}
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                    r.status === "active" ? "bg-mint-50 text-mint-700" :
                    r.status === "draft"  ? "bg-zinc-100 text-zinc-500" :
                    "bg-zinc-50 text-zinc-400"
                  }`}>
                    {r.status === "active" ? "Aktif" : r.status === "draft" ? "Taslak" : "Pasif"}
                  </span>
                  <div className="relative z-10">
                    <AutomationRowActions row={r} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Son çalışmalar — automation_logs son 7 gün özeti */}
      <section id="son-calismalar" className="scroll-mt-6 overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-ink-950">
            <History className="h-4 w-4 text-brand-600" /> Son çalışmalar
          </h2>
          <span className="text-xs text-text-faint">
            Son 7 gün · {runs7.toLocaleString("tr-TR")} çalışma
            {err7 > 0 ? ` · ${err7} hata` : ""}
          </span>
        </div>
        {recentLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <History className="h-9 w-9 text-text-faint" />
            <p className="mt-3 font-semibold text-ink-950">Son 7 günde çalışma kaydı yok</p>
            <p className="mt-1 max-w-sm text-sm text-text-muted">
              Aktif bir kural tetiklendiğinde her çalışma burada sonuç rozetiyle listelenir.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {recentLogs.map((log) => {
              const badge = LOG_RESULT_BADGES[log.result] ?? LOG_RESULT_BADGES.skip;
              return (
                <div key={log.id} className="group relative flex items-center gap-3 px-5 py-3 transition hover:bg-brand-600/[0.03]">
                  <Link
                    href={`/app/otomasyonlar/${log.automation_id}#calisma-gecmisi`}
                    className="absolute inset-0"
                    aria-label={`${nameById.get(log.automation_id) ?? "Otomasyon"} çalışma geçmişi`}
                  />
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${badge.className}`}>
                    {badge.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink-950 group-hover:text-brand-600">
                      {nameById.get(log.automation_id) ?? "Otomasyon kuralı"}
                    </p>
                    {log.result === "error" && log.error_msg ? (
                      <p className="truncate text-[11px] text-danger-500">{log.error_msg}</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs text-text-faint">{relativeTime(log.created_at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
