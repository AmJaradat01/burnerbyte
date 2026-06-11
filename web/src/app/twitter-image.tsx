// Twitter uses the same large-image card as Open Graph. Route config must be
// statically declared here (Next can't parse it across a re-export); only the
// image component is reused.
export { default } from "./opengraph-image";

export const runtime = "nodejs";
export const alt = "BurnerByte — disposable email on infrastructure you own";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
