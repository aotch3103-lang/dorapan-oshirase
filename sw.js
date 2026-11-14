/* ドラパン お知らせ受け取り:うしろで待っている係(サービスワーカー)
   Googleの郵便屋さんから「合図」が来たら、お知らせ係(Apps Script)に中身を取りに行って、通知を出します。
   このフォルダ(dorapan-oshirase)の中でだけ働きます。ほかのページには関係ありません。 */

const STORE = "dorapan-oshirase-v1"; // 11/14 版:「受け取ったよ✅」の返事を追加(この名前は変えないでね)
const BASE = self.registration.scope; // https://〜/dorapan-oshirase/

// アプリの名前 → うさぎの絵の名前(icons フォルダの「名前.png」)
const ICONS = { today: "today", makanai: "makanai", gama: "gama", reserve: "reserve", housou: "funakura" };
function iconOf(app) { return BASE + "icons/" + (ICONS[app] || "riichi") + ".png"; }

self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

// ページから合言葉とお知らせ係のURLを受け取って、しまっておく
self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "cfg") e.waitUntil(put("cfg", e.data.cfg));
});

async function put(name, value) {
  const c = await caches.open(STORE);
  await c.put(BASE + "__" + name, new Response(JSON.stringify(value)));
}
async function get(name) {
  const c = await caches.open(STORE);
  const r = await c.match(BASE + "__" + name);
  return r ? r.json() : null;
}

self.addEventListener("push", function (e) { e.waitUntil(onPush()); });

async function onPush() {
  let msgs = [], fetchedOk = false, cfg = null;
  try {
    cfg = await get("cfg");
    const last = (await get("last")) || 0;
    if (cfg && cfg.api && cfg.key) {
      const r = await fetch(cfg.api + "?a=msg&k=" + encodeURIComponent(cfg.key) + "&since=" + last, { cache: "no-store" });
      const j = await r.json();
      msgs = (j && j.msgs) || [];
      fetchedOk = !!(j && j.ok);
    }
  } catch (err) { /* 取りに行けなかったときは、下の「届いたよ」だけ出す */ }

  const hist = (await get("hist")) || [];
  if (msgs.length) {
    // 11/14:とちゅうで眠っても一覧に残るように、通知を出す前にしまっておく(30こまで)
    msgs.forEach(function (m) { if (!hist.some(function (h) { return h.id === m.id; })) hist.push(m); });
    hist.sort(function (x, y) { return x.id - y.id; });
    await put("hist", hist.slice(-30));
    await put("last", Math.max.apply(null, msgs.map(function (m) { return m.id; })));
  }

  if (!msgs.length && fetchedOk) {
    // 新しいものがなかったとき(見張り番のノック):まだ「出せた」と返事していないお知らせがあれば、それを出す
    const m = hist[hist.length - 1];
    const acked = (await get("acked")) || 0;
    if (m) {
      await self.registration.showNotification(m.title, {
        body: m.body, icon: iconOf(m.app),
        badge: BASE + "icons/badge.png", tag: "dorapan-" + m.id,
        silent: m.id <= acked || !!m.silent, data: { id: m.id }
      });
      await ack(cfg, m.id);
      return;
    }
  }
  if (!msgs.length) {
    await self.registration.showNotification("🐰 ドラパン お知らせ", {
      body: "お知らせが届いたよ。開いて見てね",
      icon: BASE + "icons/riichi.png", badge: BASE + "icons/badge.png",
      tag: "dorapan-check", data: { url: BASE }
    });
    return;
  }
  for (const m of msgs) {
    await self.registration.showNotification(m.title, {
      body: m.body,
      icon: iconOf(m.app),
      badge: BASE + "icons/badge.png",
      tag: "dorapan-" + m.id,
      silent: !!m.silent,
      vibrate: m.silent ? undefined : [120, 60, 120],
      data: { id: m.id }
    });
  }
  await ack(cfg, Math.max.apply(null, msgs.map(function (m) { return m.id; })));
  // ページを開いていたら、うさぎを跳ねさせる
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  list.forEach(function (c) { c.postMessage({ type: "pyon", msg: msgs[msgs.length - 1] }); });
}

// 11/14:通知を出せたら、お知らせ係に「受け取ったよ✅」と返事する(見張り番がノックをやめる合図)
async function ack(cfg, id) {
  try {
    await put("acked", id);
    if (cfg && cfg.api && cfg.key) await fetch(cfg.api + "?a=ack&k=" + encodeURIComponent(cfg.key) + "&id=" + id, { cache: "no-store" });
  } catch (err) { /* 返事できなくても、見張り番がもう一回ノックしてくれる */ }
}

// お知らせを押したとき:お知らせアプリを開いて、そのお知らせを大きく見せる
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  const id = (e.notification.data && e.notification.data.id) || "";
  const url = BASE + (id ? "?m=" + id : "");
  e.waitUntil((async function () {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      if (c.url.indexOf(BASE) === 0 && "focus" in c) {
        c.postMessage({ type: "open", id: id });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});