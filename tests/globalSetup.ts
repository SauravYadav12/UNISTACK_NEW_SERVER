import { MongoMemoryServer } from "mongodb-memory-server";

// Boot one in-memory MongoDB for the full jest run, expose its URI via an
// env var so the per-suite setup can connect mongoose to it. Using a single
// server across suites (instead of per-suite) keeps the run fast while still
// giving per-test isolation via collection-truncation in tests/setup.ts.
export default async function globalSetup() {
  const mongod = await MongoMemoryServer.create();
  process.env.__MONGO_URI__ = mongod.getUri();
  (global as unknown as { __MONGOD__?: MongoMemoryServer }).__MONGOD__ = mongod;
}
