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

  // ── Change this to your deployed backend URL in production ──────
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:3000/api"
      : "https://YOUR-BACKEND-URL.com/api"; // <-- update this after deployment

  /* ─── Generic fetch wrapper ───────────────────────────────────── */
  async function apiPost(endpoint, data) {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return res.json();
  }

  async function apiGet(endpoint) {
    const res = await fetch(`${API_BASE}${endpoint}`);
    return res.json();
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
      setTimeout(() => { toast.hidden = true; }, 400);
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
      if (!form.checkValidity()) { form.reportValidity(); return; }

      const data = {
        fullName: form.querySelector('[name="name"]')?.value,
        email:    form.querySelector('[name="email"]')?.value,
        subject:  form.querySelector('[name="subject"]')?.value,
        message:  form.querySelector('[name="message"]')?.value,
      };

      setFormLoading(form, true);
      try {
        const result = await apiPost("/contact", data);
        if (result.success) {
          form.reset();
          // Silent success - backend handles it
        } else {
          showToast(result.message || "Submission failed. Please try again.", "error");
        }
      } catch (err) {
        // Silent fail - let backend log it
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
  function initDonationForm() {
    const form = document.querySelector("[data-donation-form]");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }

      const firstName = document.querySelector("#donor-first-name")?.value || "";
      const lastName = document.querySelector("#donor-last-name")?.value || "";

      const data = {
        fullName: `${firstName} ${lastName}`.trim(),
        email:    document.querySelector("#donor-email")?.value,
        phone:    document.querySelector("#donor-phone")?.value,
        amount:   document.querySelector("#donation-amount")?.value,
        category: document.querySelector("#donation-category")?.value,
        message:  document.querySelector("#donor-message")?.value,
      };

      setFormLoading(form, true);
      try {
        const result = await apiPost("/donate/initiate", data);

        if (result.success) {
          if (result.demo) {
            // Demo mode - redirect to home
            setTimeout(() => {
              window.location.href = "index.html";
            }, 500);
          } else {
            // Redirect to Paystack checkout immediately (no message)
            window.location.href = result.authorization_url;
          }
        } else {
          showToast(result.message || "Payment setup failed. Please try again.", "error");
        }
      } catch (err) {
        showToast("Network error. Please check your connection.", "error");
      } finally {
        setFormLoading(form, false);
      }
    });
  }

  /* ─── Team photos — load from API ────────────────────────────── */
  async function loadTeamPhotos() {
    const teamGrid = document.querySelector(".team-grid");
    if (!teamGrid) return;

    try {
      const result = await apiGet("/team");
      if (!result.success) return;

      result.data.forEach((member) => {
        if (!member.photo_url) return;
        const card = teamGrid.querySelector(`[data-team-index="${member.id}"]`);
        if (!card) return;
        const photoDiv = card.querySelector("[data-team-photo]");
        if (photoDiv && member.photo_url) {
          photoDiv.style.cssText = `background-image:url('${API_BASE.replace("/api","")}${member.photo_url}');background-size:cover;background-position:center`;
        }
      });
    } catch {
      // Silently fail — placeholder avatars remain
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
          const res = await fetch(`${API_BASE}/team/photo`, { method: "POST", body: formData });
          const result = await res.json();

          if (result.success) {
            const photoDiv = card.querySelector("[data-team-photo]");
            if (photoDiv) {
              const fullUrl = `${API_BASE.replace("/api","")}${result.photo_url}`;
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

  /* ─── Payment return page handler ────────────────────────────── */
  function checkPaymentReturn() {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") || params.get("trxref");
    const isDemo = params.get("demo");

    if (!reference) return;

    // Show "verifying" state
    const hero = document.querySelector(".page-hero-lead");
    if (hero) hero.textContent = "Verifying your payment…";

    if (isDemo) {
      showToast("Demo donation recorded. Thank you!");
      return;
    }

    apiGet(`/donate/verify?reference=${reference}`)
      .then((result) => {
        if (result.success) {
          showToast(`Payment confirmed! Thank you for your generous donation. ❤️`);
          if (hero) hero.textContent = "Your donation was successful! Thank you for supporting our mission.";
        } else {
          showToast("Payment verification failed. Please contact us.", "error");
          if (hero) hero.textContent = "We couldn't verify your payment. Please email us at info@whiteimpactinitiative.org";
        }
      })
      .catch(() => {
        showToast("Verification error. Please contact us.", "error");
      });
  }

  /* ─── Init ────────────────────────────────────────────────────── */
  document.addEventListener("DOMContentLoaded", () => {
    initContactForm();
    initNewsletterForm();
    initDonationForm();
    initTeamPhotoUpload();
    loadTeamPhotos();
    checkPaymentReturn();
  });

  // Expose for debugging
  window._wiiAPI = { apiPost, apiGet, API_BASE };
})();
