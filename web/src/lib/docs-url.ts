/**
 * Where the documentation lives.
 *
 * It is not in this repository. Earlier releases shipped the docs as MDX under
 * `web/content/docs` and served them from this app at `/docs`; both the source
 * and the renderer have moved to
 * https://github.com/AmJaradat01/burnerbyte-landing, which publishes them at
 * burnerbyte.com/docs.
 *
 * The reason is worth recording, because co-location is the usual advice and
 * this went the other way. Keeping the docs beside the code did not keep them
 * accurate — migration 000050 landed in v1.23.0 and left four pages claiming
 * the wrong count, in this repository. What actually catches that is a check,
 * and the site that publishes the docs is where such a check can run. Moving
 * them also made them readable before you have an instance to read them on,
 * indexable once rather than once per deployment, and took a documentation
 * renderer, a syntax highlighter and a search endpoint out of this image.
 *
 * The cost is that a behaviour change here and its documentation are now two
 * pull requests in two repositories. Nothing enforces that they land together,
 * so it has to be a habit.
 *
 * `NEXT_PUBLIC_DOCS_URL` repoints every link in the app. That is for the
 * deployment with no outbound internet: mirror the docs somewhere reachable and
 * set this, and the UI follows. Like every `NEXT_PUBLIC_*` value it is inlined
 * at build time, so changing it means rebuilding the frontend image.
 */
export const DOCS_URL = (process.env.NEXT_PUBLIC_DOCS_URL || 'https://burnerbyte.com/docs').replace(/\/+$/, '');

/** A documentation page, e.g. `docsUrl('self-hosting/production')`. */
export function docsUrl(path = ''): string {
  const clean = path.replace(/^\/+|\/+$/g, '');
  return clean ? `${DOCS_URL}/${clean}/` : `${DOCS_URL}/`;
}
