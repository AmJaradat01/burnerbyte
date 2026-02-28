import Link from "next/link";

const features = [
  { icon: "📬", title: "Temporary Inboxes", desc: "Create disposable email addresses that auto-expire with configurable TTL." },
  { icon: "👥", title: "Multi-Team", desc: "Organize domains and inboxes across teams with 6-level RBAC." },
  { icon: "⚡", title: "Real-Time", desc: "WebSocket-powered live email delivery — see emails arrive instantly." },
  { icon: "🔗", title: "Webhooks", desc: "HMAC-SHA256 signed delivery with automatic retry and delivery logs." },
  { icon: "🔑", title: "API Keys", desc: "Scoped API keys for programmatic inbox and email management." },
  { icon: "🏠", title: "Self-Hosted", desc: "Full control over your data. Deploy on your own infrastructure." },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b backdrop-blur-sm bg-background/80 sticky top-0 z-50">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-xl font-bold tracking-tight">🔥 BurnerByte</span>
          <div className="flex gap-3">
            <Link href="/login" className="rounded-md px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
              Sign In
            </Link>
            <Link href="/register" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity">
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
          <div className="relative mx-auto max-w-3xl px-6 py-28 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-4 py-1.5 text-sm text-muted-foreground mb-6">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" /></span>
              Open Source · Apache 2.0
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text">
              Self-Hosted Temporary Email
            </h1>
            <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Multi-org, multi-team temporary email platform. Receive emails instantly, protect your privacy, and keep full control of your data.
            </p>
            <div className="mt-10 flex justify-center gap-4">
              <Link href="/register" className="rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity shadow-lg shadow-primary/25">
                Get Started Free
              </Link>
              <Link href="/login" className="rounded-lg border px-8 py-3 text-sm font-semibold hover:bg-muted transition-colors">
                Sign In
              </Link>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-28">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold">Everything you need</h2>
            <p className="mt-2 text-muted-foreground">Built for developers and teams who need disposable email infrastructure.</p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="group rounded-xl border p-6 transition-colors hover:border-primary/50 hover:bg-muted/30">
                <span className="text-3xl mb-3 block">{f.icon}</span>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t bg-muted/30">
          <div className="mx-auto max-w-3xl px-6 py-20 text-center">
            <h2 className="text-2xl font-bold">Ready to get started?</h2>
            <p className="mt-3 text-muted-foreground">Deploy in minutes with Docker. No vendor lock-in.</p>
            <Link href="/register" className="mt-6 inline-block rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity">
              Create Your Account
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        <p>BurnerByte — Open source temporary email platform</p>
        <p className="mt-1 text-xs">Apache 2.0 License</p>
      </footer>
    </div>
  );
}
