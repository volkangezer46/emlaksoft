"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Eye, EyeOff, Megaphone, MessageSquare, Pin, PinOff, Send } from "lucide-react";
import { useToast } from "@/components/app/toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormError, FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import {
  createBuildingAnnouncement,
  previewAnnouncementSend,
  sendBuildingAnnouncement,
  updateBuildingAnnouncement,
  type AnnouncementPreview,
} from "@/app/actions/building-announcements";
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_AUDIENCE_LABELS,
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_CATEGORY_LABELS,
  type AnnouncementAudience,
  type AnnouncementCategory,
  type AnnouncementChannel,
  type AnnouncementRow,
} from "@/lib/building-management/announcements";
import { formatDateTr } from "@/lib/format";

/** Yeni duyuru formu: başlık, tür, metin, sabitle, portalda göster. */
export function AnnouncementComposer({ buildingId }: { buildingId: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [formKey, setFormKey] = useState(0);

  function submit(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await createBuildingAnnouncement({
        buildingId,
        title: String(fd.get("title") ?? ""),
        body,
        category: String(fd.get("category") ?? "genel"),
        pinned: fd.get("pinned") === "on",
        visibleInPortal: fd.get("portal") === "on",
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      push(res.info ?? "Duyuru yayımlandı", "ok");
      setBody("");
      setFormKey((k) => k + 1);
      router.refresh();
    });
  }

  return (
    <form key={formKey} action={submit} className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]" aria-label="Yeni duyuru">
      <h3 className="flex items-center gap-2 font-display font-bold text-ink-950"><Megaphone className="h-4 w-4 text-brand-600" aria-hidden="true" /> Sakinlere duyuru</h3>
      <p className="text-xs text-text-muted">Duyuru malik ve kiracı portalında görünür. İsterseniz yayımladıktan sonra SMS ya da WhatsApp ile de gönderin (yalnız İYS izni olan sakinlere).</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Başlık" htmlFor="ann-title" required className="sm:col-span-2">
          <FormInput id="ann-title" name="title" required maxLength={120} placeholder="Ör. Salı günü 10:00-14:00 su kesintisi" />
        </FormField>
        <FormField label="Tür" htmlFor="ann-category">
          <FormSelect id="ann-category" name="category" defaultValue="genel">
            {ANNOUNCEMENT_CATEGORIES.map((c) => <option key={c} value={c}>{ANNOUNCEMENT_CATEGORY_LABELS[c]}</option>)}
          </FormSelect>
        </FormField>
        <FormField label="Metin" htmlFor="ann-body" required className="sm:col-span-3" hint={`${body.length}/2000`}>
          <FormTextarea id="ann-body" name="body" required rows={4} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
        </FormField>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2"><Checkbox name="portal" defaultChecked /> Portalda göster</label>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2"><Checkbox name="pinned" /> Üste sabitle</label>
      </div>
      <FormError error={error} />
      <Button type="submit" loading={pending} icon={Megaphone}>Duyuruyu yayımla</Button>
    </form>
  );
}

const CATEGORY_TONE: Record<AnnouncementCategory, "neutral" | "info" | "warning" | "danger" | "success"> = {
  genel: "neutral",
  bakim: "info",
  toplanti: "success",
  kesinti: "danger",
  finans: "warning",
};

/** Duyuru kartı: sabitle, portal görünürlüğü, arşiv ve SMS/WhatsApp gönderimi (önizlemeli). */
export function AnnouncementItem({ row, canEdit }: { row: AnnouncementRow; canEdit: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);

  const patch = (p: { pinned?: boolean; visibleInPortal?: boolean; archive?: boolean }, ok: string) => {
    setError(null);
    startTransition(async () => {
      const res = await updateBuildingAnnouncement({ id: row.id, ...p });
      if (res.error) {
        setError(res.error);
        return;
      }
      push(ok, "ok");
      router.refresh();
    });
  };

  const sentChips = (["sms", "whatsapp"] as const).flatMap((ch) => {
    const d = row.delivery[ch];
    if (!d) return [];
    return [<Badge key={ch} variant="success" size="sm">{ch === "sms" ? "SMS" : "WhatsApp"}: {d.sent} kişi</Badge>];
  });

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-ink-950">
            {row.pinned ? <Pin className="h-3.5 w-3.5 text-brand-600" aria-label="Sabitlendi" /> : null}
            {row.title}
          </p>
          <p className="text-xs text-text-muted">{formatDateTr(row.createdAt, { day: "2-digit", month: "long", year: "numeric" })} · {row.visibleInPortal ? "Portalda görünür" : "Portalda gizli"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={CATEGORY_TONE[row.category]} size="sm">{ANNOUNCEMENT_CATEGORY_LABELS[row.category]}</Badge>
          {sentChips}
        </div>
      </div>
      <p className="whitespace-pre-line text-sm text-ink-950">{row.body}</p>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" icon={row.pinned ? PinOff : Pin} disabled={pending} onClick={() => patch({ pinned: !row.pinned }, row.pinned ? "Sabitleme kaldırıldı" : "Duyuru üste sabitlendi")}>
            {row.pinned ? "Sabitlemeyi kaldır" : "Sabitle"}
          </Button>
          <Button size="sm" variant="ghost" icon={row.visibleInPortal ? EyeOff : Eye} disabled={pending} onClick={() => patch({ visibleInPortal: !row.visibleInPortal }, row.visibleInPortal ? "Portalda gizlendi" : "Portalda gösteriliyor")}>
            {row.visibleInPortal ? "Portalda gizle" : "Portalda göster"}
          </Button>
          <Button size="sm" variant={sendOpen ? "secondary" : "outline"} icon={Send} onClick={() => setSendOpen((v) => !v)} aria-expanded={sendOpen}>
            SMS / WhatsApp gönder
          </Button>
          <ConfirmDialog
            title="Duyuru arşivlensin mi?"
            description="Duyuru listeden ve portaldan kalkar; gönderim kayıtları korunur."
            confirmLabel="Arşivle"
            onConfirm={async () => {
              const res = await updateBuildingAnnouncement({ id: row.id, archive: true });
              if (!res.error) {
                push("Duyuru arşivlendi", "ok");
                router.refresh();
              }
              return res;
            }}
            trigger={<Button size="sm" variant="ghost" icon={Archive}>Arşivle</Button>}
          />
        </div>
      ) : null}
      <FormError error={error} />
      {sendOpen && canEdit ? <SendPanel row={row} onDone={() => setSendOpen(false)} /> : null}
    </li>
  );
}

function SendPanel({ row, onDone }: { row: AnnouncementRow; onDone: () => void }) {
  const router = useRouter();
  const { push } = useToast();
  const [channel, setChannel] = useState<AnnouncementChannel>(row.delivery.sms ? "whatsapp" : "sms");
  const [audience, setAudience] = useState<AnnouncementAudience>("all");
  const [template, setTemplate] = useState("");
  const [language, setLanguage] = useState("tr");
  const [preview, setPreview] = useState<AnnouncementPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [sending, startSend] = useTransition();

  const check = (ch: AnnouncementChannel, au: AnnouncementAudience) => {
    setError(null);
    setPreview(null);
    startCheck(async () => {
      const res = await previewAnnouncementSend({ id: row.id, channel: ch, audience: au });
      if (res.error) setError(res.error);
      else setPreview(res);
    });
  };

  const send = () => {
    setError(null);
    startSend(async () => {
      const res = await sendBuildingAnnouncement({ id: row.id, channel, audience, templateName: template, templateLanguage: language });
      if (res.error) {
        setError(res.info ? `${res.error} (${res.info})` : res.error);
        return;
      }
      push(res.info ?? "Duyuru gönderildi", "ok");
      onDone();
      router.refresh();
    });
  };

  const c = preview?.counts;
  const already = Boolean(row.delivery[channel]) || preview?.alreadySent;
  return (
    <div className="space-y-3 rounded-[var(--radius-control)] border border-line bg-canvas p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Kanal" htmlFor={`ch-${row.id}`}>
          <FormSelect id={`ch-${row.id}`} value={channel} onChange={(e) => { const v = e.target.value as AnnouncementChannel; setChannel(v); setPreview(null); }}>
            <option value="sms">SMS</option>
            <option value="whatsapp">WhatsApp (onaylı şablon)</option>
          </FormSelect>
        </FormField>
        <FormField label="Kime" htmlFor={`au-${row.id}`}>
          <FormSelect id={`au-${row.id}`} value={audience} onChange={(e) => { setAudience(e.target.value as AnnouncementAudience); setPreview(null); }}>
            {ANNOUNCEMENT_AUDIENCES.map((a) => <option key={a} value={a}>{ANNOUNCEMENT_AUDIENCE_LABELS[a]}</option>)}
          </FormSelect>
        </FormField>
        {channel === "whatsapp" ? (
          <>
            <FormField label="Şablon adı" htmlFor={`tpl-${row.id}`} required hint="Meta'da onaylı, tek gövde değişkenli şablon (değişken: bina adı ve duyuru başlığı).">
              <FormInput id={`tpl-${row.id}`} value={template} onChange={(e) => setTemplate(e.target.value)} placeholder="bina_duyurusu" autoComplete="off" />
            </FormField>
            <FormField label="Şablon dili" htmlFor={`lng-${row.id}`}>
              <FormInput id={`lng-${row.id}`} value={language} onChange={(e) => setLanguage(e.target.value)} maxLength={10} />
            </FormField>
          </>
        ) : null}
      </div>

      {already ? <p className="rounded-[var(--radius-control)] bg-amber-400/15 px-3 py-2 text-sm text-amber-800">Bu duyuru bu kanaldan zaten gönderildi; her kanal bir kez gönderilir.</p> : null}

      {c ? (
        <div className="rounded-[var(--radius-control)] border border-line bg-surface p-3 text-sm" aria-live="polite">
          <p className="font-semibold text-ink-950">{c.send} sakine gönderilecek <span className="font-normal text-text-muted">(toplam {c.total} sakin)</span></p>
          <ul className="mt-1 space-y-0.5 text-xs text-text-muted">
            {c.noConsent > 0 ? <li>{c.noConsent} kişi İYS izni olmadığı için atlanacak{preview?.iysNote ? ` · ${preview.iysNote}` : ""}</li> : null}
            {c.noPhone > 0 ? <li>{c.noPhone} kişinin geçerli cep telefonu yok</li> : null}
            {c.blocked > 0 ? <li>{c.blocked} kişi engelli / örnek kayıt</li> : null}
            {c.overCap > 0 ? <li>{c.overCap} kişi tek gönderim sınırını aşıyor</li> : null}
          </ul>
          {!preview?.channelReady ? <p className="mt-2 text-xs font-semibold text-danger-600">{channel === "sms" ? "SMS sağlayıcısı yapılandırılmamış (Ayarlar → Entegrasyonlar)." : "WhatsApp entegrasyonu yok (Ayarlar → Entegrasyonlar)."}</p> : null}
          <p className="mt-2 text-xs text-text-faint">Duyuru portalda herkese görünmeye devam eder; mesaj yalnız izinli sakinlere gider.</p>
        </div>
      ) : null}

      <FormError error={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" icon={MessageSquare} loading={checking} disabled={already} onClick={() => check(channel, audience)}>Alıcıları kontrol et</Button>
        <Button type="button" size="sm" icon={Send} loading={sending} disabled={already || !c || c.send === 0 || !preview?.channelReady || (channel === "whatsapp" && !template.trim())} onClick={send}>
          {c && c.send > 0 ? `${c.send} kişiye gönder` : "Gönder"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Vazgeç</Button>
      </div>
    </div>
  );
}
