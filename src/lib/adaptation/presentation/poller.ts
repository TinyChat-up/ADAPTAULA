import type { AdaptationStatusDto } from "@/lib/adaptation/orchestration/status";

/**
 * Polling policy for the adaptation screen, kept free of React so it can be tested with fake timers. The server decides when
 * work is over: we keep asking only while the DTO says the pipeline is working by itself (`phase: working` and nothing for the
 * person to do). No percentages, no storm: fixed gentle interval, much slower with the tab hidden, backoff on failures.
 */

export const POLL_INTERVAL_MS = 2500;
export const HIDDEN_INTERVAL_MS = 15000;
export const MAX_BACKOFF_MS = 20000;

export const shouldPoll = (dto: Pick<AdaptationStatusDto, "phase" | "nextAction">) => dto.phase === "working" && dto.nextAction === "none";

export const nextDelay = (visible: boolean, failures: number) => {
  const base = visible ? POLL_INTERVAL_MS : HIDDEN_INTERVAL_MS;
  return Math.min(MAX_BACKOFF_MS, base * 2 ** Math.min(failures, 3));
};

export interface PollerOptions {
  fetchStatus: (signal: AbortSignal) => Promise<AdaptationStatusDto | null>;
  onStatus: (dto: AdaptationStatusDto) => void;
  onConnection: (online: boolean) => void;
  isVisible: () => boolean;
}

export interface Poller {
  /** Schedules the next check (no-op if one is scheduled or in flight). */
  start: (immediately?: boolean) => void;
  stop: () => void;
  /** The tab became visible again: check now instead of waiting out the slow interval. */
  wake: () => void;
}

export function createPoller(options: PollerOptions): Poller {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let failures = 0;
  let stopped = true;

  const schedule = (delay: number) => {
    if (stopped || timer !== null) return;
    timer = setTimeout(tick, delay);
  };

  async function tick() {
    timer = null;
    if (stopped) return;
    controller = new AbortController();
    const mine = controller;
    let dto: AdaptationStatusDto | null = null;
    try {
      dto = await options.fetchStatus(mine.signal);
    } catch {
      dto = null;
    }
    if (stopped || mine.signal.aborted) return;
    controller = null;
    if (dto === null) {
      failures += 1;
      options.onConnection(false);
    } else {
      failures = 0;
      options.onConnection(true);
      options.onStatus(dto);
      if (!shouldPoll(dto)) {
        stopped = true;
        return;
      }
    }
    schedule(nextDelay(options.isVisible(), failures));
  }

  return {
    start(immediately = false) {
      if (!stopped && (timer !== null || controller !== null)) return;
      stopped = false;
      schedule(immediately ? 0 : nextDelay(options.isVisible(), failures));
    },
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      controller?.abort();
      controller = null;
    },
    wake() {
      if (stopped || controller !== null) return;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      schedule(0);
    },
  };
}
