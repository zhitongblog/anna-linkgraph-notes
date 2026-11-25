import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";

const STORAGE_KEY = "vault/notes-v1";
const LOCAL_FALLBACK_KEY = "linkgraph-notes:vault:v1";

const STARTER_NOTES = [
  {
    id: "n-welcome",
    title: "Welcome to LinkGraph Notes",
    content:
      "# Welcome to LinkGraph Notes\n\nConnect your ideas with [[Project Roadmap]] and [[Weekly Action Items]].\n\n- [ ] Add your own note with + New Note\n- [ ] Click any node in the interactive graph on the right\n- [ ] Try Ask Vault or AI Brief for grounded synthesis\n\n#onboarding #pkm",
  },
  {
    id: "n-roadmap",
    title: "Project Roadmap",
    content:
      "# Project Roadmap\n\nKey milestones linked to [[Weekly Action Items]] and [[Research Notes]].\n\n- [ ] Ship v1.0 to Anna Marketplace\n- [x] Verify cross-device APS persistence\n\n#product #roadmap",
  },
  {
    id: "n-tasks",
    title: "Weekly Action Items",
    content:
      "# Weekly Action Items\n\nReview [[Project Roadmap]] priorities every Monday.\n\n- [ ] Collect early builder feedback\n- [ ] Refine graph clustering layout\n\n#tasks #execution",
  },
  {
    id: "n-research",
    title: "Research Notes",
    content:
      "# Research Notes\n\nCombining structured Markdown with Project Roadmap thinking keeps long-term knowledge searchable and auditable.\n\n#research #ai",
  },
];

let anna = null;
let notes = structuredClone(STARTER_NOTES);
let activeId = notes[0].id;
let analysis = null;
let nodeCoords = [];
let saveTimer = null;

const WIKI_LINK_RE = /\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const TAG_RE = /(?:^|\s)#([A-Za-z0-9_\-\u4e00-\u9fff]+)/g;
const TASK_RE = /^\s*[-*]\s+\[\s\]\s+(.+)$/gm;

function analyzeVault(list) {
  const titleToId = new Map();
  for (const n of list) {
    const key = String(n.title || "").trim().toLowerCase();
    if (key) titleToId.set(key, n.id);
  }

  const edges = [];
  const brokenLinks = [];
  const openTasks = [];
  const nodeMap = new Map();

  for (const n of list) {
    const content = String(n.content || "");
    const tags = [...new Set([...content.matchAll(TAG_RE)].map((m) => m[1]))].sort();
    for (const m of content.matchAll(TASK_RE)) {
      openTasks.push({ note_id: n.id, note_title: n.title, task: m[1].trim() });
    }
    nodeMap.set(n.id, {
      id: n.id,
      title: n.title,
      words: content.split(/\s+/).filter(Boolean).length,
      tags,
      in_degree: 0,
      out_degree: 0,
      backlinks: [],
    });
  }

  for (const n of list) {
    const content = String(n.content || "");
    const seenTargets = new Set();
    for (const m of content.matchAll(WIKI_LINK_RE)) {
      const targetName = m[1].trim();
      const targetId = titleToId.get(targetName.toLowerCase());
      if (targetId && targetId !== n.id) {
        if (!seenTargets.has(targetId)) {
          seenTargets.add(targetId);
          edges.push({ source: n.id, target: targetId });
          nodeMap.get(n.id).out_degree += 1;
          const tgt = nodeMap.get(targetId);
          tgt.in_degree += 1;
          tgt.backlinks.push({ id: n.id, title: n.title });
        }
      } else if (!targetId) {
        brokenLinks.push({ from_id: n.id, from_title: n.title, missing_target: targetName });
      }
    }
  }

  const nodes = [...nodeMap.values()];
  const orphanNotes =
    nodes.length > 1
      ? nodes.filter((n) => n.in_degree === 0 && n.out_degree === 0).map((n) => ({ id: n.id, title: n.title }))
      : [];

  const healthScore = Math.max(0, 100 - brokenLinks.length * 10 - orphanNotes.length * 6);

  return {
    note_count: nodes.length,
    edge_count: edges.length,
    health_score: healthScore,
    nodes,
    edges,
    orphan_notes: orphanNotes,
    broken_links: brokenLinks,
    open_tasks: openTasks,
  };
}

function suggestUnlinkedMentions(currentId, list) {
  const current = list.find((n) => n.id === currentId);
  if (!current) return [];
  const lower = String(current.content || "").toLowerCase();
  const alreadyLinked = new Set([...String(current.content || "").matchAll(WIKI_LINK_RE)].map((m) => m[1].trim().toLowerCase()));
  const out = [];
  for (const other of list) {
    if (other.id === currentId) continue;
    const t = String(other.title || "").trim();
    if (t.length < 3) continue;
    const tl = t.toLowerCase();
    if (!alreadyLinked.has(tl) && lower.includes(tl)) {
      out.push({ target_id: other.id, target_title: t });
    }
  }
  return out;
}

function exportBriefMarkdown(list, stats) {
  const lines = [
    "# LinkGraph Knowledge Brief",
    "",
    `- **Notes**: ${stats.note_count} | **Links**: ${stats.edge_count} | **Vault Health**: ${stats.health_score}/100`,
    `- **Orphan Notes**: ${stats.orphan_notes.length} | **Broken Links**: ${stats.broken_links.length} | **Open Tasks**: ${stats.open_tasks.length}`,
    "",
    "## Knowledge Hubs",
  ];
  const sorted = [...stats.nodes].sort((a, b) => b.in_degree + b.out_degree - (a.in_degree + a.out_degree));
  for (const n of sorted.slice(0, 8)) {
    lines.push(`- **${n.title}** (${n.words} words, ${n.in_degree} backlinks / ${n.out_degree} outgoing)`);
  }
  if (stats.open_tasks.length) {
    lines.push("", "## Open Action Items");
    for (const t of stats.open_tasks) {
      lines.push(`- [ ] ${t.task} _(${t.note_title})_`);
    }
  }
  if (stats.broken_links.length) {
    lines.push("", "## Broken Wiki-Links");
    for (const b of stats.broken_links) {
      lines.push(`- \`[[${b.missing_target}]]\` referenced in **${b.from_title}**`);
    }
  }
  return lines.join("\n");
}

function extractLlmText(resp) {
  if (!resp) return "";
  if (typeof resp.content === "string") return resp.content;
  if (resp.content && typeof resp.content.text === "string") return resp.content.text;
  if (typeof resp.text === "string") return resp.text;
  return JSON.stringify(resp, null, 2);
}

async function persistVault() {
  try {
    localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(notes));
  } catch {
    // ignore iframe storage restriction
  }
  if (!anna?.storage?.set) return;
  try {
    await anna.storage.set({ key: STORAGE_KEY, value: notes });
  } catch (e) {
    console.warn("APS storage.set failed:", e);
  }
}

async function loadVault() {
  if (anna?.storage?.get) {
    try {
      const res = await anna.storage.get({ key: STORAGE_KEY });
      if (res?.exists && Array.isArray(res.value) && res.value.length > 0) {
        notes = res.value;
        activeId = notes[0].id;
        return;
      }
    } catch (e) {
      console.warn("APS storage.get failed:", e);
    }
  }
  try {
    const cached = JSON.parse(localStorage.getItem(LOCAL_FALLBACK_KEY) || "null");
    if (Array.isArray(cached) && cached.length > 0) {
      notes = cached;
      activeId = notes[0].id;
    }
  } catch {
    // keep starter notes
  }
}

function refreshAnalysis() {
  analysis = analyzeVault(notes);
  renderList();
  renderGraph();
  renderDiagnostics();
  renderSuggestions();
}

function renderList() {
  const q = (document.getElementById("search-input")?.value || "").trim().toLowerCase();
  const listEl = document.getElementById("note-list");
  const filtered = notes.filter(
    (n) => !q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
  );
  listEl.innerHTML = "";
  for (const n of filtered) {
    const meta = analysis?.nodes?.find((x) => x.id === n.id);
    const div = document.createElement("div");
    div.className = "note-item" + (n.id === activeId ? " active" : "");
    div.innerHTML = `<strong>${escapeHtml(n.title || "Untitled")}</strong><small>${
      meta ? `${meta.words}w · ${meta.in_degree} in / ${meta.out_degree} out` : ""
    }</small>`;
    div.onclick = () => selectNote(n.id);
    listEl.appendChild(div);
  }
  document.getElementById("vault-stats").textContent = `${analysis?.note_count ?? notes.length} notes · ${
    analysis?.edge_count ?? 0
  } links`;
}

function selectNote(id) {
  activeId = id;
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  document.getElementById("note-title").value = note.title;
  document.getElementById("note-editor").value = note.content;
  renderList();
  renderGraph();
  renderBacklinks();
  renderSuggestions();
}

function renderBacklinks() {
  const bar = document.getElementById("backlinks-bar");
  const meta = analysis?.nodes?.find((x) => x.id === activeId);
  const bks = meta?.backlinks || [];
  bar.innerHTML = "<span>Backlinks:</span>";
  if (!bks.length) {
    bar.innerHTML += "<span>None yet</span>";
    return;
  }
  for (const b of bks) {
    const span = document.createElement("span");
    span.className = "chip";
    span.textContent = `← ${b.title}`;
    span.onclick = () => selectNote(b.id);
    bar.appendChild(span);
  }
}

function renderSuggestions() {
  const bar = document.getElementById("suggest-bar");
  bar.innerHTML = "";
  const list = suggestUnlinkedMentions(activeId, notes);
  if (!list.length) return;
  bar.innerHTML = "<span>Unlinked mentions:</span>";
  for (const s of list) {
    const chip = document.createElement("span");
    chip.className = "chip suggest";
    chip.textContent = `+ [[${s.target_title}]]`;
    chip.onclick = () => {
      const note = notes.find((n) => n.id === activeId);
      if (!note) return;
      const re = new RegExp(s.target_title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      note.content = note.content.replace(re, `[[${s.target_title}]]`);
      document.getElementById("note-editor").value = note.content;
      scheduleSaveAndRefresh();
    };
    bar.appendChild(chip);
  }
}

function renderGraph() {
  const canvas = document.getElementById("graph-canvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const gNodes = analysis?.nodes || [];
  const gEdges = analysis?.edges || [];
  if (!gNodes.length) return;

  const cx = W / 2;
  const cy = H / 2;
  const r = Math.min(W, H) * 0.34;
  nodeCoords = gNodes.map((n, idx) => {
    const ang = (idx / gNodes.length) * Math.PI * 2 - Math.PI / 2;
    return {
      id: n.id,
      title: n.title,
      x: cx + Math.cos(ang) * r,
      y: cy + Math.sin(ang) * r,
      deg: (n.in_degree || 0) + (n.out_degree || 0),
    };
  });

  ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
  ctx.lineWidth = 1.4;
  for (const e of gEdges) {
    const a = nodeCoords.find((n) => n.id === e.source);
    const b = nodeCoords.find((n) => n.id === e.target);
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  for (const n of nodeCoords) {
    const isAct = n.id === activeId;
    const rad = isAct ? 10 : Math.min(9, 5 + n.deg);
    ctx.beginPath();
    ctx.arc(n.x, n.y, rad, 0, Math.PI * 2);
    ctx.fillStyle = isAct ? "#38bdf8" : "#34d399";
    ctx.fill();
    ctx.font = "11px sans-serif";
    ctx.fillStyle = isAct ? "#ffffff" : "#cbd5e1";
    ctx.textAlign = "center";
    ctx.fillText(n.title.slice(0, 18), n.x, n.y + rad + 13);
  }
}

function renderDiagnostics() {
  const pill = document.getElementById("health-pill");
  const panel = document.getElementById("diag-panel");
  const score = analysis?.health_score ?? 100;
  pill.textContent = `Health ${score}/100`;

  const rows = [];
  for (const b of analysis?.broken_links || []) {
    rows.push(
      `<div class="diag-row" style="color:var(--red)">⚠ Broken [[${escapeHtml(b.missing_target)}]] in ${escapeHtml(
        b.from_title
      )}</div>`
    );
  }
  for (const o of analysis?.orphan_notes || []) {
    rows.push(`<div class="diag-row" style="color:var(--warn)">• Orphan note: ${escapeHtml(o.title)}</div>`);
  }
  for (const t of (analysis?.open_tasks || []).slice(0, 6)) {
    rows.push(
      `<div class="diag-row">☐ ${escapeHtml(t.task)} <span style="color:var(--muted)">(${escapeHtml(
        t.note_title
      )})</span></div>`
    );
  }
  panel.innerHTML = rows.length
    ? rows.join("")
    : `<div class="diag-row" style="color:var(--green)">✓ Vault clean — zero broken links or orphans.</div>`;
  renderBacklinks();
}

function scheduleSaveAndRefresh() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    refreshAnalysis();
    await persistVault();
  }, 220);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function callHostLlm(systemPrompt, userPrompt, outBox) {
  if (!anna?.llm?.complete) {
    outBox.textContent = "Connect inside Anna AI OS to run zero-API-key AI synthesis on your vault.";
    return;
  }
  outBox.textContent = "Thinking via Anna Host LLM…";
  try {
    const resp = await anna.llm.complete({
      systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 1200,
      temperature: 0.3,
    });
    outBox.textContent = extractLlmText(resp);
  } catch (e) {
    outBox.textContent = "LLM request failed: " + (e?.message || String(e));
  }
}

async function main() {
  const badge = document.getElementById("host-badge");
  const outBox = document.getElementById("output-box");

  try {
    anna = await AnnaAppRuntime.connect();
    await anna.window.set_title({ title: "LinkGraph Notes" });
    badge.textContent = "Anna OS Connected";
  } catch {
    badge.textContent = "Local Preview";
  }

  await loadVault();

  document.getElementById("note-title").addEventListener("input", (e) => {
    const n = notes.find((x) => x.id === activeId);
    if (!n) return;
    n.title = e.target.value;
    scheduleSaveAndRefresh();
  });

  document.getElementById("note-editor").addEventListener("input", (e) => {
    const n = notes.find((x) => x.id === activeId);
    if (!n) return;
    n.content = e.target.value;
    scheduleSaveAndRefresh();
  });

  document.getElementById("search-input").addEventListener("input", renderList);

  document.getElementById("btn-new").addEventListener("click", async () => {
    const id = "n-" + Date.now();
    notes.unshift({
      id,
      title: "New Note",
      content: "# New Note\n\nLink to [[Welcome to LinkGraph Notes]]\n\n- [ ] Next step\n",
    });
    selectNote(id);
    refreshAnalysis();
    await persistVault();
  });

  document.getElementById("btn-delete").addEventListener("click", async () => {
    if (notes.length <= 1) {
      outBox.textContent = "At least one note must remain in the vault.";
      return;
    }
    notes = notes.filter((n) => n.id !== activeId);
    activeId = notes[0].id;
    selectNote(activeId);
    refreshAnalysis();
    await persistVault();
  });

  document.getElementById("btn-export").addEventListener("click", () => {
    outBox.textContent = exportBriefMarkdown(notes, analysis || analyzeVault(notes));
  });

  document.getElementById("btn-ai-summarize").addEventListener("click", async () => {
    const note = notes.find((n) => n.id === activeId);
    if (!note) return;
    const meta = analysis?.nodes?.find((x) => x.id === activeId);
    const neighborTitles = (meta?.backlinks || []).map((b) => b.title).join(", ") || "None";
    await callHostLlm(
      "You are a concise personal knowledge assistant. Summarize the note into 3 crisp bullet takeaways, 2 concrete next actions, and note any gaps based on its backlinks.",
      `# ${note.title}\nBacklinks: ${neighborTitles}\n\n${note.content}`,
      outBox
    );
  });

  document.getElementById("btn-ai-links").addEventListener("click", async () => {
    const digest = notes.map((n) => `## ${n.title}\n${n.content.slice(0, 450)}`).join("\n\n");
    await callHostLlm(
      "You analyze a Markdown knowledge vault and propose 3-5 missing conceptual [[wiki-links]] between existing notes plus 2 suggested new hub notes to resolve orphans or deepen connections. Be concise and specific.",
      digest,
      outBox
    );
  });

  document.getElementById("btn-ask").addEventListener("click", async () => {
    const q = (document.getElementById("ask-input").value || "").trim();
    if (!q) {
      outBox.textContent = "Enter a question about your notes first.";
      return;
    }
    const vaultContext = notes.map((n) => `[[${n.title}]]\n${n.content}`).join("\n\n---\n\n");
    await callHostLlm(
      "Answer the user's question strictly using the provided Markdown vault notes. Cite source notes inline using [[Note Title]]. If a detail is missing from the vault, explicitly state what is missing.",
      `Question: ${q}\n\nVault:\n${vaultContext.slice(0, 12000)}`,
      outBox
    );
  });

  document.getElementById("graph-canvas").addEventListener("click", (e) => {
    const rect = e.target.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * e.target.width;
    const y = ((e.clientY - rect.top) / rect.height) * e.target.height;
    const hit = nodeCoords.find((n) => Math.hypot(n.x - x, n.y - y) <= 16);
    if (hit) selectNote(hit.id);
  });

  selectNote(activeId);
  refreshAnalysis();
}

main();
