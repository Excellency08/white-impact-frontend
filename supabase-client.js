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
    "impact_metrics", "stories", "reports", "partners", "seo_title",
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
      stories: row.stories || [],
      reports: row.reports || [],
      partners: row.partners || [],
    };
  };

  const getPrograms = async (admin = false, full = false) => {
    let query = client.from("programs").select(programColumns).order("display_order").order("title");
    if (!admin) query = query.eq("is_active", true);
    const base = await query;
    if (base.error) return base;
    const [beneficiaries, locations, timeline, gallery, metrics, stories, reports, links, partners] = await Promise.all([
      client.from("program_beneficiaries").select("program_id, title, description, image_url, display_order, id").order("display_order").order("id"),
      client.from("program_locations").select("program_id, name, description, country, state, city, display_order, id").order("display_order").order("id"),
      client.from("program_timeline").select("program_id, milestone_date, title, description, display_order, id").order("display_order").order("id"),
      client.from("program_gallery").select("program_id, image_url, alt_text, caption, display_order, id").order("display_order").order("id"),
      client.from("program_impact_metrics").select("program_id, label, value, description, icon, category, display_order, id").order("display_order").order("id"),
      client.from("program_stories").select("program_id, story_id, display_order, id").order("display_order").order("id"),
      client.from("program_reports").select("program_id, title, description, file_url, display_order, id").order("display_order").order("id"),
      client.from("program_partners").select("program_id, partner_id, display_order, id").order("display_order").order("id"),
      client.from("partners").select("id, name, description, logo_url"),
    ]);
    const childError = [beneficiaries, locations, timeline, gallery, metrics, stories, reports, links, partners].find((result) => result.error);
    if (childError) return { data: null, error: childError.error };

    const storyIds = [...new Set((stories.data || []).map((row) => row.story_id).filter(Boolean))];
    let storyRows = [];
    if (storyIds.length) {
      const storyQuery = await client.from("stories").select("id, slug, title, excerpt").in("id", storyIds);
      if (storyQuery.error) return storyQuery;
      storyRows = storyQuery.data || [];
    }
    const storyById = new Map(storyRows.map((row) => [row.id, row]));
    const partnerById = new Map((partners.data || []).map((row) => [row.id, row]));
    const byProgram = (rows, id) => (rows || []).filter((row) => row.program_id === id);

    const data = (base.data || []).map((row) => {
      const item = { ...row };
      const childBeneficiaries = byProgram(beneficiaries.data, row.id);
      const childLocations = byProgram(locations.data, row.id);
      const childTimeline = byProgram(timeline.data, row.id);
      const childGallery = byProgram(gallery.data, row.id);
      const childMetrics = byProgram(metrics.data, row.id);
      const childStories = byProgram(stories.data, row.id);
      const childReports = byProgram(reports.data, row.id);
      const childPartners = byProgram(links.data, row.id);
      if (childBeneficiaries.length) item.beneficiaries = childBeneficiaries.map((v) => ({ title: v.title, summary: v.description, imageUrl: v.image_url }));
      if (childLocations.length) item.locations = childLocations.map((v) => ({ title: v.name, summary: v.description, country: v.country, state: v.state, city: v.city }));
      if (childTimeline.length) item.timeline = childTimeline.map((v) => ({ year: v.milestone_date, title: v.title, summary: v.description }));
      if (childGallery.length) item.gallery = childGallery.map((v) => ({ url: v.image_url, alt: v.alt_text, caption: v.caption }));
      if (childMetrics.length) item.impact_metrics = childMetrics.map((v) => ({ label: v.label, value: v.value, description: v.description, icon: v.icon, category: v.category }));
      if (childStories.length) item.stories = childStories.map((v) => storyById.get(v.story_id)).filter(Boolean).map((v) => ({ title: v.title, slug: v.slug, excerpt: v.excerpt }));
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
    stories: values.stories || [],
    reports: values.reports || [],
    partners: values.partners || [],
    seo_title: values.seoTitle || "",
    seo_description: values.seoDescription || "",
    display_order: Number(values.displayOrder || 0),
    is_featured: Boolean(values.isFeatured),
    is_active: Boolean(values.isActive),
  });

  const projectColumns = [
    "id", "slug", "title", "summary", "description", "program_slug",
    "location", "status", "status_label", "status_detail", "card_summary",
    "card_icon", "hero_image_url", "hero_image_alt", "body_copy", "timeline",
    "objectives", "outcomes", "media", "impact_metrics", "related_stories",
    "reports", "partners", "seo_title", "seo_description", "display_order",
    "is_featured", "is_active", "updated_at", "created_at",
  ].join(", ");

  const formatProject = (row, programBySlug, listView = false) => {
    const base = {
      id: row.id,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      description: row.description,
      programSlug: row.program_slug || "",
      programTitle: programBySlug.get(row.program_slug)?.title || "",
      location: row.location || "",
      status: row.status || "Active",
      statusLabel: row.status_label || row.status || "Active",
      statusDetail: row.status_detail || "",
      cardSummary: row.card_summary || row.summary,
      cardIcon: row.card_icon || "●",
      heroImageUrl: row.hero_image_url || "",
      heroImageAlt: row.hero_image_alt || "",
      seoTitle: row.seo_title || row.title,
      seoDescription: row.seo_description || row.summary,
      pageUrl: `project.html?slug=${encodeURIComponent(row.slug)}`,
      displayOrder: Number(row.display_order || 0),
      isFeatured: Boolean(row.is_featured),
      isActive: Boolean(row.is_active),
      updatedAt: row.updated_at,
      createdAt: row.created_at,
    };
    if (listView) return base;
    return {
      ...base,
      bodyCopy: row.body_copy || [],
      timeline: row.timeline || [],
      objectives: row.objectives || [],
      outcomes: row.outcomes || [],
      media: row.media || [],
      impactMetrics: row.impact_metrics || [],
      relatedStories: row.related_stories || [],
      reports: row.reports || [],
      partners: row.partners || [],
    };
  };

  const getProjects = async (admin = false, slug = "") => {
    let query = client.from("projects").select(projectColumns).order("display_order").order("title");
    if (!admin) query = query.eq("is_active", true);
    if (slug) query = query.eq("slug", slug);
    const projects = await query;
    if (projects.error) return projects;
    const slugs = [...new Set((projects.data || []).map((row) => row.program_slug).filter(Boolean))];
    let programs = { data: [], error: null };
    if (slugs.length) programs = await client.from("programs").select("id, slug, title").in("slug", slugs);
    if (programs.error) return programs;
    const programBySlug = new Map((programs.data || []).map((row) => [row.slug, row]));
    return {
      data: (projects.data || []).map((row) => formatProject(row, programBySlug, !admin && !slug)),
      error: null,
    };
  };

  const projectPayload = (values) => ({
    slug: values.slug,
    title: values.title,
    summary: values.summary,
    description: values.description,
    program_slug: values.programSlug || null,
    location: values.location || "",
    status: values.status || "Draft",
    status_label: values.statusLabel || "",
    status_detail: values.statusDetail || "",
    card_summary: values.cardSummary || "",
    card_icon: values.cardIcon || "●",
    hero_image_url: values.heroImageUrl || "",
    hero_image_alt: values.heroImageAlt || "",
    body_copy: values.bodyCopy || [],
    timeline: values.timeline || [],
    objectives: values.objectives || [],
    outcomes: values.outcomes || [],
    media: values.media || [],
    impact_metrics: values.impactMetrics || [],
    related_stories: values.relatedStories || [],
    reports: values.reports || [],
    partners: values.partners || [],
    seo_title: values.seoTitle || "",
    seo_description: values.seoDescription || "",
    display_order: Number(values.displayOrder || 0),
    is_featured: Boolean(values.isFeatured),
    is_active: Boolean(values.isActive),
  });

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
    getPrograms: () => getPrograms(false),
    getProgram: async (slug) => {
      const result = await getPrograms(false, true);
      if (result.error) return result;
      return { data: result.data.find((program) => program.slug === slug) || null, error: null };
    },
    getAdminPrograms: () => getPrograms(true),
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
    getProjects: () => getProjects(false),
    getProject: (slug) => getProjects(false, slug),
    getAdminProjects: () => getProjects(true),
    createProject: (values) => client.from("projects").insert(projectPayload(values)).select(projectColumns).single(),
    updateProject: (id, values) => client.from("projects").update(projectPayload(values)).eq("id", id).select(projectColumns).single(),
    uploadProjectImage: async (projectId, file, variant = "hero") => {
      const allowedTypes = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
      if (!/^\d+$/.test(String(projectId))) return { data: null, error: new Error("A valid project ID is required.") };
      if (!file || !allowedTypes[file.type]) return { data: null, error: new Error("Only JPG, PNG, WEBP, and GIF images are allowed.") };
      if (file.size <= 0 || file.size > 10 * 1024 * 1024) return { data: null, error: new Error("Project images must be smaller than 10 MB.") };
      const folder = variant === "media" ? "media" : "hero";
      const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const path = `projects/${projectId}/${folder}/project-${nonce}.${allowedTypes[file.type]}`;
      const upload = await client.storage.from("content-images").upload(path, file, { cacheControl: "3600", contentType: file.type, upsert: false });
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
    getReports: () =>
      client
        .from("reports")
        .select("id, slug, title, summary, description, category, tags, file_url, preview_url, file_type, publication_date, download_count, status, seo_title, seo_description, og_image_url, display_order, is_featured, is_active, storage_provider, storage_path, original_filename, file_size, mime_type, updated_at, created_at")
        .order("display_order", { ascending: true })
        .order("publication_date", { ascending: false }),
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
