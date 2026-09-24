import { mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config";

export default mergeConfig(baseConfig, {
    resolve: {
        alias: {
            "@durgakiran/glideboard": new URL("../packages/glideboard/src/index.ts", import.meta.url).pathname,
            "@durgakiran/glideline": new URL("../packages/glideline/src/index.ts", import.meta.url).pathname,
        },
    },
    test: {
        fileParallelism: false,
        maxWorkers: 1,
        include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
        coverage: {
            provider: "v8",
            include: [
                "app/components/WhiteboardEditor.tsx",
                "app/space/[spaceId]/whiteboard/[pageId]/versions/[versionId]/page.tsx",
            ],
            reporter: ["text", "json", "json-summary"],
            reportsDirectory: "/tmp/beskar-phase3-ui-coverage",
        },
    },
});
