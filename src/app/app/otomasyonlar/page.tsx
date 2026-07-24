import { Zap, Play, Pause, BarChart3 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { ApplyTemplateButton, AutomationRowActions } from "./automation-actions";

const TRIGGER_LABELS: Record<string, string> = {
  new_customer:       "Yeni müşteri",
  new_demand:         "Yeni talep",
  new_property:       "Yeni portföy",
  property_matched:   "Portföy eşleşmesi",
  no_contact_days:    "İletişimsizlik süresi",
  offer_received:     "Teklif alındı",
  deal_won:           "Satış tamamlandı",
  deal_lost:          "Satış kaybedildi",
  auth_expiring:      "Yetki belgesi doluyor",
  appointment_missed: "Randevu kaçırıldı",
  demand_stale:       "Hareketsiz talep",
};

const ACTION_LABELS: Record<string, string> = {
  send_whatsapp:    "WhatsApp gönder",
  send_sms:         "SMS gönder",
  create_task:      "Görev oluştur",
  assign_to_staff:  "Danışmana ata",
  notify_manager:   "Müdüre bildir",
  add_tag:          "Etiket ekle",
  change_status:    "Durum değiştir",
  send_notification:"Bildirim gönder",
};

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

export default async function OtomasyonlarPage() {
  await requireModulePage("settings");
  const supabase = await createClient();

  const { data } = await supabase
    .from("automations")
    .select("id, name, description, trigger_type, actions, status, run_count, last_run_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(50);

  const rows = (data ?? []) as AutomationRow[];
  const active   = rows.filter((r) => r.status === "active").length;
  const inactive = rows.filter((r) => r.status === "inactive").length;

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
          </div>
          <div className="flex gap-3">
            {[
              { label: "Aktif", value: active },
              { label: "Pasif", value: inactive },
              { label: "Toplam çalışma", value: rows.reduce((s, r) => s + r.run_count, 0) },
            ].map((k) => (
              <div key={k.label} className="rounded-[14px] border border-white/12 bg-white/8 p-3 text-center">
                <p className="font-display text-2xl font-extrabold text-white">{k.value}</p>
                <p className="text-[10px] text-white/70">{k.label}</p>
              </div>
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
            { key: "no_contact_days",  name: "14 gün dokunulmamış müşteri uyarısı", trigger: "no_contact_days",  action: "notify_manager" },
            { key: "auth_expiring",    name: "Yetki belgesi bitişi — görev oluştur",  trigger: "auth_expiring",    action: "create_task" },
            { key: "new_customer",     name: "Yeni müşteriyle 5 dk içinde iletişim",  trigger: "new_customer",     action: "create_task" },
            { key: "deal_won",         name: "Satış sonrası teşekkür WhatsApp'ı",     trigger: "deal_won",         action: "send_whatsapp" },
            { key: "property_matched", name: "Eşleşen portföyü müşteriye gönder",     trigger: "property_matched", action: "send_whatsapp" },
            { key: "demand_stale",     name: "30 gün hareketsiz talep uyarısı",       trigger: "demand_stale",     action: "notify_manager" },
          ].map((t) => (
            <div key={t.key} className="flex items-center gap-3 rounded-[12px] border border-line bg-surface px-3 py-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-brand-600/10 text-brand-600">
                <Zap className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-ink-950">{t.name}</p>
                <p className="text-[10px] text-text-faint">
                  {TRIGGER_LABELS[t.trigger]} → {ACTION_LABELS[t.action]}
                </p>
              </div>
              <ApplyTemplateButton templateKey={t.key} />
            </div>
          ))}
        </div>
      </section>

      {/* Mevcut otomasyonlar */}
      <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-950">
            <BarChart3 className="h-4 w-4 text-brand-600" /> Kayıtlı otomasyonlar
          </p>
          <span className="text-xs text-text-faint">{rows.length} kural</span>
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Zap className="h-10 w-10 text-text-faint" />
            <p className="mt-3 font-semibold text-ink-950">Henüz otomasyon yok</p>
            <p className="mt-1 text-sm text-text-muted">Yukarıdaki şablonlardan birini uygulayarak başlayın.</p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {rows.map((r) => {
              const acts = Array.isArray(r.actions) ? r.actions : [];
              return (
                <div key={r.id} className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-canvas/40">
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[9px] ${
                    r.status === "active" ? "bg-mint-500/12 text-mint-600" : "bg-zinc-100 text-zinc-400"
                  }`}>
                    {r.status === "active" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink-950">{r.name}</p>
                    <p className="text-xs text-text-muted">
                      {TRIGGER_LABELS[r.trigger_type] ?? r.trigger_type}
                      {acts.length > 0 && ` → ${acts.map((a) => ACTION_LABELS[a.type] ?? a.type).join(", ")}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold text-ink-950">{r.run_count} çalışma</p>
                    {r.last_run_at && (
                      <p className="text-[10px] text-text-faint">
                        Son: {new Date(r.last_run_at).toLocaleDateString("tr-TR")}
                      </p>
                    )}
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                    r.status === "active" ? "bg-mint-50 text-mint-700" :
                    r.status === "draft"  ? "bg-zinc-100 text-zinc-500" :
                    "bg-zinc-50 text-zinc-400"
                  }`}>
                    {r.status === "active" ? "Aktif" : r.status === "draft" ? "Taslak" : "Pasif"}
                  </span>
                  <AutomationRowActions row={r} />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
