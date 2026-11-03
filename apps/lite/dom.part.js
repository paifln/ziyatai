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
