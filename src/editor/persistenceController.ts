export class PersistenceController {
  private timer: number | null = null;
  private saving: Promise<void> | null = null;
  private dirty = false;
  private disposed = false;
  private readonly saveAction: () => Promise<void>;
  private readonly delay: number;
  private readonly onError: (error: unknown) => void;

  constructor(save: () => Promise<void>, delay = 750, onError: (error: unknown) => void = console.error) {
    this.saveAction = save;
    this.delay = delay;
    this.onError = onError;
  }

  markDirty(): void {
    if (this.disposed) return;
    this.dirty = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    // The active flush drains edits made during a save before it resolves.
    if (this.saving) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush().catch(this.onError);
    }, this.delay);
  }

  flush(): Promise<void> {
    if (this.disposed) return this.saving ?? Promise.resolve();
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.dirty = true;
    if (this.saving) return this.saving;
    this.saving = Promise.resolve().then(async () => {
      try {
        while (this.dirty && !this.disposed) {
          this.dirty = false;
          await this.saveAction();
        }
      } catch (error) {
        this.dirty = true;
        throw error;
      } finally {
        this.saving = null;
      }
    });
    return this.saving;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }
}
