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
