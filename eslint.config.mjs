import { defineConfig, globalIgnores } from "eslint/config";
import ts from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
export default defineConfig([
  ...ts.configs.recommended,
  globalIgnores([
    ".next/**",
    ".local/**",
    "archive/**",
    ".netlify/**",
    "node_modules/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    "dist/**",
    "public/assets/**",
  ]),
  {
    plugins: { "react-hooks": hooks },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["app/**/*.{ts,tsx}", "apps/web/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },
  {
    // Checked against its TypeScript source by build:lite --check.
    files: ["public/lite/curriculum.js"],
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
]);
