  function renderNav() {
    navigation.textContent = "";
    navigation.hidden = !user;
    if (!user) return;
    ["plans", "upload", "history", "library"].forEach(function (v) {
      var b = button(t(v), function () {
        go(v);
      });
      if (currentView === v) b.setAttribute("aria-current", "page");
      add(navigation, b);
    });
    add(
      navigation,
      button(t("logout"), function () {
        leave(function () {
          action("auth/sign-out", {}, function () {
            window.location.replace("/lite/");
          });
        });
      })
    );
  }
  function language() {
    document.documentElement.lang = locale;
    document.getElementById("language").textContent =
      locale === "kk" ? "Русский" : "Қазақша";
    document.getElementById("full").textContent = text(
      "Толық нұсқа",
      "Полная версия"
    );
    document.getElementById("mode-note").textContent = text(
      "Баяу компьютерге арналған. Файлдар серверде өңделеді, бет автоматты жаңартылмайды.",
      "Для слабых компьютеров. Файлы обрабатываются на сервере, страница обновляется по кнопке."
    );
    document.getElementById("footer-note").textContent = text(
      "AI тапсырмалары мен жауаптарын мұғалім тексеруі керек.",
      "Содержание заданий и ответы AI должен проверить учитель."
    );
  }
  document.getElementById("language").onclick = function () {
    leave(function () {
      dirty = false;
      locale = locale === "kk" ? "ru" : "kk";
      document.cookie =
        "ziyatai-locale=" + locale + "; Path=/; SameSite=Lax; Max-Age=31536000";
      language();
      if (user && !profile) {
        loadProfile();
        return;
      }
      renderNav();
      if (user) render();
      else authForm(authMode);
    });
  };
