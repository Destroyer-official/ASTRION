export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogValue = string | number | boolean | null;

export type LogFields = Readonly<Record<string, LogValue>>;

export interface LogRecord {
  readonly level: LogLevel;
  readonly tag: string;
  readonly message: string;
  readonly fields?: LogFields;
}

export interface LogSink {
  write(record: LogRecord): void;
}

export const NOOP_LOG_SINK: LogSink = {
  write() {},
};

export const CONSOLE_LOG_SINK: LogSink = {
  write(record) {
    const line = `[${record.tag}] ${record.message}`;
    const details = record.fields ? JSON.stringify(record.fields) : '';
    const output = details ? `${line} ${details}` : line;
    if (record.level === 'debug') console.debug(output);
    else if (record.level === 'warn') console.warn(output);
    else if (record.level === 'error') console.error(output);
    else console.info(output);
  },
};

const levelRank = (level: LogLevel): number => LOG_LEVELS.indexOf(level);

/** A tag-scoped structured logger. Sinks decide delivery; this module never reads wall-clock time. */
export class Logger {
  readonly tag: string;
  private readonly sink: LogSink;
  private readonly minLevel: LogLevel;
  private readonly baseFields: LogFields;

  constructor(
    tag: string,
    sink: LogSink = CONSOLE_LOG_SINK,
    minLevel: LogLevel = 'info',
    baseFields: LogFields = {},
  ) {
    this.tag = tag;
    this.sink = sink;
    this.minLevel = minLevel;
    this.baseFields = baseFields;
  }

  child(suffix: string, fields: LogFields = {}): Logger {
    return new Logger(`${this.tag}.${suffix}`, this.sink, this.minLevel, {
      ...this.baseFields,
      ...fields,
    });
  }

  log(level: LogLevel, message: string, fields: LogFields = {}): void {
    if (levelRank(level) < levelRank(this.minLevel)) return;
    const merged = { ...this.baseFields, ...fields };
    this.sink.write({
      level,
      tag: this.tag,
      message,
      ...(Object.keys(merged).length === 0 ? {} : { fields: merged }),
    });
  }

  debug(message: string, fields?: LogFields): void {
    this.log('debug', message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.log('info', message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.log('warn', message, fields);
  }

  error(message: string, error?: unknown, fields?: LogFields): void {
    this.log('error', message, {
      ...fields,
      ...(error === undefined ? {} : { errorType: error instanceof Error ? error.name : typeof error }),
    });
  }

  errorDetails(error: unknown, fields: LogFields = {}): LogFields {
    if (!(error instanceof Error)) return fields;
    return {
      ...fields,
      errorMessage: error.message,
      ...(error.stack ? { errorStack: error.stack } : {}),
    };
  }
}
