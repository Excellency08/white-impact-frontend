/*
 * Browser-only Supabase client bootstrap for the static frontend.
 *
 * The actual configuration is supplied by the ignored supabase-config.js file
 * or by window.__WII_SUPABASE_CONFIG__ in the deployment environment.
 * This module intentionally has no fallback to database or server secrets.
 */


const config = window.__WII_SUPABASE_CONFIG__ || {};
const url = typeof config.url === "string" ? config.url.trim() : "";
const publishableKey =
  typeof config.publishableKey === "string" ? config.publishableKey.trim() : "";
const authDiagnosticsEnabled =
  ["localhost", "127.0.0.1"].includes(window.location.hostname) ||
  ["5500", "5501"].includes(window.location.port);

function authDiagnostic(message) {
  if (authDiagnosticsEnabled) console.info(`[WII AUTH] ${message}`);
}

function setStatus(status, details = {}) {
  window.WII_SUPABASE_STATUS = { status, ...details };
}

function exposeAuthHelpers(client) {
  const programColumns = [
    "id", "slug", "title", "summary", "description", "body_copy",
    "hero_image_url", "hero_image_alt", "card_icon", "card_summary",
    "page_url", "cta_label", "cta_url", "status", "status_label",
    "status_detail", "hero_stats", "feature_items", "objectives",
    "activities", "beneficiaries", "locations", "timeline", "gallery",
    "impact_metrics", "reports", "partners", "seo_title",
    "seo_description", "display_order", "is_featured", "is_active",
    "updated_at", "created_at",
  ].join(", ");

  const formatProgram = (row, listView = false) => {
    const base = {
      id: row.id,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      description: row.description,
      heroImageUrl: row.hero_image_url || "",
      heroImageAlt: row.hero_image_alt || "",
      cardIcon: row.card_icon || "●",
      cardSummary: row.card_summary || row.summary,
      pageUrl: row.page_url || `${row.slug}.html`,
      ctaLabel: row.cta_label || "Learn more",
      ctaUrl: row.cta_url || row.page_url || `${row.slug}.html`,
      status: row.status || "Active",
      statusLabel: row.status_label || row.status || "Active",
      statusDetail: row.status_detail || "",
      seoTitle: row.seo_title || row.title,
      seoDescription: row.seo_description || row.summary,
      displayOrder: Number(row.display_order || 0),
      isFeatured: Boolean(row.is_featured),
      isActive: Boolean(row.is_active),
      updatedAt: row.updated_at,
      createdAt: row.created_at,
    };
    if (listView) return { ...base, heroStats: (row.hero_stats || []).slice(0, 3) };
    return {
      ...base,
      bodyCopy: row.body_copy || [],
      heroStats: row.hero_stats || [],
      featureItems: row.feature_items || [],
      objectives: row.objectives || [],
      activities: row.activities || [],
      beneficiaries: row.beneficiaries || [],
      locations: row.locations || [],
      timeline: row.timeline || [],
      gallery: row.gallery || [],
      impactMetrics: row.impact_metrics || [],
      reports: row.reports || [],
      partners: row.partners || [],
    };
  };

  const getPrograms = async (admin = false, full = false) => {
    let query = client.from("programs").select(programColumns).order("display_order").order("title");
    if (!admin) query = query.eq("is_active", true);
    const base = await query;
    if (base.error) return base;
    const [beneficiaries, locations, timeline, gallery, metrics, reports, links, partners] = await Promise.all([
      client.from("program_beneficiaries").select("program_id, title, description, image_url, display_order, id").order("display_order").order("id"),
      client.from("program_locations").select("program_id, name, description, country, state, city, display_order, id").order("display_order").order("id"),
      client.from("program_timeline").select("program_id, milestone_date, title, description, display_order, id").order("display_order").order("id"),
      client.from("program_gallery").select("program_id, image_url, alt_text, caption, display_order, id").order("display_order").order("id"),
      client.from("program_impact_metrics").select("program_id, label, value, description, icon, category, display_order, id").order("display_order").order("id"),
      client.from("program_reports").select("program_id, title, description, file_url, display_order, id").order("display_order").order("id"),
      client.from("program_partners").select("program_id, partner_id, display_order, id").order("display_order").order("id"),
      client.from("partners").select("id, name, description, logo_url"),
    ]);
    const childError = [beneficiaries, locations, timeline, gallery, metrics, reports, links, partners].find((result) => result.error);
    if (childError) return { data: null, error: childError.error };

    const partnerById = new Map((partners.data || []).map((row) => [row.id, row]));
    const byProgram = (rows, id) => (rows || []).filter((row) => row.program_id === id);

    const data = (base.data || []).map((row) => {
      const item = { ...row };
      const childBeneficiaries = byProgram(beneficiaries.data, row.id);
      const childLocations = byProgram(locations.data, row.id);
      const childTimeline = byProgram(timeline.data, row.id);
      const childGallery = byProgram(gallery.data, row.id);
      const childMetrics = byProgram(metrics.data, row.id);
      const childReports = byProgram(reports.data, row.id);
      const childPartners = byProgram(links.data, row.id);
      if (childBeneficiaries.length) item.beneficiaries = childBeneficiaries.map((v) => ({ title: v.title, summary: v.description, imageUrl: v.image_url }));
      if (childLocations.length) item.locations = childLocations.map((v) => ({ title: v.name, summary: v.description, country: v.country, state: v.state, city: v.city }));
      if (childTimeline.length) item.timeline = childTimeline.map((v) => ({ year: v.milestone_date, title: v.title, summary: v.description }));
      if (childGallery.length) item.gallery = childGallery.map((v) => ({ url: v.image_url, alt: v.alt_text, caption: v.caption }));
      if (childMetrics.length) item.impact_metrics = childMetrics.map((v) => ({ label: v.label, value: v.value, description: v.description, icon: v.icon, category: v.category }));
      if (childReports.length) item.reports = childReports.map((v) => ({ title: v.title, url: v.file_url, description: v.description }));
      if (childPartners.length) item.partners = childPartners.map((v) => partnerById.get(v.partner_id)).filter(Boolean).map((v) => ({ title: v.name, description: v.description, logoUrl: v.logo_url }));
      return formatProgram(item, !admin && !full);
    });
    return { data, error: null };
  };

  const programPayload = (values) => ({
    slug: values.slug,
    title: values.title,
    summary: values.summary,
    description: values.description,
    body_copy: values.bodyCopy || [],
    hero_image_url: values.heroImageUrl || "",
    hero_image_alt: values.heroImageAlt || "",
    card_icon: values.cardIcon || "●",
    card_summary: values.cardSummary || "",
    page_url: values.pageUrl || "",
    cta_label: values.ctaLabel || "Learn more",
    cta_url: values.ctaUrl || "",
    status: values.status || "Draft",
    status_label: values.statusLabel || "",
    status_detail: values.statusDetail || "",
    hero_stats: values.heroStats || [],
    feature_items: values.featureItems || [],
    objectives: values.objectives || [],
    activities: values.activities || [],
    beneficiaries: values.beneficiaries || [],
    locations: values.locations || [],
    timeline: values.timeline || [],
    gallery: values.gallery || [],
    impact_metrics: values.impactMetrics || [],
    reports: values.reports || [],
    partners: values.partners || [],
    seo_title: values.seoTitle || "",
    seo_description: values.seoDescription || "",
    display_order: Number(values.displayOrder || 0),
    is_featured: Boolean(values.isFeatured),
    is_active: Boolean(values.isActive),
  });

  const newsColumns = [
    "id", "slug", "title", "excerpt", "content", "hero_image_url",
    "hero_image_alt", "author_name", "author_role", "category", "tags",
    "related_articles", "status", "publication_date", "seo_title",
    "seo_description", "og_image_url", "display_order", "is_featured",
    "is_active", "updated_by", "updated_at", "created_at",
  ].join(", ");

  const cmsColumns = [
    "id", "page_key", "page_type", "title", "summary", "body", "settings",
    "hero_image_url", "hero_image_alt", "seo_title", "seo_description", "status",
    "display_order", "is_active", "updated_by", "updated_at", "created_at",
  ].join(", ");

  const formatCmsPage = (row) => ({
    id: row.id,
    pageKey: row.page_key,
    pageType: row.page_type,
    title: row.title,
    summary: row.summary || "",
    body: row.body && typeof row.body === "object" ? row.body : {},
    settings: row.settings && typeof row.settings === "object" ? row.settings : {},
    heroImageUrl: row.hero_image_url || "",
    heroImageAlt: row.hero_image_alt || "",
    seoTitle: row.seo_title || "",
    seoDescription: row.seo_description || "",
    status: row.status || "Draft",
    displayOrder: Number(row.display_order || 0),
    isActive: Boolean(row.is_active),
    updatedBy: row.updated_by || null,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  });

  const getCms = async (admin = false) => {
    let query = client
      .from("cms_pages")
      .select(cmsColumns)
      .order("display_order", { ascending: true })
      .order("title", { ascending: true });
    if (!admin) {
      query = query.eq("is_active", true).eq("status", "Published");
    }
    const result = await query;
    if (result.error) return result;
    const rows = (result.data || []).map(formatCmsPage);
    if (admin) return { data: rows, error: null };
    const byKey = new Map(rows.map((row) => [row.pageKey, row]));
    return {
      data: {
        siteSettings: byKey.get("site-settings") || null,
        homepage: byKey.get("homepage") || null,
        hero: byKey.get("hero") || null,
        footer: byKey.get("footer") || null,
        seo: byKey.get("seo") || null,
        partners: byKey.get("partners") || null,
        events: byKey.get("events") || null,
      },
      error: null,
    };
  };

  const cmsPayload = (values) => ({
    page_key: values.pageKey,
    page_type: values.pageType || "page",
    title: values.title,
    summary: values.summary || null,
    body: values.body && typeof values.body === "object" ? values.body : {},
    settings: values.settings && typeof values.settings === "object" ? values.settings : {},
    hero_image_url: values.heroImageUrl || null,
    hero_image_alt: values.heroImageAlt || null,
    seo_title: values.seoTitle || null,
    seo_description: values.seoDescription || null,
    status: values.status || "Draft",
    display_order: Number(values.displayOrder || 0),
    is_active: Boolean(values.isActive),
  });

  const formatNews = (row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    content: Array.isArray(row.content) ? row.content : [],
    heroImageUrl: row.hero_image_url || "",
    heroImageAlt: row.hero_image_alt || "",
    authorName: row.author_name || "White Impact Team",
    authorRole: row.author_role || "",
    category: row.category || "News",
    tags: Array.isArray(row.tags) ? row.tags : [],
    relatedArticles: Array.isArray(row.related_articles) ? row.related_articles : [],
    status: row.status || "Draft",
    publicationDate: row.publication_date || null,
    seoTitle: row.seo_title || row.title,
    seoDescription: row.seo_description || row.excerpt,
    ogImageUrl: row.og_image_url || row.hero_image_url || "",
    displayOrder: Number(row.display_order || 0),
    isFeatured: Boolean(row.is_featured),
    isActive: Boolean(row.is_active),
    updatedBy: row.updated_by || null,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    pageUrl: `news-article.html?slug=${encodeURIComponent(row.slug)}`,
  });

  const getNews = async (admin = false, slug = "") => {
    let query = client
      .from("news_posts")
      .select(newsColumns)
      .order("display_order", { ascending: true })
      .order("publication_date", { ascending: false, nullsFirst: false })
      .order("title", { ascending: true });
    if (!admin) query = query.eq("is_active", true);
    if (slug) query = query.eq("slug", slug);
    const result = await query;
    if (result.error) return result;
    return { data: (result.data || []).map(formatNews), error: null };
  };

  const newsPayload = (values) => ({
    slug: values.slug,
    title: values.title,
    excerpt: values.excerpt,
    content: values.content || [],
    hero_image_url: values.heroImageUrl || null,
    hero_image_alt: values.heroImageAlt || null,
    author_name: values.authorName || "White Impact Team",
    author_role: values.authorRole || null,
    category: values.category || "News",
    tags: values.tags || [],
    related_articles: values.relatedArticles || [],
    status: values.status || "Draft",
    publication_date: values.publicationDate || null,
    seo_title: values.seoTitle || null,
    seo_description: values.seoDescription || null,
    og_image_url: values.ogImageUrl || null,
    display_order: Number(values.displayOrder || 0),
    is_featured: Boolean(values.isFeatured),
    is_active: Boolean(values.isActive),
  });

  const initiativeColumns = [
    "id", "slug", "title", "summary", "description", "status", "status_label",
    "status_detail", "card_summary", "card_icon", "hero_image_url", "hero_image_alt",
    "body_copy", "seo_title", "seo_description", "display_order", "is_featured",
    "is_active", "updated_at", "created_at",
  ].join(", ");

  const initiativeSlug = (value) => String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const initiativeBasePayload = (values) => ({
    slug: initiativeSlug(values.slug),
    title: String(values.title || "").trim(),
    summary: String(values.summary || "").trim(),
    description: String(values.description || "").trim(),
    status: String(values.status || "Active").trim(),
    status_label: String(values.statusLabel || "").trim() || null,
    status_detail: String(values.statusDetail || "").trim() || null,
    card_summary: String(values.cardSummary || "").trim() || null,
    card_icon: String(values.cardIcon || "●").trim(),
    hero_image_url: String(values.heroImageUrl || "").trim() || null,
    hero_image_alt: String(values.heroImageAlt || "").trim() || null,
    body_copy: Array.isArray(values.bodyCopy) ? values.bodyCopy : [],
    seo_title: String(values.seoTitle || "").trim() || null,
    seo_description: String(values.seoDescription || "").trim() || null,
    display_order: Number(values.displayOrder || 0),
    is_featured: Boolean(values.isFeatured),
    is_active: values.isActive === undefined ? true : Boolean(values.isActive),
  });

  const formatInitiative = (row) => {
    const base = formatProgram(row, false);
    return {
      ...base,
      id: `program:${row.id}`,
      sourceId: row.id,
      entityType: "program",
    };
  };

  const getAdminInitiatives = async () => {
    const programs = await client.from("programs").select(initiativeColumns);
    if (programs.error) return { data: null, error: programs.error };
    const data = (programs.data || [])
      .map(formatInitiative)
      .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0) || a.title.localeCompare(b.title));
    return { data, error: null };
  };

  const donationColumns = [
    "id", "reference", "full_name", "email", "phone", "amount_kobo",
    "amount_naira", "program_area", "message", "status", "payment_provider",
    "payment_reference", "payment_status", "receipt_url", "receipt_storage_path",
    "paystack_data", "provider_payload", "confirmation_method", "verified_at",
    "paid_at", "created_at", "updated_at",
  ].join(", ");

  const formatDonation = (row) => ({
    id: row.id,
    reference: row.reference,
    fullName: row.full_name || "",
    email: row.email || "",
    phone: row.phone || "",
    amountKobo: Number(row.amount_kobo || 0),
    amountNaira: Number(row.amount_naira || 0),
    programArea: row.program_area || "",
    message: row.message || "",
    status: row.status || "pending",
    paymentProvider: row.payment_provider || "bank_transfer",
    paymentReference: row.payment_reference || "",
    paymentStatus: row.payment_status || row.status || "pending",
    receiptUrl: row.receipt_url || "",
    receiptStoragePath: row.receipt_storage_path || "",
    paystackData: row.paystack_data || null,
    providerPayload: row.provider_payload || null,
    confirmationMethod: row.confirmation_method || "",
    verifiedAt: row.verified_at || null,
    paidAt: row.paid_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  });

  const getAdminDonations = async () => {
    const result = await client
      .from("donations")
      .select(donationColumns)
      .order("created_at", { ascending: false })
      .limit(300);
    if (result.error) return result;
    return { data: (result.data || []).map(formatDonation), error: null };
  };

  const saveInitiative = async (record, values) => {
    const payload = initiativeBasePayload(values);
    if (!payload.slug || !payload.title || !payload.summary || !payload.description) {
      return { data: null, error: new Error("slug, title, summary, and description are required.") };
    }
    const query = record?.sourceId
      ? client.from("programs").update(payload).eq("id", record.sourceId).select(initiativeColumns).single()
      : client.from("programs").insert(payload).select(initiativeColumns).single();
    const result = await query;
    if (result.error) return result;
    return { data: formatInitiative(result.data), error: null };
  };

  window.WII_SUPABASE_AUTH = {
    signUp: (credentials, options) => client.auth.signUp({ ...credentials, options }),
    signIn: (credentials) => client.auth.signInWithPassword(credentials),
    signOut: () => client.auth.signOut(),
    getSession: () => client.auth.getSession(),
    getUser: () => client.auth.getUser(),
    linkCurrentAuthUser: () => client.rpc("link_current_auth_user"),
    exchangeCodeForSession: (code) => client.auth.exchangeCodeForSession(code),
    verifyOtp: (params) => client.auth.verifyOtp(params),
    setSession: (session) => client.auth.setSession(session),
    onAuthStateChange: (callback) => client.auth.onAuthStateChange(callback),
  };
  window.WII_SUPABASE_DATA = {
    invokePublicFunction: (name, body, path = "") =>
      client.functions.invoke(`${name}${path}`, { body }),
    getPrograms: () => getPrograms(false),
    getProgram: async (slug) => {
      const result = await getPrograms(false, true);
      if (result.error) return result;
      return { data: result.data.find((program) => program.slug === slug) || null, error: null };
    },
    getAdminPrograms: () => getPrograms(true),
    getAdminInitiatives,
    saveInitiative,
    getAdminDonations,
    createProgram: (values) => client.from("programs").insert(programPayload(values)).select(programColumns).single(),
    updateProgram: (id, values) => client.from("programs").update(programPayload(values)).eq("id", id).select(programColumns).single(),
    uploadProgramImage: async (programId, file, variant = "hero") => {
      const allowedTypes = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
      if (!/^\d+$/.test(String(programId))) return { data: null, error: new Error("A valid program ID is required.") };
      if (!file || !allowedTypes[file.type]) return { data: null, error: new Error("Only JPG, PNG, WEBP, and GIF images are allowed.") };
      if (file.size <= 0 || file.size > 10 * 1024 * 1024) return { data: null, error: new Error("Program images must be smaller than 10 MB.") };
      const folder = variant === "gallery" ? "gallery" : "hero";
      const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const path = `programs/${programId}/${folder}/program-${nonce}.${allowedTypes[file.type]}`;
      const upload = await client.storage.from("content-images").upload(path, file, { cacheControl: "3600", contentType: file.type, upsert: false });
      if (upload.error) return { data: null, error: upload.error };
      const publicUrl = client.storage.from("content-images").getPublicUrl(path).data.publicUrl;
      return { data: { path, publicUrl }, error: null };
    },
    getNews: () => getNews(false),
    getNewsPost: (slug) => getNews(false, slug),
    getAdminNews: () => getNews(true),
    createNews: (values) =>
      client.from("news_posts").insert(newsPayload(values)).select(newsColumns).single(),
    updateNews: (id, values) =>
      client.from("news_posts").update(newsPayload(values)).eq("id", id).select(newsColumns).single(),
    uploadNewsImage: async (newsId, file, variant = "hero") => {
      const allowedTypes = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
      };
      if (!/^\d+$/.test(String(newsId))) return { data: null, error: new Error("A valid news ID is required.") };
      if (!file || !allowedTypes[file.type]) return { data: null, error: new Error("Only JPG, PNG, WEBP, and GIF images are allowed.") };
      if (file.size <= 0 || file.size > 10 * 1024 * 1024) return { data: null, error: new Error("News images must be smaller than 10 MB.") };
      const folder = variant === "media" ? "media" : "hero";
      const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const path = `news/${newsId}/${folder}/news-${nonce}.${allowedTypes[file.type]}`;
      const upload = await client.storage.from("content-images").upload(path, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false,
      });
      if (upload.error) return { data: null, error: upload.error };
      const publicUrl = client.storage.from("content-images").getPublicUrl(path).data.publicUrl;
      return { data: { path, publicUrl }, error: null };
    },
    getCms: () => getCms(false),
    getAdminCms: () => getCms(true),
    createCms: (values) =>
      client.from("cms_pages").insert(cmsPayload(values)).select(cmsColumns).single(),
    updateCms: (id, values) =>
      client.from("cms_pages").update(cmsPayload(values)).eq("id", id).select(cmsColumns).single(),
    uploadCmsImage: async (cmsId, file, variant = "hero") => {
      const allowedTypes = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
      };
      if (!/^\d+$/.test(String(cmsId))) return { data: null, error: new Error("A valid CMS page ID is required.") };
      if (!file || !allowedTypes[file.type]) return { data: null, error: new Error("Only JPG, PNG, WEBP, and GIF images are allowed.") };
      if (file.size <= 0 || file.size > 10 * 1024 * 1024) return { data: null, error: new Error("CMS images must be smaller than 10 MB.") };
      const folder = variant === "media" ? "media" : "hero";
      const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const path = `cms/${cmsId}/${folder}/cms-${nonce}.${allowedTypes[file.type]}`;
      const upload = await client.storage.from("content-images").upload(path, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false,
      });
      if (upload.error) return { data: null, error: upload.error };
      const publicUrl = client.storage.from("content-images").getPublicUrl(path).data.publicUrl;
      return { data: { path, publicUrl }, error: null };
    },
    getPublicTeamMembers: () =>
      client
        .from("team_members")
        .select("id, full_name, role, bio, photo_url, display_order")
        .eq("is_active", true)
        .order("display_order", { ascending: true }),
    getAdminTeamMembers: () =>
      client
        .from("team_members")
        .select("id, full_name, role, bio, photo_url, display_order, is_active")
        .order("display_order", { ascending: true })
        .order("id", { ascending: true }),
    createTeamMember: (values) =>
      client
        .from("team_members")
        .insert({
          full_name: values.fullName,
          role: values.role,
          bio: values.bio || null,
          photo_url: values.photoUrl || null,
          display_order: values.displayOrder,
          is_active: values.isActive,
        })
        .select("id, full_name, role, bio, photo_url, display_order, is_active")
        .single(),
    uploadTeamMemberPhoto: async (memberId, file) => {
      const allowedTypes = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
      };
      if (!/^\d+$/.test(String(memberId))) {
        return { data: null, error: new Error("A valid team member ID is required.") };
      }
      if (!file || !allowedTypes[file.type]) {
        return { data: null, error: new Error("Only JPG, PNG, and WEBP images are allowed.") };
      }
      if (file.size <= 0 || file.size > 5 * 1024 * 1024) {
        return { data: null, error: new Error("Team photos must be smaller than 5 MB.") };
      }

      const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const path = `uploads/team/${memberId}/team-${nonce}.${allowedTypes[file.type]}`;
      const upload = await client.storage.from("team-photos").upload(path, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false,
      });
      if (upload.error) return { data: null, error: upload.error };

      const publicUrl = client.storage.from("team-photos").getPublicUrl(path).data.publicUrl;
      return { data: { path, publicUrl }, error: null };
    },
    removeTeamMemberPhoto: (path) =>
      client.storage.from("team-photos").remove([path]),
    updateTeamMember: (id, values) =>
      client
        .from("team_members")
        .update({
          full_name: values.fullName,
          role: values.role,
          bio: values.bio,
          photo_url: values.photoUrl,
          display_order: values.displayOrder,
          is_active: values.isActive,
        })
        .eq("id", id)
        .select("id, full_name, role, bio, photo_url, display_order, is_active")
        .maybeSingle(),
    getImpactDataset: async (admin = false) => {
      const visible = (query) => admin ? query : query.eq("is_active", true);
      const [metrics, history, programOutcomes, geographies, stories] = await Promise.all([
        visible(client.from("impact_metrics").select("id, metric_key, label, value, display_prefix, display_suffix, description, category, sort_order, is_active, updated_by, created_at, updated_at").order("category").order("sort_order").order("label")),
        client.from("impact_metric_history").select("id, metric_id, value, recorded_on, note, created_at").order("recorded_on", { ascending: false }).order("created_at", { ascending: false }).limit(100),
        visible(client.from("impact_program_outcomes").select("id, slug, title, summary, metric_label, metric_value, metric_suffix, sort_order, is_active, updated_at, created_at").order("sort_order").order("title")),
        visible(client.from("impact_geographies").select("id, slug, location_name, region, summary, beneficiary_label, beneficiary_value, beneficiary_suffix, sort_order, is_active, updated_at, created_at").order("sort_order").order("location_name")),
        visible(client.from("impact_stories").select("id, slug, headline, summary, source_label, related_program_slug, related_metric_key, sort_order, is_active, updated_at, created_at").order("sort_order").order("headline")),
      ]);
      const error = [metrics, history, programOutcomes, geographies, stories].find((result) => result.error)?.error || null;
      return {
        data: error ? null : {
          metrics: metrics.data || [],
          history: history.data || [],
          programOutcomes: programOutcomes.data || [],
          geographies: geographies.data || [],
          stories: stories.data || [],
        },
        error,
      };
    },
    upsertImpactMetric: (values) =>
      client
        .from("impact_metrics")
        .upsert({
          metric_key: values.metricKey,
          label: values.label,
          value: values.value,
          display_prefix: values.displayPrefix || "",
          display_suffix: values.displaySuffix || "",
          description: values.description || null,
          category: values.category || "overview",
          sort_order: values.sortOrder || 0,
          is_active: Boolean(values.isActive),
        }, { onConflict: "metric_key" })
        .select("id, metric_key, label, value, display_prefix, display_suffix, description, category, sort_order, is_active, updated_by, created_at, updated_at")
        .single(),
    updateImpactMetric: (id, values) =>
      client
        .from("impact_metrics")
        .update({
          label: values.label,
          value: values.value,
          display_prefix: values.displayPrefix || "",
          display_suffix: values.displaySuffix || "",
          description: values.description || null,
          category: values.category || "overview",
          sort_order: values.sortOrder || 0,
          is_active: Boolean(values.isActive),
        })
        .eq("id", id)
        .select("id, metric_key, label, value, display_prefix, display_suffix, description, category, sort_order, is_active, updated_by, created_at, updated_at")
        .single(),
    getAdminContacts: () =>
      client
        .from("contact_submissions")
        .select("id, full_name, email, subject, message, category, source_page, status, notes, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(200),
    updateContact: (id, values) =>
      client
        .from("contact_submissions")
        .update({
          full_name: values.fullName,
          email: values.email,
          subject: values.subject || null,
          message: values.message || null,
          category: values.category || "general",
          source_page: values.sourcePage || "work-with-us",
          status: values.status || "pending",
          notes: values.notes || null,
        })
        .eq("id", id)
        .select("id, full_name, email, subject, message, category, source_page, status, notes, created_at, updated_at")
        .single(),
    getAdminVolunteers: () =>
      client
        .from("volunteer_applications")
        .select("id, full_name, email, phone, location, availability, experience_level, skills, interests, motivation, portfolio_url, source_page, status, notes, reviewed_by, reviewed_at, created_at, updated_at")
        .order("created_at", { ascending: false }),
    updateVolunteer: (id, values) =>
      client
        .from("volunteer_applications")
        .update({
          full_name: values.fullName,
          email: values.email,
          phone: values.phone || null,
          location: values.location || null,
          availability: values.availability || null,
          experience_level: values.experienceLevel || null,
          skills: values.skills || [],
          interests: values.interests || [],
          motivation: values.motivation || null,
          portfolio_url: values.portfolioUrl || null,
          source_page: values.sourcePage || "work-with-us",
          status: values.status || "pending",
          notes: values.notes || null,
        })
        .eq("id", id)
        .select("id, full_name, email, phone, location, availability, experience_level, skills, interests, motivation, portfolio_url, source_page, status, notes, reviewed_by, reviewed_at, created_at, updated_at")
        .single(),
    getAdminNewsletterSubscribers: () =>
      client
        .from("newsletter_subs")
        .select("id, full_name, email, source_page, status, is_active, subscribed_at, confirmation_sent_at, confirmed_at, unsubscribed_at, created_at, updated_at")
        .order("subscribed_at", { ascending: false }),
    updateNewsletterSubscriber: (id, values) => {
      const status = values.status || "pending";
      const isActive = status === "confirmed" || status === "active";
      return client
        .from("newsletter_subs")
        .update({
          full_name: values.fullName || null,
          email: values.email,
          source_page: values.sourcePage || "website",
          status,
          is_active: isActive,
        })
        .eq("id", id)
        .select("id, full_name, email, source_page, status, is_active, subscribed_at, confirmation_sent_at, confirmed_at, unsubscribed_at, created_at, updated_at")
        .single();
    },
    getAnalyticsSummary: (days = 30) =>
      client.rpc("get_analytics_summary", { p_days: days }),
    getReports: () =>
      client
        .from("reports")
        .select("id, slug, title, summary, description, category, tags, file_url, preview_url, file_type, publication_date, download_count, status, seo_title, seo_description, og_image_url, display_order, is_featured, is_active, storage_provider, storage_path, original_filename, file_size, mime_type, updated_at, created_at")
        .order("display_order", { ascending: true })
        .order("publication_date", { ascending: false }),
    getPublicReports: () =>
      client
        .from("reports")
        .select("id, slug, title, summary, description, category, tags, file_url, preview_url, file_type, publication_date, download_count, status, seo_title, seo_description, og_image_url, display_order, is_featured, is_active, updated_at, created_at")
        .eq("is_active", true)
        .order("display_order", { ascending: true })
        .order("publication_date", { ascending: false }),
    getPublicReport: (slug) =>
      client
        .from("reports")
        .select("id, slug, title, summary, description, category, tags, file_url, preview_url, file_type, publication_date, download_count, status, seo_title, seo_description, og_image_url, display_order, is_featured, is_active, updated_at, created_at")
        .eq("slug", slug)
        .eq("is_active", true)
        .maybeSingle(),
    recordPublicReportDownload: (slug) =>
      client.rpc("record_public_report_download", { p_slug: slug }),
    createReport: (values) =>
      client
        .from("reports")
        .insert({
          slug: values.slug,
          title: values.title,
          summary: values.summary,
          description: values.description || null,
          category: values.category || "Publication",
          tags: values.tags || [],
          file_url: values.fileUrl,
          preview_url: values.previewUrl || values.fileUrl,
          file_type: values.fileType || "application/pdf",
          publication_date: values.publicationDate || null,
          status: values.status || "Draft",
          seo_title: values.seoTitle || null,
          seo_description: values.seoDescription || null,
          og_image_url: values.ogImageUrl || null,
          display_order: values.displayOrder || 0,
          is_featured: Boolean(values.isFeatured),
          is_active: Boolean(values.isActive),
          storage_provider: values.storageProvider || null,
          storage_path: values.storagePath || null,
          original_filename: values.originalFilename || null,
          file_size: values.fileSize || null,
          mime_type: values.mimeType || null,
        })
        .select("id, slug, title, summary, description, category, tags, file_url, preview_url, file_type, publication_date, download_count, status, seo_title, seo_description, og_image_url, display_order, is_featured, is_active, storage_provider, storage_path, original_filename, file_size, mime_type, updated_at, created_at")
        .single(),
    updateReport: (id, values) =>
      client
        .from("reports")
        .update({
          slug: values.slug,
          title: values.title,
          summary: values.summary,
          description: values.description || null,
          category: values.category || "Publication",
          tags: values.tags || [],
          file_url: values.fileUrl,
          preview_url: values.previewUrl || values.fileUrl,
          file_type: values.fileType || "application/pdf",
          publication_date: values.publicationDate || null,
          status: values.status || "Draft",
          seo_title: values.seoTitle || null,
          seo_description: values.seoDescription || null,
          og_image_url: values.ogImageUrl || null,
          display_order: values.displayOrder || 0,
          is_featured: Boolean(values.isFeatured),
          is_active: Boolean(values.isActive),
          storage_provider: values.storageProvider || null,
          storage_path: values.storagePath || null,
          original_filename: values.originalFilename || null,
          file_size: values.fileSize || null,
          mime_type: values.mimeType || null,
        })
        .eq("id", id)
        .select("id, slug, title, summary, description, category, tags, file_url, preview_url, file_type, publication_date, download_count, status, seo_title, seo_description, og_image_url, display_order, is_featured, is_active, storage_provider, storage_path, original_filename, file_size, mime_type, updated_at, created_at")
        .single(),
    uploadReportDocument: async (reportId, file) => {
      if (!/^\d+$/.test(String(reportId))) {
        return { data: null, error: new Error("A valid report ID is required.") };
      }
      if (!file || file.type !== "application/pdf") {
        return { data: null, error: new Error("Reports must be PDF files.") };
      }
      if (file.size <= 0 || file.size > 25 * 1024 * 1024) {
        return { data: null, error: new Error("Report PDFs must be smaller than 25 MB.") };
      }
      const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const path = `reports/${reportId}/report-${nonce}.pdf`;
      const upload = await client.storage.from("reports").upload(path, file, {
        cacheControl: "3600",
        contentType: "application/pdf",
        upsert: false,
      });
      if (upload.error) return { data: null, error: upload.error };
      const publicUrl = client.storage.from("reports").getPublicUrl(path).data.publicUrl;
      return { data: { path, publicUrl }, error: null };
    },
  };
}

async function initializeSupabase() {
  if (!url || !publishableKey || publishableKey.includes("REPLACE_ME")) {
    setStatus("missing-config");
    return null;
  }

  try {
    const { createClient } = await import(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm"
    );
    const client = createClient(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

    window.WII_SUPABASE_CLIENT = client;
    exposeAuthHelpers(client);
    setStatus("initialized");
    authDiagnostic("Supabase client ready");
    return client;
  } catch (error) {
    setStatus("initialization-failed", { message: error?.message || "Unknown error" });
    return null;
  }
}

// Export readiness only after the client and auth helpers are available. The
// API layer awaits this promise before attempting session synchronization.
export const ready = initializeSupabase();
window.WII_SUPABASE_READY = ready;
