// Shared header behavior for every marketing page: the menu button and the compact header on scroll.
(function () {
  "use strict";
  var menuToggle = document.getElementById("menuToggle");
  var dropdownMenu = document.getElementById("dropdownMenu");
  if (menuToggle && dropdownMenu) {
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-controls", "dropdownMenu");
    var setOpen = function (open) {
      dropdownMenu.classList.toggle("active", open);
      menuToggle.classList.toggle("active", open);
      menuToggle.setAttribute("aria-expanded", open ? "true" : "false");
    };
    menuToggle.addEventListener("click", function () {
      setOpen(!dropdownMenu.classList.contains("active"));
    });
    document.addEventListener("click", function (event) {
      if (dropdownMenu.classList.contains("active") &&
          !dropdownMenu.contains(event.target) && !menuToggle.contains(event.target)) {
        setOpen(false);
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && dropdownMenu.classList.contains("active")) {
        setOpen(false);
        menuToggle.focus();
      }
    });
  }

  var header = document.querySelector("header");
  if (!header) return;
  var compact = false;
  window.addEventListener("scroll", function () {
    var y = window.scrollY;
    if (!compact && y > 100) {
      compact = true;
      header.classList.add("header--compact");
    } else if (compact && y < 40) {
      compact = false;
      header.classList.remove("header--compact");
    }
  }, { passive: true });
})();
