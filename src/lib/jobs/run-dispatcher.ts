/**
 * Client side of "user-triggered jobs run immediately": the screen asks the server to run its pending job in an awaited request
 * (`POST …/run`) as soon as the job exists, and again, gently, while it stays pending (a retry backoff ended, or the function that
 * was running it died). At most one request in flight per tab; the server's atomic claim makes extra requests harmless anyway
 * (no second model call). Free of React so it can be tested with fake timers.
 */

export const RERUN_INTERVAL_MS = 15_000;

export interface RunDispatcher {
  /** Starts a run request unless one is in flight or the last one started less than `RERUN_INTERVAL_MS` ago (`force` skips that wait). */
  kick: (force?: boolean) => void;
  stop: () => void;
}

export function createRunDispatcher<T>(options: {
  run: () => Promise<T | null>;
  /** Returning `true` asks for another run right after this one (the work moved on to a next stage that is already queued). */
  onResult: (result: T) => boolean | void;
  now?: () => number;
}): RunDispatcher {
  const now = options.now ?? Date.now;
  let inFlight = false;
  let lastStart = -Infinity;
  let stopped = false;

  const dispatcher: RunDispatcher = {
    kick(force = false) {
      if (stopped || inFlight || (!force && now() - lastStart < RERUN_INTERVAL_MS)) return;
      inFlight = true;
      lastStart = now();
      let again = false;
      options
        .run()
        .then((result) => {
          if (!stopped && result !== null) again = options.onResult(result) === true;
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
          if (again) dispatcher.kick(true);
        });
    },
    /** The screen went away: results are ignored. The request itself is NOT aborted: leaving the page never cuts a running job short. */
    stop() {
      stopped = true;
    },
  };
  return dispatcher;
}
