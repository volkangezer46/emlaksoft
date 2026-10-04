"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Building2, Check, MailCheck, MailWarning, MapPin, MessageCircle, Phone, Rocket, Send, StickyNote, UserPlus } from "lucide-react";
import { toWhatsAppLink } from "@/lib/phone";
import { DeleteLead, LeadPanel } from "./lead-panel";
import { addDemoNote, assignDemo, convertDemoToTenant, resendConvertedOwnerAccessLink, setDemoStatus, type ConvertResult } from "@/app/actions/platform-sales";

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
  return new Date(iso).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
}

export function DemoCard({ row, staff, isSuperAdmin = false }: { row: DemoRow; staff: { id: string; full_name: string }[]; isSuperAdmin?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [creds, setCreds] = useState<ConvertResult | null>(null);
  const [accessMessage, setAccessMessage] = useState<string | null>(null);

  const current = STATUS.find((s) => s.key === row.status) ?? STATUS[0]!;
  const waHref = toWhatsAppLink(row.phone);

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

  const resendAccessLink = () => {
    setAccessMessage(null);
    const fd = new FormData();
    fd.set("id", row.id);
    startTransition(async () => {
      const result = await resendConvertedOwnerAccessLink(fd);
      setAccessMessage(
        result.ok
          ? "Yeni güvenli erişim bağlantısı müşterinin e-postasına gönderildi."
          : (result.error ?? "Erişim bağlantısı gönderilemedi."),
      );
    });
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
    <div className={`dashboard-panel rounded-[var(--radius-card)] border border-line bg-surface p-4 transition ${pending ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/admin/satis/${row.id}`} className="group inline-flex max-w-full items-center gap-1 truncate font-display font-bold text-ink-950 transition hover:text-brand-600">
            <span className="truncate">{row.full_name}</span>
            <ArrowUpRight className="hover-action h-3.5 w-3.5 shrink-0 opacity-0 transition group-hover:opacity-100" />
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text-faint">
            {row.company ? <span className="flex items-center gap-1"><Building2 className="h-3 w-3" /> {row.company}</span> : null}
            {row.city ? <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {row.city}</span> : null}
            {row.team_size ? <span>{row.team_size} kişi</span> : null}
            <span>{relTime(row.created_at)}</span>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${current.cls}`}>{current.label}</span>
      </div>

      {row.message ? (
        <p className="mt-2.5 rounded-[var(--radius-control)] border border-line bg-canvas/60 px-3 py-2 text-xs text-text-muted">{row.message}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {row.phone ? (
          <>
            <a href={`tel:${row.phone}`} className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300">
              <Phone className="h-3.5 w-3.5 text-brand-600" /> Ara
            </a>
            {waHref ? (
              <a href={waHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-mint-500/50">
                <MessageCircle className="h-3.5 w-3.5 text-mint-600" /> WhatsApp
              </a>
            ) : null}
          </>
        ) : null}
        {row.email ? (
          <a href={`mailto:${row.email}`} className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300">
            E-posta
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => setNoteOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300"
        >
          <StickyNote className="h-3.5 w-3.5 text-amber-600" /> Not
        </button>
        {row.converted_tenant_id ? (
          <Link
            href={`/admin/tenants/${row.converted_tenant_id}`}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-mint-500/40 bg-mint-500/10 px-2.5 py-1.5 text-xs font-semibold text-mint-600 transition hover:border-mint-500/60"
          >
            <Check className="h-3.5 w-3.5" /> Ofis oluşturuldu <ArrowUpRight className="h-3 w-3" />
          </Link>
        ) : (
          <button
            type="button"
            onClick={convert}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-[image:var(--grad-brand)] px-2.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:brightness-105 disabled:opacity-50"
          >
            <Rocket className="h-3.5 w-3.5" /> Ofise dönüştür
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-start gap-2">
        <LeadPanel lead={row} />
        {row.converted_tenant_id ? (
          <button
            type="button"
            onClick={resendAccessLink}
            disabled={pending}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs font-semibold text-brand-600 transition hover:bg-brand-600/5 disabled:opacity-50"
          >
            <Send className="h-3 w-3" /> Erişim bağlantısını yeniden gönder
          </button>
        ) : isSuperAdmin ? (
          <DeleteLead id={row.id} name={row.full_name} />
        ) : null}
      </div>
      {!creds && accessMessage ? <p role="status" className="mt-2 text-xs font-medium text-text-muted">{accessMessage}</p> : null}

      {convertError ? (
        <p className="mt-2 rounded-[var(--radius-control)] border border-danger-500/30 bg-danger-500/8 px-3 py-2 text-xs font-medium text-danger-600">{convertError}</p>
      ) : null}

      {creds ? (
        <div className={`mt-2 rounded-[var(--radius-card)] border p-3 ${creds.accessLinkSent ? "border-mint-500/40 bg-mint-500/8" : "border-amber-400/45 bg-amber-400/10"}`}>
          <p className={`flex items-center gap-1.5 text-xs font-bold ${creds.accessLinkSent ? "text-mint-600" : "text-amber-700"}`}>
            {creds.accessLinkSent ? <MailCheck className="h-3.5 w-3.5" /> : <MailWarning className="h-3.5 w-3.5" />}
            {creds.tenantName} oluşturuldu · 14 gün deneme
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-950">
            {creds.accessLinkSent
              ? `${creds.email} adresine tek kullanımlık şifre oluşturma bağlantısı gönderildi.`
              : "Ofis oluşturuldu ancak erişim e-postası gönderilemedi. E-posta sağlayıcısını kontrol edip yeniden gönderin."}
          </p>
          <button
            type="button"
            onClick={resendAccessLink}
            disabled={pending}
            className="mt-2 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-current/20 bg-surface px-2.5 py-1.5 text-xs font-bold text-brand-600 transition hover:bg-brand-600/5 disabled:opacity-50"
          >
            <Send className="h-3 w-3" /> Güvenli bağlantıyı yeniden gönder
          </button>
          {accessMessage ? <p role="status" className="mt-2 text-xs font-medium text-text-muted">{accessMessage}</p> : null}
        </div>
      ) : null}

      {noteOpen ? (
        <div className="mt-2 flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitNote()}
            placeholder="Görüşme notu ekle…"
            className="h-9 flex-1 rounded-[var(--radius-control)] border border-line bg-canvas px-3 text-sm text-ink-950 outline-none focus:border-brand-300"
          />
          <button type="button" onClick={submitNote} disabled={pending} className="inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-brand-600 px-3 text-xs font-bold text-white disabled:opacity-50">
            <Check className="h-3.5 w-3.5" /> Kaydet
          </button>
        </div>
      ) : null}

      {row.notes ? (
        <div className="mt-2 max-h-24 space-y-1 overflow-y-auto rounded-[var(--radius-control)] border border-line bg-canvas/40 px-3 py-2">
          {row.notes.split("\n").map((n, i) => (
            <p key={i} className="text-xs leading-relaxed text-text-muted">{n}</p>
          ))}
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3">
        <label className="flex items-center gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-faint">Durum</span>
        </label>
        <label className="flex items-center gap-1.5">
          <UserPlus className="h-3 w-3 text-text-faint" />
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-faint">Sorumlu</span>
        </label>
        <select
          value={row.status}
          onChange={(e) => changeStatus(e.target.value)}
          disabled={pending}
          className="h-8 rounded-[var(--radius-control)] border border-line bg-canvas px-2 text-xs font-medium text-ink-950 outline-none focus:border-brand-300"
        >
          {STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select
          value={row.assigned_to ?? ""}
          onChange={(e) => changeAssignee(e.target.value)}
          disabled={pending}
          className="h-8 rounded-[var(--radius-control)] border border-line bg-canvas px-2 text-xs font-medium text-ink-950 outline-none focus:border-brand-300"
        >
          <option value="">Atanmadı</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
      </div>
    </div>
  );
}
