import type { Config } from "jest";

// Strict TS + in-memory Mongo + module-level mail mock live in tests/setup.ts.
const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/__tests__", "<rootDir>/utils", "<rootDir>/services"],
  testMatch: ["**/*.test.ts"],
  // env.ts runs before source modules load — pins JWT_SECRET_KEY before
  // config/env.config.ts caches it. setup.ts wires Mongo + mail mock.
  setupFiles: ["<rootDir>/tests/env.ts"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  globalSetup: "<rootDir>/tests/globalSetup.ts",
  globalTeardown: "<rootDir>/tests/globalTeardown.ts",
  moduleFileExtensions: ["ts", "tsx", "js", "json"],
  clearMocks: true,
  verbose: false,
  testTimeout: 30_000,
};

export default config;
