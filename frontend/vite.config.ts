import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backend = env.BACKEND_URL || "http://localhost:8000";

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@fixtures": fileURLToPath(new URL("../fixtures", import.meta.url)),
      },
    },
    server: {
      port: 5173,
      fs: { allow: [".."] },
      // Same-origin proxy so the FastAPI app needs no CORS setup during development.
      proxy: {
        "/api": {
          target: backend,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
          configure: (proxy) => {
            proxy.on("error", (_err, _req, res) => {
              if ("writeHead" in res && !res.headersSent) {
                res.writeHead(502, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ detail: `Could not reach the backend at ${backend}. Is FastAPI running?` }));
              }
            });
          },
        },
      },
    },
  };
});
