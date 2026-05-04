// Archive DB — DISABLED.
//
// The previous DigitalOcean MongoDB cluster that backed archived
// interviews + requirements has been decommissioned and is no longer
// part of any operator workflow. Calling `mongoose.createConnection`
// against the dead host crashed the server at boot with an unhandled
// `querySrv EREFUSED` DNS error.
//
// We keep the same exports (`ARCHIVE_DB_INSTANCE`, `ArchiveInterview`,
// `ArchiveRequirement`) so existing callers compile and silently
// degrade to empty result sets:
//
//   - controllers/archivesController.ts: list endpoints return [].
//   - controllers/requirementController.ts: when `archive=true`, the
//     fetch hits the stub instead of the live collection and returns [].
//
// To re-enable archive: replace this file with a real `createConnection`
// against a working cluster and re-add the schemas the original models
// were built from.

import type { Model } from "mongoose";

const emptyChain = {
  sort() {
    return emptyChain;
  },
  limit() {
    return emptyChain;
  },
  skip() {
    return emptyChain;
  },
  async exec() {
    return [] as unknown[];
  },
  // Some Mongoose call sites await the chain directly without `.exec()`.
  then(resolve: (v: unknown[]) => void) {
    resolve([]);
  },
};

const archiveStub = {
  find() {
    return emptyChain;
  },
  async countDocuments() {
    return 0;
  },
  // Methods occasionally invoked by callers but irrelevant here.
  async distinct() {
    return [] as unknown[];
  },
  schema: { paths: {} },
};

// `null` makes the disabled state obvious to anyone destructuring this
// elsewhere; nothing in the codebase reads the instance directly.
const ARCHIVE_DB_INSTANCE = null;

const ArchiveInterview = archiveStub as unknown as Model<unknown>;
const ArchiveRequirement = archiveStub as unknown as Model<unknown>;

export { ARCHIVE_DB_INSTANCE, ArchiveInterview, ArchiveRequirement };
