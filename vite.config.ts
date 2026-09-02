import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { TEMPLATES } from "./src/engine/templates";

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  // The local Durable Object writes its SQLite files under .wrangler; watching
  // them would reload the page on every agent turn.
  server: { watch: { ignored: ["**/.wrangler/**"] } },
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart({
      // Verdict pages are static content; prerender them so they are indexable.
      prerender: { enabled: true, crawlLinks: true },
      pages: TEMPLATES.filter((t) => t.verdict).map((t) => ({
        path: `/verdict/${t.id}`,
        prerender: { enabled: true },
      })),
    }),
    viteReact(),
  ],
});

export default config;
