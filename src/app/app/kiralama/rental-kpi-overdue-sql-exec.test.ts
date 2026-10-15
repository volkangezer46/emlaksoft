import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { periodCollection } from "./collection-math";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261016060200_rental_kpi_overdue (SK6/B107).
 * Bu ayın 'overdue' tahakkuklarının kalanı period_overdue'ya girer, period_total tahakkuk toplamıdır;
 * oran tahsil / tahakkuk (322.000 / 137.300 → %43), eski tahsil / (tahsil + bekleyen) (%78) değil.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create table public.rentals(id uuid primary key default gen_random_uuid(), status text not null default 'active');
create table public.rent_charges(id uuid primary key default gen_random_uuid(), rental_id uuid not null, period date not null,
  amount numeric not null, paid_amount numeric, status text not null);
`;

describe.skipIf(!mod)("rental_kpi_snapshot period_overdue/period_total (pglite)", () => {
  let db: Db;
  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20261016060200_rental_kpi_overdue.sql").replace(/set local lock_timeout[^;]*;/g, ""));
    const r = (await db.query(`insert into public.rentals(status) values ('active'),('active'),('active'),('active') returning id`)).rows.map(
      (x) => String(x.id),
    );
    // Ekim 2026: 322.000 tahakkuk; 137.300 tahsil (biri kısmi), 38.000 bekleyen, 146.700 gecikmiş kalan.
    await db.query(
      `insert into public.rent_charges(rental_id, period, amount, paid_amount, status) values
        ($1, '2026-10-01', 120000, 120000, 'paid'),
        ($2, '2026-10-01', 55300, 17300, 'partial'),
        ($3, '2026-10-01', 146700, 0, 'overdue'),
        ($4, '2026-09-01', 30000, 0, 'overdue')`,
      r,
    );
  });

  it("322.000 tahakkuk / 137.300 tahsil → %43; gecikmiş kalan ayrı anahtar", async () => {
    const snap = (await db.query(`select public.rental_kpi_snapshot('2026-10-01'::date) as s`)).rows[0].s as Record<string, number>;
    expect(Number(snap.period_total)).toBe(322_000);
    expect(Number(snap.period_paid)).toBe(137_300);
    expect(Number(snap.period_pending)).toBe(38_000);
    expect(Number(snap.period_overdue)).toBe(146_700);
    // Tüm dönemlerin gecikmiş kalanı (önceki ay dahil) eski anlamını korur.
    expect(Number(snap.overdue_sum)).toBe(176_700);
    const c = periodCollection({
      paid: Number(snap.period_paid),
      pending: Number(snap.period_pending),
      overdue: Number(snap.period_overdue),
      total: Number(snap.period_total),
    });
    expect(c.rate).toBe(43);
  });
});
