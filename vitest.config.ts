import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
    plugins: [solid()],
    // Solid ships separate dev/prod builds; Vitest must pick the dev build for
    // reactivity and a single solid-js instance.
    resolve: {
        conditions: ["development", "browser"],
    },
    test: {
        environment: "jsdom",
        include: ["tests/**/*.test.{ts,tsx,js}"],
        setupFiles: ["tests/setup.ts"],
    },
});
