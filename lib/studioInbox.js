(function (global) {
  "use strict";

  var URL = "https://tkscvymiihwkheyoieax.supabase.co/rest/v1/rpc/submit_studio_inbox";
  var STORAGE = "https://tkscvymiihwkheyoieax.supabase.co/storage/v1/object/inbox-uploads/";
  var KEY = "sb_publishable_kLY93_ybzruZCJmfTcfWMA_eWyk_RF7";

  function readError(res, text, fallback) {
    var result = null;
    if (text) {
      try { result = JSON.parse(text); } catch (err) { result = text; }
    }
    if (res.ok) return { ok: true, result: result };
    var message = fallback;
    if (result && typeof result === "object") {
      message = result.message || result.error || message;
    } else if (typeof result === "string" && result) {
      message = result;
    }
    var error = new Error(message);
    error.result = result;
    throw error;
  }

  global.submitStudioInbox = function (payload) {
    return fetch(URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: KEY,
        Authorization: "Bearer " + KEY
      },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.text().then(function (text) {
        return readError(res, text, "Failed to send.").result;
      });
    });
  };

  global.uploadStudioInboxFile = function (path, file, contentType) {
    var encoded = String(path || "").split("/").map(encodeURIComponent).join("/");
    return fetch(STORAGE + encoded, {
      method: "POST",
      headers: {
        apikey: KEY,
        Authorization: "Bearer " + KEY,
        "Content-Type": contentType || file.type || "application/octet-stream",
        "x-upsert": "false"
      },
      body: file
    }).then(function (res) {
      return res.text().then(function (text) {
        return readError(res, text, "Failed to upload.");
      });
    });
  };
})(window);
