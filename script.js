(function () {
  "use strict";

  /* ---- Permanent start: 2026-11-11T17:00:00+06:00 (Asia/Dhaka, no DST) ---- */
  var START_ISO = "2026-11-11T17:00:00+06:00";
  var DHAKA_MS = 6n * 3600000n;                 // fixed UTC+6 offset
  var START_UTC_MS = BigInt(Date.parse(START_ISO));
  var TZ = "Asia/Dhaka";

  /* ---- BigInt calendar helpers (no Date range limit) ---- */
  function fdiv(a, b) { var q = a / b; return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q; }
  function civil(days) {                         // days since 1970-01-01 -> y, m, d
    var z = days + 719468n;
    var era = fdiv(z, 146097n);
    var doe = z - era * 146097n;
    var yoe = (doe - doe / 1460n + doe / 36524n - doe / 146096n) / 365n;
    var y = yoe + era * 400n;
    var doy = doe - (365n * yoe + yoe / 4n - yoe / 100n);
    var mp = (5n * doy + 2n) / 153n;
    var d = doy - (153n * mp + 2n) / 5n + 1n;
    var m = mp < 10n ? mp + 3n : mp - 9n;
    if (m <= 2n) y += 1n;
    return { y: y, m: Number(m), d: Number(d) };
  }
  function parts(utcMs) {                        // wall-clock parts in Asia/Dhaka
    var w = utcMs + DHAKA_MS;
    var days = fdiv(w, 86400000n);
    var rem = Number(w - days * 86400000n);
    var c = civil(days);
    return { y: c.y, mo: c.m, d: c.d,
             h: Math.floor(rem / 3600000), mi: Math.floor(rem / 60000) % 60, s: Math.floor(rem / 1000) % 60 };
  }
  function dim(y, m) {                           // days in month (y is BigInt)
    if (m === 2) { var leap = (y % 4n === 0n && y % 100n !== 0n) || y % 400n === 0n; return leap ? 29 : 28; }
    return [4, 6, 9, 11].indexOf(m) >= 0 ? 30 : 31;
  }
  var S = parts(START_UTC_MS);

  function elapsed(nowUtcMs) {
    if (nowUtcMs <= START_UTC_MS) return { y: 0n, mo: 0, d: 0, h: 0, mi: 0, s: 0 };
    var N = parts(nowUtcMs);
    var y = N.y - S.y, mo = N.mo - S.mo, d = N.d - S.d, h = N.h - S.h, mi = N.mi - S.mi, s = N.s - S.s;
    if (s < 0) { s += 60; mi--; }
    if (mi < 0) { mi += 60; h--; }
    if (h < 0) { h += 24; d--; }
    if (d < 0) {                                  // borrow the length of the month before "now"
      var pm = N.mo - 1, py = N.y; if (pm < 1) { pm = 12; py -= 1n; }
      d += dim(py, pm); mo--;
    }
    if (mo < 0) { mo += 12; y--; }
    return { y: y, mo: mo, d: d, h: h, mi: mi, s: s };
  }

  /* ---- Time synchronisation ---- */
  var KEY = "ringWatch.offset.v1";
  var offset = 0, syncInfo = { state: "none" };
  var $ = function (id) { return document.getElementById(id); };
  var pad = function (n) { return String(n).padStart(2, "0"); };

  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && isFinite(saved.offset)) { offset = saved.offset; syncInfo = { state: "saved", at: saved.at }; }
  } catch (e) {}

  var SOURCES = [
    { name: "worldtimeapi.org", url: "https://worldtimeapi.org/api/timezone/Asia/Dhaka", read: function (j) { return j.unixtime * 1000 + (parseInt(String(j.datetime).split(".")[1], 10) || 0) / 1000 * 0; } },
    { name: "timeapi.io", url: "https://timeapi.io/api/Time/current/zone?timeZone=Asia/Dhaka", read: function (j) { return Date.parse(j.dateTime.split(".")[0] + "+06:00") + (parseInt((j.dateTime.split(".")[1] || "0").slice(0, 3).padEnd(3, "0"), 10)); } }
  ];

  function trySource(i) {
    if (i >= SOURCES.length) { render(); return Promise.resolve(false); }
    var src = SOURCES[i], t0 = Date.now(), ctl = new AbortController();
    var to = setTimeout(function () { ctl.abort(); }, 6000);
    return fetch(src.url, { cache: "no-store", signal: ctl.signal })
      .then(function (r) { if (!r.ok) throw new Error("http"); return r.json(); })
      .then(function (j) {
        clearTimeout(to);
        var t1 = Date.now(), rtt = t1 - t0, server = src.read(j);
        if (!isFinite(server)) throw new Error("bad");
        offset = server + rtt / 2 - t1;
        syncInfo = { state: "live", source: src.name, rtt: rtt, at: t1 };
        try { localStorage.setItem(KEY, JSON.stringify({ offset: offset, at: t1 })); } catch (e) {}
        return true;
      })
      .catch(function () { clearTimeout(to); return trySource(i + 1); });
  }
  function sync() { trySource(0).then(render); }

  function statusText() {
    var el = $("syncStatus");
    if (syncInfo.state === "live") {
      el.className = "sync ok";
      el.textContent = "Synchronized with " + syncInfo.source + " (±" + Math.ceil(syncInfo.rtt / 2) + " ms)";
    } else if (syncInfo.state === "saved") {
      el.className = "sync warn";
      el.textContent = "Offline: using the last verified offset from " +
        new Date(syncInfo.at).toLocaleString("en-GB", { timeZone: TZ }) + ". Not currently verified.";
    } else {
      el.className = "sync warn";
      el.textContent = "Not verified: using this device’s clock. No time source reachable.";
    }
  }

  /* ---- Rendering ---- */
  var fmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  var tfmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  var lastStatus = "";

  function render() {
    var now = Date.now() + offset;
    var e = elapsed(BigInt(Math.floor(now)));
    $("sw-years").textContent = e.y.toString();
    $("sw-months").textContent = String(e.mo);
    $("sw-days").textContent = String(e.d);
    $("sw-hours").textContent = pad(e.h);
    $("sw-minutes").textContent = pad(e.mi);
    $("sw-seconds").textContent = pad(e.s);

    var dt = new Date(now);
    $("clk-date").textContent = fmt.format(dt);
    var p = tfmt.formatToParts(dt), hh = "", mm = "", ss = "", ap = "";
    p.forEach(function (x) { if (x.type === "hour") hh = pad(x.value); if (x.type === "minute") mm = x.value; if (x.type === "second") ss = x.value; if (x.type === "dayPeriod") ap = x.value.toUpperCase(); });
    $("clk-time").textContent = hh + ":" + mm + ":" + ss;
    $("clk-ampm").textContent = ap;

    var st = syncInfo.state + (syncInfo.at || "");
    if (st !== lastStatus) { lastStatus = st; statusText(); }
  }

  function tick() { render(); setTimeout(tick, 1000 - ((Date.now() + offset) % 1000) + 5); }

  sync();
  tick();
  setInterval(sync, 10 * 60 * 1000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { render(); sync(); } });
  window.addEventListener("online", sync);

  /* ---- Photograph: error state + enlarged view ---- */
  var img = $("ringPhoto"), box = $("lightbox"), big = $("bigPhoto");
  img.addEventListener("error", function () {
    $("openPhoto").hidden = true; $("photoError").hidden = false;
  });
  $("openPhoto").addEventListener("click", function () {
    big.src = img.currentSrc || img.src;
    if (box.showModal) box.showModal(); else box.setAttribute("open", "");
  });
  function closeBox() { if (box.close) box.close(); else box.removeAttribute("open"); }
  $("closePhoto").addEventListener("click", closeBox);
  box.addEventListener("click", function (ev) { if (ev.target === box) closeBox(); });
})();
