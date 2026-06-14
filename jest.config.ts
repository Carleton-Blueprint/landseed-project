/**
 * Jest config for unit tests: uses next/jest for compatibility, jsdom environment, and path aliases
 * matching tsconfig (alias @/ and lib/). Test files: *.test.ts(x) and __tests__.
 */
import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({
  dir: "./",
});

const config: Config = {
  roots: ["<rootDir>/src"],
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^lib/(.*)$": "<rootDir>/lib/$1",
  },
  testMatch: ["**/__tests__/**/*.test.[jt]s?(x)", "**/*.test.[jt]s?(x)"],
  collectCoverageFrom: [
    "src/**/*.{js,jsx,ts,tsx}",
    "!src/**/*.d.ts",
    "!**/node_modules/**",
  ],
};

const customJestConfig = createJestConfig(config);

export default async () => {
  const resolved = await customJestConfig();
  return {
    ...resolved,
    transformIgnorePatterns: [
      "/node_modules/(?!(bullmq|msgpackr|packr)/)",
    ],
  };
};
