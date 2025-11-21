export class HydrationBarrier {
  #ready = false;
  #resolveReady: (() => void) | null = null;
  readonly #waitPromise: Promise<void>;

  constructor() {
    this.#waitPromise = new Promise((resolve) => {
      this.#resolveReady = resolve;
    });
  }

  get ready(): boolean {
    return this.#ready;
  }

  markReady(): void {
    if (this.#ready) return;
    this.#ready = true;
    this.#resolveReady?.();
    this.#resolveReady = null;
  }

  async prepare(): Promise<void> {
    if (this.#ready) return;
    await this.#waitPromise;
  }
}

export function createHydrationBarrier(): HydrationBarrier {
  return new HydrationBarrier();
}
