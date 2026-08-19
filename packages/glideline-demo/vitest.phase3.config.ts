import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        preserveSymlinks: true,
        alias: {
            "@durgakiran/glideboard": new URL("../glideboard/src/index.ts", import.meta.url).pathname,
            "@durgakiran/glideline": new URL("../glideline/src/index.ts", import.meta.url).pathname,
        },
    },
    test: {
        environment: "jsdom",
        fileParallelism: false,
        maxWorkers: 1,
        include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
        coverage: {
            provider: "v8",
            include: ["src/demo-asset-storage.ts", "src/GlideboardDemo.tsx"],
            reporter: ["text", "json", "json-summary"],
            reportsDirectory: "/tmp/beskar-phase3-demo-coverage",
        },
    },
});
