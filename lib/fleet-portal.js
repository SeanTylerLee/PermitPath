(function () {
  var form = document.getElementById("fleetLoginForm");
  var message = document.getElementById("fleetLoginMessage");
  var submit = document.getElementById("fleetLoginSubmit");
  var accountRoot = document.getElementById("fleet-account");

  var SUPABASE = "https://bkgdrfyjppjxwnwntcbc.supabase.co";
  var ANON = "sb_publishable_fMbQ-x2q2q5XA_pT4Bpf6w_ZMcbCQen";
  var CHECKOUT = "https://tkscvymiihwkheyoieax.supabase.co/functions/v1/fleet-checkout";
  var LOGIN = "https://tkscvymiihwkheyoieax.supabase.co/functions/v1/fleet-login";

  if (!accountRoot) {
    fetch(LOGIN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ping" }) }).catch(function () {});
  }

  function auth(body) {
    var control = new AbortController();
    var timer = setTimeout(function () { control.abort(); }, 12000);
    return fetch(LOGIN, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: control.signal
    }).then(function (res) {
      clearTimeout(timer);
      return res.text().then(function (raw) {
        var data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch (e) { data = {}; }
        if (data && data.ok === false) return data;
        if (!res.ok) throw new Error((data && (data.error || data.message)) || "Could not reach Permit Path.");
        return data;
      });
    }).catch(function (err) {
      clearTimeout(timer);
      if (err && err.name === "AbortError") throw new Error("Sign-in timed out. Try again.");
      throw err;
    });
  }

  function rpc(name, body, attempt) {
    attempt = attempt || 1;
    var control = new AbortController();
    var timer = setTimeout(function () { control.abort(); }, 50000);
    return fetch(SUPABASE + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON,
        Authorization: "Bearer " + ANON
      },
      body: JSON.stringify(body),
      signal: control.signal
    }).then(function (res) {
      clearTimeout(timer);
      return res.json().then(function (data) {
        if (!res.ok) throw new Error((data && (data.message || data.error)) || "Could not reach Permit Path.");
        return data;
      });
    }).catch(function (err) {
      clearTimeout(timer);
      var failed = err && (err.name === "AbortError" || err.message === "Failed to fetch");
      if (failed && attempt < 2) return rpc(name, body, attempt + 1);
      if (err && err.name === "AbortError") throw new Error("That took too long. Try again.");
      throw err;
    });
  }

  function watchPayment(sessionId) {
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (tries > 40) {
        clearInterval(timer);
        return;
      }
      fetch(CHECKOUT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId })
      }).then(function (res) { return res.json(); }).then(function (data) {
        if (data && data.ok) {
          clearInterval(timer);
          window.location.href = "fleet-account.html";
        }
      }).catch(function () {});
    }, 3000);
  }

  function loadStripe() {
    if (window.Stripe) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "https://js.stripe.com/v3/";
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error("Could not load the card form.")); };
      document.head.appendChild(script);
    });
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function money(n) {
    return Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
  }

  function rateFor(count) {
    return count >= 21 ? 3.39 : 3.99;
  }

  function codeIsActive(row) {
    return row && row.active !== false;
  }

  function codeExpiresOn(row) {
    var raw = row && (row.paid_through || row.trial_until || "");
    return String(raw || "").slice(0, 10);
  }

  function codeIsExpired(row) {
    var day = codeExpiresOn(row);
    if (!day) return false;
    var today = new Date();
    var stamp = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
    return day < stamp;
  }

  function formatExpiryDate(day) {
    if (!day) return "";
    var parts = String(day).slice(0, 10).split("-");
    if (parts.length !== 3) return String(day);
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var month = months[Number(parts[1]) - 1] || parts[1];
    return month + " " + Number(parts[2]) + ", " + parts[0];
  }

  function codeStatusLabel(row) {
    if (!codeIsActive(row)) return "Off";
    if (codeIsExpired(row)) return "Expired";
    return row.used ? "Active · In use" : "Active · Open";
  }

  function codeExpiryLabel(row) {
    var day = codeExpiresOn(row);
    if (!day) return "";
    if (codeIsExpired(row)) return "Expired " + formatExpiryDate(day);
    return "Expires " + formatExpiryDate(day);
  }

  function codeStatusClass(row) {
    if (!codeIsActive(row)) return "fleet-code-status fleet-code-status--off";
    if (codeIsExpired(row)) return "fleet-code-status fleet-code-status--expired";
    return row.used ? "fleet-code-status fleet-code-status--used" : "fleet-code-status fleet-code-status--open";
  }

  function helpPanelHtml() {
    return '' +
      '<div class="fleet-help-panel" id="fleetHelpPanel" hidden>' +
        '<div class="fleet-help-panel__head">' +
          "<h2>Fleet help</h2>" +
          '<button type="button" class="fleet-help-close" id="fleetHelpClose" aria-label="Close help">Close</button>' +
        "</div>" +
        '<div class="fleet-help-panel__body">' +
          "<h3>What this account is for</h3>" +
          "<p>This page is your company portal. You buy codes here, see which ones are active or turned off, open or in use, and pay by card. Drivers do not sign in here. They only enter a code inside the Permit Path app.</p>" +
          "<h3>How codes work</h3>" +
          "<p>Each code unlocks unlimited waypoints on <strong>one</strong> phone or tablet. When a driver enters an open code, that code locks to that device and shows as Active · In use. The same code will not unlock a second device.</p>" +
          "<h3>How you get codes</h3>" +
          "<ol>" +
            "<li>Choose how many codes you need and a billing period (1, 6, or 12 months).</li>" +
            "<li>Tap Pay by card and complete payment on this page. The charge appears as STL Apps LLC.</li>" +
            "<li>Purchased codes show on this page as soon as payment finishes. Use Save or Email to send them to yourself or your office.</li>" +
            "<li>Optional: request a free trial for up to 5 drivers. Trial codes are added to this page each evening after the request.</li>" +
          "</ol>" +
          "<h3>How to distribute codes to drivers</h3>" +
          "<ol>" +
            "<li>Give each driver one Active · Open code. Do not reuse a code that already says In use, and do not hand out a code that says Off.</li>" +
            "<li>Have the driver install Permit Path from the App Store or Google Play.</li>" +
            "<li>In the app, open Settings → Subscription → Company access (or Company access on the paywall).</li>" +
            "<li>The driver enters the code. That device unlocks. The office keeps billing. The driver does not need Apple or Google purchase permission on the device.</li>" +
          "</ol>" +
          "<h3>Payment</h3>" +
          "<p>Fleet billing is prepaid by card through Stripe. You pick the seats and months when you pay. There is no automatic forever-renewing charge from this page. Rates are $3.99 per code per month for 1–20 codes, and $3.39 per code per month when you buy 21 or more (15% off on the whole purchase).</p>" +
          "<p>Each code has its own expiry date. A paid code stays on until that date, then it stops unlocking the app on its own. Check the codes you want to keep and use Renew selected codes. That payment extends those codes. It does not create new ones. Purchase more codes is only for additional devices.</p>" +
          "<h3>Names</h3>" +
          "<p>Each code has a name field. That name is for your records, such as a truck number or a driver. Permit Path does not use it.</p>" +
          "<h3>New or replacement devices</h3>" +
          "<p>A code stays on the device that first used it. On that code, use Request replacement. That asks Permit Path for a new code. The old code is then turned off, and the new code appears here covered through the same date. It is marked as the replacement for the code you requested. You can also call Sean at <a href=\"tel:5807298184\">580-729-8184</a>.</p>" +
          "<h3>Active, Off, Open, In use, and expiry</h3>" +
          "<p><strong>Active · Open</strong> means the code is on and has not been entered on a device yet. Hand those out.</p>" +
          "<p><strong>Active · In use</strong> means a device already claimed it.</p>" +
          "<p><strong>Off</strong> means Permit Path turned that code off (for example after a device left the company). It stays on your list so you can see it, but it will not unlock the app. Ask Sean to turn it back on or issue a new code.</p>" +
          "<p>Each code has its own expiry date from when that code was purchased, renewed, or when a trial was started. Codes bought on different days can expire on different days. When a code’s date has passed, it shows as Expired and no longer unlocks the app until you renew that code.</p>" +
          "<h3>Still stuck?</h3>" +
          '<p>Call Sean at <a href="tel:5807298184">580-729-8184</a> or email <a href="mailto:support@permitpathnav.com">support@permitpathnav.com</a>.</p>' +
        "</div>" +
      "</div>";
  }

  function showAccount(account) {
    var shell = document.getElementById("fleet-account");
    if (!shell) return;
    var codes = (account.codes || []).filter(function (row) { return row.visible !== false && row.code; });
    var hasTrial = (account.codes || []).some(function (row) {
      return row.billing === "trial" && codeIsActive(row) && !codeIsExpired(row);
    });
    var requested = Number(account.trial_request_seats) || 0;
    var trialBox = hasTrial ? "" : (requested
      ? '<p class="fleet-sent">Sent. Check back here for the codes. Free trial codes are added to this page every evening.</p>'
      : '<p><button type="button" class="fleet-text-btn" id="fleetTrialOpen">Request a free trial</button></p><form id="fleetTrialForm" class="fleet-order" hidden><p class="fleet-meta">Free trial codes are added to this page every evening. You can request up to 5 drivers.</p><label>Drivers, up to 5<input id="fleetTrialSeats" type="number" min="1" max="5" value="5"></label><button type="submit" class="button" id="fleetTrialSubmit">Send request</button><p class="fleet-pay-note" id="fleetTrialMessage"></p></form>');
    function recordName(row) {
      var name = String((row && row.label) || "").trim();
      if (/^cs_/i.test(name)) return "";
      return name;
    }
    var codeText = codes.map(function (row) {
      var bits = [row.code, codeStatusLabel(row)];
      var expiry = codeExpiryLabel(row);
      if (expiry) bits.push(expiry);
      if (recordName(row)) bits.push(recordName(row));
      if (row.replaces_code) bits.push("replaces " + row.replaces_code);
      return bits.join(" — ");
    }).join("\n");
    var openCount = 0;
    var usedCount = 0;
    var offCount = 0;
    var expiredCount = 0;
    codes.forEach(function (row) {
      if (!codeIsActive(row)) offCount += 1;
      else if (codeIsExpired(row)) expiredCount += 1;
      else if (row.used) usedCount += 1;
      else openCount += 1;
    });
    var summaryBits = [];
    if (openCount) summaryBits.push('<span class="fleet-summary__chip fleet-summary__chip--open">' + openCount + " open</span>");
    if (usedCount) summaryBits.push('<span class="fleet-summary__chip fleet-summary__chip--used">' + usedCount + " in use</span>");
    if (offCount) summaryBits.push('<span class="fleet-summary__chip fleet-summary__chip--off">' + offCount + " off</span>");
    if (expiredCount) summaryBits.push('<span class="fleet-summary__chip fleet-summary__chip--expired">' + expiredCount + " expired</span>");
    function canRenew(row) {
      return codeIsActive(row) && row.billing !== "trial";
    }
    var renewCount = codes.filter(canRenew).length;
    var list = codes.map(function (row) {
      var expiry = codeExpiryLabel(row);
      var offClass = (!codeIsActive(row) || codeIsExpired(row)) ? " fleet-code-row--muted" : "";
      var name = recordName(row);
      var box = canRenew(row)
        ? '<label class="fleet-renew-pick"><input type="checkbox" class="fleet-renew-box" value="' + esc(row.code) + '" data-expires="' + esc(codeExpiresOn(row)) + '"><span class="fleet-renew-pick__box" aria-hidden="true"></span></label>'
        : '<span class="fleet-renew-pick fleet-renew-pick--empty"></span>';
      var replaceNote = row.replaces_code
        ? '<span class="fleet-code-note">New code. Replaces ' + esc(row.replaces_code) + ".</span>"
        : "";
      var requestedNote = row.replacement_requested && !row.replaces_code
        ? '<span class="fleet-code-note">Replacement requested.</span>'
        : "";
      var replaced = codes.some(function (other) {
        return String(other.replaces_code || "").toUpperCase() === String(row.code || "").toUpperCase();
      });
      var replaceBtn = codeIsActive(row) && !replaced
        ? '<button type="button" data-request-replace="' + esc(row.code) + '" data-seat-id="' + esc(row.id || "") + '">' +
          (row.replacement_requested ? "Send request again" : "Request replacement") + "</button>"
        : "";
      return '<li class="fleet-code-row' + offClass + '">' +
        '<div class="fleet-code-top">' + box +
          '<div class="fleet-code-main"><strong class="fleet-code-value">' + esc(row.code) + "</strong>" +
          (expiry ? '<span class="fleet-code-expiry">' + esc(expiry) + "</span>" : "") +
          replaceNote + requestedNote +
          '</div><span class="' + codeStatusClass(row) + '">' + esc(codeStatusLabel(row)) + "</span>" +
        "</div>" +
        '<div class="fleet-code-tools">' +
          '<label class="fleet-code-name">Name for your records<input type="text" maxlength="80" value="' + esc(name) + '" data-code-name="' + esc(row.code) + '" placeholder="Truck or driver"></label>' +
          '<button type="button" data-save-name="' + esc(row.code) + '">Save name</button>' +
          '<button type="button" data-copy-one="' + esc(row.code) + '">Copy</button>' +
          replaceBtn +
        "</div></li>";
    }).join("");
    var order = '<form id="fleetPayForm" class="fleet-order">' +
      '<div class="fleet-order__grid">' +
        '<label>Number of new codes<input id="fleetSeats" type="number" min="1" max="500" value="5"></label>' +
        '<label>Billing period<select id="fleetMonths"><option value="1">1 month</option><option value="6">6 months</option><option value="12">1 year</option></select></label>' +
      "</div>" +
      '<div class="fleet-total"><span>Amount due</span><strong id="fleetDue"></strong></div>' +
      '<button type="submit" class="button" id="fleetPaySubmit">Pay by card</button>' +
      '<p class="fleet-statement">The charge appears as STL Apps LLC. This creates new codes. It does not extend codes you already have. Each new code expires on its own date.</p>' +
      '<p class="fleet-pay-note" id="fleetPayMessage"></p></form>';
    var renew = renewCount
      ? '<section class="fleet-buy" aria-labelledby="fleet-renew-title">' +
          '<button type="button" class="fleet-buy-toggle" id="fleetRenewToggle" aria-expanded="' + (expiredCount ? "true" : "false") + '" aria-controls="fleetRenewPanel">' +
            '<span id="fleet-renew-title">Renew selected codes</span>' +
            '<span class="fleet-buy-toggle__hint">Extend the codes you check. Paid codes stay on until their date.</span>' +
          "</button>" +
          '<div class="fleet-buy-panel" id="fleetRenewPanel"' + (expiredCount ? "" : " hidden") + ">" +
            "<h3>Renew codes</h3>" +
            '<p class="fleet-buy-lead">Check the codes above, then choose how many months to add. A code that still has time left keeps that time and adds the new months on the end. An expired code starts again from today. This does not turn a paid code off.</p>' +
            '<div class="fleet-renew-actions">' +
              '<button type="button" class="fleet-text-btn" id="fleetSelectDue">Select expiring</button>' +
              '<button type="button" class="fleet-text-btn" id="fleetSelectAll">Select all</button>' +
              '<button type="button" class="fleet-text-btn" id="fleetSelectNone">Clear</button>' +
            "</div>" +
            '<form id="fleetRenewForm" class="fleet-order">' +
              '<label>Billing period<select id="fleetRenewMonths"><option value="1">1 month</option><option value="6">6 months</option><option value="12">1 year</option></select></label>' +
              '<p class="fleet-renew-count" id="fleetRenewCount">No codes selected.</p>' +
              '<div class="fleet-total"><span>Amount due</span><strong id="fleetRenewDue">' + money(0) + "</strong></div>" +
              '<button type="submit" class="button" id="fleetRenewSubmit">Pay to renew</button>' +
              '<p class="fleet-statement">The charge appears as STL Apps LLC. The Stripe receipt names this as a renewal and lists the codes.</p>' +
              '<p class="fleet-pay-note" id="fleetRenewMessage"></p>' +
            "</form>" +
          "</div>" +
        "</section>"
      : "";
    var payments = (account.payments || []).map(function (row) {
      var when = String(row.paid_at || "").slice(0, 10);
      var kind = row.purpose === "renewal" ? "Renewal" : "New codes";
      var through = row.paid_through ? " Codes run through " + formatExpiryDate(String(row.paid_through).slice(0, 10)) + "." : "";
      var who = row.payer_email ? " Receipt email " + row.payer_email + "." : "";
      var listText = row.code_list ? '<p class="fleet-pay-codes">' + esc(row.code_list) + "</p>" : "";
      var open = row.receipt_url
        ? ' <a href="' + esc(row.receipt_url) + '" target="_blank" rel="noopener">Open Stripe receipt</a>'
        : "";
      return '<li class="fleet-payment-row"><p><strong>' + esc(kind) + "</strong> · " + esc(money(row.amount)) +
        " on " + esc(formatExpiryDate(when) || when) +
        " · " + esc(row.seats || "—") + " code" + (Number(row.seats) === 1 ? "" : "s") +
        " · " + esc(row.months || "—") + " month" + (Number(row.months) === 1 ? "" : "s") +
        "." + esc(through) + esc(who) +
        (row.receipt_number ? " Receipt #" + esc(row.receipt_number) + "." : "") + open + "</p>" +
        listText + "</li>";
    }).join("");
    var paymentBlock = payments
      ? '<section class="fleet-payments" aria-labelledby="fleet-payments-title"><h2 id="fleet-payments-title">Payments</h2><ul class="fleet-payment-list">' + payments + "</ul></section>"
      : "";
    var codesBlock = list
      ? '<div class="fleet-account__intro">' +
          '<p class="fleet-kicker">Fleet account</p>' +
          "<h1>" + esc(account.company) + "</h1>" +
          '<p class="fleet-meta">Each code stops on its own expiry date. A paid code stays unlocked until that date. After the date, the app stops accepting it until you renew that code.</p>' +
          (summaryBits.length ? '<div class="fleet-summary" aria-label="Code summary">' + summaryBits.join("") + "</div>" : "") +
        "</div>" +
        '<section class="fleet-codes-panel" aria-labelledby="fleet-codes-title">' +
          '<div class="fleet-codes-head">' +
            '<div><h2 id="fleet-codes-title">Your codes</h2>' +
            '<p class="fleet-codes-legend">The name is for your records only. Permit Path does not use it. Hand out Active · Open codes. Copy one code, or request a replacement when a device is swapped.</p></div>' +
            '<div class="fleet-codes-actions"><button type="button" id="fleetSave">Save list</button><button type="button" id="fleetEmail">Email list</button></div>' +
          "</div>" +
          '<ul class="fleet-code-list">' + list + "</ul>" +
        "</section>" +
        renew +
        '<section class="fleet-buy" aria-labelledby="fleet-buy-title">' +
          '<button type="button" class="fleet-buy-toggle" id="fleetBuyToggle" aria-expanded="false" aria-controls="fleetBuyPanel">' +
            '<span id="fleet-buy-title">Purchase more codes</span>' +
            '<span class="fleet-buy-toggle__hint">Add seats for additional devices</span>' +
          "</button>" +
          '<div class="fleet-buy-panel" id="fleetBuyPanel" hidden>' +
            "<h3>Buy new codes</h3>" +
            '<p class="fleet-buy-lead">This adds new codes for more devices. It does not renew codes you already have.</p>' +
            order +
          "</div>" +
        "</section>" +
        paymentBlock
      : '<div class="fleet-account__intro">' +
          '<p class="fleet-kicker">Fleet account</p>' +
          "<h1>" + esc(account.company) + "</h1>" +
          '<p class="fleet-meta">Buy your first codes to get started. Each code unlocks one company phone or tablet until its own expiry date.</p>' +
        "</div>" +
        '<section class="fleet-buy fleet-buy--open" aria-labelledby="fleet-buy-title">' +
          '<div class="fleet-buy-panel fleet-buy-panel--solo" id="fleetBuyPanel">' +
            '<h2 id="fleet-buy-title">Purchase codes</h2>' +
            '<p class="fleet-buy-lead">Choose how many codes you need and how long they should stay active. Payment is by card on this page.</p>' +
            order +
            trialBox +
          "</div>" +
        "</section>";
    shell.innerHTML =
      '<header class="fleet-account__bar"><img src="images/websitehead.png" alt="Permit Path" width="160" height="40"><div class="fleet-account__actions"><button type="button" id="fleetHelpOpen">Help</button><button type="button" id="fleetSignOut">Sign out</button></div></header>' +
      '<section class="fleet-account__card">' +
        codesBlock +
        '<p class="fleet-help">Need help by phone? Call Sean at <a href="tel:5807298184">580-729-8184</a>.</p>' +
      "</section>" +
      helpPanelHtml();
    function fleetToken() {
      return sessionStorage.getItem("ppFleetToken") || "";
    }
    function sayOn(button, text) {
      var old = button.textContent;
      button.textContent = text;
      setTimeout(function () { if (button) button.textContent = old; }, 1200);
    }
    shell.querySelectorAll("[data-copy-one]").forEach(function (button) {
      button.onclick = function () {
        var code = button.getAttribute("data-copy-one") || "";
        var done = function () { sayOn(button, "Copied"); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).then(done).catch(function () { done(); });
        } else {
          done();
        }
      };
    });
    shell.querySelectorAll("[data-save-name]").forEach(function (button) {
      button.onclick = function () {
        var code = button.getAttribute("data-save-name") || "";
        var input = shell.querySelector('[data-code-name="' + code.replace(/"/g, "") + '"]');
        var name = input ? String(input.value || "").trim() : "";
        button.disabled = true;
        rpc("fleet_portal_set_label", {
          p_token: fleetToken(),
          p_code: code,
          p_label: name
        }).then(function (result) {
          if (!result || !result.ok) throw new Error((result && result.error) || "Could not save that name.");
          sayOn(button, "Saved");
          button.disabled = false;
        }).catch(function (err) {
          button.disabled = false;
          var text = err.message || "Could not save that name.";
          if (/schema cache|fleet_portal_set_label|Could not find the function/i.test(text)) {
            text = "Names are not turned on yet.";
          }
          window.alert(text);
        });
      };
    });
    shell.querySelectorAll("[data-request-replace]").forEach(function (button) {
      button.onclick = function () {
        var code = button.getAttribute("data-request-replace") || "";
        if (!window.confirm("Request a replacement for " + code + "?\n\nPermit Path will turn that code off and add a new code here, covered through the same date.")) return;
        button.disabled = true;
        button.textContent = "Sending…";
        rpc("fleet_portal_request_replacement", {
          p_token: fleetToken(),
          p_code: code
        }).then(function (result) {
          if (!result || !result.ok) throw new Error((result && result.error) || "Could not send that request.");
          var name = result.label ? " Name on file: " + result.label + "." : "";
          var message = "Turn off " + (result.code || code) + " for " + (result.company || "this company") + "." +
            name + " They requested a replacement. Issue a new code covered by the same payment date, then turn this code off.";
          if (typeof window.submitStudioInbox !== "function") throw new Error("Could not send the Studio message.");
          return window.submitStudioInbox({
            p_source: "fleet_replace",
            p_name: result.company || "Fleet",
            p_email: result.email || account.email || "support@permitpathnav.com",
            p_message: message,
            p_site: "permitpathnav.com",
            p_payload: {
              kind: "fleet_replace",
              fleet_id: result.fleet_id || "",
              seat_id: result.seat_id || "",
              code: result.code || code,
              label: result.label || ""
            }
          }).then(function () { return result; });
        }).then(function () {
          return openSession(fleetToken());
        }).catch(function (err) {
          button.disabled = false;
          button.textContent = "Request replacement";
          var text = err.message || "Could not send that request.";
          if (/schema cache|fleet_portal_request_replacement|Could not find the function/i.test(text)) {
            text = "Replacement requests are not turned on yet.";
          }
          window.alert(text);
        });
      };
    });
    function startCard(button, note, payload) {
      button.disabled = true;
      note.textContent = "Loading the card form…";
      fetch(CHECKOUT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(function (res) { return res.json(); }).then(function (data) {
        if (!data || !data.clientSecret || !data.publishableKey) {
          note.textContent = (data && data.error) || "Card payment is not available yet.";
          button.disabled = false;
          return;
        }
        return loadStripe().then(function () {
          return window.Stripe(data.publishableKey).createEmbeddedCheckoutPage({
            fetchClientSecret: function () { return Promise.resolve(data.clientSecret); }
          });
        }).then(function (checkout) {
          var mount = document.createElement("div");
          mount.id = "fleet-card-mount";
          button.insertAdjacentElement("afterend", mount);
          button.hidden = true;
          note.textContent = "";
          checkout.mount("#fleet-card-mount");
          if (data.sessionId) watchPayment(data.sessionId);
        });
      }).catch(function () {
        note.textContent = "Could not open the card form.";
        button.disabled = false;
      });
    }
    function wirePay(box) {
      var seats = box.querySelector("#fleetSeats");
      var months = box.querySelector("#fleetMonths");
      var due = box.querySelector("#fleetDue");
      var form = box.querySelector("#fleetPayForm");
      if (!seats || !months || !due || !form) return;
      function paint() {
        var n = Math.max(1, Number(seats.value) || 1);
        var m = Number(months.value) || 1;
        due.textContent = money(n * rateFor(n) * m);
      }
      seats.addEventListener("input", paint);
      months.addEventListener("change", paint);
      paint();
      form.onsubmit = function (event) {
        event.preventDefault();
        startCard(box.querySelector("#fleetPaySubmit"), box.querySelector("#fleetPayMessage"), {
          token: sessionStorage.getItem("ppFleetToken"),
          purpose: "purchase",
          months: Number(months.value) || 1,
          seats: Math.max(1, Number(seats.value) || 1)
        });
      };
    }
    function selectedRenewCodes() {
      return Array.prototype.map.call(shell.querySelectorAll(".fleet-renew-box:checked"), function (box) {
        return box.value;
      });
    }
    function paintRenew() {
      var picked = selectedRenewCodes();
      var months = shell.querySelector("#fleetRenewMonths");
      var due = shell.querySelector("#fleetRenewDue");
      var count = shell.querySelector("#fleetRenewCount");
      var button = shell.querySelector("#fleetRenewSubmit");
      if (!months || !due || !count) return;
      var n = picked.length;
      var m = Number(months.value) || 1;
      due.textContent = money(n ? n * rateFor(n) * m : 0);
      count.textContent = n
        ? n + " code" + (n === 1 ? "" : "s") + " × " + money(rateFor(n)) + " × " + (m === 12 ? "1 year" : m === 6 ? "6 months" : "1 month")
        : "No codes selected.";
      if (button) button.disabled = n === 0;
    }
    function wireRenew() {
      var form = shell.querySelector("#fleetRenewForm");
      if (!form) return;
      shell.querySelectorAll(".fleet-renew-box").forEach(function (box) {
        box.addEventListener("change", paintRenew);
      });
      var months = shell.querySelector("#fleetRenewMonths");
      if (months) months.addEventListener("change", paintRenew);
      var dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30);
      var dueStamp = dueDate.getFullYear() + "-" + String(dueDate.getMonth() + 1).padStart(2, "0") + "-" + String(dueDate.getDate()).padStart(2, "0");
      var today = new Date();
      var todayStamp = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
      var selectDue = document.getElementById("fleetSelectDue");
      var selectAll = document.getElementById("fleetSelectAll");
      var selectNone = document.getElementById("fleetSelectNone");
      if (selectDue) selectDue.onclick = function () {
        shell.querySelectorAll(".fleet-renew-box").forEach(function (box) {
          var day = box.getAttribute("data-expires") || "";
          box.checked = !!day && day <= dueStamp;
        });
        paintRenew();
      };
      if (selectAll) selectAll.onclick = function () {
        shell.querySelectorAll(".fleet-renew-box").forEach(function (box) { box.checked = true; });
        paintRenew();
      };
      if (selectNone) selectNone.onclick = function () {
        shell.querySelectorAll(".fleet-renew-box").forEach(function (box) { box.checked = false; });
        paintRenew();
      };
      if (expiredCount) {
        shell.querySelectorAll(".fleet-renew-box").forEach(function (box) {
          var day = box.getAttribute("data-expires") || "";
          if (day && day < todayStamp) box.checked = true;
        });
      }
      paintRenew();
      form.onsubmit = function (event) {
        event.preventDefault();
        var picked = selectedRenewCodes();
        var note = shell.querySelector("#fleetRenewMessage");
        if (!picked.length) {
          note.textContent = "Select at least one code.";
          return;
        }
        startCard(shell.querySelector("#fleetRenewSubmit"), note, {
          token: sessionStorage.getItem("ppFleetToken"),
          purpose: "renewal",
          months: Number(months.value) || 1,
          codes: picked
        });
      };
    }
    wirePay(shell);
    wireRenew();
    function wireToggle(buttonId, panelId) {
      var button = document.getElementById(buttonId);
      var panel = document.getElementById(panelId);
      if (!button || !panel) return;
      button.onclick = function () {
        var open = panel.hidden;
        panel.hidden = !open;
        button.setAttribute("aria-expanded", open ? "true" : "false");
        button.classList.toggle("is-open", open);
        if (open) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      };
    }
    wireToggle("fleetBuyToggle", "fleetBuyPanel");
    wireToggle("fleetRenewToggle", "fleetRenewPanel");
    var save = document.getElementById("fleetSave");
    if (save) save.onclick = function () {
      var file = new Blob([codeText + "\n"], { type: "text/plain" });
      var link = document.createElement("a");
      link.href = URL.createObjectURL(file);
      link.download = "permit-path-codes.txt";
      link.click();
    };
    var email = document.getElementById("fleetEmail");
    if (email) email.onclick = function () {
      window.location.href = "mailto:?subject=" + encodeURIComponent("Permit Path fleet codes") + "&body=" + encodeURIComponent(codeText);
    };
    var trialOpen = document.getElementById("fleetTrialOpen");
    if (trialOpen) trialOpen.onclick = function () { document.getElementById("fleetTrialForm").hidden = false; trialOpen.hidden = true; };
    var trialForm = document.getElementById("fleetTrialForm");
    if (trialForm) {
      trialForm.onsubmit = function (event) {
        event.preventDefault();
        var button = document.getElementById("fleetTrialSubmit");
        var note = document.getElementById("fleetTrialMessage");
        var count = Math.max(1, Math.min(5, Number(document.getElementById("fleetTrialSeats").value) || 1));
        button.disabled = true;
        note.className = "fleet-pay-note";
        note.textContent = "Sending the request…";
        rpc("fleet_portal_request_trial", {
          p_token: sessionStorage.getItem("ppFleetToken"),
          p_seats: count
        }).then(function (result) {
          if (!result || !result.ok) throw new Error((result && result.error) || "Could not send the request.");
          return openSession(sessionStorage.getItem("ppFleetToken"));
        }).catch(function (err) {
          var text = err.message || "Could not send the request.";
          if (/schema cache|fleet_portal_request_trial|Could not find the function/i.test(text)) {
            text = "Trial requests are not turned on yet.";
          }
          note.textContent = text;
          button.disabled = false;
        });
      };
    }
    document.getElementById("fleetSignOut").onclick = function () {
      sessionStorage.removeItem("ppFleetToken");
      window.location.href = "fleet-solutions.html#fleet-login";
    };
    var helpPanel = document.getElementById("fleetHelpPanel");
    var helpOpen = document.getElementById("fleetHelpOpen");
    var helpClose = document.getElementById("fleetHelpClose");
    function setHelpOpen(open) {
      if (!helpPanel) return;
      helpPanel.hidden = !open;
      if (helpOpen) helpOpen.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) helpPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (helpOpen) {
      helpOpen.setAttribute("aria-expanded", "false");
      helpOpen.setAttribute("aria-controls", "fleetHelpPanel");
      helpOpen.onclick = function () { setHelpOpen(helpPanel.hidden); };
    }
    if (helpClose) helpClose.onclick = function () { setHelpOpen(false); };
  }

  function openSession(token) {
    return rpc("fleet_portal_account", { p_token: token }).then(function (account) {
      if (!account || !account.ok) throw new Error((account && account.error) || "Sign in again.");
      showAccount(account);
    });
  }

  var params = new URLSearchParams(window.location.search);
  var stripeSession = params.get("session_id");
  var existing = sessionStorage.getItem("ppFleetToken");
  if (accountRoot) {
    if (!existing && !stripeSession) {
      window.location.replace("fleet-solutions.html#fleet-login");
      return;
    }
    if (stripeSession) {
      fetch(CHECKOUT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: stripeSession })
      }).finally(function () {
        history.replaceState({}, "", "fleet-account.html");
        if (existing) openSession(existing).catch(function () { sessionStorage.removeItem("ppFleetToken"); window.location.replace("fleet-solutions.html#fleet-login"); });
      });
    } else {
      openSession(existing).catch(function () { sessionStorage.removeItem("ppFleetToken"); window.location.replace("fleet-solutions.html#fleet-login"); });
    }
    return;
  }

  var showSignup = document.getElementById("fleetShowSignup");
  var signupNotice = document.getElementById("fleetSignupNotice");
  var signup = document.getElementById("fleetSignupForm");
  function showLogin() {
    if (form) form.hidden = false;
    if (showSignup) showSignup.hidden = false;
    if (signupNotice) signupNotice.hidden = true;
    if (signup) signup.hidden = true;
  }
  if (showSignup && signupNotice && form) {
    showSignup.addEventListener("click", function () {
      form.hidden = true;
      signupNotice.hidden = false;
    });
    document.getElementById("fleetSignupContinue").addEventListener("click", function () {
      signupNotice.hidden = true;
      signup.hidden = false;
    });
    document.getElementById("fleetSignupBack").addEventListener("click", showLogin);
    document.getElementById("fleetSignupCancel").addEventListener("click", showLogin);
  }

  if (!form || !message || !submit) return;
  if (existing) {
    window.location.replace("fleet-account.html");
    return;
  }

  if (signup) {
    signup.addEventListener("submit", function (event) {
      event.preventDefault();
      var company = document.getElementById("fleetCompany");
      var email = document.getElementById("fleetSignupEmail");
      var password = document.getElementById("fleetSignupPassword");
      var button = document.getElementById("fleetSignupSubmit");
      var note = document.getElementById("fleetSignupMessage");
      if (!company.checkValidity() || !email.checkValidity() || !password.checkValidity()) {
        signup.reportValidity();
        return;
      }
      button.disabled = true;
      note.className = "form-message pending";
      note.textContent = "Creating the fleet account…";
      auth({ action: "signup", company: company.value, email: email.value, password: password.value }).then(function (result) {
        if (!result || !result.ok || !result.token) {
          throw new Error((result && result.error) || "Could not create that account.");
        }
        sessionStorage.setItem("ppFleetToken", result.token);
        window.location.href = "fleet-account.html";
      }).catch(function (err) {
        var text = err.message || "Could not create that account.";
        if (/schema cache|fleet_portal_signup|Could not find the function/i.test(text)) {
          text = "Fleet signup is not turned on yet. The database script still needs to be run.";
        }
        note.className = "form-message error";
        note.textContent = text;
        button.disabled = false;
      });
    });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var email = document.getElementById("fleetEmail");
    var password = document.getElementById("fleetPassword");
    if (!email.checkValidity() || !password.checkValidity()) {
      form.reportValidity();
      return;
    }
    submit.disabled = true;
    message.className = "form-message pending";
    message.textContent = "Checking…";
    auth({ action: "login", email: email.value, password: password.value }).then(function (result) {
      if (!result || !result.ok || !result.token) {
        var reason = (result && result.error) || "";
        if (/not right|password|email/i.test(reason) || !reason) {
          throw new Error("That email or password is not right.");
        }
        throw new Error(reason);
      }
      sessionStorage.setItem("ppFleetToken", result.token);
      window.location.href = "fleet-account.html";
      return;
    }).catch(function (err) {
      message.className = "form-message error";
      message.textContent = err.message || "Could not sign in.";
      submit.disabled = false;
    });
  });
})();
