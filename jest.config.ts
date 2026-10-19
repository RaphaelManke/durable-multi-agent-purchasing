import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    // Source uses .js extensions in imports (ESM convention) but ts-jest
    // resolves .ts files. Strip the .js so Jest finds the TypeScript source.
    "^(.*)\\.js$": "$1",
    // Loaded at runtime via createRequire() (it ships in a Lambda layer, not
    // bundled) — Jest's resolver doesn't follow that indirection, so point it
    // at the installed package directly.
    "^@aws/durable-execution-sdk-js-otel$": "<rootDir>/node_modules/@aws/durable-execution-sdk-js-otel/dist-cjs/index.js",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { diagnostics: { ignoreCodes: [151002] } }],
  },
  // Don't transform node_modules — use the pre-compiled CJS bundles.
  transformIgnorePatterns: ["/node_modules/"],
};

export default config;
