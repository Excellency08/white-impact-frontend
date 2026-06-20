(function () {
    "use strict";

    const page = document.body.dataset.page || "";

    const nav = {
        about: [
            { href: "our-story.html", label: "Our Story", id: "our-story" },
            { href: "advisory-board.html", label: "Our Members", id: "advisory-board" },
        ],
        solutions: [
            { href: "blood-donation.html", label: "Blood Donation", id: "Blood Donation" },
            { href: "edu4all.html", label: "Edu4All", id: "edu4all" },
            { href: "nextgen-civic-lab.html", label: "NextGen Civic Action Lab", id: "nextgen-civic-lab" },
        ],
    };

    function isActive(id) {
        return page === id ? " active" : "";
    }

    function dropdownLinks(items) {
        return items
            .map(
                (item) =>
                    `<a href="${item.href}" class="${isActive(item.id).trim()}">${item.label}</a>`
            )
            .join("");
    }

    const headerHTML = `
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header" data-header>
        <div class="top-bar">
            <div class="container top-bar-inner">
                <a href="mailto:info@whiteimpactinitiative.org" class="top-link">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 4h16v16H4z"/><path d="m22 6-10 7L2 6"/></svg>
                    info@whiteimpactinitiative.org
                </a>
                <a href="tel:+2348146600001" class="top-link">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    +234 814 660 0001
                </a>
                <div class="top-social" aria-label="Social media">
                    <a href="#" aria-label="Facebook"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg></a>
                    <a href="#" aria-label="Twitter / X"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4l7.5 9.5L4 20h2.5l5.5-6.5L16.5 20H20l-7.8-10.2L19.5 4h-2.5l-5 5.8L7.5 4H4z"/></svg></a>
                    <a href="#" aria-label="LinkedIn"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2zM4 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg></a>
                </div>
            </div>
        </div>
        <div class="container header-inner">
            <a class="brand" href="index.html" aria-label="White Impact Development Initiative home">
                <img class="brand-logo" src="assets/images/logo.png" alt="White Impact Development Initiative logo" />
                <span class="brand-text">
                    <span class="brand-name">White Impact Development Initiative</span>
                    <span class="brand-tagline">Community-led change</span>
                </span>
            </a>
            <nav class="nav" aria-label="Primary navigation" data-nav>
                <a class="nav-link${isActive("home")}" href="index.html">Home</a>
                <div class="nav-dropdown" data-dropdown>
                    <button class="nav-link nav-btn${page.startsWith("our") || page === "advisory-board" ? " active" : ""}" type="button" data-dropdown-trigger aria-expanded="false">
                        Our Story
                        <svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
                    </button>
                    <div class="dropdown-panel">${dropdownLinks(nav.about)}</div>
                </div>
                <div class="nav-dropdown" data-dropdown>
                    <button class="nav-link nav-btn${nav.solutions.some((s) => s.id === page) || page === "solutions" ? " active" : ""}" type="button" data-dropdown-trigger aria-expanded="false">
                        Our Programs
                        <svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
                    </button>
                    <div class="dropdown-panel dropdown-panel-wide">
                        ${dropdownLinks(nav.solutions)}
                        <a href="solutions.html"${isActive("solutions")}>View All Programs</a>
                    </div>
                </div>
                <a class="nav-link${isActive("work-with-us")}" href="work-with-us.html">Work With Us</a>
            </nav>
            <div class="header-actions">
                <a class="btn btn-primary" href="donate.html">Donate</a>
                <button class="burger" type="button" data-mobile-toggle aria-label="Open menu" aria-expanded="false">
                    <span></span><span></span><span></span>
                </button>
            </div>
        </div>
        <div class="mobile-nav" data-mobile-nav hidden>
            <div class="mobile-nav-inner">
                <p class="mobile-nav-label">About</p>
                <a class="mobile-link" href="advisory-board.html">Our Members</a>
                <p class="mobile-nav-label">Programs</p>
                <a class="mobile-link" href="solutions.html">All Programs</a>
                <a class="mobile-link" href="edu4all.html">Edu4All</a>
                <a href="creative-lab.html">Creative Lab</a>
                <a class="mobile-link" href="blood-donation.html">Blood Donation</a>
                <a class="mobile-link" href="nextgen-civic-lab.html">NextGen Civic Lab</a>
                <a class="mobile-link" href="work-with-us.html">Work With Us</a>
                <a class="btn btn-primary btn-block" href="donate.html">Donate Now</a>
            </div>
        </div>
    </header>`;

    const footerHTML = `
    <footer class="site-footer">
        <div class="container footer-grid">
            <div class="footer-brand">
                <a class="brand brand-footer" href="index.html">
                    <span class="brand-icon" aria-hidden="true">WII</span>
                    <span class="brand-name">White Impact Development Initiative</span>
                </a>
                <p>Empowering underserved youth and communities through inclusive education, digital skills, and gender justice.</p>
            </div>
            <div class="footer-links">
                <div class="footer-col">
                    <p class="footer-title">Quick Links</p>
                    <a href="our-story.html">About Us</a>
                    <a href="work-with-us.html">Get Involved</a>
                    <a href="donate.html">Donate Now</a>
                    <a href="partner-with-us.html">Partner with Us</a>
                </div>
                <div class="footer-col">
                    <p class="footer-title">Programs</p>
                    <a href="edu4all.html">Edu4All</a>
                    <a href="blood-donation.html">Blood Donation</a>
                    <a href="nextgen-civic-lab.html">NextGen Civic Lab</a>
                    <a href="creative-lab.html">Creative Lab</a>
                    <a href="nextgen-ai.html">NextGen AI</a>
                </div>
                <div class="footer-col">
                    <p class="footer-title">Connect</p>
                    <a href="mailto:info@whiteimpactinitiative.org">info@whiteimpactinitiative.org</a>
                    <a href="tel:+2348146600001">+234 814 660 0001</a>
                    <a href="#">Facebook</a>
                    <a href="#">LinkedIn</a>
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
