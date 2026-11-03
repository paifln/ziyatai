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
    // Fragments are linted together in the generated public/lite/lite.js closure.
    "apps/lite/*.part.js",
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
