/**
 * apiSemaphore.ts
 *
 * Priority coordination between the L3 summary pipeline and the main chat API.
 *
 * When both share the same API endpoint (no dedicated summary LLM configured),
 * concurrent requests compete for rate limits. The design decision:
 *   summary pipeline > chat reply
 *
 * Usage:
 *   - Pipeline: const release = acquireSummaryLock(); ... await pipeline(); release();
 *   - Chat:     await waitForSummaryIdle(); ... await callLLM(...)
 */

let _summaryLockPromise: Promise<void> | null = null;

/**
 * Acquires the summary lock. Returns a release function.
 * The summary pipeline holds this lock for its entire duration.
 */
export const acquireSummaryLock = (): (() => void) => {
    let release!: () => void;
    _summaryLockPromise = new Promise<void>(resolve => {
        release = () => {
            resolve();
            _summaryLockPromise = null;
        };
    });
    return release;
};

/**
 * Returns a promise that resolves immediately if no summary is running,
 * or waits until the current summary pipeline completes.
 * Chat replies call this before making API requests.
 */
export const waitForSummaryIdle = (): Promise<void> =>
    _summaryLockPromise ?? Promise.resolve();

/** True when the summary pipeline is currently holding the lock. */
export const isSummaryRunning = (): boolean => _summaryLockPromise !== null;
