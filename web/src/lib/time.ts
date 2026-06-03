const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

export function timeAgo(date: string | Date, now: number = Date.now()): string {
  const seconds = Math.floor((now - new Date(date).getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < MINUTE) return `${seconds}s ago`;
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m ago`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h ago`;
  if (seconds < DAY * 30) return `${Math.floor(seconds / DAY)}d ago`;
  return new Date(date).toLocaleDateString();
}
