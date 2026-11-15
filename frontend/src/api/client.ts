import type { Case, CasesResponse, DataMode, DemoRunResponse, DetectionsResponse } from "./types";
import sampleCases from "@fixtures/samples/cases.synthetic.json";
import sampleDetections from "@fixtures/samples/detections.upload.json";
import type { VesselCheckRequest, VesselCheckResponse } from "./types";

// Where API requests go. "/api" is forwarded by the Vite dev server to FastAPI (see vite.config.ts),
// so the browser never talks to the backend directly and no CORS setup is needed.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

// An error from a backend call. status is the HTTP status code, or null if the server could not be reached at all.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

// Sends one request to the backend and returns its JSON, turning failures into readable ApiErrors.
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  // Network failure: the dev server itself is down or unreachable.
  try {
    res = await fetch(`${API_BASE_URL}${path}`, init);
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new ApiError("Could not reach the API. Check that both Vite and FastAPI are running.", null);
  }
  // HTTP error: use FastAPI's {"detail": "..."} message when there is one, otherwise the status text.
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
      else if (typeof body?.detail?.message === "string") detail = body.detail.message;
      else if (Array.isArray(body?.detail)) detail = body.detail.map((e: { msg: string }) => e.msg).join("; ");
    } catch {
      // body was not JSON; keep statusText
    }
    // 502 comes from our own proxy when FastAPI is not running, and its message already says so.
    throw new ApiError(res.status === 502 ? detail : `${res.status} ${detail}`, res.status);
  }
  return res.json() as Promise<T>;
}

// The four backend operations the screens use. The live and sample versions below both follow this shape,
// so a screen works the same way with either one.
export interface Api {
  // GET /cases, optionally filtered by data mode (fictional, published historical, model upload).
  listCases(dataMode?: DataMode): Promise<CasesResponse>;
  // GET /cases/{id}: one case with its full evidence.
  getCase(observationId: string): Promise<Case>;
  // POST /demo/run: the backend runs its fictional scenes through matching and permit checks.
  runDemo(): Promise<DemoRunResponse>;
  // POST /detections: send a radar image and get back the detected ships.
  detect(image: File): Promise<DetectionsResponse>;
}

// The real backend: each function maps to one FastAPI route.
export const liveApi: Api = {
  listCases: (dataMode) => request(dataMode ? `/cases?data_mode=${encodeURIComponent(dataMode)}` : "/cases"),
  getCase: (id) => request(`/cases/${encodeURIComponent(id)}`),
  runDemo: () => request("/demo/run", { method: "POST" }),
  // The image goes up as multipart form data in a field named "image", as the backend contract requires.
  detect: (image) => {
    const form = new FormData();
    form.append("image", image);
    return request("/detections", { method: "POST", body: form });
  },
};

// POST /vessels/check: asks the backend to look up one vessel by its ID numbers.
export function checkVessel(input: VesselCheckRequest): Promise<VesselCheckResponse> {
  return request("/vessels/check", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
}

// The saved sample data (cases and one example detection response) loaded from fixtures/samples/.
const samples = {
  cases: sampleCases as CasesResponse,
  detections: sampleDetections as DetectionsResponse,
};

// Returns the value after a short pause so sample mode shows loading states like a real request would.
const delay = <T,>(value: T) => new Promise<T>((r) => setTimeout(() => r(value), 250));

// A stand-in backend that answers from the saved samples. Lets the whole app run and be demoed with no server.
export const sampleApi = {
  // Same optional data-mode filter as the real /cases route.
  listCases: (dataMode) =>
    delay({ cases: samples.cases.cases.filter((c) => !dataMode || c.observation.data_mode === dataMode) }),
  // Look the case up by id, and fail with a 404 like the real route does when it is missing.
  getCase: async (id) => {
    const found = samples.cases.cases.find((c) => c.observation.observation_id === id);
    if (!found) throw new ApiError("404 Case not found", 404);
    return delay(found);
  },
  // Pretend the demo ran and return every sample case id.
  runDemo: () => delay({ case_ids: samples.cases.cases.map((c) => c.observation.observation_id) }),
  // Always returns the same example detection, whatever image is uploaded.
  detect: () => delay(samples.detections),
} satisfies Api;
