-- Neither avatar column ever worked, and one of them was a privacy hole
-- waiting to open.
--
-- There was no upload path: both held a URL the user typed in. The frontend
-- CSP is "img-src 'self' data: blob:", so every external URL was blocked by
-- the browser and the interface fell back to initials — which is what
-- everyone has actually been looking at. teams.avatar_url went further and
-- was never rendered anywhere at all.
--
-- users.avatar_url was also unvalidated (unlike the team one), and relaxing
-- the CSP to make it render would have handed every user a tracking pixel
-- pointed at their colleagues: set the avatar to a URL you control and
-- collect the IP of every admin who opens the members list. The product
-- blocks remote images in the mail reader for exactly that reason.
--
-- organizations.logo_url is deliberately kept: it is org branding set by an
-- admin and shown to that org's own members, which is a different trust
-- relationship, and it is a documented setup-wizard step.
ALTER TABLE users DROP COLUMN IF EXISTS avatar_url;
ALTER TABLE teams DROP COLUMN IF EXISTS avatar_url;
