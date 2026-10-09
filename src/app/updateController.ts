export interface UpdateSnapshot {
  ready: boolean;
  busy: boolean;
  version: string;
  saveError: string | null;
}

interface UpdateDependencies {
  snapshot: () => UpdateSnapshot;
  subscribe: (listener: () => void) => () => void;
  flush: () => Promise<void>;
  activate: () => Promise<void>;
  reload: () => void;
  settle?: () => Promise<void>;
}

export interface UpdateState {
  status: 'idle' | 'waiting' | 'ready' | 'updating' | 'error';
  error: string | null;
}

/** Both offering an update and actually reloading require a saved, idle document. */
export class UpdateController {
  private state: UpdateState = { status: 'idle', error: null };
  private readonly listeners = new Set<() => void>();
  private readonly dependencies: UpdateDependencies;
  private available = false;
  private activated = false;
  private accepted = false;
  private dismissed = false;
  private preparing = false;
  private activationRequested = false;
  private disposed = false;
  private reloaded = false;
  private rerun = false;
  private unsubscribe: (() => void) | undefined;

  constructor(dependencies: UpdateDependencies) {
    this.dependencies = dependencies;
  }

  getSnapshot = (): UpdateState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): () => void {
    this.disposed = false;
    this.unsubscribe = this.dependencies.subscribe(() => {
      if (this.preparing) this.rerun = true;
      // A ready prompt must disappear immediately when a new job/edit begins.
      if (this.available && !this.dismissed) this.setState(this.accepted ? 'updating' : 'waiting');
      void this.prepare();
    });
    return () => {
      this.disposed = true;
      this.unsubscribe?.();
      this.unsubscribe = undefined;
    };
  }

  notifyUpdate(): void {
    this.available = true;
    this.activated = false;
    this.activationRequested = false;
    this.dismissed = false;
    if (this.preparing) this.rerun = true;
    void this.prepare();
  }

  notifyActivated(): void {
    this.activated = true;
    this.available = true;
    // An update activated by another tab still needs this user's acceptance.
    if (this.preparing) this.rerun = true;
    void this.prepare();
  }

  requestUpdate(): void {
    if (!this.available || this.disposed) return;
    this.accepted = true;
    this.dismissed = false;
    void this.prepare();
  }

  dismiss(): void {
    if (this.accepted) return;
    this.dismissed = true;
    this.setState('idle');
  }

  private setState(status: UpdateState['status'], error: string | null = null): void {
    if (this.state.status === status && this.state.error === error) return;
    this.state = { status, error };
    for (const listener of this.listeners) listener();
  }

  private async prepare(): Promise<void> {
    if (this.preparing || this.disposed || this.reloaded || !this.available || this.dismissed) return;
    const initial = this.dependencies.snapshot();
    if (!initial.ready || initial.busy) {
      this.setState(this.accepted ? 'updating' : 'waiting');
      return;
    }
    if (initial.saveError) {
      this.setState('error', 'Save your changes before updating.');
      return;
    }
    this.preparing = true;
    this.setState(this.accepted ? 'updating' : 'waiting');
    try {
      while (!this.disposed && !this.dismissed) {
        this.rerun = false;
        const before = this.dependencies.snapshot();
        if (!before.ready || before.busy) return;
        await this.dependencies.flush();
        // Import callers can place the returned photos in a later microtask.
        // Give those commands and React's autosave effect time to run, then
        // compare the current revision instead of relying on UI save status.
        await (this.dependencies.settle?.() ?? new Promise<void>((resolve) => window.setTimeout(resolve, 0)));
        if (this.disposed || this.dismissed) return;
        const after = this.dependencies.snapshot();
        if (!after.ready || after.busy) return;
        if (after.saveError) {
          this.setState('error', 'Save your changes before updating.');
          return;
        }
        if (before.version !== after.version) continue;
        if (!this.accepted) {
          this.setState('ready');
          return;
        }
        if (this.activated) {
          this.reloaded = true;
          this.dependencies.reload();
          return;
        }
        if (!this.activationRequested) {
          this.activationRequested = true;
          await this.dependencies.activate();
          // A controlling event may arrive before activation resolves.
          if (this.activated) continue;
        }
        return;
      }
    } catch {
      this.accepted = false;
      this.activationRequested = false;
      this.rerun = false;
      this.setState('error', 'The update could not be prepared. Save your changes and try again.');
    } finally {
      this.preparing = false;
      if (this.rerun && !this.disposed) {
        this.rerun = false;
        void this.prepare();
      }
    }
  }
}
