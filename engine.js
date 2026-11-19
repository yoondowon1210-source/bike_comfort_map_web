/* 서울 자전거 편의 지도 - 브라우저 경로 계산 엔진 */
(function (root) {
  "use strict";
  const LAT0 = 37.55;
  const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180);
  const KY = 110540;
  const BINS = [
    [1.0, "#1a9850", "아주 편함"],
    [0.0, "#91cf60", "편함"],
    [-2.0, "#fee08b", "보통"],
    [-4.0, "#fc8d59", "불편"],
    [-99, "#d73027", "매우 불편"],
  ];
  const binOf = (c) => {
    for (let i = 0; i < BINS.length; i++) if (c >= BINS[i][0]) return i;
    return BINS.length - 1;
  };

  // ---------------- 데이터 읽기 ----------------
  function parse(buf, names) {
    const dv = new DataView(buf);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== "BKM1") throw new Error("지도 데이터 형식이 올바르지 않아요");
    const N = dv.getUint32(4, true), M = dv.getUint32(8, true), Gn = dv.getUint32(12, true);
    let o = 20;
    const take = (T, n) => { const a = new T(buf, o, n); o += n * T.BYTES_PER_ELEMENT; return a; };
    const g = { N, M };
    g.lon = take(Float32Array, N);
    g.lat = take(Float32Array, N);
    g.rowptr = take(Uint32Array, N + 1);
    g.col = take(Uint32Array, M);
    g.t = take(Float32Array, M);
    g.L = take(Float32Array, M);
    g.geoff = take(Uint32Array, M + 1);
    g.geo = take(Float32Array, Gn * 2);
    const comfort = take(Int16Array, M);
    const grade = take(Int16Array, M);
    const z = take(Int16Array, N);
    g.name = take(Uint16Array, M);
    g.flags = take(Uint8Array, M);
    g.names = names;
    g.comfort = new Float32Array(M);
    g.q = new Float32Array(M);
    g.grade = new Float32Array(M);
    for (let e = 0; e < M; e++) {
      const c = comfort[e] / 100;
      g.comfort[e] = c;
      g.q[e] = (4 - Math.max(-8, Math.min(4, c))) / 12;
      g.grade[e] = grade[e] / 1000;
    }
    g.z = new Float32Array(N);
    for (let i = 0; i < N; i++) g.z[i] = z[i] / 10;
    g.src = new Uint32Array(M);
    for (let u = 0; u < N; u++) for (let e = g.rowptr[u]; e < g.rowptr[u + 1]; e++) g.src[e] = u;
    buildGrid(g);
    g.dist = new Float64Array(N);
    g.prev = new Int32Array(N);
    g.stamp = new Uint32Array(N);
    g.gen = 0;
    return g;
  }

  // ---------------- 가장 가까운 교차점 ----------------
  const CS = 0.004;
  function buildGrid(g) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < g.N; i++) {
      x0 = Math.min(x0, g.lon[i]); x1 = Math.max(x1, g.lon[i]);
      y0 = Math.min(y0, g.lat[i]); y1 = Math.max(y1, g.lat[i]);
    }
    const W = Math.floor((x1 - x0) / CS) + 1, H = Math.floor((y1 - y0) / CS) + 1;
    const cell = new Uint32Array(g.N), cnt = new Uint32Array(W * H + 1);
    for (let i = 0; i < g.N; i++) {
      const c = Math.floor((g.lat[i] - y0) / CS) * W + Math.floor((g.lon[i] - x0) / CS);
      cell[i] = c; cnt[c + 1]++;
    }
    for (let c = 0; c < W * H; c++) cnt[c + 1] += cnt[c];
    const start = cnt.slice(), items = new Uint32Array(g.N), fill = cnt.slice(0, W * H);
    for (let i = 0; i < g.N; i++) items[fill[cell[i]]++] = i;
    g.grid = { x0, y0, W, H, start, items };
  }

  function nearest(g, lat, lon) {
    const { x0, y0, W, H, start, items } = g.grid;
    const cx = Math.floor((lon - x0) / CS), cy = Math.floor((lat - y0) / CS);
    let best = -1, bd = Infinity;
    for (let r = 0; r < Math.max(W, H); r++) {
      for (let iy = cy - r; iy <= cy + r; iy++) {
        if (iy < 0 || iy >= H) continue;
        for (let ix = cx - r; ix <= cx + r; ix++) {
          if (ix < 0 || ix >= W) continue;
          if (Math.max(Math.abs(ix - cx), Math.abs(iy - cy)) !== r) continue;
          const c = iy * W + ix;
          for (let k = start[c]; k < start[c + 1]; k++) {
            const i = items[k];
            const dx = (g.lon[i] - lon) * KX, dy = (g.lat[i] - lat) * KY, d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = i; }
          }
        }
      }
      if (best >= 0 && r * CS * KY > Math.sqrt(bd) + CS * KY) break;
    }
    return { node: best, dist: Math.sqrt(bd) };
  }

  // ---------------- 다익스트라 ----------------
  function shortest(g, s, tgt, lam) {
    if (s === tgt) return [];
    const k = 4 * lam, gen = ++g.gen, { dist, prev, stamp, rowptr, col, t, q } = g;
    let hk = new Float64Array(1024), hv = new Int32Array(1024), n = 0;
    const push = (key, val) => {
      if (n === hk.length) {
        const nk = new Float64Array(n * 2); nk.set(hk); hk = nk;
        const nv = new Int32Array(n * 2); nv.set(hv); hv = nv;
      }
      let i = n++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hk[p] <= key) break;
        hk[i] = hk[p]; hv[i] = hv[p]; i = p;
      }
      hk[i] = key; hv[i] = val;
    };
    const pop = () => {
      const topV = hv[0], lastK = hk[--n], lastV = hv[n];
      let i = 0;
      while (true) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && hk[c + 1] < hk[c]) c++;
        if (hk[c] >= lastK) break;
        hk[i] = hk[c]; hv[i] = hv[c]; i = c;
      }
      hk[i] = lastK; hv[i] = lastV;
      return topV;
    };
    stamp[s] = gen; dist[s] = 0; prev[s] = -1; push(0, s);
    let found = false;
    while (n > 0) {
      const d = hk[0], u = pop();
      if (d > dist[u]) continue;
      if (u === tgt) { found = true; break; }
      for (let e = rowptr[u], end = rowptr[u + 1]; e < end; e++) {
        const v = col[e], nd = d + t[e] * (1 + k * q[e]);
        if (stamp[v] !== gen || nd < dist[v]) { stamp[v] = gen; dist[v] = nd; prev[v] = e; push(nd, v); }
      }
    }
    if (!found) return null;
    const edges = [];
    for (let v = tgt; v !== s; ) { const e = prev[v]; edges.push(e); v = g.src[e]; }
    return edges.reverse();
  }

  function route(g, points, lam) {
    const snapped = points.map((p) => nearest(g, p[0], p[1]));
    let edges = [];
    for (let i = 0; i + 1 < snapped.length; i++) {
      const leg = shortest(g, snapped[i].node, snapped[i + 1].node, lam);
      if (leg === null) return null;
      edges = edges.concat(leg);
    }
    const nodes = [snapped[0].node];
    for (const e of edges) nodes.push(g.col[e]);
    return { edges, nodes, snapped, lam };
  }

  // ---------------- 경로 정보 ----------------
  function edgeCoords(g, e) {
    const u = g.src[e], v = g.col[e], out = [[g.lon[u], g.lat[u]]];
    for (let k = g.geoff[e]; k < g.geoff[e + 1]; k++) out.push([g.geo[2 * k], g.geo[2 * k + 1]]);
    out.push([g.lon[v], g.lat[v]]);
    return out;
  }

  function coords(g, r) {
    if (!r.edges.length) return [[g.lon[r.nodes[0]], g.lat[r.nodes[0]]]];
    const out = [];
    r.edges.forEach((e, i) => { const c = edgeCoords(g, e); out.push(...(i ? c.slice(1) : c)); });
    return out;
  }

  function path3d(g, r, ex, zmin) {
    const out = [];
    r.edges.forEach((e, i) => {
      const c = edgeCoords(g, e), z1 = g.z[g.src[e]], z2 = g.z[g.col[e]];
      c.forEach((p, j) => {
        if (i && !j) return;
        const z = z1 + ((z2 - z1) * j) / (c.length - 1);
        out.push([p[0], p[1], (z - zmin) * ex + 3]);
      });
    });
    return out;
  }

  function runs(mask) { let n = 0; for (let i = 0; i < mask.length; i++) if (mask[i] && !(i && mask[i - 1])) n++; return n; }

  function stats(g, r) {
    let tot = 0, tsum = 0, up = 0, infra = 0, big = 0, cw = 0, maxg = 0;
    const tun = [];
    for (const e of r.edges) {
      const L = g.L[e]; tot += L; tsum += g.t[e];
      const dz = g.z[g.col[e]] - g.z[g.src[e]]; if (dz > 0) up += dz;
      if (g.flags[e] & 1) infra += L;
      if (g.flags[e] & 2) big += L;
      tun.push(g.flags[e] & 4 ? 1 : 0);
      cw += g.comfort[e] * L;
      if (L >= 30) maxg = Math.max(maxg, Math.abs(g.grade[e]) * 100);
    }
    return {
      km: tot / 1000, min: tsum / 60, up, maxGrade: Math.min(maxg, 30),
      infra: tot ? (infra / tot) * 100 : 0, big: tot ? (big / tot) * 100 : 0,
      comfort: tot ? cw / tot : 0, tunnels: runs(tun),
    };
  }

  function segments(g, r) {
    const segs = []; let cur = null, curBin = -1;
    for (const e of r.edges) {
      const b = binOf(g.comfort[e]), c = edgeCoords(g, e);
      if (b !== curBin) {
        if (cur) segs.push({ bin: curBin, path: cur });
        cur = cur ? [cur[cur.length - 1]] : []; curBin = b;
      }
      cur.push(...(cur.length ? c.slice(1) : c));
    }
    if (cur) segs.push({ bin: curBin, path: cur });
    return segs.map((s) => ({ color: BINS[s.bin][1], label: BINS[s.bin][2], bin: s.bin, path: s.path }));
  }

  function binShare(g, r) {
    const s = new Array(BINS.length).fill(0); let tot = 0;
    for (const e of r.edges) { s[binOf(g.comfort[e])] += g.L[e]; tot += g.L[e]; }
    return s.map((v) => (tot ? (v / tot) * 100 : 0));
  }

  function profile(g, r) {
    const d = [0], z = [g.z[r.nodes[0]]]; let acc = 0;
    r.edges.forEach((e, i) => { acc += g.L[e]; d.push(acc / 1000); z.push(g.z[r.nodes[i + 1]]); });
    return { d, z };
  }

  const bearing = (p, q) => (Math.atan2((q[0] - p[0]) * KX, (q[1] - p[1]) * KY) * 180 / Math.PI + 360) % 360;
  function turn(b1, b2) {
    const d = ((b2 - b1 + 540) % 360) - 180, a = Math.abs(d);
    if (a < 25) return "직진";
    const side = d > 0 ? "우" : "좌";
    if (a < 60) return `약간 ${side}측`;
    if (a < 150) return `${side}회전`;
    return "유턴";
  }

  function steps(g, r) {
    const groups = [];
    for (const e of r.edges) {
      const nm = g.names[g.name[e]] || "";
      const last = groups[groups.length - 1];
      if (last && last.nm === nm) { last.L += g.L[e]; last.le = e; }
      else groups.push({ nm, L: g.L[e], fe: e, le: e });
    }
    const merged = [];
    for (const x of groups) {
      const last = merged[merged.length - 1];
      if (last && ((x.L < 25 && x.nm === "") || last.nm === x.nm)) { last.L += x.L; last.le = x.le; }
      else merged.push({ ...x });
    }
    const out = merged.map((x, i) => {
      const c = edgeCoords(g, x.fe);
      let act = "출발";
      if (i) { const p = edgeCoords(g, merged[i - 1].le); act = turn(bearing(p[p.length - 2], p[p.length - 1]), bearing(c[0], c[1])); }
      return { no: i + 1, action: act, road: x.nm || "이름 없는 길", dist: x.L, lon: c[0][0], lat: c[0][1], bearing: bearing(c[0], c[c.length - 1]) };
    });
    if (r.edges.length) {
      const c = edgeCoords(g, r.edges[r.edges.length - 1]), p = c[c.length - 1];
      out.push({ no: out.length + 1, action: "도착", road: "", dist: 0, lon: p[0], lat: p[1], bearing: 0 });
    }
    return out;
  }

  function gpx(g, r, name) {
    const pts = coords(g, r), zs = r.nodes.map((n) => g.z[n]);
    const body = pts.map((p, i) => {
      const z = zs[Math.min(zs.length - 1, Math.round((i * (zs.length - 1)) / Math.max(1, pts.length - 1)))];
      return `      <trkpt lat="${p[1].toFixed(6)}" lon="${p[0].toFixed(6)}"><ele>${z.toFixed(1)}</ele></trkpt>`;
    }).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="bike-comfort-map" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk><name>${name}</name><trkseg>\n${body}\n  </trkseg></trk>\n</gpx>\n`;
  }

  // ---------------- 장소 검색 ----------------
  function search(places, q, limit = 8) {
    const qn = q.replace(/\s/g, "");
    if (!qn) return [];
    const stem = qn.endsWith("역") && qn.length > 1 ? qn.slice(0, -1) : null;
    const hits = [];
    for (const p of places) {
      const nm = p[0].replace(/\s/g, "");
      let score = -1;
      if (nm === qn || (stem && nm === stem && p[1] === "역")) score = 0;
      else if (nm.startsWith(qn)) score = 1;
      else if (nm.includes(qn)) score = 2;
      else if (p[2] && p[2].startsWith(qn)) score = 3;
      if (score >= 0) hits.push([score, nm.length, p]);
    }
    hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return hits.slice(0, limit).map((h) => h[2]);
  }

  root.BikeEngine = { parse, nearest, route, coords, path3d, stats, segments, binShare, profile, steps, gpx, search, edgeCoords, BINS, KX, KY };
  if (typeof module !== "undefined") module.exports = root.BikeEngine;
})(typeof window !== "undefined" ? window : globalThis);
