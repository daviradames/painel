/* Painel do Davi — app web instalável (PWA).
   Fontes de dados:
   - Google Agenda: API do Google Calendar com login OAuth (somente leitura).
   - PubMed: NCBI E-utilities (público, sem chave).
   - Congressos e temas: data/congressos.json e data/temas.json (editáveis). */
(function () {
  "use strict";
  const APP_VERSION = "1.0.0";
  const TZ = "America/Sao_Paulo";
  const CAL_REFRESH_MS = 5 * 60 * 1000;
  const PUB_REFRESH_MS = 60 * 60 * 1000;
  const CAL_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
  const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const fmtDay = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
  const fmtTime = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  const fmtKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const fmtShort = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
  const dayKey = (d) => fmtKey.format(d);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function rel(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return "agora";
    if (m < 60) return "há " + m + " min";
    const h = Math.round(m / 60);
    if (h < 24) return "há " + h + " h";
    const d = Math.round(h / 24);
    return "há " + d + (d === 1 ? " dia" : " dias");
  }
  function until(ts) {
    const m = Math.round((ts - Date.now()) / 60000);
    if (m <= 0) return "agora";
    if (m < 60) return "em " + m + " min";
    const h = Math.floor(m / 60);
    if (h < 24) return "em " + h + " h" + (m % 60 ? " " + (m % 60) + " min" : "");
    const d = Math.round(h / 24);
    return "em " + d + (d === 1 ? " dia" : " dias");
  }
  function setFresh(id, state, label) {
    const el = $(id);
    if (!el) return;
    el.className = "fresh " + state;
    el.lastElementChild.textContent = label;
  }

  /* ---------- Navegação ---------- */
  const VIEWS = ["home", "agenda", "lit", "cong", "set"];
  function show(view) {
    if (!VIEWS.includes(view)) view = "home";
    for (const v of VIEWS) $("view-" + v).hidden = v !== view;
    document.querySelectorAll(".tabbar .tab").forEach((b) => {
      if (b.dataset.view === view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    $("page-title").textContent = $("view-" + view).dataset.title;
    try { history.replaceState(null, "", "#" + view); } catch (e) {}
    window.scrollTo(0, 0);
  }
  document.querySelectorAll(".tabbar .tab").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
  document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => show(b.dataset.go)));

  function setToday() { $("today").textContent = "Hoje é " + fmtDay.format(new Date()); }

  /* ---------- Google Agenda ---------- */
  let tokenClient = null;
  let tokenCid = "";
  let calEvents = store.get("cal-events", null);
  let calFetchedAt = store.get("cal-fetched", 0);

  function getToken() {
    const t = store.get("g-token", null);
    return t && t.exp > Date.now() + 60000 ? t.value : null;
  }
  function clientId() { return (store.get("g-client-id", "") || "").trim(); }

  function initGis() {
    if (tokenClient || !clientId() || !(window.google && google.accounts && google.accounts.oauth2)) return !!tokenClient;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: CAL_SCOPE,
      callback: (resp) => {
        if (resp.error) { calError("auth", resp.error_description || resp.error); return; }
        store.set("g-token", { value: resp.access_token, exp: Date.now() + (Number(resp.expires_in) || 3600) * 1000 });
        store.set("g-connected", true);
        updateGStatus();
        loadCalendar();
      },
      error_callback: (err) => {
        calError("auth", err && err.type === "popup_closed" ? "A janela de login foi fechada antes de terminar." : "Não foi possível abrir o login do Google. Permita pop-ups para este site.");
      }
    });
    return true;
  }
  function connectGoogle() {
    const id = $("client-id").value.trim();
    if (id) store.set("g-client-id", id);
    if (!clientId()) { calError("noclient"); show("set"); $("client-id").focus(); return; }
    if (!(window.google && google.accounts && google.accounts.oauth2)) { calError("auth", "O serviço de login do Google ainda não carregou. Verifique a conexão e tente de novo."); return; }
    if (tokenClient && tokenCid !== clientId()) tokenClient = null;
    initGis();
    tokenCid = clientId();
    tokenClient.requestAccessToken({ prompt: store.get("g-connected", false) ? "" : "consent" });
  }
  function disconnectGoogle() {
    const t = store.get("g-token", null);
    if (t && window.google && google.accounts && google.accounts.oauth2) { try { google.accounts.oauth2.revoke(t.value, () => {}); } catch (e) {} }
    store.del("g-token"); store.del("g-connected"); store.del("cal-events"); store.del("cal-fetched");
    calEvents = null; calFetchedAt = 0;
    updateGStatus(); renderAgenda();
  }
  function updateGStatus() {
    const tok = getToken();
    $("g-status").textContent = tok ? "Conectado. Lendo sua agenda principal." : store.get("g-connected", false) ? "O acesso expirou. Toque em Conectar para renovar." : "Não conectado.";
    $("btn-connect").textContent = store.get("g-connected", false) && !tok ? "Reconectar" : "Conectar Google Agenda";
    $("btn-disconnect").hidden = !store.get("g-connected", false);
  }

  async function loadCalendar() {
    const tok = getToken();
    if (!tok) { renderAgenda(); return; }
    const start = new Date(dayKey(new Date()) + "T00:00:00-03:00");
    const end = new Date(start.getTime() + 7 * 86400000);
    const url = "https://www.googleapis.com/calendar/v3/calendars/primary/events?" + new URLSearchParams({
      timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "100", timeZone: TZ
    });
    try {
      const r = await fetch(url, { headers: { Authorization: "Bearer " + tok } });
      if (r.status === 401) { store.del("g-token"); updateGStatus(); renderAgenda(); return; }
      if (r.status === 403) { const j = await r.json().catch(() => ({})); throw new Error((j.error && j.error.message) || "Acesso negado pela API do Google Agenda."); }
      if (!r.ok) throw new Error("O Google Agenda respondeu com erro " + r.status + ".");
      const j = await r.json();
      calEvents = j.items || [];
      calFetchedAt = Date.now();
      store.set("cal-events", calEvents); store.set("cal-fetched", calFetchedAt);
      renderAgenda();
    } catch (e) {
      if (calEvents) { renderAgenda(); setFresh("fr-cal", "stale", "sem atualizar · " + rel(calFetchedAt)); }
      else calError("fetch", e.message || String(e));
    }
  }

  function calError(kind, msg) {
    let html;
    if (kind === "noclient") html = "<b>Falta o Client ID do Google.</b> Cole o Client ID em Ajustes e toque em Conectar. O guia de configuração está no arquivo LEIA-ME.";
    else if (kind === "auth") html = "<b>Login do Google não concluído.</b> " + esc(msg);
    else html = "<b>Não consegui ler a agenda.</b> " + esc(msg);
    $("agenda").innerHTML = '<div class="note err">' + html + '<div><button class="btn primary" type="button" data-act="connect">Tentar de novo</button></div></div>';
    $("home-agenda").innerHTML = $("agenda").innerHTML;
    setFresh("fr-cal", "stale", "indisponível");
  }

  function startOf(ev) {
    const s = ev.start || {};
    if (s.dateTime) return { ts: Date.parse(s.dateTime), allDay: false };
    if (s.date) return { ts: Date.parse(s.date + "T00:00:00-03:00"), allDay: true };
    return { ts: NaN, allDay: false };
  }
  function endOf(ev) {
    const e = ev.end || {};
    if (e.dateTime) return Date.parse(e.dateTime);
    if (e.date) return Date.parse(e.date + "T00:00:00-03:00");
    return NaN;
  }
  function myStatus(ev) { const me = (ev.attendees || []).find((a) => a.self); return me ? me.responseStatus : null; }
  function meetUrl(ev) {
    if (ev.hangoutLink) return ev.hangoutLink;
    const ep = ev.conferenceData && (ev.conferenceData.entryPoints || []).find((p) => p.entryPointType === "video");
    return ep ? ep.uri : null;
  }

  function eventCard(x, now) {
    const e = x.e;
    const past = x.end <= now;
    const live = !past && x.s.ts <= now && !x.s.allDay;
    const time = x.s.allDay ? "dia todo" : fmtTime.format(new Date(x.s.ts)) + "–" + fmtTime.format(new Date(x.end));
    const st = myStatus(e);
    const chips = [];
    if (live) chips.push('<span class="chip">agora</span>');
    if (st === "needsAction" && !past) chips.push('<span class="chip warn">responder convite</span>');
    if (st === "tentative") chips.push('<span class="chip warn">talvez</span>');
    const meet = meetUrl(e);
    if (meet && !past) chips.push('<a class="chip" href="' + esc(meet) + '" target="_blank" rel="noopener">Entrar no Meet</a>');
    const bits = [];
    if (e.organizer && e.organizer.displayName) bits.push(esc(e.organizer.displayName));
    const n = (e.attendees || []).length;
    if (n > 1) bits.push(n + " participantes");
    if (e.location) bits.push(esc(e.location));
    const title = esc(e.summary || "(sem título)");
    return '<div class="item' + (past ? " past" : "") + (live ? " now" : "") + '"><div class="top"><div class="title">' +
      (e.htmlLink ? '<a href="' + esc(e.htmlLink) + '" target="_blank" rel="noopener">' + title + "</a>" : title) +
      '</div><span class="t">' + esc(time) + "</span></div>" +
      (chips.length || bits.length ? '<div class="meta">' + chips.join("") + (bits.length ? "<span>" + bits.join(" · ") + "</span>" : "") + "</div>" : "") + "</div>";
  }

  function renderAgenda() {
    const tok = getToken();
    if (!calEvents) {
      const msg = !clientId()
        ? '<div class="note">Para ver sua agenda aqui, configure o login do Google em <b>Ajustes</b>.<div><button class="btn primary" type="button" data-go-set>Abrir Ajustes</button></div></div>'
        : '<div class="note">Conecte o Google Agenda para ver seus compromissos.<div><button class="btn primary" type="button" data-act="connect">' + (store.get("g-connected", false) ? "Reconectar" : "Conectar Google Agenda") + "</button></div></div>";
      $("agenda").innerHTML = msg; $("home-agenda").innerHTML = msg;
      setFresh("fr-cal", "", "não conectado");
      tile("t-next", "—", "conecte o Google Agenda");
      tile("t-rsvp", "—", "próximos 7 dias");
      return;
    }
    const now = Date.now();
    const list = calEvents
      .filter((e) => e.status !== "cancelled" && myStatus(e) !== "declined")
      .map((e) => ({ e, s: startOf(e), end: endOf(e) }))
      .filter((x) => !isNaN(x.s.ts))
      .sort((a, b) => a.s.ts - b.s.ts);
    const pending = list.filter((x) => myStatus(x.e) === "needsAction" && x.end > now);
    const next = list.find((x) => !x.s.allDay && x.end > now);
    if (next) {
      const live = next.s.ts <= now;
      tile("t-next", next.e.summary || "(sem título)", live ? "acontecendo agora" : fmtDay.format(new Date(next.s.ts)).split(",")[0] + " " + fmtTime.format(new Date(next.s.ts)) + " · " + until(next.s.ts));
    } else tile("t-next", "Nada marcado", "próximos 7 dias livres");
    tile("t-rsvp", pending.length ? pending.length + (pending.length === 1 ? " convite" : " convites") : "Tudo respondido", pending.length ? pending.slice(0, 2).map((x) => x.e.summary).join(" · ") : "próximos 7 dias", pending.length > 0);

    const todayK = dayKey(new Date());
    const tomorrowK = dayKey(new Date(now + 86400000));
    const groups = new Map();
    for (const x of list) {
      const k = dayKey(new Date(x.s.ts));
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(x);
    }
    let html = "";
    for (const [k, items] of groups) {
      const label = k === todayK ? "Hoje" : k === tomorrowK ? "Amanhã · " + fmtDay.format(new Date(items[0].s.ts)) : fmtDay.format(new Date(items[0].s.ts));
      html += '<div class="day-label' + (k === todayK ? " is-today" : "") + '">' + esc(label) + '</div><div class="list">' + items.map((x) => eventCard(x, now)).join("") + "</div>";
    }
    $("agenda").innerHTML = html || '<div class="note">Nenhum compromisso nos próximos 7 dias.</div>';
    const soon = list.filter((x) => { const k = dayKey(new Date(x.s.ts)); return (k === todayK || k === tomorrowK) && x.end > now; });
    $("home-agenda").innerHTML = soon.length ? '<div class="list">' + soon.map((x) => eventCard(x, now)).join("") + "</div>" : '<div class="note">Nada marcado para hoje e amanhã.</div>';
    setFresh("fr-cal", tok ? "live" : "stale", (tok ? "atualizado " : "salvo ") + rel(calFetchedAt));
  }

  /* ---------- PubMed ---------- */
  let temas = [];
  let activeTema = null;
  const pub = store.get("pub-cache", {});
  let pubFetchedAt = store.get("pub-fetched", 0);
  const pubErr = {};
  const seenRaw = store.get("seen-pmids", null);
  const firstVisit = !seenRaw;
  const seen = new Set(seenRaw || []);
  const sessionNew = new Set(store.get("session-new", []));

  function dateRange(days) {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    const f = (d) => dayKey(d).replace(/-/g, "/");
    return f(start) + ":" + f(end) + "[edat]";
  }
  async function eutils(path, params) {
    const r = await fetch(EUTILS + path + "?" + new URLSearchParams(Object.assign({ db: "pubmed", retmode: "json", tool: "painel-davi" }, params)));
    if (r.status === 429) throw new Error("O PubMed limitou as consultas. Tente de novo em instantes.");
    if (!r.ok) throw new Error("O PubMed respondeu com erro " + r.status + ".");
    return r.json();
  }
  async function loadTema(t) {
    const s = await eutils("esearch.fcgi", { term: t.q + " AND " + dateRange(t.dias), retmax: "10", sort: "pub_date" });
    const ids = (s.esearchresult && s.esearchresult.idlist) || [];
    if (!ids.length) return [];
    await sleep(400);
    const m = await eutils("esummary.fcgi", { id: ids.join(",") });
    const res = m.result || {};
    return ids.map((id) => res[id]).filter(Boolean).map((a) => ({
      pmid: a.uid,
      title: (a.title || "").replace(/<[^>]+>/g, ""),
      first: a.authors && a.authors[0] ? a.authors[0].name + (a.authors.length > 1 ? " et al." : "") : "",
      journal: a.source || a.fulljournalname || "",
      date: a.pubdate || "",
      doi: ((a.articleids || []).find((x) => x.idtype === "doi") || {}).value || ""
    }));
  }
  async function loadPubmed(force) {
    if (!temas.length) return;
    if (!force && pubFetchedAt && Date.now() - pubFetchedAt < PUB_REFRESH_MS && Object.keys(pub).length) { renderPub(); return; }
    setFresh("fr-pub", "", "atualizando…");
    let ok = 0;
    for (const t of temas) {
      try {
        const arts = await loadTema(t);
        for (const a of arts) { if (!firstVisit && !seen.has(a.pmid)) sessionNew.add(a.pmid); seen.add(a.pmid); }
        pub[t.id] = arts; delete pubErr[t.id]; ok++;
      } catch (e) {
        pubErr[t.id] = e instanceof TypeError ? "Sem conexão com o PubMed. Verifique a internet e toque em atualizar." : (e.message || String(e));
      }
      renderPub();
      await sleep(400);
    }
    store.set("seen-pmids", [...seen].slice(-800));
    store.set("session-new", [...sessionNew].slice(-200));
    if (ok) { pubFetchedAt = Date.now(); store.set("pub-cache", pub); store.set("pub-fetched", pubFetchedAt); }
    renderPub();
  }
  function renderPub() {
    if (!temas.length) return;
    if (!activeTema || !temas.find((t) => t.id === activeTema)) activeTema = temas[0].id;
    $("lit-tabs").innerHTML = temas.map((t) => '<button class="chip-btn" role="tab" type="button" data-tema="' + esc(t.id) + '" aria-selected="' + (t.id === activeTema) + '">' + esc(t.label) + (pub[t.id] ? ' <span class="n">(' + pub[t.id].length + ")</span>" : "") + "</button>").join("");
    const t = temas.find((x) => x.id === activeTema);
    $("win").textContent = "últimos " + t.dias + " dias";
    const list = pub[t.id];
    if (pubErr[t.id] && !list) $("pub").innerHTML = '<div class="note err"><b>Não consegui consultar o PubMed.</b> ' + esc(pubErr[t.id]) + "</div>";
    else if (!list) $("pub").innerHTML = '<div class="skel"></div><div class="skel"></div>';
    else if (!list.length) $("pub").innerHTML = '<div class="note">Nenhum artigo novo neste tema nos últimos ' + t.dias + " dias.</div>";
    else $("pub").innerHTML = '<div class="list">' + list.map((a) => {
      const isNew = sessionNew.has(a.pmid);
      const href = a.doi ? "https://doi.org/" + a.doi : "https://pubmed.ncbi.nlm.nih.gov/" + a.pmid + "/";
      return '<div class="item' + (isNew ? " is-new" : "") + '"><div class="title"><a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(a.title || "(sem título)") + '</a></div><div class="sub">' + esc(a.first) + (a.journal ? " · <i>" + esc(a.journal) + "</i>" : "") + (a.date ? " · " + esc(a.date) : "") + '</div><div class="meta">' +
        (isNew ? '<span class="chip">novo</span>' : "") +
        (a.doi ? '<a class="chip" href="https://doi.org/' + esc(a.doi) + '" target="_blank" rel="noopener">DOI</a>' : "") +
        '<a class="chip" href="https://pubmed.ncbi.nlm.nih.gov/' + esc(a.pmid) + '/" target="_blank" rel="noopener">PMID ' + esc(a.pmid) + "</a></div></div>";
    }).join("") + "</div>";
    const ids = new Set(); Object.values(pub).forEach((l) => (l || []).forEach((a) => ids.add(a.pmid)));
    const nNew = [...ids].filter((id) => sessionNew.has(id)).length;
    if (Object.keys(pub).length) tile("t-lit", ids.size + (ids.size === 1 ? " artigo" : " artigos"), firstVisit ? temas.length + " temas do projeto" : nNew ? nNew + " novo" + (nNew > 1 ? "s" : "") + " desde a última visita" : "nada novo desde a última visita", nNew > 0);
    if (pubFetchedAt) setFresh("fr-pub", Object.keys(pubErr).length ? "stale" : "live", "atualizado " + rel(pubFetchedAt));
  }
  $("lit-tabs").addEventListener("click", (ev) => { const b = ev.target.closest("[data-tema]"); if (b) { activeTema = b.dataset.tema; renderPub(); } });

  /* ---------- Congressos ---------- */
  let cong = store.get("cong-cache", null);
  let congFilter = "all";
  function deadlineInfo(a) {
    if (!a.deadline) return { order: 9e15, label: "a anunciar", chip: '<span class="chip muted">em breve</span>', closed: false };
    const end = Date.parse(a.deadline + "T23:59:00-03:00");
    const days = Math.ceil((end - Date.now()) / 86400000);
    const label = fmtShort.format(new Date(a.deadline + "T12:00:00Z")).replace(/\./g, "");
    if (days < 0) return { order: 1e16 + end, label, chip: '<span class="chip muted">encerrado</span>', closed: true };
    const cls = days <= 30 ? "chip bad" : days <= 90 ? "chip warn" : "chip";
    return { order: end, label, days, chip: '<span class="' + cls + '">' + (days === 0 ? "hoje" : "faltam " + days + (days === 1 ? " dia" : " dias")) + "</span>", closed: false };
  }
  function congCard({ a, d }) {
    return '<div class="item' + (d.closed ? " closed" : "") + '"><div class="title"><a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.name) + '</a></div><div class="sub">' + esc(a.org) + '</div><div class="meta">' + d.chip +
      (a.has ? "" : '<span class="chip muted">sem travel award</span>') + (a.warn ? '<span class="chip warn">elegibilidade</span>' : "") + "</div>" +
      '<dl class="grid2"><dt>Auxílio</dt><dd>' + esc(a.award) + "</dd><dt>Prazo</dt><dd>" + esc(d.label) + " · " + esc(a.kind) + "</dd><dt>Evento</dt><dd>" + esc(a.event) + "</dd><dt>Local</dt><dd>" + esc(a.place) + "</dd></dl>" +
      (a.note ? '<div class="sub">' + esc(a.note) + "</div>" : "") + "</div>";
  }
  function renderCong() {
    if (!cong) { $("cong").innerHTML = '<div class="skel"></div><div class="skel"></div>'; return; }
    const all = cong.congressos.map((a) => ({ a, d: deadlineInfo(a) })).sort((x, y) => x.d.order - y.d.order);
    const rows = all.filter((r) => congFilter === "all" || (congFilter === "yes" ? r.a.has : !r.a.has));
    document.querySelectorAll("[data-f]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.f === congFilter)));
    $("cf-yes").textContent = "(" + all.filter((r) => r.a.has).length + ")";
    $("cf-no").textContent = "(" + all.filter((r) => !r.a.has).length + ")";
    $("cong-verified").textContent = "verificado em " + fmtShort.format(new Date(cong.verificadoEm + "T12:00:00Z")).replace(/\./g, "");
    $("cong").innerHTML = '<div class="list">' + rows.map(congCard).join("") + "</div>";
    const next = all.find((r) => r.a.has && !r.d.closed && r.d.days !== undefined);
    if (next) tile("t-award", next.a.name.split(" · ")[0], next.d.label + " · faltam " + next.d.days + (next.d.days === 1 ? " dia" : " dias"), next.d.days <= 30);
    const soon = all.filter((r) => !r.d.closed && r.d.days !== undefined && r.d.days <= 60);
    $("home-deadlines").innerHTML = soon.length ? '<div class="list">' + soon.map(congCard).join("") + "</div>" : '<div class="note">Nenhum prazo nos próximos 60 dias.</div>';
  }
  document.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { congFilter = b.dataset.f; renderCong(); }));

  async function loadJSON(path) {
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(path + ": erro " + r.status);
    return r.json();
  }
  async function loadData() {
    try { cong = await loadJSON("data/congressos.json"); store.set("cong-cache", cong); }
    catch (e) { if (!cong) $("cong").innerHTML = '<div class="note err"><b>Não consegui carregar a lista de congressos.</b> ' + esc(e.message) + "</div>"; }
    renderCong();
    try { const t = await loadJSON("data/temas.json"); temas = t.temas || []; store.set("temas-cache", temas); }
    catch (e) { temas = store.get("temas-cache", []); }
  }

  /* ---------- Utilidades de UI ---------- */
  function tile(id, v, s, attn) {
    const el = $(id);
    el.querySelector(".v").textContent = v;
    el.querySelector(".s").textContent = s || "";
    el.classList.toggle("attn", !!attn);
  }
  document.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-act=connect]")) connectGoogle();
    if (ev.target.closest("[data-go-set]")) show("set");
  });
  $("btn-connect").addEventListener("click", connectGoogle);
  $("btn-disconnect").addEventListener("click", disconnectGoogle);
  $("client-id").value = clientId();
  $("client-id").addEventListener("change", () => { store.set("g-client-id", $("client-id").value.trim()); tokenClient = null; });
  $("app-version").textContent = APP_VERSION;

  async function refreshAll(force) {
    $("btn-refresh").classList.add("spin");
    await Promise.allSettled([loadCalendar(), loadData().then(() => loadPubmed(force))]);
    $("btn-refresh").classList.remove("spin");
  }
  $("btn-refresh").addEventListener("click", () => refreshAll(true));

  function setOnline() { $("offline-banner").hidden = navigator.onLine; }
  window.addEventListener("online", () => { setOnline(); refreshAll(false); });
  window.addEventListener("offline", setOnline);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - calFetchedAt > CAL_REFRESH_MS) loadCalendar();
    if (Date.now() - pubFetchedAt > PUB_REFRESH_MS) loadPubmed(false);
    renderCong();
  });
  setInterval(() => { if (document.visibilityState === "visible") loadCalendar(); }, CAL_REFRESH_MS);
  setInterval(() => { if (document.visibilityState === "visible") loadPubmed(false); }, PUB_REFRESH_MS);
  setInterval(() => { setToday(); renderAgenda(); renderCong(); }, 60000);

  /* ---------- Instalação e atualização do app ---------- */
  let installEvt = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $("btn-install").hidden = false; });
  $("btn-install").addEventListener("click", async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; $("btn-install").hidden = true; });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloading) { reloading = true; location.reload(); } });
    navigator.serviceWorker.register("sw.js").then((reg) => {
      const offer = (w) => { $("update-banner").hidden = false; $("btn-update").onclick = () => w.postMessage("skipWaiting"); };
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) offer(w); });
      });
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
    }).catch(() => {});
  }

  /* ---------- Início ---------- */
  setToday(); setOnline(); updateGStatus();
  show((location.hash || "#home").slice(1));
  renderAgenda(); renderCong(); renderPub();
  window.addEventListener("load", () => { if (getToken()) initGis(); });
  refreshAll(false);
})();
