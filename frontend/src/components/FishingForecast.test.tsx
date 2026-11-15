// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { FishingForecast } from "./FishingForecast";
import { fetchForecast } from "../api/forecast";

vi.mock("../api/forecast", () => ({ fetchForecast: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const response = { data_mode: "historical_demo" as const, observation_cutoff:"2025-07-31",
  simulated_issue_date:"2025-08-03",target_start:"2025-08-04",target_end:"2025-08-10",
  cell_id:"test",bounds:{south:25,north:30,west:120,east:125},status:"scored" as const,
  predicted_week_hours:120,repeat_last_week_hours:100,selected_explanation:"Learned seasonal adjustment.",
  data_quality_notes:[],source_dataset:"test",model_version:"saved" };

test("shows the existing model forecast with its own dates", async () => {
  vi.mocked(fetchForecast).mockResolvedValue(response);
  render(<FishingForecast latitude={27.5} longitude={122.5} />);
  fireEvent.click(screen.getByRole("button",{name:"Get historical fishing forecast"}));
  await waitFor(() => expect(screen.getByText("120 vessel-hours expected")).toBeTruthy());
  expect(screen.getByText(/2025-08-04 to 2025-08-10/)).toBeTruthy();
  expect(screen.getByText("Expected change: 20.0%.")).toBeTruthy();
});

test("changing location cancels and clears the previous forecast", async () => {
  vi.mocked(fetchForecast).mockResolvedValue(response);
  const view=render(<FishingForecast latitude={27.5} longitude={122.5} />);
  fireEvent.click(screen.getByRole("button",{name:"Get historical fishing forecast"}));
  await waitFor(() => expect(screen.getByText("120 vessel-hours expected")).toBeTruthy());
  const signal=vi.mocked(fetchForecast).mock.calls[0][2];
  await act(async () => view.rerender(<FishingForecast latitude={40} longitude={10} />));
  expect(signal?.aborted).toBe(true);
  expect(screen.queryByText("120 vessel-hours expected")).toBeNull();
});
