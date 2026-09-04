/**
 * api.js — Frontend ↔ Backend connector
 *
 * Drop this file in your website root alongside script.js.
 * Add <script src="api.js"></script> BEFORE <script src="script.js"></script>
 * in every HTML page.
 *
 * It patches the existing form handlers in script.js to POST to your backend
 * instead of just showing a toast.
 */

(function () {
  "use strict";

  // Support localhost and LAN access to the local frontend server.
  const isLocal =
    ["localhost", "127.0.0.1"].includes(window.location.hostname) ||
    ["5500", "5501"].includes(window.location.port);
  const API_BASE =
    isLocal
      ? `http://${window.location.hostname}:3030/api`
      : window.__WII_API_BASE__ || "/api";
  const API_ORIGIN = API_BASE.replace(/\/api\/?$/, "");

  const ANALYTICS_SESSION_KEY = "wii.analytics.session";

  function getAnalyticsSessionId() {
    try {
      let sessionId = window.sessionStorage.getItem(ANALYTICS_SESSION_KEY);
      if (!sessionId) {
        sessionId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
        window.sessionStorage.setItem(ANALYTICS_SESSION_KEY, sessionId);
      }
      return sessionId;
    } catch {
      return null;
    }
  }

  function trackAnalyticsEvent(eventKey, metadata = {}) {
    const payload = JSON.stringify({
      eventKey,
      pagePath: window.location.pathname,
      referrer: document.referrer || null,
      sessionId: getAnalyticsSessionId(),
      metadata,
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        `${API_BASE}/analytics/events`,
        new Blob([payload], { type: "application/json" }),
      );
    } else {
      fetch(`${API_BASE}/analytics/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  }

  trackAnalyticsEvent("page_view");

  /* ─── Generic fetch wrapper ───────────────────────────────────── */
  async function parseJsonResponse(res) {
    const body = await res.text();
    if (!body.trim()) {
      throw new Error(`API request failed (${res.status} ${res.statusText || "Unknown error"}).`);
    }
    try {
      return JSON.parse(body);
    } catch {
      throw new Error(`API returned an invalid response (${res.status}).`);
    }
  }

  function formatDateInputValue(value) {
    if (!value) return "";
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  }

  async function apiPost(endpoint, data) {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return parseJsonResponse(res);
  }

  async function apiGet(endpoint) {
    const res = await fetch(`${API_BASE}${endpoint}`, { cache: "no-store" });
    return parseJsonResponse(res);
  }

  const AUTH_STORAGE_KEY = "wii.admin.session";

  function readAdminSession() {
    try {
      const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeAdminSession(session) {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  }

  function clearAdminSession() {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  }

  function getAdminAccessToken() {
    return readAdminSession()?.accessToken || "";
  }

  function getAdminRefreshToken() {
    return readAdminSession()?.refreshToken || "";
  }

  async function refreshAdminSession() {
    const refreshToken = getAdminRefreshToken();
    if (!refreshToken) return null;

    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    const result = await parseJsonResponse(res);
    if (result.success && result.accessToken && result.refreshToken) {
      writeAdminSession({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
      });
      return result;
    }

    clearAdminSession();
    return null;
  }

  async function authRequest(endpoint, options = {}) {
    const headers = {
      ...(options.headers || {}),
    };
    const requestOptions = { ...options };
    delete requestOptions.__retried;

    const session = readAdminSession();
    if (session?.accessToken) {
      headers.Authorization = `Bearer ${session.accessToken}`;
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...requestOptions,
      headers,
    });

    if (res.status !== 401 || requestOptions.__retried) {
      return res;
    }

    const refreshed = await refreshAdminSession();
    if (!refreshed?.accessToken) {
      return res;
    }

    const retryHeaders = {
      ...(options.headers || {}),
      Authorization: `Bearer ${refreshed.accessToken}`,
    };
    return fetch(`${API_BASE}${endpoint}`, {
      ...requestOptions,
      headers: retryHeaders,
    });
  }

  async function authGet(endpoint) {
    const res = await authRequest(endpoint, { method: "GET" });
    return parseJsonResponse(res);
  }

  async function authPost(endpoint, data) {
    const res = await authRequest(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return parseJsonResponse(res);
  }

  async function authUpload(endpoint, formData, method = "POST") {
    const res = await authRequest(endpoint, {
      method,
      body: formData,
    });
    return parseJsonResponse(res);
  }

  async function authPut(endpoint, data) {
    const res = await authRequest(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return parseJsonResponse(res);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatImpactValue(value, suffix = "", prefix = "") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return `${prefix}${Math.round(numeric).toLocaleString()}${suffix}`;
    }
    return `${prefix}${value || "0"}${suffix}`;
  }

  function formatDisplayDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(date);
  }

  function animateImpactNumber(el, value, suffix = "", prefix = "") {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      el.textContent = formatImpactValue(value, suffix, prefix);
      return;
    }

    const duration = 1400;
    const start = performance.now();

    function frame(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.floor(numeric * eased);
      el.textContent = `${prefix}${current.toLocaleString()}${suffix}`;

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        el.textContent = `${prefix}${Math.round(numeric).toLocaleString()}${suffix}`;
      }
    }

    requestAnimationFrame(frame);
  }

  function normalizeProgramListItem(item, fallbackLabel = "") {
    if (!item) return { label: fallbackLabel, summary: "" };
    if (typeof item === "string") {
      return { label: item, summary: "" };
    }

    return {
      label: item.title || item.label || fallbackLabel,
      summary: item.summary || item.description || item.value || "",
      value: item.value || "",
      url: item.url || item.href || "",
      year: item.year || "",
      quote: item.quote || "",
      attribution: item.attribution || item.source || "",
      alt: item.alt || "",
    };
  }

  function updateElementText(root, selector, value) {
    const el = root.querySelector(selector);
    if (el && value !== undefined && value !== null && value !== "") {
      el.textContent = value;
    }
    return el;
  }

  function updateMeta(name, content) {
    if (!content) return;
    const selector = name === "title" ? "title" : `meta[name="${name}"]`;
    let el = document.querySelector(selector);

    if (name === "title") {
      document.title = content;
      return;
    }

    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("name", name);
      document.head.appendChild(el);
    }

    el.setAttribute("content", content);
  }

  function renderProgramCards(programs) {
    const grid = document.querySelector(".solutions-hub-grid");
    if (!grid || !programs.length) return;

    const cards = programs
      .map(
        (program) => `
          <a class="solution-hub-card" href="${escapeHtml(program.pageUrl || `${program.slug}.html`)}" data-animate>
            <div class="solution-hub-icon">${escapeHtml(program.cardIcon || "●")}</div>
            <div>
              <h3>${escapeHtml(program.title)}</h3>
              <p>${escapeHtml(program.cardSummary || program.summary)}</p>
              <span class="program-link">${escapeHtml(program.ctaLabel || "Learn more")} →</span>
            </div>
          </a>
        `,
      )
      .join("");

    const supportCard = `
      <a class="solution-hub-card solution-hub-card-support" href="partner-with-us.html" data-animate>
        <div class="solution-hub-icon">📢</div>
        <div>
          <h3>Partner With Us</h3>
          <p>Evidence-based collaboration for education, digital inclusion, and social protection.</p>
          <span class="program-link">Explore partnerships →</span>
        </div>
      </a>
    `;

    grid.innerHTML = cards + supportCard;
    grid
      .querySelectorAll("[data-animate]")
      .forEach((el) => el.classList.add("visible"));
  }

  function renderProjectCards(projects) {
    const grid = document.querySelector(".solutions-hub-grid");
    if (!grid || !projects.length) return;

    const cards = projects
      .map(
        (project) => `
          <a class="solution-hub-card" href="${escapeHtml(project.pageUrl || `project.html?slug=${encodeURIComponent(project.slug)}`)}" data-animate>
            <div class="solution-hub-icon">${escapeHtml(project.cardIcon || "●")}</div>
            <div>
              <h3>${escapeHtml(project.title)}</h3>
              <p>${escapeHtml(project.cardSummary || project.summary)}</p>
              <span class="program-link">${escapeHtml(project.location || project.programTitle || "View project")} →</span>
            </div>
          </a>
        `,
      )
      .join("");

    grid.innerHTML = cards;
    grid
      .querySelectorAll("[data-animate]")
      .forEach((el) => el.classList.add("visible"));
  }

  function renderStoryCards(stories) {
    const grid = document.querySelector(".stories-grid");
    if (!grid || !stories.length) return;

    const cards = stories
      .map((story) => {
        const tags = Array.isArray(story.tags) ? story.tags.slice(0, 3) : [];
        const tagMarkup = tags.length
          ? `<div class="story-tags">${tags
              .map(
                (tag) =>
                  `<span>${escapeHtml(typeof tag === "string" ? tag : tag.label || tag.title || tag)}</span>`,
              )
              .join("")}</div>`
          : "";

        return `
          <a class="story-card" href="${escapeHtml(story.pageUrl || `story.html?slug=${encodeURIComponent(story.slug)}`)}" data-animate>
            <div class="story-card-image">
              <img src="${escapeHtml(story.heroImageUrl || "./assets/images/hero image.jpeg")}" alt="${escapeHtml(story.heroImageAlt || story.title)}" loading="lazy" />
            </div>
            <div class="story-card-body">
              <p class="story-meta">${escapeHtml(story.authorName || "White Impact Team")} ${story.programTitle ? `• ${escapeHtml(story.programTitle)}` : ""}</p>
              <h3>${escapeHtml(story.title)}</h3>
              <p>${escapeHtml(story.excerpt)}</p>
              ${tagMarkup}
              <span class="program-link">Read story →</span>
            </div>
          </a>
        `;
      })
      .join("");

    grid.innerHTML = cards;
    grid
      .querySelectorAll("[data-animate]")
      .forEach((el) => el.classList.add("visible"));
  }

  function renderNewsCards(newsPosts) {
    const grid = document.querySelector(".news-grid");
    if (!grid || !newsPosts.length) return;

    const cards = newsPosts
      .map((post) => {
        const tags = Array.isArray(post.tags) ? post.tags.slice(0, 2) : [];
        const tagMarkup = tags.length
          ? `<div class="story-tags">${tags
              .map(
                (tag) =>
                  `<span>${escapeHtml(typeof tag === "string" ? tag : tag.label || tag.title || tag)}</span>`,
              )
              .join("")}</div>`
          : "";

        return `
          <a class="news-card" href="${escapeHtml(post.pageUrl || `news-article.html?slug=${encodeURIComponent(post.slug)}`)}" data-animate>
            <div class="news-card-image">
              <img src="${escapeHtml(post.heroImageUrl || "./assets/images/hero image.jpeg")}" alt="${escapeHtml(post.heroImageAlt || post.title)}" loading="lazy" />
            </div>
            <div class="news-card-body">
              <p class="story-meta">${escapeHtml(post.category || "News")} ${post.publicationDate ? `• ${escapeHtml(formatDisplayDate(post.publicationDate))}` : ""}</p>
              <h3>${escapeHtml(post.title)}</h3>
              <p>${escapeHtml(post.excerpt)}</p>
              ${tagMarkup}
              <span class="program-link">Read update →</span>
            </div>
          </a>
        `;
      })
      .join("");

    grid.innerHTML = cards;
    grid
      .querySelectorAll("[data-animate]")
      .forEach((el) => el.classList.add("visible"));
  }

  function renderReportCards(reports) {
    const grid = document.querySelector(".reports-grid");
    if (!grid || !reports.length) return;

    const cards = reports
      .map((report) => {
        const tags = Array.isArray(report.tags) ? report.tags.slice(0, 2) : [];
        const tagMarkup = tags.length
          ? `<div class="story-tags">${tags
              .map(
                (tag) =>
                  `<span>${escapeHtml(typeof tag === "string" ? tag : tag.label || tag.title || tag)}</span>`,
              )
              .join("")}</div>`
          : "";

        return `
          <a class="report-card-item" href="${escapeHtml(report.pageUrl || `report.html?slug=${encodeURIComponent(report.slug)}`)}" data-animate>
            <div class="report-card-item-top">
              <span class="report-card-category">${escapeHtml(report.category || "Publication")}</span>
              <span class="report-card-downloads">${escapeHtml(formatAdminCount(report.downloadCount || 0))} downloads</span>
            </div>
            <div class="report-card-item-body">
              <h3>${escapeHtml(report.title)}</h3>
              <p>${escapeHtml(report.summary)}</p>
              ${tagMarkup}
              <span class="program-link">${escapeHtml(report.fileType || "Open report")} →</span>
            </div>
          </a>
        `;
      })
      .join("");

    grid.innerHTML = cards;
    grid
      .querySelectorAll("[data-animate]")
      .forEach((el) => el.classList.add("visible"));
  }

  function renderStoryContentBlocks(blocks) {
    const items = Array.isArray(blocks) ? blocks : [];
    if (!items.length) {
      return "<p>Story content will appear here once it is published.</p>";
    }

    return items
      .map((block) => {
        if (typeof block === "string") {
          return `<p>${escapeHtml(block)}</p>`;
        }

        const type = String(block.type || "paragraph").toLowerCase();
        const text = escapeHtml(
          block.text || block.content || block.body || "",
        );

        if (type === "quote") {
          return `
            <blockquote class="story-quote">
              <p>${text}</p>
              ${block.attribution ? `<footer>${escapeHtml(block.attribution)}</footer>` : ""}
            </blockquote>
          `;
        }

        if (type === "heading") {
          return `<h3>${text}</h3>`;
        }

        if (type === "list") {
          const listItems = Array.isArray(block.items) ? block.items : [];
          return `
            <ul>
              ${listItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
            </ul>
          `;
        }

        if (type === "image") {
          return `
            <figure class="story-inline-figure">
              <img src="${escapeHtml(block.url || block.src || "")}" alt="${escapeHtml(block.alt || block.caption || "Story image")}" loading="lazy" />
              ${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ""}
            </figure>
          `;
        }

        return `<p>${text}</p>`;
      })
      .join("");
  }

  function renderNewsContentBlocks(blocks) {
    return renderStoryContentBlocks(blocks);
  }

  function renderStoryGallery(gallery) {
    const items = Array.isArray(gallery) ? gallery : [];
    if (!items.length) return "";

    return items
      .map(
        (item) => `
          <figure class="story-gallery-card" data-animate>
            <img src="${escapeHtml(item.url || item.src || "")}" alt="${escapeHtml(item.alt || item.caption || "Story gallery image")}" loading="lazy" />
            ${item.caption ? `<figcaption>${escapeHtml(item.caption)}</figcaption>` : ""}
          </figure>
        `,
      )
      .join("");
  }

  function renderStoryDetailSections(story) {
    const existing = document.querySelector("[data-story-detail]");
    if (existing) {
      existing.remove();
    }

    if (!story?.gallery?.length) return;

    const wrapper = document.createElement("section");
    wrapper.className = "section story-gallery-section";
    wrapper.dataset.storyDetail = "true";
    wrapper.innerHTML = `
      <div class="container">
        <div class="section-head" data-animate>
          <p class="section-kicker">Gallery</p>
          <h2>Story imagery</h2>
          <p class="section-desc">Additional visuals attached to this story record.</p>
        </div>
        <div class="story-gallery-grid">
          ${renderStoryGallery(story.gallery)}
        </div>
      </div>
    `;

    const main = document.querySelector("main");
    const anchor = document.querySelector(".story-page-end");
    if (anchor) {
      anchor.insertAdjacentElement("beforebegin", wrapper);
    } else if (main) {
      main.appendChild(wrapper);
    }
  }

  function renderNewsDetailSections(post) {
    const existing = document.querySelector("[data-news-detail]");
    if (existing) {
      existing.remove();
    }

    const related = Array.isArray(post?.relatedArticles)
      ? post.relatedArticles
      : [];
    if (!related.length) return;

    const wrapper = document.createElement("section");
    wrapper.className = "section news-related-section";
    wrapper.dataset.newsDetail = "true";
    wrapper.innerHTML = `
      <div class="container">
        <div class="section-head" data-animate>
          <p class="section-kicker">Related</p>
          <h2>Related updates</h2>
          <p class="section-desc">Additional articles connected to this news item.</p>
        </div>
        <div class="news-related-grid">
          ${related
            .map((item) => {
              const title =
                typeof item === "string"
                  ? item
                  : item.title || item.label || "Related article";
              const summary =
                typeof item === "string" ? "" : item.summary || "";
              const href =
                typeof item === "string"
                  ? "#"
                  : item.href ||
                    item.url ||
                    `news-article.html?slug=${encodeURIComponent(item.slug || "")}`;
              return `
                <a class="news-related-card" href="${escapeHtml(href)}" data-animate>
                  <strong>${escapeHtml(title)}</strong>
                  ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
                </a>
              `;
            })
            .join("")}
        </div>
      </div>
    `;

    const main = document.querySelector("main");
    const anchor = document.querySelector(".news-page-end");
    if (anchor) {
      anchor.insertAdjacentElement("beforebegin", wrapper);
    } else if (main) {
      main.appendChild(wrapper);
    }
  }

  function renderReportDetailSections(report) {
    const existing = document.querySelector("[data-report-detail]");
    if (existing) {
      existing.remove();
    }

    const wrapper = document.createElement("section");
    wrapper.className = "section report-detail-section";
    wrapper.dataset.reportDetail = "true";
    wrapper.innerHTML = `
      <div class="container">
        <div class="section-head" data-animate>
          <p class="section-kicker">Publication</p>
          <h2>About this report</h2>
          <p class="section-desc">Summary details, file metadata, and a stable download path for the published report.</p>
        </div>
        <div class="report-detail-grid">
          <article class="report-detail-card" data-animate>
            <h3>Overview</h3>
            <p>${escapeHtml(report.summary || "")}</p>
          </article>
          <article class="report-detail-card" data-animate>
            <h3>Details</h3>
            <ul class="program-detail-list">
              <li><strong>Category</strong><span>${escapeHtml(report.category || "Publication")}</span></li>
              <li><strong>File type</strong><span>${escapeHtml(report.fileType || "Document")}</span></li>
              <li><strong>Published</strong><span>${escapeHtml(formatDisplayDate(report.publicationDate || ""))}</span></li>
            </ul>
          </article>
        </div>
      </div>
    `;

    const main = document.querySelector("main");
    const anchor = document.querySelector(".report-page-end");
    if (anchor) {
      anchor.insertAdjacentElement("beforebegin", wrapper);
    } else if (main) {
      main.appendChild(wrapper);
    }
  }

  function applyStoryData(story) {
    if (!story) return;

    updateMeta(
      "title",
      `${story.seoTitle || story.title} | White Impact Development Initiative`,
    );
    updateMeta("description", story.seoDescription || story.excerpt);

    const pageHero = document.querySelector(".page-hero");
    updateElementText(pageHero || document, "h1", story.title);
    updateElementText(pageHero || document, ".page-hero-lead", story.excerpt);
    updateElementText(pageHero || document, ".breadcrumb span", story.title);
    updateElementText(
      pageHero || document,
      "[data-story-date]",
      formatDisplayDate(story.publicationDate || ""),
    );
    updateElementText(
      pageHero || document,
      "[data-story-author]",
      story.authorName || "White Impact Team",
    );
    updateElementText(
      pageHero || document,
      "[data-story-program]",
      story.programTitle || "",
    );
    updateElementText(
      pageHero || document,
      "[data-story-location]",
      story.location || "",
    );

    const storyImage = document.querySelector("[data-story-hero-image]");
    if (storyImage && story.heroImageUrl) {
      storyImage.src = story.heroImageUrl;
      storyImage.alt = story.heroImageAlt || story.title;
    }

    const tags = Array.isArray(story.tags) ? story.tags : [];
    const tagsContainer = document.querySelector("[data-story-tags]");
    if (tagsContainer) {
      tagsContainer.innerHTML = tags.length
        ? tags
            .map(
              (tag) =>
                `<span>${escapeHtml(typeof tag === "string" ? tag : tag.label || tag.title || tag)}</span>`,
            )
            .join("")
        : "<span>Editorial</span>";
    }

    const content = document.querySelector("[data-story-content]");
    if (content) {
      content.innerHTML = renderStoryContentBlocks(story.content);
    }

    const lead = document.querySelector("[data-story-summary]");
    if (lead) {
      lead.textContent = story.excerpt || "";
    }

    const metaBlocks = document.querySelectorAll("[data-story-meta-block]");
    metaBlocks.forEach((block) => {
      const field = block.dataset.storyMetaBlock;
      const value =
        field === "author"
          ? story.authorName || "White Impact Team"
          : field === "program"
            ? story.programTitle || "Program story"
            : field === "location"
              ? story.location || "Nigeria"
              : formatDisplayDate(story.publicationDate || "");
      block.textContent = value;
    });

    const heroBadge = document.querySelector(
      ".page-hero .breadcrumb span:last-child",
    );
    if (heroBadge) {
      heroBadge.textContent = story.title;
    }

    renderStoryDetailSections(story);
  }

  function applyNewsData(post) {
    if (!post) return;

    updateMeta(
      "title",
      `${post.seoTitle || post.title} | White Impact Development Initiative`,
    );
    updateMeta("description", post.seoDescription || post.excerpt);

    const pageHero = document.querySelector(".page-hero");
    updateElementText(pageHero || document, "h1", post.title);
    updateElementText(pageHero || document, ".page-hero-lead", post.excerpt);
    updateElementText(pageHero || document, ".breadcrumb span", post.title);
    updateElementText(
      pageHero || document,
      "[data-news-date]",
      formatDisplayDate(post.publicationDate || ""),
    );
    updateElementText(
      pageHero || document,
      "[data-news-author]",
      post.authorName || "White Impact Team",
    );
    updateElementText(
      pageHero || document,
      "[data-news-category]",
      post.category || "News",
    );

    const heroImage = document.querySelector("[data-news-hero-image]");
    if (heroImage && post.heroImageUrl) {
      heroImage.src = post.heroImageUrl;
      heroImage.alt = post.heroImageAlt || post.title;
    }

    const tags = Array.isArray(post.tags) ? post.tags : [];
    const tagsContainer = document.querySelector("[data-news-tags]");
    if (tagsContainer) {
      tagsContainer.innerHTML = tags.length
        ? tags
            .map(
              (tag) =>
                `<span>${escapeHtml(typeof tag === "string" ? tag : tag.label || tag.title || tag)}</span>`,
            )
            .join("")
        : "<span>News</span>";
    }

    const content = document.querySelector("[data-news-content]");
    if (content) {
      content.innerHTML = renderNewsContentBlocks(post.content);
    }

    const summary = document.querySelector("[data-news-summary]");
    if (summary) {
      summary.textContent = post.excerpt || "";
    }

    renderNewsDetailSections(post);
  }

  function applyReportData(report) {
    if (!report) return;

    updateMeta(
      "title",
      `${report.seoTitle || report.title} | White Impact Development Initiative`,
    );
    updateMeta("description", report.seoDescription || report.summary);

    const pageHero = document.querySelector(".page-hero");
    updateElementText(pageHero || document, "h1", report.title);
    updateElementText(pageHero || document, ".page-hero-lead", report.summary);
    updateElementText(pageHero || document, ".breadcrumb span", report.title);
    updateElementText(
      pageHero || document,
      "[data-report-date]",
      formatDisplayDate(report.publicationDate || ""),
    );
    updateElementText(
      pageHero || document,
      "[data-report-category]",
      report.category || "Publication",
    );
    updateElementText(
      pageHero || document,
      "[data-report-downloads]",
      formatAdminCount(report.downloadCount || 0),
    );

    const heroImage = document.querySelector("[data-report-hero-image]");
    if (heroImage && report.previewUrl) {
      heroImage.src = report.previewUrl;
      heroImage.alt = report.title;
    }

    const heroFrame = document.querySelector("[data-report-hero-frame]");
    if (heroFrame && report.previewUrl) {
      heroFrame.src = report.previewUrl;
    }

    const tags = Array.isArray(report.tags) ? report.tags : [];
    const tagsContainer = document.querySelector("[data-report-tags]");
    if (tagsContainer) {
      tagsContainer.innerHTML = tags.length
        ? tags
            .map(
              (tag) =>
                `<span>${escapeHtml(typeof tag === "string" ? tag : tag.label || tag.title || tag)}</span>`,
            )
            .join("")
        : "<span>Publication</span>";
    }

    const summary = document.querySelector("[data-report-summary]");
    if (summary) {
      summary.textContent = report.summary || "";
    }

    const reportTitle = document.querySelector("[data-report-title]");
    if (reportTitle) {
      reportTitle.textContent = report.title || "Report";
    }

    const details = document.querySelector("[data-report-description]");
    if (details) {
      details.textContent = report.description || report.summary || "";
    }

    const downloadBtn = document.querySelector("[data-report-download]");
    if (downloadBtn) {
      downloadBtn.setAttribute("href", report.fileUrl);
      downloadBtn.textContent = "Download report";
      if (report.fileUrl.endsWith(".pdf")) {
        downloadBtn.setAttribute("target", "_blank");
        downloadBtn.setAttribute("rel", "noopener noreferrer");
      }
      downloadBtn.addEventListener("click", () => {
        trackAnalyticsEvent("report_download", { report: report.slug });
        fetch(`${API_BASE}/reports/${encodeURIComponent(report.slug)}/download`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          keepalive: true,
        }).catch(() => {});
      });
    }

    renderReportDetailSections(report);
  }

  function renderList(items, emptyLabel = "Coming soon") {
    const normalized = (Array.isArray(items) ? items : []).map((item) =>
      normalizeProgramListItem(item, emptyLabel),
    );

    if (!normalized.length) {
      return `<li>${escapeHtml(emptyLabel)}</li>`;
    }

    return normalized
      .map((item) => {
        const title = item.label || emptyLabel;
        const summary = item.summary || "";
        return `<li><strong>${escapeHtml(title)}</strong>${summary ? `<span>${escapeHtml(summary)}</span>` : ""}</li>`;
      })
      .join("");
  }

  function renderProgramMetricCards(metrics) {
    const items = Array.isArray(metrics) ? metrics : [];
    if (!items.length) return "";

    return items
      .map((metric) => {
        const label = metric.label || metric.title || "Metric";
        const value = metric.value || metric.displayValue || "";
        return `
          <article class="program-metric-card" data-animate>
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
          </article>
        `;
      })
      .join("");
  }

  function renderProgramGallery(gallery) {
    const items = Array.isArray(gallery) ? gallery : [];
    if (!items.length) return "";

    return items
      .map(
        (item) => `
          <figure class="program-gallery-card">
            <img src="${escapeHtml(item.url || item.src || "")}" alt="${escapeHtml(item.alt || item.caption || "Program image")}" loading="lazy" />
          </figure>
        `,
      )
      .join("");
  }

  function renderProgramDetailSections(program) {
    const existing = document.querySelector("[data-program-detail]");
    if (existing) {
      existing.remove();
    }

    const sections = [];

    if (
      program.objectives?.length ||
      program.activities?.length ||
      program.beneficiaries?.length ||
      program.locations?.length
    ) {
      sections.push(`
        <section class="section program-detail" data-program-detail>
          <div class="container">
            <div class="section-head" data-animate>
              <p class="section-kicker">Program details</p>
              <h2>What this program includes</h2>
              <p class="section-desc">The following elements are editable in the admin interface and reflect the current database record for this program.</p>
            </div>
            <div class="program-detail-grid">
              <article class="program-detail-card" data-animate>
                <h3>Objectives</h3>
                <ul class="program-detail-list">
                  ${renderList(program.objectives, "No objectives added yet")}
                </ul>
              </article>
              <article class="program-detail-card" data-animate>
                <h3>Activities</h3>
                <ul class="program-detail-list">
                  ${renderList(program.activities, "No activities added yet")}
                </ul>
              </article>
              <article class="program-detail-card" data-animate>
                <h3>Beneficiaries</h3>
                <ul class="program-detail-list">
                  ${renderList(program.beneficiaries, "No beneficiary groups added yet")}
                </ul>
              </article>
              <article class="program-detail-card" data-animate>
                <h3>Locations</h3>
                <ul class="program-detail-list">
                  ${renderList(program.locations, "No locations added yet")}
                </ul>
              </article>
            </div>
          </div>
        </section>
      `);
    }

    if (program.timeline?.length) {
      sections.push(`
        <section class="section section-muted program-timeline-section">
          <div class="container">
            <div class="section-head" data-animate>
              <p class="section-kicker">Timeline</p>
              <h2>Program timeline</h2>
              <p class="section-desc">A simple view of how the current program record is structured over time.</p>
            </div>
            <div class="program-timeline-grid">
              ${program.timeline
                .map((item) => {
                  const normalized = normalizeProgramListItem(item);
                  return `
                    <article class="program-timeline-card" data-animate>
                      <span>${escapeHtml(normalized.year || normalized.label || "")}</span>
                      <h3>${escapeHtml(normalized.label || normalized.year || "Milestone")}</h3>
                      <p>${escapeHtml(normalized.summary || "")}</p>
                    </article>
                  `;
                })
                .join("")}
            </div>
          </div>
        </section>
      `);
    }

    if (program.gallery?.length) {
      sections.push(`
        <section class="section program-gallery-section">
          <div class="container">
            <div class="section-head" data-animate>
              <p class="section-kicker">Gallery</p>
              <h2>Program imagery</h2>
              <p class="section-desc">Images stored with the program record are surfaced here for the public site.</p>
            </div>
            <div class="program-gallery-grid">
              ${renderProgramGallery(program.gallery)}
            </div>
          </div>
        </section>
      `);
    }

    if (
      program.heroStats?.length ||
      program.impactMetrics?.length ||
      program.stories?.length ||
      program.reports?.length ||
      program.partners?.length
    ) {
      sections.push(`
        <section class="section program-impact-section">
          <div class="container">
            <div class="program-impact-grid">
              <div class="program-impact-column" data-animate>
                <p class="section-kicker">Impact</p>
                <h2>Current impact metrics</h2>
                <div class="program-metric-grid">
                  ${renderProgramMetricCards(program.impactMetrics?.length ? program.impactMetrics : program.heroStats)}
                </div>
              </div>
              <div class="program-impact-column program-story-column" data-animate>
                <p class="section-kicker">Stories</p>
                <h2>Program stories</h2>
                ${
                  program.stories?.length
                    ? program.stories
                        .map((story) => {
                          const normalized = normalizeProgramListItem(story);
                          return `
                      <blockquote class="program-story-card">
                        <p>${escapeHtml(normalized.quote || normalized.summary || "")}</p>
                        <footer>${escapeHtml(normalized.attribution || normalized.label || "")}</footer>
                      </blockquote>
                    `;
                        })
                        .join("")
                    : "<p>No stories have been added yet.</p>"
                }
              </div>
            </div>
            <div class="program-resource-grid">
              ${
                program.reports?.length
                  ? `
                <article class="program-resource-card" data-animate>
                  <h3>Reports</h3>
                  <ul class="program-resource-list">
                    ${program.reports
                      .map((report) => {
                        const normalized = normalizeProgramListItem(report);
                        const url = normalized.url || "#";
                        return `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(normalized.label || "Report")}</a><span>${escapeHtml(normalized.summary || "")}</span></li>`;
                      })
                      .join("")}
                  </ul>
                </article>
              `
                  : ""
              }
              ${
                program.partners?.length
                  ? `
                <article class="program-resource-card" data-animate>
                  <h3>Partners</h3>
                  <div class="program-partner-tags">
                    ${program.partners.map((partner) => `<span>${escapeHtml(typeof partner === "string" ? partner : partner.label || partner.title || "")}</span>`).join("")}
                  </div>
                </article>
              `
                  : ""
              }
            </div>
          </div>
        </section>
      `);
    }

    if (!sections.length) return;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = sections.join("");
    wrapper
      .querySelectorAll("[data-animate]")
      .forEach((el) => el.classList.add("visible"));

    const main = document.querySelector("main");
    const anchor = document.querySelector(".page-content");
    if (anchor) {
      anchor.insertAdjacentElement("afterend", wrapper);
    } else if (main) {
      main.appendChild(wrapper);
    }
  }

  function renderProjectDetailSections(project) {
    const existing = document.querySelector("[data-project-detail]");
    if (existing) {
      existing.remove();
    }

    const sections = [];

    if (
      project.objectives?.length ||
      project.outcomes?.length ||
      project.location ||
      project.programTitle
    ) {
      sections.push(`
        <section class="section program-detail" data-project-detail>
          <div class="container">
            <div class="section-head" data-animate>
              <p class="section-kicker">Project details</p>
              <h2>What this project includes</h2>
              <p class="section-desc">The project record is stored in PostgreSQL and can be updated through the admin workflow.</p>
            </div>
            <div class="program-detail-grid">
              <article class="program-detail-card" data-animate>
                <h3>Objectives</h3>
                <ul class="program-detail-list">
                  ${renderList(project.objectives, "No objectives added yet")}
                </ul>
              </article>
              <article class="program-detail-card" data-animate>
                <h3>Outcomes</h3>
                <ul class="program-detail-list">
                  ${renderList(project.outcomes, "No outcomes added yet")}
                </ul>
              </article>
              <article class="program-detail-card" data-animate>
                <h3>Location</h3>
                <ul class="program-detail-list">
                  <li><strong>${escapeHtml(project.location || "Location not set")}</strong><span>${escapeHtml(project.programTitle || "Associated program")}</span></li>
                </ul>
              </article>
              <article class="program-detail-card" data-animate>
                <h3>Status</h3>
                <ul class="program-detail-list">
                  <li><strong>${escapeHtml(project.statusLabel || project.status || "Active")}</strong><span>${escapeHtml(project.statusDetail || "Current project status")}</span></li>
                </ul>
              </article>
            </div>
          </div>
        </section>
      `);
    }

    if (project.timeline?.length) {
      sections.push(`
        <section class="section section-muted program-timeline-section">
          <div class="container">
            <div class="section-head" data-animate>
              <p class="section-kicker">Timeline</p>
              <h2>Project timeline</h2>
              <p class="section-desc">A simple view of the milestones attached to this project record.</p>
            </div>
            <div class="program-timeline-grid">
              ${project.timeline
                .map((item) => {
                  const normalized = normalizeProgramListItem(item);
                  return `
                    <article class="program-timeline-card" data-animate>
                      <span>${escapeHtml(normalized.year || normalized.label || "")}</span>
                      <h3>${escapeHtml(normalized.label || normalized.year || "Milestone")}</h3>
                      <p>${escapeHtml(normalized.summary || "")}</p>
                    </article>
                  `;
                })
                .join("")}
            </div>
          </div>
        </section>
      `);
    }

    if (project.media?.length) {
      sections.push(`
        <section class="section program-gallery-section">
          <div class="container">
            <div class="section-head" data-animate>
              <p class="section-kicker">Media</p>
              <h2>Project imagery</h2>
              <p class="section-desc">These images are surfaced directly from the project record.</p>
            </div>
            <div class="program-gallery-grid">
              ${renderProgramGallery(project.media)}
            </div>
          </div>
        </section>
      `);
    }

    if (
      project.impactMetrics?.length ||
      project.relatedStories?.length ||
      project.reports?.length ||
      project.partners?.length
    ) {
      sections.push(`
        <section class="section program-impact-section">
          <div class="container">
            <div class="program-impact-grid">
              <div class="program-impact-column" data-animate>
                <p class="section-kicker">Impact</p>
                <h2>Current project metrics</h2>
                <div class="program-metric-grid">
                  ${renderProgramMetricCards(project.impactMetrics)}
                </div>
              </div>
              <div class="program-impact-column program-story-column" data-animate>
                <p class="section-kicker">Stories</p>
                <h2>Related stories</h2>
                ${
                  project.relatedStories?.length
                    ? project.relatedStories
                        .map((story) => {
                          const normalized = normalizeProgramListItem(story);
                          return `
                      <blockquote class="program-story-card">
                        <p>${escapeHtml(normalized.quote || normalized.summary || "")}</p>
                        <footer>${escapeHtml(normalized.attribution || normalized.label || "")}</footer>
                      </blockquote>
                    `;
                        })
                        .join("")
                    : "<p>No related stories have been added yet.</p>"
                }
              </div>
            </div>
            <div class="program-resource-grid">
              ${
                project.reports?.length
                  ? `
                <article class="program-resource-card" data-animate>
                  <h3>Reports</h3>
                  <ul class="program-resource-list">
                    ${project.reports
                      .map((report) => {
                        const normalized = normalizeProgramListItem(report);
                        const url = normalized.url || "#";
                        return `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(normalized.label || "Report")}</a><span>${escapeHtml(normalized.summary || "")}</span></li>`;
                      })
                      .join("")}
                  </ul>
                </article>
              `
                  : ""
              }
              ${
                project.partners?.length
                  ? `
                <article class="program-resource-card" data-animate>
                  <h3>Partners</h3>
                  <div class="program-partner-tags">
                    ${project.partners.map((partner) => `<span>${escapeHtml(typeof partner === "string" ? partner : partner.label || partner.title || "")}</span>`).join("")}
                  </div>
                </article>
              `
                  : ""
              }
            </div>
          </div>
        </section>
      `);
    }

    if (!sections.length) return;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = sections.join("");
    wrapper
      .querySelectorAll("[data-animate]")
      .forEach((el) => el.classList.add("visible"));

    const main = document.querySelector("main");
    const anchor = document.querySelector(".page-content");
    if (anchor) {
      anchor.insertAdjacentElement("afterend", wrapper);
    } else if (main) {
      main.appendChild(wrapper);
    }
  }

  function applyProgramData(program) {
    if (!program) return;

    updateMeta(
      "title",
      `${program.seoTitle || program.title} | White Impact Development Initiative`,
    );
    updateMeta("description", program.seoDescription || program.summary);

    const pageHero = document.querySelector(".page-hero");
    updateElementText(pageHero || document, "h1", program.title);
    updateElementText(pageHero || document, ".page-hero-lead", program.summary);
    updateElementText(pageHero || document, ".breadcrumb span", program.title);

    const contentSection = document.querySelector(".page-content");
    if (contentSection) {
      const introHeading = contentSection.querySelector(".prose h2");
      if (introHeading) {
        introHeading.textContent = program.title;
      }

      const introParagraphs = contentSection.querySelectorAll(".prose > p");
      const bodyCopy =
        Array.isArray(program.bodyCopy) && program.bodyCopy.length
          ? program.bodyCopy
          : [program.description];

      introParagraphs.forEach((paragraph, index) => {
        if (bodyCopy[index]) {
          paragraph.textContent = bodyCopy[index];
        }
      });

      const statsInline = contentSection.querySelector(".stats-inline");
      if (
        statsInline &&
        Array.isArray(program.heroStats) &&
        program.heroStats.length
      ) {
        const statItems = statsInline.querySelectorAll("div");
        statItems.forEach((item, index) => {
          const data = program.heroStats[index];
          if (!data) return;
          const strong = item.querySelector("strong");
          const span = item.querySelector("span");
          if (strong) strong.textContent = data.value || data.label || "";
          if (span) span.textContent = data.label || "";
        });
      }

      const featureList = contentSection.querySelector(".feature-list");
      if (
        featureList &&
        Array.isArray(program.featureItems) &&
        program.featureItems.length
      ) {
        featureList.innerHTML = program.featureItems
          .map((item) => {
            const title = item.title || item.label || "";
            const summary = item.summary || item.description || "";
            return `
              <div class="feature-item">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <path d="m9 11 3 3L22 4" />
                </svg>
                <div>
                  <strong>${escapeHtml(title)}</strong>
                  <span>${escapeHtml(summary)}</span>
                </div>
              </div>
            `;
          })
          .join("");
      }

      const visual = contentSection.querySelector(".solution-visual");
      if (visual && program.heroImageUrl) {
        visual.src = program.heroImageUrl;
        visual.alt = program.heroImageAlt || program.title;
      }

      const cta = contentSection.querySelector(".btn.btn-primary");
      if (cta && program.ctaUrl) {
        cta.setAttribute("href", program.ctaUrl);
        cta.textContent = program.ctaLabel || cta.textContent;
        if (program.ctaUrl.endsWith(".pdf")) {
          cta.setAttribute("target", "_blank");
          cta.setAttribute("rel", "noopener noreferrer");
        }
      }
    }

    const heroBadge = document.querySelector(
      ".page-hero .breadcrumb span:last-child",
    );
    if (heroBadge) {
      heroBadge.textContent = program.title;
    }

    renderProgramDetailSections(program);
  }

  function applyProjectData(project) {
    if (!project) return;

    updateMeta(
      "title",
      `${project.seoTitle || project.title} | White Impact Development Initiative`,
    );
    updateMeta("description", project.seoDescription || project.summary);

    const pageHero = document.querySelector(".page-hero");
    updateElementText(pageHero || document, "h1", project.title);
    updateElementText(pageHero || document, ".page-hero-lead", project.summary);
    updateElementText(pageHero || document, ".breadcrumb span", project.title);

    const contentSection = document.querySelector(".page-content");
    if (contentSection) {
      const introHeading = contentSection.querySelector(".prose h2");
      if (introHeading) {
        introHeading.textContent = project.title;
      }

      const introParagraphs = contentSection.querySelectorAll(".prose > p");
      const bodyCopy =
        Array.isArray(project.bodyCopy) && project.bodyCopy.length
          ? project.bodyCopy
          : [project.description];

      introParagraphs.forEach((paragraph, index) => {
        if (bodyCopy[index]) {
          paragraph.textContent = bodyCopy[index];
        }
      });

      const statsInline = contentSection.querySelector(".stats-inline");
      if (
        statsInline &&
        Array.isArray(project.impactMetrics) &&
        project.impactMetrics.length
      ) {
        const statItems = statsInline.querySelectorAll("div");
        statItems.forEach((item, index) => {
          const data = project.impactMetrics[index];
          if (!data) return;
          const strong = item.querySelector("strong");
          const span = item.querySelector("span");
          if (strong) strong.textContent = data.value || "";
          if (span) span.textContent = data.label || "";
        });
      }

      const featureList = contentSection.querySelector(".feature-list");
      if (
        featureList &&
        Array.isArray(project.objectives) &&
        project.objectives.length
      ) {
        featureList.innerHTML = project.objectives
          .map((item) => {
            const title = item.title || item.label || "";
            const summary = item.summary || item.description || "";
            return `
              <div class="feature-item">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <path d="m9 11 3 3L22 4" />
                </svg>
                <div>
                  <strong>${escapeHtml(title)}</strong>
                  <span>${escapeHtml(summary)}</span>
                </div>
              </div>
            `;
          })
          .join("");
      }

      const visual = contentSection.querySelector(".solution-visual");
      if (visual && project.heroImageUrl) {
        visual.src = project.heroImageUrl;
        visual.alt = project.heroImageAlt || project.title;
      }

      const cta = contentSection.querySelector("[data-project-cta]");
      if (cta) {
        const href =
          project.reports?.[0]?.url || project.pageUrl || "work-with-us.html";
        cta.setAttribute("href", href);
        cta.textContent = project.reports?.length
          ? "Open Project Report"
          : "Get Involved";
        if (href.endsWith(".pdf")) {
          cta.setAttribute("target", "_blank");
          cta.setAttribute("rel", "noopener noreferrer");
        }
      }
    }

    renderProjectDetailSections(project);
  }

  async function loadProgramsContent() {
    const page = document.body.dataset.page;
    if (!page) return;

    if (page === "solutions") {
      try {
        const result = await apiGet("/programs");
        if (result.success && Array.isArray(result.data)) {
          renderProgramCards(result.data);
        }
      } catch {
        // Static fallback stays visible.
      }
      return;
    }

    const programPages = new Set([
      "edu4all",
      "blood-donation",
      "nextgen-civic-lab",
      "nextgen-ai",
      "creative-lab",
    ]);

    if (!programPages.has(page)) return;

    try {
      const result = await apiGet(`/programs/${page}`);
      if (result.success && result.data) {
        applyProgramData(result.data);
      }
    } catch {
      // Static fallback stays visible.
    }
  }

  async function loadProjectsContent() {
    const page = document.body.dataset.page;
    if (page !== "projects" && page !== "project") return;

    try {
      if (page === "projects") {
        const result = await apiGet("/projects");
        if (result.success && Array.isArray(result.data)) {
          renderProjectCards(result.data);
        }
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const slug = params.get("slug");
      const endpoint = slug
        ? `/projects/${encodeURIComponent(slug)}`
        : "/projects";
      const result = await apiGet(endpoint);

      if (result.success && result.data) {
        if (Array.isArray(result.data)) {
          applyProjectData(result.data[0]);
        } else {
          applyProjectData(result.data);
        }
      } else if (Array.isArray(result.data) && result.data.length) {
        applyProjectData(result.data[0]);
      }
    } catch {
      // Static fallback remains visible.
    }
  }

  async function loadStoriesContent() {
    const page = document.body.dataset.page;
    if (page !== "stories" && page !== "story") return;

    try {
      if (page === "stories") {
        const result = await apiGet("/stories");
        if (result.success && Array.isArray(result.data)) {
          renderStoryCards(result.data);
        }
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const slug = params.get("slug");

      if (slug) {
        const result = await apiGet(`/stories/${encodeURIComponent(slug)}`);
        if (result.success && result.data) {
          applyStoryData(result.data);
        }
        return;
      }

      const listResult = await apiGet("/stories");
      if (
        listResult.success &&
        Array.isArray(listResult.data) &&
        listResult.data.length
      ) {
        const firstStory = listResult.data[0];
        if (firstStory?.slug) {
          const detailResult = await apiGet(
            `/stories/${encodeURIComponent(firstStory.slug)}`,
          );
          if (detailResult.success && detailResult.data) {
            applyStoryData(detailResult.data);
            return;
          }
        }
        applyStoryData(firstStory);
      }
    } catch {
      // Static fallback remains visible.
    }
  }

  async function loadNewsContent() {
    const page = document.body.dataset.page;
    if (page !== "news" && page !== "news-article") return;

    try {
      if (page === "news") {
        const result = await apiGet("/news");
        if (result.success && Array.isArray(result.data)) {
          renderNewsCards(result.data);
        }
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const slug = params.get("slug");

      if (slug) {
        const result = await apiGet(`/news/${encodeURIComponent(slug)}`);
        if (result.success && result.data) {
          applyNewsData(result.data);
        }
        return;
      }

      const listResult = await apiGet("/news");
      if (
        listResult.success &&
        Array.isArray(listResult.data) &&
        listResult.data.length
      ) {
        const firstPost = listResult.data[0];
        if (firstPost?.slug) {
          const detailResult = await apiGet(
            `/news/${encodeURIComponent(firstPost.slug)}`,
          );
          if (detailResult.success && detailResult.data) {
            applyNewsData(detailResult.data);
            return;
          }
        }
        applyNewsData(firstPost);
      }
    } catch {
      // Static fallback remains visible.
    }
  }

  async function loadReportsContent() {
    const page = document.body.dataset.page;
    if (page !== "reports" && page !== "report") return;

    try {
      if (page === "reports") {
        const result = await apiGet("/reports");
        if (result.success && Array.isArray(result.data)) {
          renderReportCards(result.data);
        }
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const slug = params.get("slug");

      if (slug) {
        const result = await apiGet(`/reports/${encodeURIComponent(slug)}`);
        if (result.success && result.data) {
          applyReportData(result.data);
        }
        return;
      }

      const listResult = await apiGet("/reports");
      if (
        listResult.success &&
        Array.isArray(listResult.data) &&
        listResult.data.length
      ) {
        const firstReport = listResult.data[0];
        if (firstReport?.slug) {
          const detailResult = await apiGet(
            `/reports/${encodeURIComponent(firstReport.slug)}`,
          );
          if (detailResult.success && detailResult.data) {
            applyReportData(detailResult.data);
            return;
          }
        }
        applyReportData(firstReport);
      }
    } catch {
      // Static fallback remains visible.
    }
  }

  function getCmsPage(data, key) {
    return data?.[key] || null;
  }

  function getCmsBody(page) {
    return page && typeof page.body === "object" && page.body !== null
      ? page.body
      : {};
  }

  function setAnchorContent(selector, href, text) {
    const el = document.querySelector(selector);
    if (!el) return;
    if (href) el.setAttribute("href", href);
    if (text) el.textContent = text;
  }

  async function loadCmsContent() {
    const page = document.body.dataset.page;

    try {
      const result = await apiGet("/cms");
      if (!result.success || !result.data) return;

      const siteSettings = getCmsBody(getCmsPage(result.data, "siteSettings"));
      const homepage = getCmsBody(getCmsPage(result.data, "homepage"));
      const hero = getCmsBody(getCmsPage(result.data, "hero"));
      const footer = getCmsBody(getCmsPage(result.data, "footer"));
      const seo = getCmsBody(getCmsPage(result.data, "seo"));
      const partners = getCmsBody(getCmsPage(result.data, "partners"));

      const contact = siteSettings.contact || {};
      const socialLinks = siteSettings.socialLinks || {};
      const footerNote =
        siteSettings.footerNote ||
        footer.intro ||
        "Community-led education, digital inclusion, advocacy, and humanitarian support across Nigeria.";

      setAnchorContent(
        "[data-site-email-link]",
        contact.email ? `mailto:${contact.email}` : null,
        null,
      );
      setAnchorContent(
        "[data-site-phone-link]",
        contact.phone
          ? `tel:${String(contact.phone).replace(/[^+\d]/g, "")}`
          : null,
        null,
      );
      updateElementText(document, "[data-site-email-text]", contact.email);
      updateElementText(document, "[data-site-phone-text]", contact.phone);
      setAnchorContent(
        "[data-site-footer-email]",
        contact.email ? `mailto:${contact.email}` : null,
        contact.email || null,
      );
      setAnchorContent(
        "[data-site-footer-phone]",
        contact.phone
          ? `tel:${String(contact.phone).replace(/[^+\d]/g, "")}`
          : null,
        contact.phone || null,
      );

      updateElementText(
        document,
        "[data-site-brand-tagline]",
        siteSettings.tagline || "Community-led change",
      );
      updateElementText(document, "[data-site-footer-note]", footerNote);

      const seoPageMap = seo.pages || {};
      const seoPageKeyMap = {
        home: "home",
        stories: "stories",
        story: "stories",
        news: "news",
        "news-article": "news",
        reports: "reports",
        report: "reports",
        "partner-with-us": "partner-with-us",
      };
      const seoKey = seoPageKeyMap[page];
      const pageSeo = seoKey ? seoPageMap[seoKey] || {} : {};
      const title = pageSeo.title || (page === "home" ? seo.siteTitle : "");
      const description =
        pageSeo.description ||
        (page === "home" ? seo.siteDescription : "") ||
        homepage.metaDescription ||
        "";

      if (title) {
        updateMeta("title", title);
      }
      if (description) {
        updateMeta("description", description);
      }

      if (page === "home") {
        const heroImage = document.querySelector(".hero-card-img img");
        if (heroImage && hero.heroImageUrl) {
          heroImage.src = hero.heroImageUrl.startsWith("/")
            ? `${API_ORIGIN}${hero.heroImageUrl}`
            : hero.heroImageUrl;
          heroImage.alt = hero.heroImageAlt || "White Impact featured response";
        }
        updateElementText(
          document,
          "[data-home-hero-kicker]",
          hero.kicker ||
            siteSettings.tagline ||
            "Youth led · Community centered · Impact driven",
        );
        updateElementText(
          document,
          "[data-home-hero-title]",
          hero.title ||
            "Changing systems by backing the people already building them.",
        );
        updateElementText(
          document,
          "[data-home-hero-lead]",
          hero.lead ||
            "White Impact Development Initiative works with young people, women, and crisis-affected communities to expand education, digital opportunity, protection, and civic participation across Nigeria.",
        );

        const primary = document.querySelector("[data-home-primary-cta]");
        if (primary) {
          primary.textContent =
            hero.primaryCta?.label || primary.textContent || "See Our Work";
          if (hero.primaryCta?.href)
            primary.setAttribute("href", hero.primaryCta.href);
        }

        const secondary = document.querySelector("[data-home-secondary-cta]");
        if (secondary) {
          secondary.textContent =
            hero.secondaryCta?.label || secondary.textContent || "Get Involved";
          if (hero.secondaryCta?.href)
            secondary.setAttribute("href", hero.secondaryCta.href);
        }

        updateElementText(
          document,
          "[data-home-featured-title]",
          hero.featured?.title || "Edu4All Initiative",
        );
        updateElementText(
          document,
          "[data-home-featured-summary]",
          hero.featured?.summary ||
            "Bridging education gaps for displaced and underserved children.",
        );
      }

      if (page === "partner-with-us") {
        updateElementText(
          document,
          "[data-partner-page-title]",
          siteSettings.partnersTitle || "Stronger Together",
        );
        updateElementText(
          document,
          "[data-partner-page-summary]",
          siteSettings.partnersSummary ||
            "We collaborate with UN agencies, international NGOs, government institutions, corporate partners, and grassroots organizations to maximize impact. Whether you're funding programs, providing technical expertise, or co implementing initiatives we want to hear from you.",
        );
        updateElementText(
          document,
          "[data-partner-page-lead]",
          siteSettings.partnersLead ||
            "Join a network of organizations driving inclusive education, digital equity, and community led development across Nigeria.",
        );

        const track = document.querySelector("[data-partner-track]");
        const logos = Array.isArray(partners.logos) ? partners.logos : [];
        if (track && logos.length) {
          track.innerHTML = logos
            .map((item) => {
              const label =
                typeof item === "string"
                  ? item
                  : item?.name || item?.label || "";
              const href = typeof item === "object" ? item?.href || "" : "";
              const content = escapeHtml(label);
              return href
                ? `<a class="partner-logo" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${content}</a>`
                : `<span class="partner-logo">${content}</span>`;
            })
            .join("");
        }
      }
    } catch {
      // Keep static content visible if CMS hydration fails.
    }
  }

  function formatAdminCount(value) {
    if (Array.isArray(value)) return value.length.toLocaleString();
    if (value && typeof value === "object") {
      if (typeof value.count === "number") return value.count.toLocaleString();
      if (typeof value.total === "number") return value.total.toLocaleString();
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return Math.round(numeric).toLocaleString();
    return String(value || "0");
  }

  function renderAdminSummaryCards(summary) {
    const grid = document.querySelector("[data-admin-summary]");
    if (!grid) return;

    const cards = [
      {
        label: "Programs",
        value: summary.programs,
        href: "solutions.html",
      },
      {
        label: "Projects",
        value: summary.projects,
        href: "projects.html",
      },
      {
        label: "Stories",
        value: summary.stories,
        href: "stories.html",
      },
      {
        label: "Impact metrics",
        value: summary.impact?.summary?.totalMetrics || summary.impact?.metrics,
        href: "index.html#impact",
      },
      {
        label: "News posts",
        value: summary.news,
        href: "news.html",
      },
      {
        label: "Reports",
        value: summary.reports,
        href: "reports.html",
      },
      {
        label: "Contacts",
        value: summary.contacts,
        href: "work-with-us.html",
      },
      {
        label: "Donations",
        value: summary.donations,
        href: "donate.html",
      },
      {
        label: "Team members",
        value: summary.team,
        href: "advisory-board.html",
      },
      {
        label: "Volunteers",
        value: summary.volunteers,
        href: "work-with-us.html",
      },
      {
        label: "Newsletter",
        value: summary.newsletter,
        href: "index.html#support",
      },
      {
        label: "Media assets",
        value: summary.media,
        href: "content-admin.html",
      },
    ];

    grid.innerHTML = cards
      .map(
        (card) => `
          <a class="admin-card" href="${escapeHtml(card.href)}" data-animate>
            <span>${escapeHtml(card.label)}</span>
            <strong>${escapeHtml(formatAdminCount(card.value))}</strong>
            <p>Open linked section</p>
          </a>
        `,
      )
      .join("");

    grid.querySelectorAll("[data-animate]").forEach((el) => {
      el.classList.add("visible");
    });
  }

  function renderAdminAnalytics(result) {
    const grid = document.querySelector("[data-admin-analytics]");
    const status = document.querySelector("[data-admin-analytics-status]");
    if (!grid) return;

    const events = Array.isArray(result?.data?.events) ? result.data.events : [];
    if (!events.length) {
      grid.innerHTML = '<p class="empty-state">No engagement events recorded yet.</p>';
      if (status) status.textContent = "No events yet";
      return;
    }

    grid.innerHTML = events
      .map(
        (event) => `
          <article class="admin-analytics-card">
            <span>${escapeHtml(String(event.event_key).replaceAll("_", " "))}</span>
            <strong>${escapeHtml(formatAdminCount(event.count))}</strong>
            <small>events</small>
          </article>
        `,
      )
      .join("");
    if (status) status.textContent = `Aggregated over ${result.data.days} days`;
  }

  function setAdminPanelState(isAuthed) {
    const loginPanel = document.querySelector("[data-admin-login-panel]");
    const dashboardPanel = document.querySelector(
      "[data-admin-dashboard-panel]",
    );
    if (loginPanel) loginPanel.hidden = isAuthed;
    if (dashboardPanel) dashboardPanel.hidden = !isAuthed;
  }

  function updateAdminIdentity(user) {
    const nameEl = document.querySelector("[data-admin-user-name]");
    const roleEl = document.querySelector("[data-admin-user-role]");
    if (nameEl)
      nameEl.textContent = user?.full_name || user?.fullName || "Admin";
    if (roleEl) roleEl.textContent = user?.role || "content_manager";
  }

  async function loadAdminDashboard() {
    const status = document.querySelector("[data-admin-status]");
    const session = readAdminSession();
    if (!session?.accessToken && !session?.refreshToken) {
      setAdminPanelState(false);
      if (document.body.dataset.page === "admin") {
        window.location.href = "admin-login.html";
      }
      return;
    }

    try {
      const me = await authGet("/auth/me");
      if (!me.success || !me.data) {
        throw new Error("Session unavailable");
      }

      updateAdminIdentity(me.data);
      setAdminPanelState(true);
      if (typeof window._wiiInitContentAdmin === "function") {
        window._wiiInitContentAdmin();
      }
      if (status) status.textContent = "Loading dashboard data…";

      const [
        programsRes,
        projectsRes,
        storiesRes,
        impactRes,
        newsRes,
        reportsRes,
        contactsRes,
        donationsRes,
        teamRes,
        volunteersRes,
        newsletterRes,
        mediaRes,
        analyticsRes,
      ] = await Promise.allSettled([
        authGet("/programs/admin"),
        authGet("/projects/admin"),
        authGet("/stories/admin"),
        authGet("/impact/admin"),
        authGet("/news/admin"),
        authGet("/reports/admin"),
        authGet("/contact"),
        authGet("/donate/list"),
        apiGet("/team"),
        authGet("/volunteers/admin"),
        authGet("/newsletter/admin"),
        authGet("/media/admin"),
        authGet("/analytics/summary?days=30"),
      ]);

      const settledData = (result) =>
        result.status === "fulfilled" ? result.value : null;
      const programsData = settledData(programsRes);
      const projectsData = settledData(projectsRes);
      const storiesData = settledData(storiesRes);
      const impactData = settledData(impactRes);
      const newsData = settledData(newsRes);
      const reportsData = settledData(reportsRes);
      const contactsData = settledData(contactsRes);
      const donationsData = settledData(donationsRes);
      const teamData = settledData(teamRes);
      const volunteersData = settledData(volunteersRes);
      const newsletterData = settledData(newsletterRes);
      const mediaData = settledData(mediaRes);
      const analyticsData = settledData(analyticsRes);

      renderAdminSummaryCards({
        programs: Array.isArray(programsData?.data)
          ? programsData.data.length
          : 0,
        projects: Array.isArray(projectsData?.data)
          ? projectsData.data.length
          : 0,
        stories: Array.isArray(storiesData?.data) ? storiesData.data.length : 0,
        impact: impactData?.data || null,
        news: Array.isArray(newsData?.data) ? newsData.data.length : 0,
        reports: Array.isArray(reportsData?.data) ? reportsData.data.length : 0,
        contacts: Array.isArray(contactsData?.data)
          ? contactsData.data.length
          : 0,
        donations: Array.isArray(donationsData?.data)
          ? donationsData.data.length
          : 0,
        team: Array.isArray(teamData?.data) ? teamData.data.length : 0,
        volunteers: Array.isArray(volunteersData?.data)
          ? volunteersData.data.length
          : 0,
        newsletter: Array.isArray(newsletterData?.data)
          ? newsletterData.data.length
          : 0,
        media: Array.isArray(mediaData?.data) ? mediaData.data.length : 0,
      });
      renderAdminAnalytics(analyticsData);

      if (status) {
        status.textContent = `Signed in as ${me.data.full_name || me.data.fullName || "Admin"}`;
      }
    } catch (error) {
      clearAdminSession();
      setAdminPanelState(false);
      if (document.body.dataset.page === "admin") {
        window.location.href = "admin-login.html";
        return;
      }
      if (status) {
        status.textContent = "Sign in to load the content dashboard.";
      }
      showToast("Your admin session expired. Please sign in again.", "error");
    }
  }

  function initAdminConsole() {
    const page = document.body.dataset.page;
    if (page !== "admin" && page !== "admin-login") return;

    const form = document.querySelector("[data-admin-login-form]");
    const logoutBtn = document.querySelector("[data-admin-logout]");

    document.querySelectorAll("[data-admin-section]").forEach((link) => {
      link.addEventListener("click", () => {
        const tab = document.querySelector(
          `[data-content-admin-tab="${link.dataset.adminSection}"]`,
        );
        if (tab) tab.click();
      });
    });

    if (page === "admin") {
      setAdminPanelState(Boolean(readAdminSession()?.accessToken));
      loadAdminDashboard();
    }

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = form.querySelector('[name="email"]')?.value;
      const password = form.querySelector('[name="password"]')?.value;
      const status = document.querySelector("[data-admin-status]");

      if (!email || !password) return;

      setFormLoading(form, true);
      if (status) status.textContent = "Signing in…";

      try {
        const result = await apiPost("/auth/login", { email, password });
        if (!result.success || !result.accessToken || !result.refreshToken) {
          throw new Error(result.message || "Login failed.");
        }

        writeAdminSession({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt: result.expiresAt,
        });

        form.reset();
        if (page === "admin-login") {
          window.location.href = "admin.html";
        } else {
          await loadAdminDashboard();
          showToast("Signed in successfully.");
        }
      } catch (error) {
        if (status) {
          status.textContent = error.message || "Sign in failed. Please try again.";
        }
        showToast(error.message || "Sign in failed.", "error");
      } finally {
        setFormLoading(form, false);
      }
    });

    logoutBtn?.addEventListener("click", async () => {
      const refreshToken = getAdminRefreshToken();
      if (refreshToken) {
        try {
          await authPost("/auth/logout", { refreshToken });
        } catch {
          // Ignore logout network failures; local session is cleared either way.
        }
      }

      clearAdminSession();
      setAdminPanelState(false);
      const status = document.querySelector("[data-admin-status]");
      if (status) status.textContent = "Signed out.";
      showToast("Signed out successfully.");
    });
  }

  function initContentAdmin() {
    const page = document.body.dataset.page;
    if (page !== "content-admin" && page !== "admin" && page !== "admin-section") return;

    const tabsEl = document.querySelector("[data-content-admin-tabs]");
    const panelsEl = document.querySelector("[data-content-admin-panels]");
    const summaryEl = document.querySelector("[data-content-admin-summary]");
    const statusEl = document.querySelector("[data-content-admin-status]");
    const titleEl = document.querySelector("[data-content-admin-title]");
    const helpEl = document.querySelector("[data-content-admin-help]");
    const refreshBtn = document.querySelector("[data-content-admin-refresh]");
    const logoutBtn = document.querySelector("[data-content-admin-logout]");

    if (!tabsEl || !panelsEl) return;
    if (panelsEl.dataset.contentAdminInitialized === "true") return;

    const configs = {
      programs: {
        label: "Programs",
        singular: "program",
        title: "Programs",
        description:
          "Edit the public program pages, hero content, and supporting JSON sections.",
        load: () => authGet("/programs/admin"),
        save: (record, payload) =>
          record?.id
            ? authPut(`/programs/admin/${record.id}`, payload)
            : authPost("/programs/admin", payload),
        archive: (record) =>
          authPut(`/programs/admin/${record.id}`, { isActive: false, status: "Paused" }),
        itemLabel: (record) =>
          record.title || record.slug || "Untitled program",
        itemMeta: (record) => record.statusLabel || record.status || "Active",
        emptyLabel: "No programs loaded yet.",
        defaultRecord: {
          status: "Draft",
          displayOrder: 0,
          isFeatured: false,
          isActive: true,
          bodyCopy: [],
          heroStats: [],
          featureItems: [],
          objectives: [],
          activities: [],
          beneficiaries: [],
          locations: [],
          timeline: [],
          gallery: [],
          impactMetrics: [],
          stories: [],
          reports: [],
          partners: [],
        },
        fields: [
          { name: "slug", label: "Slug", type: "text", required: true },
          { name: "title", label: "Title", type: "text", required: true },
          {
            name: "summary",
            label: "Summary",
            type: "textarea",
            rows: 3,
            required: true,
          },
          {
            name: "description",
            label: "Description",
            type: "textarea",
            rows: 4,
            required: true,
          },
          { name: "heroImageUrl", label: "Upload hero image", type: "image", accept: "image/*" },
          { name: "heroImageAlt", label: "Hero image alt text", type: "text" },
          { name: "cardIcon", label: "Card icon", type: "text" },
          {
            name: "cardSummary",
            label: "Card summary",
            type: "textarea",
            rows: 3,
          },
          { name: "pageUrl", label: "Page URL", type: "text" },
          { name: "ctaLabel", label: "CTA label", type: "text" },
          { name: "ctaUrl", label: "CTA URL", type: "text" },
          {
            name: "status",
            label: "Status",
            type: "select",
            options: ["Active", "Draft", "Paused"],
          },
          { name: "statusLabel", label: "Status label", type: "text" },
          {
            name: "statusDetail",
            label: "Status detail",
            type: "textarea",
            rows: 3,
          },
          { name: "seoTitle", label: "SEO title", type: "text" },
          {
            name: "seoDescription",
            label: "SEO description",
            type: "textarea",
            rows: 3,
          },
          { name: "displayOrder", label: "Display order", type: "number" },
          { name: "isFeatured", label: "Featured", type: "checkbox" },
          { name: "isActive", label: "Active", type: "checkbox" },
          {
            name: "bodyCopy",
            label: "Body copy",
            type: "json",
            rows: 5,
            help: "Array of body paragraphs.",
          },
          {
            name: "heroStats",
            label: "Hero stats",
            type: "json",
            rows: 5,
            help: "Array of stat objects with label and value.",
          },
          {
            name: "featureItems",
            label: "Feature items",
            type: "json",
            rows: 5,
            help: "Array of feature cards.",
          },
          {
            name: "objectives",
            label: "Objectives",
            type: "json",
            rows: 5,
          },
          {
            name: "activities",
            label: "Activities",
            type: "json",
            rows: 5,
          },
          {
            name: "beneficiaries",
            label: "Beneficiaries",
            type: "json",
            rows: 5,
          },
          { name: "locations", label: "Locations", type: "json", rows: 5 },
          { name: "timeline", label: "Timeline", type: "json", rows: 5 },
          { name: "gallery", label: "Gallery", type: "json", rows: 5 },
          {
            name: "impactMetrics",
            label: "Impact metrics",
            type: "json",
            rows: 5,
          },
          { name: "stories", label: "Stories", type: "json", rows: 5 },
          { name: "reports", label: "Reports", type: "json", rows: 5 },
          { name: "partners", label: "Partners", type: "json", rows: 5 },
        ],
      },
      projects: {
        label: "Projects",
        singular: "project",
        title: "Projects",
        description:
          "Edit project records, linked program slugs, outcome blocks, and media assets.",
        load: () => authGet("/projects/admin"),
        save: (record, payload) =>
          record?.id
            ? authPut(`/projects/admin/${record.id}`, payload)
            : authPost("/projects/admin", payload),
        archive: (record) =>
          authPut(`/projects/admin/${record.id}`, { isActive: false, status: "Paused" }),
        itemLabel: (record) =>
          record.title || record.slug || "Untitled project",
        itemMeta: (record) => record.statusLabel || record.status || "Active",
        emptyLabel: "No projects loaded yet.",
        defaultRecord: {
          status: "Draft",
          displayOrder: 0,
          isFeatured: false,
          isActive: true,
          bodyCopy: [],
          timeline: [],
          objectives: [],
          outcomes: [],
          media: [],
          impactMetrics: [],
          relatedStories: [],
          reports: [],
          partners: [],
        },
        fields: [
          { name: "slug", label: "Slug", type: "text", required: true },
          { name: "title", label: "Title", type: "text", required: true },
          {
            name: "summary",
            label: "Summary",
            type: "textarea",
            rows: 3,
            required: true,
          },
          {
            name: "description",
            label: "Description",
            type: "textarea",
            rows: 4,
            required: true,
          },
          { name: "programSlug", label: "Program slug", type: "text" },
          { name: "location", label: "Location", type: "text" },
          { name: "cardIcon", label: "Card icon", type: "text" },
          {
            name: "cardSummary",
            label: "Card summary",
            type: "textarea",
            rows: 3,
          },
          { name: "heroImageUrl", label: "Upload hero image", type: "image", accept: "image/*" },
          { name: "heroImageAlt", label: "Hero image alt text", type: "text" },
          {
            name: "status",
            label: "Status",
            type: "select",
            options: ["Active", "Draft", "Paused"],
          },
          { name: "statusLabel", label: "Status label", type: "text" },
          {
            name: "statusDetail",
            label: "Status detail",
            type: "textarea",
            rows: 3,
          },
          { name: "seoTitle", label: "SEO title", type: "text" },
          {
            name: "seoDescription",
            label: "SEO description",
            type: "textarea",
            rows: 3,
          },
          { name: "displayOrder", label: "Display order", type: "number" },
          { name: "isFeatured", label: "Featured", type: "checkbox" },
          { name: "isActive", label: "Active", type: "checkbox" },
          { name: "bodyCopy", label: "Body copy", type: "json", rows: 5 },
          { name: "timeline", label: "Timeline", type: "json", rows: 5 },
          {
            name: "objectives",
            label: "Objectives",
            type: "json",
            rows: 5,
          },
          { name: "outcomes", label: "Outcomes", type: "json", rows: 5 },
          { name: "media", label: "Media", type: "json", rows: 5 },
          {
            name: "impactMetrics",
            label: "Impact metrics",
            type: "json",
            rows: 5,
          },
          {
            name: "relatedStories",
            label: "Related stories",
            type: "json",
            rows: 5,
          },
          { name: "reports", label: "Reports", type: "json", rows: 5 },
          { name: "partners", label: "Partners", type: "json", rows: 5 },
        ],
      },
      stories: {
        label: "Stories",
        singular: "story",
        title: "Stories",
        description:
          "Edit narrative story records, author metadata, imagery, and publication settings.",
        load: () => authGet("/stories/admin"),
        save: (record, payload) =>
          record?.id
            ? authPut(`/stories/admin/${record.id}`, payload)
            : authPost("/stories/admin", payload),
        archive: (record) =>
          authPut(`/stories/admin/${record.id}`, { isActive: false, status: "Archived" }),
        itemLabel: (record) => record.title || record.slug || "Untitled story",
        itemMeta: (record) =>
          record.authorName || record.publicationDate || "Story",
        emptyLabel: "No stories loaded yet.",
        defaultRecord: {
          displayOrder: 0,
          isFeatured: false,
          isActive: true,
          content: [],
          images: [],
          gallery: [],
          tags: [],
        },
        fields: [
          { name: "slug", label: "Slug", type: "text", required: true },
          { name: "title", label: "Title", type: "text", required: true },
          {
            name: "excerpt",
            label: "Excerpt",
            type: "textarea",
            rows: 3,
            required: true,
          },
          {
            name: "authorName",
            label: "Author name",
            type: "text",
            required: true,
          },
          { name: "authorRole", label: "Author role", type: "text" },
          { name: "programSlug", label: "Program slug", type: "text" },
          { name: "location", label: "Location", type: "text" },
          { name: "publicationDate", label: "Publication date", type: "date" },
          { name: "heroImageUrl", label: "Upload hero image", type: "image", accept: "image/*" },
          { name: "heroImageAlt", label: "Hero image alt text", type: "text" },
          { name: "seoTitle", label: "SEO title", type: "text" },
          {
            name: "seoDescription",
            label: "SEO description",
            type: "textarea",
            rows: 3,
          },
          { name: "displayOrder", label: "Display order", type: "number" },
          { name: "isFeatured", label: "Featured", type: "checkbox" },
          { name: "isActive", label: "Active", type: "checkbox" },
          {
            name: "content",
            label: "Content blocks",
            type: "json",
            rows: 6,
            required: true,
            help: "Array of content blocks used by the story detail page.",
          },
          {
            name: "images",
            label: "Inline images",
            type: "json",
            rows: 5,
          },
          { name: "gallery", label: "Gallery", type: "json", rows: 5 },
          { name: "tags", label: "Tags", type: "json", rows: 5 },
        ],
      },
      news: {
        label: "News",
        singular: "news article",
        title: "News articles",
        description:
          "Create and update newsroom articles, publication status, imagery, and SEO metadata.",
        load: () => authGet("/news/admin"),
        save: (record, payload) =>
          record?.id
            ? authPut(`/news/admin/${record.id}`, payload)
            : authPost("/news/admin", payload),
        archive: (record) =>
          authPut(`/news/admin/${record.id}`, { isActive: false, status: "Archived" }),
        itemLabel: (record) => record.title || record.slug || "Untitled article",
        itemMeta: (record) => record.status || record.publicationDate || "Draft",
        emptyLabel: "No news articles loaded yet.",
        defaultRecord: {
          status: "Draft",
          displayOrder: 0,
          isFeatured: false,
          isActive: true,
          content: [],
          tags: [],
          relatedArticles: [],
        },
        fields: [
          { name: "slug", label: "Slug", type: "text", required: true },
          { name: "title", label: "Title", type: "text", required: true },
          { name: "excerpt", label: "Excerpt", type: "textarea", rows: 3, required: true },
          { name: "authorName", label: "Author name", type: "text" },
          { name: "authorRole", label: "Author role", type: "text" },
          { name: "category", label: "Category", type: "text" },
          { name: "heroImageUrl", label: "Upload hero image", type: "image", accept: "image/*" },
          { name: "heroImageAlt", label: "Hero image alt text", type: "text" },
          { name: "publicationDate", label: "Publication date", type: "date" },
          { name: "status", label: "Status", type: "select", options: ["Draft", "Review", "Published", "Archived"] },
          { name: "displayOrder", label: "Display order", type: "number" },
          { name: "isFeatured", label: "Featured", type: "checkbox" },
          { name: "isActive", label: "Active", type: "checkbox" },
          { name: "seoTitle", label: "SEO title", type: "text" },
          { name: "seoDescription", label: "SEO description", type: "textarea", rows: 3 },
          { name: "ogImageUrl", label: "Open Graph image URL", type: "text" },
          { name: "content", label: "Content blocks", type: "json", rows: 8, required: true },
          { name: "tags", label: "Tags", type: "json", rows: 4 },
          { name: "relatedArticles", label: "Related articles", type: "json", rows: 4 },
        ],
      },
      reports: {
        label: "Reports",
        singular: "report",
        title: "Reports and publications",
        description:
          "Upload and manage research reports, download links, publication status, and SEO metadata.",
        load: () => authGet("/reports/admin"),
        save: (record, payload) =>
          record?.id
            ? authPut(`/reports/admin/${record.id}`, payload)
            : authPost("/reports/admin", payload),
        archive: (record) =>
          authPut(`/reports/admin/${record.id}`, { isActive: false, status: "Archived" }),
        itemLabel: (record) => record.title || record.slug || "Untitled report",
        itemMeta: (record) => record.status || record.publicationDate || "Draft",
        emptyLabel: "No reports loaded yet.",
        defaultRecord: {
          category: "Publication",
          status: "Draft",
          displayOrder: 0,
          isFeatured: false,
          isActive: true,
          tags: [],
        },
        fields: [
          { name: "slug", label: "Slug", type: "text", required: true },
          { name: "title", label: "Title", type: "text", required: true },
          { name: "summary", label: "Summary", type: "textarea", rows: 3, required: true },
          { name: "description", label: "Description", type: "textarea", rows: 4 },
          { name: "category", label: "Category", type: "text" },
          { name: "fileUrl", label: "Upload report file", type: "asset", required: true, accept: ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document", assetCategory: "document" },
          { name: "fileType", label: "File type", type: "text" },
          { name: "publicationDate", label: "Publication date", type: "date" },
          { name: "status", label: "Status", type: "select", options: ["Draft", "Review", "Published", "Archived"] },
          { name: "displayOrder", label: "Display order", type: "number" },
          { name: "isFeatured", label: "Featured", type: "checkbox" },
          { name: "isActive", label: "Active", type: "checkbox" },
          { name: "seoTitle", label: "SEO title", type: "text" },
          { name: "seoDescription", label: "SEO description", type: "textarea", rows: 3 },
          { name: "ogImageUrl", label: "Open Graph image URL", type: "text" },
          { name: "tags", label: "Tags", type: "json", rows: 4 },
        ],
      },
      impact: {
        label: "Impact metrics",
        singular: "metric",
        title: "Impact metrics",
        description:
          "Edit the homepage impact metrics that power the animated counters and bars.",
        load: () => authGet("/impact/admin"),
        loadRecords: (result) =>
          Array.isArray(result?.data?.metrics) ? result.data.metrics : [],
        save: (record, payload) =>
          record?.id
            ? authPut(`/impact/admin/metrics/${record.id}`, payload)
            : authPost("/impact/admin/metrics", payload),
        itemLabel: (record) => record.label || record.metricKey || "Metric",
        itemMeta: (record) =>
          record.displayValue || record.category || "Overview",
        emptyLabel: "No metrics loaded yet.",
        defaultRecord: {
          category: "overview",
          displayPrefix: "",
          displaySuffix: "",
          description: "",
          sortOrder: 0,
          isActive: true,
        },
        fields: [
          {
            name: "metricKey",
            label: "Metric key",
            type: "text",
            required: true,
            readOnlyOnUpdate: true,
          },
          { name: "label", label: "Label", type: "text", required: true },
          { name: "value", label: "Value", type: "number", required: true },
          { name: "displayPrefix", label: "Display prefix", type: "text" },
          { name: "displaySuffix", label: "Display suffix", type: "text" },
          {
            name: "description",
            label: "Description",
            type: "textarea",
            rows: 3,
          },
          {
            name: "category",
            label: "Category",
            type: "select",
            options: ["overview", "chart"],
          },
          { name: "sortOrder", label: "Sort order", type: "number" },
          { name: "isActive", label: "Active", type: "checkbox" },
        ],
      },
      "site-settings": {
        label: "Site Settings",
        singular: "settings record",
        title: "Site Settings",
        description:
          "Edit shared contact details, social links, and global brand settings.",
        load: () => authGet("/cms/admin"),
        loadRecords: (result) =>
          Array.isArray(result?.data)
            ? result.data.filter((page) => page.pageKey === "site-settings")
            : [],
        save: (record, payload) =>
          record?.id
            ? authPut(`/cms/admin/${record.id}`, payload)
            : authPost("/cms/admin", payload),
        itemLabel: (record) => record.title || "Site settings",
        itemMeta: (record) => record.pageType || "global",
        emptyLabel: "No site settings record loaded yet.",
        defaultRecord: {
          pageKey: "site-settings",
          pageType: "global",
          status: "Draft",
          isActive: true,
          body: {},
          settings: {},
        },
        fields: [
          {
            name: "pageKey",
            label: "Page key",
            type: "text",
            required: true,
            readOnlyOnUpdate: true,
          },
          {
            name: "pageType",
            label: "Page type",
            type: "select",
            options: ["global", "page", "section", "collection"],
          },
          { name: "title", label: "Title", type: "text", required: true },
          { name: "summary", label: "Summary", type: "textarea", rows: 3 },
          { name: "heroImageUrl", label: "Upload hero image", type: "image", accept: "image/*" },
          { name: "heroImageAlt", label: "Hero image alt text", type: "text" },
          { name: "seoTitle", label: "SEO title", type: "text" },
          {
            name: "seoDescription",
            label: "SEO description",
            type: "textarea",
            rows: 3,
          },
          {
            name: "status",
            label: "Status",
            type: "select",
            options: ["Draft", "Review", "Published", "Archived"],
          },
          { name: "displayOrder", label: "Display order", type: "number" },
          { name: "isActive", label: "Active", type: "checkbox" },
          {
            name: "body",
            label: "Body",
            type: "json",
            rows: 8,
            help: "Global site settings such as contact details, social links, and footer copy.",
          },
          {
            name: "settings",
            label: "Settings",
            type: "json",
            rows: 6,
            help: "Optional structured settings used by the header, footer, and theme.",
          },
        ],
      },
      homepage: {
        label: "Homepage",
        singular: "homepage record",
        title: "Homepage",
        description:
          "Edit the homepage narrative, section order, and supporting copy.",
        load: () => authGet("/cms/admin"),
        loadRecords: (result) =>
          Array.isArray(result?.data)
            ? result.data.filter((page) => page.pageKey === "homepage")
            : [],
        save: (record, payload) =>
          record?.id
            ? authPut(`/cms/admin/${record.id}`, payload)
            : authPost("/cms/admin", payload),
        itemLabel: (record) => record.title || "Homepage",
        itemMeta: (record) => record.status || "Draft",
        emptyLabel: "No homepage record loaded yet.",
        defaultRecord: {
          pageKey: "homepage",
          pageType: "page",
          status: "Draft",
          isActive: true,
          body: {},
          settings: {},
        },
        fields: [
          {
            name: "pageKey",
            label: "Page key",
            type: "text",
            required: true,
            readOnlyOnUpdate: true,
          },
          {
            name: "pageType",
            label: "Page type",
            type: "select",
            options: ["page", "section", "global", "collection"],
          },
          { name: "title", label: "Title", type: "text", required: true },
          { name: "summary", label: "Summary", type: "textarea", rows: 3 },
          { name: "seoTitle", label: "SEO title", type: "text" },
          {
            name: "seoDescription",
            label: "SEO description",
            type: "textarea",
            rows: 3,
          },
          {
            name: "status",
            label: "Status",
            type: "select",
            options: ["Draft", "Review", "Published", "Archived"],
          },
          { name: "displayOrder", label: "Display order", type: "number" },
          { name: "isActive", label: "Active", type: "checkbox" },
          {
            name: "body",
            label: "Body",
            type: "json",
            rows: 10,
            help: "Homepage sections, messaging, and layout sequence.",
          },
          {
            name: "settings",
            label: "Settings",
            type: "json",
            rows: 6,
          },
        ],
      },
      hero: {
        label: "Hero",
        singular: "hero record",
        title: "Hero",
        description:
          "Edit the homepage hero copy, calls to action, and featured response.",
        load: () => authGet("/cms/admin"),
        loadRecords: (result) =>
          Array.isArray(result?.data)
            ? result.data.filter((page) => page.pageKey === "hero")
            : [],
        save: (record, payload) =>
          record?.id
            ? authPut(`/cms/admin/${record.id}`, payload)
            : authPost("/cms/admin", payload),
        itemLabel: (record) => record.title || "Hero",
        itemMeta: (record) => record.status || "Draft",
        emptyLabel: "No hero record loaded yet.",
        defaultRecord: {
          pageKey: "hero",
          pageType: "section",
          status: "Draft",
          isActive: true,
          body: {},
          settings: {},
        },
        fields: [
          {
            name: "pageKey",
            label: "Page key",
            type: "text",
            required: true,
            readOnlyOnUpdate: true,
          },
          {
            name: "pageType",
            label: "Page type",
            type: "select",
            options: ["section", "page", "global", "collection"],
          },
          { name: "title", label: "Title", type: "text", required: true },
          { name: "summary", label: "Summary", type: "textarea", rows: 3 },
          { name: "heroImageUrl", label: "Upload hero image", type: "image", accept: "image/*" },
          { name: "heroImageAlt", label: "Hero image alt text", type: "text" },
          { name: "seoTitle", label: "SEO title", type: "text" },
          {
            name: "seoDescription",
            label: "SEO description",
            type: "textarea",
            rows: 3,
          },
          {
            name: "status",
            label: "Status",
            type: "select",
            options: ["Draft", "Review", "Published", "Archived"],
          },
          { name: "displayOrder", label: "Display order", type: "number" },
          { name: "isActive", label: "Active", type: "checkbox" },
          {
            name: "body",
            label: "Body",
            type: "json",
            rows: 10,
            help: "Hero kicker, title, lead, buttons, and featured response copy.",
          },
          {
            name: "settings",
            label: "Settings",
            type: "json",
            rows: 6,
          },
        ],
      },
      footer: {
        label: "Footer",
        singular: "footer record",
        title: "Footer",
        description:
          "Edit shared footer copy, connector labels, and site-wide links.",
        load: () => authGet("/cms/admin"),
        loadRecords: (result) =>
          Array.isArray(result?.data)
            ? result.data.filter((page) => page.pageKey === "footer")
            : [],
        save: (record, payload) =>
          record?.id
            ? authPut(`/cms/admin/${record.id}`, payload)
            : authPost("/cms/admin", payload),
        itemLabel: (record) => record.title || "Footer",
        itemMeta: (record) => record.status || "Draft",
        emptyLabel: "No footer record loaded yet.",
        defaultRecord: {
          pageKey: "footer",
          pageType: "global",
          status: "Draft",
          isActive: true,
          body: {},
          settings: {},
        },
        fields: [
          {
            name: "pageKey",
            label: "Page key",
            type: "text",
            required: true,
            readOnlyOnUpdate: true,
          },
          {
            name: "pageType",
            label: "Page type",
            type: "select",
            options: ["global", "page", "section", "collection"],
          },
          { name: "title", label: "Title", type: "text", required: true },
          { name: "summary", label: "Summary", type: "textarea", rows: 3 },
          { name: "seoTitle", label: "SEO title", type: "text" },
          {
            name: "seoDescription",
            label: "SEO description",
            type: "textarea",
            rows: 3,
          },
          {
            name: "status",
            label: "Status",
            type: "select",
            options: ["Draft", "Review", "Published", "Archived"],
          },
          { name: "displayOrder", label: "Display order", type: "number" },
          { name: "isActive", label: "Active", type: "checkbox" },
          {
            name: "body",
            label: "Body",
            type: "json",
            rows: 8,
            help: "Footer links, address, social connectors, and support copy.",
          },
          {
            name: "settings",
            label: "Settings",
            type: "json",
            rows: 6,
          },
        ],
      },
      seo: {
        label: "SEO",
        singular: "SEO record",
        title: "SEO",
        description:
          "Edit default page titles, meta descriptions, and SEO copy.",
        load: () => authGet("/cms/admin"),
        loadRecords: (result) =>
          Array.isArray(result?.data)
            ? result.data.filter((page) => page.pageKey === "seo")
            : [],
        save: (record, payload) =>
          record?.id
            ? authPut(`/cms/admin/${record.id}`, payload)
            : authPost("/cms/admin", payload),
        itemLabel: (record) => record.title || "SEO defaults",
        itemMeta: (record) => record.status || "Draft",
        emptyLabel: "No SEO record loaded yet.",
        defaultRecord: {
          pageKey: "seo",
          pageType: "global",
          status: "Draft",
          isActive: true,
          body: {},
          settings: {},
        },
        fields: [
          {
            name: "pageKey",
            label: "Page key",
            type: "text",
            required: true,
            readOnlyOnUpdate: true,
          },
          {
            name: "pageType",
            label: "Page type",
            type: "select",
            options: ["global", "page", "section", "collection"],
          },
          { name: "title", label: "Title", type: "text", required: true },
          { name: "summary", label: "Summary", type: "textarea", rows: 3 },
          { name: "seoTitle", label: "SEO title", type: "text" },
          {
            name: "seoDescription",
            label: "SEO description",
            type: "textarea",
            rows: 3,
          },
          {
            name: "status",
            label: "Status",
            type: "select",
            options: ["Draft", "Review", "Published", "Archived"],
          },
          { name: "displayOrder", label: "Display order", type: "number" },
          { name: "isActive", label: "Active", type: "checkbox" },
          {
            name: "body",
            label: "Body",
            type: "json",
            rows: 10,
            help: "Global SEO defaults and page-specific title/description maps.",
          },
          {
            name: "settings",
            label: "Settings",
            type: "json",
            rows: 6,
          },
        ],
      },
      partners: {
        label: "Partners",
        singular: "partner record",
        title: "Partners",
        description:
          "Edit the partner logos and collaboration references shown on public pages.",
        load: () => authGet("/cms/admin"),
        loadRecords: (result) =>
          Array.isArray(result?.data)
            ? result.data.filter((page) => page.pageKey === "partners")
            : [],
        save: (record, payload) =>
          record?.id
            ? authPut(`/cms/admin/${record.id}`, payload)
            : authPost("/cms/admin", payload),
        itemLabel: (record) => record.title || "Partners",
        itemMeta: (record) => record.status || "Draft",
        emptyLabel: "No partner record loaded yet.",
        defaultRecord: {
          pageKey: "partners",
          pageType: "collection",
          status: "Draft",
          isActive: true,
          body: {},
          settings: {},
        },
        fields: [
          {
            name: "pageKey",
            label: "Page key",
            type: "text",
            required: true,
            readOnlyOnUpdate: true,
          },
          {
            name: "pageType",
            label: "Page type",
            type: "select",
            options: ["collection", "page", "section", "global"],
          },
          { name: "title", label: "Title", type: "text", required: true },
          { name: "summary", label: "Summary", type: "textarea", rows: 3 },
          { name: "seoTitle", label: "SEO title", type: "text" },
          {
            name: "seoDescription",
            label: "SEO description",
            type: "textarea",
            rows: 3,
          },
          {
            name: "status",
            label: "Status",
            type: "select",
            options: ["Draft", "Review", "Published", "Archived"],
          },
          { name: "displayOrder", label: "Display order", type: "number" },
          { name: "isActive", label: "Active", type: "checkbox" },
          {
            name: "body",
            label: "Body",
            type: "json",
            rows: 10,
            help: "Array or object describing partner names, logos, and links.",
          },
          {
            name: "settings",
            label: "Settings",
            type: "json",
            rows: 6,
          },
        ],
      },
      events: {
        label: "Events",
        singular: "event record",
        title: "Events",
        description:
          "Edit upcoming event highlights, calls to action, and event metadata.",
        load: () => authGet("/cms/admin"),
        loadRecords: (result) =>
          Array.isArray(result?.data)
            ? result.data.filter((page) => page.pageKey === "events")
            : [],
        save: (record, payload) =>
          record?.id
            ? authPut(`/cms/admin/${record.id}`, payload)
            : authPost("/cms/admin", payload),
        itemLabel: (record) => record.title || "Events",
        itemMeta: (record) => record.status || "Draft",
        emptyLabel: "No event record loaded yet.",
        defaultRecord: {
          pageKey: "events",
          pageType: "collection",
          status: "Draft",
          isActive: true,
          body: {},
          settings: {},
        },
        fields: [
          {
            name: "pageKey",
            label: "Page key",
            type: "text",
            required: true,
            readOnlyOnUpdate: true,
          },
          {
            name: "pageType",
            label: "Page type",
            type: "select",
            options: ["collection", "page", "section", "global"],
          },
          { name: "title", label: "Title", type: "text", required: true },
          { name: "summary", label: "Summary", type: "textarea", rows: 3 },
          { name: "seoTitle", label: "SEO title", type: "text" },
          {
            name: "seoDescription",
            label: "SEO description",
            type: "textarea",
            rows: 3,
          },
          {
            name: "status",
            label: "Status",
            type: "select",
            options: ["Draft", "Review", "Published", "Archived"],
          },
          { name: "displayOrder", label: "Display order", type: "number" },
          { name: "isActive", label: "Active", type: "checkbox" },
          {
            name: "body",
            label: "Body",
            type: "json",
            rows: 10,
            help: "Event list items, dates, locations, and CTA links.",
          },
          {
            name: "settings",
            label: "Settings",
            type: "json",
            rows: 6,
          },
        ],
      },
      media: {
        label: "Media",
        singular: "media asset",
        title: "Media library",
        description:
          "Upload shared images, PDFs, documents, videos, and logos for public pages and downloads.",
        load: () => authGet("/media/admin"),
        save: (record, payload) =>
          record?.id
            ? authUpload(`/media/admin/${record.id}`, payload, "PUT")
            : authUpload("/media/admin", payload),
        itemLabel: (record) => record.title || record.assetKey || "Media asset",
        itemMeta: (record) =>
          [record.category || "image", record.status || "Draft"]
            .filter(Boolean)
            .join(" · "),
        emptyLabel: "No media assets loaded yet.",
        defaultRecord: {
          category: "image",
          usageType: "general",
          status: "Draft",
          displayOrder: 0,
          isFeatured: false,
          isActive: true,
          tags: [],
        },
        fields: [
          {
            name: "assetKey",
            label: "Asset key",
            type: "text",
            required: true,
            readOnlyOnUpdate: true,
          },
          { name: "title", label: "Title", type: "text", required: true },
          {
            name: "description",
            label: "Description",
            type: "textarea",
            rows: 3,
          },
          {
            name: "category",
            label: "Category",
            type: "select",
            options: ["image", "pdf", "document", "video", "logo"],
          },
          { name: "usageType", label: "Usage type", type: "text" },
          { name: "altText", label: "Alt text", type: "text" },
          {
            name: "caption",
            label: "Caption",
            type: "textarea",
            rows: 3,
          },
          {
            name: "tags",
            label: "Tags",
            type: "json",
            rows: 4,
            defaultValue: [],
            help: "Array of tag strings or objects.",
          },
          {
            name: "file",
            label: "Upload file",
            type: "file",
            accept:
              "image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,video/*",
            help: "Upload a new file to create the asset or replace an existing file.",
          },
          {
            name: "status",
            label: "Status",
            type: "select",
            options: ["Draft", "Review", "Published", "Archived"],
          },
          { name: "displayOrder", label: "Display order", type: "number" },
          { name: "isFeatured", label: "Featured", type: "checkbox" },
          { name: "isActive", label: "Active", type: "checkbox" },
        ],
      },
      team: {
        label: "Team",
        singular: "team member",
        title: "Team",
        description:
          "Edit leadership names, roles, bios, photos, and display ordering.",
        load: () => authGet("/team/admin"),
        loadRecords: (result) =>
          Array.isArray(result?.data)
            ? result.data.map((row) => ({
                id: row.id,
                fullName: row.full_name || row.fullName || "",
                role: row.role || "",
                bio: row.bio || "",
                photoUrl: row.photo_url || row.photoUrl || "",
                displayOrder: row.display_order ?? row.displayOrder ?? 0,
                isActive:
                  row.is_active === undefined ? true : Boolean(row.is_active),
              }))
            : [],
        save: (record, payload) =>
          record?.id
            ? authPut(`/team/${record.id}`, payload)
            : authPost("/team", payload),
        itemLabel: (record) => record.fullName || "Team member",
        itemMeta: (record) => record.role || "Member",
        emptyLabel: "No team members loaded yet.",
        defaultRecord: {
          isActive: true,
          displayOrder: 0,
        },
        fields: [
          {
            name: "fullName",
            label: "Full name",
            type: "text",
            required: true,
          },
          { name: "role", label: "Role", type: "text", required: true },
          {
            name: "bio",
            label: "Bio",
            type: "textarea",
            rows: 4,
          },
          { name: "photoUrl", label: "Upload photo", type: "image", accept: "image/*" },
          { name: "displayOrder", label: "Display order", type: "number" },
          { name: "isActive", label: "Active", type: "checkbox" },
        ],
      },
      volunteers: {
        label: "Volunteers",
        readOnly: true,
        singular: "volunteer application",
        title: "Volunteer applications",
        description:
          "Review volunteer applicants, update review status, and capture internal notes.",
        load: () => authGet("/volunteers/admin"),
        save: (record, payload) =>
          record?.id
            ? authPut(`/volunteers/admin/${record.id}`, payload)
            : authPost("/volunteers/admin", payload),
        itemLabel: (record) => record.fullName || "Volunteer application",
        itemMeta: (record) => `${record.status || "pending"} · ${record.availability || "No availability"}`,
        emptyLabel: "No volunteer applications loaded yet.",
        defaultRecord: {
          sourcePage: "work-with-us",
          status: "pending",
          skills: [],
          interests: [],
        },
        fields: [
          { name: "fullName", label: "Full name", type: "text", required: true },
          { name: "email", label: "Email", type: "text", required: true },
          { name: "phone", label: "Phone", type: "text" },
          { name: "location", label: "Location", type: "text" },
          { name: "availability", label: "Availability", type: "text" },
          {
            name: "experienceLevel",
            label: "Experience level",
            type: "text",
          },
          { name: "skills", label: "Skills", type: "json", rows: 4, defaultValue: [] },
          { name: "interests", label: "Interests", type: "json", rows: 4, defaultValue: [] },
          { name: "portfolioUrl", label: "Portfolio URL", type: "text" },
          {
            name: "motivation",
            label: "Motivation",
            type: "textarea",
            rows: 4,
          },
          { name: "sourcePage", label: "Source page", type: "text" },
          {
            name: "status",
            label: "Status",
            type: "select",
            options: ["pending", "reviewed", "approved", "rejected"],
          },
          { name: "notes", label: "Notes", type: "textarea", rows: 3 },
        ],
      },
      contacts: {
        label: "Contacts",
        readOnly: true,
        singular: "contact submission",
        title: "Contact submissions",
        description:
          "Review and manage contact messages, partnership requests, and work-with-us inquiries.",
        load: () => authGet("/contact/admin"),
        save: (record, payload) =>
          authPut(`/contact/admin/${record.id}`, payload),
        itemLabel: (record) => record.fullName || record.email || "Contact submission",
        itemMeta: (record) => `${record.status || "pending"} · ${record.subject || "No subject"}`,
        emptyLabel: "No contact submissions loaded yet.",
        defaultRecord: {
          category: "general",
          sourcePage: "work-with-us",
          status: "pending",
        },
        fields: [
          { name: "fullName", label: "Full name", type: "text", required: true },
          { name: "email", label: "Email", type: "text", required: true },
          { name: "subject", label: "Subject", type: "text", required: true },
          {
            name: "message",
            label: "Message",
            type: "textarea",
            rows: 5,
            required: true,
          },
          { name: "category", label: "Category", type: "text" },
          { name: "sourcePage", label: "Source page", type: "text" },
          {
            name: "status",
            label: "Status",
            type: "select",
            options: ["pending", "reviewing", "responded", "closed"],
          },
          { name: "notes", label: "Notes", type: "textarea", rows: 3 },
        ],
      },
      newsletter: {
        label: "Newsletter",
        singular: "newsletter record",
        title: "Newsletter subscriptions",
        description:
          "Manage newsletter subscribers, confirmation state, and unsubscribe status.",
        load: () => authGet("/newsletter/admin"),
        save: (record, payload) =>
          authPut(`/newsletter/admin/${record.id}`, payload),
        itemLabel: (record) => record.email || "Subscriber",
        itemMeta: (record) => `${record.status || "pending"} · ${record.sourcePage || "website"}`,
        emptyLabel: "No newsletter subscribers loaded yet.",
        defaultRecord: {
          status: "pending",
          sourcePage: "website",
        },
        fields: [
          { name: "fullName", label: "Full name", type: "text" },
          { name: "email", label: "Email", type: "text", required: true },
          { name: "sourcePage", label: "Source page", type: "text" },
          {
            name: "status",
            label: "Status",
            type: "select",
            options: ["pending", "confirmed", "unsubscribed"],
          },
        ],
      },
      donations: {
        label: "Donations",
        readOnly: true,
        singular: "donation",
        title: "Donations",
        description:
          "Review donation records, payment status, and verification state.",
        load: () => authGet("/donate/admin"),
        save: (record, payload) =>
          authPut(`/donate/admin/${record.id}`, payload),
        itemLabel: (record) => record.fullName || record.reference || "Donation",
        itemMeta: (record) =>
          `${record.paymentStatus || record.status || "pending"} · ₦${Number(record.amountNaira || 0).toLocaleString()}`,
        emptyLabel: "No donations loaded yet.",
        defaultRecord: {
          status: "pending",
          paymentStatus: "pending",
        },
        fields: [
          { name: "reference", label: "Reference", type: "text", readOnlyOnUpdate: true },
          { name: "fullName", label: "Full name", type: "text" },
          { name: "email", label: "Email", type: "text" },
          { name: "phone", label: "Phone", type: "text" },
          { name: "amountNaira", label: "Amount (naira)", type: "number" },
          { name: "programArea", label: "Program area", type: "text" },
          { name: "paymentProvider", label: "Payment provider", type: "text" },
          { name: "paymentReference", label: "Payment reference", type: "text" },
          {
            name: "status",
            label: "Status",
            type: "select",
            options: ["pending", "payment_pending", "receipt_submitted", "verified", "failed"],
          },
          {
            name: "paymentStatus",
            label: "Payment status",
            type: "select",
            options: ["pending", "initialized", "processing", "succeeded", "failed", "receipt_submitted"],
          },
          { name: "confirmationMethod", label: "Confirmation method", type: "text" },
          { name: "receiptUrl", label: "Receipt URL", type: "text" },
        ],
      },
    };

    const allKeys = Object.keys(configs);
    const removedAdminSections = new Set([
      "site-settings",
      "homepage",
      "footer",
      "impact",
      "media",
      "hero",
      "seo",
    ]);
    const availableKeys = allKeys.filter((key) => !removedAdminSections.has(key));
    const requestedSection = new URLSearchParams(window.location.search).get("section");
    const keys =
      page === "admin-section" && availableKeys.includes(requestedSection)
        ? [requestedSection]
        : page === "admin-section"
          ? [availableKeys[0]]
          : availableKeys;
    const state = {
      activeKey: keys[0],
      records: Object.fromEntries(keys.map((key) => [key, []])),
      selectedIds: Object.fromEntries(keys.map((key) => [key, null])),
      loaded: false,
    };

    function setStatus(message, tone = "info") {
      if (!statusEl) return;
      statusEl.textContent = message;
      statusEl.dataset.tone = tone;
    }

    function getRecords(key) {
      return state.records[key] || [];
    }

    function getSelectedRecord(key) {
      const records = getRecords(key);
      const selectedId = state.selectedIds[key];
      if (selectedId === null || selectedId === undefined || selectedId === "") {
        return null;
      }
      return records.find((record) => String(record.id) === String(selectedId)) || null;
    }

    function getDefaultRecord(config) {
      return JSON.parse(JSON.stringify(config.defaultRecord || {}));
    }

    function structuredItems(value) {
      if (Array.isArray(value)) return value;
      if (!value || typeof value !== "object") return [];
      return [value];
    }

    function structuredKeys(items) {
      const keys = new Set();
      items.forEach((item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          Object.keys(item).forEach((key) => keys.add(key));
        }
      });
      return [...keys];
    }

    function renderStructuredItem(keys, item = {}) {
      const primitive = typeof item !== "object" || item === null || Array.isArray(item);
      const itemKeys = keys.length ? keys : ["value"];
      return `
        <div class="structured-list-item" data-structured-item>
          <div class="structured-list-fields">
            ${itemKeys.map((key) => {
              const rawValue = primitive ? (key === "value" ? item : "") : item[key];
              const value = Array.isArray(rawValue) ? rawValue.join(", ") : rawValue ?? "";
              return `
                <label>
                  <span>${escapeHtml(key.replace(/([A-Z])/g, " $1"))}</span>
                  <input type="text" data-structured-key="${escapeHtml(key)}" value="${escapeHtml(value)}" />
                </label>
              `;
            }).join("")}
          </div>
          <button class="btn btn-ghost structured-list-remove" type="button" data-structured-remove>Remove</button>
        </div>
      `;
    }

    function renderStructuredList(field, value) {
      const items = structuredItems(value);
      const defaultKeys = {
        bodyCopy: ["value"],
        heroStats: ["value", "label"],
        featureItems: ["title", "summary"],
        objectives: ["title", "summary"],
        activities: ["title", "summary"],
        beneficiaries: ["title", "summary", "imageUrl"],
        locations: ["title", "summary", "country", "state", "city"],
        timeline: ["year", "title", "summary"],
        gallery: ["url", "alt", "caption"],
        impactMetrics: ["label", "value", "description"],
        stories: ["quote", "attribution"],
        reports: ["title", "url", "description"],
        partners: ["title", "description", "logoUrl"],
        images: ["url", "alt", "caption"],
        tags: ["value"],
        relatedArticles: ["title", "slug"],
      };
      const keys = structuredKeys(items).length
        ? structuredKeys(items)
        : defaultKeys[field.name] || [];
      return `
        <div class="form-group content-admin-span-full structured-list-field" data-structured-list data-structured-keys="${escapeHtml(keys.join(","))}">
          <div class="structured-list-head">
            <div>
              <label>${escapeHtml(field.label)}</label>
              <p class="field-help">Add and edit entries using labeled fields. No JSON editing is required.</p>
            </div>
            <button class="btn btn-ghost" type="button" data-structured-add>Add item</button>
          </div>
          <div data-structured-items>
            ${items.map((item) => renderStructuredItem(keys, item)).join("") || `<p class="content-admin-empty" data-structured-empty>No items added yet.</p>`}
          </div>
          <input type="hidden" name="${escapeHtml(field.name)}" value="" />
          ${field.help ? `<p class="field-help">${escapeHtml(field.help)}</p>` : ""}
        </div>
      `;
    }

    function readStructuredList(container) {
      return [...container.querySelectorAll("[data-structured-item]")].map((item) => {
        const values = [...item.querySelectorAll("[data-structured-key]")];
        const result = {};
        values.forEach((input) => {
          result[input.dataset.structuredKey] = input.value.trim();
        });
        return values.length === 1 && values[0].dataset.structuredKey === "value"
          ? result.value
          : result;
      });
    }

    function bindStructuredEditors(form) {
      form.querySelectorAll("[data-structured-list]").forEach((container) => {
        const itemsEl = container.querySelector("[data-structured-items]");
        const keys = container.dataset.structuredKeys
          ? container.dataset.structuredKeys.split(",").filter(Boolean)
          : [];
        container.addEventListener("click", (event) => {
          if (event.target.closest("[data-structured-add]")) {
            container.querySelector("[data-structured-empty]")?.remove();
            itemsEl.insertAdjacentHTML("beforeend", renderStructuredItem(keys));
          }
          if (event.target.closest("[data-structured-remove]")) {
            event.target.closest("[data-structured-item]")?.remove();
            if (!itemsEl.querySelector("[data-structured-item]")) {
              itemsEl.innerHTML = `<p class="content-admin-empty" data-structured-empty>No items added yet.</p>`;
            }
          }
        });
      });
    }

    function renderField(config, field, record) {
      const value = record?.[field.name];
      const id = `${config.label}-${field.name}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-");
      const required = field.required ? "required" : "";
      const help = field.help
        ? `<p class="field-help">${escapeHtml(field.help)}</p>`
        : "";

      if (field.type === "checkbox") {
        return `
          <label class="form-toggle" for="${escapeHtml(id)}">
            <input
              id="${escapeHtml(id)}"
              name="${escapeHtml(field.name)}"
              type="checkbox"
              ${value ? "checked" : ""}
            />
            <span>${escapeHtml(field.label)}</span>
          </label>
        `;
      }

      if (field.type === "file") {
        const fileUrl = record?.fileUrl || record?.file_url || "";
        const fileName = record?.fileName || record?.file_name || "";
        const currentFile = fileUrl
          ? `
            <p class="field-help">
              Current file:
              <a href="${escapeHtml(fileUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(fileName || fileUrl)}</a>
            </p>
          `
          : "";

        return `
          <div class="form-group content-admin-span-full">
            <label for="${escapeHtml(id)}">${escapeHtml(field.label)}</label>
            <input
              id="${escapeHtml(id)}"
              name="${escapeHtml(field.name)}"
              type="file"
              ${field.accept ? `accept="${escapeHtml(field.accept)}"` : ""}
            />
            ${currentFile}
            ${help}
          </div>
        `;
      }

      if (field.type === "image" || field.type === "asset") {
        const currentUrl = value || "";
        const resolvedUrl = currentUrl.startsWith("/")
          ? `${API_ORIGIN}${currentUrl}`
          : currentUrl;
        const preview = currentUrl && field.type === "image"
          ? `<img class="content-admin-image-preview" src="${escapeHtml(resolvedUrl)}" alt="Current image preview" loading="lazy" />`
          : currentUrl
            ? `<a class="content-admin-image-preview-empty" href="${escapeHtml(resolvedUrl)}" target="_blank" rel="noopener noreferrer">Open current file</a>`
            : `<span class="content-admin-image-preview-empty">No file selected</span>`;

        return `
          <div class="form-group content-admin-span-full content-admin-image-field">
            <label for="${escapeHtml(id)}">${escapeHtml(field.label)}</label>
            <div class="content-admin-image-picker">
              ${preview}
              <input
                id="${escapeHtml(id)}"
                name="${escapeHtml(field.name)}"
                type="file"
                accept="${escapeHtml(field.accept || "image/*")}" />
            </div>
            <p class="field-help">Choose a file from your computer. It will upload when you save this record.</p>
            ${help}
          </div>
        `;
      }

      if (field.type === "select") {
        return `
          <div class="form-group">
            <label for="${escapeHtml(id)}">${escapeHtml(field.label)}</label>
            <select id="${escapeHtml(id)}" name="${escapeHtml(field.name)}" ${required} ${field.readOnlyOnUpdate && record?.id ? "disabled" : ""}>
              ${(field.options || [])
                .map(
                  (option) => `
                    <option value="${escapeHtml(option)}" ${String(value || "").toLowerCase() === String(option).toLowerCase() ? "selected" : ""}>
                      ${escapeHtml(option)}
                    </option>
                  `,
                )
                .join("")}
            </select>
            ${help}
          </div>
        `;
      }

      if (field.type === "textarea") {
        return `
          <div class="form-group content-admin-span-full">
            <label for="${escapeHtml(id)}">${escapeHtml(field.label)}</label>
            <textarea
              id="${escapeHtml(id)}"
              name="${escapeHtml(field.name)}"
              rows="${field.rows || 4}"
              ${required}
            >${escapeHtml(value ?? "")}</textarea>
            ${help}
          </div>
        `;
      }

      if (field.type === "json") {
        return renderStructuredList(field, value ?? field.defaultValue ?? []);
      }

      if (field.type === "date") {
        return `
          <div class="form-group">
            <label for="${escapeHtml(id)}">${escapeHtml(field.label)}</label>
            <input
              id="${escapeHtml(id)}"
              name="${escapeHtml(field.name)}"
              type="date"
              value="${escapeHtml(formatDateInputValue(value))}"
              ${required}
            />
            ${help}
          </div>
        `;
      }

      const inputType = field.type === "number" ? "number" : "text";
      return `
        <div class="form-group ${field.type === "textarea" ? "content-admin-span-full" : ""}">
          <label for="${escapeHtml(id)}">${escapeHtml(field.label)}</label>
          <input
            id="${escapeHtml(id)}"
            name="${escapeHtml(field.name)}"
            type="${inputType}"
            value="${escapeHtml(value ?? "")}"
            ${required}
            ${field.readOnlyOnUpdate && record?.id ? "readonly" : ""}
          />
          ${help}
        </div>
      `;
    }

    function renderForm(key, config, record) {
      const heading = record?.id
        ? `Editing ${config.itemLabel(record)}`
        : `Create a new ${config.singular || config.label.toLowerCase()}`;

      return `
        <form class="content-admin-form" data-content-admin-form="${escapeHtml(key)}">
          <div class="content-admin-form-head">
            <div>
              <p class="section-kicker">Editor</p>
              <h3>${escapeHtml(heading)}</h3>
            </div>
            <div class="content-admin-form-actions">
              <button class="btn btn-ghost" type="button" data-content-admin-new="${escapeHtml(key)}">New</button>
              ${record?.id && config.archive ? `<button class="btn btn-ghost" type="button" data-content-admin-archive="${escapeHtml(key)}" data-record-id="${escapeHtml(record.id)}">Deactivate</button>` : ""}
              <button class="btn btn-primary" type="submit">Save ${escapeHtml(config.label)}</button>
            </div>
          </div>
          <div class="content-admin-form-grid">
            ${config.fields.map((field) => renderField(config, field, record)).join("")}
          </div>
          <input type="hidden" name="id" value="${escapeHtml(record?.id || "")}" />
          <p class="content-admin-panel-status" data-content-admin-panel-status="${escapeHtml(config.label)}"></p>
        </form>
      `;
    }

    function displayReadOnlyValue(value) {
      if (value === null || value === undefined || value === "") return "Not provided";
      if (Array.isArray(value)) return value.join(", ") || "Not provided";
      if (typeof value === "object") return Object.values(value).filter(Boolean).join(", ") || "Not provided";
      return String(value);
    }

    function renderReadOnlyRecord(config, record) {
      if (!record) return `<p class="content-admin-empty">Select a record to view its details.</p>`;
      return `
        <div class="content-admin-readonly">
          <div class="content-admin-form-head">
            <div>
              <p class="section-kicker">Submission record</p>
              <h3>${escapeHtml(config.itemLabel(record))}</h3>
              <p class="section-desc">This record is received from the public website and is available for review.</p>
            </div>
            <span class="content-admin-record-badge">${escapeHtml(config.itemMeta(record))}</span>
          </div>
          <dl class="content-admin-record-details">
            ${config.fields.map((field) => `
              <div>
                <dt>${escapeHtml(field.label)}</dt>
                <dd>${escapeHtml(displayReadOnlyValue(record[field.name]))}</dd>
              </div>
            `).join("")}
          </dl>
        </div>
      `;
    }

    function renderList(key, config, records, selectedId) {
      if (!records.length) {
        return `<p class="content-admin-empty">${escapeHtml(config.emptyLabel)}</p>`;
      }

      return `
        <div class="content-admin-list">
          ${records
            .map((record) => {
              const active = String(record.id) === String(selectedId) ? " is-active" : "";
              return `
                <button
                  type="button"
                  class="content-admin-list-item${active}"
                  data-content-admin-select="${escapeHtml(key)}"
                  data-record-id="${escapeHtml(record.id)}"
                >
                  <strong>${escapeHtml(config.itemLabel(record))}</strong>
                  <span>${escapeHtml(config.itemMeta(record))}</span>
                </button>
              `;
            })
            .join("")}
        </div>
      `;
    }

    function renderTabs() {
      if (!tabsEl) return;
      tabsEl.innerHTML = keys
        .map(
          (key) => `
            <button
              type="button"
              class="content-admin-tab${state.activeKey === key ? " is-active" : ""}"
              data-content-admin-tab="${escapeHtml(key)}"
            >
              ${escapeHtml(configs[key].label)}
            </button>
          `,
        )
        .join("");
    }

    function renderSummary() {
      if (!summaryEl) return;

      const counts = keys.map((key) => ({
        label: configs[key].label,
        value: formatAdminCount(getRecords(key).length),
        description: configs[key].description,
      }));

      summaryEl.innerHTML = counts
        .map(
          (item) => `
            <article class="admin-card content-admin-summary-card" data-animate>
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}</strong>
              <p>${escapeHtml(item.description)}</p>
            </article>
          `,
        )
        .join("");

      summaryEl
        .querySelectorAll("[data-animate]")
        .forEach((el) => el.classList.add("visible"));
    }

    function renderPanels() {
      if (!panelsEl) return;

      panelsEl.innerHTML = keys
        .map((key) => {
          const config = configs[key];
          const records = getRecords(key);
          const selected = getSelectedRecord(key);
          return `
            <article class="content-admin-panel" data-content-admin-panel="${escapeHtml(key)}" ${state.activeKey === key ? "" : "hidden"}>
              <div class="content-admin-panel-header">
                <div>
                  <p class="section-kicker">${escapeHtml(config.label)}</p>
                  <h3>${escapeHtml(config.title)}</h3>
                  <p class="section-desc">${escapeHtml(config.description)}</p>
                </div>
                <p class="content-admin-panel-count">${escapeHtml(formatAdminCount(records.length))} records</p>
              </div>
              <div class="content-admin-panel-grid">
                <aside class="content-admin-list-panel">
                  <div class="content-admin-list-toolbar">
                    <strong>Records</strong>
                    ${config.readOnly ? "" : `<button class="btn btn-ghost" type="button" data-content-admin-new="${escapeHtml(key)}">New ${escapeHtml(config.singular || config.label.toLowerCase())}</button>`}
                  </div>
                  ${renderList(key, config, records, selected?.id || null)}
                </aside>
                <div class="content-admin-editor-panel">
                  ${config.readOnly
                    ? renderReadOnlyRecord(config, selected)
                    : renderForm(key, config, selected || getDefaultRecord(config))}
                </div>
              </div>
            </article>
          `;
        })
        .join("");

      panelsEl
        .querySelectorAll("[data-content-admin-select]")
        .forEach((button) => {
          button.addEventListener("click", () => {
            const key = button.dataset.contentAdminSelect;
            const recordId = Number(button.dataset.recordId);
            if (!keys.includes(key)) return;
            state.activeKey = key;
            state.selectedIds[key] = recordId;
            renderTabs();
            renderPanels();
            syncPanelState(key);
          });
        });

      panelsEl
        .querySelectorAll("[data-content-admin-new]")
        .forEach((button) => {
          button.addEventListener("click", () => {
            const key = button.dataset.contentAdminNew;
            if (!key) return;
            state.activeKey = key;
            state.selectedIds[key] = null;
            renderTabs();
            renderPanels();
            syncPanelState(key, "Ready to create a new record.");
          });
        });

      panelsEl.querySelectorAll("[data-content-admin-archive]").forEach((button) => {
        button.addEventListener("click", async () => {
          const key = button.dataset.contentAdminArchive;
          const record = key
            ? getRecords(key).find(
                (item) => String(item.id) === String(button.dataset.recordId),
              )
            : null;
          if (!key || !record || !window.confirm(`Deactivate this ${configs[key].singular || "record"}? It will stay in the admin list but be hidden from public pages.`)) {
            return;
          }

          button.disabled = true;
          syncPanelState(key, `Deactivating ${configs[key].label.toLowerCase()}…`);
          try {
            const result = await configs[key].archive(record);
            if (!result.success) throw new Error(result.message || "Deactivation failed.");
            await loadSection(key);
            showToast(`${configs[key].singular || configs[key].label} deactivated.`);
          } catch (error) {
            syncPanelState(key, error.message || "Deactivation failed.", "error");
            showToast(error.message || "Deactivation failed.", "error");
          } finally {
            button.disabled = false;
          }
        });
      });

      panelsEl.querySelectorAll("[data-content-admin-form]").forEach(bindStructuredEditors);

      panelsEl.querySelectorAll("[data-content-admin-form]").forEach((form) => {
        const key = form.dataset.contentAdminForm;
        if (!key) return;
        form.addEventListener("submit", async (event) => {
          event.preventDefault();

          const config = configs[key];
          const current = getSelectedRecord(key) || getDefaultRecord(config);
          const hasFileField = config.fields.some(
            (field) => field.type === "file",
          );
          const fileFields = config.fields.filter(
            (field) => field.type === "file",
          );
          const payload = hasFileField ? new FormData() : {};

          if (hasFileField && !current?.id) {
            const missingFileField = fileFields.find((field) => {
              const input = form.elements.namedItem(field.name);
              return !input?.files?.length;
            });
            if (missingFileField) {
              syncPanelState(
                key,
                `${missingFileField.label} is required for new records.`,
                "error",
              );
              return;
            }
          }

          const imageFields = config.fields.filter(
            (field) => field.type === "image" || field.type === "asset",
          );
          const uploadedImages = {};
          if (imageFields.length) {
            setFormLoading(form, true);
            try {
              for (const field of imageFields) {
                const input = form.elements.namedItem(field.name);
                const file = input?.files?.[0];
                if (field.required && !file && !current?.[field.name]) {
                  throw new Error(`${field.label} is required.`);
                }
                if (!file) continue;

                syncPanelState(key, `Uploading ${field.label.toLowerCase()}…`);
                const assetKey = `${key}-${current?.id || current?.slug || Date.now()}-${Date.now()}`
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-+|-+$/g, "");
                const imageData = new FormData();
                imageData.append("file", file);
                imageData.append("assetKey", assetKey);
                imageData.append(
                  "title",
                  current?.title || current?.fullName || `${config.label} image`,
                );
                imageData.append("category", field.assetCategory || "image");
                imageData.append("usageType", `${key}-image`);
                imageData.append("status", "Published");

                const result = await authUpload("/media/admin", imageData);
                if (!result.success || !result.data?.fileUrl) {
                  throw new Error(result.message || `Failed to upload ${field.label.toLowerCase()}.`);
                }
                const fileUrl = result.data.fileUrl;
                // Store the backend path so the record remains portable across environments.
                uploadedImages[field.name] = fileUrl;
              }
            } catch (error) {
              syncPanelState(key, error.message || "Image upload failed.", "error");
              showToast(error.message || "Image upload failed.", "error");
              setFormLoading(form, false);
              return;
            }
          }

          for (const field of config.fields) {
            const input = form.elements.namedItem(field.name);
            if (!input) continue;

            if (field.type === "image" || field.type === "asset") {
              const value = uploadedImages[field.name] || current?.[field.name] || "";
              if (hasFileField) {
                payload.append(field.name, value);
              } else {
                payload[field.name] = value;
              }
              continue;
            }

            if (field.type === "file") {
              const file = input.files?.[0];
              if (file) {
                payload.append(field.name, file);
              }
              continue;
            }

            if (field.type === "checkbox") {
              if (hasFileField) {
                payload.append(field.name, input.checked ? "true" : "false");
              } else {
                payload[field.name] = Boolean(input.checked);
              }
              continue;
            }

            if (field.type === "number") {
              const raw = String(input.value || "").trim();
              if (hasFileField) {
                payload.append(
                  field.name,
                  raw === "" ? "" : String(Number(raw)),
                );
              } else {
                payload[field.name] = raw === "" ? "" : Number(raw);
              }
              continue;
            }

            if (field.type === "json") {
              const structured = input.closest("[data-structured-list]");
              const parsed = structured
                ? readStructuredList(structured)
                : field.defaultValue || [];
              if (hasFileField) payload.append(field.name, JSON.stringify(parsed));
              else payload[field.name] = parsed;
              continue;
            }

            if (field.type === "date") {
              const value = String(input.value || "").trim() || null;
              if (hasFileField) {
                payload.append(field.name, value || "");
              } else {
                payload[field.name] = value;
              }
              continue;
            }

            const value = String(input.value || "").trim();
            if (hasFileField) {
              payload.append(field.name, value);
            } else {
              payload[field.name] = value;
            }
          }

          setFormLoading(form, true);
          syncPanelState(key, `Saving ${config.label.toLowerCase()}…`);

          try {
            const result = await config.save(current, payload);
            if (!result.success) {
              throw new Error(result.message || "Save failed.");
            }

            const saved = result.data || null;
            await loadSection(key, saved?.id || current?.id || null);
            showToast(
              `${config.singular || config.label.toLowerCase()} saved successfully.`,
            );
          } catch (error) {
            syncPanelState(key, error.message || "Save failed.", "error");
            showToast(error.message || "Save failed.", "error");
          } finally {
            setFormLoading(form, false);
          }
        });
      });
    }

    function syncPanelState(key, message = "", tone = "info") {
      const panel = panelsEl?.querySelector(
        `[data-content-admin-panel="${key}"]`,
      );
      const panelStatus = panel?.querySelector(
        `[data-content-admin-panel-status="${configs[key].label}"]`,
      );
      if (panelStatus) {
        panelStatus.textContent = message;
        panelStatus.dataset.tone = tone;
      }

      if (message && statusEl) {
        statusEl.textContent = message;
        statusEl.dataset.tone = tone;
      }
    }

    async function loadSection(key, preferredId = null) {
      const config = configs[key];
      try {
        const result = await config.load();
        if (!result.success) {
          throw new Error(
            result.message || `Failed to load ${config.label.toLowerCase()}.`,
          );
        }

        const records =
          typeof config.loadRecords === "function"
            ? config.loadRecords(result)
            : Array.isArray(result.data)
              ? result.data
              : [];
        state.records[key] = records;
        state.selectedIds[key] =
          preferredId && records.some((record) => String(record.id) === String(preferredId))
            ? preferredId
            : state.selectedIds[key] &&
                records.some(
                  (record) => String(record.id) === String(state.selectedIds[key]),
                )
              ? state.selectedIds[key]
              : records[0]?.id || null;
        if (state.activeKey === key && titleEl) {
          titleEl.textContent = config.title;
        }
        if (state.activeKey === key && helpEl) {
          helpEl.textContent = config.description;
        }
        renderSummary();
        renderTabs();
        renderPanels();
        syncPanelState(key, `${config.label} loaded.`);
      } catch (error) {
        state.records[key] = [];
        renderSummary();
        renderTabs();
        renderPanels();
        syncPanelState(
          key,
          error.message || `Failed to load ${config.label.toLowerCase()}.`,
          "error",
        );
      }
    }

    function setActiveKey(key) {
      if (!configs[key]) return;
      state.activeKey = key;
      if (titleEl) {
        titleEl.textContent = configs[key].title;
      }
      if (helpEl) {
        helpEl.textContent = configs[key].description;
      }
      renderTabs();
      renderPanels();
    }

    if (!readAdminSession()?.accessToken) {
      if (page === "admin-section") {
        window.location.href = "admin-login.html";
        return;
      }
      setStatus("Sign in from the admin console to edit content.", "warning");
      if (helpEl) {
        helpEl.textContent =
          "You need an authenticated admin session before this editor can load.";
      }
      if (titleEl) {
        titleEl.textContent = "Content Editor";
      }
      if (tabsEl) {
        tabsEl.innerHTML = "";
      }
      if (panelsEl) {
        panelsEl.innerHTML = `
          <article class="content-admin-locked">
            <p class="section-kicker">Locked</p>
            <h3>Authentication required</h3>
            <p>Please sign in through the admin console before opening the content editor.</p>
            <a class="btn btn-primary" href="admin.html">Open Admin Console</a>
          </article>
        `;
      }
      return;
    }

    panelsEl.dataset.contentAdminInitialized = "true";

    renderTabs();
    renderPanels();

    tabsEl?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-content-admin-tab]");
      if (!button) return;
      setActiveKey(button.dataset.contentAdminTab);
    });

    const sectionSelect = document.querySelector("[data-admin-section-select]");
    if (sectionSelect) {
      sectionSelect.value = requestedSection && availableKeys.includes(requestedSection)
        ? requestedSection
        : keys[0];
      sectionSelect.addEventListener("change", () => {
        const nextSection = sectionSelect.value;
        if (availableKeys.includes(nextSection)) {
          window.location.href = `admin-section.html?section=${encodeURIComponent(nextSection)}`;
        }
      });
    }

    refreshBtn?.addEventListener("click", async () => {
      setStatus("Refreshing content editor…");
      await Promise.allSettled(keys.map((key) => loadSection(key)));
      setStatus("Content refreshed.");
    });

    logoutBtn?.addEventListener("click", async () => {
      const refreshToken = getAdminRefreshToken();
      if (refreshToken) {
        try {
          await authPost("/auth/logout", { refreshToken });
        } catch {
          // Ignore logout failures; the local session will still be cleared.
        }
      }

      clearAdminSession();
      setStatus("Signed out.");
      showToast("Signed out successfully.");
    });

    Promise.allSettled(keys.map((key) => loadSection(key))).then(() => {
      state.loaded = true;
      setStatus("Content editor loaded.");
    });
  }

  async function loadImpactData() {
    const statNodes = document.querySelectorAll("[data-impact-stat]");
    const barNodes = document.querySelectorAll("[data-impact-bar]");
    if (!statNodes.length && !barNodes.length) return;

    try {
      const result = await apiGet("/impact");
      if (!result.success || !result.data) return;

      const metrics = Array.isArray(result.data.metrics)
        ? result.data.metrics
        : [];
      const metricMap = new Map(
        metrics.map((metric) => [metric.metricKey, metric]),
      );

      statNodes.forEach((node) => {
        const metricKey = node.dataset.impactStat;
        const metric = metricMap.get(metricKey);
        if (!metric) return;

        const valueEl =
          node.querySelector("[data-impact-number]") ||
          node.querySelector(".stat-number");
        if (valueEl) {
          animateImpactNumber(
            valueEl,
            metric.value,
            metric.displaySuffix || "",
            metric.displayPrefix || "",
          );
        }
      });

      barNodes.forEach((node) => {
        const metricKey = node.dataset.impactBar;
        const metric = metricMap.get(metricKey);
        if (!metric) return;

        const labelEl = node.querySelector("[data-impact-bar-label]");
        const valueEl = node.querySelector("[data-impact-bar-value]");
        const fillEl = node.querySelector("[data-impact-bar-fill]");

        if (labelEl && metric.label) {
          labelEl.textContent = metric.label;
        }
        if (valueEl) {
          valueEl.textContent = formatImpactValue(
            metric.value,
            metric.displaySuffix || "",
            metric.displayPrefix || "",
          );
        }
        if (fillEl) {
          const percent = Number(metric.chartPercent || 0);
          fillEl.style.setProperty("--bar", `${percent}%`);
        }
      });
    } catch {
      // Silently fall back to the server-rendered defaults.
    }
  }

  /* ─── Toast (mirrors script.js implementation) ────────────────── */
  function showToast(message, type = "success") {
    const toast = document.querySelector("[data-toast]");
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.hidden = false;
    toast.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => {
        toast.hidden = true;
      }, 400);
    }, 5000);
  }

  function setFormLoading(form, loading) {
    const btn = form.querySelector('[type="submit"]');
    if (!btn) return;
    btn.disabled = loading;
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
    btn.textContent = loading ? "Please wait…" : btn.dataset.originalText;
  }

  /* ─── Contact / Work With Us form ────────────────────────────── */
  function initContactForm() {
    const form = document.querySelector("[data-contact]");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const data = {
        fullName: form.querySelector('[name="name"]')?.value,
        email: form.querySelector('[name="email"]')?.value,
        subject: form.querySelector('[name="subject"]')?.value,
        message: form.querySelector('[name="message"]')?.value,
      };

      setFormLoading(form, true);
      try {
        const result = await apiPost("/contact", data);
        if (result.success) {
          form.reset();
          // Silent success - backend handles it
        } else {
          showToast(
            result.message || "Submission failed. Please try again.",
            "error",
          );
        }
      } catch (err) {
        // Silent fail - let backend log it
      } finally {
        setFormLoading(form, false);
      }
    });
  }

  function initVolunteerForm() {
    const form = document.querySelector("[data-volunteer]");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const parseList = (value) =>
        String(value || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);

      const data = {
        fullName: form.querySelector('[name="fullName"]')?.value,
        email: form.querySelector('[name="email"]')?.value,
        phone: form.querySelector('[name="phone"]')?.value,
        location: form.querySelector('[name="location"]')?.value,
        availability: form.querySelector('[name="availability"]')?.value,
        experienceLevel: form.querySelector('[name="experienceLevel"]')?.value,
        skills: parseList(form.querySelector('[name="skills"]')?.value),
        interests: parseList(form.querySelector('[name="interests"]')?.value),
        portfolioUrl: form.querySelector('[name="portfolioUrl"]')?.value,
        motivation: form.querySelector('[name="motivation"]')?.value,
        sourcePage: document.body.dataset.page || "work-with-us",
      };

      setFormLoading(form, true);
      try {
        const result = await apiPost("/volunteers", data);
        if (result.success) {
          form.reset();
          showToast("Volunteer application submitted.");
        } else {
          showToast(
            result.message || "Volunteer submission failed. Please try again.",
            "error",
          );
        }
      } catch {
        showToast("Network error. Please check your connection.", "error");
      } finally {
        setFormLoading(form, false);
      }
    });
  }

  /* ─── Newsletter form ─────────────────────────────────────────── */
  function initNewsletterForm() {
    const form = document.querySelector("[data-newsletter]");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = form.querySelector('[type="email"]')?.value;
      if (!email) return;

      setFormLoading(form, true);
      try {
        const result = await apiPost("/newsletter", { email });
        if (result.success) {
          form.reset();
        } else {
          showToast(result.message || "Subscription failed.", "error");
        }
      } catch {
        showToast("Network error. Please check your connection.", "error");
      } finally {
        setFormLoading(form, false);
      }
    });
  }

  /* ─── Donation form ───────────────────────────────────────────── */
  function showDonationInstructions(result) {
    const formStep = document.querySelector('[data-donation-step="form"]');
    const instructionsStep = document.querySelector(
      '[data-donation-step="instructions"]',
    );
    if (!formStep || !instructionsStep) return;

    const { reference, donation, bank } = result;
    const amount = Number(donation?.amountNaira || 0);

    document.querySelector("[data-bank-name]").textContent =
      bank?.bankName || "—";
    document.querySelector("[data-bank-account-name]").textContent =
      bank?.accountName || "—";
    document.querySelector("[data-bank-account-number]").textContent =
      bank?.accountNumber || "—";
    document.querySelector("[data-donation-display-amount]").textContent =
      `₦${amount.toLocaleString()}`;
    document.querySelector("[data-donation-reference]").textContent =
      reference || "—";

    instructionsStep.dataset.reference = reference || "";
    instructionsStep.dataset.programArea = donation?.programArea || "";

    formStep.hidden = true;
    instructionsStep.hidden = false;
    instructionsStep.scrollIntoView({ behavior: "smooth", block: "start" });

    const hero = document.querySelector(".page-hero-lead");
    if (hero) {
      hero.textContent =
        "Transfer to our account below, then submit your payment receipt for confirmation.";
    }
  }

  function initReceiptForm() {
    const form = document.querySelector("[data-receipt-form]");
    const instructionsStep = document.querySelector(
      '[data-donation-step="instructions"]',
    );
    const previewBox = document.querySelector("[data-receipt-file-preview]");
    const fileInput = form?.querySelector('[name="receipt"]');
    if (!form || !instructionsStep || !fileInput || !previewBox) return;

    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      previewBox.innerHTML = "";

      if (!file) {
        previewBox.hidden = true;
        return;
      }

      const card = document.createElement("div");
      card.className = "receipt-file-preview-card";

      const icon = document.createElement("div");
      icon.className = "receipt-file-preview-icon";
      icon.textContent = file.type.startsWith("image/") ? "🖼️" : "📄";

      const content = document.createElement("div");
      content.className = "receipt-file-preview-content";
      content.innerHTML = `
        <strong>${file.name}</strong>
        <span>${(file.size / 1024).toFixed(1)} KB · ${file.type.replace("application/", "").replace("image/", "")}</span>
      `;

      card.append(icon, content);

      if (file.type.startsWith("image/")) {
        const thumb = document.createElement("img");
        thumb.className = "receipt-file-preview-thumb";
        thumb.alt = "Receipt file preview";

        const reader = new FileReader();
        reader.onload = (event) => {
          thumb.src = event.target.result;
          previewBox.insertBefore(thumb, card);
        };
        reader.readAsDataURL(file);
      }

      previewBox.appendChild(card);
      previewBox.hidden = false;
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const reference = instructionsStep.dataset.reference;
      const file = fileInput.files?.[0];

      if (!reference) {
        showToast(
          "Donation reference missing. Please submit the donation form again.",
          "error",
        );
        return;
      }
      if (!file) {
        showToast("Please select your payment receipt to upload.", "error");
        return;
      }

      const formData = new FormData();
      formData.append("reference", reference);
      formData.append("receipt", file);

      setFormLoading(form, true);
      try {
        const res = await fetch(`${API_BASE}/donate/receipt`, {
          method: "POST",
          body: formData,
        });
        const result = await parseJsonResponse(res);

        if (result.success) {
          document
            .querySelector(".bank-transfer-details")
            ?.setAttribute("hidden", "");
          document
            .querySelector(".receipt-upload-section")
            ?.setAttribute("hidden", "");
          const successPanel = document.querySelector("[data-receipt-success]");
          successPanel?.removeAttribute("hidden");
          showToast(result.message || "Receipt submitted successfully!");
        } else {
          showToast(
            result.message || "Receipt upload failed. Please try again.",
            "error",
          );
        }
      } catch {
        showToast("Network error. Please check your connection.", "error");
      } finally {
        setFormLoading(form, false);
      }
    });
  }

  function initDonationForm() {
    const form = document.querySelector("[data-donation-form]");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const data = {
        fullName: document.querySelector("#donor-full-name")?.value,
        email: document.querySelector("#donor-email")?.value,
        phone: document.querySelector("#donor-phone")?.value,
        amount: document.querySelector("#donation-amount")?.value,
        category: document.querySelector("#donation-category")?.value,
        message: document.querySelector("#donor-message")?.value,
      };

      setFormLoading(form, true);
      try {
        const result = await apiPost("/donate/initiate", data);

        if (result.success) {
          showDonationInstructions(result);
        } else {
          const errorMessage =
            result.errors && result.errors.length
              ? result.errors[0]
              : result.message ||
                "Could not process your donation. Please try again.";
          showToast(errorMessage, "error");
        }
      } catch (err) {
        showToast("Network error. Please check your connection.", "error");
      } finally {
        setFormLoading(form, false);
      }
    });
  }

  function initDonationOnlinePayment() {
    const button = document.querySelector("[data-donation-online]");
    if (!button) return;
    const scopeForm = button.closest("form");

    button.addEventListener("click", async () => {
      const data = {
        fullName: document.querySelector("#donor-full-name")?.value,
        email: document.querySelector("#donor-email")?.value,
        phone: document.querySelector("#donor-phone")?.value,
        amount: document.querySelector("#donation-amount")?.value,
        category: document.querySelector("#donation-category")?.value,
        message: document.querySelector("#donor-message")?.value,
        idempotencyKey:
          window.crypto?.randomUUID?.() ||
          `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      };

      if (!data.fullName || !data.email || !data.phone || !data.amount || !data.category) {
        showToast("Please complete the donation form first.", "error");
        return;
      }

      if (scopeForm) setFormLoading(scopeForm, true);
      try {
        const result = await apiPost("/donate/payments/initialize", data);
        if (result.success && (result.authorizationUrl || result.data?.paystackData?.authorization_url)) {
          window.location.href =
            result.authorizationUrl ||
            result.data?.paystackData?.authorization_url ||
            "donate.html";
          return;
        }
        showToast(
          result.message || "Payment could not be initialized.",
          "error",
        );
      } catch {
        showToast("Network error. Please check your connection.", "error");
      } finally {
        if (scopeForm) setFormLoading(scopeForm, false);
      }
    });
  }

  async function initSearchPage() {
    const form = document.querySelector("[data-search-form]");
    const results = document.querySelector("[data-search-results]");
    const meta = document.querySelector("[data-search-meta]");
    if (!form || !results || !meta) return;

    const params = new URLSearchParams(window.location.search);
    const input = form.querySelector('[name="query"]');
    const render = (items) => {
      if (!items.length) {
        results.innerHTML =
          '<div class="empty-state"><h3>No results yet</h3><p>Try a different keyword or browse one of the content sections.</p></div>';
        return;
      }

      results.innerHTML = items
        .map(
          (item) => `
            <a class="search-result-card" href="${escapeHtml(item.url || "#")}">
              <span class="pill">${escapeHtml(item.type)}</span>
              <h3>${escapeHtml(item.title || "Untitled")}</h3>
              <p>${escapeHtml(item.summary || "")}</p>
            </a>
          `,
        )
        .join("");
    };

    const runSearch = async (query) => {
      const q = String(query || "").trim();
      if (input) input.value = q;
      if (q.length < 2) {
        meta.textContent = "Enter at least 2 characters to search the site.";
        results.innerHTML = "";
        return;
      }

      meta.textContent = `Searching for “${q}”…`;
      try {
        const result = await apiGet(`/search?q=${encodeURIComponent(q)}`);
        const items = Array.isArray(result.data) ? result.data : [];
        meta.textContent = items.length
          ? `${items.length} result${items.length === 1 ? "" : "s"} for “${q}”`
          : `No results found for “${q}”.`;
        render(items);
      } catch {
        meta.textContent = "Search failed. Please try again.";
        results.innerHTML = "";
      }
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      runSearch(input?.value || "");
    });

    if (params.get("q")) {
      await runSearch(params.get("q"));
    } else {
      meta.textContent = "Search across programs, projects, stories, news, and reports.";
    }
  }

  async function initNewsletterConfirmationPage() {
    const status = document.querySelector("[data-newsletter-confirmation-status]");
    if (!status) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) {
      status.textContent = "A confirmation token is required.";
      return;
    }

    try {
      const result = await apiPost("/newsletter/confirm", { token });
      status.textContent = result.message || "Subscription confirmed.";
    } catch {
      status.textContent = "Unable to confirm your subscription right now.";
    }
  }

  async function initNewsletterUnsubscribePage() {
    const status = document.querySelector("[data-newsletter-unsubscribe-status]");
    if (!status) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) {
      status.textContent = "A token is required to unsubscribe.";
      return;
    }

    try {
      const result = await apiPost("/newsletter/unsubscribe", { token });
      status.textContent = result.message || "You have been unsubscribed.";
    } catch {
      status.textContent = "Unable to process your unsubscribe request.";
    }
  }

  /* ─── Team photos — load from API ────────────────────────────── */
  function renderPublicTeamMembers(teamGrid, members) {
    if (!teamGrid || !Array.isArray(members)) return;

    if (!members.length) {
      teamGrid.innerHTML = '<p class="team-grid-status">No members are currently available.</p>';
      return;
    }

    teamGrid.innerHTML = members
      .map((member, index) => {
        const photoUrl = member.photo_url || member.photoUrl || "";
        const photo = photoUrl
          ? `<img src="${escapeHtml(photoUrl.startsWith("/") ? `${API_ORIGIN}${photoUrl}` : photoUrl)}" alt="${escapeHtml(member.full_name || member.fullName || "Team member")}" loading="lazy" />`
          : "";
        return `
          <article class="team-card visible" data-animate data-team-index="${escapeHtml(member.id)}">
            <div class="team-photo team-photo-${(index % 6) + 1}" data-team-photo>${photo}</div>
            <h3>${escapeHtml(member.full_name || member.fullName || "Team member")}</h3>
            <p class="team-role">${escapeHtml(member.role || "Team member")}</p>
            <p class="team-bio">${escapeHtml(member.bio || "")}</p>
          </article>
        `;
      })
      .join("");
  }

  async function loadTeamPhotos() {
    const teamGrid = document.querySelector(".team-grid");
    if (!teamGrid) return;

    try {
      const result = await apiGet("/team");
      if (!result.success) {
        teamGrid.innerHTML = '<p class="team-grid-status">Members could not be loaded right now.</p>';
        return;
      }

      if (!Array.isArray(result.data)) {
        teamGrid.innerHTML = '<p class="team-grid-status">Members could not be loaded right now.</p>';
        return;
      }
      renderPublicTeamMembers(teamGrid, result.data);
    } catch {
      teamGrid.innerHTML = '<p class="team-grid-status">Members could not be loaded right now.</p>';
    }
  }

  /* ─── Team photo upload ───────────────────────────────────────── */
  function initTeamPhotoUpload() {
    document.querySelectorAll(".team-photo-upload").forEach((input) => {
      input.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const card = input.closest(".team-card");
        const memberId = card?.dataset.teamIndex;
        if (!memberId) return;

        const formData = new FormData();
        formData.append("photo", file);
        formData.append("memberId", memberId);

        try {
          const res = await fetch(`${API_BASE}/team/photo`, {
            method: "POST",
            body: formData,
          });
          const result = await parseJsonResponse(res);

          if (result.success) {
            const photoDiv = card.querySelector("[data-team-photo]");
            if (photoDiv) {
              const fullUrl = `${API_BASE.replace("/api", "")}${result.photo_url}`;
              photoDiv.style.cssText = `background-image:url('${fullUrl}');background-size:cover;background-position:center`;
            }
            showToast("Photo updated successfully!");
          } else {
            showToast(result.message || "Photo upload failed.", "error");
          }
        } catch {
          showToast("Upload failed. Please check your connection.", "error");
        }
      });
    });
  }

  /* ─── Init ────────────────────────────────────────────────────── */
  window._wiiInitContentAdmin = initContentAdmin;
  document.addEventListener("DOMContentLoaded", () => {
  initContactForm();
  initVolunteerForm();
  initNewsletterForm();
  initDonationForm();
  initDonationOnlinePayment();
  initReceiptForm();
  initSearchPage();
  initNewsletterConfirmationPage();
  initNewsletterUnsubscribePage();
    initTeamPhotoUpload();
    initAdminConsole();
    initContentAdmin();
    loadImpactData();
    loadCmsContent();
    loadProgramsContent();
    loadProjectsContent();
    loadStoriesContent();
    loadNewsContent();
    loadReportsContent();
    loadTeamPhotos();
  });

  // Expose for debugging
  window._wiiAPI = {
    apiPost,
    apiGet,
    authGet,
    authPost,
    authPut,
    API_BASE,
  };
})();
