(function (global) {
  "use strict";

  var URL = "https://tkscvymiihwkheyoieax.supabase.co/rest/v1/rpc/record_studio_website_click";
  var KEY = "sb_publishable_kLY93_ybzruZCJmfTcfWMA_eWyk_RF7";
  var VISIT_KEY = "stl_site_visit_id";

  function pathOf() {
    try {
      return (location.pathname || "/") + (location.search || "");
    } catch (err) {
      return "/";
    }
  }

  if (/^\/studio(\/|$)/i.test(pathOf())) return;

  function visitId() {
    try {
      var id = localStorage.getItem(VISIT_KEY);
      if (id) return id;
      id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
      localStorage.setItem(VISIT_KEY, id);
      return id;
    } catch (err) {
      return "";
    }
  }

  function send(kind, label, href) {
    var host = "";
    try { host = location.hostname || ""; } catch (err) { host = ""; }
    var body = JSON.stringify({
      p_host: host,
      p_path: pathOf(),
      p_kind: kind || "pageview",
      p_label: label || "",
      p_href: href || "",
      p_referrer: document.referrer || "",
      p_visit_id: visitId(),
      p_user_agent: navigator.userAgent || ""
    });
    fetch(URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: KEY,
        Authorization: "Bearer " + KEY
      },
      body: body,
      keepalive: true
    }).catch(function () {});
  }

  function labelFor(node) {
    if (!node) return "";
    var t = (node.getAttribute && (node.getAttribute("aria-label") || node.getAttribute("title"))) || "";
    if (!t) t = (node.textContent || "").replace(/\s+/g, " ").trim();
    return t.slice(0, 120);
  }

  send("pageview", document.title || "", location.href || "");

  document.addEventListener("click", function (event) {
    var node = event.target;
    while (node && node !== document && node.nodeType === 1) {
      var tag = (node.tagName || "").toLowerCase();
      if (tag === "a" || tag === "button" || (node.getAttribute && node.getAttribute("role") === "button")) {
        send("click", labelFor(node), node.href || "");
        return;
      }
      node = node.parentNode;
    }
  }, true);
})(window);
