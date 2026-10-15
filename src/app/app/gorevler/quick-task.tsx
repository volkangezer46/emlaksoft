"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowUpRight, CalendarClock, Loader2, Phone, UserRound, X, Zap } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { createTask } from "@/app/actions/tasks";
import { searchCustomers } from "@/app/actions/lookup";
import { now, toTrLocalInput } from "@/lib/clock";
import { parseQuickTask } from "@/lib/quick-task-parse";
import { useToast } from "@/components/app/toast-provider";
import { Input } from "@/components/ui/input";
import { FilterChip } from "@/components/ui/filter-chip";
import { noteLocalMutation } from "@/lib/realtime";

/** Listenin üstünde vurgulanan son hızlı görevler (sayfa ömrü; en yenisi üstte). */
const RECENT_MAX = 3;

type Recent = { key: string; title: string; id: string | null; badge: string };
type CustomerHit = { id: string; label: string };


/**
 * Tek satır "hızlı görev": başlığı yaz, Enter — varsayılanlarla (Takip, normal, bana atanır) eklenir.
 * B052: vadesiz görev "Açık" listesinde sayfanın sonuna (Tarihsiz şeridi) düşüyor ve eklenen görev görünmüyordu.
 * Görev Enter'a basılır basılmaz (sunucu turunu beklemeden) listenin ÜSTÜNDE vurgulu satır olarak görünür; kayıt
 * gelince "Görevi aç" bağlantısı kaydın kendisini açar (`/app/gorevler?gorev=<id>`). Hata olursa satır kalkar,
 * başlık alana geri gelir.
 * Tekilleştirme: sunucu listesi tazelenip aynı kimlikli görev listede çizildiğinde iyimser satır gizlenir (iki kez
 * görünmez); listedeki kart bir kez kısa süre vurgulanır. `listedIds`: sayfanın bu turda çizdiği görev kimlikleri.
 * GA-04 Türkçe doğal dil: "yarın 10'da Ahmet'i ara" yazarken önizleme çipleri belirir — vade ("Yarın 10:00"), arama
 * görevi ve eşleşen müşteri. Her çip tek dokunuşla kaldırılır (yanlış ayrıştırmaya karşı); Enter vade/tür/müşteriyle kaydeder.
 */
export function QuickTask({ listedIds = [] }: { listedIds?: readonly string[] }) {
  const { push } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [pending, startTransition] = useTransition();
  const seq = useRef(0);
  const [text, setText] = useState("");
  const [parsedAt, setParsedAt] = useState(0);
  const [dropDue, setDropDue] = useState(false);
  const [dropKind, setDropKind] = useState(false);
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [dropCustomer, setDropCustomer] = useState(false);
  const parsed = useMemo(() => (text.trim() && parsedAt ? parseQuickTask(text, parsedAt) : null), [text, parsedAt]);
  const hint = parsed?.personHint ?? null;
  const dueOn = Boolean(parsed?.dueIso) && !dropDue;
  const callOn = parsed?.kind === "call" && !dropKind;
  const chosen = !hint || dropCustomer ? null : (customer ?? (hits.length === 1 ? hits[0]! : null));

  // Kişi ipucu → müşteri araması (gecikmeli; aynı kapsam kuralı, yetki sunucuda).
  useEffect(() => {
    if (!hint) return;
    let alive = true;
    const t = window.setTimeout(async () => {
      try {
        const res = await searchCustomers(hint);
        if (!alive) return;
        const next = res.slice(0, 3).map((o) => ({ id: o.value, label: o.label }));
        setHits(next);
        setCustomer((c) => (c && next.some((h) => h.id === c.id) ? c : null));
      } catch {
        if (alive) setHits([]);
      }
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [hint]);

  const resetDraft = () => {
    setText("");
    setDropDue(false);
    setDropKind(false);
    setDropCustomer(false);
    setCustomer(null);
    setHits([]);
  };
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

  const restore = (raw: string, message: string) => {
    setText((cur) => (cur ? cur : raw));
    setError(message);
    push(message, "err");
  };

  const action = (formData: FormData) => {
    const raw = String(formData.get("title") ?? "").trim();
    if (!raw) return;
    // Önizleme çipleri ne gösteriyorsa o kaydedilir: vade çipi kaldırıldıysa ham metin başlık olur.
    const p = parseQuickTask(raw, now());
    const useDue = Boolean(p.dueIso) && !dropDue;
    const title = useDue ? p.title : raw;
    const kind = p.kind === "call" && !dropKind ? "call" : "followup";
    formData.set("title", title);
    formData.set("kind", kind);
    if (useDue && p.dueIso) formData.set("due_at", toTrLocalInput(p.dueIso));
    if (chosen) formData.set("customer_id", chosen.id);
    const badge = [kind === "call" ? "Arama" : "Takip", useDue ? p.dueLabel : null].filter(Boolean).join(" · ");
    // Anında geri bildirim: alan hemen boşalır, görev listenin üstünde iyimser satır olarak belirir.
    resetDraft();
    setError(null);
    seq.current += 1;
    const key = `q${seq.current}`;
    setRecent((prev) => [{ key, title, id: null, badge }, ...prev].slice(0, RECENT_MAX));
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
        restore(raw, res.error ?? "Görev eklenemedi.");
      } catch {
        setRecent((prev) => prev.filter((r) => r.key !== key));
        restore(raw, "Görev eklenemedi. Lütfen tekrar deneyin.");
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
            aria-describedby="quick-task-preview"
            placeholder="Hızlı görev: örn. yarın 10'da Ahmet'i ara — Enter"
            autoComplete="off"
            enterKeyHint="done"
            value={text}
            onChange={(e) => {
              const v = e.target.value;
              setText(v);
              setParsedAt(now());
              if (!v.trim()) resetDraft();
            }}
            className="pl-9"
          />
          <input type="hidden" name="priority" value="normal" />
        </div>
        {parsed && (parsed.dueIso || parsed.kind || hint) ? (
          <div id="quick-task-preview" className="flex flex-wrap items-center gap-1.5" aria-live="polite">
            {parsed.dueIso ? (
              <FilterChip
                active={dueOn}
                onClick={() => setDropDue((d) => !d)}
                title={dueOn ? "Vadeyi kaldır" : "Vadeyi geri ekle"}
                className={dueOn ? "" : "line-through"}
              >
                <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                {parsed.dueLabel}
                {parsed.assumed ? <span className="font-normal">(varsayılan)</span> : null}
                {dueOn ? <X className="h-3 w-3" aria-hidden /> : null}
              </FilterChip>
            ) : null}
            {parsed.kind === "call" ? (
              <FilterChip
                active={callOn}
                onClick={() => setDropKind((d) => !d)}
                title={callOn ? "Takip görevi yap" : "Arama görevi yap"}
                className={callOn ? "" : "line-through"}
              >
                <Phone className="h-3.5 w-3.5" aria-hidden /> Arama görevi
                {callOn ? <X className="h-3 w-3" aria-hidden /> : null}
              </FilterChip>
            ) : null}
            {hint && !dropCustomer
              ? (chosen ? [chosen] : hits).map((h) => (
                  <FilterChip
                    key={h.id}
                    active={chosen?.id === h.id}
                    onClick={() => (chosen ? setDropCustomer(true) : setCustomer(h))}
                    title={chosen ? "Müşteri bağını kaldır" : "Bu müşteriye bağla"}
                    className={chosen ? "" : "border-dashed"}
                  >
                    <UserRound className="h-3.5 w-3.5" aria-hidden />
                    {chosen ? `Müşteri: ${h.label}` : `${h.label}?`}
                    {chosen ? <X className="h-3 w-3" aria-hidden /> : null}
                  </FilterChip>
                ))
              : null}
          </div>
        ) : null}
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
                {r.id ? `Yeni · ${r.badge}` : "Ekleniyor"}
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
