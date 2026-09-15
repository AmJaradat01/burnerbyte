# Brand

| File | Use |
|---|---|
| `icon-lockup.svg` / `icon-512.png` | Repo avatar, README header, anywhere it renders at 64px or larger |
| `favicon.svg` / `favicon-512.png` | Favicon, PWA icon, browser tab — any size where a wordmark cannot survive |

Below roughly 48px the wordmark in the lockup stops being legible, which is why
there are two marks rather than one. The product already behaves this way: the
sidebar shows the full `BurnerByte` wordmark expanded and collapses to a bare
`B`.

## Colours

Both marks use the product tokens from `web/src/app/globals.css`, not
approximations:

| Token | OKLCH | Hex |
|---|---|---|
| `--primary` | `oklch(0.52 0.215 264)` | `#2459E2` |
| `--background` | `oklch(0.984 0.004 265)` | `#F8FAFD` |
| "Byte" tint on indigo | — | `#A9C2FF` |

The favicon previously used `#4F46E5` (Tailwind's indigo) and the web manifest a
warm `#fafaf8`; both were off-brand and are now corrected.

## Regenerating the PNGs

The SVGs reference Geist, so exporting needs the font. Render them in a browser
with `geist` loaded from `web/node_modules/geist/dist/fonts/geist-sans` rather
than converting with a tool that will substitute a system face.

## Type

Geist Sans, weight 800, tracking -14 on the `B` and -2.5 on the wordmark.
