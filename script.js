(function () {
    "use strict";

    const header = document.querySelector("[data-header]");
    const mobileToggle = document.querySelector("[data-mobile-toggle]");
    const mobileNav = document.querySelector("[data-mobile-nav]");
    const backToTop = document.querySelector("[data-back-to-top]");
    const yearEl = document.querySelector("[data-year]");
    const toast = document.querySelector("[data-toast]");

    if (yearEl) yearEl.textContent = new Date().getFullYear();

    /* Sticky header shadow */
    function onScroll() {
        if (header) {
            header.classList.toggle("scrolled", window.scrollY > 20);
        }
        if (backToTop) {
            backToTop.hidden = window.scrollY < 400;
        }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    /* Back to top */
    backToTop?.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    });

    /* Mobile menu */
    mobileToggle?.addEventListener("click", () => {
        const open = mobileToggle.classList.toggle("active");
        mobileToggle.setAttribute("aria-expanded", String(open));
        if (mobileNav) mobileNav.hidden = !open;
    });

    mobileNav?.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", () => {
            mobileToggle?.classList.remove("active");
            mobileToggle?.setAttribute("aria-expanded", "false");
            if (mobileNav) mobileNav.hidden = true;
        });
    });

    /* Dropdown menus */
    document.querySelectorAll("[data-dropdown]").forEach((dropdown) => {
        const trigger = dropdown.querySelector("[data-dropdown-trigger]");
        trigger?.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = dropdown.classList.contains("open");
            document.querySelectorAll("[data-dropdown].open").forEach((d) => {
                d.classList.remove("open");
                d.querySelector("[data-dropdown-trigger]")?.setAttribute("aria-expanded", "false");
            });
            if (!isOpen) {
                dropdown.classList.add("open");
                trigger.setAttribute("aria-expanded", "true");
            }
        });
    });

    document.addEventListener("click", () => {
        document.querySelectorAll("[data-dropdown].open").forEach((d) => {
            d.classList.remove("open");
            d.querySelector("[data-dropdown-trigger]")?.setAttribute("aria-expanded", "false");
        });
    });

    /* Scroll animations */
    const animateEls = document.querySelectorAll("[data-animate]");
    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add("visible");
                    observer.unobserve(entry.target);
                }
            });
        },
        { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    animateEls.forEach((el) => observer.observe(el));

    /* Animated counters */
    const statNumbers = document.querySelectorAll("[data-count]");
    const counterObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    animateCounter(entry.target);
                    counterObserver.unobserve(entry.target);
                }
            });
        },
        { threshold: 0.5 }
    );

    statNumbers.forEach((el) => counterObserver.observe(el));

    function animateCounter(el) {
        const target = parseInt(el.dataset.count, 10);
        const suffix = el.dataset.suffix || "";
        const duration = 2000;
        const start = performance.now();

        function update(now) {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const value = Math.floor(eased * target);
            el.textContent = value.toLocaleString() + suffix;
            if (progress < 1) requestAnimationFrame(update);
        }

        requestAnimationFrame(update);
    }

    /* Testimonial slider */
    const slider = document.querySelector("[data-slider]");
    if (slider) {
        const slides = slider.querySelectorAll(".testimonial-slide");
        const dotsContainer = slider.querySelector("[data-slider-dots]");
        const prevBtn = slider.querySelector("[data-slider-prev]");
        const nextBtn = slider.querySelector("[data-slider-next]");
        let current = 0;
        let autoplayTimer;

        slides.forEach((_, i) => {
            const dot = document.createElement("button");
            dot.className = "slider-dot" + (i === 0 ? " active" : "");
            dot.setAttribute("aria-label", `Go to testimonial ${i + 1}`);
            dot.addEventListener("click", () => goTo(i));
            dotsContainer?.appendChild(dot);
        });

        const dots = dotsContainer?.querySelectorAll(".slider-dot");

        function goTo(index) {
            slides[current].classList.remove("active");
            dots?.[current]?.classList.remove("active");
            current = (index + slides.length) % slides.length;
            slides[current].classList.add("active");
            dots?.[current]?.classList.add("active");
        }

        prevBtn?.addEventListener("click", () => goTo(current - 1));
        nextBtn?.addEventListener("click", () => goTo(current + 1));

        function startAutoplay() {
            autoplayTimer = setInterval(() => goTo(current + 1), 6000);
        }

        function stopAutoplay() {
            clearInterval(autoplayTimer);
        }

        slider.addEventListener("mouseenter", stopAutoplay);
        slider.addEventListener("mouseleave", startAutoplay);
        startAutoplay();
    }

    /* Donate amount selection */
    const donateAmounts = document.querySelectorAll(".donate-amount");
    const donateCustom = document.querySelector(".donate-custom");
    const donateBtn = document.querySelector("[data-donate-btn]");
    let selectedAmount = 10000;

    donateAmounts.forEach((btn) => {
        btn.addEventListener("click", () => {
            donateAmounts.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            selectedAmount = parseInt(btn.dataset.amount, 10);
            if (donateCustom) donateCustom.value = "";
        });
    });

    donateCustom?.addEventListener("input", () => {
        donateAmounts.forEach((b) => b.classList.remove("active"));
        selectedAmount = parseInt(donateCustom.value, 10) || 0;
    });

    donateBtn?.addEventListener("click", () => {
        if (selectedAmount >= 1000) {
            showToast(`Thank you! Your donation of ₦${selectedAmount.toLocaleString()} helps us empower communities.`);
        } else {
            showToast("Please select or enter a donation amount of at least ₦1,000.");
        }
    });

    /* Forms handled by api.js for backend integration */

    /* Team photo upload handler */
    document.querySelectorAll(".team-photo-upload").forEach((fileInput) => {
        const photoIndex = fileInput.dataset.photoIndex;
        const teamCard = fileInput.closest(".team-card");
        
        fileInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const imageUrl = event.target.result;
                    const photoDiv = teamCard.querySelector(`[data-team-photo]`);
                    if (photoDiv) {
                        photoDiv.style.backgroundImage = `url('${imageUrl}')`;
                        photoDiv.style.backgroundSize = "cover";
                        photoDiv.style.backgroundPosition = "center";
                        localStorage.setItem(`team-photo-${photoIndex}`, imageUrl);
                    }
                };
                reader.readAsDataURL(file);
            }
        });
    });

    // Load saved team photos from localStorage
    document.querySelectorAll("[data-team-photo]").forEach((photoDiv) => {
        const teamCard = photoDiv.closest(".team-card");
        const photoIndex = teamCard.dataset.teamIndex;
        const savedImage = localStorage.getItem(`team-photo-${photoIndex}`);
        if (savedImage) {
            photoDiv.style.backgroundImage = `url('${savedImage}')`;
            photoDiv.style.backgroundSize = "cover";
            photoDiv.style.backgroundPosition = "center";
        }
    });

    /* Report year and PDF upload handler */
    const reportYearSelect = document.querySelector("#report-year");
    const reportPdfInput = document.querySelector("#report-pdf");
    const previewYear = document.querySelector("#preview-year");
    const reportMock = document.querySelector("#report-preview");

    reportYearSelect?.addEventListener("change", (e) => {
        const selectedYear = e.target.value;
        if (selectedYear && previewYear) {
            previewYear.textContent = selectedYear;
        }
    });

    reportPdfInput?.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file && file.type === "application/pdf") {
            const reader = new FileReader();
            reader.onload = (event) => {
                const year = reportYearSelect?.value || "2025";
                const pdfUrl = event.target.result;
                if (reportMock) {
                    reportMock.innerHTML = `
                        <span>${year}</span>
                        <strong>Impact Report</strong>
                        <div style="margin-top: 1rem; font-size: 0.875rem; color: #ddd;">
                            <p>✓ PDF Ready</p>
                            <p style="font-size: 0.75rem; margin-top: 0.5rem;">${file.name}</p>
                        </div>
                    `;
                }
                localStorage.setItem(`report-pdf-${year}`, pdfUrl);
                showToast(`${year} report uploaded successfully!`);
            };
            reader.readAsDataURL(file);
        } else {
            showToast("Please upload a valid PDF file.");
        }
    });

    /* Toast notification */
    let toastTimer;

    function showToast(message) {
        if (!toast) return;
        toast.textContent = message;
        toast.hidden = false;
        toast.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toast.classList.remove("show");
            setTimeout(() => { toast.hidden = true; }, 400);
        }, 4000);
    }

    /* Smooth anchor offset for fixed header */
    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
        anchor.addEventListener("click", (e) => {
            const id = anchor.getAttribute("href");
            if (id === "#" || id.length <= 1) return;
            const target = document.querySelector(id);
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: "smooth" });
            }
        });
    });
})();
