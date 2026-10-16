import { describe, expect, it } from "vitest";
import { AGENDA_TASK_GROUP_MIN, buildAgendaEntries } from "./agenda-list";
import type { WeekViewAppointment } from "./week-grid";

const task = (id: string, at: string) => ({ kind: "task" as const, at, task: { id, title: `Görev ${id}`, due_at: at, customerName: null } });
const appt = (id: string, at: string) => ({ kind: "appt" as const, at, appt: { id, scheduled_at: at } as unknown as WeekViewAppointment });

describe("buildAgendaEntries", () => {
  it("az görevli günde akışı olduğu gibi bırakır", () => {
    const items = [task("a", "2026-10-16T08:00:00Z"), appt("r", "2026-10-16T09:00:00Z"), task("b", "2026-10-16T10:00:00Z")];
    expect(buildAgendaEntries(items)).toEqual(items);
  });

  it("çok görevli günde görevleri ilk görevin yerinde tek grupta toplar, randevular akışta kalır", () => {
    const tasks = Array.from({ length: AGENDA_TASK_GROUP_MIN }, (_, i) => task(`t${i}`, `2026-10-16T0${i + 1}:00:00Z`));
    const items = [appt("r1", "2026-10-16T00:30:00Z"), ...tasks, appt("r2", "2026-10-16T14:00:00Z")];
    const out = buildAgendaEntries(items);
    expect(out.map((e) => e.kind)).toEqual(["appt", "taskGroup", "appt"]);
    const group = out[1];
    expect(group.kind === "taskGroup" && group.tasks.map((t) => t.id)).toEqual(tasks.map((t) => t.task.id));
    expect(group.at).toBe(tasks[0].at);
  });
});
