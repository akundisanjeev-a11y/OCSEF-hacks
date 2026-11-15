import type { Case, CasesResponse, DataMode, DemoRunResponse, DetectionsResponse } from "./types";
import sampleCases from "@fixtures/samples/cases.synthetic.json";
import sampleDetections from "@fixtures/samples/detections.upload.json";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, init);
  } catch {
    throw new ApiError("Could not reach the frontend dev server. Is npm run dev still running?", null);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // body was not JSON; keep statusText
    }
    throw new ApiError(res.status === 502 ? detail : `${res.status} ${detail}`, res.status);
  }
  return res.json() as Promise<T>;
}

export interface Api {
  listCases(dataMode?: DataMode): Promise<CasesResponse>;
  getCase(observationId: string): Promise<Case>;
  runDemo(): Promise<DemoRunResponse>;
  detect(image: File): Promise<DetectionsResponse>;
}

export const liveApi: Api = {
  listCases: (dataMode) => request(dataMode ? `/cases?data_mode=${encodeURIComponent(dataMode)}` : "/cases"),
  getCase: (id) => request(`/cases/${encodeURIComponent(id)}`),
  runDemo: () => request("/demo/run", { method: "POST" }),
  detect: (image) => {
    const form = new FormData();
    form.append("image", image);
    return request("/detections", { method: "POST", body: form });
  },
};

const samples = {
  cases: sampleCases as CasesResponse,
  detections: sampleDetections as DetectionsResponse,
};

const delay = <T,>(value: T) => new Promise<T>((r) => setTimeout(() => r(value), 250));

export const sampleApi: Api = {
  listCases: (dataMode) =>
    delay({ cases: samples.cases.cases.filter((c) => !dataMode || c.observation.data_mode === dataMode) }),
  getCase: async (id) => {
    const found = samples.cases.cases.find((c) => c.observation.observation_id === id);
    if (!found) throw new ApiError("404 Case not found", 404);
    return delay(found);
  },
  runDemo: () => delay({ case_ids: samples.cases.cases.map((c) => c.observation.observation_id) }),
  detect: () => delay(samples.detections),
};
