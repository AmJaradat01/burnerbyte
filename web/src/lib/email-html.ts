/* HTML-email rendering helpers. Kept separate from the component so the
   privacy/CSP behavior is reusable and unit-tested. */

// Auto-loaded remote references (tracking pixels, hosted images, CSS url()).
// href is excluded: links only leak when clicked, not on open.
export function hasRemoteContent(html: string): boolean {
  return /(?:src|background)\s*=\s*["']?https?:\/\//i.test(html) || /url\(\s*['"]?https?:\/\//i.test(html);
}

export function buildSandboxedHtml(html: string, blockRemote: boolean): string {
  // CSP inside the (script-less) sandbox: 'none' by default, inline styles for
  // email formatting. When blocking, images are limited to embedded data: URIs
  // so tracking pixels can't phone home or leak the reader's IP; loading flips
  // img/media/font to allow https/http on explicit user action.
  const csp = blockRemote
    ? `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;`
    : `default-src 'none'; img-src https: http: data:; media-src https: http: data:; style-src 'unsafe-inline'; font-src https: http: data:;`;
  const head = `
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #1a1a1a; margin: 0; padding: 16px; word-wrap: break-word; }
      img { max-width: 100%; height: auto; }
      a { color: #2563eb; }
      table { max-width: 100%; }
      pre { overflow-x: auto; background: #f5f5f5; padding: 12px; border-radius: 6px; }
    </style>
  `;
  // Always prepend. Splicing the policy in before the sender's own </head>
  // put it *after* anything they had already placed in that head, and a meta
  // CSP only governs what follows it — so a <link rel="stylesheet"> or an
  // @import higher up still fetched, leaking the reader's IP while the
  // interface reported images as blocked. A policy at the very top of the
  // document cannot be outrun by markup order.
  return `${head}${html}`;
}
