/**
 * Eklentinin kullandığı Chrome API'lerinin ASGARİ tip bildirimi (@types/chrome bağımlılığı eklenmedi; yalnız kullanılan
 * yüzey). Yeni API kullanılırsa buraya eklenir.
 */
declare namespace chrome {
  namespace runtime {
    type MessageSender = { tab?: { id?: number; url?: string }; url?: string; id?: string };
    const id: string;
    const lastError: { message?: string } | undefined;
    function getManifest(): { version: string; name: string };
    function getURL(path: string): string;
    function sendMessage<T = unknown>(message: unknown): Promise<T>;
    const onMessage: {
      addListener(cb: (message: unknown, sender: MessageSender, sendResponse: (response?: unknown) => void) => boolean | void): void;
    };
    const onInstalled: { addListener(cb: (details: { reason: string }) => void): void };
    const onStartup: { addListener(cb: () => void): void };
  }
  namespace storage {
    type StorageArea = {
      get(keys: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
    const local: StorageArea;
    const session: StorageArea;
    const onChanged: {
      addListener(cb: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => void): void;
    };
  }
  namespace tabs {
    function create(props: { url: string }): Promise<unknown>;
  }
  namespace alarms {
    function create(name: string, info: { periodInMinutes?: number; delayInMinutes?: number }): Promise<void> | void;
    const onAlarm: { addListener(cb: (alarm: { name: string }) => void): void };
  }
  namespace action {
    function setBadgeText(details: { text: string }): Promise<void>;
    function setBadgeBackgroundColor(details: { color: string }): Promise<void>;
    function setTitle(details: { title: string }): Promise<void>;
  }
}
