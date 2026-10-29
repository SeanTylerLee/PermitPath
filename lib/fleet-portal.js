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
          "<p>Fleet billing is prepaid by card through Stripe. You pick the seats and months when you pay. There is no automatic forever-renewing charge from this page. Rates are $3.99 per code per month for 1–20 codes, and $3.39 per code per month when you buy 21 or more (15% off on the whole purchase). Keep codes paid through the date shown on this page so drivers stay unlocked.</p>" +
          "<h3>New or replacement devices</h3>" +
          "<p>A code stays on the device that first used it. If you give a driver a new phone or tablet, request a new code for that device. Call Sean at <a href=\"tel:5807298184\">580-729-8184</a> or email <a href=\"mailto:support@permitpathnav.com\">support@permitpathnav.com</a> and a replacement code can be issued.</p>" +
          "<h3>Active, Off, Open, In use, and expiry</h3>" +
          "<p><strong>Active · Open</strong> means the code is on and has not been entered on a device yet. Hand those out.</p>" +
          "<p><strong>Active · In use</strong> means a device already claimed it.</p>" +
          "<p><strong>Off</strong> means Permit Path turned that code off (for example after a device left the company). It stays on your list so you can see it, but it will not unlock the app. Ask Sean to turn it back on or issue a new code.</p>" +
          "<p>Each code has its own expiry date from when that code was purchased or when a trial was started. Codes bought on different days can expire on different days. When a code’s date has passed, it shows as Expired and no longer unlocks the app.</p>" +
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
    var codeText = codes.map(function (row) {
      var expiry = codeExpiryLabel(row);
      return row.code + " — " + codeStatusLabel(row) + (expiry ? " — " + expiry : "");
    }).join("\n");
    var list = codes.map(function (row) {
      var expiry = codeExpiryLabel(row);
      var offClass = (!codeIsActive(row) || codeIsExpired(row)) ? "fleet-code-off" : "";
      return '<li class="' + offClass + '"><div class="fleet-code-main"><strong>' + row.code + "</strong>" +
        (expiry ? '<span class="fleet-code-expiry">' + expiry + "</span>" : "") +
        '</div><span class="' + codeStatusClass(row) + '">' + codeStatusLabel(row) + "</span></li>";
    }).join("");
    var order = '<form id="fleetPayForm" class="fleet-order">' +
      '<label>Number of codes<input id="fleetSeats" type="number" min="1" max="500" value="5"></label>' +
      '<label>Billing period<select id="fleetMonths"><option value="1">Monthly</option><option value="6">6 months</option><option value="12">1 year</option></select></label>' +
      '<div class="fleet-total"><span>Amount due</span><strong id="fleetDue"></strong></div>' +
      '<button type="submit" class="button" id="fleetPaySubmit">Pay by card</button>' +
      '<p class="fleet-statement">The charge appears as STL Apps LLC, the parent company of Permit Path. Purchased codes show on this page after the payment is complete. Each new code gets its own expiry date from the billing period you choose. Free trial codes are added every evening.</p>' +
      '<p class="fleet-pay-note" id="fleetPayMessage"></p></form>';
    shell.innerHTML =
      '<header class="fleet-account__bar"><img src="images/websitehead.png" alt="Permit Path" width="160" height="40"><div class="fleet-account__actions"><button type="button" id="fleetHelpOpen">Help</button><button type="button" id="fleetSignOut">Sign out</button></div></header>' +
      '<section class="fleet-account__card">' +
        "<h1>" + account.company + "</h1>" +
        (list
          ? '<p class="fleet-meta">Company paid through ' + account.paid_through + "</p>" +
            '<div class="fleet-codes-head"><h2>Codes</h2><div><button type="button" id="fleetSave">Save</button><button type="button" id="fleetEmail">Email</button></div></div>' +
            '<p class="fleet-codes-legend">Each code has its own expiry. Active codes work until that date. Off or Expired codes will not unlock a device.</p>' +
            '<ul class="fleet-code-list">' + list + "</ul>" +
            "<h2>Buy codes</h2>" + order
          : order + trialBox) +
        '<p class="fleet-help">Need help by phone? Call Sean at <a href="tel:5807298184">580-729-8184</a>.</p>' +
      "</section>" +
      helpPanelHtml();
    function wirePay(box) {
      var seats = box.querySelector("#fleetSeats");
      var months = box.querySelector("#fleetMonths");
      var due = box.querySelector("#fleetDue");
      function paint() {
        var n = Math.max(1, Number(seats.value) || 1);
        var m = Number(months.value) || 1;
        var term = m === 12 ? "1 year" : m === 6 ? "6 months" : "1 month";
        due.textContent = money(n * rateFor(n) * m);
      }
      seats.addEventListener("input", paint);
      months.addEventListener("change", paint);
      paint();
      box.querySelector("#fleetPayForm").onsubmit = function (event) {
        event.preventDefault();
        var button = box.querySelector("#fleetPaySubmit");
        var note = box.querySelector("#fleetPayMessage");
        button.disabled = true;
        note.textContent = "Loading the card form…";
        fetch(CHECKOUT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: sessionStorage.getItem("ppFleetToken"),
            months: Number(months.value) || 1,
            seats: Math.max(1, Number(seats.value) || 1)
          })
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
      };
    }
    var pay = document.getElementById("fleetPayForm");
    if (pay) wirePay(shell);
    var more = document.getElementById("fleetMore");
    if (more) more.onclick = function () { document.getElementById("fleetMoreBox").hidden = false; };
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
