/*
 * MOCK Kakao Maps SDK for local browser verification ONLY (served by Playwright route interception in
 * scripts/browser/*.mjs; never bundled, never deployed). It implements just the documented primitives the
 * adapter in src/lib/kakao.ts uses (Map, Marker, MarkerImage, Polygon, LatLng, LatLngBounds, Size, event) with
 * a simple linear projection, and records instrumentation on window.__kakaoStats so a review can count map
 * instances, idle events and marker renders. A passing run against this mock is fixture evidence, not a
 * real-SDK pass (docs/kakao-map.md: live evidence needs a real key/domain).
 */
(function () {
  if (window.kakao && window.kakao.maps) return;
  const stats = window.__kakaoStats = { maps: 0, idle: 0, userMoves: 0, setBounds: 0, relayout: 0, markersDrawn: 0, lastMarkers: [], polygons: [] };
  const listeners = new WeakMap();
  const on = (obj, type, cb) => {
    let map = listeners.get(obj);
    if (!map) listeners.set(obj, map = {});
    (map[type] ||= []).push(cb);
  };
  const off = (obj, type, cb) => {
    const map = listeners.get(obj);
    if (map && map[type]) map[type] = map[type].filter((f) => f !== cb);
  };
  const fire = (obj, type) => {
    const map = listeners.get(obj);
    for (const cb of (map && map[type]) || []) cb();
  };
  // degrees per CSS pixel at level 1; each level doubles (level 13 ≈ Korea on ~640px)
  const DEG_PX_1 = 0.0094 / 4096;
  const degPx = (level) => DEG_PX_1 * 2 ** (level - 1);

  class LatLng {
    constructor(lat, lng) { this.lat = lat; this.lng = lng; }
    getLat() { return this.lat; }
    getLng() { return this.lng; }
  }
  class LatLngBounds {
    constructor(sw, ne) { this.sw = sw; this.ne = ne; }
    getSouthWest() { return this.sw; }
    getNorthEast() { return this.ne; }
  }
  class Size { constructor(w, h) { this.width = w; this.height = h; } }
  class MarkerImage { constructor(src, size) { this.src = src; this.size = size; } }

  class KMap {
    constructor(el, opts) {
      stats.maps += 1;
      this.el = el;
      this.center = opts.center;
      this.level = opts.level || 13;
      this.id = stats.maps;
      el.dataset.mockKakaoMap = String(this.id);
      el.style.background = 'repeating-linear-gradient(45deg,#dfe7ef 0 12px,#e8eef4 12px 24px)';
      const tag = document.createElement('div');
      tag.textContent = 'MOCK 지도 · 실제 카카오 지도 아님';
      tag.style.cssText = 'position:absolute;right:6px;bottom:4px;font:11px system-ui;color:#334;background:#fff9;padding:1px 4px;border-radius:3px;pointer-events:none';
      el.style.position = 'relative'; // like the real SDK: the app CSS must keep the host sized
      el.appendChild(tag);
      (window.__kakaoMaps ||= []).push(this);
      this.idleSoon();
    }
    idleSoon() {
      clearTimeout(this.t);
      this.t = setTimeout(() => { stats.idle += 1; this.__draw(); fire(this, 'idle'); }, 30);
    }
    /** draw live markers/polygon fills as DOM so screenshots show them (projection = linear) */
    __draw() {
      if (!this.layer) {
        this.layer = document.createElement('div');
        this.layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none';
        this.el.appendChild(this.layer);
      }
      const { w, h } = this.size();
      const d = degPx(this.level);
      const xy = (lat, lng) => [w / 2 + (lng - this.center.lng) / d, h / 2 - (lat - this.center.lat) / (d * 0.8)];
      let html = '';
      for (const poly of stats.polygons) {
        if (poly.map !== this) continue;
        const rings = poly.opts.path || [];
        const pts = (rings[0] || []).map((p) => xy(p.lat, p.lng).map((v) => v.toFixed(1)).join(',')).join(' ');
        html += `<svg style="position:absolute;inset:0" width="${w}" height="${h}"><polygon points="${pts}" fill="${poly.opts.fillColor}" fill-opacity="${poly.opts.fillOpacity}" stroke="${poly.opts.strokeColor}" stroke-width="${poly.opts.strokeWeight}" stroke-opacity="${poly.opts.strokeOpacity}"/></svg>`;
      }
      for (const m of stats.live || []) {
        if (m.map !== this) continue;
        const [x, y] = xy(m.opts.position.lat, m.opts.position.lng);
        const size = m.opts.image && m.opts.image.size ? m.opts.image.size.width : 40;
        html += `<img src="${m.opts.image && m.opts.image.src}" title="${String(m.opts.title || '').replace(/"/g, '&quot;')}" style="position:absolute;left:${(x - size / 2).toFixed(1)}px;top:${(y - size / 2).toFixed(1)}px;width:${size}px;height:${size}px">`;
      }
      this.layer.innerHTML = html;
    }
    size() { return { w: this.el.clientWidth || 600, h: this.el.clientHeight || 400 }; }
    getBounds() {
      const { w, h } = this.size();
      const d = degPx(this.level);
      return new LatLngBounds(
        new LatLng(this.center.lat - (h / 2) * d * 0.8, this.center.lng - (w / 2) * d),
        new LatLng(this.center.lat + (h / 2) * d * 0.8, this.center.lng + (w / 2) * d));
    }
    getCenter() { return this.center; }
    setCenter(c) { this.center = c; this.idleSoon(); }
    getLevel() { return this.level; }
    setLevel(l) { this.level = Math.max(1, Math.min(14, l)); this.idleSoon(); }
    relayout() { stats.relayout += 1; this.idleSoon(); }
    setBounds(b) {
      stats.setBounds += 1;
      const sw = b.getSouthWest(), ne = b.getNorthEast();
      const { w, h } = this.size();
      this.center = new LatLng((sw.lat + ne.lat) / 2, (sw.lng + ne.lng) / 2);
      let level = 1;
      while (level < 14 && ((ne.lng - sw.lng) / degPx(level) > w - 48 || (ne.lat - sw.lat) / (degPx(level) * 0.8) > h - 48)) level += 1;
      this.level = level;
      this.idleSoon();
    }
    /** test helper: a user drag of (dx, dy) CSS pixels followed by the SDK's idle */
    __userPan(dx, dy) {
      stats.userMoves += 1;
      const d = degPx(this.level);
      this.center = new LatLng(this.center.lat + dy * d * 0.8, this.center.lng - dx * d);
      fire(this, 'dragstart');
      fire(this, 'bounds_changed');
      fire(this, 'dragend');
      this.idleSoon();
    }
    __userZoom(delta) { stats.userMoves += 1; this.setLevel(this.level + delta); }
  }

  class Marker {
    constructor(opts) { this.opts = opts; this.map = null; }
    setMap(m) {
      if (m && !this.map) { stats.markersDrawn += 1; (stats.live ||= new Set()).add(this); }
      if (!m && stats.live) stats.live.delete(this);
      const target = m || this.map;
      this.map = m;
      if (target) { clearTimeout(target.dt); target.dt = setTimeout(() => target.__draw(), 0); }
    }
    getPosition() { return this.opts.position; }
    __click() { fire(this, 'click'); }
  }
  class Polygon {
    constructor(opts) { this.opts = opts; this.map = opts.map || null; stats.polygons.push(this); if (this.map) { clearTimeout(this.map.dt); const t = this.map; t.dt = setTimeout(() => t.__draw(), 0); } }
    setMap(m) { this.map = m; if (!m) stats.polygons = stats.polygons.filter((p) => p !== this); }
    setOptions(o) { Object.assign(this.opts, o); if (this.map) { clearTimeout(this.map.dt); const t = this.map; t.dt = setTimeout(() => t.__draw(), 0); } }
    __hover() { fire(this, 'mouseover'); }
    __click() { fire(this, 'click'); }
  }
  window.__kakaoLiveMarkers = () => [...(stats.live || [])].map((m) => ({
    title: m.opts.title, src: decodeURIComponent(String(m.opts.image && m.opts.image.src || '').replace(/^data:image\/svg\+xml;charset=utf-8,/, '')),
    lat: m.opts.position.lat, lng: m.opts.position.lng, marker: m,
  }));

  window.kakao = { maps: {
    load(cb) { setTimeout(cb, 0); },
    LatLng, LatLngBounds, Size, MarkerImage, Map: KMap, Marker, Polygon,
    event: { addListener: on, removeListener: off },
  } };
})();
