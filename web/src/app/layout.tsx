import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/layout/app-shell";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { rtlLocales, type Locale } from "@/i18n/request";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://burnerbyte.com";
const SITE_DESCRIPTION =
  "Self-hosted temporary email platform. Create disposable inboxes, protect your privacy, and keep full control of your data.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "BurnerByte",
    template: "%s — BurnerByte",
  },
  description: SITE_DESCRIPTION,
  applicationName: "BurnerByte",
  keywords: [
    "temporary email",
    "disposable email",
    "self-hosted email",
    "burner inbox",
    "privacy",
    "email testing",
    "open source",
  ],
  icons: {
    icon: "/favicon.svg",
  },
  manifest: "/manifest.json",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "BurnerByte — disposable email on infrastructure you own",
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: "BurnerByte",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BurnerByte — disposable email on infrastructure you own",
    description: SITE_DESCRIPTION,
  },
};

// Structured data for rich results: a free, open-source self-hosted app.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "BurnerByte",
  applicationCategory: "SecurityApplication",
  operatingSystem: "Linux, Docker",
  description: SITE_DESCRIPTION,
  url: SITE_URL,
  license: "https://www.apache.org/licenses/LICENSE-2.0",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale() as Locale;
  const messages = await getMessages();
  const dir = rtlLocales.includes(locale) ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir}>
      <body className={`${GeistSans.variable} ${GeistMono.variable} antialiased`} suppressHydrationWarning>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <NextIntlClientProvider messages={messages}>
          <Providers>
            <AppShell>{children}</AppShell>
            <ServiceWorkerRegister />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
