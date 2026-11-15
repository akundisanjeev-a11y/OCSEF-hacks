import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Build and dev-server settings for the frontend.
export default defineConfig(({ mode }) => {
  // Read frontend/.env.local (if present) so the backend address can be changed without editing code.
  const env = loadEnv(mode, process.cwd(), "");
  // Where the FastAPI backend runs; port 8000 on this computer unless BACKEND_URL says otherwise.
  const backend = env.BACKEND_URL || "http://localhost:8000";

  return {
    // Lets Vite understand React and JSX.
    plugins: [react()],
    resolve: {
      alias: {
        // "@fixtures/..." imports the sample data from the repo's top-level fixtures/ folder.
        "@fixtures": fileURLToPath(new URL("../fixtures", import.meta.url)),
      },
    },
    server: {
      port: 5173,
      // Allow the dev server to read files outside frontend/ (the fixtures folder).
      fs: { allow: [".."] },
      // Same-origin proxy so the FastAPI app needs no CORS setup during development.
      proxy: {
        // Any request starting with /api is forwarded to the backend.
        "/api": {
          target: backend,
          changeOrigin: true,
          // Strip the "/api" prefix, so /api/cases reaches FastAPI as /cases.
          rewrite: (path) => path.replace(/^\/api/, ""),
          configure: (proxy) => {
            // If FastAPI is not running, answer with a clear 502 JSON message instead of a blank failure.
            // The frontend's request() shows this message to the user.
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
