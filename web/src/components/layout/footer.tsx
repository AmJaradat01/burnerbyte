"use client";

export function Footer() {

  return (
    <footer className="border-t bg-muted/30 mt-auto">
      <div className="px-4 sm:px-6 py-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span>🔥</span>
            <span>BurnerByte — Self-hosted temporary email</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="https://gitlab.com/burnerbyte/burnerbyte" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">GitLab</a>
            <span>Apache 2.0</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
