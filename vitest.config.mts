import { defineConfig } from "vitest/config";

// Testes do núcleo (core/). Cada arquivo roda isolado, com um núcleo novo e armazenamento em memória.
export default defineConfig({
  test: {
    include: ["core/tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 15_000,
  },
});
