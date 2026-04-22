import type { MongoMemoryServer } from "mongodb-memory-server";

export default async function globalTeardown() {
  const mongod = (global as unknown as { __MONGOD__?: MongoMemoryServer })
    .__MONGOD__;
  if (mongod) await mongod.stop();
}
