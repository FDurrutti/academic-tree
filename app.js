(function () {
  "use strict";

  const C = Object.assign({
    title: "Academic Family Tree", department: "", sheetId: "", tabs: {},
    formUrl: "", formPrefillUrl: "", saveInPage: true,
    roleChair: "Chair", roleCommittee: "Committee member", actionAdd: "Add", actionRemove: "Remove", actionRename: "Rename", actionField: "Field", actionConfirm: "Confirm", actionUnconfirm: "Unconfirm",
  }, window.TREE_CONFIG || {});
  C.tabs = Object.assign({ faculty: "Faculty", connections: "Connections", responses: "Responses", people: "People" }, C.tabs);
  const SEED = window.TREE_SEED || { faculty: [], connections: [], people: [] };
  const SVG_NS = "http://www.w3.org/2000/svg";
  const NAME_FONT = "600 13px Inter, system-ui, sans-serif";
  const SUB_FONT = "400 11px Inter, system-ui, sans-serif";
  const READABLE = 0.9;
  const MAX_NAMES = 6;
  const TOP_FACTS = 6;
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);

  const FIELD_GROUPS = [
    ["polisci", "Political science", ["political science"]],
    ["history", "History", ["history"]],
    ["psych", "Psychology", ["psychology"]],
    ["anthro", "Anthropology", ["anthropology"]],
    ["philo", "Philosophy", ["philosophy"]],
    ["edu", "Education", ["education"]],
    ["science", "Natural sciences and math", ["physics", "chemistry", "mathematics", "physiology", "biology"]],
  ];
  const FIELD_LABELS = Object.fromEntries(FIELD_GROUPS.map(([id, label]) => [id, label]).concat([["other", "Other fields"]]));
  function fieldGroup(field) {
    const f = String(field || "").toLowerCase().trim();
    if (!f || f === "sociology") return null;
    const hit = FIELD_GROUPS.find(([, , words]) => words.some((w) => f.includes(w)));
    return hit ? hit[0] : "other";
  }

  function setProps(el, props) {
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === "text") el.textContent = v;
      else if (k === "value") el.value = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    });
  }
  function make(ns, tag, props, kids) {
    const el = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
    setProps(el, props);
    kids.flat().forEach((kid) => { if (kid != null && kid !== false) el.append(kid); });
    return el;
  }
  const h = (tag, props, ...kids) => make(null, tag, props, kids);
  const s = (tag, props, ...kids) => make(SVG_NS, tag, props, kids);
  const fill = (el, kids) => el.replaceChildren(...kids.flat().filter((kid) => kid != null && kid !== false));

  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    const filled = rows.filter((r) => r.some((v) => v.trim()));
    if (!filled.length) return [];
    const header = filled[0].map((v) => v.trim());
    return filled.slice(1).map((r) => Object.fromEntries(header.map((name, j) => [name, (r[j] || "").trim()])));
  }

  const SPECS = {
    faculty: [["name", ["name"]]],
    people: [["field", ["field"]], ["affiliation", ["institution", "academic tree"]], ["name", ["name"]]],
    connections: [["role", ["role"]], ["others", ["other advisor", "second"]], ["advisor", ["advisor", "committee"]],
      ["institution", ["institution"]], ["year", ["year"]], ["source", ["source", "note"]],
      ["person", ["person", "student", "name"]]],
    responses: [["time", ["timestamp"]], ["institution", ["institution"]], ["year", ["year"]], ["role", ["role"]],
      ["action", ["action", "correct"]], ["others", ["other advisor", "second"]], ["advisor", ["advisor", "committee"]],
      ["person", ["person", "student"]]],
  };
  function resolve(rows, spec) {
    if (!rows.length) return [];
    const headers = Object.keys(rows[0]);
    const used = new Set(), map = {};
    spec.forEach(([field, words]) => {
      for (const w of words) {
        const header = headers.find((hd) => !used.has(hd) && hd.toLowerCase().includes(w));
        if (header) { map[field] = header; used.add(header); return; }
      }
    });
    return rows.map((r) => Object.fromEntries(Object.entries(map).map(([f, hd]) => [f, String(r[hd] ?? "").trim()])));
  }

  async function fetchTab(tab) {
    const url = "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(C.sheetId.trim()) +
      "/gviz/tq?tqx=out:csv&headers=1&sheet=" + encodeURIComponent(tab);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`the sheet answered ${res.status} for the “${tab}” tab`);
    return parseCSV(await res.text());
  }
  function seedData() {
    return {
      live: false,
      faculty: SEED.faculty.map((name) => ({ name })),
      connections: resolve(SEED.connections, SPECS.connections),
      people: resolve(SEED.people || [], SPECS.people),
      responses: [],
    };
  }
  async function fetchResponses() {
    const names = [...new Set([C.tabs.responses, "Responses", "Form Responses 1"].filter(Boolean))];
    for (const name of names) {
      try {
        const rows = resolve(await fetchTab(name), SPECS.responses);
        if (rows.length && "person" in rows[0] && "advisor" in rows[0]) return rows;
      } catch (e) { }
    }
    return [];
  }
  async function loadData() {
    if (!C.sheetId.trim()) return seedData();
    try {
      const [faculty, connections, responses, people] = await Promise.all([
        fetchTab(C.tabs.faculty), fetchTab(C.tabs.connections),
        fetchResponses(), fetchTab(C.tabs.people).catch(() => []),
      ]);
      const data = {
        live: true,
        faculty: resolve(faculty, SPECS.faculty),
        connections: resolve(connections, SPECS.connections),
        people: resolve(people, SPECS.people).filter((r) => "name" in r),
        responses,
      };
      if (!data.faculty.length || !("name" in data.faculty[0])) {
        throw new Error(`the “${C.tabs.faculty}” tab needs a Name column`);
      }
      if (data.connections.length && !("person" in data.connections[0] && "advisor" in data.connections[0])) {
        throw new Error(`the “${C.tabs.connections}” tab needs Person and Advisor columns`);
      }
      return data;
    } catch (err) {
      console.warn(err);
      return Object.assign(seedData(), { error: err.message || String(err) });
    }
  }

  const MARKERS = { PERSON: "person", NAME: "advisor", ADVISOR: "advisor", ROLE: "role", ACTION: "action",
    INSTITUTION: "institution", YEAR: "year" };
  const FORM = (() => {
    const template = (C.formPrefillUrl || "").trim();
    if (!template) return null;
    try {
      const url = new URL(template);
      const fields = {};
      url.searchParams.forEach((value, key) => {
        if (key.startsWith("entry.") && MARKERS[value]) fields[MARKERS[value]] = key;
      });
      const action = url.origin + url.pathname.replace(/\/viewform$/, "/formResponse");
      const ready = !!(fields.person && fields.advisor && fields.role && fields.action) && action.endsWith("/formResponse");
      return { url, fields, action, ready };
    } catch (e) {
      return null;
    }
  })();
  const canSave = !!(FORM && FORM.ready) && C.saveInPage !== false;

  function formLink(personName, advisorName, role) {
    if (!FORM) return (C.formUrl || "").trim() || null;
    const url = new URL(FORM.url.toString());
    const values = { person: personName, advisor: advisorName, role: role || "", action: C.actionAdd };
    [...url.searchParams.entries()].forEach(([key, value]) => {
      const field = MARKERS[value];
      if (!field) return;
      const text = values[field] || "";
      if (text) url.searchParams.set(key, text); else url.searchParams.delete(key);
    });
    return url.toString();
  }

  async function saveEntry(entry) {
    const body = new URLSearchParams();
    body.append(FORM.fields.person, entry.person);
    body.append(FORM.fields.advisor, entry.advisor);
    body.append(FORM.fields.role, entry.role === "committee" ? C.roleCommittee : C.roleChair);
    body.append(FORM.fields.action, actionText(entry));
    if (FORM.fields.institution && entry.institution) body.append(FORM.fields.institution, entry.institution);
    if (FORM.fields.year && entry.year) body.append(FORM.fields.year, entry.year);
    await fetch(FORM.action, { method: "POST", mode: "no-cors", body });
  }

  const PENDING_KEY = "academic-tree-pending-v2";
  const isRemove = (text) => /remove|delete/i.test(text || "");
  const isRename = (text) => /rename|correct name/i.test(text || "");
  const isCommittee = (text) => /committee/i.test(text || "");
  const isFieldChange = (text) => /field/i.test(text || "");
  const isUnconfirm = (text) => /unconfirm/i.test(text || "");
  const isConfirm = (text) => /confirm/i.test(text || "") && !isUnconfirm(text);
  const roleOf = (text) => (isCommittee(text) ? "committee" : "chair");
  const roleLabel = (role) => (role === "committee" ? "committee member" : "chair");
  const kindOf = (entry) => (entry.unconfirm ? "unconfirm" : entry.confirm ? "confirm" : entry.fieldChange ? "field"
    : entry.rename ? "rename" : entry.remove ? "remove" : "add");
  const kindOfRow = (row) => (isUnconfirm(row.action) ? "unconfirm" : isConfirm(row.action) ? "confirm"
    : isFieldChange(row.action) ? "field" : isRename(row.action) ? "rename" : isRemove(row.action) ? "remove" : "add");
  const actionText = (entry) => ({ unconfirm: C.actionUnconfirm, confirm: C.actionConfirm, field: C.actionField,
    rename: C.actionRename, remove: C.actionRemove, add: C.actionAdd })[kindOf(entry)];
  function reverseOf(e) {
    const kind = kindOf(e);
    if (kind === "rename") return { person: e.advisor, advisor: e.person, rename: true };
    if (kind === "field") return { person: e.person, advisor: e.prev || "Sociology", fieldChange: true, prev: e.advisor };
    if (kind === "confirm") return { person: e.person, advisor: "Unconfirmed", unconfirm: true };
    if (kind === "unconfirm") return { person: e.person, advisor: "Confirmed", confirm: true };
    return { person: e.person, advisor: e.advisor, role: e.role, remove: kind === "add" };
  }
  function readPending() {
    try {
      const list = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
      return Array.isArray(list) ? list.filter((e) => Date.now() - e.savedAt < 15 * 60 * 1000) : [];
    } catch (e) {
      return [];
    }
  }
  function writePending(list) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); } catch (e) { }
  }
  const entryId = (person, advisor, kind, role) => [nameKey(person), String(advisor || "").trim().toLowerCase(), kind,
    kind === "add" || kind === "remove" ? role : ""].join("|");
  const idOfEntry = (e) => entryId(e.person, e.advisor, kindOf(e), e.role === "committee" ? "committee" : "chair");
  const idOfRow = (r) => entryId(r.person, r.advisor, kindOfRow(r), roleOf(r.role));
  function countIds(rows) {
    const counts = new Map();
    rows.forEach((r) => { const id = idOfRow(r); counts.set(id, (counts.get(id) || 0) + 1); });
    return counts;
  }
  function pendingRow(e) {
    return { person: e.person, advisor: e.advisor, role: e.role === "committee" ? C.roleCommittee : C.roleChair,
      action: actionText(e), institution: e.institution || "", year: e.year || "", time: "just now" };
  }
  function mergePending(data) {
    data.sheet = data.responses;
    if (!canSave) return;
    const counts = countIds(data.sheet);
    const pending = readPending().filter((e) => (counts.get(idOfEntry(e)) || 0) <= (e.baseline || 0));
    writePending(pending);
    data.responses = data.sheet.concat(pending.map(pendingRow));
  }

  const SKIP_WORDS = new Set(["jr", "sr", "ii", "iii", "iv", "dr", "prof", "professor"]);
  const splitNames = (text) => String(text || "").split(/\s*(?:\r?\n|;)\s*/).map((t) => t.trim()).filter(Boolean);
  function nameKey(name) {
    const words = String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[.,()"'’]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !SKIP_WORDS.has(w));
    if (!words.length) return "";
    return words.length === 1 ? words[0] : words[0] + " " + words[words.length - 1];
  }

  function buildModel(data) {
    const people = new Map(), links = new Map(), recent = [];
    const linkId = (studentKey, advisorKey) => studentKey + "\u0001" + advisorKey;
    const tidy = (text) => String(text || "").replace(/\s+/g, " ").trim();
    const aliases = new Map(), chosenName = new Map();
    const resolveKey = (key) => {
      const seen = new Set();
      while (aliases.has(key) && !seen.has(key)) { seen.add(key); key = aliases.get(key); }
      return key;
    };
    data.responses.forEach((row) => {
      if (kindOfRow(row) !== "rename") return;
      const from = resolveKey(nameKey(row.person)), toName = tidy(row.advisor), to = nameKey(toName);
      if (!from || !to) return;
      if (from !== to) { aliases.delete(to); aliases.set(from, to); }
      chosenName.set(to, toName);
    });
    function person(raw) {
      const name = tidy(raw);
      const rawKey = nameKey(name);
      if (!rawKey) return null;
      const key = resolveKey(rawKey);
      const display = key === rawKey ? name : chosenName.get(key) || name;
      let p = people.get(key);
      if (!p) {
        p = { key, name: display, faculty: false, confirmed: false, institution: "", year: "", affiliation: "", field: "",
          chairs: [], committee: [], chaired: [], servedOn: [], advisors: [], students: [] };
        people.set(key, p);
      } else if (display.length > p.name.length) {
        p.name = display;
      }
      return p;
    }
    function connect(student, advisor, role, source) {
      if (!student || !advisor || student.key === advisor.key) return;
      links.set(linkId(student.key, advisor.key), { student: student.key, advisor: advisor.key, role, source });
    }
    function describe(p, row) {
      if (row.institution) p.institution = row.institution;
      if (row.year) p.year = row.year;
    }

    data.faculty.forEach((row) => { const p = person(row.name); if (p) p.faculty = true; });
    data.connections.forEach((row) => {
      const p = person(row.person);
      if (!p) return;
      describe(p, row);
      const role = roleOf(row.role);
      [row.advisor, ...splitNames(row.others)].forEach((name) => connect(p, person(name), role, row.source || "Starting data"));
    });

    const baseField = new Map(), fieldNow = new Map(), confirmed = new Map();
    (data.people || []).forEach((row) => { if (row.field) baseField.set(resolveKey(nameKey(row.name)), row.field); });
    data.responses.forEach((row) => {
      const kind = kindOfRow(row);
      const when = row.time || "";
      if (kind === "rename") {
        const p = person(row.advisor);
        if (p) recent.push({ person: p.key, kind, from: tidy(row.person), to: tidy(row.advisor), when,
          undo: [{ person: tidy(row.advisor), advisor: tidy(row.person), rename: true }] });
        return;
      }
      const p = person(row.person);
      if (!p) return;
      if (kind === "field") {
        const value = tidy(row.advisor);
        if (!value) return;
        const prev = fieldNow.has(p.key) ? fieldNow.get(p.key) : baseField.get(p.key) || "Sociology";
        fieldNow.set(p.key, value);
        recent.push({ person: p.key, kind, value, when, undo: [{ person: p.name, advisor: prev, fieldChange: true, prev: value }] });
        return;
      }
      if (kind === "confirm" || kind === "unconfirm") {
        confirmed.set(p.key, kind === "confirm");
        recent.push({ person: p.key, kind, when, undo: [reverseOf(kind === "confirm"
          ? { person: p.name, advisor: "Confirmed", confirm: true } : { person: p.name, advisor: "Unconfirmed", unconfirm: true })] });
        return;
      }
      const names = [row.advisor, ...splitNames(row.others)].map(person).filter(Boolean);
      const role = roleOf(row.role);
      if (kind === "remove") {
        names.forEach((a) => links.delete(linkId(p.key, a.key)));
      } else {
        describe(p, row);
        names.forEach((a) => connect(p, a, role, "Added by a member of the department"));
      }
      recent.push({ person: p.key, kind, names: names.map((a) => a.name), role, when,
        undo: names.map((a) => ({ person: p.name, advisor: a.name, role, remove: kind === "add" })) });
    });

    const advisorsOf = new Map();
    links.forEach((l) => advisorsOf.set(l.student, (advisorsOf.get(l.student) || []).concat(l.advisor)));
    const keep = new Set();
    const stack = [...people.values()].filter((p) => p.faculty).map((p) => p.key);
    while (stack.length) {
      const key = stack.pop();
      if (keep.has(key)) continue;
      keep.add(key);
      (advisorsOf.get(key) || []).forEach((a) => stack.push(a));
    }
    [...links.keys()].forEach((id) => { if (!keep.has(links.get(id).student)) links.delete(id); });

    links.forEach((l) => {
      const student = people.get(l.student), advisor = people.get(l.advisor);
      (l.role === "chair" ? student.chairs : student.committee).push(advisor.key);
      (l.role === "chair" ? advisor.chaired : advisor.servedOn).push(student.key);
      student.advisors.push(advisor.key);
      advisor.students.push(student.key);
    });
    (data.people || []).forEach((row) => {
      const p = people.get(resolveKey(nameKey(row.name)));
      if (!p) return;
      if (row.affiliation) p.affiliation = row.affiliation;
      if (row.field) p.field = row.field;
    });
    fieldNow.forEach((value, key) => { if (people.has(key)) people.get(key).field = value; });
    confirmed.forEach((value, key) => { if (people.has(key)) people.get(key).confirmed = value; });
    chosenName.forEach((name, key) => { if (people.has(key)) people.get(key).name = name; });
    [...people.values()].forEach((p) => {
      if (!p.faculty && !p.advisors.length && !p.students.length) people.delete(p.key);
    });
    return { people, links, recent: recent.reverse().filter((r) => people.has(r.person)) };
  }

  let showCommittee = true;
  function walk(key, direction) {
    const list = showCommittee ? direction : direction === "advisors" ? "chairs" : "chaired";
    const seen = new Set([key]), stack = [key];
    while (stack.length) {
      const p = model.people.get(stack.pop());
      if (!p) continue;
      p[list].forEach((next) => { if (!seen.has(next)) { seen.add(next); stack.push(next); } });
    }
    return seen;
  }
  function chairLine(key) {
    const seen = new Set([key]), stack = [key];
    while (stack.length) {
      model.people.get(stack.pop()).chairs.forEach((next) => { if (!seen.has(next)) { seen.add(next); stack.push(next); } });
    }
    return seen;
  }
  const byLastName = (a, b) => a.name.split(" ").pop().localeCompare(b.name.split(" ").pop());
  const subLine = (p) => [p.institution, p.year].filter(Boolean).join(", ");
  const nodeLabel = (p) => (p.faculty && p.confirmed ? p.name + "  ✓" : p.name);
  const firstName = (p) => p.name.split(" ")[0];
  const listText = (names) => names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];

  const measure = document.createElement("canvas").getContext("2d");
  function textWidth(text, font) { measure.font = font; return measure.measureText(text).width; }

  function familyKey(key) {
    const path = [];
    let p = model.people.get(key);
    const seen = new Set();
    while (p && !seen.has(p.key)) {
      seen.add(p.key);
      path.unshift(p.name);
      const next = p.chairs.map((k) => model.people.get(k)).sort(byLastName)[0];
      p = next;
    }
    return path.join(" › ");
  }

  function familyOrder(shown) {
    const order = [], seen = new Set();
    function visit(key) {
      if (seen.has(key) || !shown.has(key)) return;
      seen.add(key);
      order.push(key);
      const p = model.people.get(key);
      p.chairs.concat(showCommittee ? p.committee : []).forEach(visit);
    }
    [...model.people.values()].filter((p) => p.faculty)
      .sort((a, b) => familyKey(a.key).localeCompare(familyKey(b.key)))
      .forEach((p) => visit(p.key));
    shown.forEach((key) => { if (!seen.has(key)) order.push(key); });
    return order;
  }

  function visiblePeople() {
    if (showCommittee) return new Set(model.people.keys());
    const shown = new Set();
    model.people.forEach((p) => { if (p.faculty) chairLine(p.key).forEach((k) => shown.add(k)); });
    return shown;
  }

  function buildLayout(direction, shown, order) {
    const g = new dagre.graphlib.Graph();
    const sideways = direction === "LR";
    g.setGraph({ rankdir: direction, ranker: "longest-path", nodesep: sideways ? 10 : 16,
      ranksep: sideways ? 46 : 54, marginx: 24, marginy: 24 });
    g.setDefaultEdgeLabel(() => ({}));
    order.forEach((key) => {
      const p = model.people.get(key);
      const sub = subLine(p);
      const width = Math.ceil(Math.max(textWidth(nodeLabel(p), NAME_FONT), sub ? textWidth(sub, SUB_FONT) : 0)) + 24;
      g.setNode(key, { width, height: sub ? 42 : 30 });
      if (p.faculty && !p.chairs.length) {
        g.setNode("?" + key, { width: 96, height: 30, missingFor: key });
        g.setEdge("?" + key, key, { weight: 10, role: "chair" });
      }
    });
    order.forEach((key) => {
      const p = model.people.get(key);
      p.chairs.forEach((a) => { if (shown.has(a)) g.setEdge(a, key, { weight: 10, role: "chair" }); });
      if (showCommittee) p.committee.forEach((a) => { if (shown.has(a)) g.setEdge(a, key, { weight: 1, role: "committee" }); });
    });
    dagre.layout(g);
    return g;
  }

  function layout() {
    const r = svgEl.getBoundingClientRect();
    const shown = visiblePeople();
    const order = familyOrder(shown);
    const scale = (g) => Math.min(r.width / (g.graph().width || 1), r.height / (g.graph().height || 1));
    return ["LR", "TB"].map((d) => buildLayout(d, shown, order)).sort((a, b) => scale(b) - scale(a))[0];
  }

  function pathFor(points, direction) {
    const [a, b] = [points[0], points[points.length - 1]];
    if (points.length === 2 && direction === "LR") {
      const mx = (a.x + b.x) / 2;
      return `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`;
    }
    if (points.length === 2) {
      const my = (a.y + b.y) / 2;
      return `M${a.x},${a.y} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`;
    }
    let d = `M${a.x},${a.y}`;
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i], n = points[i + 1];
      d += ` Q${p.x},${p.y} ${(p.x + n.x) / 2},${(p.y + n.y) / 2}`;
    }
    return d + ` L${b.x},${b.y}`;
  }

  let lastData = null, model = null, graph = null, selected = null;
  const view = { k: 1, x: 0, y: 0 };
  let movedByUser = false, dragged = false;
  const svgEl = $("tree"), viewport = $("viewport"), edgesEl = $("edges"), nodesEl = $("nodes");

  function missingNode(n, key, transform) {
    const owner = model.people.get(n.missingFor);
    const inner = [s("rect", { width: n.width, height: n.height, rx: 8 }),
      s("text", { x: n.width / 2, y: n.height / 2, text: "+ Add chair" })];
    let el;
    if (canSave) {
      const open = () => showAddForm("chair", owner.key);
      el = s("g", { class: "node missing", transform, tabindex: "0", role: "button",
        "aria-label": `Add the PhD chair of ${owner.name}`,
        onclick: (e) => { e.stopPropagation(); if (!dragged) open(); },
        onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } } }, inner);
    } else {
      const href = formLink(owner.name, "", C.roleChair);
      el = href
        ? s("a", { class: "node missing", transform, href, target: "_blank", rel: "noopener",
            "aria-label": `Add the PhD chair of ${owner.name}`,
            onclick: (e) => { if (dragged) e.preventDefault(); e.stopPropagation(); } }, inner)
        : s("g", { class: "node missing", transform, "aria-hidden": "true" }, inner);
    }
    el.dataset.key = key;
    el.dataset.owner = n.missingFor;
    return el;
  }

  function render() {
    edgesEl.replaceChildren(...graph.edges().map((e) => {
      const label = graph.edge(e);
      const path = s("path", {
        class: "edge" + (label.role === "committee" ? " committee" : "") + (graph.node(e.v).missingFor ? " edge-missing" : ""),
        d: pathFor(label.points, graph.graph().rankdir),
      });
      path.dataset.from = e.v;
      path.dataset.to = e.w;
      return path;
    }));
    nodesEl.replaceChildren(...graph.nodes().map((key) => {
      const n = graph.node(key);
      const transform = `translate(${n.x - n.width / 2},${n.y - n.height / 2})`;
      if (n.missingFor) return missingNode(n, key, transform);
      const p = model.people.get(key);
      const sub = subLine(p);
      const group = p.faculty ? null : fieldGroup(p.field);
      const el = s("g", {
        class: "node " + (p.faculty ? "faculty" : "ancestor") + (group ? " field-" + group : ""),
        transform, tabindex: "0", role: "button",
        "aria-label": `${p.name}${p.faculty ? ", department faculty" : ""}${p.faculty && p.confirmed ? ", confirmed" : ""}${group ? ", " + p.field : ""}. Show details.`,
        onclick: (e) => { e.stopPropagation(); if (!dragged) select(key, false); },
        onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(key, false); } },
      },
        s("rect", { width: n.width, height: n.height, rx: 8 }),
        s("text", { class: "name", x: n.width / 2, y: sub ? 15 : n.height / 2, text: nodeLabel(p) }),
        sub ? s("text", { class: "sub", x: n.width / 2, y: 30, text: sub }) : null);
      el.dataset.key = key;
      return el;
    }));
    highlight();
  }

  function highlight() {
    const active = selected && model.people.has(selected) && graph.node(selected);
    const family = active ? new Set([...walk(selected, "advisors"), ...walk(selected, "students")]) : null;
    $("stage").classList.toggle("has-selection", !!family);
    nodesEl.childNodes.forEach((el) => {
      const key = el.dataset.owner ? null : el.dataset.key;
      el.classList.toggle("on", !!family && (key ? family.has(key) : el.dataset.owner === selected));
      el.classList.toggle("selected", !!family && key === selected);
    });
    edgesEl.childNodes.forEach((el) => {
      const from = el.dataset.from, to = el.dataset.to;
      el.classList.toggle("on", !!family && family.has(to) && (family.has(from) || (from.startsWith("?") && to === selected)));
    });
  }

  function select(key, center) {
    if (!model.people.has(key)) return;
    selected = key;
    highlight();
    showPanel(key);
    if (center || hiddenByPanel(key)) centerOn(key);
  }
  function clearSelection() {
    selected = null;
    highlight();
    $("panel").hidden = true;
  }
  const closeButton = () => h("button", { class: "panel-close", type: "button", "aria-label": "Close", onclick: clearSelection, text: "×" });
  const section = (title, body) => h("div", {}, h("h3", { text: title }), body);
  const muted = (text) => h("p", { class: "muted", text });

  function personList(owner, keys, role) {
    return h("ul", { class: "people-list" }, keys.map((k) => model.people.get(k)).sort(byLastName).map((q) =>
      h("li", {},
        h("button", { class: "linkish", type: "button", onclick: () => select(q.key, true), text: q.name }),
        role && canSave ? h("button", { class: "remove", type: "button", text: "Remove",
          "aria-label": `Remove ${q.name} as ${owner.name}'s ${roleLabel(role)}`, onclick: () => confirmRemove(owner, q, role) }) : null)));
  }

  function showPanel(key) {
    const p = model.people.get(key);
    const first = firstName(p);
    const hasFacultyBelow = [...walk(key, "students")].some((k) => k !== key && model.people.get(k).faculty);
    const sources = [...new Set([...model.links.values()].filter((l) => l.student === key).map((l) => l.source))];
    const actions = canSave
      ? [h("button", { class: "btn small primary", type: "button", onclick: () => showAddForm("chair", key), text: "+ Add chair" }),
         h("button", { class: "btn small", type: "button", onclick: () => showAddForm("committee", key), text: "+ Add committee member" })]
      : [formLinkButton("+ Add chair", formLink(p.name, "", C.roleChair), "primary"),
         formLinkButton("+ Add committee member", formLink(p.name, "", C.roleCommittee), "")];
    fill($("panel"), [
      closeButton(),
      h("p", { class: "panel-kind", text: p.faculty ? "Our faculty" : hasFacultyBelow ? "Academic ancestor" : "In the tree" }),
      h("h2", { text: p.name }),
      canSave ? h("button", { class: "linkish small-link", type: "button", text: "Correct the name", onclick: () => showRenameForm(key) }) : null,
      subLine(p) ? h("p", { class: "panel-sub", text: "PhD: " + subLine(p) }) : null,
      p.affiliation ? h("p", { class: "panel-sub", text: "Academic Tree lists: " + p.affiliation }) : null,
      h("p", { class: "panel-sub" }, "Field: " + (fieldGroup(p.field) ? p.field : "Sociology"),
        canSave ? [" ", h("button", { class: "linkish", type: "button", text: "Change", onclick: () => showFieldForm(key) })] : null),
      section(p.chairs.length > 1 ? "Chairs" : "Chair", p.chairs.length ? personList(p, p.chairs, "chair") : muted("Not in the tree yet.")),
      section("Committee members", p.committee.length ? personList(p, p.committee, "committee") : muted("None in the tree yet.")),
      p.chaired.length ? section("Chaired", personList(p, p.chaired, null)) : null,
      p.servedOn.length ? section("On the committee of", personList(p, p.servedOn, null)) : null,
      sources.length ? section("Where this comes from", h("ul", { class: "sources" }, sources.map((t) => h("li", { text: t })))) : null,
      h("div", { class: "panel-actions" }, actions),
      p.faculty && canSave ? confirmBox(p) : null,
      canSave ? null : h("p", { class: "form-foot", text: `Opens a short Google Form with ${first}'s name filled in.` }),
    ]);
    $("panel").hidden = false;
  }

  function formLinkButton(label, href, cls) {
    return href
      ? h("a", { class: "btn small " + cls, href, target: "_blank", rel: "noopener", text: label })
      : h("button", { class: "btn small " + cls, type: "button", disabled: true, title: "Adding isn't set up yet.", text: label });
  }

  function recordEntries(entries) {
    const counts = countIds(lastData.sheet || []);
    const pending = readPending();
    entries.forEach((e) => {
      const id = idOfEntry(e);
      const baseline = (counts.get(id) || 0) + pending.filter((q) => idOfEntry(q) === id).length;
      pending.push(Object.assign({ savedAt: Date.now(), baseline }, e));
      lastData.responses.push(pendingRow(e));
    });
    writePending(pending);
    rebuild();
  }

  function confirmBox(p) {
    const box = h("input", { type: "checkbox", checked: p.confirmed ? true : null });
    box.addEventListener("change", () => setConfirmed(p, box.checked, box));
    return h("label", { class: "confirm-box" + (p.confirmed ? " is-on" : "") }, box,
      h("span", {},
        h("strong", { text: p.confirmed ? "Confirmed: my information is complete" : "My information is complete and correct" }),
        h("small", { text: p.confirmed
          ? "Thank you! The tree team has your confirmation. Uncheck this if you want to make changes."
          : "Check this when you're done, so the tree team knows. You can uncheck it anytime." })));
  }

  async function setConfirmed(p, on, box) {
    box.disabled = true;
    const entry = on ? { person: p.name, advisor: "Confirmed", confirm: true } : { person: p.name, advisor: "Unconfirmed", unconfirm: true };
    try {
      await saveEntry(entry);
    } catch (err) {
      box.checked = !on;
      box.disabled = false;
      toast("It couldn't be saved. Check your internet connection and try again.");
      return;
    }
    recordEntries([entry]);
    select(p.key, false);
    toast(on ? `Thank you! ${p.name}'s information is marked as complete.` : `${p.name}'s information is open for changes again.`);
  }

  async function undo(entries) {
    $("toast").hidden = true;
    try {
      for (const e of entries) await saveEntry(e);
    } catch (err) {
      toast("The undo couldn't be saved. Check your internet connection and try again.");
      return;
    }
    recordEntries(entries);
    const first = entries[0];
    const key = nameKey(kindOf(first) === "rename" ? first.advisor : first.person);
    if (model.people.has(key)) select(key, false); else clearSelection();
    toast("Undone.");
  }

  function confirmRemove(owner, other, role) {
    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    const yes = h("button", { class: "btn small danger", type: "button", text: "Remove" });
    yes.addEventListener("click", async () => {
      yes.disabled = true;
      yes.textContent = "Removing…";
      const entry = { person: owner.name, advisor: other.name, role, remove: true };
      try {
        await saveEntry(entry);
      } catch (err) {
        error.textContent = "It couldn't be saved. Check your internet connection and try again.";
        error.hidden = false;
        yes.disabled = false;
        yes.textContent = "Remove";
        return;
      }
      recordEntries([entry]);
      select(owner.key, false);
      toast(`Removed ${other.name} as ${owner.name}'s ${roleLabel(role)}.`, [reverseOf(entry)]);
    });
    fill($("panel"), [
      closeButton(),
      h("p", { class: "panel-kind", text: owner.name }),
      h("h2", { text: `Remove ${other.name}?` }),
      h("p", { class: "panel-sub", text: `${other.name} will no longer show as ${owner.name}'s ${roleLabel(role)}, for everyone. You can add them back later.` }),
      error,
      h("div", { class: "panel-actions" }, yes,
        h("button", { class: "btn small", type: "button", text: "Cancel", onclick: () => showPanel(owner.key) })),
    ]);
    $("panel").hidden = false;
  }

  let formCount = 0;
  function showAddForm(mode, key, preset) {
    const p = key ? model.people.get(key) : null;
    const n = ++formCount;
    const id = (name) => `add${n}-${name}`;
    const role = mode === "committee" ? "committee" : "chair";
    const input = (name, label, props) => h("div", { class: "field" },
      h("label", { for: id(name), text: label }),
      h("input", Object.assign({ id: id(name), name: id(name), type: "text", autocomplete: "off" }, props || {})));
    const title = {
      chair: `Add ${p && firstName(p)}'s chair`,
      committee: `Add ${p && firstName(p)}'s committee members`,
      new: "Add someone to the tree",
    }[mode];
    const hint = {
      chair: "The chair (main advisor) of their PhD. Co-chairs? Add both. Names already in the tree are suggested as you type.",
      committee: "Members of their PhD committee. Add as many as you like.",
      new: "A faculty member's PhD chair, or the chair of someone already in the tree.",
    }[mode];

    const list = h("div", { class: "names-list" });
    const more = h("button", { class: "linkish", type: "button", text: mode === "committee" ? "+ Add another member" : "+ Add a co-chair" });
    const addBox = () => {
      const count = list.children.length;
      list.append(h("input", { type: "text", list: "names", autocomplete: "off", "data-name": "1",
        "aria-label": `${mode === "committee" ? "Committee member" : "Chair"} ${count + 1}` }));
      more.hidden = list.children.length >= MAX_NAMES;
    };
    more.addEventListener("click", () => { addBox(); list.lastChild.focus(); });
    addBox();

    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    const submit = h("button", { class: "btn primary small", type: "submit", text: "Add to the tree" });
    const form = h("form", { class: "add-form", novalidate: true },
      mode === "new" ? input("person", "Person's full name", { required: true, list: "names", value: (preset && preset.person) || "" }) : null,
      h("div", { class: "field" }, h("span", { class: "label", text: mode === "committee" ? "Committee members' full names" : "Chair's full name" }), list, more),
      mode !== "committee" ? h("div", { class: "field-row" },
        input("institution", "PhD institution (optional)", { value: p ? p.institution : "" }),
        input("year", "Year (optional)", { inputmode: "numeric", value: p ? p.year : "" })) : null,
      error,
      h("div", { class: "panel-actions" }, submit,
        h("button", { class: "btn small", type: "button", text: "Cancel", onclick: () => (p ? showPanel(p.key) : clearSelection()) })));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const clean = (text) => text.replace(/\s+/g, " ").trim();
      const value = (name) => (form.elements[id(name)] ? clean(form.elements[id(name)].value) : "");
      const personName = p ? p.name : value("person");
      const names = [...form.querySelectorAll("input[data-name]")].map((el) => clean(el.value)).filter(Boolean);
      const fullName = (name) => nameKey(name).includes(" ");
      const problem =
        !personName ? "Please type the person's name." :
        !names.length ? `Please type the ${roleLabel(role)}'s name.` :
        ![personName, ...names].every(fullName) ? "Please write full names, with first and last name." :
        names.some((a) => nameKey(a) === nameKey(personName)) ? "Someone can't be their own chair or committee member." : "";
      if (problem) { error.textContent = problem; error.hidden = false; return; }
      error.hidden = true;
      submit.disabled = true;
      submit.textContent = "Saving…";
      const entries = names.map((name, i) => ({ person: personName, advisor: name, role,
        institution: i === 0 ? value("institution") : "", year: i === 0 ? value("year") : "" }));
      try {
        for (const entry of entries) await saveEntry(entry);
      } catch (err) {
        error.textContent = "It couldn't be saved. Check your internet connection and try again.";
        error.hidden = false;
        submit.disabled = false;
        submit.textContent = "Add to the tree";
        return;
      }
      recordEntries(entries);
      const added = nameKey(personName);
      if (model.people.has(added)) {
        select(added, true);
        toast(role === "committee"
          ? `Added ${listText(names)} to ${personName}'s committee.`
          : `Added ${listText(names)} as ${personName}'s ${names.length > 1 ? "co-chairs" : "chair"}.`, entries.map(reverseOf));
      } else {
        clearSelection();
        toast(`Saved. ${personName} will appear once they're connected to one of our faculty.`);
      }
    });

    fill($("panel"), [
      closeButton(),
      h("p", { class: "panel-kind", text: p ? p.name : "New entry" }),
      h("h2", { text: title }),
      h("p", { class: "panel-sub", text: hint }),
      form,
    ]);
    $("panel").hidden = false;
    if (p) {
      selected = p.key;
      highlight();
      if (hiddenByPanel(p.key)) centerOn(p.key);
    }
    const firstEmpty = [...form.querySelectorAll("input")].find((el) => !el.value);
    if (firstEmpty) firstEmpty.focus({ preventScroll: true });
  }

  function showRenameForm(key) {
    const p = model.people.get(key);
    const inputId = `rename${++formCount}`;
    const field = h("input", { id: inputId, type: "text", autocomplete: "off", list: "names", value: p.name });
    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    const submit = h("button", { class: "btn primary small", type: "submit", text: "Save the name" });
    const form = h("form", { class: "add-form", novalidate: true },
      h("div", { class: "field" }, h("label", { for: inputId, text: "Full name" }), field),
      error,
      h("div", { class: "panel-actions" }, submit,
        h("button", { class: "btn small", type: "button", text: "Cancel", onclick: () => showPanel(key) })));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const newName = field.value.replace(/\s+/g, " ").trim();
      const problem =
        !newName ? "Please type the name." :
        !nameKey(newName).includes(" ") ? "Please write the full name, with first and last name." :
        newName === p.name ? "That's the name already shown." : "";
      if (problem) { error.textContent = problem; error.hidden = false; return; }
      error.hidden = true;
      submit.disabled = true;
      submit.textContent = "Saving…";
      const entry = { person: p.name, advisor: newName, rename: true };
      try {
        await saveEntry(entry);
      } catch (err) {
        error.textContent = "It couldn't be saved. Check your internet connection and try again.";
        error.hidden = false;
        submit.disabled = false;
        submit.textContent = "Save the name";
        return;
      }
      recordEntries([entry]);
      select(nameKey(newName), true);
      toast(`Changed “${p.name}” to “${newName}”.`, [reverseOf(entry)]);
    });
    const other = (name) => {
      const match = model.people.get(nameKey(name));
      return match && match.key !== key ? match : null;
    };
    const note = h("p", { class: "form-foot" });
    field.addEventListener("input", () => {
      const match = other(field.value);
      note.textContent = match ? `${match.name} is already in the tree. Saving merges the two into one person.` : "";
    });
    fill($("panel"), [
      closeButton(),
      h("p", { class: "panel-kind", text: p.name }),
      h("h2", { text: "Correct the name" }),
      h("p", { class: "panel-sub", text: "Fix a typo or add a missing middle name. The name changes everywhere in the tree." }),
      form,
      note,
    ]);
    $("panel").hidden = false;
    field.focus({ preventScroll: true });
    field.select();
  }

  const FIELD_CHOICES = ["Sociology", "Political science", "History", "Psychology", "Anthropology", "Philosophy",
    "Education", "Economics", "Physics", "Chemistry", "Mathematics", "Physiology", "Linguistics", "Geography",
    "Science and technology studies"];

  function showFieldForm(key) {
    const p = model.people.get(key);
    const n = ++formCount;
    const current = fieldGroup(p.field) ? p.field : "Sociology";
    const field = h("input", { id: `field${n}`, type: "text", autocomplete: "off", list: `field-choices${n}`, value: current });
    const choices = h("datalist", { id: `field-choices${n}` }, FIELD_CHOICES.map((c) => h("option", { value: c })));
    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    const submit = h("button", { class: "btn primary small", type: "submit", text: "Save the field" });
    const form = h("form", { class: "add-form", novalidate: true },
      h("div", { class: "field" }, h("label", { for: `field${n}`, text: "Field" }), field, choices),
      error,
      h("div", { class: "panel-actions" }, submit,
        h("button", { class: "btn small", type: "button", text: "Cancel", onclick: () => showPanel(key) })));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const typed = field.value.replace(/\s+/g, " ").trim();
      const value = FIELD_CHOICES.find((c) => c.toLowerCase() === typed.toLowerCase()) || typed;
      if (!value) { error.textContent = "Please choose or type a field."; error.hidden = false; return; }
      if (value === current) { error.textContent = "That's the field already shown."; error.hidden = false; return; }
      error.hidden = true;
      submit.disabled = true;
      submit.textContent = "Saving…";
      const entry = { person: p.name, advisor: value, fieldChange: true, prev: current };
      try {
        await saveEntry(entry);
      } catch (err) {
        error.textContent = "It couldn't be saved. Check your internet connection and try again.";
        error.hidden = false;
        submit.disabled = false;
        submit.textContent = "Save the field";
        return;
      }
      recordEntries([entry]);
      select(key, false);
      toast(`Changed ${p.name}'s field to ${value}.`, [reverseOf(entry)]);
    });
    fill($("panel"), [
      closeButton(),
      h("p", { class: "panel-kind", text: p.name }),
      h("h2", { text: "Change the field" }),
      h("p", { class: "panel-sub", text: "Pick a field from the list, or type another one." }),
      form,
    ]);
    $("panel").hidden = false;
    field.focus({ preventScroll: true });
    field.select();
  }

  function openAddFromOutside(mode, key, preset) {
    $("stage").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    showAddForm(mode, key, preset);
  }
  function openSelect(key) {
    $("stage").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    select(key, true);
  }

  let toastTimer;
  function toast(message, undoEntries) {
    const el = $("toast");
    const canUndo = !!(undoEntries && undoEntries.length && canSave);
    fill(el, [h("span", { text: message }),
      canUndo ? h("button", { class: "toast-undo", type: "button", text: "Undo", onclick: () => undo(undoEntries) }) : null,
      h("button", { class: "toast-close", type: "button", "aria-label": "Close this message", text: "×",
        onclick: () => { clearTimeout(toastTimer); el.hidden = true; } })]);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, canUndo ? 10000 : 5000);
  }

  function hiddenByPanel(key) {
    const n = graph.node(key);
    if (!n) return false;
    const r = svgEl.getBoundingClientRect();
    const right = (n.x + n.width / 2) * view.k + view.x;
    const bottom = (n.y + n.height / 2) * view.k + view.y;
    return r.width > 700 ? right > r.width - 370 : bottom > r.height * 0.4;
  }

  function apply() { viewport.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.k})`); }
  function zoomAt(px, py, factor) {
    const k = Math.min(3, Math.max(0.12, view.k * factor));
    const f = k / view.k;
    view.x = px - (px - view.x) * f;
    view.y = py - (py - view.y) * f;
    view.k = k;
    apply();
  }
  function zoomCenter(factor) {
    const r = svgEl.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, factor);
    movedByUser = true;
  }
  function fit() {
    if (!graph) return;
    const r = svgEl.getBoundingClientRect();
    const gw = graph.graph().width || 1, gh = graph.graph().height || 1;
    view.k = Math.max(0.12, Math.min(r.width / gw, r.height / gh, 1.1));
    view.x = (r.width - gw * view.k) / 2;
    view.y = (r.height - gh * view.k) / 2;
    apply();
  }
  function initialView() {
    if (!graph) return;
    const r = svgEl.getBoundingClientRect();
    const g = graph.graph();
    const gw = g.width || 1, gh = g.height || 1;
    if (Math.min(r.width / gw, r.height / gh) >= READABLE * 0.85) { fit(); return; }
    view.k = READABLE;
    if (g.rankdir === "LR") {
      view.x = r.width - gw * view.k;
      view.y = 0;
    } else {
      view.x = Math.min(0, (r.width - gw * view.k) / 2);
      view.y = r.height - gh * view.k;
    }
    apply();
    showHint(g.rankdir === "LR"
      ? "This is the newest part of the tree. Drag right to go back in time, or click Fit to see all of it."
      : "This is the newest part of the tree. Drag down to go back in time, or click Fit to see all of it.", 6000);
  }
  function centerOn(key) {
    const n = graph.node(key);
    if (!n) return;
    const r = svgEl.getBoundingClientRect();
    const panelOpen = !$("panel").hidden;
    const wide = r.width > 700;
    view.k = Math.max(view.k, 0.85);
    view.x = (panelOpen && wide ? (r.width - 360) / 2 : r.width / 2) - n.x * view.k;
    view.y = (panelOpen && !wide ? r.height * 0.22 : r.height / 2) - n.y * view.k;
    apply();
    movedByUser = true;
  }

  let hintTimer;
  function showHint(text, ms) {
    $("zoom-hint").textContent = text || "Pinch, or hold Ctrl and scroll, to zoom. Drag to move around.";
    $("zoom-hint").hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { $("zoom-hint").hidden = true; }, ms || 1600);
  }
  svgEl.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) { if ($("zoom-hint").hidden) showHint(); return; }
    e.preventDefault();
    const r = svgEl.getBoundingClientRect();
    const delta = Math.max(-60, Math.min(60, e.deltaY));
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-delta * 0.01));
    movedByUser = true;
  }, { passive: false });

  const pointers = new Map();
  let start = null, pinch = null;
  const distance = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  svgEl.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) { start = { x: e.clientX, y: e.clientY }; dragged = false; }
    if (pointers.size === 2) pinch = { dist: distance(), k: view.k };
  });
  window.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);
    if (pointers.size === 1) {
      if (!dragged && Math.hypot(cur.x - start.x, cur.y - start.y) < 5) return;
      dragged = true;
      view.x += cur.x - prev.x;
      view.y += cur.y - prev.y;
      apply();
      movedByUser = true;
    } else if (pointers.size === 2 && pinch) {
      const r = svgEl.getBoundingClientRect();
      const [a, b] = [...pointers.values()];
      dragged = true;
      zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, (pinch.k * distance() / pinch.dist) / view.k);
      movedByUser = true;
    }
  });
  const release = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  svgEl.addEventListener("click", () => { if (!dragged) clearSelection(); });
  $("zoom-in").addEventListener("click", () => zoomCenter(1.25));
  $("zoom-out").addEventListener("click", () => zoomCenter(0.8));
  $("zoom-fit").addEventListener("click", () => { fit(); movedByUser = false; });
  $("show-committee").addEventListener("change", (e) => {
    showCommittee = e.target.checked;
    if (!model) return;
    graph = layout();
    render();
    movedByUser = false;
    initialView();
  });
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!model || movedByUser) return;
      graph = layout();
      render();
      initialView();
    }, 200);
  });

  $("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const query = $("search").value.trim();
    const note = $("search-note");
    if (!query || !model) return;
    const q = query.toLowerCase();
    const hit = model.people.get(nameKey(query)) ||
      [...model.people.values()].find((p) => p.name.toLowerCase().includes(q));
    if (hit) {
      note.replaceChildren();
      if (!graph.node(hit.key) && !showCommittee) {
        $("show-committee").checked = true;
        $("show-committee").dispatchEvent(new Event("change"));
      }
      select(hit.key, true);
      return;
    }
    let action = null;
    if (canSave) {
      action = h("button", { class: "linkish", type: "button", text: "Add them to the tree",
        onclick: () => { note.replaceChildren(); showAddForm("new", null, { person: query }); } });
    } else if (formLink(query, "", C.roleChair)) {
      action = h("a", { href: formLink(query, "", C.roleChair), target: "_blank", rel: "noopener", text: "Add them with the form" });
    }
    fill(note, [`No one called “${query}” is in the tree yet. `, action]);
  });
  $("search").addEventListener("change", () => $("search-form").requestSubmit());

  function commonAncestors() {
    const sets = new Map();
    model.people.forEach((f) => {
      if (!f.faculty) return;
      chairLine(f.key).forEach((k) => {
        if (k === f.key) return;
        if (!sets.has(k)) sets.set(k, new Set());
        sets.get(k).add(f.key);
      });
    });
    const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
    return [...sets]
      .filter(([, set]) => set.size > 1)
      .filter(([key, set]) => !model.people.get(key).chaired.some((st) => sets.has(st) && same(sets.get(st), set)))
      .sort((a, b) => b[1].size - a[1].size || byLastName(model.people.get(a[0]), model.people.get(b[0])));
  }

  let factsExpanded = false;
  function renderFacts() {
    const rows = commonAncestors();
    const shown = factsExpanded ? rows : rows.slice(0, TOP_FACTS);
    fill($("facts"), shown.length ? shown.map(([key, set]) => {
      const p = model.people.get(key);
      const names = [...set].map((k) => model.people.get(k)).sort(byLastName).map((q) => q.name);
      return h("li", {},
        h("div", { class: "ranked-head" },
          h("button", { class: "linkish strong", type: "button", text: p.name, onclick: () => openSelect(key) }),
          h("span", { class: "count", text: `${set.size} faculty` })),
        h("small", { text: listText(names) }));
    }) : [h("li", { class: "empty", text: "Shared ancestors appear as the tree grows." })]);
    $("facts-more").hidden = rows.length <= TOP_FACTS;
    $("facts-more").textContent = factsExpanded ? "Show fewer" : `Show all ${rows.length}`;
  }
  $("facts-more").addEventListener("click", () => { factsExpanded = !factsExpanded; renderFacts(); });

  const HIDDEN_KEY = "academic-tree-hidden-messages";
  function readHidden() {
    try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]")); } catch (e) { return new Set(); }
  }
  function writeHidden(set) {
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set])); } catch (e) { }
  }
  const messageId = (r) => [r.when, r.person, r.kind, (r.names || []).join(","), r.value || "", r.from || "", r.to || ""].join("|");
  function hideMessages(list) {
    const hidden = readHidden();
    list.forEach((r) => hidden.add(messageId(r)));
    writeHidden(hidden);
    renderRecent();
  }

  let deletedOpen = false;
  const joinDots = (parts) => parts.filter(Boolean).flatMap((x, k) => (k ? [" · ", x] : [x]));
  function messageLine(r, actions) {
    const p = model.people.get(r.person);
    const names = listText(r.names || []) || "someone";
    const what = {
      rename: `: name changed from “${r.from}” to “${r.to}”`,
      field: `: field set to ${r.value}`,
      confirm: " confirmed their information is complete",
      unconfirm: " reopened their information for changes",
      remove: `: ${names} removed`,
      add: r.role === "committee" ? `: ${names} added to the committee` : `, chaired by ${names}`,
    }[r.kind];
    return h("li", {},
      h("button", { class: "linkish strong", type: "button", text: p.name, onclick: () => openSelect(p.key) }), what,
      h("small", {}, joinDots([r.when || null, ...actions])));
  }
  function recoverMessages(list) {
    const hidden = readHidden();
    list.forEach((r) => hidden.delete(messageId(r)));
    writeHidden(hidden);
    renderRecent();
  }

  function renderRecent() {
    const hidden = readHidden();
    const deleted = model.recent.filter((r) => hidden.has(messageId(r)));
    const showing = model.recent.filter((r) => !hidden.has(messageId(r)));
    if (!deleted.length) deletedOpen = false;

    const items = showing.map((r) => messageLine(r, [
      canSave && r.undo && r.undo.length ? h("button", { class: "mini-action", type: "button", text: "Undo", onclick: () => undo(r.undo) }) : null,
      h("button", { class: "mini-action", type: "button", text: "Delete message", onclick: () => hideMessages([r]) }),
    ]));
    if (!items.length) {
      items.push(h("li", { class: "empty", text: model.recent.length
        ? "No messages here. Deleted messages are in the “Deleted messages” box."
        : lastData && (lastData.live || canSave) ? "Nothing added yet." : "New entries will show up here once the Google Sheet is connected." }));
    }
    fill($("recent"), items);

    const tools = joinDots([
      showing.length > 1 ? h("button", { class: "mini-action", type: "button", text: "Delete all messages", onclick: () => hideMessages(showing) }) : null,
      deleted.length ? h("button", { class: "mini-action", type: "button", "aria-expanded": String(deletedOpen),
        text: deletedOpen ? "Hide deleted messages" : `Deleted messages (${deleted.length})`,
        onclick: () => { deletedOpen = !deletedOpen; renderRecent(); } }) : null,
    ]);
    $("recent-tools").hidden = !tools.length;
    fill($("recent-tools"), tools);

    $("deleted-box").hidden = !deletedOpen;
    if (deletedOpen) {
      fill($("deleted-list"), deleted.map((r) => messageLine(r, [
        h("button", { class: "mini-action", type: "button", text: "Recover", onclick: () => recoverMessages([r]) }),
      ])));
      fill($("deleted-tools"), deleted.length > 1
        ? [h("button", { class: "mini-action", type: "button", text: "Recover all", onclick: () => recoverMessages(deleted) })] : []);
    }
  }

  function renderSections(data) {
    const people = [...model.people.values()];
    const faculty = people.filter((p) => p.faculty);
    const connected = faculty.filter((p) => p.chairs.length);
    const pct = faculty.length ? Math.round((100 * connected.length) / faculty.length) : 0;
    fill($("progress"), [
      h("span", { class: "meter", "aria-hidden": "true" }, h("span", { style: `width:${pct}%` })),
      h("span", { text: `${connected.length} of ${faculty.length} faculty members have their chair in the tree · ${faculty.filter((p) => p.confirmed).length} confirmed their information` }),
    ]);

    fill($("names"), people.slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => h("option", { value: p.name })));

    const missing = faculty.filter((p) => !p.chairs.length).sort(byLastName);
    fill($("missing"), missing.length ? missing.map((p) => {
      const label = [p.name, h("span", { class: "chip-plus", "aria-hidden": "true", text: "+" })];
      if (canSave) {
        return h("button", { class: "chip", type: "button", "aria-label": `Add the chair of ${p.name}`,
          onclick: () => openAddFromOutside("chair", p.key) }, label);
      }
      const href = formLink(p.name, "", C.roleChair);
      return href
        ? h("a", { class: "chip", href, target: "_blank", rel: "noopener", "aria-label": `Add the chair of ${p.name}` }, label)
        : h("span", { class: "chip", text: p.name });
    }) : [h("p", { class: "empty", text: "Every faculty member has their chair in the tree. Keep going back a generation!" })]);

    renderFacts();

    renderRecent();

    const groups = new Set(people.filter((p) => !p.faculty).map((p) => fieldGroup(p.field)).filter(Boolean));
    $("field-legend").hidden = !groups.size;
    fill($("field-legend"), [
      h("span", { class: "legend-title", text: "Field on Academic Tree:" }),
      Object.keys(FIELD_LABELS).filter((g) => groups.has(g)).map((g) =>
        h("span", { class: "legend-item" }, h("span", { class: "swatch field-" + g }), FIELD_LABELS[g])),
      h("span", { class: "legend-item" }, h("span", { class: "swatch" }), "Sociology"),
    ]);

    const rows = [...model.links.values()].map((l) => [model.people.get(l.student), model.people.get(l.advisor), l])
      .sort((a, b) => byLastName(a[0], b[0]) || (a[2].role === b[2].role ? 0 : a[2].role === "chair" ? -1 : 1) || a[1].name.localeCompare(b[1].name));
    fill($("table"), [h("table", {},
      h("thead", {}, h("tr", {}, ["Person", "Chair or committee member", "Role", "PhD institution", "Year", "Source"].map((t) => h("th", { text: t })))),
      h("tbody", {}, rows.map(([p, a, l]) => h("tr", {},
        h("td", { text: p.name + (p.faculty ? " (our faculty)" : "") }), h("td", { text: a.name }),
        h("td", { text: l.role === "committee" ? "Committee member" : "Chair" }),
        h("td", { text: p.institution }), h("td", { text: p.year }), h("td", { text: l.source })))))]);
  }

  function setStatus(data) {
    const status = $("status");
    const refresh = h("button", { class: "linkish", type: "button", onclick: () => run(), text: "Refresh" });
    if (data.live) {
      const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      fill(status, [`Live from the Google Sheet, loaded at ${time}. `, refresh]);
    } else if (data.error) {
      fill(status, [`Couldn't load the Google Sheet (${data.error}), so this shows the starting data. Check that the sheet is shared as “Anyone with the link: Viewer”. `, refresh]);
    } else {
      status.textContent = "Showing the starting data. Connect the Google Sheet in config.js to make the tree live.";
    }
  }

  function rebuild() {
    model = buildModel(lastData);
    graph = layout();
    render();
    renderSections(lastData);
  }

  async function run() {
    lastData = await loadData();
    mergePending(lastData);
    rebuild();
    if (!movedByUser) initialView();
    if (selected && model.people.has(selected)) showPanel(selected); else clearSelection();
    setStatus(lastData);
  }

  async function init() {
    document.title = C.department ? `${C.title} · ${C.department}` : C.title;
    if (/(^#|&)team\b/i.test(location.hash)) $("recent-card").hidden = false;
    $("title").textContent = C.title;
    $("dept").textContent = C.department;
    const add = $("add-btn");
    if (canSave) {
      add.href = "#stage";
      add.removeAttribute("target");
      add.addEventListener("click", (e) => { e.preventDefault(); openAddFromOutside("new"); });
    } else if (formLink("", "", C.roleChair)) {
      add.href = formLink("", "", C.roleChair);
    } else {
      add.removeAttribute("target");
      add.href = "#how";
    }
    if (!window.dagre) {
      $("status").textContent = "The tree couldn't be drawn because a library didn't load. Check your internet connection and reload the page.";
      return;
    }
    try { await Promise.race([document.fonts.load(NAME_FONT), new Promise((r) => setTimeout(r, 1500))]); } catch (e) { }
    await run();
  }
  init();
})();
