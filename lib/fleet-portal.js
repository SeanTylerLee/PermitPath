(function () {
  var form = document.getElementById("fleetLoginForm");
  var message = document.getElementById("fleetLoginMessage");
  var submit = document.getElementById("fleetLoginSubmit");
  var accountRoot = document.getElementById("fleet-account");

  var SUPABASE = "https://bkgdrfyjppjxwnwntcbc.supabase.co";
  var ANON = "sb_publishable_fMbQ-x2q2q5XA_pT4Bpf6w_ZMcbCQen";
  var CHECKOUT = "https://tkscvymiihwkheyoieax.supabase.co/functions/v1/fleet-checkout";

  function rpc(name, body) {
    var control = new AbortController();
    var timer = setTimeout(function () { control.abort(); }, 20000);
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
      if (err && err.name === "AbortError") throw new Error("That took too long. Try again.");
      throw err;
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
    var codeText = codes.map(function (row) { return row.code; }).join("\n");
    var list = codes.map(function (row) {
      return "<li><strong>" + row.code + "</strong><span>" + (row.used ? "In use" : "Open") + "</span></li>";
    }).join("");
    var order = '<form id="fleetPayForm" class="fleet-pay">' +
      '<label>Codes <input id="fleetSeats" type="number" min="1" max="500" value="5"></label>' +
      '<label>Term <select id="fleetMonths"><option value="1">Monthly</option><option value="6">6 months</option><option value="12">1 year</option></select></label>' +
      '<p id="fleetDue"></p>' +
      '<button type="submit" class="button" id="fleetPaySubmit">Pay by card</button>' +
      '<p id="fleetPayMessage"></p></form>';
    shell.innerHTML =
      "<h2>" + account.company + "</h2>" +
      (list
        ? "<p>Paid through " + account.paid_through + "</p><ul class=\"fleet-code-list\">" + list + "</ul>" +
          '<p class="fleet-pay"><button type="button" class="button" id="fleetSave">Save codes</button><button type="button" class="button" id="fleetEmail">Email codes</button></p>' +
          '<p><button type="button" class="fleet-text-btn" id="fleetMore">Buy more codes</button></p><div id="fleetMoreBox" hidden>' + order + "</div>"
        : "<p>Choose how many driver codes you need, then pay. The codes show here after the card payment.</p>" + order) +
      '<button type="button" id="fleetSignOut">Sign out</button>';
    function wirePay(box) {
      var seats = box.querySelector("#fleetSeats");
      var months = box.querySelector("#fleetMonths");
      var due = box.querySelector("#fleetDue");
      function paint() {
        var n = Math.max(1, Number(seats.value) || 1);
        var m = Number(months.value) || 1;
        var term = m === 12 ? "1 year" : m === 6 ? "6 months" : "1 month";
        due.textContent = n + " codes × " + money(rateFor(n)) + " × " + term + " = " + money(n * rateFor(n) * m);
      }
      seats.addEventListener("input", paint);
      months.addEventListener("change", paint);
      paint();
      box.querySelector("#fleetPayForm").onsubmit = function (event) {
        event.preventDefault();
        var button = box.querySelector("#fleetPaySubmit");
        var note = box.querySelector("#fleetPayMessage");
        button.disabled = true;
        note.textContent = "Opening card checkout…";
        fetch(CHECKOUT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: sessionStorage.getItem("ppFleetToken"),
            months: Number(months.value) || 1,
            seats: Math.max(1, Number(seats.value) || 1)
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
