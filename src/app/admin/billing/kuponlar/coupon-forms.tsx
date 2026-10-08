"use client";

import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCoupon, deleteCoupon, setCouponActive, updateCoupon, type CouponOpResult } from "@/app/actions/platform-coupons";
import { InlineOp, opFieldClass } from "../inline-op";

export type CouponRow = {
  id: string;
  code: string;
  description: string | null;
  kind: "percent" | "amount";
  value: number;
  max_redemptions: number | null;
  redeemed_count: number;
  valid_from: string | null;
  valid_until: string | null;
  plan_ids: string[];
  is_active: boolean;
};

type PlanOpt = { id: string; name: string };
const lbl = "block text-xs font-semibold text-text-muted";
const dayOf = (v: string | null) => (v ? v.slice(0, 10) : "");

function CouponForm({ plans, coupon, onDone }: { plans: PlanOpt[]; coupon?: CouponRow; onDone?: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const editing = Boolean(coupon);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const form = e.currentTarget;
        const fd = new FormData(form);
        fd.set("plan_ids", fd.getAll("plan").join(","));
        fd.delete("plan");
        if (coupon) fd.set("id", coupon.id);
        start(async () => {
          const r: CouponOpResult = await (editing ? updateCoupon(fd) : createCoupon(fd));
          setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.notice ?? "Kaydedildi." });
          if (!r.error) {
            if (!editing) form.reset();
            router.refresh();
            onDone?.();
          }
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <label className={lbl}>Kod<input name="code" required minLength={3} maxLength={32} defaultValue={coupon?.code} readOnly={editing} placeholder="YAZ25" className={`mt-1 w-full uppercase ${opFieldClass}`} /></label>
        <label className={lbl}>
          Tür
          <select name="kind" defaultValue={coupon?.kind ?? "percent"} disabled={editing} className={`mt-1 w-full ${opFieldClass}`}>
            <option value="percent">Yüzde (%)</option>
            <option value="amount">Tutar (TRY)</option>
          </select>
          {editing ? <input type="hidden" name="kind" value={coupon!.kind} /> : null}
        </label>
        <label className={lbl}>Değer<input name="value" required inputMode="decimal" defaultValue={coupon?.value} readOnly={editing} className={`mt-1 w-full ${opFieldClass}`} /></label>
        <label className={lbl}>Kullanım sınırı<input name="max_redemptions" inputMode="numeric" defaultValue={coupon?.max_redemptions ?? ""} placeholder="sınırsız" className={`mt-1 w-full ${opFieldClass}`} /></label>
        <label className={lbl}>Başlangıç<input name="valid_from" type="date" defaultValue={dayOf(coupon?.valid_from ?? null)} className={`mt-1 w-full ${opFieldClass}`} /></label>
        <label className={lbl}>Bitiş<input name="valid_until" type="date" defaultValue={dayOf(coupon?.valid_until ?? null)} className={`mt-1 w-full ${opFieldClass}`} /></label>
        <label className={`${lbl} sm:col-span-2`}>Açıklama<input name="description" maxLength={200} defaultValue={coupon?.description ?? ""} className={`mt-1 w-full ${opFieldClass}`} /></label>
      </div>
      <fieldset className="flex flex-wrap items-center gap-3 text-xs font-semibold text-text-muted">
        <legend className="mb-1 text-xs font-bold uppercase tracking-wide text-text-faint">Geçerli paketler (boş = tümü)</legend>
        {plans.map((p) => (
          <label key={p.id} className="inline-flex items-center gap-1.5">
            <input type="checkbox" name="plan" value={p.id} defaultChecked={coupon?.plan_ids.includes(p.id)} /> {p.name}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="navy" size="sm" type="submit" disabled={pending}>
          {pending ? "Kaydediliyor…" : editing ? "Güncelle" : "Kuponu oluştur"}
        </Button>
        {msg ? <span role={msg.ok ? "status" : "alert"} className={`text-xs font-semibold ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>{msg.text}</span> : null}
      </div>
    </form>
  );
}

export function NewCoupon({ plans }: { plans: PlanOpt[] }) {
  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <h2 className="mb-3 font-display font-bold text-ink-950">Yeni kupon</h2>
      <CouponForm plans={plans} />
    </section>
  );
}

export function CouponRowView({ coupon, plans, isSuperAdmin }: { coupon: CouponRow; plans: PlanOpt[]; isSuperAdmin: boolean }) {
  const [editing, setEditing] = useState(false);
  const tl = (n: number) => `${n.toLocaleString("tr-TR")} ₺`;
  return (
    <div className="space-y-3 px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-mono text-sm font-bold text-ink-950">{coupon.code}</span>
        <span className="text-sm text-text-muted">{coupon.kind === "percent" ? `%${coupon.value}` : tl(coupon.value)} indirim</span>
        <span className="text-xs text-text-faint">
          Kullanım: {coupon.redeemed_count}
          {coupon.max_redemptions ? ` / ${coupon.max_redemptions}` : ""}
        </span>
        <span className="text-xs text-text-faint">{coupon.plan_ids.length ? coupon.plan_ids.join(", ") : "Tüm paketler"}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${coupon.is_active ? "bg-mint-500/10 text-mint-700" : "bg-line text-text-muted"}`}>
          {coupon.is_active ? "Etkin" : "Devre dışı"}
        </span>
        {coupon.description ? <span className="text-xs text-text-muted">{coupon.description}</span> : null}
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <Button variant="outline" size="sm" type="button" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
          {editing ? "Düzenlemeyi kapat" : "Düzenle"}
        </Button>
        <InlineOp
          label={coupon.is_active ? "Devre dışı bırak" : "Etkinleştir"}
          confirmLabel="Onayla"
          hidden={{ id: coupon.id, active: coupon.is_active ? "0" : "1" }}
          action={setCouponActive}
        />
        {isSuperAdmin && coupon.redeemed_count === 0 ? (
          <InlineOp label="Sil" confirmLabel="Kalıcı sil" tone="danger" hidden={{ id: coupon.id }} action={deleteCoupon} hint="Kullanılmamış kupon kalıcı silinir." />
        ) : null}
      </div>
      {editing ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3">
          <CouponForm plans={plans} coupon={coupon} onDone={() => setEditing(false)} />
        </div>
      ) : null}
    </div>
  );
}
