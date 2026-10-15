"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowUpRight, Loader2, Zap } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { createTask } from "@/app/actions/tasks";
import { useToast } from "@/components/app/toast-provider";
import { Input } from "@/components/ui/input";
import { noteLocalMutation } from "@/lib/realtime";

/** Listenin üstünde vurgulanan son hızlı görevler (sayfa ömrü; en yenisi üstte). */
const RECENT_MAX = 3;

type Recent = { key: string; title: string; id: string | null };

/**
 * Tek satır "hızlı görev": başlığı yaz, Enter — varsayılanlarla (Takip, normal, bana atanır) eklenir.
 * B052: vadesiz görev "Açık" listesinde sayfanın sonuna (Tarihsiz şeridi) düşüyor ve eklenen görev görünmüyordu.
 * Görev Enter'a basılır basılmaz (sunucu turunu beklemeden) listenin ÜSTÜNDE vurgulu satır olarak görünür; kayıt
 * gelince "Görevi aç" bağlantısı kaydın kendisini açar (`/app/gorevler?gorev=<id>`). Hata olursa satır kalkar,
 * başlık alana geri gelir.
 * Tekilleştirme: sunucu listesi tazelenip aynı kimlikli görev listede çizildiğinde iyimser satır gizlenir (iki kez
 * görünmez); listedeki kart bir kez kısa süre vurgulanır. `listedIds`: sayfanın bu turda çizdiği görev kimlikleri.
 */
export function QuickTask({ listedIds = [] }: { listedIds?: readonly string[] }) {
  const { push } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [pending, startTransition] = useTransition();
  const seq = useRef(0);
  const listedKey = listedIds.join(",");
  const listed = useMemo(() => new Set(listedKey ? listedKey.split(",") : []), [listedKey]);
  // Sunucu satırı gelen iyimser satır çizilmez (kayıt listede görünür; ikinci kopya ve kalıcı vurgu olmaz).
  const shown = recent.filter((r) => !r.id || !listed.has(r.id));
  const flashed = useRef(new Set<string>());
  useEffect(() => {
    // Listeye düşen yeni görevin kartı bir kez vurgulanır (DOM sınıfı; React durumu değişmez). Zamanlayıcı effect
    // yeniden koşunca iptal EDİLMEZ (aksi halde vurgu kalıcı kalırdı); ayrılmış öğeden sınıf silmek zararsızdır.
    for (const r of recent) {
      if (!r.id || !listed.has(r.id) || flashed.current.has(r.id)) continue;
      flashed.current.add(r.id);
      const el = document.querySelector<HTMLElement>(`[data-task-id="${r.id}"]`);
      if (!el || el.getAttribute("aria-current") === "true") continue;
      el.classList.add("ring-2", "ring-brand-300");
      window.setTimeout(() => el.classList.remove("ring-2", "ring-brand-300"), 2400);
    }
  }, [recent, listed]);

  const restore = (title: string, message: string) => {
    if (inputRef.current && !inputRef.current.value) inputRef.current.value = title;
    setError(message);
    push(message, "err");
  };

  const action = (formData: FormData) => {
    const title = String(formData.get("title") ?? "").trim();
    if (!title) return;
    // Anında geri bildirim: alan hemen boşalır, görev listenin üstünde iyimser satır olarak belirir.
    if (inputRef.current) inputRef.current.value = "";
    setError(null);
    seq.current += 1;
    const key = `q${seq.current}`;
    setRecent((prev) => [{ key, title, id: null }, ...prev].slice(0, RECENT_MAX));
    // Bu sekmenin yazımı: ofis konusundan dönen yankı ikinci tazeleme üretmez (diğer cihazlar görür).
    noteLocalMutation(["tasks"]);
    startTransition(async () => {
      try {
        const res = await createTask({}, formData);
        if (res.ok) {
          // createTask zaten revalidatePath("/app/gorevler") yapıyor: action yanıtı taze listeyi getirir.
          setRecent((prev) => prev.map((r) => (r.key === key ? { ...r, id: res.id ?? null } : r)));
          push("Görev eklendi", "ok");
          return;
        }
        setRecent((prev) => prev.filter((r) => r.key !== key));
        restore(title, res.error ?? "Görev eklenemedi.");
      } catch {
        setRecent((prev) => prev.filter((r) => r.key !== key));
        restore(title, "Görev eklenemedi. Lütfen tekrar deneyin.");
      }
    });
  };

  return (
    <div className="space-y-2">
      <form action={action} className="space-y-1">
        <div className="relative">
          <Zap className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <Input
            ref={inputRef}
            name="title"
            aria-label="Hızlı görev"
            placeholder="Hızlı görev: başlığı yazıp Enter'a basın…"
            autoComplete="off"
            className="pl-9"
          />
          <input type="hidden" name="kind" value="followup" />
          <input type="hidden" name="priority" value="normal" />
        </div>
        {error ? <p className="text-xs font-medium text-danger-600" role="alert">{error}</p> : null}
      </form>

      {shown.length > 0 ? (
        <ul aria-label="Az önce eklenen görevler" aria-live="polite" className="space-y-1.5">
          {shown.map((r, i) => (
            <li
              key={r.key}
              className={`flex items-center gap-2.5 rounded-[var(--radius-card)] border border-brand-400/40 bg-brand-600/8 px-3 py-2 ${i === 0 ? "ring-2 ring-brand-300" : ""}`}
            >
              {r.id ? (
                <Zap className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
              ) : (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-600" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-950">{r.title}</span>
              <span className="rounded-full bg-brand-600/12 px-2 py-0.5 text-xs font-bold text-brand-700">
                {r.id ? "Yeni · Takip" : "Ekleniyor"}
              </span>
              {r.id ? (
                <Link
                  href={`/app/gorevler?gorev=${r.id}`}
                  className="focus-ring inline-flex h-8 items-center gap-1 rounded-[var(--radius-control)] px-2 text-xs font-semibold text-brand-700 hover:bg-brand-600/10 touch:h-11"
                >
                  Görevi aç
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {pending ? <span className="sr-only">Görev kaydediliyor</span> : null}
    </div>
  );
}
