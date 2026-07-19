import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export const baseConfig = tseslint.config(
  {
    ignores: [
      "**/.astro/**",
      "**/.next/**",
      "**/coverage/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
);
