# Landing site

Plain HTML and CSS. No dependency installation or build step. Edit files in `public/` and deploy that directory to any static web host.

Local preview from the repository root:

```sh
python3 -m http.server 3001 --directory landing-site/public
```

Open http://localhost:3001. Docker Compose serves the same files with Nginx on port 3001, retaining the existing proxy and health checks.

```sh
docker build -f docker/app/launchsite/Dockerfile -t teddox-landing .
docker run --rm -p 3001:3001 teddox-landing
```

All login and sign-up links point directly to `https://app.teddox.com`. No client-side routing script is needed.

SEO metadata and structured data live in `index.html`; update `sitemap.xml` and `robots.txt` when adding pages or changing the canonical domain. Images and fonts are served locally.
