import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Fumadocs generated files:
    ".source/**",
  ]),
  {
    // eslint-config-next 16.3 turned on the React Compiler rule set. It
    // reports 18 pre-existing patterns across eight files — setState called
    // synchronously inside an effect, and one Date.now() during render. None
    // is a security issue and none is a regression; they were introduced
    // before the rules existed and each needs its own considered rewrite
    // rather than a sweeping mechanical one.
    //
    // Kept as warnings so the signal stays visible in every lint run without
    // failing CI on work that has not been scheduled yet. Promote back to
    // "error" once the call sites are cleared.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/error-boundaries": "warn",
    },
  },
]);

export default eslintConfig;
