(function (global) {
  "use strict";

  var URL = "https://tkscvymiihwkheyoieax.supabase.co/rest/v1/rpc/submit_studio_inbox";
  var KEY = "sb_publishable_kLY93_ybzruZCJmfTcfWMA_eWyk_RF7";

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
        var result = null;
        if (text) {
          try { result = JSON.parse(text); } catch (err) { result = text; }
        }
        if (!res.ok) {
          var message = "Failed to send.";
          if (result && typeof result === "object") {
            message = result.message || result.error || message;
          }
          var error = new Error(message);
          error.result = result;
          throw error;
        }
        return result;
      });
    });
  };
})(window);
