/**
 * Jest config for unit tests: uses next/jest for compatibility, jsdom environment, and path aliases
 * matching tsconfig (@/*, lib/*). Test files: **/*.test.[jt]s?(x) and __tests__/**/*.
 */
import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({
  dir: "./",
});

const config: Config = {
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

export default createJestConfig(config);
