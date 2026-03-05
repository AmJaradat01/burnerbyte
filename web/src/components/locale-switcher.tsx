"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useLocale } from "next-intl";

const labels: Record<string, string> = { en: "EN", ar: "ع" };

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();

  const toggle = () => {
    const next = locale === "en" ? "ar" : "en";
    document.cookie = `locale=${next};path=/;max-age=31536000`;
    document.documentElement.lang = next;
    document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
    router.refresh();
  };

  return (
    <Button variant="ghost" size="sm" onClick={toggle} className="text-xs w-8 h-8 p-0" title="Switch language">
      {labels[locale === "en" ? "ar" : "en"]}
    </Button>
  );
}
