(function () {
  var form = document.getElementById("fleetLoginForm");
  var message = document.getElementById("fleetLoginMessage");
  var submit = document.getElementById("fleetLoginSubmit");
  var accountRoot = document.getElementById("fleet-account");

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
    var shell = document.getElementById("fleet-account");
    if (!shell) return;
    var codes = account.codes || [];
    var hidden = codes.some(function (row) { return !row.visible; });
    var list = codes.filter(function (row) { return row.visible && row.code; }).map(function (row) {
      var kind = row.billing === "trial" ? "Trial until " + row.trial_until : "Paid";
      return "<li><strong>" + row.code + "</strong><span>" + kind + (row.used ? " · in use" : "") + "</span></li>";
    }).join("");
    shell.innerHTML =
      '<div class="fleet-account">' +
        "<h2>" + account.company + "</h2>" +
        "<p>" + account.paid_seats + " devices · " + money(account.rate) + " each · paid through " + account.paid_through + "</p>" +
        (hidden ? "<p>Pay to see your codes.</p>" : "") +
        '<ul class="fleet-code-list">' + (list || "<li>No codes yet.</li>") + "</ul>" +
        '<form id="fleetPayForm" class="fleet-pay">' +
          '<label>Months <select id="fleetMonths"><option value="1">1</option><option value="3">3</option><option value="6">6</option><option value="12">12</option></select></label>' +
          '<p id="fleetDue"></p>' +
          '<button type="submit" class="button" id="fleetPaySubmit">Pay by card</button>' +
          '<p id="fleetPayMessage"></p>' +
        "</form>" +
        '<button type="button" id="fleetSignOut">Sign out</button>' +
      "</div>";
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
      window.location.href = "fleet-solutions.html#fleet-login";
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

  if (!form || !message || !submit) return;
  if (existing) {
    window.location.replace("fleet-account.html");
    return;
  }

  var signup = document.getElementById("fleetSignupForm");
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
      note.textContent = "Creating the fleet account…";
      rpc("fleet_portal_signup", {
        p_company: company.value,
        p_email: email.value,
        p_password: password.value
      }).then(function (result) {
        if (!result || !result.ok || !result.token) {
          throw new Error((result && result.error) || "Could not create that account.");
        }
        sessionStorage.setItem("ppFleetToken", result.token);
        window.location.href = "fleet-account.html";
      }).catch(function (err) {
        note.textContent = err.message || "Could not create that account.";
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
    rpc("fleet_portal_login", { p_email: email.value, p_password: password.value }).then(function (result) {
      if (!result || !result.ok || !result.token) {
        throw new Error((result && result.error) || "That email or password is not right.");
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
