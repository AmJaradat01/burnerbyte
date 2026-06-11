import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LiveInboxDemo } from "./live-inbox-demo";

const labels = { inboxLabel: "Inbox", expiresIn: "expires in", expired: "Expired" };

describe("LiveInboxDemo", () => {
  it("renders the demo inbox with its fixture mail (static preview)", () => {
    render(<LiveInboxDemo labels={labels} staticPreview />);
    expect(screen.getByText("Inbox")).toBeInTheDocument();
    // Fixture senders are present (proves React render + RTL queries work).
    expect(screen.getByText("Stripe")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
  });
});
