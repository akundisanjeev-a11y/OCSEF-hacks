import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

// Share one Vite-bundled worker setup across Josh's globe and the GFW explorer.
setWorkerUrl(workerUrl);
