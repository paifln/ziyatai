  function acceptGeneration(saved, snapshot) {
    generation.revision = saved.revision;
    generation.status = "needs_review";
    generation.reviewed_at = null;
    generation.document = snapshot;
    activeTask = null;
    wholeDocumentDirty = false;
    dirty = false;
    if (draftSession) draftSession.accepted();
    openGeneration(generation.id);
    note(t("saved"));
  }
  window.addEventListener("beforeunload", function (e) {
    if (dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  language();
  request("public-config", "GET", undefined, function (error, config) {
    passwordResetAvailable =
      !error && config && config.passwordResetAvailable === true;
    var option = document.getElementById("auth-reset-option");
    if (option) option.hidden = !passwordResetAvailable;
  });
  if (new URLSearchParams(window.location.search).get("auth") === "recovery") {
    authForm("newPassword");
    return;
  }
  request("auth/get-session", "GET", undefined, function (err, session) {
    if (err) {
      clear("ZiyatAI");
      note(err, true);
      add(
        content,
        button(t("retry"), function () {
          window.location.reload();
        })
      );
      return;
    }
    if (!session || !session.user) {
      authForm("login");
      return;
    }
    user = session.user;
    account.bind(user.id);
    loadProfile();
  });
  function verifyAccount() {
    if (document.visibilityState !== "hidden" && navigator.onLine !== false)
      account.verify();
  }
  document.addEventListener("visibilitychange", verifyAccount);
  window.addEventListener("focus", verifyAccount);
  window.addEventListener("online", verifyAccount);
  window.addEventListener("pageshow", verifyAccount);
  window.addEventListener("storage", function (event) {
    if (event.key && event.key === "ziyatai.auth") verifyAccount();
  });
  function loadProfile() {
    clear("ZiyatAI");
    note("");
    navigation.hidden = true;
    add(content, el("p", t("loading"), "panel"));
    var version = viewVersion;
    pageRead = request(
      "profile",
      "GET",
      undefined,
      function (error, p, status) {
        if (version !== viewVersion) return;
        pageRead = null;
        if (error) {
          if (status === 401) {
            user = null;
            profile = null;
            renderNav();
            authForm("login");
            note(error, true);
            return;
          }
          clear(text("Кабинет ашылмады", "Не удалось открыть кабинет"));
          note(error, true);
          add(content, button(t("retry"), loadProfile));
          return;
        }
        profile = p;
        renderNav();
        var id = new URLSearchParams(window.location.search).get("generation");
        if (id && /^[0-9a-f-]{36}$/i.test(id)) openGeneration(id);
        else render();
      }
    );
  }
