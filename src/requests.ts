/**
 * Requests to the music services: made one at a time with a pause between
 * them, and tried again when the service is busy or the network fails.
 *
 * Moving a library means a few thousand requests to services that never
 * agreed to it, so crossfade keeps to the pace a person clicking through the
 * site might, waits as long as a service asks it to, and stops rather than
 * hammer a service that keeps refusing.
 *
 * Error messages name the method, the address without its query and the
 * status - never headers or query strings, where tokens travel.
 */

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
};

export interface RequestsOptions {
  /** The shortest time between the starts of two requests. */
  spacingMs: number;
  /** How many more times a request is tried after a failure worth retrying. */
  retries?: number;
  /** The wait before the first retry; each next one is about twice as long. */
  backoffMs?: number;
  /** A request without an answer after this long is given up, and tried again. */
  timeoutMs?: number;
  /** The longest wait crossfade accepts when a service asks it to slow down. */
  maxWaitMs?: number;
  /** Told about each wait before a retry, so that a person knows why nothing seems to happen. */
  onWait?: (ms: number, reason: string) => void;
  fetch?: typeof globalThis.fetch;
  clock?: Clock;
  random?: () => number;
}

/** Answers that say "not now" rather than "no": busy, rate limited, briefly down. */
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

/** HTTP/2 answers carry no reason phrase, so the usual ones are spelled out here. */
const REASONS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  408: 'Request Timeout',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export class HttpError extends Error {
  /** The HTTP status, or undefined when no answer came. */
  readonly status: number | undefined;

  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HttpError';
    this.status = status;
  }
}

export class Requests {
  readonly #options: Required<Omit<RequestsOptions, 'onWait'>> & Pick<RequestsOptions, 'onWait'>;
  /** When the last request started. */
  #last = -Infinity;
  /** The request in progress, which the next one waits for. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: RequestsOptions) {
    this.#options = {
      retries: 4,
      backoffMs: 1000,
      timeoutMs: 30_000,
      maxWaitMs: 10 * 60_000,
      fetch: globalThis.fetch,
      clock: systemClock,
      random: Math.random,
      ...options,
    };
  }

  /** Makes the request when its turn comes. Resolves with a successful answer; throws an HttpError otherwise. */
  fetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
    const result = this.#queue.then(() => this.#send(new URL(url), init));
    this.#queue = result.catch(() => {});
    return result;
  }

  async #send(url: URL, init: RequestInit): Promise<Response> {
    const { retries, timeoutMs, maxWaitMs, fetch, clock } = this.#options;
    const where = `${init.method ?? 'GET'} ${url.origin}${url.pathname}`;

    for (let attempt = 0; ; attempt++) {
      const ready = this.#last + this.#options.spacingMs;
      if (ready > clock.now()) {
        await clock.sleep(ready - clock.now());
      }
      this.#last = clock.now();

      const timeout = AbortSignal.timeout(timeoutMs);
      let response: Response;
      try {
        response = await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
      } catch (error) {
        if (init.signal?.aborted) {
          throw error;
        }
        const reason = timeout.aborted ? `no answer within ${duration(timeoutMs)}` : 'network error';
        if (attempt >= retries) {
          throw new HttpError(`${where}: ${reason}`, undefined, { cause: error });
        }
        await this.#pause(this.#backoff(attempt), reason);
        continue;
      }

      if (response.ok) {
        return response;
      }
      await response.body?.cancel();
      const reason = `${response.status} ${response.statusText || REASONS[response.status] || ''}`.trim();
      if (!RETRY_STATUSES.has(response.status) || attempt >= retries) {
        throw new HttpError(`${where}: ${reason}`, response.status);
      }
      const asked = retryAfter(response.headers.get('retry-after'), clock.now());
      if (asked !== undefined && asked > maxWaitMs) {
        throw new HttpError(`${where}: ${reason}, and asked to wait ${duration(asked)}; try again later`, response.status);
      }
      await this.#pause(asked ?? this.#backoff(attempt), reason);
    }
  }

  /** Twice as long each time, between half and all of it at random, so that retries do not fall in step. */
  #backoff(attempt: number): number {
    return Math.round(this.#options.backoffMs * 2 ** attempt * (0.5 + this.#options.random() / 2));
  }

  async #pause(ms: number, reason: string): Promise<void> {
    this.#options.onWait?.(ms, reason);
    await this.#options.clock.sleep(ms);
  }
}

/** A Retry-After header in milliseconds from now: it holds either seconds or a date. */
export function retryAfter(header: string | null, now: number): number | undefined {
  if (header === null) {
    return undefined;
  }
  if (/^\d+$/.test(header.trim())) {
    return Number(header) * 1000;
  }
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 120_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60_000)} min`;
}
