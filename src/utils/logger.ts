type LogFn = (...args: unknown[]) => void;

function make(level: 'debug' | 'info' | 'warn' | 'error'): LogFn {
  return (...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console[level]('[UEH]', ...args);
  };
}

export const logger = {
  debug: make('debug'),
  info: make('info'),
  warn: make('warn'),
  error: make('error'),
};
