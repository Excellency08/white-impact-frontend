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

  // Point all frontend requests to the deployed Render API by default.
  // You can override it locally with window.__WII_API_BASE__ if needed.
  const API_BASE = window.__WII_API_BASE__ || "https://white-impact-api.onrender.com/api";

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
    toast.className = `toast ${type}`;     toast.hidden = false;
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
  function showDonationInstructions(result) {
    const formStep = document.querySelector('[data-donation-step="form"]');
    const instructionsStep = document.querySelector('[data-donation-step="instructions"]');
    if (!formStep || !instructionsStep) return;

    const { reference, donation, bank } = result;
    const amount = Number(donation?.amountNaira || 0);

    document.querySelector("[data-bank-name]").textContent = bank?.bankName || "—";
    document.querySelector("[data-bank-account-name]").textContent = bank?.accountName || "—";
    document.querySelector("[data-bank-account-number]").textContent = bank?.accountNumber || "—";
    document.querySelector("[data-donation-display-amount]").textContent = `₦${amount.toLocaleString()}`;
    document.querySelector("[data-donation-reference]").textContent = reference || "—";

    instructionsStep.dataset.reference = reference || "";
    instructionsStep.dataset.programArea = donation?.programArea || "";

    formStep.hidden = true;
    instructionsStep.hidden = false;
    instructionsStep.scrollIntoView({ behavior: "smooth", block: "start" });

    const hero = document.querySelector(".page-hero-lead");
    if (hero) {
      hero.textContent = "Transfer to our account below, then submit your payment receipt for confirmation.";
    }
  }

  function initReceiptForm() {
    const form = document.querySelector("[data-receipt-form]");
    const instructionsStep = document.querySelector('[data-donation-step="instructions"]');
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
        showToast("Donation reference missing. Please submit the donation form again.", "error");
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
        const res = await fetch(`${API_BASE}/donate/receipt`, { method: "POST", body: formData });
        const result = await res.json();

        if (result.success) {
          document.querySelector(".bank-transfer-details")?.setAttribute("hidden", "");
          document.querySelector(".receipt-upload-section")?.setAttribute("hidden", "");
          const successPanel = document.querySelector("[data-receipt-success]");
          successPanel?.removeAttribute("hidden");
          showToast(result.message || "Receipt submitted successfully!");
        } else {
          showToast(result.message || "Receipt upload failed. Please try again.", "error");
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
      if (!form.checkValidity()) { form.reportValidity(); return; }

      const data = {
        fullName: document.querySelector("#donor-full-name")?.value,
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
          showDonationInstructions(result);
        } else {
          const errorMessage = result.errors && result.errors.length
            ? result.errors[0]
            : result.message || "Could not process your donation. Please try again.";
          showToast(errorMessage, "error");
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

  /* ─── Init ────────────────────────────────────────────────────── */
  document.addEventListener("DOMContentLoaded", () => {
    initContactForm();
    initNewsletterForm();
    initDonationForm();
    initReceiptForm();
    initTeamPhotoUpload();
    loadTeamPhotos();
  });

  // Expose for debugging
  window._wiiAPI = { apiPost, apiGet, API_BASE };
})();
