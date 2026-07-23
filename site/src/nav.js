// Mobile navigation (burger menu) shared by all site pages. The desktop nav
// links are hidden below the sm breakpoint; this wires the burger toggle that
// reveals them in a dropdown panel instead.

/**
 * Wires the mobile burger button (#nav-toggle) to the dropdown panel
 * (#mobile-nav): click toggles, Escape and outside clicks close, and
 * following a link closes the panel again. Call once after DOM ready.
 */
export function initMobileNav() {
  const toggle = document.getElementById("nav-toggle");
  const menu = document.getElementById("mobile-nav");
  if (!toggle || !menu) return;

  const close = () => {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  };

  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") === "true";
    menu.hidden = open;
    toggle.setAttribute("aria-expanded", String(!open));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) {
      close();
      toggle.focus();
    }
  });

  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !toggle.contains(e.target)) close();
  });

  // In-page anchor links do not reload the page, so close the panel manually.
  menu.addEventListener("click", (e) => {
    if (e.target.closest("a")) close();
  });
}
