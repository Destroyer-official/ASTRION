export type ModuleHealthStatus = 'ok' | 'degraded' | 'failed' | 'unknown';

export interface ModuleHealth {
  readonly module: string;
  readonly status: ModuleHealthStatus;
  readonly detail?: string;
}

export interface HealthRegistryOptions {
  onChange?(previous: ModuleHealthStatus, next: ModuleHealth): void;
}

/** Registration and transition tracking for independently checked application modules. */
export class HealthRegistry {
  private readonly entries = new Map<string, ModuleHealth>();
  private readonly options: HealthRegistryOptions;

  constructor(options: HealthRegistryOptions = {}) {
    this.options = options;
  }

  register(module: string, status: ModuleHealthStatus = 'unknown', detail?: string): ModuleHealth {
    return this.update(module, status, detail);
  }

  update(module: string, status: ModuleHealthStatus, detail?: string): ModuleHealth {
    const previous = this.entries.get(module);
    const next: ModuleHealth = { module, status, ...(detail ? { detail } : {}) };
    if (previous?.status === status) {
      if (previous.detail !== detail) this.entries.set(module, next);
      return next;
    }
    this.entries.set(module, next);
    this.options.onChange?.(previous?.status ?? 'unknown', next);
    return next;
  }

  get(module: string): ModuleHealth {
    return this.entries.get(module) ?? { module, status: 'unknown' };
  }

  snapshot(): readonly ModuleHealth[] {
    return [...this.entries.values()];
  }
}
