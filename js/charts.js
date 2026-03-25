// =====================================================================
// CHART DEFAULTS
// =====================================================================
function chartDefaults() {
  return {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 300 },
    plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1e2535', titleColor: '#e2e8f0', bodyColor: '#94a3b8', borderColor: '#2d3748', borderWidth: 1 } },
    scales: { x: { grid: GRID(), ticks: TICK() }, y: { grid: GRID(), ticks: TICK() } }
  };
}

// Store all charts for crosshair sync
const allCharts = {};

function sparklineOptions(color, min = undefined, max = undefined) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 260 },
    plugins: { legend: { display: false }, tooltip: { ...chartDefaults().plugins.tooltip, displayColors: false, callbacks: {} } },
    scales: {
      x: { display: false, grid: { display: false } },
      y: { display: false, grid: { display: false }, min, max }
    },
    elements: { line: { tension: 0.35, borderWidth: 2.5 }, point: { radius: 0 } }
  };
}

allCharts.heroWeightChart = new Chart(document.getElementById('heroWeightChart'), {
  type: 'line',
  data: { labels: [], datasets: [
    { data: [], borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.14)', fill: true, pointRadius: 0 },
    { data: [], borderColor: 'rgba(251,191,36,0.7)', borderDash: [6, 4], fill: false, pointRadius: 0 }
  ] },
  options: {
    ...chartDefaults(),
    plugins: { ...chartDefaults().plugins, legend: { display: false }, tooltip: { ...chartDefaults().plugins.tooltip, callbacks: {} } },
    scales: {
      x: { ...chartDefaults().scales.x, ticks: { ...TICK(), maxTicksLimit: 8 } },
      y: { ...chartDefaults().scales.y, ticks: { ...TICK(), maxTicksLimit: 5, callback: v => `${v} ${weightUnit()}` } }
    }
  }
});

allCharts.heroCalChart = new Chart(document.getElementById('heroCalChart'), {
  type: 'line',
  data: { labels: [], datasets: [{ data: [], borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.12)', fill: true }] },
  options: sparklineOptions('#38bdf8')
});

allCharts.heroSleepChart = new Chart(document.getElementById('heroSleepChart'), {
  type: 'line',
  data: { labels: [], datasets: [{ data: [], borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.14)', fill: true }] },
  options: sparklineOptions('#f59e0b', 0, 100)
});

allCharts.trendDecompChart = new Chart(document.getElementById('trendDecompChart'), {
  type: 'bar',
  data: {
    labels: ['Scale change', 'Deficit-implied', 'Est. fat change', 'Est. non-fat change'],
    datasets: [{
      data: [],
      backgroundColor: ['rgba(56,189,248,0.72)', 'rgba(245,158,11,0.78)', 'rgba(248,113,113,0.76)', 'rgba(148,163,184,0.72)'],
      borderRadius: 10,
      borderSkipped: false
    }]
  },
  options: {
    ...chartDefaults(),
    indexAxis: 'y',
    plugins: {
      ...chartDefaults().plugins,
      legend: { display: false },
      tooltip: { ...chartDefaults().plugins.tooltip, callbacks: {} }
    },
    scales: {
      x: {
        ...chartDefaults().scales.x,
        ticks: { ...TICK(), callback: v => `${v} ${weightUnit()}` }
      },
      y: { ...chartDefaults().scales.y, ticks: TICK() }
    }
  }
});

allCharts.scenarioForecastChart = new Chart(document.getElementById('scenarioForecastChart'), {
  type: 'line',
  data: { labels: [], datasets: [] },
  options: {
    ...chartDefaults(),
    interaction: { mode: 'index', intersect: false },
    elements: { line: { tension: 0.25, borderWidth: 2.2 }, point: { radius: 0, hoverRadius: 4 } },
    plugins: {
      ...chartDefaults().plugins,
      legend: {
        display: true,
        labels: {
          color: '#94a3b8',
          usePointStyle: true,
          boxWidth: 10,
          padding: 16
        }
      },
      tooltip: { ...chartDefaults().plugins.tooltip, callbacks: {} }
    },
    scales: {
      x: { ...chartDefaults().scales.x, ticks: { ...TICK(), maxTicksLimit: 8 } },
      y: { ...chartDefaults().scales.y, ticks: { ...TICK(), callback: v => `${v} ${weightUnit()}` } }
    }
  }
});

// =====================================================================
// TREND ARROWS & STAT CARDS
// =====================================================================
function renderStatCards() {
  const months = ['Jan','Feb','March'];
  const metrics = [
    { label: 'Avg Calories', key: 'calories', fmt: v => Math.round(v).toLocaleString(), goodDir: 'down' },
    { label: 'Avg Protein (g)', key: 'protein', fmt: v => Math.round(v), goodDir: 'up' },
    { label: 'Avg Carbs (g)', key: 'carbs', fmt: v => Math.round(v), goodDir: 'down' },
    { label: 'Avg Fat (g)', key: 'fat', fmt: v => Math.round(v), goodDir: 'down' },
  ];
  const perLb = [
    { label: `Protein / ${useMetric ? 'kg' : 'lb'} BW`, key: 'protein', fmt: v => v.toFixed(2) + ` g/${useMetric ? 'kg' : 'lb'}`, goodDir: 'up', perLb: true }
  ];

  const grid = document.getElementById('statGrid');
  const filtered = monthBuckets(getFilteredDays());
  grid.innerHTML = '';
  [...metrics, ...perLb].forEach(m => {
    const vals = months.map(mo => {
      const d = filtered[mo];
      if (!d.length) return null;
      if (m.perLb) {
        const wDays = d.filter(dd => dd.weight);
        const avgW = wDays.length ? avg(wDays, 'weight') : 165;
        return avg(d, m.key) / avgW;
      }
      return avg(d, m.key);
    });

    let arrows = ['','',''];
    for (let i = 1; i < 3; i++) {
      if (vals[i] == null || vals[i - 1] == null) continue;
      const delta = vals[i] - vals[i-1];
      if (Math.abs(delta) < 1) { arrows[i] = '<span class="trend-arrow trend-neutral">→</span>'; continue; }
      const up = delta > 0;
      const good = (m.goodDir === 'up' && up) || (m.goodDir === 'down' && !up);
      const cls = good ? (up ? 'trend-up-good' : 'trend-down-good') : (up ? 'trend-up-bad' : 'trend-down-bad');
      arrows[i] = `<span class="trend-arrow ${cls}">${up ? '▲' : '▼'}</span>`;
    }

    const card = document.createElement('div');
    card.className = 'stat-card';
    card.innerHTML = `
      <div class="label">${m.label}</div>
      <div class="months">
        ${months.map((mo, i) => `<div class="month-val"><span class="month-name">${mo.slice(0,3)}</span><span class="val col-${mo.slice(0,3).toLowerCase()}">${vals[i] == null ? '—' : m.fmt(vals[i])}${arrows[i]}</span></div>`).join('')}
      </div>`;
    grid.appendChild(card);
  });

  // Macro-implied vs logged calorie mismatch
  const mismatchCard = document.createElement('div');
  mismatchCard.className = 'stat-card';
  const allFilteredDays = getFilteredDays();
  const mismatchVals = ['Jan', 'Feb', 'March'].map(mo => {
    const mDays = filtered[mo];
    if (!mDays.length) return null;
    const avgLogged = avg(mDays, 'calories');
    const avgImplied = mDays.reduce((s, d) => s + (d.protein * 4 + d.carbs * 4 + d.fat * 9), 0) / mDays.length;
    return { logged: avgLogged, implied: avgImplied, gap: ((avgImplied - avgLogged) / avgLogged * 100) };
  });
  mismatchCard.innerHTML = `
    <div class="label">Macro vs Logged Gap</div>
    <div class="months">
      ${['Jan', 'Feb', 'Mar'].map((mo, i) => `<div class="month-val"><span class="month-name">${mo}</span><span class="val" style="font-size:16px;color:${mismatchVals[i] && Math.abs(mismatchVals[i].gap) > 5 ? 'var(--col-amber)' : 'var(--text-muted)'}">${mismatchVals[i] == null ? '—' : (mismatchVals[i].gap > 0 ? '+' : '') + mismatchVals[i].gap.toFixed(1) + '%'}</span></div>`).join('')}
    </div>`;
  grid.appendChild(mismatchCard);

  // Consistency scores
  const consistencyCard = document.createElement('div');
  consistencyCard.className = 'stat-card';
  const consistencyMetrics = [
    { label: 'Cal', key: 'calories' },
    { label: 'Pro', key: 'protein' }
  ];
  const conMonths = ['Jan', 'Feb', 'March'];
  consistencyCard.innerHTML = `
    <div class="label">Consistency (lower variance = higher)</div>
    <div class="months">
      ${conMonths.map((mo, i) => {
        const d = filtered[mo];
        const calCon = d.length >= 3 ? consistencyScore(d, 'calories') : null;
        const proCon = d.length >= 3 ? consistencyScore(d, 'protein') : null;
        const calColor = calCon == null ? 'var(--text-muted)' : calCon >= 85 ? 'var(--col-green)' : calCon >= 70 ? 'var(--col-amber)' : 'var(--col-red)';
        const proColor = proCon == null ? 'var(--text-muted)' : proCon >= 85 ? 'var(--col-green)' : proCon >= 70 ? 'var(--col-amber)' : 'var(--col-red)';
        return `<div class="month-val"><span class="month-name">${mo.slice(0,3)}</span><span class="val" style="font-size:13px;"><span style="color:${calColor}">${calCon != null ? calCon + '%' : '—'}</span> / <span style="color:${proColor}">${proCon != null ? proCon + '%' : '—'}</span></span></div>`;
      }).join('')}
    </div>
    <div style="font-size:10px;color:var(--text-faint);margin-top:2px;">Cal / Protein consistency</div>`;
  grid.appendChild(consistencyCard);

  // Monthly progression narrative
  const progressionEl = document.getElementById('monthlyProgression');
  const progression = monthlyProgression(filtered);
  if (progression) {
    progressionEl.innerHTML = `<strong>Month-over-month:</strong> ${progression}`;
    progressionEl.style.display = '';
  } else {
    progressionEl.style.display = 'none';
  }

  // Day-of-week macro patterns + adherence momentum → compact badges
  const dowEl = document.getElementById('dowMacroInsight');
  if (dowEl) {
    const dowMacros = dayOfWeekMacroAverages(allFilteredDays);
    const validDays = dowMacros.filter(d => d.avgCal != null && d.count >= 2);
    const momentum = adherenceMomentum(allFilteredDays);
    const badges = [];

    if (validDays.length >= 5) {
      const highest = validDays.reduce((a, b) => (a.avgCal || 0) > (b.avgCal || 0) ? a : b);
      const lowest = validDays.reduce((a, b) => (a.avgCal || 0) < (b.avgCal || 0) ? a : b);
      const drinkDays = validDays.filter(d => (d.drinkPct || 0) > 30).map(d => d.day);
      const dowTitle = validDays.map(d => `${d.day}: ${d.avgCal} cal · ${d.avgPro}g pro`).join('\n');
      badges.push(`<div class="badge amber" title="${dowTitle}"><strong>${highest.day} ${energyLabel(highest.avgCal)} · ${lowest.day} ${energyLabel(lowest.avgCal)}</strong>Highest vs lowest intake day</div>`);
      if (drinkDays.length) badges.push(`<div class="badge rose"><strong>${drinkDays.join(', ')}</strong>Drink nights cluster</div>`);
    }

    if (momentum) {
      const calIcon = momentum.calHitTrend === 'improving' ? '📈' : momentum.calHitTrend === 'declining' ? '📉' : '➡️';
      const proIcon = momentum.proHitTrend === 'improving' ? '📈' : momentum.proHitTrend === 'declining' ? '📉' : '➡️';
      const weekTitle = momentum.weeks.map(w => `Wk${w.weekNum}: ${w.calHitRate}% cal · ${w.proHitRate}% pro`).join('\n');
      badges.push(`<div class="badge blue" title="${weekTitle}"><strong>${calIcon} Cal ${momentum.calHitTrend} · ${proIcon} Pro ${momentum.proHitTrend}</strong>Adherence momentum (wk-over-wk)</div>`);
    }

    if (badges.length) {
      dowEl.innerHTML = badges.join('');
      dowEl.style.display = '';
    } else {
      dowEl.style.display = 'none';
    }
  }
}

// Highlights & Streaks
function renderHighlights() {
  const badges = document.getElementById('highlightBadges');
  const filteredDays = getFilteredDays();
  if (!filteredDays.length) {
    badges.innerHTML = '<div class="badge">No data in the selected range.</div>';
    return;
  }
  // Weight loss
  const wDays = filteredDays.filter(d => d.weight);
  const wLoss = wDays.length > 1 ? (wDays[0].weight - wDays[wDays.length-1].weight).toFixed(1) : null;
  // Streaks
  let maxLiftStreak = 0, curLiftStreak = 0, maxCleanStreak = 0, curCleanStreak = 0;
  let curTrackStreak = 0, maxTrackStreak = 0;
  filteredDays.forEach(d => {
    if (d.lifting === 'Y') { curLiftStreak++; maxLiftStreak = Math.max(maxLiftStreak, curLiftStreak); } else curLiftStreak = 0;
    if (!d.drinks) { curCleanStreak++; maxCleanStreak = Math.max(maxCleanStreak, curCleanStreak); } else curCleanStreak = 0;
    curTrackStreak++; maxTrackStreak = Math.max(maxTrackStreak, curTrackStreak);
  });
  // Protein goal hits
  const proGoalDays = filteredDays.filter(hitProteinFloor).length;
  const proteinFloorLabel = proteinGoalRangeLabel(filteredDays);
  const hiCalDay = filteredDays.reduce((a,b) => (a.calories||0) > (b.calories||0) ? a : b);
  const loCalDay = filteredDays.reduce((a,b) => (a.calories||0) < (b.calories||0) ? a : b);

  badges.innerHTML = `
    <div class="badge green"><strong>${wLoss == null ? 'No weigh-ins' : `−${weightValue(Number(wLoss))} ${weightUnit()}`}</strong>Weight change (${filteredDays[0].date.slice(5)} → ${filteredDays[filteredDays.length-1].date.slice(5)})</div>
    <div class="badge blue"><strong>${wDays.length ? `${weightLabel(wDays[0].weight)} → ${weightLabel(wDays[wDays.length-1].weight)}` : 'No weigh-ins'}</strong>Body weight range</div>
    <div class="badge sky"><strong>${proGoalDays}/${filteredDays.length} days</strong>Hit 90%-of-body-weight protein floor (${proteinFloorLabel})</div>
    <div class="badge amber"><strong>${hiCalDay.date.slice(5)}</strong>Most calories (${energyLabel(hiCalDay.calories)})</div>
    <div class="badge rose"><strong>${loCalDay.date.slice(5)}</strong>Lowest calories (${energyLabel(loCalDay.calories)})</div>
    <div class="badge green"><strong>${maxCleanStreak} days</strong>Longest no-drink streak</div>
    <div class="badge blue"><strong>${maxLiftStreak} days</strong>Longest lift streak (consecutive)</div>
    <div class="badge sky"><strong>${filteredDays.length} days</strong>Tracked days in range</div>
  `;
}

// Sleep stat cards
function renderSleepStatCards() {
  const grid = document.getElementById('sleepStatGrid');
  const filteredSleep = getFilteredSleep();
  const months = {Jan: filteredSleep.filter(d=>d.date.startsWith('2026-01')), Feb: filteredSleep.filter(d=>d.date.startsWith('2026-02')), Mar: filteredSleep.filter(d=>d.date.startsWith('2026-03'))};
  const metrics = [
    { label: 'Avg Sleep Performance', key: 'perf', fmt: v => Math.round(v)+'%', goodDir: 'up' },
    { label: 'Avg Sleep Duration', key: 'hours', fmt: v => v.toFixed(1)+'h', goodDir: 'up' },
    { label: 'Avg Time in Bed', key: '_tib', fmt: v => v.toFixed(1)+'h', goodDir: 'down', computed: days => {
      const valid = days.filter(d => d.hours && d.efficiency);
      return valid.length ? valid.reduce((s, d) => s + (d.hours / (d.efficiency / 100)), 0) / valid.length : null;
    }},
    { label: 'Avg Deep Sleep', key: 'deep', fmt: v => v.toFixed(1)+'h', goodDir: 'up' },
    { label: 'Avg REM Sleep', key: 'rem', fmt: v => v.toFixed(1)+'h', goodDir: 'up' },
  ];
  grid.innerHTML = '';
  metrics.forEach(m => {
    const vals = m.computed
      ? [m.computed(months.Jan), m.computed(months.Feb), m.computed(months.Mar)]
      : [avgOrNull(months.Jan, m.key), avgOrNull(months.Feb, m.key), avgOrNull(months.Mar, m.key)];
    let arrows = ['','',''];
    for (let i = 1; i < 3; i++) {
      if (vals[i] == null || vals[i - 1] == null) continue;
      const delta = vals[i] - vals[i-1];
      if (Math.abs(delta) < 0.5 && m.key === 'perf' || Math.abs(delta) < 0.05 && m.key !== 'perf') { arrows[i] = '<span class="trend-arrow trend-neutral">→</span>'; continue; }
      const up = delta > 0;
      const good = (m.goodDir === 'up' && up) || (m.goodDir === 'down' && !up);
      const cls = good ? (up ? 'trend-up-good' : 'trend-down-good') : (up ? 'trend-up-bad' : 'trend-down-bad');
      arrows[i] = `<span class="trend-arrow ${cls}">${up ? '▲' : '▼'}</span>`;
    }
    const card = document.createElement('div');
    card.className = 'stat-card';
    const mos = ['Jan','Feb','Mar'];
    card.innerHTML = `<div class="label">${m.label}</div><div class="months">${mos.map((mo,i) => `<div class="month-val"><span class="month-name">${mo}</span><span class="val col-${mo.toLowerCase()}">${vals[i] == null ? '—' : m.fmt(vals[i])}${arrows[i]}</span></div>`).join('')}</div>`;
    grid.appendChild(card);
  });
}

// Weekly report
function renderWeeklyReport() {
  const r = generateWeeklyReport();
  const denom = Math.min(getFilteredDays().length, 7);
  document.getElementById('weeklyReportText').textContent = r.text;
  const pills = document.getElementById('weeklyReportPills');
  pills.innerHTML = `
    <span class="rpill ${r.avgCal <= goals.calories ? 'good' : 'warn'}">${energyLabel(r.avgCal)} avg</span>
    <span class="rpill ${r.hiProDays >= 5 ? 'good' : r.hiProDays >= 3 ? 'warn' : 'bad'}">${r.hiProDays}/${denom} protein floor</span>
    <span class="rpill ${r.liftCount >= 3 ? 'good' : r.liftCount >= 2 ? 'warn' : 'bad'}">${r.liftCount}x lifted</span>
    <span class="rpill ${r.drinkCount === 0 ? 'good' : r.drinkCount <= 1 ? 'warn' : 'bad'}">${r.drinkCount} drink nights</span>
    <span class="rpill ${r.avgSleepPerf >= 65 ? 'good' : r.avgSleepPerf >= 50 ? 'warn' : 'bad'}">${r.avgSleepPerf}% sleep</span>
  `;
  const reviewGrid = document.getElementById('weeklyReviewGrid');
  const reviewCallouts = document.getElementById('weeklyReviewCallouts');
  if (!r.lastDays.length) {
    reviewGrid.innerHTML = '';
    reviewCallouts.innerHTML = '';
    return;
  }

  const current = r.currentSummary;
  const previous = r.previousSummary;
  const drivers = getDriverRanking(r.lastDays, r.lastSleep);
  const recommendations = recommendationList(current, previous, r.lastDays, r.lastSleep);
  const energyBalance = energyBalanceSummary(r.lastDays);
  const currentTrend = weightTrendReality(r.lastDays).actualLoss;
  const previousTrend = weightTrendReality(r.prevWeek).actualLoss;
  const weightDelta = compareDelta(currentTrend, previousTrend, 'up', v => weightValue(Math.abs(v)).toString(), ` ${weightUnit()}`);
  const calorieDelta = compareDelta(current.avgCalories, previous.avgCalories, 'down', v => Math.round(energyValue(v) ?? 0).toLocaleString(), ` ${energyUnit()}`);
  const proteinDelta = compareDelta(current.proteinHitRate, previous.proteinHitRate, 'up', v => `${Math.round(v)}%`);
  const sleepDelta = compareDelta(current.avgSleepPerf, previous.avgSleepPerf, 'up', v => `${Math.round(v)}%`);
  const weeklyFocus = recommendations[0] || { title: 'Keep the current setup stable', text: 'The latest week does not show one dominant issue. Stay consistent and keep collecting clean signal.' };
  const biggestDriver = drivers[0] || { title: 'Not enough signal yet', text: 'The latest week does not have enough contrast to rank a strong behavioral driver.', sample: 'n is limited in the latest 7-day view.' };

  reviewGrid.innerHTML = [
    {
      label: 'Weight Trend',
      value: currentTrend != null ? `${currentTrend >= 0 ? '−' : '+'}${weightLabel(Math.abs(currentTrend), 1)}` : '—',
      sub: weightDelta.detail
    },
    {
      label: 'Average Intake',
      value: energyLabel(current.avgCalories),
      sub: energyBalance
        ? `${energyBalance.totalDeficit >= 0 ? '~' + energyLabel(Math.abs(energyBalance.totalDeficit)) + ' below' : '~' + energyLabel(Math.abs(energyBalance.totalDeficit)) + ' above'} maintenance this week · ${calorieDelta.text} vs prior week`
        : `${calorieDelta.text} vs prior week`
    },
    {
      label: 'Protein Adherence',
      value: `${Math.round(current.proteinHitRate)}%`,
      sub: `${r.hiProDays}/${r.lastDays.length} days at floor · ${proteinDelta.text} vs prior week`
    },
    {
      label: 'Sleep Trend',
      value: current.avgSleepPerf != null ? `${Math.round(current.avgSleepPerf)}%` : '—',
      sub: current.avgSleepHours != null ? `${current.avgSleepHours.toFixed(1)}h avg · ${sleepDelta.text} vs prior week` : 'No sleep entries'
    }
  ].map(card => `
    <div class="score-card">
      <div class="eyebrow">${card.label}</div>
      <div class="value">${card.value}</div>
      <div class="sub">${card.sub}</div>
    </div>
  `).join('');

  reviewCallouts.innerHTML = `
    <div class="review-note">
      <strong>Biggest Driver</strong>
      <p>${biggestDriver.title}. ${biggestDriver.text} ${biggestDriver.sample || ''}</p>
    </div>
    <div class="review-note">
      <strong>Next Focus</strong>
      <p>${weeklyFocus.title}. ${weeklyFocus.text}</p>
    </div>
  `;
}

function renderHeroStage(current, previous, filteredDays, filteredSleep) {
  const weightDays = filteredDays.filter(d => d.weight);
  const weightVals = weightDays.map(d => weightValue(d.weight));
  const weightRolling = rollingAvg(weightDays.map(d => d.weight), 7).map(v => v == null ? null : weightValue(v));
  const weightBounds = calcAxisBounds(weightVals, useMetric ? 0.8 : 2);
  allCharts.heroWeightChart.data.labels = weightDays.map(d => d.date.slice(5));
  allCharts.heroWeightChart.data.datasets[0].data = weightVals;
  allCharts.heroWeightChart.data.datasets[1].data = weightRolling;
  allCharts.heroWeightChart.options.scales.y.min = Math.floor(weightBounds.min);
  allCharts.heroWeightChart.options.scales.y.max = Math.ceil(weightBounds.max);
  allCharts.heroWeightChart.options.scales.y.ticks.callback = v => `${v} ${weightUnit()}`;
  allCharts.heroWeightChart.options.plugins.tooltip.callbacks.label = ctx => ctx.datasetIndex === 0 ? ` ${ctx.parsed.y} ${weightUnit()}` : ` 7d avg: ${ctx.parsed.y} ${weightUnit()}`;
  allCharts.heroWeightChart.update();

  const calVals = filteredDays.map(d => energyValue(d.calories));
  allCharts.heroCalChart.data.labels = filteredDays.map(d => d.date.slice(5));
  allCharts.heroCalChart.data.datasets[0].data = calVals;
  allCharts.heroCalChart.options.plugins.tooltip.callbacks.label = ctx => ` ${ctx.parsed.y.toLocaleString()} ${energyUnit()}`;
  allCharts.heroCalChart.update();

  const sleepVals = filteredSleep.map(d => d.perf);
  allCharts.heroSleepChart.data.labels = filteredSleep.map(d => d.date.slice(5));
  allCharts.heroSleepChart.data.datasets[0].data = sleepVals;
  allCharts.heroSleepChart.options.plugins.tooltip.callbacks.label = ctx => ` ${ctx.parsed.y}% sleep performance`;
  allCharts.heroSleepChart.update();

  const trendReality = weightTrendReality(filteredDays);
  const energyBalance = energyBalanceSummary(filteredDays);
  const plateau = plateauNoiseAssessment(filteredDays, filteredSleep);
  const lag = getLagMetrics(filteredDays, filteredSleep);
  const observedLoss = trendReality.actualLoss;
  const weightTrend = observedLoss == null
    ? 'No weigh-in trend yet.'
    : observedLoss >= 0
      ? `Smoothed weight trend is down ${weightValue(Math.abs(observedLoss))} ${weightUnit()} across the range.`
      : `Smoothed weight trend is up ${weightValue(Math.abs(observedLoss))} ${weightUnit()} across the range.`;
  const sleepTrend = current.avgSleepPerf != null && previous.avgSleepPerf != null ? `${Math.round(current.avgSleepPerf)}% sleep vs ${Math.round(previous.avgSleepPerf)}% in ${compareModeLabel()}.` : 'Sleep direction will appear here once both periods have sleep data.';
  const realityTrend = trendReality.actualLoss != null && trendReality.expectedLoss != null ? `Observed trend loss is ${weightValue(trendReality.actualLoss)} ${weightUnit()} vs ${weightValue(trendReality.expectedLoss)} ${weightUnit()} implied by the logged deficit.` : '';
  const lagTrend = lag.drinkSleepGap != null && lag.drinkSleepGap > 0 ? `Drink-following mornings are still costing about ${lag.drinkSleepGap.toFixed(0)} sleep-performance points.` : plateau.text;
  document.getElementById('heroTitle').textContent = current.weightChange != null && current.weightChange < 0 ? 'Weight Trend and Recovery' : 'Range Trend Overview';
  document.getElementById('heroSubtitle').textContent = `${weightTrend} ${sleepTrend} ${realityTrend} ${lagTrend}`.trim();
  document.getElementById('heroCalValue').textContent = current.avgCalories != null ? energyLabel(current.avgCalories) : '—';
  document.getElementById('heroCalSub').textContent = energyBalance
    ? `${energyBalance.totalDeficit >= 0 ? '~' + energyLabel(Math.abs(energyBalance.totalDeficit)) + ' below' : '~' + energyLabel(Math.abs(energyBalance.totalDeficit)) + ' above'} maintenance across the range · ${energyBalance.weeklyPace >= 0 ? '~' + energyLabel(Math.abs(energyBalance.weeklyPace)) + '/week deficit pace' : '~' + energyLabel(Math.abs(energyBalance.weeklyPace)) + '/week surplus pace'}`
    : 'No intake data in the selected range';
  document.getElementById('heroSleepValue').textContent = current.avgSleepPerf != null ? `${Math.round(current.avgSleepPerf)}%` : '—';
  document.getElementById('heroSleepSub').textContent = current.avgSleepHours != null ? `${current.avgSleepHours.toFixed(1)}h average sleep with ${Math.round(current.sleepHitRate)}% target hit rate` : 'No sleep entries in the selected range';
  document.getElementById('heroPulseTitle').textContent = current.drinkNights === 0 ? 'No drink nights in range' : `${current.drinkNights} drink night${current.drinkNights === 1 ? '' : 's'}`;
  document.getElementById('heroPulseSub').textContent = current.drinkNights === 0 ? 'The biggest recovery drag is absent in this range.' : 'Alcohol load is present and likely affecting recovery.';
  document.getElementById('heroPulse').innerHTML = `
    <div class="pulse-item"><div class="k">${Math.round(current.proteinHitRate)}%</div><div class="t">Protein Floor</div></div>
    <div class="pulse-item"><div class="k">${current.liftCount}x</div><div class="t">Lifts</div></div>
    <div class="pulse-item"><div class="k">${Math.round(current.cleanRate)}%</div><div class="t">Clean Days</div></div>
  `;
}

function renderForecastStrip(filteredDays, filteredSleep) {
  const weightProjection = observedWeightProjection(filteredDays, 30);
  const deficitPace = deficitProjection(filteredDays, 30);
  const sleepProjection = sleepTargetProjection(filteredSleep, 14);
  const energyBalance = energyBalanceSummary(filteredDays);
  const latestDay = filteredDays[filteredDays.length - 1] || null;
  const latestSleep = latestDay ? (sleepByDate[latestDay.date] || filteredSleep[filteredSleep.length - 1] || null) : (filteredSleep[filteredSleep.length - 1] || null);
  const latestWeightDay = [...filteredDays].reverse().find(d => d.weight) || null;
  const weighInDelta = latestWeighInDelta(filteredDays);
  const calorieCurrent = currentStreak(filteredDays, d => d.calories <= goals.calories);
  const proteinCurrent = currentStreak(filteredDays, hitProteinFloor);
  const cleanCurrent = currentStreak(filteredDays, d => !d.drinks);
  const sleepCurrent = currentStreak(filteredSleep, d => d.perf >= goals.sleepPerf);
  const latestCalDelta = latestDay ? latestDay.calories - goals.calories : null;
  const flags = [];
  if (latestDay?.lifting === 'Y') flags.push('Lift');
  if (latestDay?.drinks) flags.push('Drink');
  if (latestDay && overallOnTrack(latestDay)) flags.push('On-track');

  const bfTarget = bodyFatTargetProjection(filteredDays, 18);
  const bfTarget15 = bodyFatTargetProjection(filteredDays, 15);

  document.getElementById('forecastStrip').innerHTML = [
    weightProjection
      ? `
        <div class="forecast-card mobile-primary">
        <div class="eyebrow">30-Day Weight Pace</div>
        <div class="value">${weightLabel(weightProjection.projectedWeight)}</div>
          <div class="sub">If the smoothed observed trend holds, that is ${weightProjection.projectedDelta < 0 ? 'down' : 'up'} ${weightLabel(Math.abs(weightProjection.projectedDelta))} from the latest weigh-in.</div>
          <div class="trust-row trust-inline"><span class="trust-pill projected">Projected</span><span class="trust-pill logged">Observed weigh-ins</span></div>
          <div class="confidence-pill ${weightProjection.confidence.cls}">${weightProjection.confidence.label}</div>
          <div class="tiny">${weightProjection.sampleSize} weigh-ins across ${weightProjection.spanDays} days · smoothed trend line</div>
        </div>
      `
      : `
        <div class="forecast-card mobile-primary">
          <div class="eyebrow">30-Day Weight Pace</div>
          <div class="value">—</div>
          <div class="sub">Need at least two weigh-ins in the active view to project the current weight slope forward.</div>
          <div class="trust-row trust-inline"><span class="trust-pill projected">Projected</span><span class="trust-pill logged">Observed weigh-ins</span></div>
          <div class="confidence-pill low">Low confidence</div>
          <div class="tiny">Observed trend projection</div>
        </div>
      `,
    deficitPace
      ? `
        <div class="forecast-card mobile-secondary">
        <div class="eyebrow">30-Day Deficit Pace</div>
        <div class="value">~${weightLabel(Math.abs(deficitPace.projectedLoss))}</div>
          <div class="sub">If intake stays near ${energyLabel(avgEffectiveCalories(filteredDays))}, the maintenance gap implies about ${weightLabel(Math.abs(deficitPace.projectedLoss))} of movement in 30 days.</div>
          <div class="trust-row trust-inline"><span class="trust-pill projected">Projected</span><span class="trust-pill estimated">Estimated TDEE</span></div>
          <div class="confidence-pill ${deficitPace.confidence.cls}">${deficitPace.confidence.label}</div>
          <div class="tiny">${energyBalance ? `${energyBalance.totalDeficit >= 0 ? '~' + energyLabel(Math.abs(energyBalance.totalDeficit)) + ' below' : '~' + energyLabel(Math.abs(energyBalance.totalDeficit)) + ' above'} maintenance in-range · ` : ''}${deficitPace.avgDeficit >= 0 ? 'Deficit' : 'Surplus'} pace: ${energyLabel(Math.abs(deficitPace.avgDeficit))}/day vs ~${energyLabel(estimatedTDEE)} TDEE</div>
        </div>
      `
      : `
        <div class="forecast-card mobile-secondary">
          <div class="eyebrow">30-Day Deficit Pace</div>
          <div class="value">—</div>
          <div class="sub">Need enough intake data in the active view to project the current deficit pace.</div>
          <div class="trust-row trust-inline"><span class="trust-pill projected">Projected</span><span class="trust-pill estimated">Estimated TDEE</span></div>
          <div class="confidence-pill low">Low confidence</div>
          <div class="tiny">Deficit-based estimate</div>
        </div>
      `,
    `
      <div class="forecast-card mobile-primary">
        <div class="eyebrow">Estimated TDEE</div>
        <div class="value">${energyLabel(estimatedTDEE)}</div>
        <div class="sub">Current working maintenance estimate from recency-weighted effective intake and the smoothed weight trend.</div>
        <div class="trust-row trust-inline"><span class="trust-pill estimated">Estimated maintenance</span></div>
        <div class="confidence-pill ${overallTDEEProfile.confidence.cls}">${overallTDEEProfile.confidence.label}</div>
        <div class="tiny">Weighted intake: ~${energyLabel(overallTDEEProfile.weightedIntake)} · trend pace: ${weightLabel(Math.abs(overallTDEEProfile.weeklyLoss), 2)}/wk · range: ${energyLabel(tdeeRange.low)}–${energyLabel(tdeeRange.high)}</div>
      </div>
    `,
    sleepProjection
      ? `
        <div class="forecast-card mobile-secondary">
          <div class="eyebrow">Next 14 Nights</div>
          <div class="value">${sleepProjection.expectedHits}/${sleepProjection.horizonNights}</div>
          <div class="sub">Projected sleep-target hits if the current ${Math.round(sleepProjection.hitRate)}% pace holds across the next two weeks.</div>
          <div class="trust-row trust-inline"><span class="trust-pill projected">Projected</span><span class="trust-pill logged">Logged sleep</span></div>
          <div class="confidence-pill ${sleepProjection.confidence.cls}">${sleepProjection.confidence.label}</div>
          <div class="tiny">${sleepProjection.avgPerf != null ? `${Math.round(sleepProjection.avgPerf)}% average sleep performance` : 'Sleep pace only'}</div>
        </div>
      `
      : `
        <div class="forecast-card mobile-secondary">
          <div class="eyebrow">Next 14 Nights</div>
          <div class="value">—</div>
          <div class="sub">Need sleep entries in the active view to project target-hit pace over the next two weeks.</div>
          <div class="trust-row trust-inline"><span class="trust-pill projected">Projected</span><span class="trust-pill logged">Logged sleep</span></div>
          <div class="confidence-pill low">Low confidence</div>
          <div class="tiny">Sleep-target projection</div>
        </div>
      `,
    `
      <div class="forecast-card mobile-primary">
        <div class="eyebrow">Latest Snapshot</div>
        <div class="value">${latestDay ? formatShortDate(latestDay.date) : '—'}</div>
        <div class="sub">${latestDay ? `${energyLabel(latestDay.calories)} (${latestCalDelta > 0 ? '+' : ''}${energyLabel(latestCalDelta || 0)} vs goal) · ${Math.round(latestDay.protein)}g protein` : 'No entries in the active view.'}</div>
        <div class="sub">${latestSleep ? `${Math.round(latestSleep.perf)}% sleep · ${latestSleep.hours.toFixed(1)}h` : 'No sleep entry for the latest logged day.'}</div>
        <div class="trust-row trust-inline"><span class="trust-pill logged">Latest logged entries</span></div>
        <div class="mini-metric-grid">
          <div class="mini-metric"><div class="k">${calorieCurrent}</div><div class="t">Cal Goal</div></div>
          <div class="mini-metric"><div class="k">${proteinCurrent}</div><div class="t">Protein</div></div>
          <div class="mini-metric"><div class="k">${cleanCurrent}</div><div class="t">Clean Days</div></div>
        </div>
        <div class="tiny">${weighInDelta ? `${weightLabel(weighInDelta.latest.weight)} (${weighInDelta.delta > 0 ? '+' : ''}${weightLabel(weighInDelta.delta)} vs prior)` : latestWeightDay ? `${weightLabel(latestWeightDay.weight)} latest weigh-in` : 'No weigh-ins in active view'}${flags.length ? ` · ${flags.join(' · ')}` : ''}${sleepCurrent ? ` · ${sleepCurrent} sleep-target nights` : ''}</div>
      </div>
    `,
    bfTarget
      ? `
        <div class="forecast-card mobile-secondary">
          <div class="eyebrow">Time to ${bfTarget.targetBfPct}% BF</div>
          <div class="value">${bfTarget.daysToTarget === 0 ? 'Already there!' : `~${bfTarget.daysToTarget} days`}</div>
          <div class="sub">${bfTarget.daysToTarget > 0 ? `At current pace, you'd hit ${bfTarget.targetBfPct}% body fat around ${weightLabel(bfTarget.targetWeight)}. Currently ~${bfTarget.currentBfPct.toFixed(1)}% BF (est).` : `Estimated BF is already at or below ${bfTarget.targetBfPct}%.`}${bfTarget15 && bfTarget15.daysToTarget > 0 ? ` · 15% BF: ~${bfTarget15.daysToTarget} days (~${weightLabel(bfTarget15.targetWeight)})` : ''}</div>
          <div class="trust-row trust-inline"><span class="trust-pill projected">Projected</span><span class="trust-pill estimated">DXA-anchored model</span></div>
          <div class="confidence-pill ${bfTarget.confidence.cls}">${bfTarget.confidence.label}</div>
          <div class="tiny">Based on regression slope of ${(bfTarget.dailySlope * 7).toFixed(2)} ${weightUnit()}/wk</div>
        </div>
      `
      : `
        <div class="forecast-card mobile-secondary">
          <div class="eyebrow">Time to 18% BF</div>
          <div class="value">—</div>
          <div class="sub">Need a downward weight trend to estimate time to body fat target.</div>
          <div class="trust-row trust-inline"><span class="trust-pill projected">Projected</span><span class="trust-pill estimated">DXA-anchored model</span></div>
          <div class="confidence-pill low">Low confidence</div>
          <div class="tiny">Body fat projection</div>
        </div>
      `
  ].join('');
}

function renderExecutiveSummary() {
  const filteredDays = getComparisonCurrentDays();
  const filteredSleep = getSleepForDays(getComparisonCurrentBaseDays());
  const previousBaseDays = getPreviousPeriodBaseDays();
  const previousDays = getPreviousPeriodDays();
  const previousSleep = getSleepForDays(previousBaseDays);
  const currentTrendLoss = weightTrendReality(filteredDays).actualLoss;
  const previousTrendLoss = weightTrendReality(previousDays).actualLoss;
  const current = summarizeRange(filteredDays, filteredSleep);
  const previous = summarizeRange(previousDays, previousSleep);
  const weightDelta = compareDelta(currentTrendLoss, previousTrendLoss, 'up', v => weightValue(Math.abs(v)).toString(), ` ${weightUnit()}`);
  const calDelta = compareDelta(current.avgCalories, previous.avgCalories, 'down', v => Math.round(energyValue(v) ?? 0).toLocaleString(), ` ${energyUnit()}`);
  const proteinDelta = compareDelta(current.proteinHitRate, previous.proteinHitRate, 'up', v => `${Math.round(v)}%`);
  const sleepDelta = compareDelta(current.avgSleepPerf, previous.avgSleepPerf, 'up', v => `${Math.round(v)}%`);
  const drinkDelta = compareDelta(current.drinkNights, previous.drinkNights, 'down', v => `${Math.round(v)}`);
  const trendReality = weightTrendReality(filteredDays);
  const energyBalance = energyBalanceSummary(filteredDays);
  const plateau = plateauNoiseAssessment(filteredDays, filteredSleep);
  const lag = getLagMetrics(filteredDays, filteredSleep);
  const recommendations = recommendationList(current, previous, filteredDays, filteredSleep);
  const drivers = getDriverRanking(filteredDays, filteredSleep);
  const outliers = getOutliers(filteredDays, filteredSleep);
  const foodPatterns = foodPatternSummary(filteredDays);

  renderHeroStage(current, previous, filteredDays, filteredSleep);
  renderForecastStrip(filteredDays, filteredSleep);

  document.getElementById('stickySummary').innerHTML = `
    <div class="summary-hero">
      <div class="eyebrow">Summary Window</div>
      <div class="hero-value">${labelForDays(getComparisonCurrentBaseDays())}</div>
      <div class="hero-sub">${filteredDays.length} tracked days, ${filteredSleep.length} sleep entries, filtered to ${filterLabel()}, compared with ${previousDays.length || 0} prior days from ${compareModeLabel()}. ${plateau.title}</div>
    </div>
    <div class="summary-chip"><div class="eyebrow">Weight</div><div class="value">${current.lastWeight != null ? weightLabel(current.lastWeight) : '—'}</div><div class="sub">${weightDelta.detail}</div></div>
    <div class="summary-chip"><div class="eyebrow">Calories</div><div class="value">${current.avgCalories != null ? energyLabel(current.avgCalories) : '—'}</div><div class="sub">vs prior: ${calDelta.text}</div></div>
    <div class="summary-chip"><div class="eyebrow">Protein Hit Rate</div><div class="value">${Math.round(current.proteinHitRate)}%</div><div class="sub">vs prior: ${proteinDelta.text}</div></div>
    <div class="summary-chip"><div class="eyebrow">Sleep</div><div class="value">${current.avgSleepPerf != null ? `${Math.round(current.avgSleepPerf)}%` : '—'}</div><div class="sub">${current.avgSleepHours != null ? `${current.avgSleepHours.toFixed(1)}h avg` : 'No sleep data'}</div></div>
  `;

  document.getElementById('executiveKpis').innerHTML = [
    { label: 'Current Weight', value: current.lastWeight != null ? weightLabel(current.lastWeight) : '—', sub: trendReality.actualLoss != null ? `${trendReality.actualLoss >= 0 ? 'Smoothed trend down' : 'Smoothed trend up'} ${weightValue(Math.abs(trendReality.actualLoss))} ${weightUnit()} in range` : 'No weigh-ins', delta: weightDelta },
    { label: 'Avg Calories', value: current.avgCalories != null ? energyLabel(current.avgCalories) : '—', sub: energyBalance ? `${energyBalance.totalDeficit >= 0 ? '~' + energyLabel(Math.abs(energyBalance.totalDeficit)) + ' below' : '~' + energyLabel(Math.abs(energyBalance.totalDeficit)) + ' above'} maintenance · ${energyBalance.weeklyPace >= 0 ? '~' + energyLabel(Math.abs(energyBalance.weeklyPace)) + '/week deficit pace' : '~' + energyLabel(Math.abs(energyBalance.weeklyPace)) + '/week surplus pace'}` : 'No intake data', delta: calDelta },
    { label: 'Protein Adherence', value: `${Math.round(current.proteinHitRate)}%`, sub: current.avgProtein != null ? `${Math.round(current.avgProtein)}g average protein` : 'No data', delta: proteinDelta },
    { label: 'Sleep Performance', value: current.avgSleepPerf != null ? `${Math.round(current.avgSleepPerf)}%` : '—', sub: current.avgSleepHours != null ? `${current.avgSleepHours.toFixed(1)}h average sleep` : 'No sleep data', delta: sleepDelta },
    { label: 'Drink Nights', value: `${current.drinkNights}`, sub: `${Math.round(current.cleanRate)}% clean-day rate`, delta: drinkDelta, mobileOptional: true },
    { label: 'Lift Frequency', value: `${current.liftCount}x`, sub: `${(current.liftCount / Math.max(current.daysCount, 1) * 7).toFixed(1)} lifts/week pace`, delta: compareDelta(current.liftCount, previous.liftCount, 'up', v => `${Math.round(v)}`), mobileOptional: true }
  ].map(kpi => `
    <div class="kpi-card${kpi.mobileOptional ? ' mobile-optional' : ''}">
      <div class="eyebrow">${kpi.label}</div>
      <div class="value">${kpi.value}</div>
      <div class="delta-row"><span class="delta-pill ${kpi.delta.cls}">${kpi.delta.text}</span></div>
      <div class="sub">${kpi.sub}</div>
    </div>
  `).join('');

  document.getElementById('compareGrid').innerHTML = [
    { label: 'Weight Trend', delta: weightDelta, note: `Selected range vs ${compareModeLabel()}` },
    { label: 'Calories', delta: calDelta, note: calDelta.detail },
    { label: 'Protein Hit Rate', delta: proteinDelta, note: proteinDelta.detail },
    { label: 'Sleep Performance', delta: sleepDelta, note: sleepDelta.detail },
    { label: 'Drink Nights', delta: drinkDelta, note: drinkDelta.detail },
    { label: 'Lift Count', delta: compareDelta(current.liftCount, previous.liftCount, 'up', v => `${Math.round(v)}`), note: `${current.liftCount} vs ${previous.liftCount}` },
    { label: 'Expected vs Trend Loss', delta: compareDelta(trendReality.actualLoss, trendReality.expectedLoss, 'up', v => weightValue(Math.abs(v)).toString(), ` ${weightUnit()}`), note: trendReality.actualLoss != null && trendReality.expectedLoss != null ? `${weightValue(trendReality.actualLoss)} ${weightUnit()} observed trend vs ${weightValue(trendReality.expectedLoss)} ${weightUnit()} deficit-implied` : 'Need at least two weigh-ins in view' }
  ].map(item => `
    <div class="compare-card">
      <div class="eyebrow">${item.label}</div>
      <div class="delta">${item.delta.text}</div>
      <div class="tiny">${item.note}</div>
    </div>
  `).join('');

  document.getElementById('actionList').innerHTML = recommendations.map(rec => `
    <div class="insight-item">
      <strong>${rec.title}</strong>
      <p>${rec.text}</p>
    </div>
  `).join('');

  document.getElementById('behaviorScorecard').innerHTML = [
    { label: 'Calories', value: `${Math.round(current.calorieHitRate)}%`, sub: `${filteredDays.filter(d => d.calories <= goals.calories).length}/${filteredDays.length} days under calorie goal · ${currentStreak(filteredDays, d => d.calories <= goals.calories)} current / ${bestStreak(filteredDays, d => d.calories <= goals.calories)} best streak` },
    { label: 'Protein', value: `${Math.round(current.proteinHitRate)}%`, sub: `${filteredDays.filter(hitProteinFloor).length}/${filteredDays.length} days at protein floor (${proteinGoalRangeLabel(filteredDays)}) · ${currentStreak(filteredDays, hitProteinFloor)} current / ${bestStreak(filteredDays, hitProteinFloor)} best` },
    { label: 'Sleep Perf', value: `${Math.round(current.sleepHitRate)}%`, sub: `${filteredSleep.filter(d => d.perf >= goals.sleepPerf).length}/${filteredSleep.length || 0} nights at sleep target · ${currentStreak(filteredSleep, d => d.perf >= goals.sleepPerf)} current / ${bestStreak(filteredSleep, d => d.perf >= goals.sleepPerf)} best` },
    { label: 'Bedtime', value: `${Math.round(current.bedtimeHitRate)}%`, sub: `Goal: ${goals.bedtime}` },
    { label: 'Clean Nights', value: `${Math.round(current.cleanRate)}%`, sub: `${current.drinkNights} drink nights in range · ${currentStreak(filteredDays, d => !d.drinks)} current / ${bestStreak(filteredDays, d => !d.drinks)} best clean streak` },
    { label: 'Lifts / Week', value: `${(current.liftCount / Math.max(filteredDays.length, 1) * 7).toFixed(1)}`, sub: `${current.liftCount} sessions across the range` }
  ].map(card => `
    <div class="score-card">
      <div class="eyebrow">${card.label}</div>
      <div class="value">${card.value}</div>
      <div class="sub">${card.sub}</div>
    </div>
  `).join('');

  document.getElementById('patternList').innerHTML = [
    { title: 'Weekday pattern', text: getWeekdayPatternText(filteredSleep) },
    { title: 'Weekend effect', text: current.avgWeekendSleep != null && current.avgWeekdaySleep != null ? `Weekend sleep averages ${current.avgWeekendSleep.toFixed(1)}% vs ${current.avgWeekdaySleep.toFixed(1)}% on weekdays.` : 'Not enough sleep data to compare weekends vs weekdays.' },
    { title: 'Plateau vs noise', text: plateau.text },
    { title: 'Drink-following mornings', text: lag.drinkSleepGap != null ? `${lag.afterDrinkAvg.toFixed(1)}% sleep after drink nights vs ${lag.afterCleanAvg.toFixed(1)}% after clean nights (gap: ${lag.drinkSleepGap.toFixed(1)} pts).` : 'Need more drink-vs-clean sleep contrast in the selected range.' },
    { title: 'Sleep to next-day intake', text: lag.poorSleepNextDayGap != null ? `${energyLabel(lag.poorSleepNextDayAvg)} after poor sleep vs ${energyLabel(lag.goodSleepNextDayAvg)} after good sleep.` : 'Need more sleep/intake pairs to quantify the next-day intake effect.' },
    { title: 'Highest-calorie outlier', text: `${outliers.highCal.date.slice(5)} at ${energyLabel(outliers.highCal.calories)}.` },
    { title: 'Lowest sleep outlier', text: outliers.lowSleep ? `${outliers.lowSleep.date.slice(5)} at ${outliers.lowSleep.perf}% sleep performance after ${outliers.lowSleep.hours}h.` : 'No sleep entries.' },
    { title: 'Largest logged weight drop', text: outliers.biggestWeightDrop ? `${outliers.biggestWeightDrop.date.slice(5)} moved ${weightValue(Math.abs(outliers.biggestWeightDrop.delta))} ${weightUnit()} vs the previous weigh-in.` : 'Not enough weigh-ins to detect jumps.' }
  ].map(item => `
    <div class="insight-item">
      <strong>${item.title}</strong>
      <p>${item.text}</p>
    </div>
  `).join('');

  document.getElementById('driverList').innerHTML = drivers.map(driver => `
    <div class="driver-item">
      <strong>${driver.title}</strong>
      <p>${driver.text}</p>
      <p class="subtle-note">${driver.sample}</p>
    </div>
  `).join('');

  document.getElementById('foodPatternList').innerHTML = [
    { title: `Foods overrepresented on on-target days (n=${foodPatterns.onTrackCount})`, text: foodPatterns.onTrackFoods.length ? foodPatterns.onTrackFoods.map(formatFoodAssoc).join(', ') : 'No food stands out as especially associated with on-target days in this range.' },
    { title: `Foods overrepresented on high-calorie days (n=${foodPatterns.overTargetCount})`, text: foodPatterns.overTargetFoods.length ? foodPatterns.overTargetFoods.map(formatFoodAssoc).join(', ') : 'No food stands out as especially associated with over-target days in this range.' },
    { title: `Foods before poor-sleep follow-up days (n=${foodPatterns.poorNextSleepCount})`, text: foodPatterns.poorNextSleepFoods.length ? foodPatterns.poorNextSleepFoods.map(formatFoodAssoc).join(', ') : 'No food stands out as especially associated with poor next-day sleep in this range.' },
    { title: 'Most consistent staples', text: foodPatterns.stapleFoods.length ? foodPatterns.stapleFoods.join(', ') : 'No repeated foods found.' }
  ].map(item => `
    <div class="insight-item">
      <strong>${item.title}</strong>
      <p>${item.text}</p>
    </div>
  `).join('');
}

function dayOfWeekAverages(days) {
  const buckets = [[], [], [], [], [], [], []];
  days.forEach(d => {
    const idx = new Date(d.date + 'T12:00:00').getDay();
    buckets[(idx + 6) % 7].push(d.perf);
  });
  return buckets.map(vals => vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : 0);
}

function bedtimeBuckets(days) {
  const buckets = [
    { label: 'Before 2am', values: [] },
    { label: '2am–4am', values: [] },
    { label: 'After 4am', values: [] }
  ];
  days.forEach(d => {
    let hour = d.bedtime_hour > 12 ? d.bedtime_hour - 24 : d.bedtime_hour;
    if (hour < 2) buckets[0].values.push(d.perf);
    else if (hour < 4) buckets[1].values.push(d.perf);
    else buckets[2].values.push(d.perf);
  });
  return buckets.map(bucket => ({
    label: `${bucket.label}\n(n=${bucket.values.length})`,
    value: bucket.values.length ? +(bucket.values.reduce((a, b) => a + b, 0) / bucket.values.length).toFixed(1) : 0
  }));
}

function renderSleepInsights() {
  const filteredSleep = getFilteredSleep();
  const badges = document.getElementById('sleepInsightBadges');
  if (!filteredSleep.length) {
    badges.innerHTML = '<div class="badge">No sleep data in the selected range.</div>';
    return;
  }

  const afterDrink = [];
  const afterClean = [];
  filteredSleep.forEach(d => {
    if (drinkDates.has(prevDay(d.date))) afterDrink.push(d.perf);
    else afterClean.push(d.perf);
  });
  const avgAfterDrink = afterDrink.length ? +(afterDrink.reduce((a, b) => a + b, 0) / afterDrink.length).toFixed(1) : 0;
  const avgAfterClean = afterClean.length ? +(afterClean.reduce((a, b) => a + b, 0) / afterClean.length).toFixed(1) : 0;
  const bedtimeCorr = pearson(
    filteredSleep.map(d => (d.bedtime_hour > 12 ? d.bedtime_hour - 24 : d.bedtime_hour)),
    filteredSleep.map(d => d.perf)
  );
  const bucketData = bedtimeBuckets(filteredSleep);
  const dowAvg = dayOfWeekAverages(filteredSleep);
  const dowLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const bestDowIdx = dowAvg.indexOf(Math.max(...dowAvg));
  const worstDowIdx = dowAvg.indexOf(Math.min(...dowAvg.filter(v => v > 0)));
  const goodSleepCals = filteredSleep.filter(d => d.perf >= goals.sleepPerf).map(d => macroByDate[d.date]?.calories).filter(Boolean);
  const badSleepCals = filteredSleep.filter(d => d.perf < goals.sleepPerf).map(d => macroByDate[d.date]?.calories).filter(Boolean);
  const lag = getLagMetrics(getFilteredDays(), filteredSleep);
  const avgBadSleepCals = badSleepCals.length ? Math.round(badSleepCals.reduce((a, b) => a + b, 0) / badSleepCals.length) : 0;
  const avgGoodSleepCals = goodSleepCals.length ? Math.round(goodSleepCals.reduce((a, b) => a + b, 0) / goodSleepCals.length) : 0;
  const respStart = filteredSleep[0]?.resp;
  const respEnd = filteredSleep[filteredSleep.length - 1]?.resp;

  badges.innerHTML = `
    <div class="badge rose"><strong>${avgAfterDrink.toFixed(1)}% vs ${avgAfterClean.toFixed(1)}%</strong>Previous-night drinks vs clean nights on next-morning sleep (n=${afterDrink.length}/${afterClean.length})</div>
    <div class="badge rose"><strong>r = ${bedtimeCorr.toFixed(2)}</strong>Normalized bedtime vs same-night sleep quality (n=${filteredSleep.length})</div>
    <div class="badge amber"><strong>${bucketData.map(b => `${Math.round(b.value)}%`).join(' → ')}</strong>Sleep perf by bedtime bucket with explicit lag framing</div>
    <div class="badge blue"><strong>${dowLabels[bestDowIdx]} ${dowAvg[bestDowIdx].toFixed(1)}% · ${dowLabels[worstDowIdx]} ${dowAvg[worstDowIdx].toFixed(1)}%</strong>Best vs worst day of week for sleep</div>
    <div class="badge green"><strong>${energyLabel(lag.poorSleepNextDayAvg ?? avgBadSleepCals)} vs ${energyLabel(lag.goodSleepNextDayAvg ?? avgGoodSleepCals)}</strong>Next-day calories after poor vs good sleep (n=${lag.nextDayCalSample})</div>
    <div class="badge sky"><strong>${lag.liftNextDayWeightGap != null ? formatSignedWeight(lag.liftNextDayWeightGap) : '—'}</strong>Next-day scale move after lift days vs rest days (lag framing)</div>
    <div class="badge sky"><strong>${respStart?.toFixed(1) ?? '—'} → ${respEnd?.toFixed(1) ?? '—'} rpm</strong>Respiratory rate change across selected range</div>
  `;

  // Recovery bottleneck analysis
  const bottleneckEl = document.getElementById('recoveryBottleneckInsight');
  if (bottleneckEl) {
    const bottlenecks = filteredSleep.map(d => recoveryBottleneck(d)).filter(Boolean);
    if (bottlenecks.length >= 3) {
      const avgComponents = {};
      bottlenecks.forEach(components => {
        components.forEach(c => {
          if (!avgComponents[c.name]) avgComponents[c.name] = { total: 0, count: 0 };
          avgComponents[c.name].total += c.value;
          avgComponents[c.name].count++;
        });
      });
      const sorted = Object.entries(avgComponents)
        .map(([name, { total, count }]) => ({ name, avg: Math.round(total / count) }))
        .sort((a, b) => a.avg - b.avg);
      const weakest = sorted[0];
      const strongest = sorted[sorted.length - 1];
      bottleneckEl.innerHTML = `<div class="badge amber" style="max-width:100%;"><strong>Recovery Bottleneck: ${weakest.name} (avg ${weakest.avg}%)</strong>Your weakest recovery component is ${weakest.name} at ${weakest.avg}% average, while ${strongest.name} leads at ${strongest.avg}%. Focus on improving ${weakest.name} for the biggest recovery gains.</div>`;
    } else {
      bottleneckEl.innerHTML = '';
    }
  }

  // Macro ratio → sleep correlation
  const macroSleepEl = document.getElementById('macroSleepInsight');
  if (macroSleepEl) {
    const filteredDays = getFilteredDays();
    const msc = macroSleepCorrelations(filteredDays, filteredSleep);
    if (msc) {
      const strongest = [
        { label: 'Carb %', r: msc.carbPctVsPerf },
        { label: 'Fat %', r: msc.fatPctVsPerf },
        { label: 'Protein %', r: msc.proteinPctVsPerf },
        { label: 'Total calories', r: msc.caloriesVsPerf }
      ].sort((a, b) => Math.abs(b.r) - Math.abs(a.r))[0];
      const cq = msc.carbQuartiles;
      macroSleepEl.innerHTML = `<div class="badge blue" style="max-width:100%;"><strong>Macro → Sleep: ${strongest.label} has strongest link (r = ${strongest.r.toFixed(2)})</strong>Carb % vs sleep perf: r = ${msc.carbPctVsPerf.toFixed(2)} · Fat %: r = ${msc.fatPctVsPerf.toFixed(2)} · Protein %: r = ${msc.proteinPctVsPerf.toFixed(2)} · Total cal: r = ${msc.caloriesVsPerf.toFixed(2)}. ${cq[0].label} days (${cq[0].range}): ${cq[0].avgPerf}% avg sleep · ${cq[1].label} days (${cq[1].range}): ${cq[1].avgPerf}% avg sleep. (n=${msc.sampleSize})</div>`;
    } else {
      macroSleepEl.innerHTML = '';
    }
  }

  // Multi-day alcohol rebound
  const reboundEl = document.getElementById('alcoholReboundInsight');
  if (reboundEl) {
    const filteredDays = getFilteredDays();
    const rebound = alcoholRebound(filteredDays);
    if (rebound && rebound.some(r => r.calDelta != null)) {
      const lines = rebound.filter(r => r.calDelta != null).map(r =>
        `Day+${r.lag}: ${r.calDelta > 0 ? '+' : ''}${energyLabel(r.calDelta)} cal (n=${r.drinkNextCal.n}/${r.cleanNextCal.n})${r.sleepDelta != null ? ` · ${r.sleepDelta > 0 ? '+' : ''}${r.sleepDelta} pts sleep` : ''}`
      ).join(' · ');
      const maxLag = rebound.filter(r => r.calDelta != null).sort((a, b) => Math.abs(b.calDelta) - Math.abs(a.calDelta))[0];
      reboundEl.innerHTML = `<div class="badge rose" style="max-width:100%;"><strong>Alcohol Rebound: biggest calorie impact at day+${maxLag.lag} (${maxLag.calDelta > 0 ? '+' : ''}${energyLabel(maxLag.calDelta)})</strong>${lines}. Positive = more calories after drink nights vs clean nights.</div>`;
    } else {
      reboundEl.innerHTML = '';
    }
  }

  // Bedtime quintile optimization
  const bedtimeQEl = document.getElementById('bedtimeQuintileInsight');
  if (bedtimeQEl) {
    const quartiles = bedtimeQuintileAnalysis(filteredSleep);
    if (quartiles) {
      const best = quartiles.reduce((a, b) => a.avgPerf > b.avgPerf ? a : b);
      const worst = quartiles.reduce((a, b) => a.avgPerf < b.avgPerf ? a : b);
      const qText = quartiles.map(q => `${q.label} (${q.hourRange}): ${q.avgPerf}% · ${q.avgHours}h (n=${q.count})`).join(' · ');
      bedtimeQEl.innerHTML = `<div class="badge green" style="max-width:100%;"><strong>Optimal Bedtime: ${best.hourRange} → ${best.avgPerf}% avg sleep</strong>${qText}. Your best sleep happens in the "${best.label}" window; "${worst.label}" (${worst.hourRange}) averages only ${worst.avgPerf}%.</div>`;
    } else {
      bedtimeQEl.innerHTML = '';
    }
  }
}

// =====================================================================
// WEIGHT CHART (enhanced: rolling avg + drink/lift markers + goal annotation)
// =====================================================================
const weightPoints = [];
['Jan','Feb','March'].forEach(m => {
  data[m].filter(d=>d.weight).forEach(d => weightPoints.push({ x: d.date.slice(5)+' ('+m.slice(0,3)+')', y: d.weight, date: d.date }));
});
const weightVals = weightPoints.map(p => p.y);
const weightRolling = rollingAvg(weightVals, 7);
const weightDates = weightPoints.map(p => p.date);

allCharts.weightChart = new Chart(document.getElementById('weightChart'), {
  type: 'line',
  data: {
    labels: weightPoints.map(p=>p.x),
    datasets: [
      {
        label: 'Weight',
        data: weightVals,
        borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.08)',
        pointRadius: weightPoints.map(p => {
          const isDrink = drinkDates.has(p.date);
          const isLift = liftDates.has(p.date);
          return isDrink || isLift ? 7 : 5;
        }),
        pointStyle: weightPoints.map(p => drinkDates.has(p.date) ? 'triangle' : liftDates.has(p.date) ? 'rectRot' : 'circle'),
        pointBackgroundColor: weightPoints.map(p => {
          if (drinkDates.has(p.date)) return EVENT_COLORS.drink;
          if (liftDates.has(p.date)) return EVENT_COLORS.lift;
          return '#34d399';
        }),
        tension: 0.3, fill: true
      },
      {
        label: '7-day Avg',
        data: weightRolling,
        borderColor: 'rgba(251,191,36,0.6)', borderDash: [6,3],
        pointRadius: 0, tension: 0.4, fill: false, borderWidth: 2
      }
    ]
  },
  options: {
    ...chartDefaults(),
    onClick: (evt, elements) => {
      if (!elements.length) return;
      const el = elements[0];
      if (el.datasetIndex === 0) openPanel(weightDates[el.index]);
    },
    plugins: {
      ...chartDefaults().plugins,
      legend: { display: true, labels: { generateLabels: () => [
        { text: '● Weight', fillStyle:'#34d399', strokeStyle:'transparent', fontColor:'#94a3b8' },
        { text: '— 7-day avg', fillStyle:'rgba(251,191,36,0.6)', strokeStyle:'transparent', fontColor:'#94a3b8' },
        { text: '▲ Drink day', fillStyle:EVENT_COLORS.drink, strokeStyle:'transparent', fontColor:'#94a3b8' },
        { text: '■ Lift day', fillStyle:EVENT_COLORS.lift, strokeStyle:'transparent', fontColor:'#94a3b8' },
      ], color:'#94a3b8', font:{size:11}, boxWidth:10, padding:14 } },
      tooltip: { ...chartDefaults().plugins.tooltip, callbacks: { label: ctx => ctx.datasetIndex===0 ? ` ${ctx.parsed.y} ${weightUnit()}` : ` 7d avg: ${ctx.parsed.y.toFixed(1)} ${weightUnit()}` } }
    },
    scales: { x: { ...chartDefaults().scales.x, ticks: { ...TICK(), maxTicksLimit: 20 } }, y: { ...chartDefaults().scales.y, ticks: { ...TICK(), stepSize: useMetric ? 1 : 2, callback: v => v+' '+weightUnit() } } }
  }
});

// =====================================================================
// BODY COMPOSITION
// =====================================================================
const bodyComp = bodyCompEstimate();

allCharts.bodyCompChart = new Chart(document.getElementById('bodyCompChart'), {
  type: 'line',
  data: {
    labels: bodyComp.map(d => d.date.slice(5)),
    datasets: [
      {
        label: 'Estimated Fat Range Upper',
        data: bodyComp.map(d => d.measured ? null : +d.fatHigh.toFixed(1)),
        borderColor: 'rgba(248,113,113,0)',
        backgroundColor: 'rgba(248,113,113,0.08)',
        pointRadius: 0,
        pointHoverRadius: 0,
        pointHitRadius: 0,
        borderWidth: 0,
        fill: false,
        yAxisID: 'y'
      },
      {
        label: 'Estimated Fat Range Lower',
        data: bodyComp.map(d => d.measured ? null : +d.fatLow.toFixed(1)),
        borderColor: 'rgba(248,113,113,0)',
        backgroundColor: 'rgba(248,113,113,0.08)',
        pointRadius: 0,
        pointHoverRadius: 0,
        pointHitRadius: 0,
        borderWidth: 0,
        fill: '-1',
        yAxisID: 'y'
      },
      {
        label: 'Est. Fat Mass',
        data: bodyComp.map(d => +d.fat.toFixed(1)),
        borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.15)',
        pointRadius: bodyComp.map(d => d.measured ? 0 : 4), pointHoverRadius: 7, tension: 0.3, fill: true, borderWidth: 2.5,
        yAxisID: 'y'
      },
      {
        label: 'Est. Lean Mass',
        data: bodyComp.map(d => +d.lean.toFixed(1)),
        borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)',
        pointRadius: bodyComp.map(d => d.measured ? 0 : 3), tension: 0.3, fill: true, borderWidth: 2,
        yAxisID: 'y2'
      },
      {
        label: 'Measured DXA Fat',
        data: bodyComp.map(d => d.measured ? +d.fat.toFixed(1) : null),
        borderColor: '#f87171', backgroundColor: '#fff7ed', pointBackgroundColor: '#fff7ed',
        pointBorderColor: '#f87171', pointBorderWidth: 2, pointRadius: 7, pointHoverRadius: 8, showLine: false,
        yAxisID: 'y'
      },
      {
        label: 'Measured DXA Lean',
        data: bodyComp.map(d => d.measured ? +d.lean.toFixed(1) : null),
        borderColor: '#f59e0b', backgroundColor: '#fef3c7', pointBackgroundColor: '#fef3c7',
        pointBorderColor: '#f59e0b', pointBorderWidth: 2, pointRadius: 7, pointHoverRadius: 8, showLine: false,
        yAxisID: 'y2'
      },
    ]
  },
  options: {
    ...chartDefaults(),
    interaction: { mode: 'index', intersect: false, axis: 'x' },
    plugins: { ...chartDefaults().plugins,
      legend: {
        display: true,
        labels: {
          color:'#94a3b8',
          font:{size:11},
          boxWidth:10,
          padding:14,
          filter: item => !['Estimated Fat Range Upper', 'Estimated Fat Range Lower'].includes(item.text)
        }
      },
      tooltip: { ...chartDefaults().plugins.tooltip, filter: ctx => ![0, 1].includes(ctx.datasetIndex), callbacks: {
        title: ctx => bodyComp[ctx[0].dataIndex].date,
        label: ctx => {
          const d = bodyComp[ctx.dataIndex];
          if (ctx.datasetIndex === 2) return ` Est. fat: ${weightLabel(d.fat)} (~${d.bodyFatPct.toFixed(1)}% BF)`;
          if (ctx.datasetIndex === 3) return ` Est. lean: ${weightLabel(d.lean)}`;
          if (ctx.datasetIndex === 4) return ` Measured fat: ${weightLabel(d.fat)} (~${d.bodyFatPct.toFixed(1)}% BF)`;
          return ` Measured lean: ${weightLabel(d.lean)}`;
        },
        afterBody: ctx => {
          const d = bodyComp[ctx[0].dataIndex];
          return d ? [
            d.measured ? `  DXA measured point on Jan 6, 2026` : `  Estimated from the DXA baseline on Jan 6, 2026`,
            d.measured ? '' : `  Likely body-fat range: ${d.bodyFatPctLow.toFixed(1)}%–${d.bodyFatPctHigh.toFixed(1)}%`,
            d.measured ? `  Total: ${weightLabel(d.weight)}` : `  Model assumes ~${Math.round((d.fatFreeShare || 0) * 100)}% of weight change comes from fat-free mass`,
            d.measured ? '' : `  Total: ${weightLabel(d.weight)}`
          ].filter(Boolean) : [];
        }
      }}
    },
    scales: {
      x: { ...chartDefaults().scales.x, ticks:{...TICK(),maxTicksLimit:16} },
      y: {
        ...chartDefaults().scales.y, position: 'left',
        title: { display:true, text:`Fat Mass (${weightUnit()})`, color:'#f87171', font:{size:10} },
        ticks: { ...TICK(), callback: v => v + ' ' + weightUnit() }
      },
      y2: {
        ...chartDefaults().scales.y, position: 'right',
        title: { display:true, text:`Lean Mass (${weightUnit()})`, color:'#f59e0b', font:{size:10} },
        ticks: { ...TICK(), callback: v => v + ' ' + weightUnit() },
        grid: { drawOnChartArea: false }
      }
    }
  }
});

// =====================================================================
// CALORIES CHART (enhanced: goal line + rolling avg)
// =====================================================================
const monthOrder = ['Jan','Feb','March'];
let calVisibility = Array.isArray(persistedState.calVisibility) && persistedState.calVisibility.length === 3 ? persistedState.calVisibility : [true, true, true];

function makeCalDatasets() {
  const ds = [
    { label:'Jan', data: data.Jan.map(d=>d.calories), borderColor: COLORS.jan, backgroundColor:'rgba(245,158,11,0.1)', tension:0.3, pointRadius:4, pointHoverRadius:7, fill:false },
    { label:'Feb', data: data.Feb.map(d=>d.calories), borderColor: COLORS.feb, backgroundColor:'rgba(56,189,248,0.1)', tension:0.3, pointRadius:4, pointHoverRadius:7, fill:false },
    { label:'March', data: data.March.map(d=>d.calories), borderColor: COLORS.mar, backgroundColor:'rgba(52,211,153,0.1)', tension:0.3, pointRadius:4, pointHoverRadius:7, fill:false },
  ];
  // Goal line (only for longest month)
  const maxLen = Math.max(data.Jan.length, data.Feb.length, data.March.length);
  ds.push({
    label: `Target (${goals.calories})`,
    data: Array(maxLen).fill(goals.calories),
    borderColor: 'rgba(251,191,36,0.5)', borderDash: [8,4], pointRadius: 0, fill: false, borderWidth: 2
  });
  return ds;
}

const maxLabels = Math.max(data.Jan.length, data.Feb.length, data.March.length);
allCharts.caloriesChart = new Chart(document.getElementById('caloriesChart'), {
  type: 'line',
  data: { labels: Array.from({length:maxLabels},(_,i)=>i+1), datasets: makeCalDatasets() },
  options: {
    ...chartDefaults(),
    onClick: (evt, elements) => { if (elements.length && elements[0].datasetIndex < 3) { const el = elements[0]; const mo = monthOrder[el.datasetIndex]; if (data[mo][el.index]) openPanel(data[mo][el.index].date); } },
    plugins: { ...chartDefaults().plugins, legend: { display: true, labels: { color:'#94a3b8', font:{size:11}, boxWidth:10, padding:14 } }, tooltip: { ...chartDefaults().plugins.tooltip, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${energyLabel(ctx.parsed.y)}` } } },
    scales: { x: { ...chartDefaults().scales.x, title:{display:true,text:'Day of Month',color:'#64748b',font:{size:11}}, ticks:{...TICK()} }, y: { ...chartDefaults().scales.y, min: 1000, max: 3600, ticks: { ...TICK(), stepSize: 250, callback: v => v.toLocaleString()+' kcal' } } }
  }
});

// =====================================================================
// WATERFALL DEFICIT (uses estimated TDEE based on actual weight loss)
// =====================================================================
// Estimate TDEE from recency-weighted effective intake plus the smoothed weight trend.
const DIET_BREAK_START = '2026-02-27';
const DIET_BREAK_END = '2026-03-07';
function isInDietBreak(date) { return date >= DIET_BREAK_START && date <= DIET_BREAK_END; }
const cuttingDays = allDays.filter(d => !isInDietBreak(d.date));
const breakDays = allDays.filter(d => isInDietBreak(d.date));
const overallTDEEProfile = estimateTDEEProfile(allDays);
const cuttingTDEEProfile = estimateTDEEProfile(cuttingDays);
const estimatedTDEE = overallTDEEProfile.maintenance;
const cuttingTDEE = cuttingTDEEProfile.maintenance;
const breakAvgIntake = breakDays.length ? Math.round(breakDays.reduce((s,d) => s + effectiveCalories(d), 0) / breakDays.length) : null;
const tdeeRange = {
  low: Math.min(overallTDEEProfile.rangeLow, cuttingTDEEProfile.rangeLow),
  high: Math.max(overallTDEEProfile.rangeHigh, cuttingTDEEProfile.rangeHigh)
};

let cumDeficit = 0;
const waterfallData = allDays.map(d => {
  const totalCalories = effectiveCalories(d);
  cumDeficit += (estimatedTDEE - totalCalories);  // positive = deficit (ate less than TDEE)
  return { date: d.date, cum: cumDeficit, totalCalories };
});

// Daily surplus/deficit per day (not cumulative)
const dailyDelta = allDays.map(d => estimatedTDEE - effectiveCalories(d));

allCharts.waterfallChart = new Chart(document.getElementById('waterfallChart'), {
  type: 'bar',
  data: {
    labels: waterfallData.map(d => d.date.slice(5)),
    datasets: [
      {
        label: 'Cumulative Deficit',
        data: waterfallData.map(d => d.cum),
        backgroundColor: waterfallData.map(d => d.cum >= 0 ? 'rgba(52,211,153,0.7)' : 'rgba(248,113,113,0.7)'),
        borderRadius: 2, borderSkipped: false,
        yAxisID: 'y'
      },
      {
        label: 'Daily Deficit/Surplus',
        type: 'line',
        data: dailyDelta,
        borderColor: dailyDelta.map(v => v >= 0 ? 'rgba(52,211,153,0.9)' : 'rgba(248,113,113,0.9)'),
        segment: { borderColor: ctx => { const v = ctx.p0.parsed.y; return v >= 0 ? 'rgba(52,211,153,0.9)' : 'rgba(248,113,113,0.9)'; } },
        backgroundColor: 'transparent',
        pointRadius: dailyDelta.map(v => Math.abs(v) > 800 ? 5 : 3),
        pointBackgroundColor: dailyDelta.map(v => v >= 0 ? '#34d399' : '#f87171'),
        tension: 0.2, fill: false, borderWidth: 2,
        yAxisID: 'y2'
      }
    ]
  },
  options: {
    ...chartDefaults(),
    onClick: (evt, elements) => { if (elements.length) openPanel(waterfallData[elements[0].index].date); },
    plugins: { ...chartDefaults().plugins,
      legend: { display: true, labels: { color:'#94a3b8', font:{size:11}, boxWidth:10, padding:14 } },
      tooltip: { ...chartDefaults().plugins.tooltip, callbacks: {
        title: ctx => waterfallData[ctx[0].dataIndex].date,
        label: ctx => {
          if (ctx.datasetIndex === 0) {
            const cum = ctx.parsed.y;
            const lbsEquiv = (cum / 3500).toFixed(1);
            const fatEquiv = weightValue(Math.abs(cum / 3500));
            return [` Cumulative: ${cum > 0 ? '+' : ''}${energyLabel(cum)}`, ` ≈ ${fatEquiv} ${weightUnit()} fat loss`];
          } else {
            const v = ctx.parsed.y;
            const day = waterfallData[ctx.dataIndex];
            return [` Today: ${v > 0 ? '+' : ''}${energyLabel(v)} ${v >= 0 ? 'deficit' : 'surplus'}`, ` Ate ~${energyLabel(day.totalCalories)} incl. est. drinks vs ~${energyLabel(estimatedTDEE)} TDEE`];
          }
        }
      }}
    },
    scales: {
      x: { ...chartDefaults().scales.x, ticks:{...TICK(),maxTicksLimit:20} },
      y: { ...chartDefaults().scales.y, position:'left', title:{display:true,text:`Cumulative (${energyUnit()})`,color:'#64748b',font:{size:10}}, ticks:{...TICK(),callback:v=>v.toLocaleString()} },
      y2: { ...chartDefaults().scales.y, position:'right', title:{display:true,text:`Daily (${energyUnit()})`,color:'#64748b',font:{size:10}}, ticks:{...TICK(),callback:v=>(v>0?'+':'')+v}, grid:{drawOnChartArea:false} }
    }
  }
});

// =====================================================================
// COMBINED MACRO CHART (enhanced)
// =====================================================================
let currentMetric = persistedState.currentMetric || 'protein';
let macroVisibility = Array.isArray(persistedState.macroVisibility) && persistedState.macroVisibility.length === 3 ? persistedState.macroVisibility : [true, true, true];
const metricBounds = { protein:{min:80,max:250,step:20}, carbs:{min:40,max:310,step:30}, fat:{min:10,max:160,step:15} };

const macroDatasets = () => {
  const ds = [
    { label:'Jan', data: data.Jan.map(d=>d[currentMetric]), borderColor:COLORS.jan, tension:0.3, pointRadius:4, pointHoverRadius:7, fill:false, borderWidth:2 },
    { label:'Feb', data: data.Feb.map(d=>d[currentMetric]), borderColor:COLORS.feb, tension:0.3, pointRadius:4, pointHoverRadius:7, fill:false, borderWidth:2 },
    { label:'March', data: data.March.map(d=>d[currentMetric]), borderColor:COLORS.mar, tension:0.3, pointRadius:4, pointHoverRadius:7, fill:false, borderWidth:2 }
  ];
  // Goal line
  const goalVal = goals[currentMetric];
  if (goalVal) {
    const maxLen = Math.max(data.Jan.length, data.Feb.length, data.March.length);
    ds.push({ label:`Goal (${goalVal}g)`, data:Array(maxLen).fill(goalVal), borderColor:'rgba(251,191,36,0.5)', borderDash:[8,4], pointRadius:0, fill:false, borderWidth:2 });
  }
  return ds;
};

allCharts.macroChart = new Chart(document.getElementById('macroChart'), {
  type: 'line',
  data: { labels: Array.from({length:maxLabels},(_,i)=>i+1), datasets: macroDatasets() },
  options: {
    ...chartDefaults(),
    onClick: (evt, elements) => { if (elements.length && elements[0].datasetIndex < 3) { const el = elements[0]; const mo = monthOrder[el.datasetIndex]; if(data[mo][el.index]) openPanel(data[mo][el.index].date); } },
    plugins: { ...chartDefaults().plugins, legend: { display: true, labels: { color:'#94a3b8', font:{size:11}, boxWidth:10, padding:16 } }, tooltip: { ...chartDefaults().plugins.tooltip, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}g` } } },
    scales: { x: { ...chartDefaults().scales.x, ticks:{...TICK(),maxTicksLimit:10} }, y: { ...chartDefaults().scales.y, min: metricBounds.protein.min, max: metricBounds.protein.max, ticks:{...TICK(), stepSize: metricBounds.protein.step, callback:v=>v+'g'} } }
  }
});

// Metric tab switching
document.querySelectorAll('.mtab[data-metric]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mtab[data-metric]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMetric = btn.dataset.metric;
    const labels = { protein:'Daily Protein (g)', carbs:'Daily Carbs (g)', fat:'Daily Fat (g)' };
    document.getElementById('macroChartTitle').textContent = labels[currentMetric];
    const bounds = metricBounds[currentMetric];
    allCharts.macroChart.options.scales.y.min = bounds.min;
    allCharts.macroChart.options.scales.y.max = bounds.max;
    allCharts.macroChart.options.scales.y.ticks.stepSize = bounds.step;
    refreshDashboard();
    persistUiState();
  });
});

// Month toggle buttons
document.querySelectorAll('.mtoggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const chartName = btn.dataset.chart;
    const idx = parseInt(btn.dataset.idx);
    const visArr = chartName === 'calories' ? calVisibility : macroVisibility;
    visArr[idx] = !visArr[idx];
    btn.classList.toggle('off', !visArr[idx]);
    refreshDashboard();
    persistUiState();
  });
});

// =====================================================================
// MACRO COMPOSITION
// =====================================================================
function macroSplitForDay(day) {
  const proteinKcal = day.protein * 4;
  const carbsKcal = day.carbs * 4;
  const fatKcal = day.fat * 9;
  const totalKcal = proteinKcal + carbsKcal + fatKcal;
  if (!totalKcal) {
    return { proteinPct: 0, carbsPct: 0, fatPct: 0, proteinKcal, carbsKcal, fatKcal, totalKcal };
  }
  return {
    proteinPct: +(proteinKcal / totalKcal * 100).toFixed(1),
    carbsPct: +(carbsKcal / totalKcal * 100).toFixed(1),
    fatPct: +(fatKcal / totalKcal * 100).toFixed(1),
    proteinKcal,
    carbsKcal,
    fatKcal,
    totalKcal
  };
}

const macroSplitDays = allDays.map(macroSplitForDay);
allCharts.macroStackedChart = new Chart(document.getElementById('macroStackedChart'), {
  type: 'line',
  data: {
    labels: allDays.map(d => d.date.slice(5)),
    datasets: [
      { label:'Protein (%)', data: macroSplitDays.map(d => d.proteinPct), backgroundColor:'rgba(99,102,241,0.08)', borderColor:'#6366f1', fill:false, tension:0.3, pointRadius:0, borderWidth:3 },
      { label:'Carbs (%)', data: macroSplitDays.map(d => d.carbsPct), backgroundColor:'rgba(56,189,248,0.08)', borderColor:'#38bdf8', fill:false, tension:0.3, pointRadius:0, borderWidth:3 },
      { label:'Fat (%)', data: macroSplitDays.map(d => d.fatPct), backgroundColor:'rgba(249,115,22,0.08)', borderColor:'#f97316', fill:false, tension:0.3, pointRadius:0, borderWidth:3 },
    ]
  },
  options: {
    ...chartDefaults(),
    plugins: {
      ...chartDefaults().plugins,
      legend: { display:true, labels:{color:'#94a3b8',font:{size:11},boxWidth:10,padding:14} },
      tooltip: {
        mode:'index',
        ...chartDefaults().plugins.tooltip,
        callbacks:{
          title: ctx => allDays[ctx[0].dataIndex]?.date || '',
          label: ctx => {
            const split = macroSplitDays[ctx.dataIndex];
            if (!split) return '';
            if (ctx.datasetIndex === 0) return ` Protein: ${split.proteinPct}% (${energyLabel(split.proteinKcal)})`;
            if (ctx.datasetIndex === 1) return ` Carbs: ${split.carbsPct}% (${energyLabel(split.carbsKcal)})`;
            return ` Fat: ${split.fatPct}% (${energyLabel(split.fatKcal)})`;
          },
          afterBody: ctx => {
            const split = macroSplitDays[ctx[0].dataIndex];
            return split ? [` Total from macros: ${energyLabel(split.totalKcal)}`] : [];
          }
        }
      }
    },
    scales: {
      x: { ...chartDefaults().scales.x, ticks:{...TICK(),maxTicksLimit:20} },
      y: { ...chartDefaults().scales.y, min:0, max:100, ticks:{...TICK(),stepSize:10,callback:v=>v+'%'} }
    }
  }
});

// =====================================================================
// DONUT CHARTS
// =====================================================================
function donutChart(id, month) {
  const d = data[month];
  const p = avg(d,'protein'), c = avg(d,'carbs'), f = avg(d,'fat');
  const pCal = p*4, cCal = c*4, fCal = f*9, total = pCal+cCal+fCal;
  new Chart(document.getElementById(id), {
    type: 'doughnut',
    data: {
      labels: [`Protein (${(pCal/total*100).toFixed(0)}%)`, `Carbs (${(cCal/total*100).toFixed(0)}%)`, `Fat (${(fCal/total*100).toFixed(0)}%)`],
      datasets: [{ data: [pCal,cCal,fCal], backgroundColor: ['#6366f1','#38bdf8','#f97316'], borderWidth:0, hoverOffset:8 }]
    },
    options: { responsive:true, animation:{duration:400}, plugins: { legend: { display:true, position:'bottom', labels:{color:'#94a3b8',font:{size:11},padding:10} }, tooltip: { backgroundColor:'#1e2535', titleColor:'#e2e8f0', bodyColor:'#94a3b8', callbacks: { label: ctx => ` ${ctx.label}: ${energyLabel(ctx.parsed)}` } } }, cutout:'65%' }
  });
}
donutChart('donutJan','Jan');
donutChart('donutFeb','Feb');
donutChart('donutMar','March');

// =====================================================================
// LIFTING & DRINKS CHARTS
// =====================================================================
const liftingCounts = { Jan: data.Jan.filter(d=>d.lifting==='Y').length, Feb: data.Feb.filter(d=>d.lifting==='Y').length, March: data.March.filter(d=>d.lifting==='Y').length };
new Chart(document.getElementById('liftingChart'), {
  type: 'bar',
  data: { labels: ['January','February','March (so far)'], datasets: [{ data: [liftingCounts.Jan, liftingCounts.Feb, liftingCounts.March], backgroundColor: [COLORS.jan, COLORS.feb, COLORS.mar], borderRadius:6, borderSkipped:false }] },
  options: { ...chartDefaults(), plugins: { ...chartDefaults().plugins, tooltip: { ...chartDefaults().plugins.tooltip, callbacks: { label: ctx => ` ${ctx.parsed.y} lifting sessions` } } }, scales: { x: { ...chartDefaults().scales.x }, y: { ...chartDefaults().scales.y, beginAtZero:true, ticks:{...TICK(),stepSize:2} } } }
});

const drinksCounts = { Jan: data.Jan.filter(d=>d.drinks).length, Feb: data.Feb.filter(d=>d.drinks).length, March: data.March.filter(d=>d.drinks).length };
new Chart(document.getElementById('drinksChart'), {
  type: 'bar',
  data: { labels: ['January','February','March (so far)'], datasets: [{ data: [drinksCounts.Jan, drinksCounts.Feb, drinksCounts.March], backgroundColor: ['rgba(245,158,11,0.6)','rgba(56,189,248,0.6)','rgba(52,211,153,0.6)'], borderRadius:6, borderSkipped:false }] },
  options: { ...chartDefaults(), plugins: { ...chartDefaults().plugins, tooltip: { ...chartDefaults().plugins.tooltip, callbacks: { label: ctx => ` ${ctx.parsed.y} drink days` } } }, scales: { x: { ...chartDefaults().scales.x }, y: { ...chartDefaults().scales.y, beginAtZero:true, ticks:{...TICK(),stepSize:1} } } }
});

// LIFT VS REST DAY comparison — percent delta vs rest day
const liftDayMacros = allDays.filter(d => d.lifting === 'Y');
const restDayMacros = allDays.filter(d => d.lifting !== 'Y');

function liftRestDeltaRows(days) {
  const lift = days.filter(d => d.lifting === 'Y');
  const rest = days.filter(d => d.lifting !== 'Y');
  const metrics = [
    { key: 'calories', label: 'Calories', unit: energyUnit(), valueFn: v => energyValue(v) },
    { key: 'protein', label: 'Protein', unit: 'g', valueFn: v => +(v ?? 0).toFixed(0) },
    { key: 'carbs', label: 'Carbs', unit: 'g', valueFn: v => +(v ?? 0).toFixed(0) },
    { key: 'fat', label: 'Fat', unit: 'g', valueFn: v => +(v ?? 0).toFixed(0) }
  ];
  return metrics.map(metric => {
    const liftAvgRaw = avg(lift, metric.key);
    const restAvgRaw = avg(rest, metric.key);
    const deltaRaw = liftAvgRaw - restAvgRaw;
    const pctDelta = restAvgRaw ? (deltaRaw / restAvgRaw) * 100 : 0;
    return {
      label: metric.label,
      unit: metric.unit,
      liftAvgRaw,
      restAvgRaw,
      liftValue: metric.valueFn(liftAvgRaw),
      restValue: metric.valueFn(restAvgRaw),
      deltaRaw: metric.valueFn(deltaRaw),
      pctDelta: +pctDelta.toFixed(1)
    };
  });
}

function liftRestDisplayDelta(pctDelta) {
  if (!Number.isFinite(pctDelta)) return 0;
  if (pctDelta === 0) return 0.35;
  if (Math.abs(pctDelta) < 0.35) return Math.sign(pctDelta) * 0.35;
  return pctDelta;
}

allCharts.liftRestChart = new Chart(document.getElementById('liftRestChart'), {
  type: 'bar',
  data: {
    labels: liftRestDeltaRows(allDays).map(r => r.label),
    datasets: [
      {
        label: `Lift vs Rest Delta`,
        data: liftRestDeltaRows(allDays).map(r => liftRestDisplayDelta(r.pctDelta)),
        backgroundColor: liftRestDeltaRows(allDays).map(r => r.pctDelta > 0 ? 'rgba(245,158,11,0.75)' : r.pctDelta < 0 ? 'rgba(248,113,113,0.75)' : 'rgba(148,163,184,0.7)'),
        borderRadius: 6,
        borderSkipped: false
      }
    ]
  },
  options: {
    ...chartDefaults(),
    indexAxis: 'y',
    plugins: {
      ...chartDefaults().plugins,
      legend: { display: false },
      tooltip: { ...chartDefaults().plugins.tooltip, callbacks: {
        label: ctx => {
          const row = liftRestDeltaRows(allDays)[ctx.dataIndex];
          return ` Lift vs rest: ${row.pctDelta > 0 ? '+' : ''}${row.pctDelta}%`;
        },
        afterBody: ctx => {
          const row = liftRestDeltaRows(allDays)[ctx[0].dataIndex];
          return [
            ` Lift days: ${row.liftValue.toLocaleString()} ${row.unit}`,
            ` Rest days: ${row.restValue.toLocaleString()} ${row.unit}`,
            ` Raw delta: ${row.deltaRaw > 0 ? '+' : ''}${row.deltaRaw.toLocaleString()} ${row.unit}`
          ];
        }
      }}
    },
    scales: {
      x: {
        ...chartDefaults().scales.x,
        ticks: { ...TICK(), callback: v => `${v}%` },
        suggestedMin: -20,
        suggestedMax: 20
      },
      y: { ...chartDefaults().scales.y, ticks: { ...TICK(), autoSkip: false } }
    }
  }
});

// =====================================================================
// ROLLING ADHERENCE CHART
// =====================================================================
const initAdherence = rollingAdherence(allDays);
allCharts.adherenceChart = new Chart(document.getElementById('adherenceChart'), {
  type: 'line',
  data: {
    labels: initAdherence ? initAdherence.labels : [],
    datasets: [
      {
        label: 'Calorie goal hit %',
        data: initAdherence ? initAdherence.calHit : [],
        borderColor: 'rgba(251,191,36,0.9)',
        backgroundColor: 'rgba(251,191,36,0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2
      },
      {
        label: 'Protein floor hit %',
        data: initAdherence ? initAdherence.proHit : [],
        borderColor: 'rgba(52,211,153,0.9)',
        backgroundColor: 'rgba(52,211,153,0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2
      }
    ]
  },
  options: {
    ...chartDefaults(),
    scales: {
      x: { ...chartDefaults().scales.x, ticks: { ...TICK(), maxTicksLimit: 12 } },
      y: { ...chartDefaults().scales.y, min: 0, max: 100, ticks: { ...TICK(), callback: v => v + '%' } }
    },
    plugins: {
      ...chartDefaults().plugins,
      legend: { display: true, labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 10, padding: 14 } },
      tooltip: {
        ...chartDefaults().plugins.tooltip,
        callbacks: {
          label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}%`
        }
      }
    }
  }
});

// =====================================================================
// FOOD FREQUENCY CHART
// =====================================================================
const foodFreqs = foodFrequency().slice(0, 20);
allCharts.foodFreqChart = new Chart(document.getElementById('foodFreqChart'), {
  type: 'bar',
  data: {
    labels: foodFreqs.map(f => f[0].length > 30 ? f[0].slice(0,28)+'…' : f[0]),
    datasets: [{
      data: foodFreqs.map(f => f[1]),
      backgroundColor: foodFreqs.map(f => isFoodProteinRich(f[0]) ? 'rgba(245,158,11,0.7)' : 'rgba(100,116,139,0.5)'),
      borderRadius: 4, borderSkipped: false
    }]
  },
  options: {
    ...chartDefaults(),
    indexAxis: 'y',
    plugins: { ...chartDefaults().plugins, legend: { display:true, labels:{ generateLabels: () => [
      { text:'Protein-rich', fillStyle:'rgba(245,158,11,0.7)', strokeStyle:'transparent', fontColor:'#94a3b8' },
      { text:'Other', fillStyle:'rgba(100,116,139,0.5)', strokeStyle:'transparent', fontColor:'#94a3b8' },
    ], color:'#94a3b8', font:{size:11}, boxWidth:10, padding:14 } }, tooltip: { ...chartDefaults().plugins.tooltip, callbacks: { label: ctx => ` ${ctx.parsed.x} times in ${allDays.length} days` } } },
    scales: {
      x: { ...chartDefaults().scales.x, beginAtZero:true, ticks:{...TICK()} },
      y: { ...chartDefaults().scales.y, ticks:{...TICK(), font:{size:10}, autoSkip:false} }
    }
  }
});

// =====================================================================
// RECOVERY SCORE CHART
// =====================================================================
const recoveryScores = sleepData.map(d => recoveryScore(d));
allCharts.recoveryChart = new Chart(document.getElementById('recoveryChart'), {
  type: 'line',
  data: {
    labels: sleepData.map(d => d.date.slice(5)),
    datasets: [
      {
        label:'Recovery Score',
        data: recoveryScores,
        borderColor: '#34d399',
        pointRadius: sleepData.map((d,i) => recoveryScores[i] < 30 || recoveryScores[i] > 75 ? 6 : 3),
        pointBackgroundColor: recoveryScores.map(s => perfColor(s)),
        tension: 0.3, fill: false
      },
      {
        label: '7-day Avg',
        data: rollingAvg(recoveryScores, 7),
        borderColor: 'rgba(251,191,36,0.6)', borderDash:[6,3], pointRadius:0, tension:0.4, fill:false, borderWidth:2
      }
    ]
  },
  options: {
    ...chartDefaults(),
    onClick: (evt, elements) => { if (elements.length) openPanel(sleepData[elements[0].index].date); },
    plugins: { ...chartDefaults().plugins, legend: { display:true, labels:{color:'#94a3b8',font:{size:11},boxWidth:10,padding:14} }, tooltip: { ...chartDefaults().plugins.tooltip, callbacks: {
      title: ctx => sleepData[ctx[0].dataIndex].date,
      label: ctx => {
        if (ctx.datasetIndex === 1) return ` 7d avg: ${ctx.parsed.y.toFixed(0)}`;
        const d = sleepData[ctx.dataIndex];
        const prev = prevDay(d.date);
        return [` Recovery: ${ctx.parsed.y}`, ` Sleep: ${d.perf}% perf, ${d.hours}h`, drinkDates.has(prev) ? ' 🍹 drank prev night' : ''];
      }
    }}},
    scales: { x:{...chartDefaults().scales.x,ticks:{...TICK(),maxTicksLimit:20}}, y:{...chartDefaults().scales.y,min:0,max:100,ticks:{...TICK(),stepSize:10}} }
  }
});

// =====================================================================
// SLEEP CHARTS
// =====================================================================
// Sleep Performance
allCharts.sleepPerfChart = new Chart(document.getElementById('sleepPerfChart'), {
  type: 'bar',
  data: {
    labels: sleepData.map(d => d.date.slice(5)),
    datasets: [{
      data: sleepData.map(d => d.perf),
      backgroundColor: sleepData.map(d => perfColor(d.perf, 0.8)),
      borderRadius: 3, borderSkipped: false
    }]
  },
  options: {
    ...chartDefaults(),
    onClick: (evt, elements) => { if (elements.length) openPanel(sleepData[elements[0].index].date); },
    plugins: { ...chartDefaults().plugins, tooltip: { ...chartDefaults().plugins.tooltip, callbacks: {
      title: ctx => sleepData[ctx[0].dataIndex].date,
      label: ctx => {
        const d = sleepData[ctx.dataIndex];
        const prev = prevDay(d.date);
        const drank = drinkDates.has(prev) ? ' 🍹 prev night' : '';
        return [` Performance: ${d.perf}%`, ` Sleep: ${d.hours}h  Bedtime: ${d.bedtime}${drank}`];
      }
    }}},
    scales: { x: { ...chartDefaults().scales.x, ticks:{...TICK(),maxTicksLimit:20} }, y: { ...chartDefaults().scales.y, min:0, max:100, ticks:{...TICK(),stepSize:10,callback:v=>v+'%'} } }
  }
});

// Sleep Duration
allCharts.sleepDurChart = new Chart(document.getElementById('sleepDurChart'), {
  type: 'line',
  data: {
    labels: sleepData.map(d => d.date.slice(5)),
    datasets: [{
      data: sleepData.map(d => d.hours),
      borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)',
      pointRadius: 3, pointHoverRadius: 6, tension: 0.3, fill: true,
      pointBackgroundColor: sleepData.map(d => perfColor(d.perf))
    }]
  },
  options: {
    ...chartDefaults(),
    onClick: (evt, elements) => { if (elements.length) openPanel(sleepData[elements[0].index].date); },
    plugins: { ...chartDefaults().plugins, tooltip: { ...chartDefaults().plugins.tooltip, callbacks: { label: ctx => ` ${ctx.parsed.y.toFixed(1)}h sleep — ${sleepData[ctx.dataIndex].perf}% performance` } } },
    scales: { x: { ...chartDefaults().scales.x, ticks:{...TICK(),maxTicksLimit:16} }, y: { ...chartDefaults().scales.y, min:1, max:11, ticks:{...TICK(),stepSize:1,callback:v=>v+'h'} } }
  }
});

// Sleep Stages
new Chart(document.getElementById('sleepStagesChart'), {
  type: 'bar',
  data: {
    labels: sleepData.map(d => d.date.slice(5)),
    datasets: [
      { label:'Deep', data: sleepData.map(d=>d.deep), backgroundColor:'rgba(245,158,11,0.85)', stack:'s' },
      { label:'REM',  data: sleepData.map(d=>d.rem),  backgroundColor:'rgba(56,189,248,0.85)',  stack:'s' },
      { label:'Light',data: sleepData.map(d=>d.light),backgroundColor:'rgba(100,116,139,0.5)', stack:'s' },
    ]
  },
  options: {
    ...chartDefaults(),
    plugins: { ...chartDefaults().plugins, legend: { display:true, labels:{color:'#94a3b8',font:{size:11},boxWidth:10,padding:12} }, tooltip: { ...chartDefaults().plugins.tooltip, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}h` } } },
    scales: { x: { ...chartDefaults().scales.x, ticks:{...TICK(),maxTicksLimit:16} }, y: { ...chartDefaults().scales.y, min:0, max:11, stacked:true, ticks:{...TICK(),stepSize:1,callback:v=>v+'h'} } }
  }
});

// Sleep Debt
const sDebt = sleepDebt();
allCharts.sleepDebtChart = new Chart(document.getElementById('sleepDebtChart'), {
  type: 'line',
  data: {
    labels: sDebt.map(d => d.date.slice(5)),
    datasets: [{
      data: sDebt.map(d => d.debt.toFixed(1)),
      borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.1)',
      pointRadius: 2, tension: 0.3, fill: true
    }]
  },
  options: {
    ...chartDefaults(),
    plugins: { ...chartDefaults().plugins, tooltip: { ...chartDefaults().plugins.tooltip, callbacks: { label: ctx => ` Cumulative debt: ${ctx.parsed.y}h (vs ${goals.sleep}h target)` } } },
    scales: { x:{...chartDefaults().scales.x,ticks:{...TICK(),maxTicksLimit:20}}, y:{...chartDefaults().scales.y,ticks:{...TICK(),callback:v=>v+'h'}} }
  }
});

// =====================================================================
// CROSS-INSIGHT CHARTS
// =====================================================================
// Drink vs Clean sleep
const afterDrink = [], afterClean = [];
sleepData.forEach(d => { const prev = prevDay(d.date); if (drinkDates.has(prev)) afterDrink.push(d.perf); else afterClean.push(d.perf); });
const avgAfterDrink = (afterDrink.reduce((a,b)=>a+b,0)/afterDrink.length).toFixed(1);
const avgAfterClean = (afterClean.reduce((a,b)=>a+b,0)/afterClean.length).toFixed(1);
new Chart(document.getElementById('drinkSleepChart'), {
  type: 'bar',
  data: { labels: [`After Drink (n=${afterDrink.length})`, `After Clean (n=${afterClean.length})`], datasets: [{ data:[avgAfterDrink,avgAfterClean], backgroundColor:['rgba(248,113,113,0.7)','rgba(52,211,153,0.7)'], borderRadius:8, borderSkipped:false }] },
  options: { ...chartDefaults(), plugins: { ...chartDefaults().plugins, tooltip: { ...chartDefaults().plugins.tooltip, callbacks: { label: ctx => ` ${ctx.parsed.y}% avg` } } }, scales: { x:{...chartDefaults().scales.x}, y:{...chartDefaults().scales.y,min:0,max:100,ticks:{...TICK(),stepSize:10,callback:v=>v+'%'}} } }
});

// Day of week
const dowAvg = [59.0, 70.6, 69.4, 47.5, 56.4, 41.6, 43.8];
new Chart(document.getElementById('dowChart'), {
  type: 'bar',
  data: { labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], datasets:[{data:dowAvg,backgroundColor:dowAvg.map(v=>perfColor(v,0.8)),borderRadius:6,borderSkipped:false}] },
  options: { ...chartDefaults(), plugins: { ...chartDefaults().plugins, tooltip: { ...chartDefaults().plugins.tooltip, callbacks: { label: ctx => ` ${ctx.parsed.y.toFixed(1)}%` } } }, scales: { x:{...chartDefaults().scales.x}, y:{...chartDefaults().scales.y,min:0,max:100,ticks:{...TICK(),stepSize:10,callback:v=>v+'%'}} } }
});

// Bedtime scatter
const bedtimeScatterPoints = sleepData.map(d => { let bt = d.bedtime_hour > 12 ? d.bedtime_hour-24 : d.bedtime_hour; return {x:bt,y:d.perf,date:d.date,bedtime:d.bedtime}; });
new Chart(document.getElementById('bedtimeSleepScatter'), {
  type: 'scatter',
  data: { datasets: [{ data:bedtimeScatterPoints.map(p=>({x:p.x,y:p.y})), backgroundColor:bedtimeScatterPoints.map(p=>perfColor(p.y,0.7)), pointRadius:6, pointHoverRadius:9 }] },
  options: {
    ...chartDefaults(),
    plugins: { ...chartDefaults().plugins, tooltip: { ...chartDefaults().plugins.tooltip, callbacks: { label: ctx => { const p = bedtimeScatterPoints[ctx.dataIndex]; return [` ${p.date}`,` Bedtime: ${p.bedtime}`,` Sleep: ${p.y}%`]; } } } },
    scales: { x:{...chartDefaults().scales.x,min:-3,max:8,title:{display:true,text:'Bedtime (hrs past midnight)',color:'#64748b',font:{size:11}},ticks:{...TICK(),callback:v=>v<0?`${Math.abs(v)}hr pre-12am`:`${v}am`}}, y:{...chartDefaults().scales.y,min:0,max:100,title:{display:true,text:'Sleep perf',color:'#64748b',font:{size:11}},ticks:{...TICK(),stepSize:10,callback:v=>v+'%'}} }
  }
});

// Bedtime bucket
new Chart(document.getElementById('bedtimeBucketChart'), {
  type: 'bar',
  data: { labels:['Before 2am\n(n=42)','2am–4am\n(n=22)','After 4am\n(n=13)'], datasets:[{data:[68.2,47.3,28.2],backgroundColor:['rgba(52,211,153,0.8)','rgba(251,191,36,0.8)','rgba(248,113,113,0.8)'],borderRadius:8,borderSkipped:false}] },
  options: { ...chartDefaults(), plugins: { ...chartDefaults().plugins, tooltip: { ...chartDefaults().plugins.tooltip, callbacks: { label: ctx => ` ${ctx.parsed.y}%` } } }, scales: { x:{...chartDefaults().scales.x}, y:{...chartDefaults().scales.y,min:0,max:100,ticks:{...TICK(),stepSize:10,callback:v=>v+'%'}} } }
});

// Resp rate
new Chart(document.getElementById('respRateChart'), {
  type: 'line',
  data: { labels:sleepData.map(d=>d.date.slice(5)), datasets:[{data:sleepData.map(d=>d.resp),borderColor:'#f97316',backgroundColor:'rgba(249,115,22,0.06)',pointRadius:3,pointHoverRadius:6,tension:0.3,fill:true,pointBackgroundColor:'#f97316'}] },
  options: { ...chartDefaults(), plugins:{...chartDefaults().plugins,tooltip:{...chartDefaults().plugins.tooltip,callbacks:{label:ctx=>` ${ctx.parsed.y} rpm`}}}, scales:{ x:{...chartDefaults().scales.x,ticks:{...TICK(),maxTicksLimit:16}}, y:{...chartDefaults().scales.y,min:13.5,max:19.5,ticks:{...TICK(),stepSize:0.5,callback:v=>v+' rpm'}} } }
});

// Cal vs Sleep scatter
const scatterPoints = sleepData.map(d => { const macro = macroByDate[d.date]; if (!macro) return null; return {x:macro.calories,y:d.perf,date:d.date}; }).filter(Boolean);
new Chart(document.getElementById('calSleepScatterChart'), {
  type: 'scatter',
  data: { datasets: [{ data:scatterPoints.map(p=>({x:p.x,y:p.y})), backgroundColor:scatterPoints.map(p=>perfColor(p.y,0.7)), pointRadius:6, pointHoverRadius:9 }] },
  options: {
    ...chartDefaults(),
    plugins: { ...chartDefaults().plugins, tooltip: { ...chartDefaults().plugins.tooltip, callbacks: { label: ctx => { const p=scatterPoints[ctx.dataIndex]; return [` ${p.date}`,` Cal: ${p.x}`,` Sleep: ${p.y}%`]; } } } },
    scales: { x:{...chartDefaults().scales.x,min:1000,max:3500,title:{display:true,text:'Calories',color:'#64748b',font:{size:11}},ticks:{...TICK(),callback:v=>v.toLocaleString()}}, y:{...chartDefaults().scales.y,min:0,max:100,title:{display:true,text:'Sleep perf',color:'#64748b',font:{size:11}},ticks:{...TICK(),stepSize:10,callback:v=>v+'%'}} }
  }
});

// Sleep annotated
new Chart(document.getElementById('sleepAnnotatedChart'), {
  type: 'line',
  data: {
    labels: sleepData.map(d => d.date.slice(5)),
    datasets: [{
      label:'Sleep Performance',
      data: sleepData.map(d => d.perf),
      borderColor:'#f59e0b', backgroundColor:'rgba(245,158,11,0.07)',
      pointRadius: sleepData.map(d => { const prev=prevDay(d.date); return drinkDates.has(prev)||liftDates.has(d.date)?7:3; }),
      pointStyle: sleepData.map(d => { const prev=prevDay(d.date); if(drinkDates.has(prev)) return 'triangle'; if(liftDates.has(d.date)) return 'rectRot'; return 'circle'; }),
      pointBackgroundColor: sleepData.map(d => { const prev=prevDay(d.date); if(drinkDates.has(prev))return EVENT_COLORS.drink; if(liftDates.has(d.date))return EVENT_COLORS.lift; return EVENT_COLORS.normal; }),
      pointBorderColor:'rgba(15,17,23,0.85)', pointBorderWidth: 1.5, tension:0.3, fill:true
    }]
  },
  options: {
    ...chartDefaults(),
    plugins: { ...chartDefaults().plugins,
      legend: { display:true, labels: { generateLabels: () => [
        {text:'● Normal day',fillStyle:EVENT_COLORS.normal,strokeStyle:'transparent',fontColor:'#94a3b8'},
        {text:'▲ After drinking',fillStyle:EVENT_COLORS.drink,strokeStyle:'transparent',fontColor:'#94a3b8'},
        {text:'■ Lifting day',fillStyle:EVENT_COLORS.lift,strokeStyle:'transparent',fontColor:'#94a3b8'},
      ], color:'#94a3b8', font:{size:11}, boxWidth:10, padding:14 } },
      tooltip: { ...chartDefaults().plugins.tooltip, callbacks: { title: ctx => sleepData[ctx[0].dataIndex].date, label: ctx => { const d=sleepData[ctx.dataIndex]; const prev=prevDay(d.date); const f=[]; if(drinkDates.has(prev))f.push('🍹 drank prev'); if(liftDates.has(d.date))f.push('🏋️ lifted'); return [` Perf: ${d.perf}%  Sleep: ${d.hours}h`, ...f]; } } }
    },
    scales: { x:{...chartDefaults().scales.x,ticks:{...TICK(),maxTicksLimit:20}}, y:{...chartDefaults().scales.y,min:0,max:100,ticks:{...TICK(),stepSize:10,callback:v=>v+'%'}} }
  }
});

// =====================================================================
// CORRELATION MATRIX
// =====================================================================
function renderCorrMatrix() {
  const canvas = document.getElementById('corrMatrix');
  const ctx = canvas.getContext('2d');
  const corrSleep = getFilteredSleep();
  // Build paired data
  const labels = ['Calories','Protein','Carbs','Fat','Sleep Perf','Sleep Hrs','Deep','REM','Efficiency','Resp Rate','Drink?','Lift?'];
  const paired = corrSleep.map(d => {
    const m = macroByDate[d.date];
    if (!m) return null;
    const prev = prevDay(d.date);
    return [m.calories, m.protein, m.carbs, m.fat, d.perf, d.hours, d.deep, d.rem, d.efficiency, d.resp, drinkDates.has(prev)?1:0, liftDates.has(d.date)?1:0];
  }).filter(Boolean);

  const n = labels.length;
  const corr = [];
  for (let i = 0; i < n; i++) {
    corr[i] = [];
    for (let j = 0; j < n; j++) {
      corr[i][j] = pearson(paired.map(p=>p[i]), paired.map(p=>p[j]));
    }
  }

  // Draw
  const size = 34;
  const pad = 90;
  canvas.width = pad + n * size + 60;
  canvas.height = pad + n * size + 20;

  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-card').trim();
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Labels
  ctx.font = '10px -apple-system, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-faint').trim();
  for (let i = 0; i < n; i++) {
    ctx.fillText(labels[i], pad - 4, pad + i * size + size/2 + 3);
  }
  ctx.save();
  for (let j = 0; j < n; j++) {
    ctx.save();
    ctx.translate(pad + j * size + size/2, pad - 4);
    ctx.rotate(-Math.PI/4);
    ctx.textAlign = 'left';
    ctx.fillText(labels[j], 0, 0);
    ctx.restore();
  }
  ctx.restore();

  // Cells
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = corr[i][j];
      const x = pad + j * size;
      const y = pad + i * size;
      // Color: blue negative, red positive
      const alpha = Math.abs(v) * 0.8;
      if (v >= 0) ctx.fillStyle = `rgba(52,211,153,${alpha})`;
      else ctx.fillStyle = `rgba(248,113,113,${alpha})`;
      ctx.fillRect(x+1, y+1, size-2, size-2);
      // Text
      if (Math.abs(v) > 0.15) {
        ctx.fillStyle = Math.abs(v) > 0.5 ? '#fff' : getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim();
        ctx.font = '9px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(v.toFixed(2), x + size/2, y + size/2 + 3);
      }
    }
  }

  // Color legend
  const ly = pad + n * size + 8;
  ctx.font = '9px -apple-system, sans-serif';
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-faint').trim();
  ctx.textAlign = 'left';
  ctx.fillText('−1.0', pad, ly);
  ctx.fillText('+1.0', pad + 120, ly);
  for (let k = 0; k < 20; k++) {
    const v = -1 + k * 0.1;
    const alpha = Math.abs(v) * 0.8;
    ctx.fillStyle = v >= 0 ? `rgba(52,211,153,${alpha})` : `rgba(248,113,113,${alpha})`;
    ctx.fillRect(pad + 30 + k * 4, ly - 8, 4, 8);
  }
}

function renderExploreDiagnostics() {
  const rangeDays = getRangeDays();
  const rangeSleep = getSleepForDaysUnfiltered(rangeDays);
  const decomp = trendDecomposition(rangeDays);
  const plateau = plateauNoiseAssessment(rangeDays, rangeSleep);
  const lag = getLagMetrics(rangeDays, rangeSleep);
  const quality = qualityAudit(rangeDays, rangeSleep);
  const foodPatterns = foodPatternSummary(rangeDays);
  document.getElementById('exploreScopeNote').textContent = eventFilter === 'all'
    ? 'Explore diagnostics use the full selected date range.'
    : `Explore diagnostics use the full selected date range before the "${filterLabel()}" filter so the math stays stable.`;

  if (decomp) {
    const values = [decomp.scaleLoss, decomp.expectedLoss, decomp.fatLoss ?? 0, decomp.nonFatShift ?? 0];
    allCharts.trendDecompChart.data.datasets[0].data = values.map(v => +(v ?? 0).toFixed(2));
    allCharts.trendDecompChart.options.plugins.tooltip.callbacks.label = ctx => `${ctx.label}: ${formatSignedWeight(ctx.parsed.x || 0)}`;
    allCharts.trendDecompChart.options.scales.x.ticks.callback = v => `${v} ${weightUnit()}`;
    allCharts.trendDecompChart.update();

    const summary = [
      {
        cls: plateau.cls,
        title: plateau.title,
        text: plateau.text
      },
      {
        cls: 'good',
        title: 'Observed scale trend',
        text: `${decomp.scaleLoss >= 0 ? 'Down' : 'Up'} ${weightLabel(Math.abs(decomp.scaleLoss))} on the smoothed trend across ${decomp.weightSpan} weigh-ins over ${decomp.daySpan} days.`
      },
      {
        cls: Math.abs(decomp.modelGap ?? 0) <= 1 ? 'good' : 'warn',
        title: 'Logged deficit vs scale',
        text: decomp.expectedLoss != null
          ? `Maintenance-gap math implies ${weightLabel(Math.abs(decomp.expectedLoss))} of ${decomp.expectedLoss >= 0 ? 'loss' : 'gain'}. The smoothed trend is ${decomp.modelGap >= 0 ? 'ahead by' : 'behind by'} ${weightLabel(Math.abs(decomp.modelGap || 0))}.`
          : 'Need logged calories across the range to compare deficit math with the scale.'
      },
      {
        cls: 'warn',
        title: 'DXA-anchored composition split',
        text: decomp.fatLoss != null && decomp.leanLoss != null
          ? `About ${weightLabel(Math.abs(decomp.fatLoss))} of the move looks like fat change, with ${weightLabel(Math.abs(decomp.leanLoss))} as estimated lean-mass movement.`
          : 'Need at least two weigh-ins in the selected range for the DXA-anchored split.'
      },
      {
        cls: Math.abs(decomp.residual ?? 0) <= 0.8 ? 'good' : 'bad',
        title: 'Residual water / glycogen noise',
        text: decomp.residual != null
          ? `${formatSignedWeight(decomp.residual)} after backing out the modeled lean-mass change. Larger residuals usually mean water, glycogen, or logging noise is still dominating part of the scale move.`
          : 'Residual non-fat movement will appear once the body-comp model has enough weigh-ins.'
      },
      {
        cls: Math.abs(lag.drinkSleepGap ?? 0) >= 10 || Math.abs(lag.liftNextDayWeightGap ?? 0) >= 0.35 ? 'warn' : 'good',
        title: 'Lag signals still present',
        text: `Drink-following mornings are ${lag.drinkSleepGap != null ? lag.drinkSleepGap.toFixed(1) : '—'} pts worse, and the next-day scale move after lift days is ${lag.liftNextDayWeightGap != null ? formatSignedWeight(lag.liftNextDayWeightGap) : '—'} versus rest days.`
      }
    ];
    document.getElementById('trendDecompSummary').innerHTML = summary.map(item => `
      <div class="audit-item ${item.cls}">
        <strong>${item.title}</strong>
        <p>${item.text}</p>
      </div>
    `).join('');
  } else {
    allCharts.trendDecompChart.data.datasets[0].data = [0, 0, 0, 0];
    allCharts.trendDecompChart.update();
    document.getElementById('trendDecompSummary').innerHTML = `
      <div class="audit-item warn">
        <strong>Need more weigh-ins in range</strong>
        <p>Trend decomposition needs at least two weigh-ins inside the selected date range.</p>
      </div>
    `;
  }

  document.getElementById('qualityAuditGrid').innerHTML = [
    { title: 'Sleep Coverage', value: `${Math.round(quality.sleepCoverage)}%`, sub: `${rangeSleep.length}/${rangeDays.length} days have sleep entries` },
    { title: 'Weigh-In Coverage', value: `${Math.round(quality.weightCoverage)}%`, sub: `${rangeDays.length - quality.missingWeight}/${rangeDays.length} days have weight` },
    { title: 'Macro Agreement', value: `${Math.round(quality.macroAgreement)}%`, sub: `${quality.mismatchFlagged.length} days flagged at >8% mismatch` },
    { title: 'Food-Note Coverage', value: `${Math.round(quality.noteCoverage)}%`, sub: `${rangeDays.length - quality.noteMissing}/${rangeDays.length} days have usable food notes` }
  ].map(card => `
    <div class="score-card">
      <div class="value">${card.value}</div>
      <div class="sub"><strong style="display:block;color:var(--text-primary);margin-bottom:4px;font-size:12px;">${card.title}</strong>${card.sub}</div>
    </div>
  `).join('');

  const qualityItems = [];
  if (quality.longestGap) {
    qualityItems.push({
      cls: quality.longestGap.days > 6 ? 'bad' : quality.longestGap.days > 4 ? 'warn' : 'good',
      title: 'Longest weigh-in gap',
      text: `${quality.longestGap.days} days between ${formatShortDate(quality.longestGap.start)} and ${formatShortDate(quality.longestGap.end)}.`
    });
  }
  if (quality.mismatchFlagged[0]) {
    const top = quality.mismatchFlagged[0];
    qualityItems.push({
      cls: Math.abs(top.gapPct) > 15 ? 'bad' : 'warn',
      title: 'Largest macro/log mismatch',
      text: `${formatShortDate(top.date)} logged ${energyLabel(top.logged)} but macros imply ${energyLabel(top.macroCalories)} (${formatSignedPct(top.gapPct)}).`
    });
  }
  if (quality.missingSleepDates.length) {
    qualityItems.push({
      cls: quality.missingSleepDates.length > Math.max(3, rangeDays.length * 0.1) ? 'warn' : 'good',
      title: 'Missing sleep entries',
      text: `${quality.missingSleepDates.length} day${quality.missingSleepDates.length === 1 ? '' : 's'} without sleep data${quality.missingSleepDates.length <= 4 ? `: ${quality.missingSleepDates.map(formatShortDate).join(', ')}` : `, including ${quality.missingSleepDates.slice(0, 4).map(formatShortDate).join(', ')}`}.`
    });
  }
  qualityItems.push({
    cls: quality.noteCoverage >= 70 ? 'good' : quality.noteCoverage >= 50 ? 'warn' : 'bad',
    title: 'Food logging depth',
    text: quality.noteCoverage >= 70
      ? 'Food-note coverage is strong enough to trust the association analysis.'
      : `Food notes are thin on ${quality.noteMissing} day${quality.noteMissing === 1 ? '' : 's'}, so food associations should be treated as directional only.`
  });
  document.getElementById('qualityAuditList').innerHTML = qualityItems.map(item => `
    <div class="audit-item ${item.cls}">
      <strong>${item.title}</strong>
      <p>${item.text}</p>
    </div>
  `).join('');

  const assocSets = [
    {
      cls: 'good',
      title: `Foods linked to on-target days`,
      sub: `${foodPatterns.onTrackCount} days under calories, at protein floor, and alcohol-free`,
      items: foodPatterns.onTrackFoods,
      empty: 'No food is meaningfully overrepresented on on-target days in this range.'
    },
    {
      cls: 'warn',
      title: `Foods linked to strong protein days`,
      sub: `${foodPatterns.strongProteinCount} days at the 90%-of-body-weight protein floor`,
      items: foodPatterns.strongProteinFoods,
      empty: 'No food stands out as especially linked to protein-floor days yet.'
    },
    {
      cls: 'bad',
      title: `Foods linked to high-calorie days`,
      sub: `${foodPatterns.overTargetCount} days over the calorie target`,
      items: foodPatterns.overTargetFoods,
      empty: 'No food is strongly overrepresented on high-calorie days in this range.'
    },
    {
      cls: 'neutral',
      title: `Foods before poor next-day sleep`,
      sub: `${foodPatterns.poorNextSleepCount} follow-up days below the sleep-performance target`,
      items: foodPatterns.poorNextSleepFoods,
      empty: 'No food stands out as especially associated with poorer next-day sleep.'
    }
  ];
  const maxLift = Math.max(12, ...assocSets.flatMap(set => set.items.map(item => item.liftPoints || 0)));
  document.getElementById('foodAssocNote').textContent = eventFilter === 'all'
    ? 'Foods are ranked by overrepresentation inside the selected date range, using repeated appearances rather than one-off entries.'
    : `Foods are ranked using the full selected date range before the "${filterLabel()}" filter so the associations stay stable.`;
  document.getElementById('foodAssociationGrid').innerHTML = assocSets.map(set => `
    <div class="food-assoc-card ${set.cls}">
      <h4>${set.title}</h4>
      <p>${set.sub}</p>
      ${
        set.items.length
          ? `<div class="food-assoc-list">${set.items.map(item => `
              <div class="food-assoc-row">
                <div class="food-assoc-copy">
                  <div class="food-assoc-name">${item.food}</div>
                  <div class="food-assoc-meta">${item.subsetCount}/${item.overallCount} appearances in this outcome vs full range</div>
                  <div class="food-assoc-bar"><div class="food-assoc-fill" style="width:${Math.max(16, (item.liftPoints / maxLift) * 100)}%"></div></div>
                </div>
                <div class="food-assoc-delta">+${item.liftPoints}pp</div>
              </div>
            `).join('')}</div>`
          : `<div class="food-empty">${set.empty}</div>`
      }
    </div>
  `).join('');
}

function setScenarioInputs(values) {
  document.getElementById('whatifCal').value = values.calories;
  document.getElementById('whatifWeeks').value = values.weeks;
  document.getElementById('whatifSleep').value = values.sleep;
  document.getElementById('whatifDrinks').value = values.drinks;
}

function syncScenarioPresetButtons() {
  document.querySelectorAll('.scenario-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.preset === scenarioPreset));
}

function runScenarioPlanner() {
  const rangeDays = getRangeDays();
  const rangeSleep = getSleepForDaysUnfiltered(rangeDays);
  const cal = parseInt(document.getElementById('whatifCal').value) || goals.calories;
  const weeks = Math.max(1, parseInt(document.getElementById('whatifWeeks').value) || 4);
  const sleepHours = parseFloat(document.getElementById('whatifSleep').value) || goals.sleep;
  const drinkNights = parseFloat(document.getElementById('whatifDrinks').value) || 0;
  const r = calculateWhatIf(cal, weeks, sleepHours, drinkNights, rangeDays, rangeSleep);
  const currentAvgCalories = avgEffectiveCalories(rangeDays) ?? goals.calories;
  const currentAvgSleep = avgOrNull(rangeSleep, 'hours') ?? goals.sleep;
  const currentDrinkNights = rangeDays.length ? (rangeDays.filter(d => d.drinks).length / Math.max(rangeDays.length / 7, 1)) : 0;
  const baseline = calculateWhatIf(currentAvgCalories, weeks, currentAvgSleep, currentDrinkNights, rangeDays, rangeSleep);
  const deltaVsBaseline = parseFloat(r.weightChange) - parseFloat(baseline.weightChange);
  const dir = parseFloat(r.weightChange) >= 0 ? 'lose' : 'gain';
  const projectedComp = estimateBodyCompRangeAtWeight(parseFloat(r.projectedWeight), rangeDays);

  let html = `At <strong>${energyLabel(cal)}/day</strong> for <strong>${weeks} week${weeks === 1 ? '' : 's'}</strong>, the model still uses about <strong>${energyLabel(r.tdee)}</strong> as maintenance.`;
  html += `<br>That creates an effective <strong>${r.effectiveDeficit >= 0 ? '+' : ''}${energyLabel(r.effectiveDeficit)}/day</strong> after behavior drag.`;
  html += `<br>Projected weight: <strong>${weightLabel(parseFloat(r.projectedWeight))}</strong> (${dir} ~<strong>${weightLabel(Math.abs(parseFloat(r.weightChange)), 1)}</strong>)`;
  html += `<br>Projected body fat: <strong>~${projectedComp.bodyFatPct.toFixed(1)}%</strong> (likely ${projectedComp.bodyFatPctLow.toFixed(1)}%–${projectedComp.bodyFatPctHigh.toFixed(1)}%)`;
  html += `<br>Projected composition: ~${weightLabel(projectedComp.fat, 1)} fat / ${weightLabel(projectedComp.lean, 1)} lean (range: ${weightLabel(projectedComp.fatLow, 1)}–${weightLabel(projectedComp.fatHigh, 1)} fat)`;
  html += `<br>Compared with your current-range pace, that is <strong>${deltaVsBaseline >= 0 ? 'more' : 'less'} movement by ${weightLabel(Math.abs(deltaVsBaseline), 1)}</strong> over the same ${weeks}-week window.`;
  document.getElementById('whatifResult').innerHTML = html;

  document.getElementById('scenarioResultGrid').innerHTML = [
    {
      value: `${r.effectiveDeficit >= 0 ? '+' : ''}${energyLabel(r.effectiveDeficit)}`,
      sub: `Effective daily deficit after ${energyLabel(r.sleepPenalty)} sleep drag and ${energyLabel(r.drinkPenalty)} drink drag`
    },
    {
      value: weightLabel(Math.abs(parseFloat(r.weightChange)), 1),
      sub: `${dir === 'lose' ? 'Projected loss' : 'Projected gain'} over ${weeks} week${weeks === 1 ? '' : 's'}`
    },
    {
      value: weightLabel(parseFloat(r.projectedWeight)),
      sub: `Projected endpoint from current ${weightLabel(r.currentWeight)}`
    },
    {
      value: `~${projectedComp.bodyFatPct.toFixed(1)}%`,
      sub: `Likely ${projectedComp.bodyFatPctLow.toFixed(1)}%–${projectedComp.bodyFatPctHigh.toFixed(1)}% from ~${weightLabel(projectedComp.fat, 1)} fat and ~${weightLabel(projectedComp.lean, 1)} lean`
    },
    {
      value: r.drinkSleepPenalty ? `${Math.round(r.drinkSleepPenalty)} pts` : '—',
      sub: r.drinkSleepPenalty ? `Historical next-morning sleep hit after drink nights` : 'No strong drink-related sleep penalty in the current range'
    }
  ].map(card => `
    <div class="score-card">
      <div class="value">${card.value}</div>
      <div class="sub">${card.sub}</div>
    </div>
  `).join('');

  updateScenarioForecastChart({ calories: cal, weeks, sleep: sleepHours, drinks: drinkNights }, rangeDays, rangeSleep);
  document.getElementById('scenarioAssumptions').textContent = `Assumptions: estimated maintenance ~${energyLabel(estimatedTDEE)} from recency-weighted intake plus the smoothed weight trend, forecast starts from the latest weigh-in inside the selected range, selected-range average intake is ${energyLabel(currentAvgCalories)} including estimated drink calories, average sleep is ${currentAvgSleep.toFixed(1)}h, drink frequency is ${currentDrinkNights.toFixed(1)} nights/week, and projected body fat uses the same DXA-anchored body-comp model shown in Progress with a likely range rather than a single exact point.`;
}

// =====================================================================
// HEATMAP CALENDAR
// =====================================================================
let heatmapMetric = 'calories';

function renderHeatmap() {
  const grid = document.getElementById('heatmapGrid');
  const legend = document.getElementById('heatmapLegend');
  grid.innerHTML = '';
  legend.innerHTML = '';

  const months = [
    { label: 'Jan', days: data.Jan },
    { label: 'Feb', days: data.Feb },
    { label: 'Mar', days: data.March }
  ];

  // Ranges for color scaling
  const ranges = {
    calories: { min: 1100, max: 3500, good: 'low' },
    protein: { min: 80, max: 250, good: 'high' },
    sleepPerf: { min: 0, max: 100, good: 'high' },
    weight: { min: -2, max: 2, good: 'low' }
  };
  const r = ranges[heatmapMetric];
  const heatmapStops = [
    'rgba(213,94,0,0.78)',
    'rgba(230,159,0,0.74)',
    'rgba(148,163,184,0.64)',
    'rgba(86,180,233,0.74)',
    'rgba(0,114,178,0.82)'
  ];

  function cellColor(val) {
    if (val == null) return null;
    const norm = Math.max(0, Math.min(1, (val - r.min) / (r.max - r.min)));
    const goodNorm = r.good === 'high' ? norm : 1 - norm;
    if (goodNorm >= 0.85) return heatmapStops[4];
    if (goodNorm >= 0.65) return heatmapStops[3];
    if (goodNorm >= 0.4) return heatmapStops[2];
    if (goodNorm >= 0.2) return heatmapStops[1];
    return heatmapStops[0];
  }

  months.forEach(mo => {
    const row = document.createElement('div');
    row.className = 'heatmap-row';
    row.innerHTML = `<span class="row-label">${mo.label}</span>`;

    mo.days.forEach(d => {
      const inRange = isDateInRange(d.date);
      let val = null;
      if (heatmapMetric === 'calories') val = d.calories;
      else if (heatmapMetric === 'protein') val = d.protein;
      else if (heatmapMetric === 'sleepPerf') { const s = sleepByDate[d.date]; if (s) val = s.perf; }
      else if (heatmapMetric === 'weight') {
        // Weight delta from previous logged weight
        const idx = allDays.indexOf(d);
        if (d.weight && idx > 0) {
          const prevW = allDays.slice(0, idx).reverse().find(dd => dd.weight);
          if (prevW) val = d.weight - prevW.weight;
        }
      }

      const cell = document.createElement('div');
      cell.className = 'heatmap-cell' + (val == null ? ' empty' : '') + (inRange ? '' : ' out-of-range');
      const bg = cellColor(val);
      if (bg) cell.style.background = bg;
      cell.title = `${d.date}: ${val != null ? val : 'no data'}`;
      cell.dataset.date = d.date;

      if (val != null) {
        cell.addEventListener('click', () => openPanel(d.date));
        cell.addEventListener('mouseenter', (e) => {
          const tt = document.getElementById('hmTooltip');
          let label = '';
          if (heatmapMetric === 'calories') label = energyLabel(d.calories);
          else if (heatmapMetric === 'protein') label = `${d.protein}g protein`;
          else if (heatmapMetric === 'sleepPerf') label = `${val}% sleep`;
          else if (heatmapMetric === 'weight') label = `${val > 0 ? '+' : ''}${weightValue(Math.abs(val))} ${weightUnit()}`;
          tt.textContent = `${d.date.slice(5)} — ${label}`;
          tt.style.display = 'block';
          tt.style.left = e.clientX + 12 + 'px';
          tt.style.top = e.clientY - 30 + 'px';
        });
        cell.addEventListener('mouseleave', () => { document.getElementById('hmTooltip').style.display = 'none'; });
      }
      row.appendChild(cell);
    });
    // Pad to 31
    for (let i = mo.days.length; i < 31; i++) {
      const empty = document.createElement('div');
      empty.className = 'heatmap-cell empty';
      row.appendChild(empty);
    }
    grid.appendChild(row);
  });

  // Legend
  legend.innerHTML = `<span>Less favorable</span>`;
  for (let i = 0; i < heatmapStops.length; i++) {
    const el = document.createElement('div');
    el.className = 'heatmap-legend-cell';
    el.style.background = heatmapStops[i];
    legend.appendChild(el);
  }
  legend.innerHTML += `<span>More favorable</span>`;
}

document.querySelectorAll('#heatmapTabs .mtab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#heatmapTabs .mtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    heatmapMetric = btn.dataset.hm;
    renderHeatmap();
  });
});
