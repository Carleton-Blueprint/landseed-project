/**
 * ESLint flat config: extends Next.js core-web-vitals and TypeScript rules. Uses FlatCompat to
 * support the legacy extend format. Linting runs on build and can be run via npm run lint.
 */
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
