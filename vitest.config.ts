import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `vendor/` is composer's tree for the PHP implementation, and
    // `fancy-conformance` ships its OWN vitest suites inside it. Without this
    // exclude, `npm test` runs another package's tests in this repo's report --
    // they fail here for reasons that have nothing to do with this code, and a
    // reader cannot tell which suite a failure belongs to.
    exclude: ["**/node_modules/**", "**/dist/**", "vendor/**", "python/**"],
  },
});
