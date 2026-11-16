# Landing site

Plain HTML, CSS, and JavaScript. No dependency installation or build step. Edit files in `public/` and deploy that directory to any static web host.

Local preview from the repository root:

```sh
python3 -m http.server 3001 --directory landing-site/public
```

Open http://localhost:3001. The landing site is deployed separately from Docker Compose. To serve the same files with a standalone Nginx container:

```sh
docker build -f docker/app/launchsite/Dockerfile -t teddox-landing .
docker run --rm -p 3001:3001 teddox-landing
```

Sign-in and signup link to the app’s `/auth/login` and `/auth/register` routes. The product demos use local WebM videos and WebP posters. Playback runs for one visible demo at a time and respects the visitor’s reduced-motion preference.

SEO metadata and structured data live in `index.html`; update `sitemap.xml` and `robots.txt` when adding pages or changing the canonical domain. Images and fonts are served locally.
