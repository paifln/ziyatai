  function authForm(mode) {
    authMode = mode;
    clear(
      text("Сабаққа дайындық — бір жерде", "Подготовка к уроку — в одном месте")
    );
    var form = add(content, el("form", null, "panel auth"));
    add(form, el("h2", t(mode)));
    var name, email, password, subject;
    if (mode === "signup") {
      name = field(form, t("name"), "", "text");
      name.required = true;
      name.maxLength = 100;
      name.autocomplete = "name";
    }
    if (mode === "signup") {
      subject = field(form, text("Сіздің пәніңіз", "Ваш предмет"), "", "text");
      subject.required = true;
      subject.maxLength = 120;
      subject.setAttribute("list", "school-subjects");
      var subjects = add(form, el("datalist"));
      subjects.id = "school-subjects";
      [
        "Қазақ тілі",
        "Орыс тілі",
        "Шетел тілі",
        "Математика",
        "Алгебра",
        "Геометрия",
        "Информатика және жасанды интеллект",
        "Цифрлық сауаттылық және жасанды интеллект",
        "Физика",
        "Химия",
        "Биология",
        "География",
        "Қазақстан тарихы",
        "Дүниежүзі тарихы",
        "Музыка",
        "Көркем еңбек",
        "Дене шынықтыру",
        "Начальные классы",
        "Казахский язык",
        "Русский язык",
        "Иностранный язык",
        "Математика",
        "Информатика и искусственный интеллект",
        "Цифровая грамотность и искусственный интеллект",
        "Естествознание",
        "История Казахстана",
        "Всемирная история",
        "Физическая культура",
      ].forEach(function (s) {
        var option = add(subjects, el("option"));
        option.value = s;
      });
    }
    if (mode !== "newPassword") {
      email = field(form, t("email"), "", "email");
      email.required = true;
      email.autocomplete = "email";
    }
    if (mode !== "reset") {
      password = field(form, t("password"), "", "password");
      password.required = true;
      password.minLength = mode === "login" ? 1 : 12;
      password.autocomplete =
        mode === "login" ? "current-password" : "new-password";
      password.maxLength = 128;
      var reveal = add(
        password.parentNode,
        button(text("Құпиясөзді көрсету", "Показать пароль"), function () {
          var visible = password.type === "password";
          password.type = visible ? "text" : "password";
          reveal.textContent = visible
            ? text("Құпиясөзді жасыру", "Скрыть пароль")
            : text("Құпиясөзді көрсету", "Показать пароль");
          reveal.setAttribute("aria-pressed", visible ? "true" : "false");
        })
      );
      reveal.className = "password-reveal";
      reveal.setAttribute("aria-pressed", "false");
      if (mode !== "login")
        add(
          form,
          el("small", text("Кемінде 12 таңба", "Не менее 12 символов"))
        );
    }
    if (mode === "signup") {
      var consent = add(form, el("label", null, "consent")),
        check = add(consent, el("input"));
      check.type = "checkbox";
      check.required = true;
      check.setAttribute(
        "aria-label",
        text("Пайдалану шарттарын қабылдау", "Принять условия использования")
      );
      add(
        consent,
        el(
          "span",
          text(
            "Пайдалану шарттарын қабылдаймын және құпиялық саясатымен таныстым.",
            "Я принимаю условия использования и ознакомился с политикой конфиденциальности."
          )
        )
      );
    }
    var submit = add(form, el("button", t(mode), "primary"));
    submit.type = "submit";
    form.onsubmit = function (e) {
      e.preventDefault();
      if (mode === "login") {
        if (busy) return;
        busy = true;
        var unlock = lockControls();
        request(
          "auth/sign-in/email",
          "POST",
          { email: email.value, password: password.value },
          function (err, result) {
            busy = false;
            unlock();
            if (err) {
              note(
                result &&
                  ["ACCOUNT_EXISTS", "ACCOUNT_MIGRATION_REQUIRED"].indexOf(
                    result.code
                  ) !== -1
                  ? text(
                      "Бұл email бұрын тіркелген. Құпиясөзбен кіріңіз.",
                      "Этот email уже используется. Войдите с паролем."
                    )
                  : err,
                true
              );
              return;
            }
            window.location.reload();
          }
        );
      } else if (mode === "signup") {
        action(
          "auth/sign-up/email",
          {
            email: email.value,
            password: password.value,
            name: name.value,
            teachingSubject: subject.value,
          },
          function () {
            window.location.reload();
          }
        );
      } else if (mode === "reset") {
        action(
          "auth/request-password-reset",
          { email: email.value },
          function () {
            note(t("sent"));
          }
        );
      } else {
        action(
          "auth/reset-password",
          { newPassword: password.value },
          function () {
            window.history.replaceState(null, "", "/lite/");
            authForm("login");
            note(t("changed"));
          }
        );
      }
    };
    var buttons = add(form, el("div", null, "actions"));
    ["login", "signup", "reset"].forEach(function (m) {
      if (m !== mode) {
        var authModeButton = add(
          buttons,
          button(t(m), function () {
            note("");
            authForm(m);
          })
        );
        if (m === "reset") {
          authModeButton.id = "auth-reset-option";
          authModeButton.hidden = !passwordResetAvailable;
        }
      }
    });
  }
