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

export const metadata: Metadata = {
  title: {
    default: "BurnerByte",
    template: "%s — BurnerByte",
  },
  description: "Self-hosted temporary email platform",
  icons: {
    icon: "/favicon.svg",
  },
  manifest: "/manifest.json",
  openGraph: {
    title: "BurnerByte",
    description: "Self-hosted temporary email platform. Create disposable inboxes, protect your privacy, and keep full control of your data.",
    url: "https://burnerbyte.com",
    siteName: "BurnerByte",
    type: "website",
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale() as Locale;
  const messages = await getMessages();
  const dir = rtlLocales.includes(locale) ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir}>
      <body className={`${GeistSans.variable} ${GeistMono.variable} antialiased`} suppressHydrationWarning>
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
