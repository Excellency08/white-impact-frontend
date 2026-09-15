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
