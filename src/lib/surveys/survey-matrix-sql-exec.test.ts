import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ: anket genişletmesi (20261007000400, PB49) gerçek PL/pgSQL ile (pglite, bellek içi Postgres).
 * Gerçek dosyalar: 20260825000700_survey_module.sql + 20261007000400_survey_matrix_channels.sql (+ rollback).
 * tenants/profiles/teams/tasks/izin fonksiyonları SADELEŞTİRİLMİŞ taklittir; RLS rolleri DENENMEZ (pglite süper
 * kullanıcıyla koşar) — burada DEFINER RPC'lerin ve guard tetikleyicisinin davranışı sınanır.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'anon') $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.tenant', true),'')::uuid $$;
create function public.current_profile_role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.prole', true),''),'advisor') $$;
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$ select true $$;
create table public.tenants(id uuid primary key default gen_random_uuid(), name text default 'Ofis');
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id), role text not null default 'advisor', is_active boolean not null default true, full_name text, team_id uuid);
create table public.teams(id uuid primary key default gen_random_uuid(), tenant_id uuid, lead_user_id uuid, is_active boolean not null default true);
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid);
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid);
create table public.deals(id uuid primary key default gen_random_uuid(), tenant_id uuid);
create table public.tasks(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text, status text not null default 'open', assigned_to uuid, completed_at timestamptz);
create table public.permission_defaults(role text, module text, action text, primary key (role, module, action));
`;

describe.skipIf(!mod)("Anket genişletmesi SQL (PB49) — gerçek PL/pgSQL (pglite)", () => {
  let db: Db;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  type Res = Record<string, unknown> & { err?: string; code?: string };
  const call = async (sql: string, params?: unknown[]): Promise<Res> => {
    try {
      const row = (await q(sql, params))[0];
      return (row ? Object.values(row)[0] : undefined) as Res;
    } catch (e) {
      const err = e as { message: string; code?: string };
      return { err: err.message, code: err.code };
    }
  };
  const as = (role: string, sub = "", tenant = "", prole = "advisor") =>
    db.exec(
      `select set_config('request.jwt.claim.role','${role}',false), set_config('request.jwt.claim.sub','${sub}',false), set_config('request.jwt.claim.tenant','${tenant}',false), set_config('request.jwt.claim.prole','${prole}',false)`,
    );

  let T = "";
  const P: Record<string, string> = {};
  let pulseTpl = "";
  const pulseQ: Record<string, string> = {};

  async function lowTask(agent: string, followupAssignee: string): Promise<{ id: string; followup: string }> {
    await as("service_role");
    const followup = (await q(`insert into public.tasks(tenant_id, title, assigned_to) values ($1,'Geri arama',$2) returning id`, [T, followupAssignee]))[0]!.id as string;
    const id = (
      await q(
        `insert into public.survey_tasks(tenant_id, event_type, audience, event_key, status, score, agent_id, completed_at, followup_task_id)
         values ($1,'deal_won','buyer', 'k-' || gen_random_uuid(), 'completed', 3, $2, now() - interval '30 hours', $3) returning id`,
        [T, agent, followup],
      )
    )[0]!.id as string;
    return { id, followup };
  }

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20260825000700_survey_module.sql"));
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    for (const [k, role] of [["owner", "owner"], ["agent", "advisor"], ["lead", "team_lead"], ["other", "advisor"], ["surveyor", "call_center"]] as const) {
      P[k] = (await q(`insert into public.profiles(tenant_id, role, full_name) values ($1,$2,$3) returning id`, [T, role, k]))[0]!.id as string;
    }
    const team = (await q(`insert into public.teams(tenant_id, lead_user_id) values ($1,$2) returning id`, [T, P.lead]))[0]!.id as string;
    await q(`update public.profiles set team_id = $1 where id = $2`, [team, P.agent]);
    // 000400 öncesi mevcut şablon (veri adımı: 1-10 metni ve danışman puanı sorusu eklenmesi sınanır).
    const tpl = (await q(`insert into public.survey_templates(tenant_id, event_type, audience, name) values ($1,'deal_won','buyer','Alıcı') returning id`, [T]))[0]!.id as string;
    await q(`insert into public.survey_questions(tenant_id, template_id, position, kind, label, required, tag) values ($1,$2,0,'score','Hizmetimizi 1-10 arası puanlar mısınız?',true,'primary')`, [T, tpl]);
    await db.exec(read("supabase/migrations/20261007000400_survey_matrix_channels.sql"));
  }, 90_000);

  it("veri adımı: 1-10 metni 0-10 olur, kapanış şablonuna danışman puanı sorusu eklenir (idempotent)", async () => {
    const labels = (await q(`select label, tag from public.survey_questions order by position`)).map((r) => [r.label, r.tag]);
    expect(labels).toEqual([
      ["Hizmetimizi 0-10 arası puanlar mısınız?", "primary"],
      ["Danışmanınızı 0-10 arası puanlar mısınız?", "advisor"],
    ]);
  });

  it("yeni olay/kitle CHECK'e girer, tanımsız değer reddedilir", async () => {
    await as("service_role");
    expect(await call(`insert into public.survey_tasks(tenant_id, event_type, audience, event_key) values ($1,'rent_renewal','tenant','rr-1') returning true`, [T])).toBe(true);
    expect(await call(`insert into public.survey_tasks(tenant_id, event_type, audience, event_key) values ($1,'advisor_pulse','advisor','ap-1') returning true`, [T])).toBe(true);
    expect((await call(`insert into public.survey_tasks(tenant_id, event_type, audience, event_key) values ($1,'yok','tenant','x-1') returning true`, [T])).code).toBe("23514");
  });

  it("düşük puan kapanışı: not zorunlu, ilgisiz kişi kapatamaz, danışman kapatır ve takip görevi tamamlanır", async () => {
    const t = await lowTask(P.agent!, P.agent!);
    await as("authenticated", P.other!, T);
    expect(await call(`select public.survey_close_low_score($1,$2)`, [t.id, "Müşteri arandı, özür dilendi."])).toMatchObject({ ok: false, code: "forbidden" });
    await as("authenticated", P.agent!, T);
    expect(await call(`select public.survey_close_low_score($1,$2)`, [t.id, "kısa"])).toMatchObject({ ok: false, code: "note_required" });
    expect(await call(`select public.survey_close_low_score($1,$2)`, [t.id, "Müşteri arandı, özür dilendi."])).toMatchObject({ ok: true });
    const row = (await q(`select low_score_handled, low_score_note, low_score_handled_by from public.survey_tasks where id=$1`, [t.id]))[0]!;
    expect(row).toMatchObject({ low_score_handled: true, low_score_note: "Müşteri arandı, özür dilendi.", low_score_handled_by: P.agent });
    expect((await q(`select status from public.tasks where id=$1`, [t.followup]))[0]!.status).toBe("done");
    expect(await call(`select public.survey_close_low_score($1,$2)`, [t.id, "Tekrar kapatma denemesi."])).toMatchObject({ ok: false, code: "already" });
  });

  it("takım lideri (takım modeli) ve takip görevinin atananı kapatabilir; başka ofis göremez", async () => {
    const a = await lowTask(P.agent!, P.owner!);
    await as("authenticated", P.lead!, T, "team_lead");
    expect(await call(`select public.survey_close_low_score($1,$2)`, [a.id, "Lider aradı, randevu verildi."])).toMatchObject({ ok: true });
    const b = await lowTask(P.other!, P.surveyor!);
    await as("authenticated", P.surveyor!, T, "call_center");
    expect(await call(`select public.survey_close_low_score($1,$2)`, [b.id, "Takip görevi sahibi kapattı."])).toMatchObject({ ok: true });
    const c = await lowTask(P.agent!, P.agent!);
    const other = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    await as("authenticated", P.agent!, other);
    expect(await call(`select public.survey_close_low_score($1,$2)`, [c.id, "Başka ofisten deneme yapıldı."])).toMatchObject({ ok: false });
  });

  it("guard: anketör zincir/gönderim sütununu ve notsuz kapanışı yazamaz; servis yazabilir", async () => {
    const t = await lowTask(P.agent!, P.agent!);
    await q(`update public.survey_tasks set assigned_to = $1 where id = $2`, [P.surveyor, t.id]);
    await as("authenticated", P.surveyor!, T, "call_center");
    expect((await call(`update public.survey_tasks set escalation_level = 2 where id=$1 returning true`, [t.id])).code).toBe("42501");
    expect((await call(`update public.survey_tasks set sent_at = now() where id=$1 returning true`, [t.id])).code).toBe("42501");
    expect((await call(`update public.survey_tasks set low_score_handled = true where id=$1 returning true`, [t.id])).code).toBe("42501");
    await as("service_role");
    expect(await call(`update public.survey_tasks set escalation_level = 1 where id=$1 returning true`, [t.id])).toBe(true);
  });

  it("ekip nabzı: ayda bir, cevap kişiye bağlanmaz, zorunlu/seçenek doğrulanır, tetikleyici kapalıyken kapalı", async () => {
    await as("service_role");
    pulseTpl = (await q(`insert into public.survey_templates(tenant_id, event_type, audience, name) values ($1,'advisor_pulse','advisor','Nabız') returning id`, [T]))[0]!.id as string;
    for (const [k, kind, tag, req, opts] of [
      ["score", "score", "primary", true, "[]"],
      ["need", "choice", "reason", true, '["Eğitim","Portföy"]'],
      ["note", "text", null, false, "[]"],
    ] as const) {
      pulseQ[k] = (
        await q(`insert into public.survey_questions(tenant_id, template_id, position, kind, label, options, required, tag) values ($1,$2,0,$3,$4,$5::jsonb,$6,$7) returning id`, [T, pulseTpl, kind, k, opts, req, tag])
      )[0]!.id as string;
    }
    const period = (await q(`select to_char(timezone('Europe/Istanbul', now()), 'YYYY-MM') as p`))[0]!.p as string;
    const answers = (need: string, score = "8") =>
      JSON.stringify([
        { question_id: pulseQ.score, value_num: score, value_text: null },
        { question_id: pulseQ.need, value_num: null, value_text: need },
        { question_id: pulseQ.note, value_num: null, value_text: "Daha çok eğitim" },
      ]);
    await as("authenticated", P.agent!, T);
    expect(await call(`select public.survey_submit_advisor_pulse($1,$2,$3::jsonb)`, [pulseTpl, period, answers("Eğitim")])).toMatchObject({ ok: false, code: "disabled" });
    await as("service_role");
    await q(`insert into public.survey_triggers(tenant_id, event_type, enabled) values ($1,'advisor_pulse',true)`, [T]);
    await as("authenticated", P.agent!, T);
    expect(await call(`select public.survey_submit_advisor_pulse($1,$2,$3::jsonb)`, [pulseTpl, "2000-01", answers("Eğitim")])).toMatchObject({ code: "period" });
    expect(await call(`select public.survey_submit_advisor_pulse($1,$2,$3::jsonb)`, [pulseTpl, period, answers("Yok böyle")])).toMatchObject({ code: "answers" });
    expect(await call(`select public.survey_submit_advisor_pulse($1,$2,$3::jsonb)`, [pulseTpl, period, answers("Eğitim", "11")])).toMatchObject({ code: "answers" });
    const onlyScore = JSON.stringify([{ question_id: pulseQ.score, value_num: "5" }]);
    expect(await call(`select public.survey_submit_advisor_pulse($1,$2,$3::jsonb)`, [pulseTpl, period, onlyScore])).toMatchObject({ code: "required" });
    expect(await call(`select public.survey_submit_advisor_pulse($1,$2,$3::jsonb)`, [pulseTpl, period, answers("Eğitim", "0")])).toMatchObject({ ok: true });
    expect(await call(`select public.survey_submit_advisor_pulse($1,$2,$3::jsonb)`, [pulseTpl, period, answers("Portföy")])).toMatchObject({ ok: false, code: "already" });

    await as("service_role");
    const rows = await q(`select agent_id, assigned_to, created_by, completed_by, score, comment, event_summary, customer_id from public.survey_tasks where event_type='advisor_pulse' and status='completed'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agent_id: null, assigned_to: null, created_by: null, completed_by: null, score: 0, comment: "Daha çok eğitim", customer_id: null });
    expect(String(rows[0]!.event_summary)).toBe(`Ekip nabzı ${period}`);
    const ans = await q(`select question_label, tag, value_text from public.survey_answers a join public.survey_tasks t on t.id=a.task_id where t.event_type='advisor_pulse' order by question_label`);
    expect(ans.map((a) => a.question_label)).toEqual(["need", "note", "score"]);
    expect((await q(`select count(*)::int as n from public.survey_pulse_responses where user_id=$1 and period=$2`, [P.agent, period]))[0]!.n).toBe(1);
  });

  it("rollback temiz uygulanır ve eski CHECK'ler geri gelir", async () => {
    await as("service_role");
    await db.exec(read("supabase/rollbacks/20261007000400_survey_matrix_channels.rollback.sql"));
    expect((await call(`insert into public.survey_tasks(tenant_id, event_type, audience, event_key) values ($1,'tenant_annual','tenant','ta-1') returning true`, [T])).code).toBe("23514");
    expect(await call(`select to_regprocedure('public.survey_close_low_score(uuid, text)') is null`)).toBe(true);
  });
});
