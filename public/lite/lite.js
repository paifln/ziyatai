/* ZiyatAI Lite: no framework, external library, analytics, cache or background polling.
 * ES5 syntax deliberately retained for older school browsers. Private data stays in memory.
 */
(function () {
  "use strict";
  var content = document.getElementById("content");
  var datesBeforeSkip = null;
  var localMailbox = false;
  var message = document.getElementById("message");
  var navigation = document.getElementById("navigation");
  if (
    !window.XMLHttpRequest ||
    !window.URLSearchParams ||
    !window.crypto ||
    !window.crypto.getRandomValues
  ) {
    content.textContent =
      "Бұл браузерді жаңартыңыз немесе Firefox/Chrome ашыңыз. / Откройте сайт в Firefox или Chrome: этот браузер не поддерживает безопасный вход.";
    return;
  }
  var locale = /(?:^|; )ziyatai-locale=ru(?:;|$)/.test(document.cookie)
    ? "ru"
    : "kk";
  var user = null,
    profile = null,
    currentView = "plans",
    plan = null,
    generation = null,
    authMode = "login";
  var rowPage = 0,
    listOffset = 0,
    dirty = false,
    busy = false;
  var requestKeys = {};
  var words = {
    plans: ["Менің КТЖ", "Мои КТП"],
    upload: ["КТЖ жүктеу", "Загрузить КТП"],
    history: ["Тапсырмалар", "Задания"],
    library: ["Құжаттар", "Документы"],
    logout: ["Шығу", "Выйти"],
    refresh: ["Жаңарту", "Обновить"],
    loading: ["Жүктелуде…", "Загрузка…"],
    email: ["Email", "Email"],
    password: ["Құпиясөз", "Пароль"],
    login: ["Кіру", "Войти"],
    signup: ["Тіркелу", "Регистрация"],
    name: ["Атыңыз", "Имя"],
    reset: ["Құпиясөзді қалпына келтіру", "Восстановить пароль"],
    sent: [
      "Поштаңызды тексеріңіз. Хаттағы сілтемені ашыңыз.",
      "Проверьте почту и перейдите по ссылке в письме.",
    ],
    save: ["Сақтау", "Сохранить"],
    saved: ["Сақталды", "Сохранено"],
    confirm: ["КТЖ растау", "Подтвердить КТП"],
    grade: ["Сынып", "Класс"],
    year: ["Оқу жылы", "Учебный год"],
    topic: ["Сабақ тақырыбы", "Тема урока"],
    goals: ["Оқу мақсаттары", "Цели обучения"],
    date: ["Күні", "Дата"],
    hours: ["Сағат", "Часы"],
    source: ["Дереккөз", "Источник"],
    open: ["Ашу", "Открыть"],
    generate: ["Тапсырма құрастыру", "Создать задания"],
    locale: ["Тапсырма тілі", "Язык заданий"],
    count: ["Әр деңгейдегі тапсырма саны", "Заданий на каждом уровне"],
    minutes: ["Уақыт, минут", "Время, минут"],
    constraints: ["Шарттар", "Условия и ограничения"],
    download: ["Жүктеп алу", "Скачать"],
    full: ["Жауаптарымен", "С ответами"],
    student: ["Оқушыға, жауапсыз", "Для ученика, без ответов"],
    export: ["Құжат дайындау", "Подготовить документ"],
    prev: ["Алдыңғы", "Назад"],
    next: ["Келесі", "Далее"],
    empty: ["Әзірге материал жоқ.", "Материалов пока нет."],
    dirty: [
      "Сақталмаған өзгерістер бар. Шығу керек пе?",
      "Есть несохранённые изменения. Уйти без сохранения?",
    ],
    needsReview: [
      "Тақырыптарды, мақсаттарды және сыныпты тексеріңіз. Жоқ деректерді өзіңіз толтырыңыз.",
      "Проверьте темы, цели и класс. Заполните пропуски по исходному документу.",
    ],
    processing: [
      "Өңделуде. Күйін көру үшін «Жаңарту» түймесін басыңыз.",
      "Идёт обработка. Нажмите «Обновить», чтобы проверить результат.",
    ],
    answer: ["Жауап", "Ответ"],
    condition: ["Шарт", "Условие"],
    how: ["Шешу жолы", "Как решить"],
    why: ["Әдістің негізі", "Почему метод верен"],
    advancedEditor: ["Толық редакторда ашу", "Открыть полный редактор"],
    newPassword: ["Жаңа құпиясөз", "Новый пароль"],
    changed: [
      "Құпиясөз өзгертілді. Кіруге болады.",
      "Пароль изменён. Теперь можно войти.",
    ],
    confirmed: ["Расталды", "Подтверждено"],
    review: ["Тексеру қажет", "Требует проверки"],
    extracting: ["Өңделуде", "Обработка"],
    queued: ["Кезекте", "В очереди"],
    running: ["Өңделуде", "Выполняется"],
    needs_review: ["Мұғалім тексеруі керек", "Нужна проверка учителя"],
    succeeded: ["Дайын", "Готово"],
    failed: ["Қате", "Ошибка"],
    cancelled: ["Тоқтатылды", "Отменено"],
    easy: ["Жеңіл", "Лёгкий"],
    medium: ["Орта", "Средний"],
    advanced: ["Күрделі", "Сложный"],
    file: [
      "Файл: PDF, DOCX, XLS, XLSX — 25 МБ дейін",
      "Файл: PDF, DOCX, XLS, XLSX — до 25 МБ",
    ],
    sourceLocale: ["КТЖ тілі", "Язык исходного КТП"],
    import: ["Жолдарды шығару", "Извлечь строки"],
    demo: ["Жасанды үлгі (AI емес)", "Синтетический образец (без AI)"],
    unavailable: [
      "AI қосылмаған. Жасанды үлгіні қолданып көруге болады.",
      "AI не подключён. Можно изучить синтетический образец.",
    ],
    format: ["Түрі", "Тип"],
    mixed: ["Аралас", "Смешанные"],
    theory: ["Теория", "Теория"],
    programming: ["Бағдарламалау", "Программирование"],
    logic: ["Логика", "Логика"],
    retry: ["Қайта көру", "Повторить"],
    cancel: ["Тоқтату", "Отменить"],
    error: [
      "Әрекет орындалмады. Қосылымды және деректерді тексеріңіз.",
      "Не удалось выполнить действие. Проверьте соединение и данные.",
    ],
    REVIEW_REQUIRED: [
      "Тапсырмаларды тексеріп, ескертулерді түзетіңіз де, мақұлдаңыз.",
      "Проверьте задания, исправьте замечания и нажмите «Одобрить задания».",
    ],
    edit: ["Өңдеу", "Редактировать"],
    remove: ["Жою", "Удалить"],
    points: ["Балдар", "Баллы"],
    criterion: ["Бағалау критерийі", "Критерий оценивания"],
    discard: ["Өзгерістерді сақтамай жабу", "Закрыть без сохранения"],
    deleteConfirm: [
      "Материалды және оған қатысты құжаттарды жою керек пе?",
      "Удалить материал и связанные с ним документы?",
    ],
    DOCUMENT_LIMIT: [
      "Материал тым үлкен. Мәтінді немесе кестелерді қысқартыңыз.",
      "Материал слишком большой. Сократите текст или таблицы.",
    ],
    CONFLICT: [
      "Материал өзгерген. Жаңартып, өзгерістерді қайталаңыз.",
      "Материал уже изменён. Обновите его перед сохранением.",
    ],
    UNCONFIRMED: [
      "Сыныпты, тақырыпты және толық мақсат мәтінін енгізіңіз.",
      "Укажите класс, тему и полный текст целей обучения.",
    ],
    LIMIT: [
      "Лимитке жеттіңіз. Біраздан кейін қайталаңыз.",
      "Достигнут лимит. Повторите позже.",
    ],
    FILE_SIZE: [
      "Файл тым үлкен. 25 МБ дейін таңдаңыз.",
      "Файл слишком большой. Выберите файл до 25 МБ.",
    ],
    FILE_UNSAFE: [
      "Файл қабылданбады. Қауіпсіз көшірмесін жүктеңіз.",
      "Файл отклонён проверкой безопасности. Загрузите безопасную копию.",
    ],
    AI_UNAVAILABLE: ["AI уақытша қолжетімсіз.", "AI временно недоступен."],
  };
  function t(key) {
    return words[key] ? words[key][locale === "ru" ? 1 : 0] : key;
  }
  function text(kk, ru) {
    return locale === "ru" ? ru : kk;
  }
  function el(tag, value, className) {
    var node = document.createElement(tag);
    if (tag === "form") node.noValidate = true;
    if (value !== undefined && value !== null) node.textContent = String(value);
    if (className) node.className = className;
    return node;
  }
  var fieldErrorSequence = 0;
  function clearFieldError(input) {
    var id = input.getAttribute("data-field-error"),
      error = id && document.getElementById(id);
    if (error && error.parentNode) error.parentNode.removeChild(error);
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
    input.removeAttribute("data-field-error");
  }
  document.addEventListener(
    "submit",
    function (event) {
      var form = event.target,
        first = null;
      if (form.tagName !== "FORM") return;
      for (var i = 0; i < form.elements.length; i++) {
        var input = form.elements[i];
        if (!input.willValidate) continue;
        clearFieldError(input);
        var short =
          input.minLength > 0 &&
          input.value &&
          input.value.length < input.minLength;
        if (input.validity.valid && !short) continue;
        var value = input.validity.valueMissing
          ? text("Осы өрісті толтырыңыз.", "Заполните это поле.")
          : input.validity.typeMismatch
            ? text("Пошта мекенжайын тексеріңіз.", "Проверьте адрес почты.")
            : short || input.validity.tooShort
              ? text(
                  "Кемінде " + input.minLength + " таңба енгізіңіз.",
                  "Введите не менее " + input.minLength + " символов."
                )
              : text(
                  "Енгізілген мәнді тексеріңіз.",
                  "Проверьте введённое значение."
                );
        var error = el("small", value, "field-error");
        error.id = "field-error-" + ++fieldErrorSequence;
        error.setAttribute("role", "alert");
        input.parentNode.appendChild(error);
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", error.id);
        input.setAttribute("data-field-error", error.id);
        if (!first) first = input;
      }
      if (first) {
        event.preventDefault();
        event.stopImmediatePropagation();
        first.focus();
      }
    },
    true
  );
  document.addEventListener("input", function (event) {
    var input = event.target;
    if (
      input.getAttribute("data-field-error") &&
      input.validity &&
      input.validity.valid &&
      !(input.minLength > 0 && input.value.length < input.minLength)
    )
      clearFieldError(input);
  });
  function add(parent, node) {
    parent.appendChild(node);
    return node;
  }
  function button(label, fn, primary) {
    var b = el("button", label, primary ? "primary" : "");
    b.type = "button";
    b.onclick = fn;
    return b;
  }
  function link(label, href) {
    var a = el("a", label, "button");
    a.href = href;
    return a;
  }
  function note(value, error) {
    message.hidden = !value;
    message.className = error ? "error" : "";
    message.textContent = value || "";
    if (error) message.scrollIntoView({ block: "nearest" });
  }
  function uuid() {
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = "",
      i;
    for (i = 0; i < 16; i++) hex += ("0" + bytes[i].toString(16)).slice(-2);
    return (
      hex.slice(0, 8) +
      "-" +
      hex.slice(8, 12) +
      "-" +
      hex.slice(12, 16) +
      "-" +
      hex.slice(16, 20) +
      "-" +
      hex.slice(20)
    );
  }
  function request(path, method, data, done) {
    var xhr = new XMLHttpRequest();
    xhr.open(method || "GET", "/api/" + path);
    xhr.timeout = 120000;
    var form = data instanceof FormData;
    if (!form && data !== undefined)
      xhr.setRequestHeader("Content-Type", "application/json");
    var signature = "";
    if (method && method !== "GET") {
      var costly =
        method === "POST" &&
        (path === "generations" ||
          path === "exports" ||
          /^generations\/[^/]+\/tasks\/[^/]+\/regenerate$/.test(path));
      if (costly) {
        signature = path + ":" + JSON.stringify(data);
        if (!requestKeys[signature]) requestKeys[signature] = uuid();
      }
      xhr.setRequestHeader(
        "Idempotency-Key",
        signature ? requestKeys[signature] : uuid()
      );
    }
    xhr.onload = function () {
      var result;
      try {
        result = JSON.parse(xhr.responseText);
      } catch (parseError) {
        void parseError;
        done(
          t(
            xhr.status === 429
              ? "LIMIT"
              : xhr.status === 413
                ? "FILE_SIZE"
                : "error"
          )
        );
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        var code = result.code || (result.error && result.error.code);
        if (xhr.status === 429) code = "LIMIT";
        done(words[code] ? t(code) : t("error"), result, xhr.status);
        return;
      }
      if (signature) delete requestKeys[signature];
      done(null, result);
    };
    xhr.onerror = xhr.ontimeout = function () {
      done(t("error"));
    };
    xhr.send(data === undefined ? null : form ? data : JSON.stringify(data));
    return xhr;
  }
  function lockControls() {
    var controls = document.querySelectorAll("button,input,textarea,select"),
      states = [];
    for (var i = 0; i < controls.length; i++) {
      if (controls[i].getAttribute("data-allow-busy") === "true") continue;
      states.push({ node: controls[i], disabled: controls[i].disabled });
      controls[i].disabled = true;
    }
    return function () {
      for (var j = 0; j < states.length; j++)
        if (document.documentElement.contains(states[j].node))
          states[j].node.disabled = states[j].disabled;
    };
  }
  function action(path, data, done, method) {
    if (busy) return;
    busy = true;
    var unlock = lockControls();
    note(t("loading"));
    return request(path, method || "POST", data, function (err, result) {
      busy = false;
      unlock();
      if (err) {
        note(err, true);
        return;
      }
      note("");
      done(result);
    });
  }
  function field(parent, title, value, type, change) {
    var label = add(parent, el("label", title));
    var input = add(label, el(type === "textarea" ? "textarea" : "input"));
    if (type !== "textarea") input.type = type || "text";
    input.setAttribute("aria-label", title);
    input.value = value === null || value === undefined ? "" : value;
    input.oninput = function () {
      if (change) change(input.value);
    };
    return input;
  }
  function select(parent, title, options, value, change) {
    var label = add(parent, el("label", title)),
      s = add(label, el("select"));
    s.setAttribute("aria-label", title);
    options.forEach(function (o) {
      var n = el("option", o[1]);
      n.value = o[0];
      s.appendChild(n);
    });
    s.value = value;
    if (change)
      s.onchange = function () {
        change(s.value);
      };
    return s;
  }
  function clear(title) {
    content.textContent = "";
    add(content, el("h1", title));
  }
  function confirmAction(value, done, destructive) {
    var dialog = el("dialog", null, "confirm-dialog");
    if (typeof dialog.showModal !== "function") {
      if (window.confirm(value)) done();
      return;
    }
    var trigger = document.activeElement;
    add(
      dialog,
      el("h2", text("Әрекетті растаңыз", "Подтвердите действие"))
    ).id = "lite-confirm-title";
    add(dialog, el("p", value)).id = "lite-confirm-description";
    dialog.setAttribute("aria-labelledby", "lite-confirm-title");
    dialog.setAttribute("aria-describedby", "lite-confirm-description");
    var actions = add(dialog, el("div", null, "actions"));
    function close(accepted) {
      dialog.close();
      dialog.parentNode.removeChild(dialog);
      if (trigger && document.documentElement.contains(trigger))
        trigger.focus();
      if (accepted) done();
    }
    var cancel = add(
      actions,
      button(text("Бас тарту", "Отмена"), function () {
        close(false);
      })
    );
    add(
      actions,
      button(
        destructive ? t("remove") : text("Жалғастыру", "Продолжить"),
        function () {
          close(true);
        },
        true
      )
    );
    dialog.oncancel = function (event) {
      event.preventDefault();
      close(false);
    };
    document.body.appendChild(dialog);
    dialog.showModal();
    cancel.focus();
  }
  function leave(done) {
    if (!dirty) done();
    else confirmAction(t("dirty"), done);
  }
  function go(view) {
    leave(function () {
      dirty = false;
      currentView = view;
      plan = null;
      generation = null;
      rowPage = 0;
      listOffset = 0;
      note("");
      renderNav();
      render();
    });
  }
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
      renderNav();
      if (user) render();
      else if (authMode === "verify") verifyForm(verificationEmail);
      else authForm(authMode);
    });
  };
  var verificationEmail = "";
  function mailPreview(form) {
    var slot = add(form, el("div"));
    slot.id = "local-mail-preview";
    updateMailPreview();
  }
  function updateMailPreview() {
    var slot = document.getElementById("local-mail-preview");
    if (!slot || !localMailbox) return;
    slot.textContent = "";
    var note = add(
      slot,
      el(
        "p",
        text(
          "Жергілікті демода кодтар мен сілтемелер осы компьютердің сынақ поштасына түседі. ",
          "В локальной демонстрации коды и ссылки попадают в тестовую почту этого ПК, а не во внешний ящик. "
        ),
        "mail-preview-note"
      )
    );
    var link = add(
      note,
      el("a", text("Сынақ поштасын ашу", "Открыть тестовую почту"))
    );
    link.href = "http://localhost:8025";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  function verifyForm(address) {
    authMode = "verify";
    verificationEmail = address;
    clear(text("Поштаңызды растаңыз", "Подтвердите почту"));
    var form = add(content, el("form", null, "panel auth"));
    mailPreview(form);
    add(
      form,
      el(
        "p",
        text(
          "Поштадағы 6 таңбалы кодты енгізіңіз: ",
          "Введите 6-значный код из письма: "
        ) + address
      )
    );
    var code = field(
      form,
      text("Растау коды", "Код подтверждения"),
      "",
      "text"
    );
    code.required = true;
    code.pattern = "[0-9]{6}";
    code.maxLength = 6;
    code.autocomplete = "one-time-code";
    code.inputMode = "numeric";
    var submit = add(
      form,
      el("button", text("Растау", "Подтвердить"), "primary")
    );
    submit.type = "submit";
    form.onsubmit = function (e) {
      e.preventDefault();
      action(
        "auth/email-otp/verify-email",
        { email: verificationEmail, otp: code.value },
        function () {
          window.location.reload();
        }
      );
    };
    add(
      form,
      button(text("Кодты қайта жіберу", "Отправить код ещё раз"), function () {
        action(
          "auth/email-otp/send-verification-otp",
          { email: verificationEmail, type: "email-verification" },
          function () {
            note(
              text(
                "Жаңа код жіберілді. Код 10 минут жарамды.",
                "Новый код отправлен. Код действует 10 минут."
              )
            );
          }
        );
      })
    );
    add(
      form,
      button(t("login"), function () {
        authForm("login");
      })
    );
  }
  function authForm(mode) {
    authMode = mode;
    clear(
      text("Сабаққа дайындық — бір жерде", "Подготовка к уроку — в одном месте")
    );
    var form = add(content, el("form", null, "panel auth"));
    if (mode === "reset") mailPreview(form);
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
        "Информатика",
        "Цифрлық сауаттылық",
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
        "Информатика",
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
              if (result && result.code === "EMAIL_NOT_VERIFIED")
                verifyForm(email.value);
              else note(err, true);
              return;
            }
            window.location.reload();
          }
        );
      } else if (mode === "signup")
        action(
          "auth/sign-up/email",
          {
            email: email.value,
            password: password.value,
            name: name.value,
            teachingSubject: subject.value,
            callbackURL: "/lite/",
          },
          function () {
            verifyForm(email.value);
          }
        );
      else if (mode === "reset")
        action(
          "auth/request-password-reset",
          { email: email.value, redirectTo: window.location.origin + "/lite/" },
          function () {
            note(t("sent"));
          }
        );
      else
        action(
          "auth/reset-password",
          {
            newPassword: password.value,
            token:
              new URLSearchParams(window.location.search).get("token") || "",
          },
          function () {
            window.history.replaceState(null, "", "/lite/");
            authForm("login");
            note(t("changed"));
          }
        );
    };
    var buttons = add(form, el("div", null, "actions"));
    ["login", "signup", "reset"].forEach(function (m) {
      if (m !== mode)
        add(
          buttons,
          button(t(m), function () {
            note("");
            authForm(m);
          })
        );
    });
    if (mode === "login")
      add(
        buttons,
        button(text("Поштаны растау", "Подтвердить почту"), function () {
          verifyForm(email.value);
        })
      );
  }
  function render() {
    if (plan) {
      renderPlan();
      return;
    }
    if (generation) {
      renderGeneration();
      return;
    }
    if (currentView === "upload") {
      uploadForm();
      return;
    }
    clear(t(currentView));
    var actions = add(content, el("div", null, "actions"));
    add(actions, button(t("refresh"), render));
    if (currentView === "history" && profile && profile.capabilities.demo)
      add(
        actions,
        button(t("demo"), function () {
          action("demo", { locale: locale }, function (g) {
            openGeneration(g.id);
          });
        })
      );
    var resource =
      currentView === "plans"
        ? "ktp"
        : currentView === "history"
          ? "history"
          : "library";
    var panel = add(content, el("section", t("loading"), "panel"));
    request(
      resource + "?limit=20&offset=" + listOffset,
      "GET",
      undefined,
      function (err, items) {
        if (err) {
          panel.textContent = "";
          note(err, true);
          return;
        }
        panel.textContent = "";
        if (!items.length) add(panel, el("p", t("empty")));
        items.forEach(function (item) {
          var row = add(panel, el("div", null, "resource")),
            label = add(row, el("div"));
          add(label, el("strong", item.title));
          add(
            label,
            el(
              "small",
              t(item.status) +
                (item.format
                  ? " · " +
                    item.format.toUpperCase() +
                    " · " +
                    (item.teacher_reviewed
                      ? text("Мұғалім тексерді", "Проверено учителем")
                      : text("Жоба", "Черновик"))
                  : "")
            )
          );
          if (resource === "library") {
            if (item.status === "succeeded" && item.teacher_reviewed)
              add(
                row,
                link(
                  t("download"),
                  "/api/exports/" + encodeURIComponent(item.id) + "/download"
                )
              );
            if (!item.teacher_reviewed)
              add(
                row,
                button(
                  text("Тапсырмаларды тексеру", "Проверить задания"),
                  function () {
                    openGeneration(item.generation_id);
                  }
                )
              );
          } else
            add(
              row,
              button(t("open"), function () {
                if (resource === "ktp") openPlan(item.id);
                else openGeneration(item.id);
              })
            );
          add(
            row,
            button(t("remove"), function () {
              confirmAction(
                t("deleteConfirm"),
                function () {
                  action(
                    (resource === "ktp"
                      ? "ktp"
                      : resource === "history"
                        ? "generations"
                        : "exports") +
                      "/" +
                      item.id,
                    {},
                    render,
                    "DELETE"
                  );
                },
                true
              );
            })
          );
        });
        var pages = add(content, el("div", null, "pagination"));
        if (listOffset > 0)
          add(
            pages,
            button(t("prev"), function () {
              listOffset = Math.max(0, listOffset - 20);
              render();
            })
          );
        if (items.length === 20)
          add(
            pages,
            button(t("next"), function () {
              listOffset += 20;
              render();
            })
          );
      }
    );
  }
  function uploadForm() {
    clear(t("upload"));
    var form = add(content, el("form", null, "panel"));
    var file = field(form, t("file"), "", "file");
    file.accept = ".pdf,.docx,.xls,.xlsx";
    file.required = true;
    file.className = "sr-only";
    file.tabIndex = -1;
    var choose = add(
      file.parentNode,
      button(text("Файлды таңдау", "Выбрать файл"), function () {
        file.click();
      })
    );
    choose.className = "file-picker";
    var filename = add(
      file.parentNode,
      el(
        "span",
        text("Файл таңдалмаған", "Файл пока не выбран"),
        "selected-file"
      )
    );
    filename.setAttribute("role", "status");
    file.onchange = function () {
      var selected = file.files[0];
      filename.textContent = selected
        ? selected.name +
          " · " +
          (selected.size / 1024 / 1024).toFixed(2) +
          " МБ"
        : text("Файл таңдалмаған", "Файл пока не выбран");
    };
    var lang = select(
      form,
      t("sourceLocale"),
      [
        ["kk", "Қазақша"],
        ["ru", "Русский"],
      ],
      locale
    );
    add(
      form,
      el(
        "p",
        text(
          "Файл жеке сақталады. DOC файлын DOCX ретінде қайта сақтаңыз.",
          "Файл хранится приватно. Старый DOC пересохраните в DOCX."
        ),
        "muted"
      )
    );
    var submit = add(form, el("button", t("import"), "primary"));
    submit.type = "submit";
    var transfer = null,
      cancelled = false;
    var cancel = add(
      form,
      button(t("cancel"), function () {
        cancelled = true;
        if (transfer) transfer.abort();
        busy = false;
        dirty = false;
        go("plans");
      })
    );
    cancel.setAttribute("data-allow-busy", "true");
    form.onsubmit = function (e) {
      e.preventDefault();
      if (!file.files.length) return;
      if (!file.files[0].size || file.files[0].size > 25 * 1024 * 1024) {
        note(t("FILE_SIZE"), true);
        return;
      }
      var selected = file.files[0];
      if (!/\.(pdf|docx|xls|xlsx)$/i.test(selected.name)) {
        note(t("FILE_TYPE"), true);
        return;
      }
      function imported(f) {
        if (cancelled) return;
        transfer = action(
          "ktp/imports",
          { uploadId: f.id, locale: lang.value, includeHidden: false },
          function (p) {
            if (!cancelled) openPlan(p.id);
          }
        );
      }
      if (profile.capabilities.directUploads) {
        transfer = action(
          "uploads/init",
          { name: selected.name, bytes: selected.size },
          function (init) {
            if (cancelled) return;
            busy = true;
            var unlock = lockControls();
            note(t("loading"));
            var xhr = new XMLHttpRequest();
            xhr.open("PUT", init.url);
            xhr.timeout = 300000;
            xhr.setRequestHeader("Content-Type", init.contentType);
            transfer = xhr;
            xhr.upload.onprogress = function (ev) {
              if (ev.lengthComputable)
                note(
                  t("loading") +
                    " " +
                    Math.round((ev.loaded / ev.total) * 100) +
                    "%"
                );
            };
            function failed() {
              if (cancelled) return;
              busy = false;
              unlock();
              note(t("error"), true);
            }
            xhr.onerror = xhr.ontimeout = failed;
            xhr.onload = function () {
              if (cancelled) return;
              busy = false;
              unlock();
              if (xhr.status >= 200 && xhr.status < 300)
                transfer = action(
                  "uploads/" + init.id + "/complete",
                  {},
                  imported
                );
              else failed();
            };
            xhr.send(selected);
          }
        );
      } else {
        var data = new FormData();
        data.append("file", selected);
        transfer = action("uploads", data, imported);
      }
    };
  }
  function openPlan(id) {
    leave(function () {
      request(
        "ktp/" + encodeURIComponent(id),
        "GET",
        undefined,
        function (err, p) {
          if (err) {
            note(err, true);
            return;
          }
          dirty = false;
          plan = p;
          datesBeforeSkip = null;
          generation = null;
          renderPlan();
        }
      );
    });
  }
  function renderPlan() {
    clear(plan.title);
    var actions = add(content, el("div", null, "actions"));
    add(
      actions,
      button(t("refresh"), function () {
        openPlan(plan.id);
      })
    );
    if (plan.status === "extracting") {
      add(content, el("p", t("processing"), "notice"));
      return;
    }
    if (plan.status === "failed") {
      add(content, el("p", t("failed"), "notice"));
      return;
    }
    add(content, el("p", t(plan.status) + " · " + t("needsReview"), "notice"));
    var settings = add(content, el("div", null, "fields")),
      grades = [["", text("Таңдаңыз", "Выберите")]];
    for (var i = 1; i <= 11; i++) grades.push([String(i), String(i)]);
    select(
      settings,
      t("grade"),
      grades,
      String(plan.grade || ""),
      function (v) {
        plan.grade = v ? Number(v) : null;
        dirty = true;
      }
    );
    field(settings, t("year"), plan.school_year, "text", function (v) {
      plan.school_year = v;
      dirty = true;
    });
    var skipDates = add(
      actions,
      button(
        datesBeforeSkip
          ? text("Күндерді қайтару", "Вернуть даты")
          : text("Барлық күндерді өткізу", "Пропустить все даты"),
        function () {
          if (datesBeforeSkip) {
            plan.rows.forEach(function (r, i) {
              var old = datesBeforeSkip[i];
              r.dateRaw = old.dateRaw;
              r.dateStart = old.dateStart;
              r.dateEnd = old.dateEnd;
              r.dateSkipped = old.dateSkipped;
              r.warnings = r.warnings
                .filter(function (w) {
                  return w.indexOf("date") < 0;
                })
                .concat(
                  old.warnings.filter(function (w) {
                    return w.indexOf("date") >= 0;
                  })
                );
            });
            datesBeforeSkip = null;
            dirty = true;
            renderPlan();
          } else
            confirmAction(
              text(
                "Барлық сабақ күндерін өткізу керек пе? Сақтағанға дейін қайтаруға болады.",
                "Пропустить даты всех уроков? До сохранения их можно вернуть."
              ),
              function () {
                datesBeforeSkip = JSON.parse(JSON.stringify(plan.rows));
                plan.rows.forEach(function (r) {
                  r.dateRaw = "";
                  r.dateStart = null;
                  r.dateEnd = null;
                  r.dateSkipped = true;
                  r.warnings = r.warnings.filter(function (w) {
                    return w.indexOf("date") < 0;
                  });
                });
                dirty = true;
                renderPlan();
              }
            );
        }
      )
    );
    skipDates.title = text(
      "Барлық беттердегі күндерді өткізу",
      "Пропустить даты на всех страницах"
    );
    function save(confirm) {
      action(
        "ktp/" + plan.id + "/" + (confirm ? "confirm" : "rows"),
        {
          revision: plan.revision,
          rows: plan.rows || [],
          grade: plan.grade,
          schoolYear: plan.school_year || "",
        },
        function () {
          dirty = false;
          openPlan(plan.id);
          note(t("saved"));
        },
        confirm ? "POST" : "PATCH"
      );
    }
    add(
      actions,
      button(t("save"), function () {
        save(false);
      })
    );
    add(
      actions,
      button(
        t("confirm"),
        function () {
          save(true);
        },
        true
      )
    );
    if (plan.status === "confirmed")
      add(
        actions,
        button(
          t("generate"),
          function () {
            leave(function () {
              dirty = false;
              generateForm();
            });
          },
          true
        )
      );
    if (plan.file_id)
      add(
        actions,
        link(t("source"), "/api/uploads/" + encodeURIComponent(plan.file_id))
      );
    var panel = add(content, el("section", null, "panel")),
      rows = plan.rows || [];
    rows.slice(rowPage * 10, rowPage * 10 + 10).forEach(function (r, offset) {
      var section = add(panel, el("section", null, "row"));
      add(
        section,
        el(
          "h2",
          String(rowPage * 10 + offset + 1) + ". " + (r.topic || t("topic"))
        )
      );
      function update(key, value) {
        r[key] = value;
        dirty = true;
        if (r.source) r.source.method = "manual";
      }
      field(section, t("topic"), r.topic, "textarea", function (v) {
        update("topic", v);
      });
      field(section, t("goals"), r.goals, "textarea", function (v) {
        update("goals", v);
      });
      var pair = add(section, el("div", null, "fields"));
      field(pair, t("date"), r.dateRaw, "text", function (v) {
        r.dateSkipped = false;
        update("dateRaw", v);
      });
      field(pair, t("hours"), r.hours, "text", function (v) {
        update("hours", v);
      });
      var details = add(section, el("details"));
      add(details, el("summary", t("source")));
      add(details, el("p", (r.source && r.source.fragment) || "—", "source"));
      if (r.warnings && r.warnings.length)
        add(section, el("p", t("needsReview"), "muted"));
    });
    if (plan.unrecognized && plan.unrecognized.length) {
      var fragments = add(content, el("details", null, "panel"));
      add(
        fragments,
        el(
          "summary",
          text("Танылмаған фрагменттер", "Нераспознанные фрагменты")
        )
      );
      plan.unrecognized.forEach(function (f) {
        add(fragments, el("p", f, "source"));
      });
    }
    var pages = add(content, el("div", null, "pagination"));
    add(
      pages,
      el(
        "span",
        String(rowPage * 10 + 1) +
          "–" +
          Math.min(rows.length, rowPage * 10 + 10) +
          " / " +
          rows.length
      )
    );
    if (rowPage > 0)
      add(
        pages,
        button(t("prev"), function () {
          rowPage--;
          renderPlan();
          window.scrollTo(0, 0);
        })
      );
    if ((rowPage + 1) * 10 < rows.length)
      add(
        pages,
        button(t("next"), function () {
          rowPage++;
          renderPlan();
          window.scrollTo(0, 0);
        })
      );
  }
  function generateForm() {
    clear(t("generate"));
    if (!profile.capabilities.ai) {
      add(content, el("p", t("unavailable"), "notice"));
      return;
    }
    var form = add(content, el("form", null, "panel")),
      rows = plan.rows || [];
    var row = select(
      form,
      t("topic"),
      rows.map(function (r) {
        return [r.id, r.topic];
      }),
      rows.length ? rows[0].id : ""
    );
    var lang = select(
      form,
      t("locale"),
      [
        ["kk", "Қазақша"],
        ["ru", "Русский"],
        ["kk+ru", "Қазақша + Русский"],
      ],
      locale
    );
    var pair = add(form, el("div", null, "fields"));
    var count = field(pair, t("count"), 3, "number");
    count.min = 1;
    count.max = 5;
    var minutes = field(pair, t("minutes"), 30, "number");
    minutes.min = 5;
    minutes.max = 120;
    var format = select(
      form,
      t("format"),
      ["mixed", "theory", "programming", "logic"].map(function (k) {
        return [k, t(k)];
      }),
      "mixed"
    );
    var constraints = field(form, t("constraints"), "", "textarea");
    constraints.maxLength = 2000;
    var submit = add(form, el("button", t("generate"), "primary"));
    submit.type = "submit";
    form.onsubmit = function (e) {
      e.preventDefault();
      action(
        "generations",
        {
          planId: plan.id,
          rowId: row.value,
          revision: plan.revision,
          locale: lang.value,
          count: Number(count.value),
          minutes: Number(minutes.value),
          format: format.value,
          constraints: constraints.value,
        },
        function (g) {
          plan = null;
          openGeneration(g.id);
        }
      );
    };
  }
  function openGeneration(id) {
    leave(function () {
      request(
        "generations/" + encodeURIComponent(id),
        "GET",
        undefined,
        function (err, g) {
          if (err) {
            note(err, true);
            return;
          }
          dirty = false;
          generation = g;
          plan = null;
          renderGeneration();
        }
      );
    });
  }
  function blocks(parent, data) {
    (data || []).forEach(function (b) {
      if (b.type === "paragraph") add(parent, el("p", b.text));
      else if (b.type === "code") add(parent, el("pre", b.text));
      else if (b.type === "list") {
        var ul = add(parent, el("ul"));
        b.items.forEach(function (item) {
          add(ul, el("li", item));
        });
      } else if (b.type === "table") {
        var wrap = add(parent, el("div", null, "table-scroll")),
          table = add(wrap, el("table")),
          head = add(table, el("tr"));
        b.columns.forEach(function (c) {
          add(head, el("th", c));
        });
        b.rows.forEach(function (r) {
          var tr = add(table, el("tr"));
          r.forEach(function (c) {
            add(tr, el("td", c));
          });
        });
      }
    });
  }
  function renderGeneration() {
    clear(generation.title);
    var actions = add(content, el("div", null, "actions"));
    add(
      actions,
      button(t("refresh"), function () {
        openGeneration(generation.id);
      })
    );
    add(
      actions,
      link(
        t("advancedEditor"),
        "/?generation=" + encodeURIComponent(generation.id)
      )
    );
    if (!generation.document) {
      add(content, el("p", t("processing"), "notice"));
      return;
    }
    add(
      content,
      el("p", generation.demo ? t("demo") : t("needs_review"), "notice")
    );
    var audience = select(
      content,
      t("export"),
      [
        ["full", t("full")],
        ["student", t("student")],
      ],
      "full"
    );
    var reviewLabel = add(content, el("label")),
      review = add(reviewLabel, el("input"));
    review.type = "checkbox";
    review.checked = !!generation.reviewed_at;
    review.disabled = !!generation.reviewed_at;
    add(
      reviewLabel,
      document.createTextNode(
        " " +
          text(
            "Тапсырмаларды, жауаптар мен критерийлерді тексердім",
            "Я проверил(а) задания, ответы и критерии"
          )
      )
    );
    add(
      content,
      el(
        "small",
        text(
          "Алдымен тапсырмалар мен жауаптарды тексеріп, мақұлдаңыз. Файлдар содан кейін қолжетімді болады.",
          "Сначала проверьте задания и ответы, затем одобрите их. После этого станут доступны файлы."
        )
      )
    );
    if (!generation.reviewed_at) {
      var approve = add(
        content,
        button(
          text("Тапсырмаларды мақұлдау", "Одобрить задания"),
          function () {
            if (!review.checked) return;
            action(
              "generations/" + generation.id + "/approve",
              { revision: generation.revision, teacherReviewed: true },
              function () {
                openGeneration(generation.id);
              }
            );
          },
          true
        )
      );
      approve.disabled = true;
      review.onchange = function () {
        approve.disabled = !review.checked;
      };
    } else
      add(
        content,
        el("p", text("Мұғалім мақұлдады", "Одобрено учителем"), "notice")
      );
    ["docx", "pdf"].forEach(function (format) {
      var exportButton = add(
        actions,
        button(format.toUpperCase(), function () {
          action(
            "exports",
            {
              generationId: generation.id,
              revision: generation.revision,
              format: format,
              audience: audience.value,
              styles: profile.styles || {},
              teacherReviewed: !!generation.reviewed_at,
            },
            function () {
              go("library");
              note(t("processing"));
            }
          );
        })
      );
      exportButton.disabled = !generation.reviewed_at;
    });
    var panel = add(content, el("section", null, "panel"));
    generation.document.tasks.forEach(function (task, i) {
      var section = add(panel, el("article", null, "task"));
      add(section, el("h2", String(i + 1) + ". " + t(task.level)));
      add(
        section,
        el(
          "small",
          task.points +
            " " +
            text("балл", "баллов") +
            " · " +
            task.estimatedMinutes +
            " " +
            text("минут", "минут")
        )
      );
      blocks(section, task.contentBlocks);
      if (task.translation) {
        var translation = add(section, el("div"));
        blocks(translation, task.translation.contentBlocks);
      }
      var answers = add(section, el("details"));
      add(answers, el("summary", t("answer")));
      blocks(answers, task.answerBlocks);
      add(answers, el("h3", t("how")));
      add(answers, el("p", task.explanationHow));
      add(answers, el("h3", t("why")));
      add(answers, el("p", task.explanationWhy));
      if (task.translation) {
        blocks(answers, task.translation.answerBlocks);
        add(answers, el("p", task.translation.explanationHow));
        add(answers, el("p", task.translation.explanationWhy));
      }
      var criteria = add(answers, el("ul"));
      task.rubric.forEach(function (c) {
        add(criteria, el("li", c.criterion + " — " + c.points));
      });
      add(
        section,
        button(t("edit") + " " + String(i + 1), function () {
          editTask(i);
        })
      );
    });
  }
  function editTask(index) {
    var draft = JSON.parse(JSON.stringify(generation.document.tasks[index]));
    clear(t("edit") + " — " + String(index + 1));
    add(
      content,
      el(
        "p",
        text(
          "Өзгерістер жаңа нұсқа ретінде сақталады. Деңгей мен оқу мақсаты өзгермейді.",
          "Изменения сохранятся новой версией. Уровень и привязка к цели сохраняются."
        ),
        "muted"
      )
    );
    var form = add(content, el("form", null, "panel"));
    function changed() {
      dirty = true;
    }
    function editBlocks(parent, title, data) {
      add(parent, el("h3", title));
      data.forEach(function (block, blockIndex) {
        if (block.type === "table") {
          var frame = add(parent, el("div", null, "table-editor")),
            page = 0;
          function drawTable() {
            frame.textContent = "";
            page = Math.min(
              page,
              Math.max(0, Math.ceil(block.rows.length / 10) - 1)
            );
            var wrap = add(frame, el("div", null, "table-scroll")),
              table = add(wrap, el("table")),
              head = add(table, el("tr"));
            function input(parent, value, label, update) {
              var node = add(parent, el("input"));
              node.value = value;
              node.setAttribute("aria-label", label);
              node.oninput = function () {
                update(node.value);
                changed();
              };
            }
            block.columns.forEach(function (column, col) {
              var th = add(head, el("th"));
              th.scope = "col";
              input(
                th,
                column,
                title +
                  " " +
                  String(blockIndex + 1) +
                  " " +
                  text("баған", "столбец") +
                  " " +
                  String(col + 1),
                function (value) {
                  block.columns[col] = value;
                }
              );
            });
            add(head, el("th", t("remove"))).scope = "col";
            block.rows
              .slice(page * 10, page * 10 + 10)
              .forEach(function (row, offset) {
                var ri = page * 10 + offset,
                  tr = add(table, el("tr"));
                row.forEach(function (cell, ci) {
                  input(
                    add(tr, el("td")),
                    cell,
                    title + " " + String(ri + 1) + ", " + String(ci + 1),
                    function (value) {
                      block.rows[ri][ci] = value;
                    }
                  );
                });
                add(
                  add(tr, el("td")),
                  button(t("remove"), function () {
                    block.rows.splice(ri, 1);
                    changed();
                    drawTable();
                  })
                );
              });
            var controls = add(frame, el("div", null, "actions"));
            if (page > 0)
              add(
                controls,
                button(t("prev"), function () {
                  page--;
                  drawTable();
                })
              );
            if ((page + 1) * 10 < block.rows.length)
              add(
                controls,
                button(t("next"), function () {
                  page++;
                  drawTable();
                })
              );
            if (block.rows.length < 200)
              add(
                controls,
                button(text("Жол қосу", "Добавить строку"), function () {
                  block.rows.push(
                    block.columns.map(function () {
                      return "";
                    })
                  );
                  page = Math.floor((block.rows.length - 1) / 10);
                  changed();
                  drawTable();
                })
              );
            if (block.columns.length < 20)
              add(
                controls,
                button(text("Баған қосу", "Добавить столбец"), function () {
                  block.columns.push("");
                  block.rows.forEach(function (row) {
                    row.push("");
                  });
                  changed();
                  drawTable();
                })
              );
          }
          drawTable();
        } else {
          var input = field(
            parent,
            title + " " + String(blockIndex + 1),
            block.type === "list" ? block.items.join("\n") : block.text,
            "textarea",
            function (value) {
              if (block.type === "list") block.items = value.split("\n");
              else block.text = value;
              changed();
            }
          );
          input.maxLength = 20000;
          if (block.type === "code") input.className = "code-input";
        }
      });
    }
    editBlocks(form, t("condition"), draft.contentBlocks);
    editBlocks(form, t("answer"), draft.answerBlocks);
    field(form, t("how"), draft.explanationHow, "textarea", function (v) {
      draft.explanationHow = v;
      changed();
    });
    field(form, t("why"), draft.explanationWhy, "textarea", function (v) {
      draft.explanationWhy = v;
      changed();
    });
    var pair = add(form, el("div", null, "fields"));
    var points = field(pair, t("points"), draft.points, "number", function (v) {
      draft.points = Number(v);
      changed();
    });
    points.min = 1;
    points.max = 100;
    var minutes = field(
      pair,
      t("minutes"),
      draft.estimatedMinutes,
      "number",
      function (v) {
        draft.estimatedMinutes = Number(v);
        changed();
      }
    );
    minutes.min = 1;
    minutes.max = 120;
    draft.rubric.forEach(function (r, i) {
      var fields = add(form, el("div", null, "fields"));
      field(
        fields,
        t("criterion") + " " + String(i + 1),
        r.criterion,
        "text",
        function (v) {
          r.criterion = v;
          changed();
        }
      );
      var score = field(
        fields,
        t("points") + " " + String(i + 1),
        r.points,
        "number",
        function (v) {
          r.points = Number(v);
          changed();
        }
      );
      score.min = 0;
      score.max = 100;
    });
    if (draft.translation) {
      var translated = add(form, el("section"));
      add(translated, el("h2", text("Орысша нұсқа", "Русская версия")));
      editBlocks(translated, t("condition"), draft.translation.contentBlocks);
      editBlocks(translated, t("answer"), draft.translation.answerBlocks);
      field(
        translated,
        t("how"),
        draft.translation.explanationHow,
        "textarea",
        function (v) {
          draft.translation.explanationHow = v;
          changed();
        }
      );
      field(
        translated,
        t("why"),
        draft.translation.explanationWhy,
        "textarea",
        function (v) {
          draft.translation.explanationWhy = v;
          changed();
        }
      );
      draft.translation.rubric.forEach(function (r, i) {
        field(
          translated,
          t("criterion") + " " + String(i + 1),
          r.criterion,
          "text",
          function (v) {
            r.criterion = v;
            changed();
          }
        );
      });
    }
    var actions = add(form, el("div", null, "actions")),
      save = add(actions, el("button", t("save"), "primary"));
    save.type = "submit";
    add(
      actions,
      button(t("discard"), function () {
        if (leave()) {
          dirty = false;
          renderGeneration();
        }
      })
    );
    form.onsubmit = function (event) {
      event.preventDefault();
      action(
        "generations/" +
          generation.id +
          "/tasks/" +
          encodeURIComponent(draft.id),
        { revision: generation.revision, task: draft },
        function () {
          dirty = false;
          openGeneration(generation.id);
          note(t("saved"));
        },
        "PATCH"
      );
    };
  }
  window.addEventListener("beforeunload", function (e) {
    if (dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  language();
  if (
    ["localhost", "127.0.0.1", "[::1]"].indexOf(window.location.hostname) >= 0
  ) {
    request("public-config", "GET", undefined, function (error, config) {
      localMailbox = !error && config && config.localMailbox === true;
      updateMailPreview();
    });
  }
  if (new URLSearchParams(window.location.search).has("token")) {
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
    request("profile", "GET", undefined, function (error, p) {
      if (error) {
        note(error, true);
        authForm("login");
        return;
      }
      profile = p;
      renderNav();
      var id = new URLSearchParams(window.location.search).get("generation");
      if (id && /^[0-9a-f-]{36}$/i.test(id)) openGeneration(id);
      else render();
    });
  });
})();
