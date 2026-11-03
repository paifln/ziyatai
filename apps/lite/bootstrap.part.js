  "use strict";
  var content = document.getElementById("content");
  var datesBeforeSkip = null;
  var sourceRead = null;
  var passwordResetAvailable = false;
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
  var classFilter = "";
  var draftSession = null,
    draftIdentity = "",
    activeTask = null,
    wholeDocumentDirty = false;
  function draftState(kind) {
    if (kind === "ktp")
      return {
        revision: plan.revision,
        stamp: editVersion,
        draft: {
          rows: plan.rows || [],
          grade: plan.grade,
          schoolYear: plan.school_year || "",
        },
      };
    var doc = JSON.parse(JSON.stringify(generation.document));
    if (activeTask) doc.tasks[activeTask.index] = activeTask.draft;
    return { revision: generation.revision, stamp: editVersion, draft: doc };
  }
  function bindDraft(kind, opened) {
    var record = kind === "ktp" ? plan : generation;
    if (!record || (kind === "generation" && !record.document)) return;
    var identity = kind + ":" + record.id;
    if (draftIdentity !== identity) {
      if (draftSession) draftSession.stop();
      draftIdentity = identity;
      draftSession = window.ZiyatLiteDrafts({
        kind: kind,
        id: record.id,
        uuid: uuid,
        request: request,
        text: text,
        language: function () {
          return locale;
        },
        get: function () {
          return draftState(kind);
        },
        dirty: function () {
          return dirty;
        },
        canWrite: function () {
          return !busy;
        },
        confirm: confirmAction,
        lock: function () {
          busy = true;
          var release = lockControls();
          return function () {
            busy = false;
            release();
          };
        },
        snapshot: function (value) {
          return {
            revision: value.revision,
            record: value,
            draft:
              kind === "ktp"
                ? {
                    rows: value.rows || [],
                    grade: value.grade,
                    schoolYear: value.school_year || "",
                  }
                : value.document,
          };
        },
        apply: function (latest, merged, keepDirty) {
          activeTask = null;
          dirty = keepDirty;
          editVersion++;
          note("");
          if (kind === "ktp") {
            plan = latest.record;
            plan.rows = merged.rows;
            plan.grade = merged.grade;
            plan.school_year = merged.schoolYear;
            rowPage = 0;
            classFilter = "";
            datesBeforeSkip = null;
            renderPlan();
          } else {
            generation = latest.record;
            generation.document = merged;
            if (keepDirty) generation.reviewed_at = null;
            wholeDocumentDirty = keepDirty;
            renderGeneration();
          }
          var heading = content.querySelector("h1");
          heading.tabIndex = -1;
          heading.focus();
        },
      });
    }
    if (opened) draftSession.baseline(draftState(kind));
    var host =
      content.querySelector(".draft-recovery") ||
      el("section", null, "draft-recovery");
    host.setAttribute(
      "aria-label",
      text("Сақтық нобайлар", "Резервные черновики")
    );
    content.insertBefore(host, content.children[1] || null);
    draftSession.mount(host);
  }
  var viewVersion = 0,
    editVersion = 0,
    pageRead = null;
  function changed() {
    dirty = true;
    editVersion++;
    updatePlanAction();
    if (draftSession) draftSession.changed();
  }
  function updatePlanAction() {
    var create = document.querySelector("[data-confirmed-plan]");
    var hint = document.getElementById("plan-generation-warning");
    var unavailable = dirty || !plan || plan.status !== "confirmed";
    if (create) create.disabled = busy || unavailable;
    if (hint) hint.hidden = !unavailable;
    var confirm = document.getElementById("confirm-plan");
    if (confirm && plan) {
      var rows = plan.rows || [],
        missing = incompletePlanRows();
      confirm.disabled = busy || !rows.length || missing.length > 0;
      var summary = document.getElementById("plan-readiness");
      if (summary)
        summary.textContent = missing.length
          ? text("Толтырылмаған жолдар: ", "Строки с пропусками: ") +
            missing.length +
            " / " +
            rows.length
          : text(
              "Міндетті өрістер толтырылған. Мазмұнды түпнұсқамен салыстырыңыз.",
              "Обязательные поля заполнены. Сверьте содержание с исходником."
            );
      var jump = document.getElementById("first-plan-issue");
      if (jump) jump.disabled = busy || !missing.length;
    }
  }
  function incompletePlanRows() {
    return ((plan && plan.rows) || []).filter(function (row) {
      return (
        !row.topic.trim() ||
        !window.ZiyatCurriculum.hasRequiredGoals(row) ||
        !gradeOf(row)
      );
    });
  }
  function invalidateReads() {
    if (sourceRead) {
      sourceRead.abort();
      sourceRead = null;
    }
    viewVersion++;
    if (pageRead) {
      pageRead.abort();
      pageRead = null;
    }
  }
  function gradeOf(r) {
    if (r.grade) return Number(r.grade);
    var sheet = (r.source && r.source.sheet) || "";
    var range = /\d\s*[-–]\s*\d{1,2}\s*(?:класс|сынып)/i.test(sheet);
    var found =
      !range &&
      (sheet.match(
        /(?:^|[^А-ЯӘҒҚҢӨҰҮҺІA-Z0-9])(1[01]|[1-9])\s*[-–]?\s*(?:класс(?:а|ы)?|сынып)(?=$|[^А-ЯӘҒҚҢӨҰҮҺІA-Z])/i
      ) ||
        sheet.match(/(?:класс|сынып)\s*[:№-]?\s*(1[01]|[1-9])(?!\d)/i) ||
        sheet.match(/^\s*(1[01]|[1-9])\s*[А-ЯӘҒҚҢӨҰҮҺІA-Z]?\s*$/i));
    return found ? Number(found[1]) : (plan && plan.grade) || null;
  }
  var rowPage = 0,
    listOffset = 0,
    dirty = false,
    busy = false;
  var listQueries = { ktp: "", history: "", library: "" },
    listStatus = "";
  var requestKeys = {};
  var account = window.ZiyatLiteAccount({
    request: request,
    changed: function () {
      dirty = false;
      busy = false;
      if (draftSession) draftSession.stop();
      draftSession = null;
      invalidateReads();
      user = profile = plan = generation = activeTask = null;
      datesBeforeSkip = null;
      requestKeys = {};
      navigation.textContent = content.textContent = message.textContent = "";
      var dialogs = document.querySelectorAll("dialog");
      for (var i = 0; i < dialogs.length; i++)
        dialogs[i].parentNode.removeChild(dialogs[i]);
      window.location.replace("/lite/");
    },
  });
