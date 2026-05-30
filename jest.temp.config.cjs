module.exports = {
  roots: ["<rootDir>/src"],
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^lib/(.*)$": "<rootDir>/lib/$1",
  },
  testMatch: ["**/src/backend/auth/**/__tests__/**/*.test.[jt]s?(x)", "**/src/backend/auth/**/__tests__/**/*.test.[jt]s?(x)"],
};
