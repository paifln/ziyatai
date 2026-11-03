  function openPlan(id) {
    leave(function () {
      invalidateReads();
      var version = viewVersion,
        edits = editVersion;
      pageRead = request(
        "ktp/" + encodeURIComponent(id),
        "GET",
        undefined,
        function (err, p) {
          if (version !== viewVersion) return;
          pageRead = null;
          if (edits !== editVersion) return;
          if (err) {
            note(err, true);
            return;
          }
          dirty = false;
          plan = p;
          classFilter = p.grade ? String(p.grade) : "";
          rowPage = 0;
          datesBeforeSkip = null;
          generation = null;
          renderPlan();
          bindDraft("ktp", true);
        }
      );
    });
  }
  function renderSourceAccess(planId, uploadId) {
    var box = add(content, el("section", null, "panel source-access"));
    box.setAttribute(
      "aria-label",
      locale === "ru" ? "Исходный файл" : "Бастапқы файл"
    );
    var state = null,
      pending = false;
    function valid() {
      return (
        document.documentElement.contains(box) && plan && plan.id === planId
      );
    }
    function draw(error) {
      if (!valid()) return;
      box.textContent = "";
      var ru = locale === "ru";
      if (state && state.available) {
        add(
          box,
          link(t("source"), "/api/uploads/" + encodeURIComponent(uploadId))
        );
        return;
      }
      var checking =
        state &&
        state.job &&
        (state.job.status === "queued" || state.job.status === "running");
      var label = !state
        ? ru
          ? "Проверяем доступность источника…"
          : "Бастапқы файлдың қолжетімділігі тексерілуде…"
        : checking
          ? ru
            ? "Проверяем файл. Уроки и ваши правки сохраняются."
            : "Файл тексерілуде. Сабақтар мен түзетулер сақталады."
          : state.canCheck
            ? ru
              ? "Для исходника нужна повторная проверка. Уроки и задания останутся без изменений."
              : "Бастапқы файлды қайта тексеру қажет. Сабақтар мен тапсырмалар өзгермейді."
            : ru
              ? "Этот исходник недоступен. Загрузите оригинал заново; сохранённые уроки остаются в этом КТП."
              : "Бұл бастапқы файл қолжетімсіз. Түпнұсқаны қайта жүктеңіз; сақталған сабақтар осы КТЖ-да қалады.";
      add(box, el("p", label)).setAttribute("role", "status");
      if (error)
        add(box, el("p", error, "notice error")).setAttribute("role", "alert");
      if (state && state.job && state.job.status === "failed")
        add(
          box,
          el(
            "p",
            ru
              ? "Проверку не удалось завершить. Если файл отклонён, загрузите безопасную копию. Иначе повторите проверку позже."
              : "Тексеру аяқталмады. Файл қабылданбаса, қауіпсіз көшірмені жүктеңіз. Әйтпесе тексеруді кейінірек қайталаңыз.",
            "notice error"
          )
        ).setAttribute("role", "alert");
      if (state && state.canCheck && !checking) {
        var start = add(
          box,
          button(
            ru ? "Проверить исходник" : "Бастапқы файлды тексеру",
            function () {
              act(false);
            }
          )
        );
        start.disabled = pending;
      }
      if (checking) {
        var cancel = add(
          box,
          button(ru ? "Отменить проверку" : "Тексеруді тоқтату", function () {
            act(true);
          })
        );
        cancel.disabled = pending || state.job.cancel_requested;
      }
      var refresh = add(
        box,
        button(ru ? "Обновить состояние файла" : "Файл күйін жаңарту", load)
      );
      refresh.disabled = pending;
    }
    function load() {
      if (!valid()) return;
      if (sourceRead) sourceRead.abort();
      sourceRead = request(
        "ktp/" + encodeURIComponent(planId) + "/source",
        "GET",
        undefined,
        function (error, result) {
          if (!valid()) return;
          if (!error) state = result;
          draw(error);
        }
      );
    }
    function act(cancel) {
      pending = true;
      draw();
      var path = cancel
        ? "jobs/" + encodeURIComponent(state.job.id) + "/cancel"
        : "ktp/" + encodeURIComponent(planId) + "/source";
      request(path, "POST", {}, function (error) {
        if (!valid()) return;
        pending = false;
        if (error) draw(error);
        else load();
      });
    }
    draw();
    load();
  }
