// -----------------------------------------------------------------------------
// The only network access: GET http://<address>/home.cgi, the status page of
// the Wi-Fi board of a Zeversolar inverter, plain HTTP on the home network, no
// cloud, no login (as the zeversolar library, see THIRD_PARTY_NOTICES.md).
// Read-only: the library's commands (inv_ctrl.cgi, pwrlim.cgi, adv.cgi) are
// never ported.
//
// Bounded: one request at a time, 10 s for the whole answer (the body
// included), 4 KiB at most, read into one buffer allocated once, never a
// redirect followed. Node's own fetch: no User-Agent of ours, no imitation.
//
// Errors carry our own codes, never a text of the inverter nor a URL.
// -----------------------------------------------------------------------------

import { HOME_PATH, HTTP_TIMEOUT, MAX_BODY_BYTES } from '../constants.js';
import { parseHome } from './model.js';

export class ZeverError extends Error {
  /**
   * @param {'timeout'|'unreachable'|'http'|'not_found'|'server'|'rate_limited'|'too_large'|
   *   'unknown_answer'} code
   */
  constructor(code, { status, retryAfter } = {}) {
    super(code);
    this.name = 'ZeverError';
    this.code = code;
    this.status = status;
    /** ms, from a Retry-After header (429, 503), when given. */
    this.retryAfter = retryAfter;
  }
}

/** A network failure (while connecting or while reading the body), in our words. */
function networkError(err) {
  if (err instanceof ZeverError) {
    return err;
  }
  const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
  return new ZeverError(timeout ? 'timeout' : 'unreachable');
}

/**
 * The body, up to `limit` bytes, copied into a single buffer allocated once
 * (no list of chunks, no concatenation): a longer one is not a Zeversolar answer.
 */
export async function readBounded(response, limit) {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const buffer = new Uint8Array(limit);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (size + value.byteLength > limit) {
        throw new ZeverError('too_large');
      }
      buffer.set(value, size);
      size += value.byteLength;
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  }
  return new TextDecoder('utf-8').decode(buffer.subarray(0, size));
}

/** The body of an answer we do not read: let go. */
const drop = async (response) => {
  try {
    await response.body?.cancel?.();
  } catch {
    // Nothing to do: the answer is refused anyway.
  }
};

/** Retry-After in seconds (or an HTTP date) -> ms, undefined when absent or odd. */
function retryAfterOf(response, now) {
  const raw = response.headers?.get?.('retry-after');
  if (typeof raw !== 'string' || raw.length > 64) {
    return undefined;
  }
  if (/^\d{1,9}$/.test(raw.trim())) {
    return Number(raw.trim()) * 1000;
  }
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now()) : undefined;
}

export class ZeverClient {
  constructor({
    address,
    fetchImpl = (...args) => globalThis.fetch(...args),
    timeout = HTTP_TIMEOUT,
    now = Date.now,
  }) {
    this.address = address;
    this.fetch = fetchImpl;
    this.timeout = timeout;
    this.now = now;
    /** Requests one after the other, never two at once (a small Wi-Fi board). */
    this.queue = Promise.resolve();
  }

  /** GET of the status page: its text, bounded. */
  request() {
    const run = async () => {
      try {
        const response = await this.fetch(`http://${this.address}${HOME_PATH}`, {
          method: 'GET',
          // A redirect is never followed: the request stays on this address.
          redirect: 'manual',
          // The whole answer, the body included, within the timeout.
          signal: AbortSignal.timeout(this.timeout),
        });
        const status = response.status;
        if (status === 429 || status >= 500) {
          await drop(response);
          throw new ZeverError(status === 429 ? 'rate_limited' : 'server', {
            status,
            retryAfter: retryAfterOf(response, this.now),
          });
        }
        if (status === 404) {
          await drop(response);
          throw new ZeverError('not_found', { status });
        }
        if (status < 200 || status >= 300) {
          await drop(response);
          throw new ZeverError('http', { status });
        }
        return await readBounded(response, MAX_BODY_BYTES);
      } catch (err) {
        throw networkError(err);
      }
    };
    const job = this.queue.then(run, run);
    this.queue = job.catch(() => {});
    return job;
  }

  /** The status page parsed (src/zeversolar/model.js); `unknown_answer` when it is not one. */
  async readHome() {
    const reading = parseHome(await this.request());
    if (!reading) {
      throw new ZeverError('unknown_answer');
    }
    return reading;
  }
}
