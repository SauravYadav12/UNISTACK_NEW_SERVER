import { FeedAdapter } from "./types";
import { jobicyAdapter } from "./jobicyAdapter";
import { remotiveAdapter } from "./remotiveAdapter";
import { weworkremotelyAdapter } from "./weworkremotelyAdapter";
import { remoteokAdapter } from "./remoteokAdapter";

export type { FeedAdapter, NormalizedFeedJob } from "./types";

/** Registry of every available feed adapter, keyed by its config token. */
export const FEED_ADAPTERS: Record<string, FeedAdapter> = {
  [jobicyAdapter.key]: jobicyAdapter,
  [remotiveAdapter.key]: remotiveAdapter,
  [weworkremotelyAdapter.key]: weworkremotelyAdapter,
  [remoteokAdapter.key]: remoteokAdapter,
};

/** Default feeds pulled when IT_JOB_FEEDS is unset. */
export const DEFAULT_FEED_KEYS = [
  "jobicy",
  "remotive",
  "weworkremotely",
  "remoteok",
];
