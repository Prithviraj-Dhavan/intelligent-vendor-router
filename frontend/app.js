// app.js
const API = ""; // same-origin, served by Express

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString();
}

// ---------------------------------------------------------------------------
// Toasts (replaces alert())
// ---------------------------------------------------------------------------
function showToast(message, type = "info") {
  const host = document.getElementById("toastHost");
  const toast = el(`<div class="toast ${type === "error" ? "error" : ""}">${message}</div>`);
  host.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("fading");
    setTimeout(() => toast.remove(), 260);
  }, 3400);
}

// ---------------------------------------------------------------------------
// Clock + health pulse
// ---------------------------------------------------------------------------
function tickClock() {
  document.getElementById("clock").textContent = new Date().toLocaleTimeString();
}
setInterval(tickClock, 1000);
tickClock();

async function refreshHealth() {
  try {
    const h = await api("/health");
    const dot = document.getElementById("healthDot");
    const text = document.getElementById("healthText");
    dot.style.background = h.unhealthyVendors.length ? "var(--amber)" : "var(--green)";
    dot.style.boxShadow = `0 0 8px ${h.unhealthyVendors.length ? "var(--amber)" : "var(--green)"}`;
    text.textContent = `${h.healthyVendors}/${h.totalVendors} vendors healthy`;
    document.getElementById("activeStrategyText").textContent = h.defaultStrategy;
  } catch (e) {
    document.getElementById("healthText").textContent = "backend unreachable";
  }
}

// ---------------------------------------------------------------------------
// Strategies dropdown
// ---------------------------------------------------------------------------
async function loadStrategies() {
  const s = await api("/strategies");
  const sel = document.getElementById("r_strategy");
  s.available.forEach((name) => {
    const opt = el(`<option value="${name}">${name}</option>`);
    sel.appendChild(opt);
  });
}

// ---------------------------------------------------------------------------
// Vendor registry (left panel)
// ---------------------------------------------------------------------------
document.getElementById("btnShowAddVendor").onclick = () => {
  document.getElementById("addVendorPanel").style.display = "block";
};
document.getElementById("btnCloseAddVendor").onclick = () => {
  document.getElementById("addVendorPanel").style.display = "none";
};

document.getElementById("btnSubmitVendor").onclick = async () => {
  const payload = {
    capability: document.getElementById("v_capability").value.trim(),
    name: document.getElementById("v_name").value.trim(),
    priority: Number(document.getElementById("v_priority").value),
    weight: Number(document.getElementById("v_weight").value),
    costPerRequest: Number(document.getElementById("v_cost").value),
    timeoutMs: Number(document.getElementById("v_timeout").value),
    rateLimitPerMinute: Number(document.getElementById("v_ratelimit").value),
    simulatedErrorRate: Number(document.getElementById("v_errrate").value),
    simulatedBaseLatencyMs: Number(document.getElementById("v_lat").value),
    simulatedLatencyJitterMs: Number(document.getElementById("v_jitter").value),
    supportedFeatures: document.getElementById("v_features").value
      .split(",").map((s) => s.trim()).filter(Boolean),
  };
  if (!payload.name) { showToast("Vendor name is required.", "error"); return; }
  await api("/vendors", { method: "POST", body: JSON.stringify(payload) });
  document.getElementById("addVendorPanel").style.display = "none";
  document.getElementById("v_name").value = "";
  showToast(`${payload.name} registered for ${payload.capability}.`);
  await refreshVendors();
};

document.getElementById("capabilityFilter").addEventListener("input", refreshVendors);

async function refreshVendors() {
  const cap = document.getElementById("capabilityFilter").value.trim();
  const [vendors, metrics] = await Promise.all([
    api("/vendors" + (cap ? `?capability=${encodeURIComponent(cap)}` : "")),
    api("/vendor-metrics" + (cap ? `?capability=${encodeURIComponent(cap)}` : "")),
  ]);
  const metricsById = Object.fromEntries(metrics.map((m) => [m.vendorId, m]));
  const list = document.getElementById("vendorList");
  list.innerHTML = "";
  if (!vendors.length) {
    list.appendChild(el(`<div class="empty-state">No vendors registered yet. Add one to get started.</div>`));
    return;
  }
  vendors.forEach((v) => {
    const m = metricsById[v.id] || {};
    const up = v.status === "ACTIVE" && m.isHealthy;
    const card = el(`
      <div class="vendor-card">
        <div class="vendor-card-head">
          <div class="vendor-name"><span class="status-dot ${up ? "up" : "down"}"></span>${v.name}</div>
          <span class="badge capability">${v.capability}</span>
        </div>
        <div class="vendor-meta">
          <span>priority ${v.priority}</span>
          <span>w ${v.weight}</span>
          <span>₹${v.costPerRequest}</span>
          <span>${v.rateLimitPerMinute}/min</span>
          <span>${m.avgLatencyMs ?? v.simulatedBaseLatencyMs}ms avg</span>
        </div>
        <div class="vendor-actions">
          <button class="small" data-toggle="${v.id}">${v.status === "ACTIVE" ? "Disable" : "Enable"}</button>
          <button class="small ghost" data-delete="${v.id}">Remove</button>
        </div>
      </div>
    `);
    list.appendChild(card);
  });
  list.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.onclick = async () => {
      const updated = await api(`/vendors/${btn.dataset.toggle}/toggle`, { method: "POST" });
      showToast(`${updated.name} ${updated.status === "ACTIVE" ? "enabled" : "disabled"}.`);
      await Promise.all([refreshVendors(), refreshMetrics(), refreshHealth()]);
    };
  });
  list.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/vendors/${btn.dataset.delete}`, { method: "DELETE" });
      showToast("Vendor removed.");
      await Promise.all([refreshVendors(), refreshMetrics(), refreshHealth()]);
    };
  });
}

// ---------------------------------------------------------------------------
// Metrics rail (right panel)
// ---------------------------------------------------------------------------
async function refreshMetrics() {
  const metrics = await api("/vendor-metrics");
  const list = document.getElementById("metricsList");
  list.innerHTML = "";
  if (!metrics.length) {
    list.appendChild(el(`<div class="empty-state">No metrics yet — route a request to generate signal.</div>`));
    return;
  }
  metrics.forEach((m) => {
    const barColor = (pct, invert = false) => {
      const good = invert ? pct < 30 : pct > 70;
      const mid = invert ? pct < 60 : pct > 40;
      return good ? "var(--green)" : mid ? "var(--amber)" : "var(--red)";
    };
    const row = el(`
      <div class="metric-row">
        <div class="metric-top">
          <span><span class="status-dot ${m.isHealthy ? "up" : "down"}" style="display:inline-block;"></span> ${m.name}</span>
          <span class="mono" style="font-size:11px; color:var(--muted);">${m.totalRequests} reqs</span>
        </div>
        <div class="metric-bars">
          <div>
            <div class="metric-bar-label"><span>success</span><span>${m.successRate}%</span></div>
            <div class="bar-track"><div class="bar-fill" style="width:${m.successRate}%; background:${barColor(m.successRate)}"></div></div>
          </div>
          <div>
            <div class="metric-bar-label"><span>latency</span><span>${m.avgLatencyMs}ms</span></div>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, m.avgLatencyMs / 20)}%; background:${barColor(m.avgLatencyMs / 20, true)}"></div></div>
          </div>
          <div>
            <div class="metric-bar-label"><span>rate limit</span><span>${m.requestsThisMinute}/${m.rateLimitPerMinute}</span></div>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, (m.requestsThisMinute / m.rateLimitPerMinute) * 100)}%; background:${barColor((m.requestsThisMinute / m.rateLimitPerMinute) * 100, true)}"></div></div>
          </div>
        </div>
      </div>
    `);
    list.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// Logs (center panel bottom)
// ---------------------------------------------------------------------------
async function refreshLogs() {
  const logs = await api("/routing-logs?limit=30");
  const list = document.getElementById("logsList");
  list.innerHTML = "";
  if (!logs.length) {
    list.appendChild(el(`<div class="empty-state">No routing decisions logged yet.</div>`));
    return;
  }
  logs.forEach((log) => {
    const row = el(`
      <div class="log-entry">
        <div class="log-top">
          <span>${fmtTime(log.timestamp)} · ${log.capability} · ${log.strategyUsed}</span>
          <span class="${log.vendorUsed ? "log-vendor" : "log-vendor fail"}">${log.vendorUsed || "NO VENDOR"}</span>
        </div>
        <div class="log-reason">${log.routingReason}</div>
      </div>
    `);
    list.appendChild(row);
  });
}
document.getElementById("btnRefreshLogs").onclick = refreshLogs;
document.getElementById("btnRefreshMetrics").onclick = refreshMetrics;

// ---------------------------------------------------------------------------
// Signature element: animated signal-routing diagram
// ---------------------------------------------------------------------------
function drawStaticDiagram(candidateNames = []) {
  const svg = document.getElementById("routeSvg");
  const names = candidateNames.length ? candidateNames : ["Vendor A", "Vendor B", "Vendor C"];
  const nodeX = 480;
  const startY = 40;
  const gapY = Math.max(50, Math.min(70, 160 / names.length));
  let nodesHtml = "";
  names.forEach((name, i) => {
    const y = startY + i * gapY;
    nodesHtml += `
      <line class="flow-edge" x1="230" y1="110" x2="${nodeX - 30}" y2="${y}" stroke="var(--border-strong)" stroke-width="1.5" data-edge="${i}"/>
      <circle cx="${nodeX}" cy="${y}" r="16" fill="#151D27" stroke="var(--border-strong)" stroke-width="1.5" data-node="${i}"/>
      <text x="${nodeX}" y="${y + 4}" text-anchor="middle" class="node-label" font-size="9" data-node-label="${i}">${name.slice(0,2).toUpperCase()}</text>
      <text x="${nodeX + 26}" y="${y + 4}" class="node-sub" data-node-name="${i}">${name}</text>
    `;
  });
  svg.setAttribute("viewBox", `0 0 640 ${Math.max(220, startY + names.length * gapY + 40)}`);
  svg.innerHTML = `
    <defs>
      <filter id="nodeGlow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="3.2" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <radialGradient id="pulseGrad" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="var(--signal)" stop-opacity="1"/>
        <stop offset="100%" stop-color="var(--signal)" stop-opacity="0"/>
      </radialGradient>
    </defs>

    <circle cx="60" cy="110" r="20" fill="#151D27" stroke="var(--signal-dim)" stroke-width="1.5"/>
    <text x="60" y="115" text-anchor="middle" class="node-label" font-size="10">CLI</text>
    <text x="60" y="140" text-anchor="middle" class="node-sub">Client</text>

    <line class="flow-edge" x1="80" y1="110" x2="200" y2="110" stroke="var(--border-strong)" stroke-width="1.5"/>
    <circle cx="230" cy="110" r="24" fill="#151D27" stroke="var(--signal)" stroke-width="2" filter="url(#nodeGlow)"/>
    <text x="230" y="106" text-anchor="middle" class="node-label" font-size="9">ROUTER</text>
    <text x="230" y="118" text-anchor="middle" class="node-sub" font-size="8">rules engine</text>
    <text x="230" y="150" text-anchor="middle" class="node-sub">/route</text>

    ${nodesHtml}
    <circle id="pulseGlow" cx="60" cy="110" r="10" fill="url(#pulseGrad)" opacity="0"/>
    <circle id="pulseDot" cx="60" cy="110" r="4" fill="var(--signal)" opacity="0"/>
  `;
}

function animateRouting(result, candidateNames) {
  const svg = document.getElementById("routeSvg");
  drawStaticDiagram(candidateNames.length ? candidateNames : (result.candidates || []).map(c => c.name));
  const candidates = result.candidates || [];
  // Colour/dim nodes by eligibility + mark the winner
  candidates.forEach((c, i) => {
    const nodeCircle = svg.querySelector(`[data-node="${i}"]`);
    const edge = svg.querySelector(`[data-edge="${i}"]`);
    const nameLabel = svg.querySelector(`[data-node-name="${i}"]`);
    if (!nodeCircle) return;
    if (c.name === result.vendorUsed) {
      nodeCircle.setAttribute("stroke", "var(--green)");
      nodeCircle.setAttribute("stroke-width", "3");
      if (edge) { edge.setAttribute("stroke", "var(--signal)"); edge.setAttribute("stroke-dasharray", "none"); edge.setAttribute("stroke-width", "2"); }
    } else if (!c.eligible) {
      nodeCircle.setAttribute("opacity", "0.35");
      if (nameLabel) nameLabel.setAttribute("opacity", "0.35");
      if (edge) edge.setAttribute("opacity", "0.25");
    } else {
      nodeCircle.setAttribute("stroke", "var(--red)");
      if (edge) edge.setAttribute("stroke", "var(--red)");
    }
  });

  // Animate the pulse travelling from client -> router -> winning vendor (or last attempted)
  const winnerIndex = candidates.findIndex((c) => c.name === result.vendorUsed);
  const targetIndex = winnerIndex >= 0 ? winnerIndex : 0;
  const nodeX = 480;
  const startY = 40;
  const gapY = Math.max(50, Math.min(70, 160 / Math.max(1, candidates.length)));
  const targetY = startY + targetIndex * gapY;

  const pulse = svg.querySelector("#pulseDot");
  const glow = svg.querySelector("#pulseGlow");
  if (!pulse) return;
  pulse.setAttribute("opacity", "1");
  if (glow) glow.setAttribute("opacity", "0.8");
  const path = [
    { x: 60, y: 110, t: 0 },
    { x: 230, y: 110, t: 300 },
    { x: nodeX, y: targetY, t: 700 },
  ];
  let start = null;
  function frame(ts) {
    if (!start) start = ts;
    const elapsed = ts - start;
    let seg = path[path.length - 1];
    for (let i = 0; i < path.length - 1; i++) {
      if (elapsed >= path[i].t && elapsed <= path[i + 1].t) {
        const localT = (elapsed - path[i].t) / (path[i + 1].t - path[i].t);
        const x = path[i].x + (path[i + 1].x - path[i].x) * localT;
        const y = path[i].y + (path[i + 1].y - path[i].y) * localT;
        pulse.setAttribute("cx", x);
        pulse.setAttribute("cy", y);
        if (glow) { glow.setAttribute("cx", x); glow.setAttribute("cy", y); }
        requestAnimationFrame(frame);
        return;
      }
    }
    pulse.setAttribute("cx", seg.x);
    pulse.setAttribute("cy", seg.y);
    if (glow) { glow.setAttribute("cx", seg.x); glow.setAttribute("cy", seg.y); }
    if (elapsed < 900) requestAnimationFrame(frame);
    else {
      pulse.setAttribute("opacity", result.status === "SUCCESS" ? "1" : "0.2");
      if (glow) glow.setAttribute("opacity", result.status === "SUCCESS" ? "0.6" : "0");
    }
  }
  requestAnimationFrame(frame);
}

drawStaticDiagram([]);

// ---------------------------------------------------------------------------
// Route tester
// ---------------------------------------------------------------------------
document.getElementById("btnRoute").onclick = async () => {
  const btn = document.getElementById("btnRoute");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> routing…`;
  try {
    let payload, requirements;
    try { payload = JSON.parse(document.getElementById("r_payload").value || "{}"); }
    catch { showToast("Payload is not valid JSON.", "error"); return; }
    try { requirements = JSON.parse(document.getElementById("r_requirements").value || "{}"); }
    catch { showToast("Requirements is not valid JSON.", "error"); return; }
    const strategyOverride = document.getElementById("r_strategy").value;
    if (strategyOverride) requirements.strategyOverride = strategyOverride;

    const result = await api("/route", {
      method: "POST",
      body: JSON.stringify({
        capability: document.getElementById("r_capability").value.trim(),
        payload,
        requirements,
      }),
    });

    animateRouting(result, (result.candidates || []).map(c => c.name));

    const reasonBlock = document.getElementById("reasonBlock");
    reasonBlock.innerHTML = "";
    reasonBlock.appendChild(el(`<div class="reason-line ${result.status === "SUCCESS" ? "" : "fail"}">
      <strong>${result.status}</strong> · vendor: <strong>${result.vendorUsed || "none"}</strong> · ${result.latencyMs}ms · ₹${result.cost}<br/>
      ${result.routingReason}
    </div>`));

    const respBlock = document.getElementById("responseBlock");
    respBlock.style.display = "block";
    respBlock.textContent = JSON.stringify(result, null, 2);

    await Promise.all([refreshMetrics(), refreshLogs(), refreshVendors(), refreshHealth()]);
  } catch (e) {
    showToast("Routing failed: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = "Send request →";
  }
};

document.getElementById("btnLoadTest").onclick = async () => {
  const btn = document.getElementById("btnLoadTest");
  btn.disabled = true;
  const cap = document.getElementById("r_capability").value.trim();
  let payload, requirements;
  try { payload = JSON.parse(document.getElementById("r_payload").value || "{}"); } catch { payload = {}; }
  try { requirements = JSON.parse(document.getElementById("r_requirements").value || "{}"); } catch { requirements = {}; }
  for (let i = 0; i < 12; i++) {
    try {
      const result = await api("/route", { method: "POST", body: JSON.stringify({ capability: cap, payload, requirements }) });
      animateRouting(result, (result.candidates || []).map(c => c.name));
    } catch {}
    await new Promise((r) => setTimeout(r, 180));
  }
  await Promise.all([refreshMetrics(), refreshLogs(), refreshVendors(), refreshHealth()]);
  btn.disabled = false;
};

// ---------------------------------------------------------------------------
// AI panel
// ---------------------------------------------------------------------------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    ["recommend", "explain", "generate"].forEach((name) => {
      document.getElementById(`tab-${name}`).style.display = name === tab.dataset.tab ? "block" : "none";
    });
    document.getElementById("aiOutput").style.display = "none";
  };
});

async function loadAiStatus() {
  const status = await api("/ai/status");
  document.getElementById("aiModeTag").textContent = status.llmEnabled ? "LLM-powered" : "rule-based fallback";
}

document.getElementById("btnRecommend").onclick = async () => {
  const out = document.getElementById("aiOutput");
  out.style.display = "block";
  out.textContent = "Analyzing live metrics…";
  const cap = document.getElementById("r_capability").value.trim();
  const result = await api("/ai/recommend-strategy", { method: "POST", body: JSON.stringify({ capability: cap }) });
  out.textContent = `Recommended strategy: ${result.recommendedStrategy}\n\n${result.reasoning}\n\n` +
    (result.unhealthyVendors?.length ? `Unhealthy vendors: ${result.unhealthyVendors.join(", ")}\n\n` : "") +
    (result.suggestedFailoverRules?.length ? `Suggested failover rules:\n- ${result.suggestedFailoverRules.join("\n- ")}` : "");
};

document.getElementById("btnExplain").onclick = async () => {
  const out = document.getElementById("aiOutput");
  out.style.display = "block";
  out.textContent = "Fetching last decision…";
  const logs = await api("/routing-logs?limit=1");
  if (!logs.length) { out.textContent = "No routing decisions yet — send a request first."; return; }
  const result = await api(`/ai/explain/${logs[0].id}`);
  out.textContent = result.explanation;
};

document.getElementById("btnGenerateConfig").onclick = async () => {
  const out = document.getElementById("aiOutput");
  out.style.display = "block";
  out.textContent = "Generating routing config…";
  const instruction = document.getElementById("ai_instruction").value.trim();
  const result = await api("/ai/generate-config", { method: "POST", body: JSON.stringify({ instruction }) });
  out.textContent = JSON.stringify(result.config, null, 2);
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function init() {
  await loadStrategies();
  await loadAiStatus();
  await Promise.all([refreshVendors(), refreshMetrics(), refreshLogs(), refreshHealth()]);
  setInterval(refreshHealth, 5000);
})();
