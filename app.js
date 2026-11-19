/* 서울 자전거 편의 지도 - 화면 */
(function () {
  "use strict";
  const E = window.BikeEngine, CFG = window.BIKE_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const ROUTES = [
    { id: "best", name: "가장 편한 경로", short: "가장 편한", color: "#2f9e44", lam: () => 2 },
    { id: "mine", name: "내 경로", short: "내 경로", color: "#f08c00", lam: () => S.pct / 100 },
    { id: "fast", name: "최단 시간 경로", short: "최단 시간", color: "#1c7ed6", lam: () => 0 },
  ];
  const RI = Object.fromEntries(ROUTES.map((r) => [r.id, r]));
  const ARROW = { "출발": "●", "도착": "⚑", "직진": "↑", "좌회전": "↰", "우회전": "↱", "약간 좌측": "↖", "약간 우측": "↗", "유턴": "↶" };
  const isPC = () => window.matchMedia("(min-width: 900px)").matches;
  const rgb = (h, a = 255) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}<small>시간</small> ${Math.round(m % 60)}` : `${Math.round(m)}`);

  const S = {
    g: null, places: [], stops: [null, null], pct: 70, routes: null, info: {}, sel: "mine",
    mode3d: false, comfort: false, tab: "sum", nav: null, sheet: "hidden", active: null, pick: null,
    myLoc: null, favs: [],
  };
  try { S.favs = JSON.parse(localStorage.getItem("bike_favs") || "[]"); } catch (e) { S.favs = []; }

  // ================= 지도 =================
  const map = new maplibregl.Map({
    container: "map", style: CFG.mapStyle, center: [126.978, 37.5665], zoom: 11,
    attributionControl: { compact: true }, maxPitch: 0, dragRotate: true, pitchWithRotate: false,
  });
  map.touchPitch.disable();
  let styleOk = false;
  map.on("styledata", () => { if (!styleOk && map.isStyleLoaded()) { styleOk = true; koreanLabels(); } });
  map.on("error", (e) => { if (!styleOk && /style|tiles|Failed to fetch/i.test(String(e.error && e.error.message))) useRaster(); });
  setTimeout(() => { if (!styleOk) useRaster(); }, 8000);
  function useRaster() {
    if (styleOk) return; styleOk = true;
    map.setStyle({ version: 8, sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256,
      attribution: "© OpenStreetMap" } }, layers: [{ id: "osm", type: "raster", source: "osm" }] });
  }
  function koreanLabels() {
    for (const ly of map.getStyle().layers || []) {
      if (ly.type !== "symbol") continue;
      const tf = map.getLayoutProperty(ly.id, "text-field");
      if (tf && JSON.stringify(tf).includes("name")) map.setLayoutProperty(ly.id, "text-field", ["coalesce", ["get", "name:ko"], ["get", "name"]]);
    }
  }
  const overlay = new deck.MapboxOverlay({ interleaved: false, layers: [] });
  map.addControl(overlay);

  // 나침반
  const needle = $("#needle"), dirlabel = $("#dirlabel");
  const DIRS = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
  function updCompass() {
    const b = ((map.getBearing() % 360) + 360) % 360;
    needle.setAttribute("transform", `rotate(${-b})`);
    const r = $("#btn-compass").getBoundingClientRect();
    dirlabel.style.top = r.top + r.height / 2 - 8 + "px";
    dirlabel.style.right = window.innerWidth - r.left + 6 + "px";
    dirlabel.textContent = `${DIRS[Math.round(b / 45) % 8]} ${Math.round(b)}°`;
  }
  map.on("rotate", updCompass);
  $("#btn-compass").onclick = () => map.easeTo({ bearing: 0, duration: 500 });
  $("#btn-zin").onclick = () => map.zoomIn();
  $("#btn-zout").onclick = () => map.zoomOut();
  $("#btn-3d").onclick = () => set3d(!S.mode3d);
  $("#btn-comfort").onclick = () => { S.comfort = !S.comfort; $("#btn-comfort").classList.toggle("on", S.comfort); draw(); if (S.comfort && S.routes) toast("선택한 경로를 불편도 색으로 보여줘요"); };
  $("#btn-loc").onclick = () => locate(false);

  function set3d(on) {
    S.mode3d = on;
    $("#btn-3d").textContent = on ? "2.5D" : "2D";
    $("#btn-3d").classList.toggle("on", on);
    if (on) { map.setMaxPitch(50); map.easeTo({ pitch: 50, duration: 500 }); setTimeout(() => map.setMinPitch(50), 520); }
    else { map.setMinPitch(0); map.easeTo({ pitch: 0, duration: 400 }); setTimeout(() => map.setMaxPitch(0), 420); }
    draw();
  }

  // ================= 길게 누르기 / 클릭 메뉴 =================
  let lpTimer = null, lpStart = null, popup = null;
  map.on("touchstart", (e) => {
    if (e.originalEvent.touches.length !== 1) return;
    lpStart = e.point; clearTimeout(lpTimer);
    lpTimer = setTimeout(() => showMenu(e.lngLat), 550);
  });
  map.on("touchmove", (e) => { if (lpStart && Math.hypot(e.point.x - lpStart.x, e.point.y - lpStart.y) > 10) clearTimeout(lpTimer); });
  map.on("touchend", () => clearTimeout(lpTimer));
  map.on("contextmenu", (e) => showMenu(e.lngLat));
  map.on("click", (e) => {
    if (S.pick !== null) { setStop(S.pick, e.lngLat.lat, e.lngLat.lng, "지도에서 선택"); endPick(); return; }
    if (!S.stops[0] || !S.stops[S.stops.length - 1]) showMenu(e.lngLat);
  });
  function showMenu(ll) {
    if (popup) popup.remove();
    const div = document.createElement("div");
    div.className = "menu";
    div.innerHTML = `<button class="o">출발</button>${S.stops.length < 5 ? '<button class="w">경유</button>' : ""}<button class="d">도착</button>`;
    div.querySelector(".o").onclick = () => { setStop(0, ll.lat, ll.lng, "지도에서 선택"); popup.remove(); };
    div.querySelector(".d").onclick = () => { setStop(S.stops.length - 1, ll.lat, ll.lng, "지도에서 선택"); popup.remove(); };
    const w = div.querySelector(".w");
    if (w) w.onclick = () => { S.stops.splice(S.stops.length - 1, 0, null); setStop(S.stops.length - 2, ll.lat, ll.lng, `경유지 ${S.stops.length - 2}`); popup.remove(); };
    popup = new maplibregl.Popup({ closeButton: false, offset: 8 }).setLngLat(ll).setDOMContent(div).addTo(map);
  }
  function startPick(i) {
    S.pick = i; hideSuggest();
    const name = i === 0 ? "출발지" : i === S.stops.length - 1 ? "도착지" : "경유지";
    const bar = $("#pickbar");
    bar.innerHTML = `지도를 눌러 ${name}를 정해 주세요 <button>취소</button>`;
    bar.hidden = false; bar.querySelector("button").onclick = endPick;
    if (!isPC()) setSheet("peek");
  }
  function endPick() { S.pick = null; $("#pickbar").hidden = true; }

  // ================= 출발·경유·도착 입력 =================
  function renderStops() {
    const n = S.stops.length, el = $("#stops");
    el.innerHTML = "";
    S.stops.forEach((p, i) => {
      const kind = i === 0 ? "o" : i === n - 1 ? "d" : "w";
      const row = document.createElement("div");
      row.className = "stop";
      row.innerHTML = `<div class="dot ${kind}">${kind === "o" ? "출" : kind === "d" ? "도" : i}</div>
        <input type="text" autocomplete="off" enterkeyhint="search" placeholder="${kind === "o" ? "출발지 검색" : kind === "d" ? "도착지 검색" : "경유지 검색"}" value="${p ? esc(p.label) : ""}">
        ${kind === "w" ? '<button class="x" title="경유지 삭제">✕</button>' : p ? '<button class="x" title="지우기">✕</button>' : ""}`;
      const inp = row.querySelector("input");
      inp.onfocus = () => { S.active = i; inp.select(); showSuggest(""); if (!isPC()) setSheet("peek"); };
      inp.oninput = () => showSuggest(inp.value);
      inp.onkeydown = (ev) => {
        if (ev.key === "Enter") { const first = $("#suggest .sg"); if (first) first.click(); }
        if (ev.key === "Escape") { inp.blur(); hideSuggest(); }
      };
      const x = row.querySelector(".x");
      if (x) x.onclick = () => {
        if (kind === "w") S.stops.splice(i, 1); else S.stops[i] = null;
        stopsChanged();
      };
      el.appendChild(row);
    });
    const acts = document.createElement("div");
    acts.className = "stop-actions";
    acts.innerHTML = `<button class="iconbtn" id="swap" title="출발·도착 바꾸기">⇅</button>${n < 5 ? '<button class="iconbtn" id="addw" title="경유지 추가">＋</button>' : ""}`;
    el.appendChild(acts);
    el.classList.add("has-actions");
    acts.querySelector("#swap").onclick = () => { S.stops.reverse(); stopsChanged(); };
    const aw = acts.querySelector("#addw");
    if (aw) aw.onclick = () => { S.stops.splice(n - 1, 0, null); renderStops(); const ins = $("#stops").querySelectorAll("input"); ins[n - 1].focus(); };
  }

  function showSuggest(q) {
    const box = $("#suggest"), i = S.active;
    if (i === null) return;
    const items = [];
    if (!q.trim()) {
      items.push({ ic: "📍", nm: "현재 위치", ds: "GPS로 내 위치 사용", act: () => locate(true, i) });
      items.push({ ic: "🗺️", nm: "지도에서 선택", ds: "지도를 눌러 위치 지정", act: () => startPick(i) });
      if (!S.stops[0] && !S.stops[S.stops.length - 1]) items.push({ ic: "✨", nm: "예시 경로 보기", ds: `${CFG.example[0].label} → ${CFG.example[1].label}`, act: example });
      for (const f of S.favs) items.push({ ic: "⭐", nm: f.name, ds: "자주 가는 곳", act: () => setStop(i, f.lat, f.lon, f.name), del: f });
    } else {
      for (const p of E.search(S.places, q)) items.push({ ic: icon(p[1]), nm: p[0], ds: `${p[1]} · ${p[2]}`, act: () => setStop(i, p[3], p[4], p[0]) });
      items.push({ ic: "🗺️", nm: "지도에서 직접 선택", ds: "검색에 없으면 지도를 눌러 주세요", act: () => startPick(i) });
    }
    box.innerHTML = "";
    if (q.trim() && items.length === 1) box.insertAdjacentHTML("beforeend", '<div class="sg-empty">검색 결과가 없어요.</div>');
    for (const it of items) {
      const d = document.createElement("div");
      d.className = "sg";
      d.innerHTML = `<div class="ic">${it.ic}</div><div style="flex:1;min-width:0"><div class="nm">${esc(it.nm)}</div><div class="ds">${esc(it.ds)}</div></div>${it.del ? '<button class="x" title="삭제" style="border:0;background:none;color:#9ca3af">✕</button>' : ""}`;
      d.onmousedown = (ev) => ev.preventDefault();
      d.onclick = (ev) => {
        if (ev.target.closest(".x")) { S.favs = S.favs.filter((f) => f !== it.del); saveFavs(); showSuggest(q); return; }
        hideSuggest(); it.act();
      };
      box.appendChild(d);
    }
    box.hidden = false;
  }
  function hideSuggest() { $("#suggest").hidden = true; S.active = null; if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }
  document.addEventListener("mousedown", (ev) => { if (!ev.target.closest("#top")) { $("#suggest").hidden = true; S.active = null; } });
  document.addEventListener("touchstart", (ev) => { if (!ev.target.closest("#top")) { $("#suggest").hidden = true; S.active = null; } }, { passive: true });
  const icon = (k) => ({ 역: "🚉", 공원: "🌳", 대학: "🎓", 병원: "🏥", 시장: "🛒", 쇼핑: "🛍️", 명소: "📸", 동네: "🏘️" }[k] || "📍");

  function setStop(i, lat, lon, label) {
    S.stops[i] = { lat: +lat, lon: +lon, label };
    stopsChanged();
  }
  function stopsChanged() { S.nav = null; renderStops(); compute(true); }
  function example() {
    S.stops = [Object.assign({}, CFG.example[0]), Object.assign({}, CFG.example[1])];
    stopsChanged();
  }

  // ================= 현재 위치 =================
  let meMarker = null;
  function locate(asStop, idx) {
    if (!navigator.geolocation) return toast("이 브라우저는 위치 기능을 지원하지 않아요.");
    toast("위치를 확인하고 있어요…");
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      S.myLoc = { lat, lon };
      if (!meMarker) { const el = document.createElement("div"); el.className = "me"; meMarker = new maplibregl.Marker({ element: el }); }
      meMarker.setLngLat([lon, lat]).addTo(map);
      if (asStop) setStop(idx, lat, lon, "내 위치");
      else map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 15) });
      hideToast();
    }, () => toast("위치를 가져오지 못했어요. 브라우저 위치 권한을 확인해 주세요."), { enableHighAccuracy: true, timeout: 10000 });
  }

  // ================= 경로 계산 =================
  function compute(fit) {
    const pts = S.stops;
    clearMarkers(); drawMarkers();
    if (!pts[0] || !pts[pts.length - 1] || pts.some((p) => !p)) {
      S.routes = null; draw(); renderSheet(); setSheet("peek"); writeHash(); return;
    }
    const P = pts.map((p) => [p.lat, p.lon]);
    const routes = {};
    for (const r of ROUTES) {
      const rt = E.route(S.g, P, r.lam());
      if (!rt) { S.routes = null; draw(); renderSheet(); toast("경로를 찾지 못했어요. 지점을 도로 가까이로 옮겨 보세요."); return; }
      routes[r.id] = rt;
    }
    S.routes = routes;
    S.info = {};
    for (const r of ROUTES) {
      const rt = routes[r.id];
      S.info[r.id] = { stats: E.stats(S.g, rt), coords: E.coords(S.g, rt) };
    }
    const far = routes.mine.snapped.map((s) => s.dist).filter((d) => d > 300);
    if (far.length) toast(`선택한 지점이 가장 가까운 도로에서 ${Math.round(Math.max(...far))}m 떨어져 있어요.`);
    draw(); renderSheet();
    if (S.sheet === "hidden") setSheet("peek");
    if (fit) fitRoutes();
    writeHash();
  }

  function recomputeMine() {
    if (!S.routes) return;
    const P = S.stops.map((p) => [p.lat, p.lon]);
    const rt = E.route(S.g, P, S.pct / 100);
    if (!rt) return;
    S.routes.mine = rt;
    S.info.mine = { stats: E.stats(S.g, rt), coords: E.coords(S.g, rt) };
    draw(); renderCards(); renderDetail(); writeHash();
  }

  function fitRoutes() {
    if (!S.routes) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of ROUTES) for (const [x, y] of S.info[r.id].coords) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const pad = isPC() ? { top: 60, bottom: 60, left: 60, right: 80 }
      : { top: $("#top").getBoundingClientRect().bottom + 20, bottom: (parseInt(getComputedStyle($("#sheet")).getPropertyValue("--peek")) || 168) + 24, left: 30, right: 66 };
    map.fitBounds([[x0, y0], [x1, y1]], { padding: pad, duration: 700, bearing: map.getBearing(), pitch: map.getPitch() });
  }

  // ================= 지도 그리기 =================
  const markers = [];
  let curMarker = null;
  function clearMarkers() { while (markers.length) markers.pop().remove(); }
  function drawMarkers() {
    const n = S.stops.length;
    S.stops.forEach((p, i) => {
      if (!p) return;
      const kind = i === 0 ? "o" : i === n - 1 ? "d" : "w";
      const el = document.createElement("div");
      el.className = `mk ${kind}`;
      el.innerHTML = `<div class="pin"><span>${kind === "o" ? "출발" : kind === "d" ? "도착" : i}</span></div>`;
      const m = new maplibregl.Marker({ element: el, anchor: "bottom", draggable: true, offset: [7, 0] }).setLngLat([p.lon, p.lat]).addTo(map);
      m.on("dragend", () => { const ll = m.getLngLat(); S.stops[i] = { lat: ll.lat, lon: ll.lng, label: "선택한 위치" }; stopsChanged(); });
      markers.push(m);
    });
  }

  function draw() {
    const layers = [];
    if (S.routes) {
      const g = S.g, ex = S.mode3d && S.nav === null ? 2 : 0;
      let zmin = Infinity;
      if (ex) for (const r of ROUTES) for (const n of S.routes[r.id].nodes) zmin = Math.min(zmin, g.z[n]);
      const order = ["fast", "mine", "best"].filter((id) => id !== S.sel).concat([S.sel]);
      const path = (id) => (ex ? E.path3d(g, S.routes[id], ex, zmin) : S.info[id].coords);
      for (const id of order) {
        const r = RI[id], sel = id === S.sel;
        const data = [{ id, path: path(id) }];
        layers.push(new deck.PathLayer({
          id: `case-${id}`, data, getPath: (d) => d.path, getColor: [255, 255, 255, sel ? 255 : 200],
          getWidth: sel ? 11 : 7, widthUnits: "pixels", capRounded: true, jointRounded: true,
        }));
        if (sel && S.comfort) {
          const segs = E.segments(g, S.routes[id]).map((s) => ({ ...s, path: ex ? lift(s.path, id, ex, zmin) : s.path }));
          layers.push(new deck.PathLayer({
            id: `comfort-${id}`, data: segs, getPath: (d) => d.path, getColor: (d) => rgb(d.color), getWidth: 7,
            widthUnits: "pixels", capRounded: true, jointRounded: true, pickable: true, onClick: () => select(id),
          }));
        } else {
          layers.push(new deck.PathLayer({
            id: `route-${id}`, data, getPath: (d) => d.path, getColor: rgb(r.color, sel ? 255 : (S.comfort ? 110 : 170)),
            getWidth: sel ? 7 : 4, widthUnits: "pixels", capRounded: true, jointRounded: true, pickable: true, onClick: () => select(id),
          }));
        }
      }
    }
    overlay.setProps({ layers });
  }
  // 불편도 구간(2D 좌표)에 높이를 붙임: 같은 경로의 3D 좌표에서 가장 가까운 점의 높이 사용
  function lift(path2d, id, ex, zmin) {
    const p3 = E.path3d(S.g, S.routes[id], ex, zmin), key = new Map();
    for (const p of p3) key.set(p[0].toFixed(6) + "," + p[1].toFixed(6), p[2]);
    return path2d.map((p) => [p[0], p[1], key.get(p[0].toFixed(6) + "," + p[1].toFixed(6)) || 3]);
  }

  function select(id) {
    if (S.sel === id) { if (!isPC() && S.sheet === "peek") setSheet("full"); return; }
    S.sel = id; S.nav = null; draw(); renderCards(); renderDetail();
  }

  // ================= 아래 시트 =================
  function setSheet(st) {
    S.sheet = st;
    $("#sheet").className = st;
    placeFabs();
  }
  // 모바일: 오른쪽 버튼들을 아래 시트 바로 위에 두기
  function placeFabs() {
    const f = $("#fabs");
    if (isPC()) { f.style.cssText = ""; updCompass(); return; }
    const peek = parseInt(getComputedStyle($("#sheet")).getPropertyValue("--peek")) || 168;
    const bottom = S.sheet === "hidden" ? 24 : peek + 14;
    f.style.top = "auto"; f.style.transform = "none"; f.style.bottom = bottom + "px";
    setTimeout(updCompass, 30);
  }
  $("#handle").onclick = () => setSheet(S.sheet === "full" ? "peek" : "full");
  (function dragSheet() {
    let y0 = null;
    const h = $("#handle");
    h.addEventListener("touchstart", (e) => { y0 = e.touches[0].clientY; }, { passive: true });
    h.addEventListener("touchend", (e) => {
      if (y0 === null) return;
      const dy = e.changedTouches[0].clientY - y0; y0 = null;
      if (dy < -25) setSheet("full"); else if (dy > 25) setSheet("peek");
    });
  })();

  function renderSheet() {
    const body = $("#sheet-body");
    if (!S.routes) {
      body.innerHTML = `<div class="empty">출발지와 도착지를 정하면 <b>세 가지 경로</b>를 비교해 드려요.<br>
        · 위 검색창에서 장소를 검색하거나<br>· 지도를 <b>꾹 누르면</b>(PC는 오른쪽 클릭) 출발·도착을 바로 정할 수 있어요.</div>
        <div class="btnrow"><button class="btn primary" id="ex">✨ 예시 경로 보기 (${esc(CFG.example[0].label)} → ${esc(CFG.example[1].label)})</button></div>
        <div class="foot">🚫 주행 중 조작 금지 · 출발 전 경로 숙지용 · 데이터: OpenStreetMap 기여자, 서울시 고도 자료, 국가기본도 자전거도로</div>`;
      body.querySelector("#ex").onclick = example;
      requestAnimationFrame(() => { $("#sheet").style.setProperty("--peek", Math.min(body.scrollHeight + 26, window.innerHeight * 0.4) + "px"); placeFabs(); });
      return;
    }
    body.innerHTML = '<div id="nav"></div><div class="cards" id="cards"></div><div class="detail" id="detail"></div>';
    renderCards(); renderDetail();
  }

  function sameAs(id) {
    const order = ["best", "mine", "fast"], a = S.routes[id].edges;
    for (const o of order.slice(0, order.indexOf(id))) {
      const b = S.routes[o].edges;
      if (a.length === b.length && a.every((e, i) => e === b[i])) return RI[o].short;
    }
    return null;
  }

  function renderCards() {
    const el = $("#cards");
    if (!el) return;
    el.innerHTML = "";
    for (const r of ROUTES) {
      const s = S.info[r.id].stats, same = sameAs(r.id);
      const b = document.createElement("button");
      b.className = "card" + (r.id === S.sel ? " sel" : "");
      b.style.setProperty("--c", r.color);
      b.innerHTML = `<div class="nm">${r.name}</div>
        <div class="tm">${fmtMin(s.min)}<small>분</small></div>
        <div class="km">${s.km.toFixed(1)}km</div>
        <div class="ex">${same ? `<span class="same">=${same}</span>` : `큰길 ${Math.round(s.big)}% · 자전거길 ${Math.round(s.infra)}%`}</div>`;
      b.onclick = () => select(r.id);
      el.appendChild(b);
    }
    const peek = el.getBoundingClientRect().height + 22 + 8 + ($("#nav").offsetHeight || 0);
    $("#sheet").style.setProperty("--peek", peek + "px");
    placeFabs();
  }

  function renderDetail() {
    const el = $("#detail");
    if (!el) return;
    renderNav();
    const r = RI[S.sel], s = S.info[S.sel].stats, rt = S.routes[S.sel];
    let h = `<div class="dhead"><h3 style="color:${r.color}">${r.name}</h3><span class="meta">편안함 비중 ${S.sel === "mine" ? S.pct : S.sel === "best" ? 200 : 0}%</span></div>`;
    if (S.sel === "mine") {
      h += `<div class="slider"><div class="lab"><span>편안함 비중</span><b id="pctv">${S.pct}%</b></div>
        <input type="range" id="pct" min="0" max="100" step="10" value="${S.pct}">
        <div class="ends"><span>빠른 길</span><span>편한 길</span></div></div>`;
    }
    const tabs = [["sum", "요약"], ["prof", "경사"], ["steps", "길안내"], ["save", "저장"]];
    h += `<div class="seg">${tabs.map(([k, v]) => `<button data-t="${k}" class="${S.tab === k ? "on" : ""}">${v}</button>`).join("")}</div><div id="tab"></div>`;
    el.innerHTML = h;
    el.querySelectorAll(".seg button").forEach((b) => (b.onclick = () => { S.tab = b.dataset.t; renderDetail(); }));
    const pct = el.querySelector("#pct");
    if (pct) {
      pct.oninput = () => { $("#pctv").textContent = pct.value + "%"; };
      pct.onchange = () => { S.pct = +pct.value; recomputeMine(); };
    }
    const tab = el.querySelector("#tab");
    if (S.tab === "sum") tab.innerHTML = sumTab(s, rt);
    if (S.tab === "prof") tab.innerHTML = profTab();
    if (S.tab === "steps") stepsTab(tab, rt);
    if (S.tab === "save") saveTab(tab, rt);
    if (S.tab === "sum") tab.querySelector("#cmf").onclick = () => $("#btn-comfort").click();
  }

  function sumTab(s, rt) {
    const share = E.binShare(S.g, rt);
    const stat = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    return `<div class="grid">
      ${stat("거리", s.km.toFixed(1) + "km")}${stat("예상 시간", Math.round(s.min) + "분")}${stat("오르막", Math.round(s.up) + "m")}${stat("최대 경사", s.maxGrade.toFixed(0) + "%")}
      ${stat("자전거길", Math.round(s.infra) + "%")}${stat("큰길", Math.round(s.big) + "%")}${stat("편안함", (s.comfort >= 0 ? "+" : "") + s.comfort.toFixed(1))}${stat("터널", s.tunnels + "곳")}
      </div>
      <div class="share">${share.map((p, i) => (p > 0 ? `<div title="${E.BINS[i][2]} ${p.toFixed(0)}%" style="width:${p}%;background:${E.BINS[i][1]}"></div>` : "")).join("")}</div>
      <div class="legend">${share.map((p, i) => (p >= 0.5 ? `<span><i style="background:${E.BINS[i][1]}"></i>${E.BINS[i][2]} ${p.toFixed(0)}%</span>` : "")).join("")}</div>
      <div class="btnrow"><button class="btn" id="cmf">🎨 ${S.comfort ? "경로 색으로 보기" : "지도에 불편도 색으로 보기"}</button></div>
      <div class="note">편안함 점수 = 경사 35% + 도로 유형 30% + 교통(차로·속도) 15% + 포장 10% + 터널·통로 10%</div>`;
  }

  function profTab() {
    const W = 600, H = 190, L = 34, B = 22, T = 10, R = 8;
    const pr = Object.fromEntries(ROUTES.map((r) => [r.id, E.profile(S.g, S.routes[r.id])]));
    let dmax = 0, zmin = Infinity, zmax = -Infinity;
    for (const r of ROUTES) { const p = pr[r.id]; dmax = Math.max(dmax, p.d[p.d.length - 1]); for (const z of p.z) { zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); } }
    zmin = Math.floor(zmin / 10) * 10; zmax = Math.max(zmin + 10, Math.ceil(zmax / 10) * 10);
    const X = (d) => L + (d / (dmax || 1)) * (W - L - R), Y = (z) => H - B - ((z - zmin) / (zmax - zmin)) * (H - B - T);
    let g = "";
    for (let k = 0; k <= 4; k++) { const z = zmin + ((zmax - zmin) * k) / 4, y = Y(z); g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#eef0f3"/><text x="${L - 4}" y="${y + 4}" font-size="11" text-anchor="end" fill="#9ca3af">${Math.round(z)}</text>`; }
    for (let k = 0; k <= 5; k++) { const d = (dmax * k) / 5; g += `<text x="${X(d)}" y="${H - 6}" font-size="11" text-anchor="middle" fill="#9ca3af">${d.toFixed(d < 10 ? 1 : 0)}km</text>`; }
    const order = ["fast", "mine", "best"].filter((id) => id !== S.sel).concat([S.sel]);
    for (const id of order) {
      const p = pr[id], pts = p.d.map((d, i) => `${X(d).toFixed(1)},${Y(p.z[i]).toFixed(1)}`).join(" ");
      g += `<polyline points="${pts}" fill="none" stroke="${RI[id].color}" stroke-width="${id === S.sel ? 3.5 : 2}" stroke-opacity="${id === S.sel ? 1 : 0.55}" stroke-linejoin="round"/>`;
    }
    const legend = ROUTES.map((r) => { const s = S.info[r.id].stats; return `<span><i style="background:${r.color}"></i>${r.short} 오르막 ${Math.round(s.up)}m · 최대 ${s.maxGrade.toFixed(0)}%</span>`; }).join("");
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}">${g}</svg></div><div class="legend" style="margin-top:6px">${legend}</div>
      <div class="note">세로축: 고도(m) · 가로축: 출발점부터 거리</div>`;
  }

  function stepsTab(tab, rt) {
    const st = E.steps(S.g, rt);
    tab.innerHTML = `<div class="btnrow" style="margin-top:0"><button class="btn primary" id="go">▶ 미리 따라가기</button><button class="btn" id="tts">🔊 전체 안내 듣기</button></div>
      <ul class="steps" style="margin-top:8px">${st.map((x, i) => `<li data-i="${i}"><div class="ar">${ARROW[x.action] || "↑"}</div>
        <div class="tx"><b>${x.action}</b><div>${esc(x.road)}</div></div><div class="ds">${x.dist ? (x.dist >= 1000 ? (x.dist / 1000).toFixed(1) + "km" : Math.round(x.dist) + "m") : ""}</div></li>`).join("")}</ul>
      <div class="note">🚫 주행 중 사용 금지 · 출발 전에 경로를 익히는 용도예요. 항목을 누르면 그 지점으로 이동해요.</div>`;
    tab.querySelector("#go").onclick = () => startNav(0);
    tab.querySelectorAll(".steps li").forEach((li) => (li.onclick = () => startNav(+li.dataset.i)));
    tab.querySelector("#tts").onclick = () => {
      if (!window.speechSynthesis) return toast("이 브라우저는 음성 안내를 지원하지 않아요.");
      speechSynthesis.cancel();
      for (const x of st) {
        const u = new SpeechSynthesisUtterance(`${x.no}번. ${x.action}` + (x.dist && x.road ? `, ${x.road} 따라 ${Math.round(x.dist)}미터` : ""));
        u.lang = "ko-KR"; speechSynthesis.speak(u);
      }
    };
  }

  function saveTab(tab, rt) {
    tab.innerHTML = `<div class="btnrow" style="margin-top:0">
        <button class="btn" id="gpx">⬇️ GPX 내려받기</button>
        <button class="btn" id="link">🔗 경로 링크 복사</button>
        <button class="btn" id="fo">⭐ 출발지 저장</button>
        <button class="btn" id="fd">⭐ 도착지 저장</button>
        ${CFG.feedbackUrl ? `<a class="btn" href="${esc(CFG.feedbackUrl)}" target="_blank" rel="noopener" style="text-decoration:none">📝 피드백 남기기</a>` : ""}
      </div>
      <div class="note">· <b>GPX</b>: 음성 안내를 지원하는 자전거 앱에 불러오면 이 경로로 실제 길안내를 받을 수 있어요.<br>
      · <b>링크</b>: 북마크하거나 친구에게 보내면 같은 경로가 그대로 열려요.<br>
      · <b>⭐ 저장</b>: 이 기기의 브라우저에만 저장돼요(서버에 저장 안 함). 검색창을 누르면 바로 보여요.</div>`;
    tab.querySelector("#gpx").onclick = () => {
      const blob = new Blob([E.gpx(S.g, rt, RI[S.sel].name)], { type: "application/gpx+xml" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `bike_${S.sel}_route.gpx`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    tab.querySelector("#link").onclick = async () => {
      try { await navigator.clipboard.writeText(location.href); toast("링크를 복사했어요."); } catch (e) { prompt("아래 링크를 복사해 주세요", location.href); }
    };
    const fav = (p) => {
      if (!p) return;
      const name = prompt("저장할 이름을 입력해 주세요 (예: 집, 학교)", p.label);
      if (!name) return;
      S.favs = S.favs.filter((f) => f.name !== name).concat([{ name, lat: p.lat, lon: p.lon }]);
      saveFavs(); toast(`⭐ '${name}'을(를) 저장했어요.`);
    };
    tab.querySelector("#fo").onclick = () => fav(S.stops[0]);
    tab.querySelector("#fd").onclick = () => fav(S.stops[S.stops.length - 1]);
  }
  function saveFavs() { try { localStorage.setItem("bike_favs", JSON.stringify(S.favs)); } catch (e) { /* 저장 불가 */ } }

  // ================= 미리 따라가기 =================
  let navSteps = [];
  function startNav(i) {
    navSteps = E.steps(S.g, S.routes[S.sel]);
    S.nav = Math.max(0, Math.min(i, navSteps.length - 1));
    if (!S.mode3d) set3d(true);
    if (!isPC()) setSheet("peek");
    draw(); renderNav(); goStep();
  }
  function goStep() {
    const x = navSteps[S.nav];
    if (!curMarker) { const el = document.createElement("div"); el.className = "cur"; curMarker = new maplibregl.Marker({ element: el }); }
    curMarker.setLngLat([x.lon, x.lat]).addTo(map);
    map.easeTo({ center: [x.lon, x.lat], zoom: 17, bearing: x.bearing, pitch: 50, duration: 900,
      padding: isPC() ? { left: 0 } : { top: 120, bottom: 200 } });
  }
  function renderNav() {
    const el = $("#nav");
    if (!el) return;
    if (S.nav === null) { el.innerHTML = ""; if (curMarker) curMarker.remove(); return; }
    const x = navSteps[S.nav], remain = navSteps.slice(S.nav).reduce((a, b) => a + b.dist, 0) / 1000;
    el.innerHTML = `<div class="navcard" style="--c:${RI[S.sel].color}"><div class="ar">${ARROW[x.action] || "↑"}</div>
      <div class="tx"><b>${x.action}${x.road ? " · " + esc(x.road) : ""}</b><div>${x.no} / ${navSteps.length} · ${x.dist ? Math.round(x.dist) + "m 이동 · " : ""}남은 거리 ${remain.toFixed(1)}km</div></div></div>
      <div class="navbtns"><button class="btn" id="nprev" ${S.nav === 0 ? "disabled" : ""}>◀ 이전</button>
      <button class="btn" id="nstop">✕ 끝내기</button><button class="btn primary" id="nnext" ${S.nav >= navSteps.length - 1 ? "disabled" : ""}>다음 ▶</button></div>
      <div class="note" style="margin:6px 0 10px">🚫 주행 중 조작 금지 · 출발 전 미리보기예요.</div>`;
    el.querySelector("#nprev").onclick = () => { S.nav--; renderNav(); goStep(); };
    el.querySelector("#nnext").onclick = () => { S.nav++; renderNav(); goStep(); };
    el.querySelector("#nstop").onclick = () => { S.nav = null; draw(); renderNav(); renderCards(); map.easeTo({ bearing: 0, duration: 500 }); fitRoutes(); };
    renderCards();
  }

  // ================= 주소(해시)로 상태 저장 =================
  function writeHash() {
    const p = new URLSearchParams();
    S.stops.forEach((s, i) => { if (s) p.set("p" + i, `${s.lat.toFixed(6)},${s.lon.toFixed(6)},${s.label}`); });
    p.set("n", S.stops.length); p.set("c", S.pct);
    history.replaceState(null, "", "#" + p.toString());
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const n = Math.min(5, Math.max(2, +p.get("n") || 2)), stops = [];
    for (let i = 0; i < n; i++) {
      const v = p.get("p" + i);
      if (!v) { stops.push(null); continue; }
      const [la, lo, ...lab] = v.split(",");
      stops.push(isFinite(+la) && isFinite(+lo) ? { lat: +la, lon: +lo, label: lab.join(",") || "저장된 위치" } : null);
    }
    S.stops = stops;
    if (p.get("c") !== null && isFinite(+p.get("c"))) S.pct = Math.max(0, Math.min(100, +p.get("c")));
  }

  // ================= 기타 =================
  let toastT = null;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(hideToast, 2600); }
  function hideToast() { $("#toast").hidden = true; }

  function notice() {
    let seen = false;
    try { seen = sessionStorage.getItem("bike_notice") === "1"; } catch (e) { /* 무시 */ }
    if (seen) return;
    $("#modal").hidden = false;
    $("#modal-ok").onclick = () => { $("#modal").hidden = true; try { sessionStorage.setItem("bike_notice", "1"); } catch (e) { /* 무시 */ } };
  }

  // ================= 데이터 불러오기 =================
  async function fetchGraph() {
    const res = await fetch("data/graph.bin.gz");
    if (!res.ok) throw new Error("지도 데이터를 찾을 수 없어요 (data/graph.bin.gz)");
    const total = +res.headers.get("content-length") || 6.0e6;
    const reader = res.body.getReader(), chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      $("#bar-fill").style.width = Math.min(95, (got / total) * 95) + "%";
      $("#splash-msg").textContent = `지도 데이터를 불러오는 중이에요… ${(got / 1e6).toFixed(1)}MB`;
    }
    const blob = new Blob(chunks), head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    if (head[0] === 0x1f && head[1] === 0x8b) {
      if (!window.DecompressionStream) throw new Error("브라우저가 너무 오래됐어요. 최신 크롬·사파리로 열어 주세요.");
      return await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    }
    return await blob.arrayBuffer();
  }

  async function init() {
    try {
      const [buf, names, places] = await Promise.all([
        fetchGraph(), fetch("data/names.json").then((r) => r.json()), fetch("data/places.json").then((r) => r.json()),
      ]);
      $("#splash-msg").textContent = "경로망을 준비하는 중이에요…";
      await new Promise((r) => setTimeout(r, 30));
      S.g = E.parse(buf, names);
      S.places = places;
      $("#bar-fill").style.width = "100%";
      setTimeout(() => { $("#splash").style.opacity = 0; setTimeout(() => $("#splash").remove(), 300); }, 150);
      readHash();
      renderStops();
      const go = () => { compute(true); updCompass(); };
      go();
      setTimeout(updCompass, 500);
      notice();
      window.__bike = { S, map, compute, select, set3d, example, startNav };   // 테스트용
    } catch (e) {
      $("#splash-msg").textContent = "⚠️ " + e.message;
      console.error(e);
    }
  }
  window.addEventListener("resize", () => { renderCards(); placeFabs(); });
  init();
})();
