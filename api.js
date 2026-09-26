/**
 * api.js — Frontend Supabase and Edge Function connector
 *
 * This file coordinates the browser Supabase client, Edge Functions, and UI
 * hydration for the static site.
 */

(function () {
  "use strict";

  // Wait for Supabase client initialization, including the CDN SDK import.
  const SUPABASE_READY = import("./supabase-client.js")
    .then((module) => module.ready)
    .catch(() => null);
  window.WII_SUPABASE_READY = SUPABASE_READY;

  const API_ORIGIN = "";
  const authDiagnosticsEnabled =
    ["localhost", "127.0.0.1"].includes(window.location.hostname) ||
    ["5500", "5501"].includes(window.location.port);

  function authDiagnostic(message) {
    if (authDiagnosticsEnabled) console.info(`[WII AUTH] ${message}`);
  }

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
    const payload = {
      eventKey,
      pagePath: window.location.pathname,
      referrer: document.referrer || null,
      sessionId: getAnalyticsSessionId(),
      metadata,
    };

    // Analytics is intentionally fire-and-forget so a failed Edge Function
    // never blocks page rendering or the user's primary action.
    void window.WII_SUPABASE_READY
      .then(() => window.WII_SUPABASE_DATA?.invokePublicFunction?.("analytics-events", payload))
      .catch(() => {});
  }

  trackAnalyticsEvent("page_view");

  function formatDateInputValue(value) {
    if (!value) return "";
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  }

  function clearSupabaseApplicationState() {
    delete window.WII_APPLICATION_AUTH;
  }

  function getSupabaseApplicationState() {
    return window.WII_APPLICATION_AUTH || null;
  }

  function getSupabaseCallbackDetails() {
    const callbackUrl = new URL(window.location.href);
    const search = callbackUrl.searchParams;
    const hash = new URLSearchParams(callbackUrl.hash.replace(/^#/, ""));
    const error = search.get("error") || hash.get("error");
    const errorDescription = search.get("error_description") || hash.get("error_description");

    if (search.has("code")) return { kind: "code", error, errorDescription };
    if (search.has("token_hash")) return { kind: "token_hash", error, errorDescription };
    if (hash.has("access_token") || hash.has("refresh_token")) {
      return { kind: "hash-session", error, errorDescription };
    }
    if (error) return { kind: "error", error, errorDescription };
    return { kind: "none", error: null, errorDescription: null };
  }

  async function getSupabaseAuth() {
    try {
      await window.WII_SUPABASE_READY;
    } catch {
      return null;
    }
    authDiagnostic(`Supabase auth helper ready: ${Boolean(window.WII_SUPABASE_AUTH)}`);
    return window.WII_SUPABASE_AUTH || null;
  }

  async function prepareSupabaseCallback(supabaseAuth) {
    const callbackUrl = new URL(window.location.href);
    const search = callbackUrl.searchParams;
    const hash = new URLSearchParams(callbackUrl.hash.replace(/^#/, ""));
    const details = getSupabaseCallbackDetails();
    const code = search.get("code");
    const tokenHash = search.get("token_hash");
    const tokenType = search.get("type");

    if (details.kind === "none") return details;
    authDiagnostic(`callback detected: ${details.kind}`);

    if (details.error) {
      throw new Error(details.errorDescription || "The Supabase authentication link could not be completed.");
    }

    if (code) {
      const result = await supabaseAuth.exchangeCodeForSession(code);
      if (result?.error) {
        throw new Error(result.error.message || "Supabase callback could not be completed.");
      }

      search.delete("code");
      search.delete("state");
    } else if (tokenHash && tokenType) {
      const result = await supabaseAuth.verifyOtp({
        token_hash: tokenHash,
        type: tokenType,
      });
      if (result?.error) {
        throw new Error(result.error.message || "Supabase verification could not be completed.");
      }
      search.delete("token_hash");
      search.delete("type");
    } else if (details.kind === "hash-session") {
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      if (accessToken && refreshToken) {
        const result = await supabaseAuth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (result?.error) {
          throw new Error(result.error.message || "Supabase session could not be established.");
        }
        callbackUrl.hash = "";
      }
    }

    window.history.replaceState({}, document.title, callbackUrl.toString());
    return details;
  }

  async function signInWithSupabase(email, password) {
    const supabaseAuth = await getSupabaseAuth();
    if (!supabaseAuth) {
      throw new Error("Supabase authentication is unavailable.");
    }

    const signedIn = await supabaseAuth.signIn({ email, password });
    authDiagnostic(`sign-in session exists: ${Boolean(signedIn?.data?.session)}`);
    if (signedIn?.error) {
      throw new Error(signedIn.error.message || "Supabase sign-in failed.");
    }
    if (!signedIn?.data?.session) {
      throw new Error("Supabase sign-in did not establish a session.");
    }

    return authorizeSupabaseSession(supabaseAuth);
  }

  function classifyMappingError(error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "").toLowerCase();
    if (code === "P0002" || message.includes("no eligible existing")) {
      return "This Supabase account is not linked to an existing application account.";
    }
    if (code === "P0003" || code === "23505" || message.includes("one-to-one") || message.includes("different application account")) {
      return "This Supabase account has an identity mapping conflict.";
    }
    if (code === "42501" || message.includes("verified") || message.includes("eligible")) {
      return "This account is not eligible for White Impact administration.";
    }
    return "White Impact could not verify this application account.";
  }

  async function authorizeSupabaseSession(supabaseAuth) {
    const sessionResult = await supabaseAuth.getSession();
    const session = sessionResult?.data?.session;
    authDiagnostic(`session exists: ${Boolean(session)}`);
    if (!session) {
      throw new Error("No active Supabase session was found.");
    }

    const userResult = await supabaseAuth.getUser();
    const user = userResult?.data?.user;
    authDiagnostic(`authenticated user exists: ${Boolean(user)}`);
    if (!user?.email) {
      throw new Error("The authenticated Supabase user could not be verified.");
    }

    authDiagnostic("starting application mapping RPC");
    const mappingResult = await supabaseAuth.linkCurrentAuthUser();
    authDiagnostic(`application mapping RPC succeeded: ${Boolean(!mappingResult?.error)}`);
    if (mappingResult?.error) {
      await supabaseAuth.signOut().catch(() => {});
      throw new Error(classifyMappingError(mappingResult.error));
    }

    const profile = Array.isArray(mappingResult.data)
      ? mappingResult.data[0]
      : mappingResult.data;
    if (!profile?.application_role) {
      await supabaseAuth.signOut().catch(() => {});
      throw new Error("The application role could not be verified.");
    }

    window.WII_APPLICATION_AUTH = {
      authenticated: true,
      email: user.email,
      role: profile.application_role,
      mappingStatus: profile.mapping_status || "linked",
    };
    return {
      success: true,
      user: {
        email: user.email,
        role: profile.application_role,
      },
      mappingStatus: profile.mapping_status || "linked",
    };
  }

  async function syncExistingSupabaseSession() {
    const supabaseAuth = await getSupabaseAuth();
    if (!supabaseAuth) return null;

    await prepareSupabaseCallback(supabaseAuth);
    authDiagnostic("getSession started");
    return authorizeSupabaseSession(supabaseAuth);
  }

  async function invokePublicEdgeFunction(name, body, path = "") {
    await window.WII_SUPABASE_READY;
    const invoke = window.WII_SUPABASE_DATA?.invokePublicFunction;
    if (!invoke) throw new Error("Supabase public submission is unavailable.");

    const result = await invoke(name, body, path);
    if (result?.error) {
      throw new Error(result.error.message || "The submission could not be completed.");
    }
    return result?.data || {};
  }

  async function updateTeamMemberInSupabase(id, payload) {
    await window.WII_SUPABASE_READY;
    const updateTeamMember = window.WII_SUPABASE_DATA?.updateTeamMember;
    if (!updateTeamMember) {
      return { success: false, message: "Supabase team update is unavailable." };
    }

    const { data, error } = await updateTeamMember(id, payload);
    if (error) {
      return { success: false, message: "Team member update was not authorized." };
    }
    if (!data) {
      return { success: false, message: "Team member was not found or cannot be updated." };
    }

    return {
      success: true,
      message: "Team member updated.",
      data,
    };
  }

  async function loadAdminTeamMembersFromSupabase() {
    await window.WII_SUPABASE_READY;
    const getAdminTeamMembers = window.WII_SUPABASE_DATA?.getAdminTeamMembers;
    if (!getAdminTeamMembers) {
      return { success: false, message: "Supabase team read is unavailable." };
    }

    const { data, error } = await getAdminTeamMembers();
    if (error) {
      return { success: false, message: "Team members could not be loaded." };
    }

    return { success: true, data: Array.isArray(data) ? data : [] };
  }

  async function createTeamMemberInSupabase(payload) {
    await window.WII_SUPABASE_READY;
    const createTeamMember = window.WII_SUPABASE_DATA?.createTeamMember;
    if (!createTeamMember) {
      return { success: false, message: "Supabase team creation is unavailable." };
    }

    const { data, error } = await createTeamMember(payload);
    if (error) {
      return { success: false, message: "Team member could not be created." };
    }
    if (!data) {
      return { success: false, message: "Team member could not be created." };
    }

    return {
      success: true,
      message: "Team member created.",
      data,
    };
  }

  function formatSupabaseReport(row) {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      description: row.description || "",
      category: row.category || "Publication",
      tags: Array.isArray(row.tags) ? row.tags : [],
      fileUrl: row.file_url,
      previewUrl: row.preview_url || row.file_url,
      fileType: row.file_type || "",
      publicationDate: row.publication_date || null,
      downloadCount: Number(row.download_count || 0),
      status: row.status || "Draft",
      seoTitle: row.seo_title || row.title,
      seoDescription: row.seo_description || row.summary,
      ogImageUrl: row.og_image_url || "",
      displayOrder: Number(row.display_order || 0),
      isFeatured: Boolean(row.is_featured),
      isActive: Boolean(row.is_active),
      storageProvider: row.storage_provider || "",
      storagePath: row.storage_path || "",
      originalFilename: row.original_filename || "",
      fileSize: Number(row.file_size || 0),
      mimeType: row.mime_type || "",
      updatedAt: row.updated_at,
      createdAt: row.created_at,
    };
  }

  function formatSupabaseNews(row) {
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      content: Array.isArray(row.content) ? row.content : [],
      heroImageUrl: row.hero_image_url || row.heroImageUrl || "",
      heroImageAlt: row.hero_image_alt || row.heroImageAlt || "",
      authorName: row.author_name || row.authorName || "White Impact Team",
      authorRole: row.author_role || row.authorRole || "",
      category: row.category || "News",
      tags: Array.isArray(row.tags) ? row.tags : [],
      relatedArticles: Array.isArray(row.related_articles)
        ? row.related_articles
        : row.relatedArticles || [],
      status: row.status || "Draft",
      publicationDate: row.publication_date || row.publicationDate || null,
      seoTitle: row.seo_title || row.seoTitle || row.title,
      seoDescription: row.seo_description || row.seoDescription || row.excerpt,
      ogImageUrl: row.og_image_url || row.ogImageUrl || row.hero_image_url || row.heroImageUrl || "",
      displayOrder: Number(row.display_order ?? row.displayOrder ?? 0),
      isFeatured: Boolean(row.is_featured ?? row.isFeatured),
      isActive: Boolean(row.is_active ?? row.isActive),
      updatedBy: row.updated_by || row.updatedBy || null,
      updatedAt: row.updated_at || row.updatedAt,
      createdAt: row.created_at || row.createdAt,
      pageUrl: `news-article.html?slug=${encodeURIComponent(row.slug || "")}`,
    };
  }

  async function loadNewsFromSupabase(admin = false, slug = "") {
    await window.WII_SUPABASE_READY;
    const getNews = slug
      ? window.WII_SUPABASE_DATA?.getNewsPost
      : admin
        ? window.WII_SUPABASE_DATA?.getAdminNews
        : window.WII_SUPABASE_DATA?.getNews;
    if (!getNews) return { success: false, message: "Supabase News read is unavailable." };
    const result = slug ? await getNews(slug) : await getNews();
    if (result.error) return { success: false, message: result.error.message || "Failed to load news." };
    return {
      success: true,
      data: Array.isArray(result.data) ? result.data.map(formatSupabaseNews) : [],
    };
  }

  function newsFormValues(payload, existing = {}) {
    const get = (name, fallback = "") => {
      const value = payload.get(name);
      return value === null || value === undefined ? fallback : String(value);
    };
    const json = (name, fallback = []) => {
      try {
        return JSON.parse(get(name, JSON.stringify(existing[name] || fallback)));
      } catch {
        return existing[name] || fallback;
      }
    };
    return {
      slug: get("slug", existing.slug),
      title: get("title", existing.title),
      excerpt: get("excerpt", existing.excerpt),
      content: json("content"),
      heroImageUrl: existing.heroImageUrl || "",
      heroImageAlt: get("heroImageAlt", existing.heroImageAlt),
      authorName: get("authorName", existing.authorName || "White Impact Team"),
      authorRole: get("authorRole", existing.authorRole),
      category: get("category", existing.category || "News"),
      tags: json("tags"),
      relatedArticles: json("relatedArticles"),
      status: get("status", existing.status || "Draft"),
      publicationDate: get("publicationDate", existing.publicationDate || "") || null,
      seoTitle: get("seoTitle", existing.seoTitle),
      seoDescription: get("seoDescription", existing.seoDescription),
      ogImageUrl: get("ogImageUrl", existing.ogImageUrl),
      displayOrder: Number(get("displayOrder", existing.displayOrder || 0) || 0),
      isFeatured: get("isFeatured", String(Boolean(existing.isFeatured))) === "true",
      isActive: get("isActive", String(Boolean(existing.isActive))) === "true",
    };
  }

  async function saveNewsInSupabase(record, payload) {
    await window.WII_SUPABASE_READY;
    const dataApi = window.WII_SUPABASE_DATA;
    if (!dataApi?.createNews || !dataApi?.updateNews || !dataApi?.uploadNewsImage) {
      return { success: false, message: "Supabase News management is unavailable." };
    }
    const file = payload.get("heroImageUrl");
    const values = newsFormValues(payload, record || {});
    const requestedIsActive = values.isActive;
    let created = null;
    if (!record?.id) {
      values.isActive = false;
      const result = await dataApi.createNews(values);
      if (result.error) return { success: false, message: result.error.message || "Failed to create news article." };
      created = result.data;
    }
    const newsId = record?.id || created?.id;
    if (file instanceof File && file.size > 0) {
      const upload = await dataApi.uploadNewsImage(newsId, file, "hero");
      if (upload.error) {
        if (created?.id) await dataApi.updateNews(created.id, { ...values, isActive: false });
        return { success: false, message: upload.error.message || "News image upload failed." };
      }
      values.heroImageUrl = upload.data.publicUrl;
    } else {
      values.heroImageUrl = record?.heroImageUrl || "";
    }
    values.isActive = requestedIsActive;
    const result = await dataApi.updateNews(newsId, values);
    if (result.error) return { success: false, message: result.error.message || "Failed to save news article." };
    return { success: true, data: formatSupabaseNews(result.data) };
  }

  function formatSupabaseCmsPage(row) {
    if (!row) return null;
    return {
      id: row.id,
      pageKey: row.page_key || row.pageKey,
      pageType: row.page_type || row.pageType,
      title: row.title,
      summary: row.summary || "",
      body: row.body && typeof row.body === "object" ? row.body : {},
      settings: row.settings && typeof row.settings === "object" ? row.settings : {},
      heroImageUrl: row.hero_image_url || row.heroImageUrl || "",
      heroImageAlt: row.hero_image_alt || row.heroImageAlt || "",
      seoTitle: row.seo_title || row.seoTitle || "",
      seoDescription: row.seo_description || row.seoDescription || "",
      status: row.status || "Draft",
      displayOrder: Number(row.display_order ?? row.displayOrder ?? 0),
      isActive: Boolean(row.is_active ?? row.isActive),
      updatedBy: row.updated_by || row.updatedBy || null,
      updatedAt: row.updated_at || row.updatedAt,
      createdAt: row.created_at || row.createdAt,
    };
  }

  const PARTNERS_CMS_DEFAULTS = Object.freeze({
    pageKey: "partners",
    pageType: "global",
    title: "Partners",
    seoTitle: "Partners | White Impact Development Initiative",
    seoDescription: "",
    status: "Published",
    displayOrder: 0,
    isActive: true,
  });

  async function loadCmsFromSupabase(admin = false) {
    await window.WII_SUPABASE_READY;
    const getCms = admin
      ? window.WII_SUPABASE_DATA?.getAdminCms
      : window.WII_SUPABASE_DATA?.getCms;
    if (!getCms) return { success: false, message: "Supabase CMS read is unavailable." };
    const result = await getCms();
    if (result.error) return { success: false, message: result.error.message || "Failed to load CMS content." };
    if (!admin) return { success: true, data: result.data || {} };
    return {
      success: true,
      data: Array.isArray(result.data) ? result.data.map(formatSupabaseCmsPage) : [],
    };
  }

  function cmsFormValues(payload, existing = {}) {
    const get = (name, fallback = "") => {
      const value = typeof payload.get === "function" ? payload.get(name) : payload[name];
      return value === null || value === undefined ? fallback : String(value);
    };
    const json = (name, fallback = {}) => {
      try {
        return JSON.parse(get(name, JSON.stringify(existing[name] || fallback)));
      } catch {
        return existing[name] || fallback;
      }
    };
    const body = json("body");
    const partnerLogos = json("partnerLogos", null);
    if (Array.isArray(partnerLogos)) body.logos = partnerLogos;
    return {
      pageKey: get("pageKey", existing.pageKey),
      pageType: get("pageType", existing.pageType || "page"),
      title: get("title", existing.title),
      summary: get("summary", existing.summary),
      body,
      settings: json("settings"),
      heroImageUrl: existing.heroImageUrl || "",
      heroImageAlt: get("heroImageAlt", existing.heroImageAlt),
      seoTitle: get("seoTitle", existing.seoTitle),
      seoDescription: get("seoDescription", existing.seoDescription),
      status: get("status", existing.status || "Draft"),
      displayOrder: Number(get("displayOrder", existing.displayOrder || 0) || 0),
      isActive: get("isActive", String(Boolean(existing.isActive))) === "true",
    };
  }

  async function saveCmsInSupabase(record, payload) {
    await window.WII_SUPABASE_READY;
    const dataApi = window.WII_SUPABASE_DATA;
    if (!dataApi?.createCms || !dataApi?.updateCms || !dataApi?.uploadCmsImage) {
      return { success: false, message: "Supabase CMS management is unavailable." };
    }
    const file = typeof payload.get === "function" ? payload.get("heroImageUrl") : null;
    const values = cmsFormValues(payload, record || {});
    const isPartners = values.pageKey === PARTNERS_CMS_DEFAULTS.pageKey || record?.pageKey === PARTNERS_CMS_DEFAULTS.pageKey;
    if (isPartners) {
      Object.assign(values, PARTNERS_CMS_DEFAULTS, {
        body: {
          ...(record?.body || {}),
          ...(values.body || {}),
          logos: Array.isArray(values.body?.logos) ? values.body.logos : [],
        },
      });
    }
    const partnerFiles = typeof payload.entries === "function"
      ? [...payload.entries()].filter(([name, value]) => name.startsWith("partnerLogoFile_") && value instanceof File && value.size > 0)
      : [];
    const requestedIsActive = isPartners ? true : values.isActive;
    let created = null;
    if (!record?.id) {
      values.isActive = isPartners ? true : false;
      const result = await dataApi.createCms(values);
      if (result.error) return { success: false, message: result.error.message || "Failed to create CMS page." };
      created = result.data;
    }
    const cmsId = record?.id || created?.id;
    if (Array.isArray(values.body?.logos) && partnerFiles.length) {
      for (const [name, partnerFile] of partnerFiles) {
        const index = Number(name.replace("partnerLogoFile_", ""));
        if (!Number.isInteger(index) || !values.body.logos[index]) continue;
        const upload = await dataApi.uploadCmsImage(cmsId, partnerFile, "partner");
        if (upload.error) return { success: false, message: upload.error.message || "Partner logo upload failed." };
        values.body.logos[index].logoUrl = upload.data.publicUrl;
      }
    }
    if (file instanceof File && file.size > 0) {
      const upload = await dataApi.uploadCmsImage(cmsId, file, "hero");
      if (upload.error) {
        if (created?.id) await dataApi.updateCms(created.id, { ...values, isActive: false });
        return { success: false, message: upload.error.message || "CMS image upload failed." };
      }
      values.heroImageUrl = upload.data.publicUrl;
    } else {
      values.heroImageUrl = record?.heroImageUrl || "";
    }
    values.isActive = requestedIsActive;
    const result = await dataApi.updateCms(cmsId, values);
    if (result.error) return { success: false, message: result.error.message || "Failed to save CMS page." };
    return { success: true, data: formatSupabaseCmsPage(result.data) };
  }

  async function loadReportsFromSupabase(admin = false, slug = "") {
    await window.WII_SUPABASE_READY;
    const dataApi = window.WII_SUPABASE_DATA;
    const getReports = slug
      ? dataApi?.getPublicReport
      : admin
        ? dataApi?.getReports
        : dataApi?.getPublicReports;
    if (!getReports) return { success: false, message: "Supabase Reports read is unavailable." };
    const { data, error } = slug ? await getReports(slug) : await getReports();
    if (error) return { success: false, message: error.message || "Failed to load reports." };
    if (slug) {
      return { success: true, data: data ? [formatSupabaseReport(data)] : [] };
    }
    return { success: true, data: Array.isArray(data) ? data.map(formatSupabaseReport) : [] };
  }

  function formatSupabaseImpactDataset(data) {
    const metrics = (data?.metrics || []).map((row) => {
      const value = Number(row.value || 0);
      const displayPrefix = row.display_prefix || "";
      const displaySuffix = row.display_suffix || "";
      return {
        id: row.id,
        metricKey: row.metric_key,
        label: row.label,
        value,
        displayPrefix,
        displaySuffix,
        displayValue: `${displayPrefix}${Math.round(value).toLocaleString()}${displaySuffix}`,
        description: row.description || "",
        category: row.category || "overview",
        sortOrder: Number(row.sort_order || 0),
        isActive: Boolean(row.is_active),
        updatedAt: row.updated_at,
        createdAt: row.created_at,
        createdBy: row.updated_by || null,
      };
    });
    const chartSource = metrics.length ? Math.max(...metrics.map((metric) => metric.value)) : 0;
    const withBars = metrics.map((metric) => ({
      ...metric,
      chartPercent: chartSource > 0 ? Math.max(8, Math.round((metric.value / chartSource) * 100)) : 0,
    }));
    const metricById = new Map(withBars.map((metric) => [metric.id, metric]));
    const history = (data?.history || []).map((row) => {
      const metric = metricById.get(row.metric_id);
      return {
        id: row.id,
        metricId: row.metric_id,
        metricKey: metric?.metricKey || "",
        metricLabel: metric?.label || "",
        value: Number(row.value || 0),
        recordedOn: row.recorded_on,
        note: row.note || "",
        createdAt: row.created_at,
      };
    });
    const programOutcomes = (data?.programOutcomes || []).map((row) => ({
      id: row.id, slug: row.slug, title: row.title, summary: row.summary,
      metricLabel: row.metric_label || "", metricValue: row.metric_value === null ? null : Number(row.metric_value),
      metricSuffix: row.metric_suffix || "", sortOrder: Number(row.sort_order || 0), isActive: Boolean(row.is_active), updatedAt: row.updated_at, createdAt: row.created_at,
    }));
    const geographies = (data?.geographies || []).map((row) => ({
      id: row.id, slug: row.slug, locationName: row.location_name, region: row.region || "", summary: row.summary,
      beneficiaryLabel: row.beneficiary_label || "", beneficiaryValue: row.beneficiary_value === null ? null : Number(row.beneficiary_value),
      beneficiarySuffix: row.beneficiary_suffix || "", sortOrder: Number(row.sort_order || 0), isActive: Boolean(row.is_active), updatedAt: row.updated_at, createdAt: row.created_at,
    }));
    const stories = (data?.stories || []).map((row) => ({
      id: row.id, slug: row.slug, headline: row.headline, summary: row.summary, sourceLabel: row.source_label || "",
      relatedProgramSlug: row.related_program_slug || "", relatedMetricKey: row.related_metric_key || "", sortOrder: Number(row.sort_order || 0), isActive: Boolean(row.is_active), updatedAt: row.updated_at, createdAt: row.created_at,
    }));
    return {
      metrics: withBars,
      overviewMetrics: withBars.filter((metric) => metric.category === "overview"),
      chartMetrics: withBars.filter((metric) => metric.category === "chart"),
      history,
      programOutcomes,
      geographies,
      stories,
      summary: {
        totalMetrics: withBars.length,
        activePrograms: programOutcomes.length,
        activeGeographies: geographies.length,
        activeStories: stories.length,
        latestRecordedOn: history[0]?.recordedOn || null,
        updatedAt: withBars[0]?.updatedAt || programOutcomes[0]?.updatedAt || geographies[0]?.updatedAt || stories[0]?.updatedAt || null,
      },
    };
  }

  async function loadImpactFromSupabase(admin = false) {
    await window.WII_SUPABASE_READY;
    const getImpactDataset = window.WII_SUPABASE_DATA?.getImpactDataset;
    if (!getImpactDataset) return { success: false, message: "Supabase Impact read is unavailable." };
    const { data, error } = await getImpactDataset(admin);
    if (error) return { success: false, message: error.message || "Failed to load impact data." };
    return { success: true, data: formatSupabaseImpactDataset(data) };
  }

  function normalizeImpactMetricKey(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  async function saveImpactMetricInSupabase(record, payload) {
    await window.WII_SUPABASE_READY;
    const dataApi = window.WII_SUPABASE_DATA;
    if (!dataApi?.upsertImpactMetric || !dataApi?.updateImpactMetric) {
      return { success: false, message: "Supabase Impact management is unavailable." };
    }
    const values = {
      metricKey: normalizeImpactMetricKey(payload.metricKey || record?.metricKey),
      label: String(payload.label || "").trim(),
      value: Number(payload.value),
      displayPrefix: String(payload.displayPrefix || "").trim(),
      displaySuffix: String(payload.displaySuffix || "").trim(),
      description: String(payload.description || "").trim(),
      category: String(payload.category || "overview").trim().toLowerCase() || "overview",
      sortOrder: Number(payload.sortOrder || 0),
      isActive: Boolean(payload.isActive),
    };
    if (!values.metricKey || !values.label || !Number.isFinite(values.value)) {
      return { success: false, message: "Metric key, label, and a numeric value are required." };
    }
    const result = record?.id
      ? await dataApi.updateImpactMetric(record.id, values)
      : await dataApi.upsertImpactMetric(values);
    return result.error
      ? { success: false, message: result.error.message || "Failed to save metric." }
      : { success: true, data: formatSupabaseImpactDataset({ metrics: [result.data] }).metrics[0] };
  }

  function formatSupabaseContact(row) {
    return {
      id: row.id, fullName: row.full_name, email: row.email, subject: row.subject || "",
      message: row.message || "", category: row.category || "general", sourcePage: row.source_page || "work-with-us",
      status: row.status || "pending", notes: row.notes || "", createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  function formatSupabaseVolunteer(row) {
    return {
      id: row.id, fullName: row.full_name, email: row.email, phone: row.phone || "", location: row.location || "",
      availability: row.availability || "", experienceLevel: row.experience_level || "", skills: row.skills || [],
      interests: row.interests || [], motivation: row.motivation || "", portfolioUrl: row.portfolio_url || "",
      sourcePage: row.source_page || "work-with-us", status: row.status || "pending", notes: row.notes || "",
      reviewedBy: row.reviewed_by || null, reviewedAt: row.reviewed_at || null, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  function formatSupabaseNewsletterSubscriber(row) {
    return {
      id: row.id, fullName: row.full_name || "", email: row.email, sourcePage: row.source_page || "website",
      status: row.status || (row.is_active ? "confirmed" : "unsubscribed"), isActive: Boolean(row.is_active),
      subscribedAt: row.subscribed_at, confirmationSentAt: row.confirmation_sent_at || null,
      confirmedAt: row.confirmed_at || null, unsubscribedAt: row.unsubscribed_at || null,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  async function loadAdminSubmissionsFromSupabase(kind) {
    await window.WII_SUPABASE_READY;
    const dataApi = window.WII_SUPABASE_DATA;
    const definitions = {
      contacts: [dataApi?.getAdminContacts, formatSupabaseContact],
      volunteers: [dataApi?.getAdminVolunteers, formatSupabaseVolunteer],
      newsletter: [dataApi?.getAdminNewsletterSubscribers, formatSupabaseNewsletterSubscriber],
    };
    const [load, format] = definitions[kind] || [];
    if (!load) return { success: false, message: "Supabase submission management is unavailable." };
    const { data, error } = await load();
    return error
      ? { success: false, message: error.message || "Failed to load records." }
      : { success: true, data: (data || []).map(format) };
  }

  async function loadAdminPartnershipRequestsFromSupabase() {
    const result = await loadAdminSubmissionsFromSupabase("contacts");
    if (!result.success) return result;
    return {
      success: true,
      data: result.data.filter((record) => {
        const subject = String(record.subject || "").trim().toLowerCase();
        const category = String(record.category || "").trim().toLowerCase();
        return category === "partnership" || subject === "partnership" || subject.includes("partnership");
      }),
    };
  }

  async function loadAdminDonationsFromSupabase() {
    await window.WII_SUPABASE_READY;
    const load = window.WII_SUPABASE_DATA?.getAdminDonations;
    if (!load) return { success: false, message: "Supabase donation management is unavailable." };
    const { data, error } = await load();
    return error
      ? { success: false, message: error.message || "Failed to load donations." }
      : { success: true, data: Array.isArray(data) ? data : [] };
  }

  async function saveAdminSubmissionInSupabase(kind, record, payload) {
    await window.WII_SUPABASE_READY;
    if (!record?.id) return { success: false, message: "Existing submissions can only be updated." };
    const dataApi = window.WII_SUPABASE_DATA;
    const definitions = {
      contacts: [dataApi?.updateContact, formatSupabaseContact],
      volunteers: [dataApi?.updateVolunteer, formatSupabaseVolunteer],
      newsletter: [dataApi?.updateNewsletterSubscriber, formatSupabaseNewsletterSubscriber],
    };
    const [save, format] = definitions[kind] || [];
    if (!save) return { success: false, message: "Supabase submission management is unavailable." };
    const { data, error } = await save(record.id, { ...record, ...payload });
    return error
      ? { success: false, message: error.message || "Failed to update record." }
      : { success: true, data: format(data) };
  }

  async function reviewAdminSubmissionInSupabase(kind, record, message, status) {
    const allowedStatuses = {
      contacts: new Set(["pending", "responded"]),
      volunteers: new Set(["pending", "approved", "rejected", "reviewed"]),
    };
    if (!allowedStatuses[kind]?.has(status) || status === "pending") {
      return { success: false, message: "That submission status is not available." };
    }
    try {
      const result = await invokePublicEdgeFunction("submission-review", {
        kind,
        id: record.id,
        status,
        message,
      });
      return result?.success === false
        ? { success: false, message: result.message || "Submission review failed." }
        : { success: true, data: result.data, message: result.message };
    } catch (error) {
      return { success: false, message: error.message || "Submission review failed." };
    }
  }

  async function loadAnalyticsSummaryFromSupabase(days = 30) {
    await window.WII_SUPABASE_READY;
    const getAnalyticsSummary = window.WII_SUPABASE_DATA?.getAnalyticsSummary;
    if (!getAnalyticsSummary) return { success: false, message: "Supabase Analytics summary is unavailable." };
    const safeDays = Math.min(Math.max(Number(days) || 30, 1), 90);
    const { data, error } = await getAnalyticsSummary(safeDays);
    return error
      ? { success: false, message: error.message || "Failed to load analytics summary." }
      : { success: true, data: { days: safeDays, events: Array.isArray(data) ? data : [] } };
  }

  async function loadProgramsFromSupabase(admin = false) {
    await window.WII_SUPABASE_READY;
    const getPrograms = admin
      ? window.WII_SUPABASE_DATA?.getAdminPrograms
      : window.WII_SUPABASE_DATA?.getPrograms;
    if (!getPrograms) return { success: false, message: "Supabase Programs read is unavailable." };
    const { data, error } = await getPrograms();
    if (error) return { success: false, message: error.message || "Failed to load programs." };
    return { success: true, data: Array.isArray(data) ? data : [] };
  }

  function programFormValues(payload, existing = {}) {
    const get = (name, fallback = "") => {
      const value = payload.get(name);
      return value === null ? fallback : String(value);
    };
    const json = (name, fallback = []) => {
      try { return JSON.parse(get(name, JSON.stringify(existing[name] || fallback))); } catch { return existing[name] || fallback; }
    };
    return {
      slug: get("slug", existing.slug), title: get("title", existing.title),
      summary: get("summary", existing.summary), description: get("description", existing.description),
      heroImageUrl: existing.heroImageUrl || "", heroImageAlt: get("heroImageAlt", existing.heroImageAlt),
      cardIcon: get("cardIcon", existing.cardIcon), cardSummary: get("cardSummary", existing.cardSummary),
      pageUrl: get("pageUrl", existing.pageUrl), ctaLabel: get("ctaLabel", existing.ctaLabel), ctaUrl: get("ctaUrl", existing.ctaUrl),
      status: get("status", existing.status || "Draft"), statusLabel: get("statusLabel", existing.statusLabel), statusDetail: get("statusDetail", existing.statusDetail),
      seoTitle: get("seoTitle", existing.seoTitle), seoDescription: get("seoDescription", existing.seoDescription),
      displayOrder: Number(get("displayOrder", existing.displayOrder || 0) || 0),
      isFeatured: get("isFeatured", String(Boolean(existing.isFeatured))) === "true",
      isActive: get("isActive", String(Boolean(existing.isActive))) === "true",
      bodyCopy: json("bodyCopy"), heroStats: json("heroStats"), featureItems: json("featureItems"),
      objectives: json("objectives"), activities: json("activities"), beneficiaries: json("beneficiaries"),
      locations: json("locations"), timeline: json("timeline"), gallery: json("gallery"),
      impactMetrics: json("impactMetrics"), reports: json("reports"), partners: json("partners"),
    };
  }

  async function saveProgramInSupabase(record, payload) {
    await window.WII_SUPABASE_READY;
    const dataApi = window.WII_SUPABASE_DATA;
    if (!dataApi?.createProgram || !dataApi?.updateProgram || !dataApi?.uploadProgramImage) {
      return { success: false, message: "Supabase Programs management is unavailable." };
    }
    const file = payload.get("heroImageUrl");
    const values = programFormValues(payload, record || {});
    let created = null;
    if (!record?.id) {
      values.isActive = false;
      const result = await dataApi.createProgram(values);
      if (result.error) return { success: false, message: result.error.message || "Failed to create program." };
      created = result.data;
    }
    const programId = record?.id || created?.id;
    if (file instanceof File && file.size > 0) {
      const upload = await dataApi.uploadProgramImage(programId, file, "hero");
      if (upload.error) {
        if (created?.id) await dataApi.updateProgram(created.id, { ...values, isActive: false });
        return { success: false, message: upload.error.message || "Program image upload failed." };
      }
      values.heroImageUrl = upload.data.publicUrl;
    } else {
      values.heroImageUrl = record?.heroImageUrl || "";
    }
    const result = await dataApi.updateProgram(programId, values);
    if (result.error) return { success: false, message: result.error.message || "Failed to save program." };
    return { success: true, data: result.data };
  }

  function reportFormValues(payload, existing = {}) {
    const get = (name, fallback = "") => {
      const value = payload.get(name);
      return value === null ? fallback : String(value);
    };
    let tags = existing.tags || [];
    try { tags = JSON.parse(get("tags", JSON.stringify(tags))); } catch { /* keep existing tags */ }
    return {
      slug: get("slug", existing.slug),
      title: get("title", existing.title),
      summary: get("summary", existing.summary),
      description: get("description", existing.description),
      category: get("category", existing.category || "Publication"),
      tags,
      fileUrl: existing.fileUrl || "about:blank",
      previewUrl: existing.previewUrl || existing.fileUrl || "about:blank",
      fileType: existing.fileType || "application/pdf",
      publicationDate: get("publicationDate", existing.publicationDate || "") || null,
      status: get("status", existing.status || "Draft"),
      seoTitle: get("seoTitle", existing.seoTitle),
      seoDescription: get("seoDescription", existing.seoDescription),
      ogImageUrl: get("ogImageUrl", existing.ogImageUrl),
      displayOrder: Number(get("displayOrder", existing.displayOrder || 0) || 0),
      isFeatured: get("isFeatured", String(Boolean(existing.isFeatured))) === "true",
      isActive: get("isActive", String(Boolean(existing.isActive))) === "true",
      storageProvider: existing.storageProvider || null,
      storagePath: existing.storagePath || null,
      originalFilename: existing.originalFilename || null,
      fileSize: existing.fileSize || null,
      mimeType: existing.mimeType || null,
    };
  }

  async function saveReportInSupabase(record, payload) {
    const dataApi = window.WII_SUPABASE_DATA;
    if (!dataApi?.createReport || !dataApi?.updateReport || !dataApi?.uploadReportDocument) {
      return { success: false, message: "Supabase Reports management is unavailable." };
    }
    const file = payload.get("file");
    const values = reportFormValues(payload, record || {});
    if (!(file instanceof File) || file.size === 0) {
      if (!record?.id) return { success: false, message: "A PDF report file is required." };
    }
    let created = null;
    if (!record?.id) {
      values.isActive = false;
      const result = await dataApi.createReport(values);
      if (result.error) return { success: false, message: result.error.message || "Failed to create report." };
      created = result.data;
    }
    const reportId = record?.id || created?.id;
    if (file instanceof File && file.size > 0) {
      const upload = await dataApi.uploadReportDocument(reportId, file);
      if (upload.error) {
        if (created?.id) await dataApi.updateReport(created.id, { ...values, isActive: false });
        return { success: false, message: upload.error.message || "Report upload failed." };
      }
      values.fileUrl = upload.data.publicUrl;
      values.previewUrl = upload.data.publicUrl;
      values.fileType = "application/pdf";
      values.storageProvider = "supabase";
      values.storagePath = upload.data.path;
      values.originalFilename = file.name;
      values.fileSize = file.size;
      values.mimeType = file.type;
    }
    const result = await dataApi.updateReport(reportId, values);
    if (result.error) return { success: false, message: result.error.message || "Failed to save report." };
    return { success: true, data: formatSupabaseReport(result.data) };
  }

  async function uploadTeamMemberPhotoInSupabase(memberId, file) {
    await window.WII_SUPABASE_READY;
    const uploadTeamMemberPhoto = window.WII_SUPABASE_DATA?.uploadTeamMemberPhoto;
    if (!uploadTeamMemberPhoto) {
      return { success: false, message: "Supabase team photo upload is unavailable." };
    }

    const { data, error } = await uploadTeamMemberPhoto(memberId, file);
    if (error || !data?.publicUrl) {
      return {
        success: false,
        message: error?.message || "Team photo upload failed.",
        path: data?.path || null,
      };
    }
    return { success: true, data };
  }

  async function removeTeamMemberPhotoInSupabase(path) {
    if (!path) return;
    try {
      await window.WII_SUPABASE_READY;
      const removeTeamMemberPhoto = window.WII_SUPABASE_DATA?.removeTeamMemberPhoto;
      if (removeTeamMemberPhoto) {
        const { error } = await removeTeamMemberPhoto(path);
        return !error;
      }
    } catch {
      return false;
    }
    return false;
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
    const grid = document.querySelector("[data-program-grid]");
    if (!grid) return;
    if (!programs.length) {
      grid.innerHTML = '<p class="content-loading-state">No programs are currently available.</p>';
      return;
    }

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

  function renderContentBlocks(blocks) {
    const items = Array.isArray(blocks) ? blocks : [];
    if (!items.length) {
      return "<p>Content will appear here once it is published.</p>";
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
              <img src="${escapeHtml(block.url || block.src || "")}" alt="${escapeHtml(block.alt || block.caption || "Content image")}" loading="lazy" />
              ${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ""}
            </figure>
          `;
        }

        return `<p>${text}</p>`;
      })
      .join("");
  }

  function renderNewsContentBlocks(blocks) {
    return renderContentBlocks(blocks);
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
        window.WII_SUPABASE_READY
          .then(() => window.WII_SUPABASE_DATA?.recordPublicReportDownload?.(report.slug))
          .catch(() => {});
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

    if (page === "solutions" || page === "home") {
      try {
        const result = await loadProgramsFromSupabase(false);
        if (result.success && Array.isArray(result.data)) {
          renderProgramCards(result.data);
        } else {
          renderProgramCards([]);
        }
      } catch {
        renderProgramCards([]);
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
      await window.WII_SUPABASE_READY;
      const getProgram = window.WII_SUPABASE_DATA?.getProgram;
      const result = getProgram ? await getProgram(page) : { data: null, error: new Error("Supabase Programs read is unavailable.") };
      if (!result.error && result.data) {
        applyProgramData(result.data);
      }
    } catch {
      // Static fallback stays visible.
    }
  }

  async function loadNewsContent() {
    const page = document.body.dataset.page;
    if (page !== "news" && page !== "news-article") return;

    try {
      if (page === "news") {
        const result = await loadNewsFromSupabase(false);
        if (result.success && Array.isArray(result.data)) {
          renderNewsCards(result.data);
        }
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const slug = params.get("slug");

      if (slug) {
        const result = await loadNewsFromSupabase(false, slug);
        if (result.success && result.data) {
          applyNewsData(result.data[0]);
        }
        return;
      }

      const listResult = await loadNewsFromSupabase(false);
      if (
        listResult.success &&
        Array.isArray(listResult.data) &&
        listResult.data.length
      ) {
        const firstPost = listResult.data[0];
        if (firstPost?.slug) {
          const detailResult = await loadNewsFromSupabase(false, firstPost.slug);
          if (detailResult.success && detailResult.data) {
            applyNewsData(detailResult.data[0]);
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
        const result = await loadReportsFromSupabase();
        if (result.success && Array.isArray(result.data)) {
          renderReportCards(result.data);
        }
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const slug = params.get("slug");

      if (slug) {
        const result = await loadReportsFromSupabase(false, slug);
        if (result.success && result.data?.[0]) {
          applyReportData(result.data[0]);
        }
        return;
      }

      const listResult = await loadReportsFromSupabase();
      if (
        listResult.success &&
        Array.isArray(listResult.data) &&
        listResult.data.length
      ) {
        const firstReport = listResult.data[0];
        if (firstReport?.slug) {
          const detailResult = await loadReportsFromSupabase(false, firstReport.slug);
          if (detailResult.success && detailResult.data?.[0]) {
            applyReportData(detailResult.data[0]);
            return;
          }
        }
        applyReportData(firstReport);
      }
    } catch {
      // Static fallback remains visible.
    }
  }

  async function hydrateStaticReportLinks() {
    const links = Array.from(document.querySelectorAll("[data-report-document-slug]"));
    if (!links.length) return;

    const slugs = [...new Set(links.map((link) => link.dataset.reportDocumentSlug).filter(Boolean))];
    const reports = await Promise.all(
      slugs.map(async (slug) => {
        const result = await loadReportsFromSupabase(false, slug);
        return result.success && result.data?.[0] ? [slug, result.data[0]] : [slug, null];
      }),
    );
    const bySlug = new Map(reports);

    links.forEach((link) => {
      const report = bySlug.get(link.dataset.reportDocumentSlug);
      if (report?.fileUrl) link.href = report.fileUrl;
    });
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
      const result = await loadCmsFromSupabase(false);
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

      if (page === "home" || page === "partner-with-us") {
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
        const logos = Array.isArray(partners.logos)
          ? [...partners.logos].sort((left, right) => Number(left?.displayOrder || 0) - Number(right?.displayOrder || 0))
          : [];
        if (track) {
          const renderedLogos = logos.length ? [...logos, ...logos] : [{ name: "Partner directory coming soon" }];
          track.innerHTML = renderedLogos
            .map((item) => {
              const label =
                typeof item === "string"
                  ? item
                  : item?.name || item?.label || "";
              const href = typeof item === "object" ? item?.href || "" : "";
              const content = escapeHtml(label);
              const logo = typeof item === "object" && item?.logoUrl
                ? `<img src="${escapeHtml(item.logoUrl)}" alt="" loading="lazy" />`
                : "";
              return href
                ? `<a class="partner-logo" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${logo}${content}</a>`
                : `<span class="partner-logo">${logo}${content}</span>`;
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
    const applicationAuth = getSupabaseApplicationState();
    if (!applicationAuth?.authenticated) {
      setAdminPanelState(false);
      if (document.body.dataset.page === "admin") {
        window.location.href = "admin-login.html";
      }
      return;
    }

    try {
      updateAdminIdentity({
        email: applicationAuth.email,
        role: applicationAuth.role,
      });
      setAdminPanelState(true);
      if (typeof window._wiiInitContentAdmin === "function") {
        window._wiiInitContentAdmin();
      }
      if (status) status.textContent = "Loading dashboard data…";

      const [
        programsRes,
        impactRes,
        newsRes,
        reportsRes,
        contactsRes,
        donationsRes,
        teamRes,
        volunteersRes,
        newsletterRes,
        analyticsRes,
      ] = await Promise.allSettled([
        loadProgramsFromSupabase(true),
        loadImpactFromSupabase(true),
        loadNewsFromSupabase(true),
        loadReportsFromSupabase(true),
        loadAdminSubmissionsFromSupabase("contacts"),
        loadAdminDonationsFromSupabase(),
        loadAdminTeamMembersFromSupabase(),
        loadAdminSubmissionsFromSupabase("volunteers"),
        loadAdminSubmissionsFromSupabase("newsletter"),
        loadAnalyticsSummaryFromSupabase(30),
      ]);

      const settledData = (result) =>
        result.status === "fulfilled" ? result.value : null;
      const programsData = settledData(programsRes);
      const impactData = settledData(impactRes);
      const newsData = settledData(newsRes);
      const reportsData = settledData(reportsRes);
      const contactsData = settledData(contactsRes);
      const donationsData = settledData(donationsRes);
      const teamData = settledData(teamRes);
      const volunteersData = settledData(volunteersRes);
      const newsletterData = settledData(newsletterRes);
      const analyticsData = settledData(analyticsRes);

      renderAdminSummaryCards({
        programs: Array.isArray(programsData?.data)
          ? programsData.data.length
          : 0,
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
      });
      renderAdminAnalytics(analyticsData);

      if (status) {
        status.textContent = `Signed in as ${applicationAuth.email || "Admin"}`;
      }
    } catch (error) {
      clearSupabaseApplicationState();
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
    if (page !== "admin" && page !== "admin-login" && page !== "admin-section") return;

    const form = document.querySelector("[data-admin-login-form]");
    const logoutBtn = document.querySelector("[data-admin-logout]");
    const passwordToggle = document.querySelector("[data-password-toggle]");

    passwordToggle?.addEventListener("click", () => {
      const passwordInput = form?.querySelector('[name="password"]');
      if (!passwordInput) return;
      const visible = passwordInput.type === "text";
      passwordInput.type = visible ? "password" : "text";
      passwordToggle.textContent = visible ? "Show" : "Hide";
      passwordToggle.setAttribute("aria-label", visible ? "Show password" : "Hide password");
    });

    const bootstrapAdminSession = async () => {
      let supabaseResult = null;
      try {
        supabaseResult = await syncExistingSupabaseSession();
      } catch (error) {
        const status = document.querySelector("[data-admin-status]");
        if (status) status.textContent = error.message || "Supabase session verification failed.";
        if (page === "admin" || page === "admin-section") {
          setAdminPanelState(false);
          return;
        }
      }

      if (page === "admin-login" && supabaseResult?.success) {
        window.location.href = "admin.html";
        return;
      }

      if (page === "admin") {
        setAdminPanelState(Boolean(getSupabaseApplicationState()?.authenticated));
        await loadAdminDashboard();
      }

      if (page === "admin-section" && !supabaseResult?.success) {
        window.location.href = "admin-login.html";
      }
    };

    window.WII_SUPABASE_APPLICATION_READY = bootstrapAdminSession();

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = form.querySelector('[name="email"]')?.value;
      const password = form.querySelector('[name="password"]')?.value;
      const status = document.querySelector("[data-admin-status]");

      if (!email || !password) return;

      setFormLoading(form, true);
      if (status) status.textContent = "Signing in…";

      try {
        let result = null;
        try {
          result = await signInWithSupabase(email, password);
        } catch (supabaseError) {
          if (status) status.textContent = supabaseError.message || "Supabase sign-in failed.";
          throw supabaseError;
        }

        if (!result?.success) {
          throw new Error(result?.message || "Login failed.");
        }

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
      const supabaseAuth = await getSupabaseAuth();
      await supabaseAuth?.signOut().catch(() => {});
      clearSupabaseApplicationState();
      setAdminPanelState(false);
      const status = document.querySelector("[data-admin-status]");
      if (status) status.textContent = "Signed out.";
      showToast("Signed out successfully.");
    });
  }

  function initContentAdmin() {
    const applicationReady = window.WII_SUPABASE_APPLICATION_READY;
    if (applicationReady) {
      applicationReady
        .catch(() => null)
        .finally(() => initContentAdminNow());
      return;
    }
    initContentAdminNow();
  }

  function initContentAdminNow() {
    const page = document.body.dataset.page;
    if (page !== "content-admin" && page !== "admin" && page !== "admin-section") return;

    const panelsEl = document.querySelector("[data-content-admin-panels]");
    const summaryEl = document.querySelector("[data-content-admin-summary]");
    const statusEl = document.querySelector("[data-content-admin-status]");
    const titleEl = document.querySelector("[data-content-admin-title]");
    const helpEl = document.querySelector("[data-content-admin-help]");
    const refreshBtn = document.querySelector("[data-content-admin-refresh]");
    const logoutBtn = document.querySelector("[data-content-admin-logout]");

    if (!panelsEl) return;
    if (panelsEl.dataset.contentAdminInitialized === "true") return;

    const configs = {
      initiatives: {
        label: "Initiatives",
        singular: "initiative",
        title: "Initiatives",
        description: "Manage program records from one content workspace.",
        load: async () => {
          await window.WII_SUPABASE_READY;
          const result = await window.WII_SUPABASE_DATA?.getAdminInitiatives?.();
          return result?.error
            ? { success: false, message: result.error.message || "Failed to load initiatives." }
            : { success: true, data: result?.data || [] };
        },
        save: async (record, payload) => {
          await window.WII_SUPABASE_READY;
          const result = await window.WII_SUPABASE_DATA?.saveInitiative?.(record, payload);
          return result?.error
            ? { success: false, message: result.error.message || "Failed to save initiative." }
            : { success: true, data: result.data };
        },
        archive: async (record) => {
          await window.WII_SUPABASE_READY;
          const result = await window.WII_SUPABASE_DATA?.saveInitiative?.(record, {
            ...record,
            status: "Paused",
            isActive: false,
          });
          return result?.error
            ? { success: false, message: result.error.message || "Failed to archive initiative." }
            : { success: true, data: result.data };
        },
        itemLabel: (record) => record.title || record.slug || "Untitled initiative",
        itemMeta: (record) => `Program | ${record.statusLabel || record.status || "Active"}`,
        emptyLabel: "No initiatives loaded yet.",
        defaultRecord: { entityType: "program", status: "Draft", displayOrder: 0, isFeatured: false, isActive: true, bodyCopy: [] },
        fields: [
          { name: "slug", label: "Slug", type: "text", required: true },
          { name: "title", label: "Title", type: "text", required: true },
          { name: "summary", label: "Summary", type: "textarea", rows: 3, required: true },
          { name: "description", label: "Description", type: "textarea", rows: 4, required: true },
          { name: "heroImageUrl", label: "Upload hero image", type: "image", accept: "image/*" },
          { name: "heroImageAlt", label: "Hero image alt text", type: "text" },
          { name: "cardIcon", label: "Card icon", type: "text" },
          { name: "cardSummary", label: "Card summary", type: "textarea", rows: 3 },
          { name: "status", label: "Status", type: "select", options: ["Active", "Draft", "Paused"] },
          { name: "statusLabel", label: "Status label", type: "text" },
          { name: "statusDetail", label: "Status detail", type: "textarea", rows: 3 },
          { name: "seoTitle", label: "SEO title", type: "text" },
          { name: "seoDescription", label: "SEO description", type: "textarea", rows: 3 },
          { name: "displayOrder", label: "Display order", type: "number" },
          { name: "isFeatured", label: "Featured", type: "checkbox" },
          { name: "isActive", label: "Active", type: "checkbox" },
          { name: "bodyCopy", label: "Body copy", type: "json", rows: 5 },
        ],
      },
      programs: {
        label: "Programs",
        singular: "program",
        title: "Programs",
        description:
          "Edit the public program pages, hero content, and supporting JSON sections.",
        load: () => loadProgramsFromSupabase(true),
        save: (record, payload) => saveProgramInSupabase(record, payload),
        archive: async (record) => {
          await window.WII_SUPABASE_READY;
          const updateProgram = window.WII_SUPABASE_DATA?.updateProgram;
          if (!updateProgram) return { success: false, message: "Supabase Programs update is unavailable." };
          const { data, error } = await updateProgram(record.id, { ...record, isActive: false, status: "Paused" });
          return error
            ? { success: false, message: error.message || "Program could not be archived." }
            : { success: true, data };
        },
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
          { name: "reports", label: "Reports", type: "json", rows: 5 },
          { name: "partners", label: "Partners", type: "json", rows: 5 },
        ],
      },
      news: {
        label: "News",
        singular: "news article",
        title: "News articles",
        description:
          "Create and update newsroom articles, publication status, imagery, and SEO metadata.",
        load: () => loadNewsFromSupabase(true),
        save: (record, payload) => saveNewsInSupabase(record, payload),
        archive: async (record) => {
          const result = await loadNewsFromSupabase(true);
          if (!result.success) return result;
          const current = result.data.find((item) => String(item.id) === String(record.id));
          if (!current) return { success: false, message: "News article not found." };
          const values = { ...current, isActive: false, status: "Archived" };
          const update = await window.WII_SUPABASE_DATA.updateNews(record.id, values);
          return update.error
            ? { success: false, message: update.error.message }
            : { success: true, data: formatSupabaseNews(update.data) };
        },
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
        load: () => loadReportsFromSupabase(true),
        save: saveReportInSupabase,
        archive: async (record) => {
          const result = await loadReportsFromSupabase(true);
          if (!result.success) return result;
          const current = result.data.find((item) => String(item.id) === String(record.id));
          if (!current) return { success: false, message: "Report not found." };
          const values = { ...current, isActive: false, status: "Archived" };
          const update = await window.WII_SUPABASE_DATA.updateReport(record.id, values);
          return update.error ? { success: false, message: update.error.message } : { success: true, data: formatSupabaseReport(update.data) };
        },
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
          { name: "file", label: "Upload report PDF", type: "file", required: true, accept: "application/pdf,.pdf" },
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
        load: () => loadImpactFromSupabase(true),
        loadRecords: (result) =>
          Array.isArray(result?.data?.metrics) ? result.data.metrics : [],
        save: (record, payload) => saveImpactMetricInSupabase(record, payload),
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
        load: () => loadCmsFromSupabase(true),
        loadRecords: (result) =>
          Array.isArray(result?.data)
            ? result.data.filter((page) => page.pageKey === "site-settings")
            : [],
        save: (record, payload) => saveCmsInSupabase(record, payload),
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
        load: () => loadCmsFromSupabase(true),
        loadRecords: (result) =>
          Array.isArray(result?.data)
            ? result.data.filter((page) => page.pageKey === "homepage")
            : [],
        save: (record, payload) => saveCmsInSupabase(record, payload),
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
        load: () => loadCmsFromSupabase(true),
        loadRecords: (result) =>
          Array.isArray(result?.data)
            ? result.data.filter((page) => page.pageKey === "hero")
            : [],
        save: (record, payload) => saveCmsInSupabase(record, payload),
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
        load: () => loadCmsFromSupabase(true),
        loadRecords: (result) =>
          Array.isArray(result?.data)
            ? result.data.filter((page) => page.pageKey === "footer")
            : [],
        save: (record, payload) => saveCmsInSupabase(record, payload),
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
        load: () => loadCmsFromSupabase(true),
        loadRecords: (result) =>
          Array.isArray(result?.data)
            ? result.data.filter((page) => page.pageKey === "seo")
            : [],
        save: (record, payload) => saveCmsInSupabase(record, payload),
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
        load: () => loadCmsFromSupabase(true),
        loadRecords: (result) =>
          Array.isArray(result?.data)
            ? result.data.filter((page) => page.pageKey === "partners")
            : [],
        save: (record, payload) => saveCmsInSupabase(record, payload),
        itemLabel: (record) => record.title || "Partners",
        itemMeta: (record) => record.status || "Draft",
        emptyLabel: "No partner record loaded yet.",
        defaultRecord: {
          ...PARTNERS_CMS_DEFAULTS,
          isActive: true,
          body: {},
          settings: {},
        },
        fields: [
          {
            name: "partnerLogos",
            label: "Published partners",
            type: "partner-list",
          },
        ],
      },
      events: {
        label: "Events",
        singular: "event record",
        title: "Events",
        description:
          "Edit upcoming event highlights, calls to action, and event metadata.",
        load: () => loadCmsFromSupabase(true),
        loadRecords: (result) =>
          Array.isArray(result?.data)
            ? result.data.filter((page) => page.pageKey === "events")
            : [],
        save: (record, payload) => saveCmsInSupabase(record, payload),
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
      team: {
        label: "Team",
        singular: "team member",
        title: "Team",
        description:
          "Edit leadership names, roles, bios, photos, and display ordering.",
        load: loadAdminTeamMembersFromSupabase,
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
            ? updateTeamMemberInSupabase(record.id, payload)
            : createTeamMemberInSupabase(payload),
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
        submissionKind: "volunteers",
        readOnly: true,
        singular: "volunteer application",
        title: "Volunteer applications",
        description:
          "Review volunteer applicants, update review status, and capture internal notes.",
        load: () => loadAdminSubmissionsFromSupabase("volunteers"),
        save: (record, payload) => saveAdminSubmissionInSupabase("volunteers", record, payload),
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
        submissionKind: "contacts",
        readOnly: true,
        singular: "contact submission",
        title: "Contact submissions",
        description:
          "Review and manage contact messages, partnership requests, and work-with-us inquiries.",
        load: () => loadAdminSubmissionsFromSupabase("contacts"),
        save: (record, payload) => saveAdminSubmissionInSupabase("contacts", record, payload),
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
      partnerships: {
        label: "Partnership requests",
        submissionKind: "contacts",
        readOnly: true,
        singular: "partnership request",
        title: "Partnership requests",
        description:
          "Review organizations that contacted White Impact about partnership opportunities, then add approved partners through the Partners editor.",
        load: loadAdminPartnershipRequestsFromSupabase,
        itemLabel: (record) => record.fullName || record.email || "Partnership request",
        itemMeta: (record) => `${record.status || "pending"} · ${record.subject || "Partnership inquiry"}`,
        emptyLabel: "No partnership requests loaded yet.",
      },
      newsletter: {
        label: "Newsletter",
        singular: "newsletter record",
        title: "Newsletter subscriptions",
        description:
          "Manage newsletter subscribers, confirmation state, and unsubscribe status.",
        load: () => loadAdminSubmissionsFromSupabase("newsletter"),
        save: (record, payload) => saveAdminSubmissionInSupabase("newsletter", record, payload),
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
        load: loadAdminDonationsFromSupabase,
        save: (record, payload) =>
          invokePublicEdgeFunction("donation-approve", { donationId: record.id, ...payload }),
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

    function partnerLogoItems(value) {
      return Array.isArray(value) ? value : [];
    }

    function renderPartnerLogoList(field, value) {
      const items = partnerLogoItems(value);
      return `
        <div class="form-group content-admin-span-full structured-list-field partner-logo-editor" data-partner-logo-list>
          <div class="structured-list-head">
            <div>
              <label>${escapeHtml(field.label)}</label>
              <p class="field-help">Add a partner name and choose its logo from your computer. Saved entries appear in the homepage marquee.</p>
            </div>
            <button class="btn btn-ghost" type="button" data-partner-logo-add>Add partner</button>
          </div>
          <div data-partner-logo-items>
            ${items.map((item, index) => `
              <div class="structured-list-item partner-logo-editor-item" data-partner-logo-item>
                <div class="structured-list-fields">
                  <span class="partner-logo-order" data-partner-logo-order>${index + 1}</span>
                  <label>
                    <span>Partner name</span>
                    <input type="text" data-partner-logo-name value="${escapeHtml(item?.name || item?.label || "")}" required />
                  </label>
                  <label>
                    <span>Partner logo</span>
                    <input type="file" data-partner-logo-file="${index}" accept="image/jpeg,image/png,image/webp,image/gif" />
                  </label>
                  ${item?.logoUrl ? `<img class="content-admin-image-preview" src="${escapeHtml(item.logoUrl)}" alt="Current partner logo" loading="lazy" />` : ""}
                </div>
                <button class="btn btn-ghost structured-list-remove" type="button" data-partner-logo-remove>Remove</button>
              </div>
            `).join("") || `<p class="content-admin-empty" data-partner-logo-empty>No partners added yet.</p>`}
          </div>
          <input type="hidden" name="partnerLogos" value="" />
        </div>
      `;
    }

    function readPartnerLogoList(container) {
      return [...container.querySelectorAll("[data-partner-logo-item]")]
        .map((item, index) => ({
          name: item.querySelector("[data-partner-logo-name]")?.value.trim() || "",
          logoUrl: item.dataset.logoUrl || item.querySelector("img")?.getAttribute("src") || "",
          displayOrder: index + 1,
          file: item.querySelector("[data-partner-logo-file]")?.files?.[0] || null,
        }))
        .filter((item) => item.name);
    }

    function refreshPartnerLogoOrder(container) {
      container.querySelectorAll("[data-partner-logo-item]").forEach((item, index) => {
        item.querySelector("[data-partner-logo-order]")?.replaceChildren(document.createTextNode(String(index + 1)));
        const file = item.querySelector("[data-partner-logo-file]");
        if (file) file.dataset.partnerLogoFile = String(index);
      });
    }

    function bindPartnerLogoEditors(form) {
      form.querySelectorAll("[data-partner-logo-list]").forEach((container) => {
        const itemsEl = container.querySelector("[data-partner-logo-items]");
        container.addEventListener("click", (event) => {
          if (event.target.closest("[data-partner-logo-add]")) {
            container.querySelector("[data-partner-logo-empty]")?.remove();
            const index = itemsEl.querySelectorAll("[data-partner-logo-item]").length;
            itemsEl.insertAdjacentHTML("beforeend", `
              <div class="structured-list-item partner-logo-editor-item" data-partner-logo-item>
                <div class="structured-list-fields">
                  <span class="partner-logo-order" data-partner-logo-order>${index + 1}</span>
                  <label><span>Partner name</span><input type="text" data-partner-logo-name required /></label>
                  <label><span>Partner logo</span><input type="file" data-partner-logo-file="${index}" accept="image/jpeg,image/png,image/webp,image/gif" required /></label>
                </div>
                <button class="btn btn-ghost structured-list-remove" type="button" data-partner-logo-remove>Remove</button>
              </div>
            `);
            refreshPartnerLogoOrder(container);
          }
          if (event.target.closest("[data-partner-logo-remove]")) {
            event.target.closest("[data-partner-logo-item]")?.remove();
            if (!itemsEl.querySelector("[data-partner-logo-item]")) {
              itemsEl.innerHTML = `<p class="content-admin-empty" data-partner-logo-empty>No partners added yet.</p>`;
            } else {
              refreshPartnerLogoOrder(container);
            }
          }
        });
      });
    }

    function renderField(config, field, record) {
      const value = field.type === "partner-list"
        ? record?.body?.logos || []
        : record?.[field.name];
      const id = `${config.label}-${field.name}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-");
      const required = field.required ? "required" : "";
      const help = field.help
        ? `<p class="field-help">${escapeHtml(field.help)}</p>`
        : "";

      if (field.type === "partner-list") {
        return renderPartnerLogoList(field, value);
      }

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
      const submissionKind = config.submissionKind || "";
      const currentStatus = String(record.status || "pending").trim();
      const submissionReviewActions = submissionKind === "contacts" && currentStatus === "pending"
        ? [{ status: "responded", label: "Mark Responded" }]
        : submissionKind === "volunteers" && currentStatus === "pending"
          ? [
              { status: "approved", label: "Approve" },
              { status: "rejected", label: "Reject" },
              { status: "reviewed", label: "Mark Reviewed" },
            ]
          : [];
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
          ${submissionReviewActions.length
            ? `<div class="content-admin-record-actions">
                <div class="content-admin-action-group" role="group" aria-label="Submission actions">
                  ${submissionReviewActions.map((action) => `<button class="btn ${action.status === "rejected" ? "btn-ghost" : "btn-primary"}" type="button" data-content-admin-open-submission-review data-review-kind="${submissionKind}" data-review-status="${action.status}" data-record-id="${escapeHtml(record.id)}">${action.label}</button>`).join("")}
                </div>
                <div class="donation-approval-card" data-submission-review-card hidden>
                  <div>
                    <p class="section-kicker">Email notification</p>
                    <h4>Confirm submission response</h4>
                    <p class="section-desc">The message will be sent to the email address submitted with this record.</p>
                  </div>
                  <dl class="donation-approval-summary">
                    <div><dt>Recipient</dt><dd>${escapeHtml(record.fullName || "Not provided")}</dd></div>
                    <div><dt>Email</dt><dd>${escapeHtml(record.email || "Not provided")}</dd></div>
                  </dl>
                  <label class="donation-approval-message-label" for="submission-review-message-${escapeHtml(record.id)}">Message</label>
                  <textarea id="submission-review-message-${escapeHtml(record.id)}" data-submission-review-message rows="5">Thank you for contacting White Impact Development Initiative. We have reviewed your submission and appreciate your interest in our work.</textarea>
                  <div class="donation-approval-actions">
                    <button class="btn btn-ghost" type="button" data-content-admin-cancel-submission-review>Cancel</button>
                    <button class="btn btn-primary" type="button" data-content-admin-send-submission-review data-review-kind="${submissionKind}" data-record-id="${escapeHtml(record.id)}">Send email</button>
                  </div>
                </div>
              </div>`
            : ""}
          ${config.label === "Donations" && record.status !== "verified" && record.paymentStatus !== "succeeded"
            ? `<div class="content-admin-record-actions">
                <button class="btn btn-primary" type="button" data-content-admin-open-approval data-record-id="${escapeHtml(record.id)}">Approve payment and notify donor</button>
                <div class="donation-approval-card" data-donation-approval-card hidden>
                  <div>
                    <p class="section-kicker">Approval message</p>
                    <h4>Confirm donor notification</h4>
                    <p class="section-desc">Review the donor details and personalize the appreciation message before sending.</p>
                  </div>
                  <dl class="donation-approval-summary">
                    <div><dt>Donor</dt><dd>${escapeHtml(record.fullName || "Not provided")}</dd></div>
                    <div><dt>Email</dt><dd>${escapeHtml(record.email || "Not provided")}</dd></div>
                    <div><dt>Amount</dt><dd>₦${Number(record.amountNaira || 0).toLocaleString()}</dd></div>
                    <div><dt>Reference</dt><dd>${escapeHtml(record.reference || "Not provided")}</dd></div>
                  </dl>
                  <label class="donation-approval-message-label" for="donation-approval-message-${escapeHtml(record.id)}">Message to donor</label>
                  <textarea id="donation-approval-message-${escapeHtml(record.id)}" data-donation-approval-message rows="5">Thank you for supporting our work and helping us create lasting impact in our communities.</textarea>
                  <div class="donation-approval-actions">
                    <button class="btn btn-ghost" type="button" data-content-admin-cancel-approval>Cancel</button>
                    <button class="btn btn-primary" type="button" data-content-admin-send-approval data-record-id="${escapeHtml(record.id)}">Send approval email</button>
                  </div>
                </div>
              </div>`
            : ""}
          ${config.label === "Donations" && record.receiptStoragePath
            ? `<div class="content-admin-record-actions">
                <button class="btn btn-ghost" type="button" data-content-admin-receipt-access data-record-id="${escapeHtml(record.id)}">Open private receipt</button>
              </div>`
            : ""}
          <dl class="content-admin-record-details">
            ${(config.fields || []).map((field) => `
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
            <article class="admin-card content-admin-summary-card admin-panel content-admin-sidebar" data-animate>
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
            renderPanels();
            syncPanelState(key, "Ready to create a new record.");
          });
        });

      panelsEl.querySelectorAll("[data-content-admin-open-approval]").forEach((button) => {
        button.addEventListener("click", () => {
          const card = button.parentElement?.querySelector("[data-donation-approval-card]");
          if (!card) return;
          card.hidden = false;
          button.hidden = true;
          card.querySelector("[data-donation-approval-message]")?.focus();
        });
      });

      panelsEl.querySelectorAll("[data-content-admin-open-submission-review]").forEach((button) => {
        button.addEventListener("click", () => {
          const actionGroup = button.closest("[data-content-admin-record-actions]");
          const card = actionGroup?.querySelector("[data-submission-review-card]");
          if (!card) return;
          const reviewStatus = button.dataset.reviewStatus || "";
          card.dataset.reviewStatus = reviewStatus;
          card.querySelector("[data-content-admin-send-submission-review]")?.setAttribute("data-review-status", reviewStatus);
          card.hidden = false;
          actionGroup.querySelectorAll("[data-content-admin-open-submission-review]").forEach((action) => {
            action.hidden = true;
          });
          card.querySelector("[data-submission-review-message]")?.focus();
        });
      });

      panelsEl.querySelectorAll("[data-content-admin-cancel-submission-review]").forEach((button) => {
        button.addEventListener("click", () => {
          const card = button.closest("[data-submission-review-card]");
          const openButtons = card?.parentElement?.querySelectorAll("[data-content-admin-open-submission-review]");
          if (card) card.hidden = true;
          openButtons?.forEach((openButton) => {
            openButton.hidden = false;
          });
        });
      });

      panelsEl.querySelectorAll("[data-content-admin-send-submission-review]").forEach((button) => {
        button.addEventListener("click", async () => {
          const kind = button.dataset.reviewKind;
          const record = getRecords(kind).find((item) => String(item.id) === String(button.dataset.recordId));
          const card = button.closest("[data-submission-review-card]");
          const message = card?.querySelector("[data-submission-review-message]")?.value.trim() || "";
          const status = button.dataset.reviewStatus || card?.dataset.reviewStatus || "";
          if (!record || !message) {
            showToast("Please add a message before sending.", "error");
            return;
          }
          button.disabled = true;
          syncPanelState(kind, "Updating submission and sending email…");
          try {
            const result = await reviewAdminSubmissionInSupabase(kind, record, message, status);
            if (!result.success) throw new Error(result.message);
            await loadSection(kind, record.id);
            showToast(result.message || "Submission updated and email sent.");
          } catch (error) {
            syncPanelState(kind, error.message || "Submission review failed.", "error");
            showToast(error.message || "Submission review failed.", "error");
          } finally {
            button.disabled = false;
          }
        });
      });

      panelsEl.querySelectorAll("[data-content-admin-cancel-approval]").forEach((button) => {
        button.addEventListener("click", () => {
          const card = button.closest("[data-donation-approval-card]");
          const openButton = card?.parentElement?.querySelector("[data-content-admin-open-approval]");
          if (card) card.hidden = true;
          if (openButton) openButton.hidden = false;
        });
      });

      panelsEl.querySelectorAll("[data-content-admin-send-approval]").forEach((button) => {
        button.addEventListener("click", async () => {
          const record = getRecords("donations").find(
            (item) => String(item.id) === String(button.dataset.recordId),
          );
          const card = button.closest("[data-donation-approval-card]");
          const message = card?.querySelector("[data-donation-approval-message]")?.value.trim() || "";
          if (!record || !message) {
            showToast("Please add an appreciation message before sending.", "error");
            return;
          }

          button.disabled = true;
          syncPanelState("donations", "Approving donation and notifying donor…");
          try {
            const result = await invokePublicEdgeFunction("donation-approve", {
              donationId: record.id,
              status: "verified",
              paymentStatus: "succeeded",
              confirmationMethod: "admin_approved",
              approvalMessage: message,
            });
            if (!result.success) throw new Error(result.message || "Donation approval failed.");
            await loadSection("donations", record.id);
            showToast(result.message || "Donation approved and donor notified.");
          } catch (error) {
            syncPanelState("donations", error.message || "Donation approval failed.", "error");
            showToast(error.message || "Donation approval failed.", "error");
          } finally {
            button.disabled = false;
          }
        });
      });

      panelsEl.querySelectorAll("[data-content-admin-receipt-access]").forEach((button) => {
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            const result = await invokePublicEdgeFunction("donation-receipt-access", {
              donationId: button.dataset.recordId,
            });
            if (!result.success || !result.data?.signedUrl) {
              throw new Error(result.message || "Private receipt access failed.");
            }
            window.open(result.data.signedUrl, "_blank", "noopener,noreferrer");
          } catch (error) {
            showToast(error.message || "Private receipt access failed.", "error");
          } finally {
            button.disabled = false;
          }
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

      panelsEl.querySelectorAll("[data-content-admin-form]").forEach((form) => {
        bindStructuredEditors(form);
        bindPartnerLogoEditors(form);
      });

      panelsEl.querySelectorAll("[data-content-admin-form]").forEach((form) => {
        const key = form.dataset.contentAdminForm;
        if (!key) return;
        form.addEventListener("submit", async (event) => {
          event.preventDefault();

          const config = configs[key];
          const current = getSelectedRecord(key) || getDefaultRecord(config);
          const isCmsKey = ["site-settings", "homepage", "hero", "footer", "seo", "partners", "events"].includes(
            current?.pageKey || key,
          );
          const hasFileField = config.fields.some(
            (field) => field.type === "file" || field.type === "partner-list" || ((["programs", "news"].includes(key) || isCmsKey) && field.type === "image"),
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

          const imageFields = key === "team"
            ? config.fields.filter((field) => field.type === "image" || field.type === "asset")
            : [];
          const teamPhotoField = key === "team"
            ? imageFields.find((field) => field.name === "photoUrl")
            : null;
          const teamPhotoFile = teamPhotoField
            ? form.elements.namedItem(teamPhotoField.name)?.files?.[0] || null
            : null;
          const uploadedImages = {};
          let teamPhotoUpload = null;
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

                if (key === "team" && field.name === "photoUrl") {
                  // New members need an ID first; their photo is uploaded after INSERT.
                  if (!current?.id) continue;
                  syncPanelState(key, `Uploading ${field.label.toLowerCase()}…`);
                  const result = await uploadTeamMemberPhotoInSupabase(current.id, file);
                  if (!result.success) throw new Error(result.message);
                  teamPhotoUpload = result.data;
                  uploadedImages[field.name] = result.data.publicUrl;
                  continue;
                }

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

            if (field.type === "partner-list") {
              const container = input.closest("[data-partner-logo-list]");
              const items = container ? readPartnerLogoList(container) : [];
              const partnerValues = items.map(({ name, logoUrl, displayOrder }) => ({ name, logoUrl, displayOrder }));
              if (hasFileField) {
                payload.append("partnerLogos", JSON.stringify(partnerValues));
                items.forEach((item, index) => {
                  if (item.file) payload.append(`partnerLogoFile_${index}`, item.file);
                });
              } else {
                payload[field.name] = partnerValues;
              }
              continue;
            }

            if (field.type === "image" || field.type === "asset") {
              const file = input.files?.[0];
              if (hasFileField && (key === "news" || isCmsKey) && field.name === "heroImageUrl") {
                if (file) payload.append(field.name, file);
                else payload.append(field.name, current?.[field.name] || "");
                continue;
              }
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
            let result = key === "reports"
              ? await saveReportInSupabase(current, payload)
              : key === "programs"
                ? await saveProgramInSupabase(current, payload)
                : key === "news"
                  ? await saveNewsInSupabase(current, payload)
                  : isCmsKey
                    ? await saveCmsInSupabase(current, payload)
              : await config.save(current, payload);
            if (!result.success) {
              throw new Error(result.message || "Save failed.");
            }

            if (key === "team" && !current?.id && teamPhotoFile && result.data?.id) {
              syncPanelState(key, "Uploading team photo…");
              const upload = await uploadTeamMemberPhotoInSupabase(result.data.id, teamPhotoFile);
              if (!upload.success) {
                throw new Error(upload.message);
              }
              teamPhotoUpload = upload.data;
              const withPhoto = await updateTeamMemberInSupabase(result.data.id, {
                ...payload,
                photoUrl: upload.data.publicUrl,
              });
              if (!withPhoto.success) {
                const cleaned = await removeTeamMemberPhotoInSupabase(upload.data.path);
                teamPhotoUpload = null;
                throw new Error(
                  `${withPhoto.message || "Team photo could not be linked."}${cleaned ? "" : " The uploaded file may remain in Storage."}`,
                );
              }
              result = withPhoto;
            }

            const saved = result.data || null;
            await loadSection(key, saved?.id || current?.id || null);
            showToast(
              `${config.singular || config.label.toLowerCase()} saved successfully.`,
            );
          } catch (error) {
            let cleanupWarning = "";
            if (teamPhotoUpload?.path) {
              const cleaned = await removeTeamMemberPhotoInSupabase(teamPhotoUpload.path);
              if (!cleaned) cleanupWarning = " The uploaded file may remain in Storage.";
            }
            const message = `${error.message || "Save failed."}${cleanupWarning}`;
            syncPanelState(key, message, "error");
            showToast(message, "error");
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
        renderPanels();
        syncPanelState(key, `${config.label} loaded.`);
      } catch (error) {
        state.records[key] = [];
        renderSummary();
        renderPanels();
        syncPanelState(
          key,
          error.message || `Failed to load ${config.label.toLowerCase()}.`,
          "error",
        );
      }
    }

    if (!getSupabaseApplicationState()?.authenticated) {
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

    renderPanels();

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
      const supabaseAuth = await getSupabaseAuth();
      await supabaseAuth?.signOut().catch(() => {});
      clearSupabaseApplicationState();
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
      const result = await loadImpactFromSupabase();
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
        category: document.body.dataset.page === "partner-with-us" ? "partnership" : "general",
      };

      setFormLoading(form, true);
      try {
        const result = await invokePublicEdgeFunction("contact-submit", data);
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
        const result = await invokePublicEdgeFunction("volunteer-submit", data);
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
        const result = await invokePublicEdgeFunction("newsletter", { email });
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
        const result = await invokePublicEdgeFunction("donation-receipt-submit", formData);

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
        const result = await invokePublicEdgeFunction("donation-submit", data);

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
      const result = await invokePublicEdgeFunction("newsletter", { token }, "/confirm");
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
      const result = await invokePublicEdgeFunction("newsletter", { token }, "/unsubscribe");
      status.textContent = result.message || "You have been unsubscribed.";
    } catch {
      status.textContent = "Unable to process your unsubscribe request.";
    }
  }

  /* ─── Public team members — direct Supabase read ─────────────── */
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
      await window.WII_SUPABASE_READY;
      const getPublicTeamMembers = window.WII_SUPABASE_DATA?.getPublicTeamMembers;
      if (!getPublicTeamMembers) throw new Error("Supabase public team read is unavailable.");

      const { data, error } = await getPublicTeamMembers();
      authDiagnostic(`public team read succeeded: ${Boolean(!error)}`);
      if (error || !Array.isArray(data)) throw new Error("Public team records could not be loaded.");
      renderPublicTeamMembers(teamGrid, data);
    } catch {
      teamGrid.innerHTML = '<p class="team-grid-status">Members could not be loaded right now.</p>';
    }
  }

  /* ─── Init ────────────────────────────────────────────────────── */
  window._wiiInitContentAdmin = initContentAdmin;
  document.addEventListener("DOMContentLoaded", () => {
  initContactForm();
  initVolunteerForm();
  initNewsletterForm();
  initDonationForm();
  initReceiptForm();
  initNewsletterConfirmationPage();
  initNewsletterUnsubscribePage();
    initAdminConsole();
    initContentAdmin();
    loadImpactData();
    loadCmsContent();
    loadProgramsContent();
    loadNewsContent();
    loadReportsContent();
    hydrateStaticReportLinks();
    loadTeamPhotos();
  });

})();
