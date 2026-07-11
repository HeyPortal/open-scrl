export class PersistenceController {
  private timer: number | null = null;
  private saving = false;
  private queued = false;

  private readonly saveAction: () => Promise<void>;
  private readonly delay: number;

  constructor(save: () => Promise<void>, delay = 750) {
    this.saveAction = save;
    this.delay = delay;
  }

  markDirty(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.delay);
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.saving) {
      this.queued = true;
      return;
    }
    this.saving = true;
    try {
      do {
        this.queued = false;
        await this.saveAction();
      } while (this.queued);
    } finally {
      this.saving = false;
    }
  }

  dispose(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
  }
}
