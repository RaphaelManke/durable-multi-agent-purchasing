import tseslint from "typescript-eslint";
import durablePlugin from "@aws/durable-execution-sdk-js-eslint-plugin";

export default [
  ...tseslint.configs.recommended,
  {
    // Durable functions rules only apply to the durable handlers — the
    // specialist handler and logger are standard Lambda functions where
    // Date.now() and new Date() are safe.
    files: ["src/steps/**/handler.ts", "src/steps/05-split/coordinator.ts"],
    plugins: {
      "@aws/durable-functions": durablePlugin,
    },
    rules: {
      ...durablePlugin.configs.recommended.rules,
    },
  },
];
