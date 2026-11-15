// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CaseMap } from "./CaseMap";

vi.mock("../mapWorker", () => ({}));
vi.mock("maplibre-gl", () => {
  class Point { constructor(public x: number, public y: number) {} }
  class Map {
    container: HTMLElement;
    canvasContainer: HTMLElement;
    dragPan = { enable: vi.fn(), disable: vi.fn() };
    dragRotate = { enable: vi.fn(), disable: vi.fn() };
    scrollZoom = { isEnabled: () => true, enable: vi.fn(), disable: vi.fn() };
    constructor(options: { container: HTMLElement }) {
      this.container = options.container;
      this.canvasContainer = document.createElement("div");
      this.canvasContainer.className = "maplibregl-canvas-container";
      this.container.append(this.canvasContainer);
    }
    on(event: string, callback: unknown) { if (event === "load") queueMicrotask(() => (callback as () => void)()); }
    addControl() {} addSource() {} addLayer() {} remove() {} resize() {} setProjection() {} fitBounds() {} flyTo() {}
    getLayer() { return true; } setLayoutProperty() {} setPaintProperty() {}
    getSource() { return { setData: vi.fn() }; }
    getCanvasContainer() { return this.canvasContainer; }
    getContainer() { return this.container; }
    unproject(p: Point) { return { lng: p.x / 5 - 50, lat: 40 - p.y / 5 }; }
  }
  return { Map, Point, NavigationControl: class {}, ScaleControl: class {} };
});
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  // MapLibre absolutely positions its canvas. The inner input container has
  // zero layout height even though its parent map viewport is 500 × 300.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const height = this.classList.contains("maplibregl-canvas-container") ? 0 : 300;
    return { x: 0, y: 0, width: 500, height, left: 0, top: 0, right: 500, bottom: height, toJSON: () => ({}) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("an oversized drag turns red and alerts without querying an area", async () => {
  const onAreaChange = vi.fn();
  const view = render(<CaseMap groups={[]} selectedId={null} onSelect={() => {}} area={null} onAreaChange={onAreaChange} activityCells={[]} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Select area" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Select area" }));
  fireEvent.mouseDown(view.container.querySelector(".maplibregl-canvas-container")!, { clientX: 10, clientY: 10, button: 0 });
  fireEvent.mouseMove(window, { clientX: 450, clientY: 120 });
  expect(view.container.querySelector(".drag-box.too-large")).toBeTruthy();
  fireEvent.mouseUp(window, { clientX: 450, clientY: 120 });
  expect(screen.getByRole("alert").textContent).toContain("Area too large");
  expect(onAreaChange).not.toHaveBeenCalled();
  expect(view.container.querySelector(".drag-box")).toBeNull();
});

test("a valid drag selects its bounds, and Escape cancels a later drag", async () => {
  const onAreaChange = vi.fn();
  const onSelectingChange = vi.fn();
  const view = render(<CaseMap groups={[]} selectedId={null} onSelect={() => {}} area={null} onAreaChange={onAreaChange} onSelectingChange={onSelectingChange} activityCells={[]} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Select area" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Select area" }));
  fireEvent.mouseDown(view.container.querySelector(".maplibregl-canvas-container")!, { clientX: 10, clientY: 10, button: 0 });
  fireEvent.mouseMove(window, { clientX: 110, clientY: 110 });
  expect(view.container.querySelector(".drag-box:not(.too-large)")).toBeTruthy();
  expect((view.container.querySelector(".drag-box") as HTMLElement).style.height).toBe("100px");
  fireEvent.mouseUp(window, { clientX: 110, clientY: 110 });
  expect(onAreaChange).toHaveBeenCalledWith({ west: -48, east: -28, south: 18, north: 38 });
  expect(onSelectingChange).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByRole("button", { name: "Select area" }));
  fireEvent.mouseDown(view.container.querySelector(".maplibregl-canvas-container")!, { clientX: 10, clientY: 10, button: 0 });
  fireEvent.mouseMove(window, { clientX: 110, clientY: 110 });
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.mouseUp(window, { clientX: 210, clientY: 110 });
  expect(onAreaChange).toHaveBeenCalledTimes(1);
  expect(view.container.querySelector(".drag-box")).toBeNull();
});
