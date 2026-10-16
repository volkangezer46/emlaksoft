import "server-only";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { RECEIPT_WORKER_SOURCE } from "./worker-source";

/**
 * Yalıtılmış iş parçacığı çalıştırıcı: süre sınırı (aşılırsa `terminate`), bellek sınırı (`resourceLimits`) ve
 * eşzamanlılık kapısı (paylaşılan üretim sunucusunu korur; kuyruk doluysa iş hiç başlamaz → "busy").
 */

export type SandboxTask =
  | { kind: "pdf"; bytes: Uint8Array; maxPages: number }
  | { kind: "qr"; images: { data: Uint8Array; width: number; height: number; channels: 1 | 3 | 4 }[] };

export class SandboxBusyError extends Error {
  constructor() {
    super("busy");
  }
}
export class SandboxTimeoutError extends Error {
  constructor() {
    super("timeout");
  }
}

/** Basit sayaçlı kapı. `max` eşzamanlı iş, `queue` bekleyen iş üst sınırı. */
export class Gate {
  private running = 0;
  private waiters: (() => void)[] = [];
  constructor(
    private readonly max: number,
    private readonly queue: number,
  ) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.max) {
      if (this.waiters.length >= this.queue) throw new SandboxBusyError();
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    } else this.running += 1;
    try {
      return await fn();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.running -= 1;
    }
  }
}

const sandboxGate = new Gate(2, 6);

/** Modül çözüm kökü: standalone imajda /app, geliştirmede depo kökü (her ikisinde de node_modules burada). */
export function moduleBase(): string {
  return path.join(process.cwd(), "package.json");
}

export function runSandboxed<T>(task: SandboxTask, opts: { timeoutMs: number; maxOldMb?: number }): Promise<T> {
  return sandboxGate.run(
    () =>
      new Promise<T>((resolve, reject) => {
        const transfer: ArrayBuffer[] = [];
        // Kopya: çağıranın tamponu aktarımla boşa çıkmasın.
        let payload: SandboxTask;
        if (task.kind === "pdf") {
          const bytes = new Uint8Array(task.bytes);
          transfer.push(bytes.buffer as ArrayBuffer);
          payload = { ...task, bytes };
        } else {
          payload = {
            kind: "qr",
            images: task.images.map((i) => {
              const data = new Uint8Array(i.data);
              transfer.push(data.buffer as ArrayBuffer);
              return { ...i, data };
            }),
          };
        }
        const worker = new Worker(RECEIPT_WORKER_SOURCE, {
          eval: true,
          workerData: { base: moduleBase(), task: payload },
          transferList: transfer,
          resourceLimits: { maxOldGenerationSizeMb: opts.maxOldMb ?? 384, maxYoungGenerationSizeMb: 48, stackSizeMb: 4 },
          stdout: true,
          stderr: true,
          env: {},
        });
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          fn();
          void worker.terminate().catch(() => undefined);
        };
        const timer = setTimeout(() => finish(() => reject(new SandboxTimeoutError())), opts.timeoutMs);
        // pdf.js uyarıları (ör. "TT: undefined function") belge içeriğinden türeyebilir: loglanmaz.
        worker.stdout?.resume();
        worker.stderr?.resume();
        worker.once("message", (msg: { ok: boolean; result?: T; error?: string }) => {
          finish(() => (msg.ok ? resolve(msg.result as T) : reject(new Error(msg.error ?? "worker"))));
        });
        worker.once("error", (e) => finish(() => reject(e)));
        worker.once("exit", (code) => finish(() => reject(new Error(`worker exit ${code}`))));
      }),
  );
}
