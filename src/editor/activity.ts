/** Tracks whole user jobs without importing their worker or export dependencies. */
export class ActivityTracker {
  private active = 0;
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): number => this.active;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  begin(): () => void {
    this.active++;
    this.emit();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.emit();
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const editorActivity = new ActivityTracker();
