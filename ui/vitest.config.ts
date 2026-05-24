import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
    plugins: [react()],
    test: {
        environment: "jsdom",
        globals: true,
    },
    resolve: {
        alias: {
            app: path.resolve(__dirname, "app"),
            "@http": path.resolve(__dirname, "app/core/http"),
            "@http/hooks": path.resolve(__dirname, "app/core/http/hooks"),
            "@editor": path.resolve(__dirname, "app/core/editor"),
            "@components": path.resolve(__dirname, "app/components"),
            "@/lib/utils": path.resolve(__dirname, "app/lib/utils"),
        },
    },
});
