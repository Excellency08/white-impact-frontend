(function () {
  "use strict";

  const page = document.body.dataset.page || "";
  const isHome = page === "home";

  // This is only a discreet discovery path; authentication remains required.
  if (!page.startsWith("admin")) {
    document.addEventListener("keydown", (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "a"
      ) {
        event.preventDefault();
        window.location.href = "admin-login.html";
      }
    });
  }

  const workPages = new Set([
    "solutions",
    "projects",
    "project",
    "edu4all",
    "blood-donation",
    "creative-lab",
    "nextgen-ai",
    "nextgen-civic-lab",
  ]);

  const aboutPages = new Set(["our-story", "advisory-board"]);
  const involvementPages = new Set([
    "work-with-us",
    "partner-with-us",
    "donate",
  ]);
  const insightPages = new Set([
    "stories",
    "story",
    "news",
    "news-article",
    "reports",
    "report",
    "search",
  ]);
  const storyPages = new Set(["stories", "story"]);

  const activeIf = (condition) => (condition ? " active" : "");
  const activePage = (...ids) => activeIf(ids.includes(page));
  const activeGroup = (group) => activeIf(group.has(page));

  const workLinks = [
    { href: "solutions.html", label: "All Programs", id: "solutions" },
    { href: "projects.html", label: "Projects", id: "projects" },
    { href: "edu4all.html", label: "Edu4All", id: "edu4all" },
    {
      href: "blood-donation.html",
      label: "Blood Donation",
      id: "blood-donation",
    },
    { href: "creative-lab.html", label: "Creative Lab", id: "creative-lab" },
    { href: "nextgen-ai.html", label: "NextGen AI", id: "nextgen-ai" },
    {
      href: "nextgen-civic-lab.html",
      label: "NextGen Civic Action Lab",
      id: "nextgen-civic-lab",
    },
  ];

  const aboutLinks = [
    { href: "our-story.html", label: "Our Story", id: "our-story" },
    { href: "advisory-board.html", label: "Our Members", id: "advisory-board" },
    { href: "partner-with-us.html", label: "Partners", id: "partner-with-us" },
  ];

  const involvementLinks = [
    { href: "work-with-us.html", label: "Work With Us", id: "work-with-us" },
    {
      href: "partner-with-us.html",
      label: "Partner With Us",
      id: "partner-with-us",
    },
  ];

  const insightLinks = [
    { href: "stories.html", label: "Stories", id: "stories" },
    { href: "news.html", label: "News", id: "news" },
    { href: "reports.html", label: "Reports", id: "reports" },
    { href: "search.html", label: "Search", id: "search" },
    { href: "index.html#impact-report", label: "Insights", id: "home" },
  ];

  function renderLinks(items, baseClass = "nav-link") {
    return items
      .map(
        (item) =>
          `<a href="${item.href}" class="${baseClass}${activePage(item.id)}">${item.label}</a>`,
      )
      .join("");
  }

  function injectStructuredData(data) {
    const existing = document.querySelector("script[data-structured-data]");
    if (existing) existing.remove();
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.dataset.structuredData = "true";
    script.textContent = JSON.stringify(data);
    document.head.appendChild(script);
  }

  injectStructuredData(
    page === "home"
      ? [
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "White Impact Development Initiative",
            url: window.location.origin || "",
            logo: `${window.location.origin || ""}/assets/images/logo.png`,
          },
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "White Impact Development Initiative",
            url: window.location.origin || "",
            potentialAction: {
              "@type": "SearchAction",
              target: `${window.location.origin || ""}/search.html?q={search_term_string}`,
              "query-input": "required name=search_term_string",
            },
          },
        ]
      : {
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: document.title,
          url: window.location.href,
        },
  );

  const headerHTML = `
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header" data-header>
        <div class="top-bar">
            <div class="container top-bar-inner">
                <a href="mailto:whiteimpactinitiative@gmail.com" class="top-link" data-site-email-link>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 4h16v16H4z"/><path d="m22 6-10 7L2 6"/></svg>
                    <span data-site-email-text>whiteimpactinitiative@gmail.com</span>
                </a>
                <a href="tel:+2347065299613" class="top-link" data-site-phone-link>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    <span data-site-phone-text>+234 706 529 9613</span>
                </a>
                                <div class="top-social" aria-label="Social media">
                                        <a href="https://linkedin.com/company/white-initiative-project" aria-label="LinkedIn" target="_blank" rel="noopener noreferrer"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2zM4 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg></a>
                                        <a href="https://www.facebook.com/share/18rQd6wgFj/" aria-label="Facebook" target="_blank" rel="noopener noreferrer"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg></a>
                                        <a href="https://x.com/whiteimpactinitiative" aria-label="X" target="_blank" rel="noopener noreferrer">
                                            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6 L18 18" stroke-linecap="round"/><path d="M18 6 L6 18" stroke-linecap="round"/></svg>
                                        </a>
                                </div>
            </div>
        </div>
        <div class="container header-inner">
            <a class="brand" href="index.html" aria-label="White Impact Development Initiative home">
                <img class="brand-logo" src="assets/images/logo.png" alt="White Impact Development Initiative logo" />
                <span class="brand-text">
                    <span class="brand-name">White Impact Development Initiative</span>
                    <span class="brand-tagline" data-site-brand-tagline>Community-led change</span>
                </span>
            </a>
            <nav class="nav" aria-label="Primary navigation" data-nav>
                <a class="nav-link${activePage("home")}" href="index.html">Home</a>
                <div class="nav-dropdown" data-dropdown>
                    <button class="nav-link nav-btn${activeGroup(workPages)}" type="button" data-dropdown-trigger aria-expanded="false">
                        Our Work
                        <svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
                    </button>
                    <div class="dropdown-panel dropdown-panel-wide">
                        ${renderLinks(workLinks)}
                    </div>
                </div>
                <!-- Impact link removed from primary nav -->
                <div class="nav-dropdown" data-dropdown>
                    <button class="nav-link nav-btn${activeGroup(insightPages)}" type="button" data-dropdown-trigger aria-expanded="false">
                        Insights
                        <svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
                    </button>
                    <div class="dropdown-panel">
                        ${renderLinks(insightLinks)}
                    </div>
                </div>
                <a class="nav-link${activePage("projects")}" href="projects.html">Projects</a>
                <div class="nav-dropdown" data-dropdown>
                    <button class="nav-link nav-btn${activeGroup(aboutPages)}" type="button" data-dropdown-trigger aria-expanded="false">
                        About
                        <svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
                    </button>
                    <div class="dropdown-panel">
                        ${renderLinks(aboutLinks)}
                    </div>
                </div>
                <div class="nav-dropdown" data-dropdown>
                    <button class="nav-link nav-btn${activeGroup(involvementPages)}" type="button" data-dropdown-trigger aria-expanded="false">
                        Get Involved
                        <svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
                    </button>
                    <div class="dropdown-panel">
                        ${renderLinks(involvementLinks)}
                    </div>
                </div>
                <!-- Support Us link removed from primary nav (Donate moved to header actions) -->

            </nav>
            <div class="header-actions">
                <a class="btn btn-primary" href="donate.html">Donate</a>
                <button class="burger" type="button" data-mobile-toggle aria-label="Open menu" aria-controls="mobile-navigation" aria-expanded="false">
                    <span></span><span></span><span></span>
                </button>
            </div>
        </div>
        <nav class="mobile-nav" id="mobile-navigation" aria-label="Mobile navigation" data-mobile-nav hidden>
            <div class="mobile-nav-inner">
                <div class="mobile-nav-section">
                    <p class="mobile-nav-label">Main</p>
                    <a class="mobile-link${activePage("home")}" href="index.html">Home</a>
                    <!-- Impact link removed from mobile nav -->
                    <a class="mobile-link${activeGroup(storyPages)}" href="stories.html">Stories</a>
                    <a class="mobile-link mobile-link-sm" href="news.html">News</a>
                    <a class="mobile-link mobile-link-sm" href="reports.html">Reports</a>
                    <a class="mobile-link mobile-link-sm" href="search.html">Search</a>
                    <a class="mobile-link mobile-link-sm" href="index.html#impact-report">Insights</a>
                    <a class="mobile-link${activePage("projects")}" href="projects.html">Projects</a>
                    <a class="mobile-link mobile-link-sm" href="index.html#contact">Contact</a>
                </div>
                <div class="mobile-nav-section">
                    <p class="mobile-nav-label">Insights</p>
                    ${renderLinks(insightLinks, "mobile-link mobile-link-sm")}
                </div>
                <div class="mobile-nav-section">
                    <p class="mobile-nav-label">Our Work</p>
                    ${renderLinks(workLinks, "mobile-link mobile-link-sm")}
                </div>
                <div class="mobile-nav-section">
                    <p class="mobile-nav-label">About</p>
                    ${renderLinks(aboutLinks, "mobile-link mobile-link-sm")}
                </div>
                <div class="mobile-nav-section">
                    <p class="mobile-nav-label">Get Involved</p>
                    ${renderLinks(involvementLinks, "mobile-link mobile-link-sm")}
                </div>
                <a class="btn btn-primary btn-block" href="donate.html">Donate Now</a>
            </div>
        </nav>
    </header>`;

  const footerHTML = `
    <footer class="site-footer">
        <div class="container footer-grid">
            <div class="footer-brand">
                <a class="brand brand-footer" href="index.html">
                    <span class="brand-icon" aria-hidden="true">WII</span>
                    <span class="brand-name">White Impact Development Initiative</span>
                </a>
                <p data-site-footer-note>
                  Community-led education, digital inclusion, advocacy, and humanitarian support across Nigeria.
                </p>
            </div>
            <div class="footer-links">
                <div class="footer-col">
                    <p class="footer-title">Explore</p>
                    <a href="index.html">Home</a>
                    <a href="index.html#impact">Impact</a>
                    <a href="stories.html">Stories</a>
                    <a href="news.html">News</a>
                    <a href="reports.html">Reports</a>
                </div>
                <div class="footer-col">
                  <p class="footer-title">Our Work</p>
                  <a href="solutions.html">All Programs</a>
                  <a href="projects.html">Projects</a>
                  <a href="work-with-us.html">Get Involved</a>
                  <a href="donate.html">Support Us</a>
                </div>
                <div class="footer-col">
                    <p class="footer-title">Connect</p>
                    <div class="footer-contact">
                        <a href="mailto:whiteimpactinitiative@gmail.com" class="footer-icon-link" data-site-email-link aria-label="Email">
                            <svg class="footer-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 4h16v16H4z"/><path d="m22 6-10 7L2 6"/></svg>
                        </a>
                        <a href="tel:+2347065299613" class="footer-icon-link" data-site-phone-link aria-label="Call">
                            <svg class="footer-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                        </a>
                    </div>
                    <div class="footer-social" aria-label="Social media">
                        <a href="https://linkedin.com/company/white-initiative-project" aria-label="LinkedIn" target="_blank" rel="noopener noreferrer"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2zM4 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg></a>
                        <a href="https://www.facebook.com/share/18rQd6wgFj/" aria-label="Facebook" target="_blank" rel="noopener noreferrer"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg></a>
                        <a href="https://x.com/whiteimpactinitiative" aria-label="X" target="_blank" rel="noopener noreferrer"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6 L18 18" stroke-linecap="round"/><path d="M18 6 L6 18" stroke-linecap="round"/></svg></a>
                    </div>
                </div>
                </div>
            </div>
        </div>
        <div class="container footer-bottom">
            <p>&copy; <span data-year></span> White Impact Development Initiative. All rights reserved.</p>
            <div class="footer-legal">
                <a href="privacy-policy.html">Privacy Policy</a>
                <a href="terms-of-use.html">Terms of Use</a>
            </div>
        </div>
    </footer>
    <button class="back-to-top" type="button" data-back-to-top aria-label="Back to top" hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 15-6-6-6 6"/></svg>
    </button>
    <div class="toast" data-toast hidden role="status" aria-live="polite"></div>`;

  const headerSlot = document.querySelector("[data-site-header]");
  const footerSlot = document.querySelector("[data-site-footer]");

  if (headerSlot) headerSlot.innerHTML = headerHTML;
  if (footerSlot) footerSlot.innerHTML = footerHTML;
})();
