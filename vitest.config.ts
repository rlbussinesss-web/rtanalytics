import { defineConfig } from "vitest/config";

/**
 * Workspace-wide test runner.
 *
 * The one non-obvious piece is the resolver plugin: the source is TypeScript
 * written for NodeNext, so modules import each other as "./foo.js" even though
 * the file on disk is "./foo.ts". Node resolves that at runtime after
 * compilation; Vite does not, so the plugin maps the extension back before
 * resolution. Without it every relative import in a test fails.
 */
export default defineConfig({
  plugins: [
    {
      name: "resolve-ts-from-js-specifier",
      enforce: "pre",
      async resolveId(source, importer) {
        if (!importer || !source.startsWith(".") || !source.endsWith(".js")) return null;
        const asTs = source.replace(/\.js$/, ".ts");
        const resolved = await this.resolve(asTs, importer, { skipSelf: true });
        return resolved ?? null;
      },
    },
  ],
  test: {
    environment: "node",
    include: ["apps/**/src/**/*.test.ts", "packages/**/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
