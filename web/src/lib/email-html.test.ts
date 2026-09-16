import { describe, it, expect } from "vitest";
import { hasRemoteContent, buildSandboxedHtml } from "./email-html";

describe("hasRemoteContent", () => {
  it("detects auto-loaded remote references", () => {
    expect(hasRemoteContent('<img src="https://tracker.example/p.gif">')).toBe(true);
    expect(hasRemoteContent("<img src='http://x.example/a.png'>")).toBe(true);
    expect(hasRemoteContent('<td background="https://x.example/bg.jpg">')).toBe(true);
    expect(hasRemoteContent("<div style=\"background:url('https://x.example/b.png')\">")).toBe(true);
  });

  it("ignores links and embedded/local content", () => {
    // href only leaks on click, not on open.
    expect(hasRemoteContent('<a href="https://link.example">click</a>')).toBe(false);
    expect(hasRemoteContent('<img src="data:image/png;base64,AAAA">')).toBe(false);
    expect(hasRemoteContent('<img src="/local/logo.png">')).toBe(false);
    expect(hasRemoteContent("<p>just text</p>")).toBe(false);
  });
});

describe("buildSandboxedHtml", () => {
  it("blocks remote images by default (CSP limits img to data:)", () => {
    const out = buildSandboxedHtml("<p>hi</p>", true);
    expect(out).toContain('http-equiv="Content-Security-Policy"');
    expect(out).toContain("default-src 'none'");
    expect(out).toContain("img-src data:");
    expect(out).not.toContain("img-src https:");
  });

  it("allows remote images when explicitly loaded", () => {
    const out = buildSandboxedHtml("<p>hi</p>", false);
    expect(out).toContain("img-src https: http: data:");
  });

  it("injects before </head> when present, else prepends", () => {
    const withHead = buildSandboxedHtml("<html><head><title>x</title></head><body>b</body></html>", true);
    expect(withHead.indexOf("Content-Security-Policy")).toBeLessThan(withHead.indexOf("</head>"));

    const noHead = buildSandboxedHtml("<p>body only</p>", true);
    expect(noHead.indexOf("Content-Security-Policy")).toBeLessThan(noHead.indexOf("<p>body only</p>"));
  });
});

describe("CSP placement", () => {
  // The policy used to be spliced in just before the sender's own </head>,
  // which left it *after* anything they had already put there. A meta CSP
  // only governs what follows it, so remote references higher in the head
  // still fetched — the reader's IP leaked while the UI said images were
  // blocked.
  it("puts the policy ahead of sender markup that already has a head", () => {
    const hostile = `<html><head><link rel="stylesheet" href="http://tracker.test/x.css"></head><body>hi</body></html>`;
    const out = buildSandboxedHtml(hostile, true);
    const cspAt = out.indexOf("Content-Security-Policy");
    const trackerAt = out.indexOf("tracker.test");
    expect(cspAt).toBeGreaterThanOrEqual(0);
    expect(trackerAt).toBeGreaterThanOrEqual(0);
    expect(cspAt).toBeLessThan(trackerAt);
  });

  it("puts the policy first for a bare fragment too", () => {
    const out = buildSandboxedHtml(`<img src="http://tracker.test/p.gif">`, true);
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("tracker.test"));
  });

  it("blocks remote images by default and allows them on opt-in", () => {
    expect(buildSandboxedHtml("<p>x</p>", true)).toContain("img-src data:");
    expect(buildSandboxedHtml("<p>x</p>", false)).toContain("img-src https: http: data:");
  });
});
