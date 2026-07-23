"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Building2, Check, Copy, MapPin, MessageCircle, Phone, Rocket, StickyNote, UserPlus } from "lucide-react";
import { addDemoNote, assignDemo, convertDemoToTenant, setDemoStatus, type ConvertResult } from "@/app/actions/platform-sales";

export type DemoRow = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  city: string | null;
  team_size: string | null;
  message: string | null;
  status: string;
  assigned_to: string | null;
  notes: string | null;
  converted_tenant_id: string | null;
  created_at: string;
};

const STATUS: { key: string; label: string; cls: string }[] = [
  { key: "new", label: "Yeni", cls: "bg-brand-600/10 text-brand-600" },
  { key: "contacted", label: "İletişim kuruldu", cls: "bg-cyan-500/12 text-cyan-600" },
  { key: "qualified", label: "Nitelikli", cls: "bg-amber-400/15 text-amber-600" },
  { key: "won", label: "Kazanıldı", cls: "bg-mint-500/12 text-mint-600" },
  { key: "lost", label: "Kaybedildi", cls: "bg-ink-950/6 text-text-muted" },
];

function relTime(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `${Math.max(1, min)} dk önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} sa önce`;
  return new Date(iso).toLocaleDateString("tr-TR");
}

export function DemoCard({ row, staff }: { row: DemoRow; staff: { id: string; full_name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [creds, setCreds] = useState<ConvertResult | null>(null);
  const [copied, setCopied] = useState(false);

  const current = STATUS.find((s) => s.key === row.status) ?? STATUS[0]!;
  const waPhone = row.phone?.replace(/\D/g, "").replace(/^0/, "90");

  const run = (fn: (fd: FormData) => Promise<unknown>, fd: FormData) => {
    startTransition(async () => {
      await fn(fd);
      router.refresh();
    });
  };

  const changeStatus = (status: string) => {
    const fd = new FormData();
    fd.set("id", row.id);
    fd.set("status", status);
    run(setDemoStatus, fd);
  };

  const changeAssignee = (assignedTo: string) => {
    const fd = new FormData();
    fd.set("id", row.id);
    fd.set("assigned_to", assignedTo);
    run(assignDemo, fd);
  };

  const convert = () => {
    setConvertError(null);
    const fd = new FormData();
    fd.set("id", row.id);
    startTransition(async () => {
      const res = await convertDemoToTenant(fd);
      if (res.error) {
        setConvertError(res.error);
        return;
      }
      setCreds(res);
      router.refresh();
    });
  };

  const copyCreds = async () => {
    if (!creds) return;
    const text = `EmlakSoft giriş bilgileri\nOfis: ${creds.tenantName}\nE-posta: ${creds.email}\nGeçici şifre: ${creds.tempPassword}\nGiriş: https://emlaksoft.com/giris`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* yoksay */
    }
  };

  const submitNote = () => {
    if (!note.trim()) return;
    const fd = new FormData();
    fd.set("id", row.id);
    fd.set("note", note.trim());
    startTransition(async () => {
      await addDemoNote(fd);
      setNote("");
      setNoteOpen(false);
      router.refresh();
    });
  };

  return (
    <div className={`dashboard-panel rounded-[16px] border border-line bg-surface p-4 transition ${pending ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display font-bold text-ink-950">{row.full_name}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-text-faint">
            {row.company ? <span className="flex items-center gap-1"><Building2 className="h-3 w-3" /> {row.company}</span> : null}
            {row.city ? <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {row.city}</span> : null}
            {row.team_size ? <span>{row.team_size} kişi</span> : null}
            <span>{relTime(row.created_at)}</span>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${current.cls}`}>{current.label}</span>
      </div>

      {row.message ? (
        <p className="mt-2.5 rounded-[10px] border border-line bg-canvas/60 px-3 py-2 text-xs text-text-muted">{row.message}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {row.phone ? (
          <>
            <a href={`tel:${row.phone}`} className="inline-flex items-center gap-1.5 rounded-[9px] border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300">
              <Phone className="h-3.5 w-3.5 text-brand-600" /> Ara
            </a>
            {waPhone ? (
              <a href={`https://wa.me/${waPhone}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-[9px] border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-mint-500/50">
                <MessageCircle className="h-3.5 w-3.5 text-mint-600" /> WhatsApp
              </a>
            ) : null}
          </>
        ) : null}
        {row.email ? (
          <a href={`mailto:${row.email}`} className="inline-flex items-center gap-1.5 rounded-[9px] border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300">
            E-posta
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => setNoteOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-[9px] border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300"
        >
          <StickyNote className="h-3.5 w-3.5 text-amber-600" /> Not
        </button>
        {row.converted_tenant_id ? (
          <Link
            href={`/admin/tenants/${row.converted_tenant_id}`}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-mint-500/40 bg-mint-500/10 px-2.5 py-1.5 text-xs font-semibold text-mint-600 transition hover:border-mint-500/60"
          >
            <Check className="h-3.5 w-3.5" /> Ofis oluşturuldu <ArrowUpRight className="h-3 w-3" />
          </Link>
        ) : (
          <button
            type="button"
            onClick={convert}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-[9px] bg-[image:var(--grad-brand)] px-2.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:brightness-105 disabled:opacity-50"
          >
            <Rocket className="h-3.5 w-3.5" /> Ofise dönüştür
          </button>
        )}
      </div>

      {convertError ? (
        <p className="mt-2 rounded-[9px] border border-danger-500/30 bg-danger-500/8 px-3 py-2 text-xs font-medium text-danger-600">{convertError}</p>
      ) : null}

      {creds ? (
        <div className="mt-2 rounded-[12px] border border-mint-500/40 bg-mint-500/8 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-bold text-mint-600">
              <Rocket className="h-3.5 w-3.5" /> {creds.tenantName} oluşturuldu · 14 gün deneme
            </p>
            <button type="button" onClick={copyCreds} className="inline-flex items-center gap-1 rounded-[7px] border border-mint-500/40 bg-surface px-2 py-1 text-[11px] font-semibold text-mint-600 transition hover:bg-mint-500/10">
              <Copy className="h-3 w-3" /> {copied ? "Kopyalandı" : "Kopyala"}
            </button>
          </div>
          <div className="mt-2 space-y-1 font-mono text-[11px] text-ink-950">
            <p><span className="text-text-faint">E-posta:</span> {creds.email}</p>
            <p><span className="text-text-faint">Geçici şifre:</span> <span className="font-bold">{creds.tempPassword}</span></p>
          </div>
          <p className="mt-1.5 text-[10px] text-text-muted">Bu bilgileri müşteriyle paylaşın. Şifre yalnızca şimdi görünür.</p>
        </div>
      ) : null}

      {noteOpen ? (
        <div className="mt-2 flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitNote()}
            placeholder="Görüşme notu ekle…"
            className="h-9 flex-1 rounded-[9px] border border-line bg-canvas px-3 text-sm text-ink-950 outline-none focus:border-brand-300"
          />
          <button type="button" onClick={submitNote} disabled={pending} className="inline-flex items-center gap-1 rounded-[9px] bg-brand-600 px-3 text-xs font-bold text-white disabled:opacity-50">
            <Check className="h-3.5 w-3.5" /> Kaydet
          </button>
        </div>
      ) : null}

      {row.notes ? (
        <div className="mt-2 max-h-24 space-y-1 overflow-y-auto rounded-[10px] border border-line bg-canvas/40 px-3 py-2">
          {row.notes.split("\n").map((n, i) => (
            <p key={i} className="text-[11px] leading-relaxed text-text-muted">{n}</p>
          ))}
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3">
        <label className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-faint">Durum</span>
        </label>
        <label className="flex items-center gap-1.5">
          <UserPlus className="h-3 w-3 text-text-faint" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-faint">Sorumlu</span>
        </label>
        <select
          value={row.status}
          onChange={(e) => changeStatus(e.target.value)}
          disabled={pending}
          className="h-8 rounded-[8px] border border-line bg-canvas px-2 text-xs font-medium text-ink-950 outline-none focus:border-brand-300"
        >
          {STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select
          value={row.assigned_to ?? ""}
          onChange={(e) => changeAssignee(e.target.value)}
          disabled={pending}
          className="h-8 rounded-[8px] border border-line bg-canvas px-2 text-xs font-medium text-ink-950 outline-none focus:border-brand-300"
        >
          <option value="">Atanmadı</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
      </div>
    </div>
  );
}
