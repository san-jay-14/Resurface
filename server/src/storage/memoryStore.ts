import type { ObjectStore } from "./objectStore.ts";

/** In-memory ObjectStore for tests and local development without R2. */
export class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();

  put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  deletePrefix(prefix: string, opts?: { except?: string }): Promise<number> {
    let n = 0;
    for (const k of [...this.objects.keys()]) {
      if (k.startsWith(prefix) && k !== opts?.except) {
        this.objects.delete(k);
        n += 1;
      }
    }
    return Promise.resolve(n);
  }

  publicUrl(key: string): string {
    return `https://cdn.test/${key}`;
  }
}
