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
        ["en", "English"],
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
    var importGrades = [["", t("select")]];
    for (var gradeNumber = 1; gradeNumber <= 11; gradeNumber++)
      importGrades.push([String(gradeNumber), String(gradeNumber)]);
    var importGrade = select(form, t("grade"), importGrades, "");
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
          {
            uploadId: f.id,
            locale: lang.value,
            includeHidden: false,
            grade: importGrade.value ? Number(importGrade.value) : null,
          },
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
            if (!account.track(xhr)) return;
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
              if (!account.finish(xhr)) return;
              if (cancelled) return;
              busy = false;
              unlock();
              note(t("error"), true);
            }
            xhr.onerror = xhr.ontimeout = failed;
            xhr.onload = function () {
              if (!account.finish(xhr)) return;
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
            xhr.onabort = function () {
              account.finish(xhr);
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
