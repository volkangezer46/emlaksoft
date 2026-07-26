import Link from "next/link";
import { Zap, Play, Pause, BarChart3, ArrowUpRight, ChevronDown, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { ApplyTemplateButton, AutomationRowActions } from "./automation-actions";
import { AutomationWizard } from "./automation-wizard";
import { TRIGGER_LABELS, ACTION_LABELS } from "./labels";

type AutomationRow = {
  id:           string;
  name:         string;
  description:  string | null;
  trigger_type: string;
  actions:      { type: string }[];
  status:       string;
  run_count:    number;
  last_run_at:  string | null;
  updated_at:   string;
};

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

  const [{ data }, { data: staffData }] = await Promise.all([
    supabase
      .from("automations")
      .select("id, name, description, trigger_type, actions, status, run_count, last_run_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50),
    // Sihirbazdaki "Danışmana ata" aksiyonu için aktif ekip listesi
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);
  const staff = (staffData ?? []) as { id: string; full_name: string }[];

  const rows = (data ?? []) as AutomationRow[];
  const active   = rows.filter((r) => r.status === "active").length;
  const inactive = rows.length - active;
  const visible  = durum ? rows.filter((r) => matchesDurum(r.status, durum)) : rows;

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
          <div className="flex gap-3">
            {[
              { label: "Aktif", value: active, href: "/app/otomasyonlar?durum=aktif" },
              { label: "Pasif", value: inactive, href: "/app/otomasyonlar?durum=pasif" },
              { label: "Toplam çalışma", value: rows.reduce((s, r) => s + r.run_count, 0), href: "/app/otomasyonlar" },
            ].map((k) => (
              <Link
                key={k.label}
                href={k.href}
                className="focus-ring press group relative block rounded-[14px] border border-white/12 bg-white/8 p-3 text-center transition hover:border-white/30"
              >
                <ArrowUpRight className="hover-action absolute right-2 top-2 h-3.5 w-3.5 text-white/50 opacity-0 transition group-hover:opacity-100" />
                <p className="font-display text-2xl font-extrabold text-white">{k.value}</p>
                <p className="text-[11px] text-white/70">{k.label}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Hazır şablonlar */}
      <section className="rounded-[20px] border border-dashed border-brand-300/40 bg-brand-600/[0.02] p-5">
        <h2 className="mb-3 flex items-center gap-2 font-display font-bold text-ink-950">
          <Zap className="h-4 w-4 text-brand-600" /> Hızlı başlangıç şablonları
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
                    <p className="text-xs text-text-muted">
                      {TRIGGER_LABELS[r.trigger_type] ?? r.trigger_type}
                      {acts.length > 0 && ` → ${acts.map((a) => ACTION_LABELS[a.type] ?? a.type).join(", ")}`}
                    </p>
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
    </div>
  );
}
