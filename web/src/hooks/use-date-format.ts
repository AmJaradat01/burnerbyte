import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

interface DateTimeSettings {
  timezone: string;
  date_format: string;
  time_format: string;
}

const dateFormatOptions: Record<string, Pick<Intl.DateTimeFormatOptions, "year" | "month" | "day">> = {
  "YYYY-MM-DD": { year: "numeric", month: "2-digit", day: "2-digit" },
  "DD/MM/YYYY": { day: "2-digit", month: "2-digit", year: "numeric" },
  "MM/DD/YYYY": { month: "2-digit", day: "2-digit", year: "numeric" },
};

// Locale hints so Intl orders fields correctly
const dateFormatLocale: Record<string, string> = {
  "YYYY-MM-DD": "sv-SE",
  "DD/MM/YYYY": "en-GB",
  "MM/DD/YYYY": "en-US",
};

export function useDateFormat() {
  const user = useAuthStore((s) => s.user);
  const { data: settings } = useQuery({
    queryKey: ["datetime-settings"],
    queryFn: () => api.get<DateTimeSettings>("/auth/datetime-settings"),
    enabled: !!user,
    staleTime: 300000,
  });

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    if (!settings) return date.toLocaleDateString();
    const locale = dateFormatLocale[settings.date_format] ?? undefined;
    return new Intl.DateTimeFormat(locale, {
      ...dateFormatOptions[settings.date_format],
      timeZone: settings.timezone,
    }).format(date);
  };

  const formatDateTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    if (!settings) return date.toLocaleString();
    const locale = dateFormatLocale[settings.date_format] ?? undefined;
    return new Intl.DateTimeFormat(locale, {
      ...dateFormatOptions[settings.date_format],
      hour: "2-digit",
      minute: "2-digit",
      hour12: settings.time_format === "12h",
      timeZone: settings.timezone,
    }).format(date);
  };

  const formatRelative = (dateStr: string): string => {
    const now = Date.now();
    const diff = now - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    if (hours < 48) return "yesterday";
    return formatDate(dateStr);
  };

  return { formatDate, formatDateTime, formatRelative, settings };
}
