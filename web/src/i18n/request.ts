import { getRequestConfig } from "next-intl/server";

export const locales = ["en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
export const rtlLocales: Locale[] = [];

export default getRequestConfig(async () => {
  return {
    locale: "en",
    messages: (await import("./messages/en.json")).default,
  };
});
