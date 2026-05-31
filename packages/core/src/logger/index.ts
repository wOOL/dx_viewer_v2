export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const LEVEL_STYLES: Record<LogLevel, string> = {
	debug: 'color: #8b8b8b',
	info: 'color: #2196f3',
	warn: 'color: #ff9800',
	error: 'color: #f44336; font-weight: bold'
};

interface LogEntry {
	timestamp: number;
	level: LogLevel;
	scope: string;
	message: string;
	data?: unknown;
	duration?: number;
}

type LogSubscriber = (entry: LogEntry) => void;

class Logger {
	private _enabled = false;
	private _level: LogLevel = 'debug';
	private _history: LogEntry[] = [];
	private _maxHistory = 500;
	private _subscribers: LogSubscriber[] = [];

	/** Enable or disable debug mode. When disabled, no logs are emitted. */
	get enabled() {
		return this._enabled;
	}

	/** The current log history. */
	get history(): ReadonlyArray<LogEntry> {
		return this._history;
	}

	/**
	 * Initialise the logger. Call once at app startup.
	 * @param enabled  Whether debug mode is active.
	 * @param level    Minimum log level to emit (default: 'debug').
	 */
	enable(level: LogLevel = 'debug') {
		this._enabled = true;
		this._level = level;
		this.info('logger', 'Debug mode enabled', { level });
	}

	disable() {
		this._enabled = false;
	}

	/** Subscribe to log entries for custom handling (e.g. sending to external service). */
	subscribe(fn: LogSubscriber): () => void {
		this._subscribers.push(fn);
		return () => {
			this._subscribers = this._subscribers.filter((s) => s !== fn);
		};
	}

	/** Create a scoped child logger that prefixes all messages with the given scope. */
	scoped(scope: string) {
		return {
			debug: (message: string, data?: unknown) => this.debug(scope, message, data),
			info: (message: string, data?: unknown) => this.info(scope, message, data),
			warn: (message: string, data?: unknown) => this.warn(scope, message, data),
			error: (message: string, data?: unknown) => this.error(scope, message, data),
			time: (label: string) => this.time(scope, label)
		};
	}

	debug(scope: string, message: string, data?: unknown) {
		this._log('debug', scope, message, data);
	}

	info(scope: string, message: string, data?: unknown) {
		this._log('info', scope, message, data);
	}

	warn(scope: string, message: string, data?: unknown) {
		this._log('warn', scope, message, data);
	}

	error(scope: string, message: string, data?: unknown) {
		this._log('error', scope, message, data);
	}

	/**
	 * Start a performance timer. Returns a function to stop it and log the duration.
	 * @example
	 * const stop = logger.time('api', 'findXRay');
	 * await findXRay(pb, data);
	 * stop(); // logs: [api] findXRay completed in 342ms
	 */
	time(scope: string, label: string): (data?: unknown) => void {
		if (!this._enabled) return () => {};
		const start = performance.now();
		return (data?: unknown) => {
			const duration = Math.round(performance.now() - start);
			this._log('debug', scope, `${label} completed in ${duration}ms`, data, duration);
		};
	}

	/** Clear the log history. */
	clear() {
		this._history = [];
	}

	/** Dump all history to the console as a table. */
	dump() {
		if (this._history.length === 0) {
			console.log('%c[be-certain] No log history', 'color: #8b8b8b');
			return;
		}
		console.table(
			this._history.map((e) => ({
				time: new Date(e.timestamp).toISOString().slice(11, 23),
				level: e.level,
				scope: e.scope,
				message: e.message,
				duration: e.duration ? `${e.duration}ms` : '',
				data: e.data !== undefined ? JSON.stringify(e.data) : ''
			}))
		);
	}

	private _log(level: LogLevel, scope: string, message: string, data?: unknown, duration?: number) {
		if (!this._enabled) return;
		if (LOG_LEVELS[level] < LOG_LEVELS[this._level]) return;

		const entry: LogEntry = { timestamp: Date.now(), level, scope, message, data, duration };

		// Store in history ring buffer
		this._history.push(entry);
		if (this._history.length > this._maxHistory) {
			this._history = this._history.slice(-this._maxHistory);
		}

		// Console output
		const prefix = `%c[${scope}]`;
		const style = LEVEL_STYLES[level];
		if (data !== undefined) {
			console[level](prefix, style, message, data);
		} else {
			console[level](prefix, style, message);
		}

		// Notify subscribers
		for (const sub of this._subscribers) {
			try {
				sub(entry);
			} catch {
				// Subscriber errors must not break logger
			}
		}
	}
}

/** Singleton debug logger for the entire application. */
export const logger = new Logger();
