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

  function showAccount(account) {
    var shell = document.getElementById("fleet-account");
    if (!shell) return;
    var codes = (account.codes || []).filter(function (row) { return row.visible && row.code; });
    var hasTrial = (account.codes || []).some(function (row) { return row.billing === "trial" && row.visible; });
    var requested = Number(account.trial_request_seats) || 0;
    var trialBox = hasTrial ? "" : (requested
      ? '<p class="fleet-sent">Sent. Check back here for the codes. Free trial codes are added to this page every evening.</p>'
      : '<p><button type="button" class="fleet-text-btn" id="fleetTrialOpen">Request a free trial</button></p><form id="fleetTrialForm" class="fleet-order" hidden><p class="fleet-meta">Free trial codes are added to this page every evening. You can request up to 5 drivers.</p><label>Drivers, up to 5<input id="fleetTrialSeats" type="number" min="1" max="5" value="5"></label><button type="submit" class="button" id="fleetTrialSubmit">Send request</button><p class="fleet-pay-note" id="fleetTrialMessage"></p></form>');
    var codeText = codes.map(function (row) { return row.code; }).join("\n");
    var list = codes.map(function (row) {
      return "<li><strong>" + row.code + "</strong><span>" + (row.used ? "In use" : "Open") + "</span></li>";
    }).join("");
    var order = '<form id="fleetPayForm" class="fleet-order">' +
      '<label>Number of codes<input id="fleetSeats" type="number" min="1" max="500" value="5"></label>' +
      '<label>Billing period<select id="fleetMonths"><option value="1">Monthly</option><option value="6">6 months</option><option value="12">1 year</option></select></label>' +
      '<div class="fleet-total"><span>Amount due</span><strong id="fleetDue"></strong></div>' +
      '<button type="submit" class="button" id="fleetPaySubmit">Pay by card</button>' +
      '<p class="fleet-statement">The charge appears as STL Apps LLC, the parent company of Permit Path. Purchased codes show on this page after the payment is complete. Free trial codes are added every evening.</p>' +
      '<p class="fleet-pay-note" id="fleetPayMessage"></p></form>';
    shell.innerHTML =
      '<header class="fleet-account__bar"><img src="images/websitehead.png" alt="Permit Path" width="160" height="40"><button type="button" id="fleetSignOut">Sign out</button></header>' +
      '<section class="fleet-account__card">' +
        "<h1>" + account.company + "</h1>" +
        (list
          ? '<p class="fleet-meta">Paid through ' + account.paid_through + "</p>" +
            '<div class="fleet-codes-head"><h2>Codes</h2><div><button type="button" id="fleetSave">Save</button><button type="button" id="fleetEmail">Email</button></div></div>' +
            '<ul class="fleet-code-list">' + list + "</ul>" +
            "<h2>Buy codes</h2>" + order
          : order + trialBox) +
        '<p class="fleet-help">Need help by phone? Call Sean at <a href="tel:5807298184">580-729-8184</a>.</p>' +
      "</section>";
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
