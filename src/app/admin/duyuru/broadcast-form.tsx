"use client";

import { useTransition, useState, useRef } from "react";
import { CheckCircle2, ChevronDown, Loader2, Send, Users } from "lucide-react";
import { sendBroadcast, searchTenantsBroadcast, type BroadcastTarget } from "@/app/actions/platform-notifications";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";

const TARGET_OPTIONS: { value: BroadcastTarget; label: string; hint: string }[] = [
  { value: "all", label: "Tüm ofisler", hint: "İptal edilmemiş her ofise gönderir" },
  { value: "active", label: "Aktif ofisler", hint: "Yalnızca aktif aboneliği olanlar" },
  { value: "trial", label: "Deneme ofisleri", hint: "14 günlük deneme süreci" },
  { value: "specific", label: "Belirli ofis", hint: "Ada göre arayıp tekil hedef seçin" },
];

export const KIND_OPTIONS = [
  { value: "info", label: "Bilgi", cls: "bg-brand-600/15 text-brand-600" },
  { value: "success", label: "Başarılı", cls: "bg-mint-500/15 text-mint-600" },
  { value: "warning", label: "Uyarı", cls: "bg-amber-400/15 text-amber-600" },
  { value: "danger", label: "Kritik", cls: "bg-danger-500/15 text-danger-500" },
  { value: "system", label: "Sistem", cls: "bg-cyan-400/15 text-cyan-600" },
];

const field =
  "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400";

export type AudienceCounts = { all: number; active: number; trial: number };

/**
 * Duyuru formu. Hedef kitle sayıları sunucu sayfasında ÖNCEDEN hesaplanıp
 * props ile gelir — audience değişince ek istek atılmaz, sayı anında görünür.
 */
export function BroadcastForm({
  audienceCounts,
  tenantOptions,
}: {
  audienceCounts: AudienceCounts;
  tenantOptions: ComboboxOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<BroadcastTarget>("all");
  const [kind, setKind] = useState("info");
  const [result, setResult] = useState<{ ok?: boolean; error?: string; sent?: number } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setResult(null);
    startTransition(async () => {
      const res = await sendBroadcast(fd);
      setResult(res);
      if (res.ok) formRef.current?.reset();
    });
  }

  const selectedTarget = TARGET_OPTIONS.find((t) => t.value === target);
  const audienceCount =
    target === "all" ? audienceCounts.all : target === "active" ? audienceCounts.active : target === "trial" ? audienceCounts.trial : null;

  return (
    <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-6">
      <div className="flex items-center gap-2 border-b border-line pb-4">
        <Send className="h-4 w-4 text-brand-600" />
        <h2 className="font-display font-bold text-ink-950">Duyuru oluştur</h2>
      </div>

      <form ref={formRef} onSubmit={submit} className="mt-5 grid gap-4">
        {/* Başlık */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="bc-title">
            Başlık <span className="text-danger-500">*</span>
          </label>
          <input
            id="bc-title"
            name="title"
            required
            maxLength={120}
            className={field}
            placeholder="Örn: Yeni özellik yayında — portallar güncellendi"
          />
        </div>

        {/* Mesaj */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="bc-body">
            Mesaj (opsiyonel)
          </label>
          <textarea
            id="bc-body"
            name="body"
            rows={3}
            className={`${field} resize-none`}
            placeholder="Detay, link veya açıklama ekleyebilirsiniz…"
          />
        </div>

        {/* Bağlantı */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="bc-href">
            Bağlantı (opsiyonel)
          </label>
          <input
            id="bc-href"
            name="href"
            className={field}
            placeholder="https:// veya /app/... ile başlayan URL"
          />
        </div>

        {/* Tür */}
        <div>
          <p className="mb-2 text-sm font-medium text-ink-950">Bildirim türü</p>
          <div className="flex flex-wrap gap-2">
            {KIND_OPTIONS.map((k) => (
              <label key={k.value} className="cursor-pointer">
                <input
                  type="radio"
                  name="kind"
                  value={k.value}
                  checked={kind === k.value}
                  onChange={() => setKind(k.value)}
                  className="sr-only"
                />
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold ring-2 transition ${
                    kind === k.value
                      ? `${k.cls} ring-current`
                      : "bg-canvas text-text-muted ring-transparent hover:ring-line"
                  }`}
                >
                  {k.label}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Hedef */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="bc-target">
            Hedef kitle
          </label>
          <div className="relative">
            <select
              id="bc-target"
              name="target"
              value={target}
              onChange={(e) => setTarget(e.target.value as BroadcastTarget)}
              className={`${field} appearance-none pr-9`}
            >
              {TARGET_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label} — {t.hint}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          </div>
          {/* Gönderim ÖNCESİ kaç ofise ulaşacağı — sayı sunucudan geldi */}
          {audienceCount !== null ? (
            <p className="mt-2 flex items-center gap-1.5 rounded-[10px] bg-brand-600/[0.06] px-3 py-2 text-xs font-semibold text-brand-700">
              <Users className="h-3.5 w-3.5" />
              {selectedTarget?.label}: {audienceCount} ofis
            </p>
          ) : null}
        </div>

        {/* Belirli ofis — UUID yerine aranabilir seçim */}
        {target === "specific" ? (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="bc-tenant">
              Ofis <span className="text-danger-500">*</span>
            </label>
            <Combobox
              id="bc-tenant"
              name="tenant_id"
              required
              clearable={false}
              options={tenantOptions}
              onSearch={searchTenantsBroadcast}
              placeholder="Ofis ara ve seçin"
              searchPlaceholder="Ofis adı yazın…"
              emptyText="Eşleşen ofis yok"
            />
          </div>
        ) : null}

        {/* Hata / sonuç */}
        {result?.error ? (
          <p className="rounded-[10px] bg-danger-500/8 px-3 py-2 text-sm text-danger-500" role="alert">
            {result.error}
          </p>
        ) : null}
        {result?.ok ? (
          <p className="flex items-center gap-2 rounded-[10px] bg-mint-500/10 px-3 py-2 text-sm font-semibold text-mint-600" role="status">
            <CheckCircle2 className="h-4 w-4" /> {result.sent} ofise duyuru iletildi.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="btn-shine mt-1 inline-flex items-center gap-2 rounded-[11px] bg-ink-950 px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {pending ? "Gönderiliyor…" : "Duyuruyu gönder"}
        </button>
      </form>
    </section>
  );
}
