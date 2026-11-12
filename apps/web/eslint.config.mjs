import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

// 브라우저 번들에 들어가는 코드(화면·client·shared)는 서버 전용 코드(lib/server)를 값으로 가져오지 않는다.
// shared는 양쪽에서 쓰는 순수 코드라 client도 가져오지 않는다. 타입만 가져오는 것은 번들에 남지 않아 허용한다.
const serverOnly = {
  allowTypeImports: true,
  group: ["@/lib/server/**", "**/lib/server/**", "../server/**"],
  message: "lib/server는 서버 전용입니다. 양쪽에서 쓰는 순수 코드는 lib/shared로 옮기세요.",
};

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ["components/**", "lib/client/**", "lib/shared/**"],
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", { patterns: [serverOnly] }],
    },
  },
  {
    files: ["lib/shared/**"],
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            serverOnly,
            { group: ["@/lib/client/**", "@/components/**", "../client/**"], message: "lib/shared는 화면·client 코드에 의존하지 않습니다." },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "coverage/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
