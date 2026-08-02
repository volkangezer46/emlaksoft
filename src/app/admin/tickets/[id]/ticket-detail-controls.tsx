"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, UserRound, X } from "lucide-react";
import { updateTicketStatus } from "@/app/actions/tickets";
import {
  assignTicketStaff,
  updateTicketCategory,
  updateTicketPriority,
} from "@/app/actions/admin-ticket-ops";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { isTicketTransitionAllowed } from "@/lib/support/ticket-contract";

const UNASSIGNED = "__unassigned";
const STATUS_DOT: Record<string, string> = {
  open: "bg-brand-500",
  in_progress: "bg-cyan-500",
  waiting: "bg-amber-500",
  resolved: "bg-mint-500",
  closed: "bg-ink-950/30",
};
const PRIORITY_LABEL: Record<string, string> = {
  low: "Düşük",
  normal: "Normal",
  high: "Yüksek",
  urgent: "Acil",
};

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("");
}

export function TicketDetailControls({
  id,
  status,
  statusOptions,
  assignedId,
  staff,
  priority,
  category,
  categoryOptions,
  version,
}: {
  id: string;
  status: string;
  statusOptions: { value: string; label: string }[];
  assignedId: string | null;
  staff: { id: string; full_name: string }[];
  priority: string;
  category: string;
  categoryOptions: { value: string; label: string }[];
  /** İyimser eşzamanlılık kontrolü — bkz. support_tickets.version. */
  version: number;
}) {
  const router = useRouter();
  const [statusPending, startStatusTransition] = useTransition();
  const [assignPending, startAssignTransition] = useTransition();
  const [fieldPending, startFieldTransition] = useTransition();
  const [terminalTarget, setTerminalTarget] = useState<"resolved" | "closed" | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const statusLabelOf = useMemo(() => new Map(statusOptions.map((option) => [option.value, option.label])), [statusOptions]);
  const allowedStatusOptions = useMemo(
    () => statusOptions.filter((option) => option.value === status || isTicketTransitionAllowed(status, option.value, "staff")),
    [status, statusOptions],
  );
  const staffNameOf = useMemo(() => new Map(staff.map((person) => [person.id, person.full_name])), [staff]);

  function onStatusChange(next: string) {
    setFeedback(null);
    if (next === "resolved" || next === "closed") {
      setTerminalTarget(next);
      return;
    }
    startStatusTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("id", id);
        formData.set("status", next);
        formData.set("expected_version", String(version));
        const result = await updateTicketStatus(formData);
        if (!result.ok) {
          setFeedback({ kind: "error", text: result.error ?? "Durum güncellenemedi." });
          return;
        }
        setFeedback({ kind: "success", text: "Durum güncellendi." });
        router.refresh();
      } catch {
        setFeedback({ kind: "error", text: "Durum güncellenirken bağlantı kesildi." });
      }
    });
  }

  function completeTicket(formData: FormData) {
    if (!terminalTarget) return;
    startStatusTransition(async () => {
      try {
        formData.set("id", id);
        formData.set("status", terminalTarget);
        formData.set("expected_version", String(version));
        const result = await updateTicketStatus(formData);
        if (!result.ok) {
          setFeedback({ kind: "error", text: result.error ?? "Çözüm kaydedilemedi." });
          return;
        }
        setTerminalTarget(null);
        setFeedback({ kind: "success", text: terminalTarget === "resolved" ? "Talep çözüldü." : "Talep kapatıldı." });
        router.refresh();
      } catch {
        setFeedback({ kind: "error", text: "Çözüm kaydedilirken bağlantı kesildi." });
      }
    });
  }

  function onAssignChange(next: string) {
    setFeedback(null);
    startAssignTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("id", id);
        formData.set("staff_id", next === UNASSIGNED ? "" : next);
        formData.set("expected_version", String(version));
        const result = await assignTicketStaff(formData);
        if (!result.ok) {
          setFeedback({ kind: "error", text: result.error ?? "Atama kaydedilemedi." });
          return;
        }
        setFeedback({ kind: "success", text: next === UNASSIGNED ? "Atama kaldırıldı." : "Personel atandı." });
        router.refresh();
      } catch {
        setFeedback({ kind: "error", text: "Atama sırasında bağlantı kesildi." });
      }
    });
  }

  function onTicketFieldChange(field: "priority" | "category", next: string) {
    setFeedback(null);
    startFieldTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("id", id);
        formData.set(field, next);
        formData.set("expected_version", String(version));
        const result = field === "priority"
          ? await updateTicketPriority(formData)
          : await updateTicketCategory(formData);
        if (!result.ok) {
          setFeedback({ kind: "error", text: result.error ?? "Ticket alanı güncellenemedi." });
          return;
        }
        setFeedback({ kind: "success", text: field === "priority" ? "Öncelik güncellendi." : "Kategori güncellendi." });
        router.refresh();
      } catch {
        setFeedback({ kind: "error", text: "Değişiklik kaydedilirken bağlantı kesildi." });
      }
    });
  }

  const selectedStatus = terminalTarget ?? status;
  const assignValue = assignedId ?? UNASSIGNED;

  return (
    <div className="space-y-3.5">
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-faint">Durum</label>
        <Select value={selectedStatus} onValueChange={onStatusChange}>
          <SelectTrigger aria-label="Durum güncelle" disabled={statusPending} className={cn("font-semibold", statusPending && "opacity-70")}>
            <span className="flex min-w-0 items-center gap-2">
              {statusPending ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-text-faint" /> : <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[selectedStatus] ?? STATUS_DOT.closed)} aria-hidden />}
              <span className="truncate">{statusLabelOf.get(selectedStatus) ?? selectedStatus}</span>
            </span>
          </SelectTrigger>
          <SelectContent>
            {allowedStatusOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="flex items-center gap-2"><span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[option.value] ?? STATUS_DOT.closed)} aria-hidden />{option.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {terminalTarget ? (
        <form action={completeTicket} className="space-y-2 rounded-[12px] border border-mint-500/25 bg-mint-500/[0.06] p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-bold text-mint-700"><CheckCircle2 className="h-3.5 w-3.5" /> Çözüm kaydı</p>
            <button type="button" onClick={() => setTerminalTarget(null)} className="focus-ring rounded-md p-1 text-text-faint hover:text-ink-950" aria-label="Çözüm formunu kapat"><X className="h-3.5 w-3.5" /></button>
          </div>
          <label className="block text-[10px] font-semibold text-text-muted">
            Çözüm türü
            <select name="resolution_code" defaultValue={terminalTarget === "closed" ? "closed_by_support" : "solved"} className="mt-1 w-full rounded-[8px] border border-line bg-surface px-2.5 py-2 text-xs outline-none focus:border-brand-400">
              <option value="solved">Sorun çözüldü</option>
              <option value="guidance">Bilgilendirme yapıldı</option>
              <option value="configuration">Yapılandırma düzeltildi</option>
              <option value="duplicate">Mükerrer talep</option>
              <option value="closed_by_support">Destek tarafından kapatıldı</option>
            </select>
          </label>
          <label className="block text-[10px] font-semibold text-text-muted">
            Çözüm özeti
            <textarea name="resolution_summary" required minLength={3} maxLength={2000} rows={3} placeholder="Uygulanan çözümü kısa ve ölçülebilir şekilde yazın…" className="mt-1 w-full resize-y rounded-[8px] border border-line bg-surface px-2.5 py-2 text-xs leading-relaxed outline-none focus:border-brand-400" />
          </label>
          <button type="submit" disabled={statusPending} className="focus-ring press w-full rounded-[8px] bg-mint-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60">
            {statusPending ? "Kaydediliyor…" : terminalTarget === "resolved" ? "Çözüldü olarak kaydet" : "Kapat ve kaydet"}
          </button>
        </form>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-faint">Öncelik</label>
          <Select value={priority} onValueChange={(next) => onTicketFieldChange("priority", next)}>
            <SelectTrigger aria-label="Öncelik güncelle" disabled={fieldPending} className="text-xs font-semibold">
              <span className="truncate">{PRIORITY_LABEL[priority] ?? priority}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Düşük</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="high">Yüksek</SelectItem>
              <SelectItem value="urgent">Acil</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-faint">Kategori</label>
          <Select value={category} onValueChange={(next) => onTicketFieldChange("category", next)}>
            <SelectTrigger aria-label="Kategori güncelle" disabled={fieldPending} className="text-xs font-semibold"><span className="truncate">{categoryOptions.find((option) => option.value === category)?.label ?? category}</span></SelectTrigger>
            <SelectContent>
              {categoryOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-faint">Atanan personel</label>
        <Select value={assignValue} onValueChange={onAssignChange}>
          <SelectTrigger aria-label="Personel ata" disabled={assignPending} className={cn("font-semibold", assignPending && "opacity-70")}>
            <span className="flex min-w-0 items-center gap-2">
              {assignPending ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-text-faint" /> : assignedId ? <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-cyan-500/15 text-[9px] font-bold text-cyan-700">{initials(staffNameOf.get(assignedId) ?? "?")}</span> : <UserRound className="h-4 w-4 shrink-0 text-text-faint" aria-hidden />}
              <span className="truncate">{assignedId ? (staffNameOf.get(assignedId) ?? "Personel") : "Atanmadı"}</span>
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED}><span className="flex items-center gap-2 text-text-muted"><UserRound className="h-3.5 w-3.5" /> Atanmadı</span></SelectItem>
            {staff.map((person) => <SelectItem key={person.id} value={person.id}><span className="flex items-center gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-600/10 text-[9px] font-bold text-brand-700">{initials(person.full_name)}</span>{person.full_name}</span></SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <p className={cn("min-h-4 text-xs font-medium", feedback?.kind === "error" ? "text-danger-600" : "text-mint-700")} role={feedback?.kind === "error" ? "alert" : "status"} aria-live="polite">
        {feedback?.text ?? ""}
      </p>
    </div>
  );
}
