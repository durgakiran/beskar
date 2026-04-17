import Image from "next/image";
import { headers } from "next/headers";
import { getAppUrl } from "./getAppUrl";

const siteUrl = "https://teddox.com";

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Teddox",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: siteUrl,
  description:
    "A collaborative workspace for product teams to manage docs, whiteboards, and shared knowledge.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

export default async function Page() {
  const appUrl = getAppUrl(await headers());

  return (
    <main className="site-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(organizationSchema),
        }}
      />
      <header className="topbar">
        <a className="brand" href="/" aria-label="Teddox home">
          <span className="brand-mark" aria-hidden="true">
            <span className="brand-mark-top" />
            <span className="brand-mark-stem" />
            <span className="brand-mark-node" />
          </span>
          <span className="brand-text">Teddox</span>
        </a>
        <nav className="nav" aria-label="Primary">
          <a className="nav-link nav-link-active" href="#product">
            Product
          </a>
          <a className="nav-link" href="#features">
            Features
          </a>
          <a className="nav-link" href="#cta">
            Get Started
          </a>
          <a className="nav-link" href="#resources">
            About
          </a>
        </nav>
        <div className="topbar-actions">
          <a className="text-link" href={appUrl}>
            Log in
          </a>
          <a className="button button-primary button-topbar" href={appUrl}>
            Get Started Free
          </a>
        </div>
      </header>

      <section className="hero" id="hero">
        <div className="hero-copy hero-copy-centered">
          <h1>
            Think together.
            <br />
            Ship together.
          </h1>
          <p className="hero-lede">
            Teddox gives teams one calm workspace for specs, notes, and
            decisions.
          </p>
          <div className="hero-actions">
            <a className="button button-primary button-hero-primary" href={appUrl}>
              Start for Free
            </a>
            <a className="button button-secondary button-hero-secondary" href="#product">
              Watch Demo
            </a>
          </div>
        </div>
        <div className="hero-visual" id="product">
          <div className="hero-screen">
            <Image
              src="/hero-home-screen.png"
              alt="Teddox hero product screen with sidebar and read-only document view"
              priority
              width={2192}
              height={1232}
              sizes="(max-width: 760px) calc(100vw - 48px), (max-width: 1440px) 1040px, 1040px"
            />
          </div>
        </div>
      </section>

      <section className="section" id="features">
        <div className="section-heading">
          <p className="eyebrow">Core features</p>
          <h2>Start with docs. Build a shared source of truth</h2>
          <p>
            Capture knowledge in structured pages, collaborate with context, and
            control who can access what.
          </p>
        </div>
        <div className="feature-grid">
          <article className="feature-card">
            <h3>Structured Docs</h3>
            <p>
              Create clean pages for product specs, meeting notes, plans, and
              decisions your team can revisit anytime.
            </p>
          </article>
          <article className="feature-card">
            <div className="feature-card-head">
              <h3>Whiteboarding</h3>
              <span className="feature-chip">Coming soon</span>
            </div>
            <p>
              Map flows, systems, and ideas on an infinite canvas connected to
              the rest of your workspace.
            </p>
          </article>
          <article className="feature-card">
            <h3>Access You Control</h3>
            <p>
              Set clear permissions at the workspace and page level so the right
              people can view, edit, and share content.
            </p>
          </article>
        </div>
      </section>

      <section className="cta" id="cta">
        <div className="cta-copy">
          <h2>Bring your team&apos;s docs into one place</h2>
          <p>
            Start with the documents your team already relies on, then organize
            them in a workspace built to scale.
          </p>
        </div>
        <a className="button button-primary button-final-cta" href={appUrl}>
          Get Started Free
        </a>
      </section>

      <footer className="footer" id="resources">
        <p className="footer-brand">Teddox</p>
        <p className="footer-copy">
          A calm home for collaborative docs with thoughtful permissions built
          in.
        </p>
        <p className="footer-meta">© 2026 Teddox, Inc. All rights reserved.</p>
      </footer>
    </main>
  );
}
