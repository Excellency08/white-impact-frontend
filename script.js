(function () {
    "use strict";

    const isLocal =
        ["localhost", "127.0.0.1"].includes(window.location.hostname) ||
        ["5500", "5501"].includes(window.location.port);
    const API_BASE = isLocal
        ? `http://${window.location.hostname}:3030/api`
        : window.__WII_API_BASE__ || "/api";

    window.__WII_API_BASE__ = API_BASE;

    const header = document.querySelector("[data-header]");
    const mobileToggle = document.querySelector("[data-mobile-toggle]");
    const mobileNav = document.querySelector("[data-mobile-nav]");
    const backToTop = document.querySelector("[data-back-to-top]");
    const yearEl = document.querySelector("[data-year]");
    const toast = document.querySelector("[data-toast]");
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const supportsIntersectionObserver = "IntersectionObserver" in window;
    let scrollFrame = 0;

    if (yearEl) yearEl.textContent = new Date().getFullYear();

    /* Theme toggling removed — site uses original styles only */

    /* Sticky header shadow */
    function onScroll() {
        if (header) {
            header.classList.toggle("scrolled", window.scrollY > 20);
        }
        if (backToTop) {
            backToTop.hidden = window.scrollY < 400;
        }
    }

    function scheduleScrollState() {
        if (scrollFrame) return;
        scrollFrame = window.requestAnimationFrame(() => {
            scrollFrame = 0;
            onScroll();
        });
    }

    window.addEventListener("scroll", scheduleScrollState, { passive: true });
    onScroll();

    /* Back to top */
    backToTop?.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
    });

    /* Mobile menu */
    function setMobileMenu(open) {
        if (!mobileToggle || !mobileNav) return;

        mobileToggle.classList.toggle("active", open);
        mobileToggle.setAttribute("aria-expanded", String(open));
        mobileToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
        mobileNav.hidden = !open;
        document.body.classList.toggle("menu-open", open);
    }

    mobileToggle?.addEventListener("click", () => {
        setMobileMenu(!mobileToggle.classList.contains("active"));
    });

    mobileNav?.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", () => {
            setMobileMenu(false);
        });
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && mobileToggle?.classList.contains("active")) {
            setMobileMenu(false);
            mobileToggle.focus();
        }
    });

    window.addEventListener("resize", () => {
        if (window.innerWidth > 768) setMobileMenu(false);
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
    if (!supportsIntersectionObserver || prefersReducedMotion) {
        animateEls.forEach((el) => el.classList.add("visible"));
    } else {
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
    }

    /* Animated counters */
    const statNumbers = document.querySelectorAll("[data-count]");
    if (!supportsIntersectionObserver || prefersReducedMotion) {
        statNumbers.forEach((el) => {
            const target = parseInt(el.dataset.count, 10) || 0;
            const suffix = el.dataset.suffix || "";
            el.textContent = target.toLocaleString() + suffix;
        });
    } else {
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
    }

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
            if (prefersReducedMotion) return;
            autoplayTimer = setInterval(() => goTo(current + 1), 6000);
        }

        function stopAutoplay() {
            clearInterval(autoplayTimer);
        }

        if (!prefersReducedMotion) {
            slider.addEventListener("mouseenter", stopAutoplay);
            slider.addEventListener("mouseleave", startAutoplay);
            document.addEventListener("visibilitychange", () => {
                if (document.hidden) {
                    stopAutoplay();
                } else {
                    startAutoplay();
                }
            });
            startAutoplay();
        }
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
                target.scrollIntoView({
                    behavior: prefersReducedMotion ? "auto" : "smooth",
                    block: "start",
                });
            }
        });
    });
})();
