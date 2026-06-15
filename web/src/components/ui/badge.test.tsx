import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./badge";

// Feature: ui-ux-overhaul — shared component test (task 2.10). The overhaul
// added semantic variants (success/warning/info) using design-token colors;
// these assert the variant -> class wiring and base rendering.

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("applies the default variant's primary background", () => {
    render(<Badge>Default</Badge>);
    expect(screen.getByText("Default").className).toContain("bg-primary");
  });

  it("applies semantic token classes for success/warning/info variants", () => {
    const { rerender } = render(<Badge variant="success">ok</Badge>);
    expect(screen.getByText("ok").className).toContain("text-success");

    rerender(<Badge variant="warning">warn</Badge>);
    expect(screen.getByText("warn").className).toContain("text-warning");

    rerender(<Badge variant="info">info</Badge>);
    expect(screen.getByText("info").className).toContain("text-info");
  });

  it("merges a custom className", () => {
    render(<Badge className="custom-x">x</Badge>);
    expect(screen.getByText("x").className).toContain("custom-x");
  });
});
