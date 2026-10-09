/**
 * Fire-and-forget runner for the IT Job Search ingests.
 *
 * The ingests (JSearch sweep, feed pull, email catch-up) can take tens of
 * seconds. Rather than block the HTTP request, the controller kicks the
 * work off in the background and returns immediately; the client auto-
 * refreshes the queue so results appear as they land.
 *
 * An in-memory key guard prevents a second run of the same kind from
 * overlapping (e.g. a user double-clicking "Search job boards").
 */
const running = new Set<string>();

export interface BackgroundRunResult {
  started: boolean;
  alreadyRunning: boolean;
}

export function startBackgroundRun<T>(
  key: string,
  fn: () => Promise<T>
): BackgroundRunResult {
  if (running.has(key)) return { started: false, alreadyRunning: true };
  running.add(key);
  fn()
    .then((r) =>
      console.log(
        `[bg:${key}] done`,
        r && typeof r === "object" ? JSON.stringify(r) : String(r)
      )
    )
    .catch((e) => console.error(`[bg:${key}] failed:`, (e as Error).message))
    .finally(() => running.delete(key));
  return { started: true, alreadyRunning: false };
}

export function isRunning(key: string): boolean {
  return running.has(key);
}
