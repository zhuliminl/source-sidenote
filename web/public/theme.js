(function () {
  var stored = null;
  try {
    stored = localStorage.getItem("sidenote-theme");
  } catch (e) {}
  var dark =
    stored === "dark" ||
    (stored !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
})();
