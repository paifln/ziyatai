/* ES5: no framework, storage is optional. */
(function () {
  var theme;
  try {
    theme = localStorage.getItem("ziyatai-theme");
  } catch (e) {
    void e;
  }
  if (theme !== "light" && theme !== "dark")
    theme =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  document.documentElement.setAttribute("data-theme", theme);
  document.addEventListener("DOMContentLoaded", function () {
    var button = document.getElementById("theme-toggle");
    button.onclick = function () {
      theme =
        document.documentElement.getAttribute("data-theme") === "dark"
          ? "light"
          : "dark";
      document.documentElement.setAttribute("data-theme", theme);
      try {
        localStorage.setItem("ziyatai-theme", theme);
      } catch (e) {
        void e;
      }
    };
  });
})();
