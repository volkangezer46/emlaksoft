"use client";

import { useTransition, useState, useRef } from "react";
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Megaphone,
  Send,
} from "lucide-react";
import { sendBroadcast, type BroadcastTarget } from "@/app/actions/platform-notifications";

const TARGET_OPTIONS: { value: BroadcastTarget; label: string; hint: string }[] = [
  { value: "all", label: "Tüm ofisler", hint: "İptal edilmemiş her ofise gönderir" },
  { value: "active", label: "Aktif ofisler", hint: "Yalnızca aktif aboneliği olanlar" },
  { value: "trial", label: "Deneme ofisleri", hint: "14 günlük deneme süreci" },
  { value: "specific", label: "Belirli ofis", hint: "Ofis ID ile tekil hedef" },
];

const KIND_OPTIONS = [
  { value: "info", label: "Bilgi", cls: "bg-brand-600/15 text-brand-600" },
  { value: "success", label: "Başarılı", cls: "bg-mint-500/15 text-mint-600" },
  { value: "warning", label: "Uyarı", cls: "bg-amber-400/15 text-amber-600" },
  { value: "danger", label: "Kritik", cls: "bg-danger-500/15 text-danger-500" },
  { value: "system", label: "Sistem", cls: "bg-cyan-400/15 text-cyan-600" },
];

const field =
  "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400";

export default function BroadcastPage() {
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

  return (
    <div className="space-y-6">
      {/* Başlık */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-amber-400/20 blur-[90px]" />
        <div className="relative">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300">
            <Megaphone className="h-3.5 w-3.5" /> Toplu duyuru
          </p>
          <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">
            Ofislere duyuru gönder
          </h1>
          <p className="mt-1.5 max-w-lg text-sm text-white/60">
            Seçilen ofislerin bildirim kutusuna anlık mesaj iletir. Kullanıcılar ofis panelinden görür.
          </p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        {/* Form */}
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
            </div>

            {/* Belirli ofis ID */}
            {target === "specific" ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="bc-tenant">
                  Ofis ID <span className="text-danger-500">*</span>
                </label>
                <input
                  id="bc-tenant"
                  name="tenant_id"
                  required
                  className={field}
                  placeholder="UUID formatında ofis kimliği"
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

        {/* Bilgi paneli */}
        <aside className="space-y-4">
          <section className="rounded-[18px] border border-line bg-surface p-5">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-brand-600" />
              <h3 className="font-display font-bold text-ink-950">Nasıl çalışır?</h3>
            </div>
            <ul className="mt-4 space-y-3 text-sm text-text-muted">
              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-[10px] font-bold text-brand-600">1</span>
                Duyuru, seçilen ofisin <strong className="text-ink-950">tüm kullanıcılarına</strong> görünür.
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-[10px] font-bold text-brand-600">2</span>
                Ofis paneli topbar zili anında güncellenir; kullanıcı sayfayı yenilediğinde görür.
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-[10px] font-bold text-brand-600">3</span>
                Bağlantı alanı doluysa bildirime tıklanınca ilgili sayfaya yönlendirir.
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-[10px] font-bold text-brand-600">4</span>
                Gönderim geri alınamaz; dikkatlice doldurun.
              </li>
            </ul>
          </section>

          <section className="rounded-[18px] border border-line bg-surface p-5">
            <h3 className="font-display font-bold text-ink-950">Tür rehberi</h3>
            <div className="mt-3 space-y-2">
              {KIND_OPTIONS.map((k) => (
                <div key={k.value} className="flex items-center gap-3">
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${k.cls}`}>{k.label}</span>
                  <span className="text-xs text-text-muted">
                    {k.value === "info" && "Yeni özellik, duyuru, genel bilgi"}
                    {k.value === "success" && "Başarılı güncelleme, plan yükseltme"}
                    {k.value === "warning" && "Bakım, geçici kısıtlama, dikkat"}
                    {k.value === "danger" && "Kritik kesinti, acil müdahale"}
                    {k.value === "system" && "Otomatik sistem mesajı"}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <div className="rounded-[14px] border border-amber-400/30 bg-amber-400/8 px-4 py-3 text-xs text-amber-700">
            <strong>Yetki:</strong> Yalnızca Süper admin ve Operasyon rolü duyuru gönderebilir.
          </div>
        </aside>
      </div>
    </div>
  );
}
