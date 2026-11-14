// Lets the games be installed on a tablet or phone (Add to Home Screen) and played offline.
// Only works when the site is served over http(s); opening the files directly just skips it.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  const root = document.currentScript.src.replace(/app\.js(\?.*)?$/, "");
  navigator.serviceWorker.register(root + "sw.js", { scope: root }).catch(() => {});
}
