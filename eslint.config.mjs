import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// flat config for eslint v9. covers every package under packages/.
// formatting is prettier's job, so no stylistic rules live here.
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      ".pgdata/**",
      "coverage/**",
      "**/*.tsbuildinfo",
      "**/fixtures/**",
      "packages/web/demo-static/**",
      "landing/.next/**",
      "landing/out/**",
      "landing/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // node is the only runtime in this repo for now.
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // honor the two intentional "unused" conventions the codebase uses: a
      // leading underscore marks a deliberately unused binding, and a rest
      // sibling that omits a field (e.g. stripping databaseUrl from a response)
      // is the point, not a mistake.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          ignoreRestSiblings: true,
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
);
