/** JSON-lines logger. One line per event, safe for CloudWatch, no dependencies. */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  level?: LogLevel;
  write?: (line: string) => void;
}

export function createLogger(bindings: LogFields = {}, options: LoggerOptions = {}): Logger {
  const level = options.level ?? levelFromEnv();
  const write = options.write ?? ((line: string) => process.stdout.write(line + '\n'));
  const threshold = LEVELS[level];

  const emit = (lvl: LogLevel, msg: string, fields?: LogFields) => {
    if (LEVELS[lvl] < threshold) return;
    write(
      JSON.stringify({ level: lvl, time: new Date().toISOString(), msg, ...bindings, ...fields }),
    );
  };

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (more) => createLogger({ ...bindings, ...more }, { level, write }),
  };
}

function levelFromEnv(): LogLevel {
  const raw = process.env.LOG_LEVEL;
  return raw && raw in LEVELS ? (raw as LogLevel) : 'info';
}

/** Turn an unknown thrown value into log-safe fields. */
export function errorFields(err: unknown): LogFields {
  if (err instanceof Error) {
    return { errorName: err.name, errorMessage: err.message, stack: err.stack };
  }
  return { errorMessage: String(err) };
}
