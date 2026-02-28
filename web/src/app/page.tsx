import Link from "next/link";

const features = [
  { title: "Temporary Inboxes", desc: "Create disposable email addresses that auto-expire." },
  { title: "Multi-Team", desc: "Organize domains and inboxes across teams with RBAC." },
  { title: "Real-Time", desc: "WebSocket-powered live email delivery notifications." },
  { title: "Webhooks", desc: "HMAC-signed webhook delivery with retry and logs." },
  { title: "API Keys", desc: "Scoped API keys for programmatic access." },
  { title: "Self-Hosted", desc: "Full control over your data. Deploy anywhere." },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-xl font-bold">🔥 BurnerByte</span>
          <div className="flex gap-3">
            <Link href="/login" className="rounded-md px-4 py-2 text-sm font-medium hover:bg-muted">
              Sign In
            </Link>
            <Link href="/register" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-3xl px-6 py-24 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Self-Hosted Temporary Email
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Open-source, multi-org, multi-team temporary email platform. Receive emails instantly, protect your privacy, and keep full control of your data.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Link href="/register" className="rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90">
              Create Account
            </Link>
            <Link href="/login" className="rounded-md border px-6 py-3 text-sm font-medium hover:bg-muted">
              Sign In
            </Link>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-24">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-lg border p-6">
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t py-6 text-center text-sm text-muted-foreground">
        BurnerByte — Apache 2.0 License
      </footer>
    </div>
  );
}
