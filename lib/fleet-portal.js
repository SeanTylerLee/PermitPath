(function () {
  var form = document.getElementById("fleetLoginForm");
  var message = document.getElementById("fleetLoginMessage");
  var submit = document.getElementById("fleetLoginSubmit");
  if (!form || !message || !submit) return;

  var SUPABASE = "https://bkgdrfyjppjxwnwntcbc.supabase.co";
  var ANON = "sb_publishable_fMbQ-x2q2q5XA_pT4Bpf6w_ZMcbCQen";
  var CHECKOUT = "https://tkscvymiihwkheyoieax.supabase.co/functions/v1/fleet-checkout";

  function rpc(name, body) {
    return fetch(SUPABASE + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON,
        Authorization: "Bearer " + ANON
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error((data && data.message) || "Could not reach Permit Path.");
        return data;
      });
    });
  }

  function money(n) {
    return Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
  }

  function showAccount(account) {
    var shell = document.getElementById("fleet-portal");
    if (!shell) return;
    var codes = account.codes || [];
    var hidden = codes.filter(function (row) { return !row.visible; }).length;
    var list = codes.filter(function (row) { return row.visible && row.code; }).map(function (row) {
      var kind = row.billing === "trial" ? "Trial until " + row.trial_until : "Paid";
      return "<li><code>" + row.code + "</code> <span>" + kind + (row.used ? " · in use" : " · open") + "</span></li>";
    }).join("");
    shell.innerHTML =
      '<div class="fleet-login-shell__head">' +
        '<p class="index-section__eyebrow">Your fleet</p>' +
        '<h2 class="index-section__title">' + account.company + "</h2>" +
        "<p>" + account.paid_seats + " paid devices at " + money(account.rate) + " each per month. Paid through " + account.paid_through + ".</p>" +
      "</div>" +
      (hidden ? "<p>Pay to see paid codes. Trial codes stay visible during the trial month.</p>" : "") +
      '<ul class="fleet-code-list">' + (list || "<li>No codes to show yet.</li>") + "</ul>" +
      '<div class="site-form-card"><form class="contact-form" id="fleetPayForm">' +
        '<div class="form-group"><label for="fleetMonths">Months to pay</label>' +
        '<select id="fleetMonths"><option value="1">1 month</option><option value="3">3 months</option><option value="6">6 months</option><option value="12">12 months</option></select></div>' +
        '<p id="fleetDue"></p>' +
        '<button type="submit" class="button" id="fleetPaySubmit">Pay by card</button>' +
        '<div class="form-message" id="fleetPayMessage" role="status"></div>' +
      "</form></div>" +
      '<p><button type="button" class="fleet-cta-secondary" id="fleetSignOut">Sign out</button></p>';
    var months = document.getElementById("fleetMonths");
    var due = document.getElementById("fleetDue");
    function paintDue() {
      var count = Number(months.value) || 1;
      due.textContent = "Amount due " + money(Number(account.monthly) * count) + " for " + count + " month" + (count === 1 ? "" : "s") + ".";
    }
    months.addEventListener("change", paintDue);
    paintDue();
    document.getElementById("fleetSignOut").onclick = function () {
      sessionStorage.removeItem("ppFleetToken");
      window.location.href = "fleet-solutions.html";
    };
    document.getElementById("fleetPayForm").onsubmit = function (event) {
      event.preventDefault();
      var button = document.getElementById("fleetPaySubmit");
      var note = document.getElementById("fleetPayMessage");
      button.disabled = true;
      note.textContent = "Opening card checkout…";
      fetch(CHECKOUT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: sessionStorage.getItem("ppFleetToken"),
          months: Number(months.value) || 1
        })
      }).then(function (res) { return res.json(); }).then(function (data) {
        if (data && data.url) {
          window.location.href = data.url;
          return;
        }
        note.textContent = (data && data.error) || "Card payment is not available yet.";
        button.disabled = false;
      }).catch(function () {
        note.textContent = "Could not open card checkout.";
        button.disabled = false;
      });
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
  if (stripeSession) {
    fetch(CHECKOUT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: stripeSession })
    }).finally(function () {
      if (existing) openSession(existing).catch(function () { sessionStorage.removeItem("ppFleetToken"); });
      history.replaceState({}, "", "fleet-solutions.html");
    });
  } else if (existing) {
    openSession(existing).catch(function () { sessionStorage.removeItem("ppFleetToken"); });
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
    rpc("fleet_portal_login", { p_email: email.value, p_password: password.value }).then(function (result) {
      if (!result || !result.ok || !result.token) {
        throw new Error((result && result.error) || "That email or password is not right.");
      }
      sessionStorage.setItem("ppFleetToken", result.token);
      return openSession(result.token);
    }).catch(function (err) {
      message.className = "form-message error";
      message.textContent = err.message || "Could not sign in.";
      submit.disabled = false;
    });
  });
})();
