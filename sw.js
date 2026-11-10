/* ドラパン お知らせ受け取り:うしろで待っている係(サービスワーカー)
   Googleの郵便屋さんから「合図」が来たら、お知らせ係(Apps Script)に中身を取りに行って、通知を出します。
   このフォルダ(dorapan-oshirase)の中でだけ働きます。ほかのページには関係ありません。 */

const STORE = "dorapan-oshirase-v1";
const BASE = self.registration.scope; // https://〜/dorapan-oshirase/

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
  let msgs = [];
  try {
    const cfg = await get("cfg");
    const last = (await get("last")) || 0;
    if (cfg && cfg.api && cfg.key) {
      const r = await fetch(cfg.api + "?a=msg&k=" + encodeURIComponent(cfg.key) + "&since=" + last, { cache: "no-store" });
      const j = await r.json();
      msgs = (j && j.msgs) || [];
    }
  } catch (err) { /* 取りに行けなかったときは、下の「届いたよ」だけ出す */ }

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
      icon: BASE + "icons/" + m.app + ".png",
      badge: BASE + "icons/badge.png",
      tag: "dorapan-" + m.id,
      silent: !!m.silent,
      vibrate: m.silent ? undefined : [120, 60, 120],
      data: { url: m.url || BASE }
    });
  }
  await put("last", Math.max.apply(null, msgs.map(function (m) { return m.id; })));
  // ページを開いていたら、うさぎを跳ねさせる
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  list.forEach(function (c) { c.postMessage({ type: "pyon", msg: msgs[msgs.length - 1] }); });
}

// お知らせを押したとき
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || BASE;
  e.waitUntil((async function () {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      if (c.url.split("?")[0] === url.split("?")[0] && "focus" in c) return c.focus();
    }
    return self.clients.openWindow(url);
  })());
});
