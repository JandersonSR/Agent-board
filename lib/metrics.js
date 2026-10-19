// Métricas a partir do log de eventos: tempo trabalhando, tempo esperando você, custo por tarefa.
const CAP = 8 * 3600 * 1000; // um intervalo aberto a noite toda não deve dominar a conta

const day = ts => new Date(ts).toISOString().slice(0, 10);
function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const pick = s => (s ? Object.fromEntries(Object.entries({ taskId: s.taskId, project: s.project }).filter(([, v]) => v)) : {});

function computeMetrics(events, sessions, days, now = Date.now()) {
  const since = now - days * 86400000;
  const byId = new Map();
  for (const e of events) {
    if (!byId.has(e.id)) byId.set(e.id, []);
    byId.get(e.id).push(e);
  }

  const totals = { working: 0, needs_you: 0, review: 0, idle: 0 };
  const perDay = new Map();
  for (let t = since; t <= now; t += 86400000) perDay.set(day(t), { date: day(t), working: 0, waiting: 0 });
  const responses = []; // quanto tempo cada pedido de "precisa de você" esperou
  const groups = new Map();
  const current = new Map(sessions.map(s => [s.id, s]));

  for (const list of byId.values()) {
    list.sort((a, b) => a.ts - b.ts);
    // Cada sessão entra em um único grupo. O estado atual da sessão vale mais que o log:
    // a tarefa ou a pasta podem ser descobertas depois, sem mudança de estado (e sem evento novo).
    const latest = { ...list[list.length - 1], ...pick(current.get(list[0].id)) };
    const key = latest.taskId || latest.project || 'sessão';
    list.forEach((e, i) => {
      const end = i + 1 < list.length ? list[i + 1].ts : e.to === 'ended' ? e.ts : now;
      const dur = Math.min(CAP, Math.max(0, end - e.ts));
      if (e.to in totals) totals[e.to] += dur;
      if (e.to === 'needs_you') responses.push(dur);
      const d = perDay.get(day(e.ts));
      if (d && e.to === 'working') d.working += dur;
      if (d && (e.to === 'needs_you' || e.to === 'review')) d.waiting += dur;
      if (!groups.has(key)) groups.set(key, { key, project: latest.project, ids: new Set(), working: 0, waiting: 0, cost: 0, tokens: 0, lastTs: 0 });
      const g = groups.get(key);
      g.ids.add(e.id);
      g.lastTs = Math.max(g.lastTs, e.ts);
      if (e.to === 'working') g.working += dur;
      if (e.to === 'needs_you' || e.to === 'review') g.waiting += dur;
    });
  }

  let cost = 0, tokens = 0;
  const seen = new Set();
  for (const s of sessions) {
    if (seen.has(s.id) || (s.updatedAt || 0) < since) continue;
    seen.add(s.id);
    const u = s.usage || {};
    cost += u.cost || 0;
    tokens += u.total || 0;
    for (const g of groups.values()) if (g.ids.has(s.id)) { g.cost += u.cost || 0; g.tokens += u.total || 0; }
  }

  return {
    days,
    sessions: byId.size,
    working: totals.working,
    waitingOnYou: totals.needs_you + totals.review,
    needsYou: totals.needs_you,
    review: totals.review,
    asks: responses.length,
    medianResponse: median(responses),
    cost, tokens,
    perDay: [...perDay.values()],
    tasks: [...groups.values()]
      .map(g => ({ key: g.key, project: g.project, sessions: g.ids.size, working: g.working, waiting: g.waiting, cost: g.cost, tokens: g.tokens, lastTs: g.lastTs }))
      .sort((a, b) => b.lastTs - a.lastTs),
  };
}

module.exports = { computeMetrics, median };
