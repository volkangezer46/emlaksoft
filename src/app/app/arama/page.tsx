import Link from "next/link";
import {
  Activity,
  Clock3,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Radio,
  UserCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { CallConsole } from "./call-console";
import { formatTurkishPhone } from "@/lib/phone";

type CallRow = {
  id: string;
  direction: string;
  phone: string;
  duration_sec: number | null;
  disposition: string | null;
  notes: string | null;
  started_at: string;
  customer: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
};

function customerName(value: CallRow["customer"]) {
  if (!value) return "Bilinmeyen arayan";
  return Array.isArray(value) ? (value[0]?.full_name ?? "Bilinmeyen arayan") : value.full_name;
}

function customerId(value: CallRow["customer"]) {
  if (!value) return null;
  return Array.isArray(value) ? (value[0]?.id ?? null) : value.id;
}

function duration(value: number | null) {
  if (!value) return "—";
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default async function PhoneOsPage() {
  await requireModulePage("calls");
  const supabase = await createClient();
  const [{ data: calls }, { data: customers }, { data: demands }] = await Promise.all([
    supabase
      .from("calls")
      .select("id, direction, phone, duration_sec, disposition, notes, started_at, customer:customers(id, full_name)")
      .order("started_at", { ascending: false })
      .limit(100),
    supabase
      .from("customers")
      .select("id, full_name, phone, customer_types, notes")
      .is("deleted_at", null)
      .order("full_name"),
    supabase.from("customer_demands").select("customer_id, status").in("status", ["new", "active", "matched"]),
  ]);

  const rows = (calls ?? []) as CallRow[];
  const customerList = customers ?? [];
  const demandCounts: Record<string, number> = {};
  const matchCounts: Record<string, number> = {};
  for (const d of demands ?? []) {
    if (!d.customer_id) continue;
    if (d.status === "matched") matchCounts[d.customer_id] = (matchCounts[d.customer_id] ?? 0) + 1;
    else demandCounts[d.customer_id] = (demandCounts[d.customer_id] ?? 0) + 1;
  }
  const inbound = rows.filter((call) => call.direction === "inbound").length;
  const missed = rows.filter((call) => call.direction === "missed").length;
  const appointments = rows.filter((call) => call.disposition === "Randevu aldı").length;

  const today = new Date();
  const volume = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    const key = d.toISOString().slice(0, 10);
    const count = rows.filter((r) => r.started_at?.slice(0, 10) === key).length;
    return { label: d.toLocaleDateString("tr-TR", { weekday: "short" }), count };
  });
  const maxVol = Math.max(1, ...volume.map((v) => v.count));
  const answered = rows.filter((call) => call.direction !== "missed").length;
  const answerRate = rows.length ? answered / rows.length : 0;
  const avgDur = rows.length ? Math.round(rows.reduce((s, r) => s + (r.duration_sec ?? 0), 0) / rows.length) : 0;

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-mint-500/25 blur-[80px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400"><Radio className="h-4 w-4" /> Görüşme kayıt merkezi</span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Akıllı Arama</h1>
            <p className="mt-1 text-sm text-white/60">Müşteri eşleştirme, sonuç kodu ve görüşme geçmişi tek akışta kayıt altında.</p>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {[
                { label: "Gelen çağrı", value: inbound, icon: PhoneIncoming, tone: "text-cyan-400" },
                { label: "Cevapsız", value: missed, icon: PhoneMissed, tone: "text-danger-500" },
                { label: "Randevu", value: appointments, icon: UserCheck, tone: "text-mint-400" },
              ].map((item) => (
                <div key={item.label} className="rounded-[14px] border border-white/10 bg-white/5 p-3 backdrop-blur">
                  <item.icon className={`h-4 w-4 ${item.tone}`} />
                  <p className="mt-2 font-display text-xl font-extrabold text-white">{item.value}</p>
                  <p className="text-[10px] text-white/45 sm:text-xs">{item.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* live call volume */}
          <div className="rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-white/75"><Activity className="h-3.5 w-3.5 text-cyan-400" /> Arama hacmi · son 7 gün</p>
              <span className="rounded-full bg-mint-500/15 px-2 py-0.5 text-[10px] font-bold text-mint-400">cevap %{Math.round(answerRate * 100)}</span>
            </div>
            <div className="mt-4 flex h-24 items-end gap-2">
              {volume.map((v, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                  <div className="flex h-full w-full items-end justify-center">
                    <div
                      className="bar-live w-full max-w-[16px] rounded-t-[4px] bg-[image:var(--grad-brand)] shadow-[0_0_10px_-2px_rgba(20,99,255,0.6)]"
                      style={{ height: `${Math.max((v.count / maxVol) * 100, 6)}%`, animationDelay: `${i * 0.08}s` }}
                    />
                  </div>
                  <span className="text-[9px] text-white/40">{v.label}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2 border-t border-white/10 pt-3">
              <span className="flex h-5 items-center gap-[3px]">
                {Array.from({ length: 16 }).map((_, i) => (
                  <span key={i} className="wave-bar h-full w-[2px] rounded-full bg-mint-400/70" style={{ animationDelay: `${i * 0.08}s` }} />
                ))}
              </span>
              <span className="text-[10px] text-white/55">Ort. görüşme {duration(avgDur)} · {rows.length} kayıt</span>
            </div>
          </div>
        </div>
      </section>

      <CallConsole customers={customerList} demandCounts={demandCounts} matchCounts={matchCounts} />

      <section className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div><p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><Clock3 className="h-4 w-4" /> Gerçek kayıtlar</p><h2 className="mt-1 font-display font-bold text-ink-950">Çağrı geçmişi</h2></div>
          <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-[10px] font-bold text-brand-600">{rows.length} çağrı</span>
        </div>
        {rows.length === 0 ? (
          <div className="grid place-items-center px-6 py-14 text-center"><span className="grid h-14 w-14 place-items-center rounded-[16px] bg-brand-600/10 text-brand-600"><PhoneIncoming className="h-7 w-7" /></span><h3 className="mt-4 font-display text-lg font-bold text-ink-950">Henüz çağrı kaydı yok</h3><p className="mt-1 text-sm text-text-muted">İlk görüşmeyi kaydettiğinizde çağrı geçmişi burada oluşacak.</p></div>
        ) : (
          <div className="divide-y divide-line">
            {rows.map((call) => {
              const DirectionIcon = call.direction === "inbound" ? PhoneIncoming : call.direction === "outbound" ? PhoneOutgoing : PhoneMissed;
              const custId = customerId(call.customer);
              return (
                <article key={call.id} className="group relative grid gap-3 px-5 py-4 transition hover:bg-brand-600/[0.02] md:grid-cols-[1.2fr_.8fr_.8fr_.7fr] md:items-center">
                  {custId ? (
                    <Link href={`/app/musteriler/${custId}`} className="absolute inset-0" aria-label={`${customerName(call.customer)} müşterisini aç`} />
                  ) : null}
                  <div className="flex items-center gap-3"><span className={`grid h-10 w-10 place-items-center rounded-[11px] ${call.direction === "missed" ? "bg-danger-500/10 text-danger-500" : "bg-brand-600/10 text-brand-600"}`}><DirectionIcon className="h-4 w-4" /></span><div><p className="text-sm font-semibold text-ink-950">{customerName(call.customer)}</p><p className="text-xs tabular-nums text-text-muted">{formatTurkishPhone(call.phone)}</p></div></div>
                  <div><p className="text-[10px] text-text-faint">Sonuç</p><p className="text-xs font-semibold text-ink-950">{call.disposition ?? "Cevapsız"}</p></div>
                  <div><p className="text-[10px] text-text-faint">Süre</p><p className="text-xs font-semibold tabular-nums text-ink-950">{duration(call.duration_sec)}</p></div>
                  <div className="text-xs text-text-muted">{new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(call.started_at))}</div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
