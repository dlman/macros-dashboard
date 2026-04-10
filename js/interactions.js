// =====================================================================
// DAY DETAIL PANEL (enhanced with sleep data + food pills + keyboard nav)
// =====================================================================
let currentPanelDate = null;

function findDay(dateStr) {
  for (const m of ACTIVE_MONTHS) {
    const found = data[m.key].find(d => d.date === dateStr);
    if (found) return { day: found, month: m.key };
  }
  return null;
}

function openPanel(dateStr) {
  const result = findDay(dateStr);
  if (!result) return;
  currentPanelDate = dateStr;
  const { day, month } = result;
  const dateObj = new Date(day.date + 'T12:00:00');
  document.getElementById('panelDate').textContent = dateObj.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  document.getElementById('panelMonth').textContent = month + ' 2026';

  // Macro stats
  const macroStats = document.getElementById('panelMacroStats');
  macroStats.innerHTML = `
    <div class="mini-stat"><div class="ms-label">Calories</div><div class="ms-val" style="color:#fbbf24">${day.calories ? energyLabel(day.calories) : '—'}</div></div>
    <div class="mini-stat"><div class="ms-label">Protein</div><div class="ms-val" style="color:#f59e0b">${day.protein ? day.protein+'g' : '—'}</div></div>
    <div class="mini-stat"><div class="ms-label">Carbs</div><div class="ms-val" style="color:#38bdf8">${day.carbs ? day.carbs+'g' : '—'}</div></div>
    <div class="mini-stat"><div class="ms-label">Fat</div><div class="ms-val" style="color:#f97316">${day.fat ? day.fat+'g' : '—'}</div></div>
  `;

  // Sleep stats
  const sleep = sleepByDate[dateStr];
  const sleepStats = document.getElementById('panelSleepStats');
  if (sleep) {
    sleepStats.innerHTML = `
      <div class="mini-stat"><div class="ms-label">Sleep Perf</div><div class="ms-val" style="color:${perfColor(sleep.perf)}">${sleep.perf}%</div></div>
      <div class="mini-stat"><div class="ms-label">Hours</div><div class="ms-val" style="color:#f59e0b">${sleep.hours}h</div></div>
      <div class="mini-stat"><div class="ms-label">Bedtime</div><div class="ms-val" style="color:#38bdf8;font-size:14px">${sleep.bedtime}</div></div>
      <div class="mini-stat"><div class="ms-label">Deep/REM</div><div class="ms-val" style="color:#34d399;font-size:14px">${sleep.deep}/${sleep.rem}h</div></div>
    `;
    // Recovery score
    const rec = recoveryScore(sleep);
    sleepStats.innerHTML += `<div class="mini-stat"><div class="ms-label">Recovery</div><div class="ms-val" style="color:${perfColor(rec)}">${rec}</div></div>`;
  } else {
    sleepStats.innerHTML = '<div class="mini-stat"><div class="ms-label">Sleep</div><div class="ms-val" style="color:#64748b">No data</div></div>';
  }

  // Badges
  const badges = document.getElementById('panelBadges');
  badges.innerHTML = '';
  if (day.weight) badges.innerHTML += `<span class="pill weight">⚖️ ${weightLabel(day.weight)}</span>`;
  if (day.lifting === 'Y') badges.innerHTML += `<span class="pill lift">🏋️ Lifted</span>`;
  if (day.drinks) badges.innerHTML += `<span class="pill drink">🍹 ${day.drinks}</span>`;
  if (sleep) badges.innerHTML += `<span class="pill sleep">😴 ${sleep.efficiency}% efficiency</span>`;

  // Protein per lb
  if (day.weight && day.protein) {
    badges.innerHTML += `<span class="pill" style="background:rgba(245,158,11,0.15);color:#f59e0b;">💪 ${ratioLabel(day.protein, day.weight)}</span>`;
  }

  // Drink calorie estimate breakdown
  const drinkCalEst = estimateDrinkCalories(day.drinks);
  if (drinkCalEst > 0) {
    const effectiveCal = effectiveCalories(day);
    badges.innerHTML += `<span class="pill" style="background:rgba(239,68,68,0.15);color:#ef4444;">🔥 ~${energyLabel(drinkCalEst)} drink cals · ~${energyLabel(effectiveCal)} effective total</span>`;
  }

  // Food pills
  const foodPills = document.getElementById('panelFoodPills');
  const foods = parseFoods(day.notes);
  foodPills.innerHTML = foods.map(f => `<span class="food-pill ${isFoodProteinRich(f)?'protein':''}">${f}</span>`).join('');

  // Raw notes
  document.getElementById('panelNotes').textContent = day.notes || 'No notes';

  document.getElementById('dayPanel').classList.add('open');
  document.getElementById('overlay').classList.add('show');
}

function closePanel() {
  document.getElementById('dayPanel').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
  currentPanelDate = null;
}
document.getElementById('closePanel').addEventListener('click', closePanel);
document.getElementById('overlay').addEventListener('click', closePanel);

// =====================================================================
// MOBILE CHART ZOOM
// =====================================================================
let lastChartTap = { id: null, time: 0 };
let chartZoomState = null;

function openChartZoom(canvas) {
  if (!canvas || chartZoomState) return;
  const title = document.getElementById('chartZoomTitle');
  const frame = document.getElementById('chartZoomFrame');
  const card = canvas.closest('.chart-card');
  const wrapper = canvas.closest('.chart-wrapper');
  if (!wrapper) return;
  const label = card?.querySelector('h3')?.textContent?.trim() || 'Chart';
  const parent = wrapper.parentNode;
  const placeholder = document.createComment(`chart-zoom-placeholder:${canvas.id || label}`);
  parent.insertBefore(placeholder, wrapper);
  frame.appendChild(wrapper);
  wrapper.classList.add('zoomed-live');
  title.textContent = label;
  chartZoomState = { wrapper, parent, placeholder, canvasId: canvas.id };
  document.getElementById('chartZoomOverlay').classList.add('show');
  document.getElementById('chartZoomModal').classList.add('open');
  document.getElementById('chartZoomModal').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    const chart = Chart.getChart(canvas);
    if (chart) {
      chart.resize();
      chart.update('none');
    }
  });
}

function closeChartZoom() {
  if (chartZoomState) {
    const { wrapper, parent, placeholder, canvasId } = chartZoomState;
    if (parent && placeholder?.parentNode === parent) {
      parent.insertBefore(wrapper, placeholder);
      placeholder.remove();
    }
    wrapper.classList.remove('zoomed-live');
    const canvas = canvasId ? document.getElementById(canvasId) : wrapper.querySelector('canvas');
    requestAnimationFrame(() => {
      const chart = canvas ? Chart.getChart(canvas) : null;
      if (chart) {
        chart.resize();
        chart.update('none');
      }
    });
  }
  chartZoomState = null;
  document.getElementById('chartZoomFrame').innerHTML = '';
  document.getElementById('chartZoomOverlay').classList.remove('show');
  document.getElementById('chartZoomModal').classList.remove('open');
  document.getElementById('chartZoomModal').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 900px)').matches;
}

function attachChartZoomHandlers() {
  document.querySelectorAll('.chart-card canvas').forEach(canvas => {
    if (canvas.dataset.zoomBound === 'true') return;
    canvas.dataset.zoomBound = 'true';
    canvas.addEventListener('dblclick', () => openChartZoom(canvas));
    canvas.addEventListener('touchend', () => {
      if (!isMobileViewport()) return;
      const now = Date.now();
      if (lastChartTap.id === canvas.id && now - lastChartTap.time < 320) {
        openChartZoom(canvas);
        lastChartTap = { id: null, time: 0 };
      } else {
        lastChartTap = { id: canvas.id, time: now };
      }
    }, { passive: true });
  });
}

document.getElementById('closeChartZoom').addEventListener('click', closeChartZoom);
document.getElementById('chartZoomOverlay').addEventListener('click', closeChartZoom);

// Navigate prev/next
function navigateDay(direction) {
  if (!currentPanelDate) return;
  const idx = allDates.indexOf(currentPanelDate);
  if (idx < 0) return;
  const newIdx = idx + direction;
  if (newIdx >= 0 && newIdx < allDates.length) {
    openPanel(allDates[newIdx]);
  }
}
document.getElementById('prevDay').addEventListener('click', () => navigateDay(-1));
document.getElementById('nextDay').addEventListener('click', () => navigateDay(1));

// Keyboard navigation
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePanel(); closeSettings(); closeChartZoom(); }
  if (currentPanelDate) {
    if (e.key === 'ArrowLeft') navigateDay(-1);
    if (e.key === 'ArrowRight') navigateDay(1);
  }
});

// =====================================================================
// THEME TOGGLE
// =====================================================================
document.getElementById('themeToggle').addEventListener('click', () => {
  const nextTheme = resolvedTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(nextTheme);
  refreshDashboard();
  persistUiState();
});

systemThemeQuery.addEventListener('change', () => {
  if (themePreference !== 'system') return;
  applyTheme('system');
  refreshDashboard();
  persistUiState();
});

// =====================================================================
// UNIT TOGGLE
// =====================================================================
document.getElementById('unitToggle').addEventListener('click', () => {
  useMetric = !useMetric;
  refreshDashboard();
  persistUiState();
});

// =====================================================================
// SETTINGS PANEL
// =====================================================================
function openSettings() {
  syncSettingsForm();
  document.getElementById('settingsPanel').classList.add('open');
  document.getElementById('settingsOverlay').classList.add('show');
  renderAnnotations();
}
function closeSettings() {
  document.getElementById('settingsPanel').classList.remove('open');
  document.getElementById('settingsOverlay').classList.remove('show');
}
document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('closeSettings').addEventListener('click', closeSettings);
document.getElementById('settingsOverlay').addEventListener('click', closeSettings);

// Annotations
function renderAnnotations() {
  const list = document.getElementById('annotationList');
  list.innerHTML = annotations.map((a, i) => `
    <div class="annotation-item">
      <span class="dot"></span>
      <span>${a.date.slice(5)} — ${a.label}</span>
      <button onclick="annotations.splice(${i},1);renderAnnotations();persistState({ themePreference, rangeStart: rangeStartIdx, rangeEnd: rangeEndIdx, currentMetric, calVisibility, macroVisibility, compareMode, eventFilter });">✕</button>
    </div>
  `).join('');
}

document.getElementById('addAnnotationBtn').addEventListener('click', () => {
  const date = document.getElementById('annotationDate').value;
  const text = document.getElementById('annotationText').value;
  if (date && text) {
    annotations.push({ date, label: text });
    document.getElementById('annotationDate').value = '';
    document.getElementById('annotationText').value = '';
    renderAnnotations();
    persistUiState();
    refreshDashboard();
  }
});

// Apply settings
document.getElementById('applySettings').addEventListener('click', () => {
  const nextCalories = parseInt(document.getElementById('goalCalories').value);
  goals.calories = Number.isFinite(nextCalories) && nextCalories > 0 ? nextCalories : 2100;
  goals.protein = null;
  goals.carbs = parseInt(document.getElementById('goalCarbs').value) || 150;
  goals.fat = parseInt(document.getElementById('goalFat').value) || 80;
  goals.sleep = parseFloat(document.getElementById('goalSleep').value) || 7;
  goals.sleepPerf = parseInt(document.getElementById('goalSleepPerf').value) || 70;
  goals.bedtime = document.getElementById('goalBedtime').value || '12:30 AM';

  // Recovery weights
  const rws = +document.getElementById('recovWtSleep').value / 100;
  const rwe = +document.getElementById('recovWtEff').value / 100;
  const rwr = +document.getElementById('recovWtResp').value / 100;
  const rwd = +document.getElementById('recovWtDrink').value / 100;
  if (Math.abs((rws + rwe + rwr + rwd) - 1) < 0.02) {
    recoveryWeights = { sleep: rws, efficiency: rwe, resp: rwr, drink: rwd };
  }

  syncSettingsForm();
  refreshDashboard();
  persistUiState();
  closeSettings();
});

// =====================================================================
// DATE RANGE SLIDER
// =====================================================================
const rangeStartEl = document.getElementById('rangeStart');
const rangeEndEl = document.getElementById('rangeEnd');
const compareModeEl = document.getElementById('compareMode');
const eventFilterEl = document.getElementById('eventFilter');
function updateRangeLabels() {
  if (parseInt(rangeStartEl.value) > parseInt(rangeEndEl.value)) {
    if (document.activeElement === rangeStartEl) rangeEndEl.value = rangeStartEl.value;
    else rangeStartEl.value = rangeEndEl.value;
  }
  const s = parseInt(rangeStartEl.value);
  const e = parseInt(rangeEndEl.value);
  document.getElementById('rangeStartLabel').textContent = allDates[s] ? allDates[s].slice(5) : '';
  document.getElementById('rangeEndLabel').textContent = allDates[e] ? allDates[e].slice(5) : '';
  // Sync date pickers
  const rsde = document.getElementById('rangeStartDate');
  const rede = document.getElementById('rangeEndDate');
  if (rsde && rede && allDates.length) {
    rsde.value = allDates[Math.min(s, allDates.length - 1)] || '';
    rede.value = allDates[Math.min(e, allDates.length - 1)] || '';
  }
}
let _rangeDebounce = null;
function debouncedRangeRefresh() {
  updateRangeLabels();
  clearTimeout(_rangeDebounce);
  _rangeDebounce = setTimeout(() => { refreshDashboard(); persistUiState(); }, 250);
}
rangeStartEl.addEventListener('input', debouncedRangeRefresh);
rangeEndEl.addEventListener('input', debouncedRangeRefresh);
const compareModeHints = {
  equal_span: 'Matches the prior period length to your selected range',
  prior_7: 'Always uses the 7 days before your range starts',
  prior_28: 'Always uses the 28 days before your range starts',
  prior_month: 'Same day-count from the previous calendar month'
};
compareModeEl.addEventListener('change', () => {
  compareMode = compareModeEl.value;
  const hint = document.getElementById('compareModeHint');
  if (hint) hint.textContent = compareModeHints[compareMode] || '';
  refreshDashboard();
  persistUiState();
});
eventFilterEl.addEventListener('change', () => {
  eventFilter = eventFilterEl.value;
  refreshDashboard();
  persistUiState();
});

// Recovery weight validation
['recovWtSleep','recovWtEff','recovWtResp','recovWtDrink'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => {
    const total = ['recovWtSleep','recovWtEff','recovWtResp','recovWtDrink'].reduce((s, i) => s + (+document.getElementById(i).value || 0), 0);
    const el = document.getElementById('recovWtTotal');
    if (el) {
      el.textContent = `Total: ${total}%`;
      el.style.color = total === 100 ? 'var(--col-green)' : 'var(--col-red)';
    }
  });
});

// Date picker sync
const rangeStartDateEl = document.getElementById('rangeStartDate');
const rangeEndDateEl = document.getElementById('rangeEndDate');
const defaultEndIdx = defaultRangeEndIndex();
if (rangeStartDateEl && rangeEndDateEl) {
  rangeEndDateEl.value = allDates[defaultEndIdx] || '2026-03-23';
  rangeStartDateEl.value = allDates[0] || '2026-01-01';
  rangeStartDateEl.min = allDates[0] || '2026-01-01';
  rangeStartDateEl.max = analyticsCutoffDate();
  rangeEndDateEl.min = allDates[0] || '2026-01-01';
  rangeEndDateEl.max = analyticsCutoffDate();

  function syncDateToRange() {
    const startDate = rangeStartDateEl.value;
    const endDate = rangeEndDateEl.value;
    let startIdx = allDates.indexOf(startDate);
    let endIdx = allDates.indexOf(endDate);
    if (startIdx < 0) startIdx = allDates.findIndex(d => d >= startDate);
    if (endIdx < 0) endIdx = allDates.findIndex(d => d >= endDate);
    if (startIdx < 0) startIdx = 0;
    const maxIdx = maxAnalyticsIndex();
    if (endIdx < 0) endIdx = maxIdx;
    endIdx = Math.min(endIdx, maxIdx);
    if (startIdx > endIdx) [startIdx, endIdx] = [endIdx, startIdx];
    rangeStartEl.value = startIdx;
    rangeEndEl.value = endIdx;
    rangeStartIdx = startIdx;
    rangeEndIdx = endIdx;
    refreshDashboard();
    persistUiState();
  }

  rangeStartDateEl.addEventListener('change', syncDateToRange);
  rangeEndDateEl.addEventListener('change', syncDateToRange);
}

updateRangeLabels();
let _exploreDirty = true;
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeTab = btn.dataset.tab;
    applyActiveTab();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (activeTab === 'explore' && _exploreDirty) {
      renderCorrMatrix();
      renderExploreDiagnostics();
      _exploreDirty = false;
    }
    refreshDashboard();
    persistUiState();
  });
});
document.getElementById('tabJumpRow').addEventListener('click', (e) => {
  const btn = e.target.closest('.jump-chip');
  if (!btn) return;
  scrollToTabTarget(btn.dataset.jumpTarget);
});
document.getElementById('backToTopBtn').addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// =====================================================================
// EXPORT
// =====================================================================
// Per-chart export
document.querySelectorAll('.export-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const chartId = btn.dataset.chart;
    const canvas = document.getElementById(chartId);
    if (canvas) {
      const link = document.createElement('a');
      link.download = `${chartId}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    }
  });
});

// Full dashboard export
document.getElementById('exportAllBtn').addEventListener('click', () => {
  const main = document.getElementById('mainContent');
  html2canvas(main, { backgroundColor: getComputedStyle(document.body).backgroundColor, scale: 2 }).then(canvas => {
    const link = document.createElement('a');
    link.download = 'macros_dashboard_2026.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
});

document.getElementById('weeklyReviewExportBtn').addEventListener('click', () => {
  const review = document.getElementById('weeklyReport');
  html2canvas(review, { backgroundColor: getComputedStyle(document.body).backgroundColor, scale: 2 }).then(canvas => {
    const link = document.createElement('a');
    const rangeDays = getFilteredDays().slice(-7);
    const stamp = rangeDays.length ? `${rangeDays[0].date}_to_${rangeDays[rangeDays.length - 1].date}` : 'latest_week';
    link.download = `weekly_review_${stamp}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
});

document.getElementById('weeklyMarkdownExportBtn').addEventListener('click', () => {
  const md = generateWeeklyMarkdown();
  navigator.clipboard.writeText(md).then(() => {
    const btn = document.getElementById('weeklyMarkdownExportBtn');
    const orig = btn.textContent;
    btn.textContent = '✅ Copied!';
    setTimeout(() => btn.textContent = orig, 2000);
  }).catch(() => {
    // Fallback: download as .md file
    const blob = new Blob([generateWeeklyMarkdown()], { type: 'text/markdown' });
    const link = document.createElement('a');
    link.download = 'weekly_review.md';
    link.href = URL.createObjectURL(blob);
    link.click();
  });
});

// =====================================================================
// WHAT-IF CALCULATOR
// =====================================================================
document.getElementById('whatifCalcBtn').addEventListener('click', runScenarioPlanner);
document.querySelectorAll('.scenario-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const defaults = getScenarioDefaults(getRangeDays(), getSleepForDaysUnfiltered(getRangeDays()));
    scenarioPreset = btn.dataset.preset;
    const presetValues = defaults[scenarioPreset] || defaults.current;
    setScenarioInputs(presetValues);
    syncScenarioPresetButtons();
    scenarioFormInitialized = true;
    runScenarioPlanner();
  });
});
['whatifCal', 'whatifWeeks', 'whatifSleep', 'whatifDrinks'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    scenarioPreset = '';
    syncScenarioPresetButtons();
  });
});

function syncSettingsForm() {
  document.getElementById('goalCalories').value = goals.calories;
  document.getElementById('goalProtein').value = currentProteinGoal();
  document.getElementById('goalCarbs').value = goals.carbs;
  document.getElementById('goalFat').value = goals.fat;
  document.getElementById('goalSleep').value = goals.sleep;
  document.getElementById('goalBedtime').value = goals.bedtime;
  document.getElementById('goalSleepPerf').value = goals.sleepPerf;
  // Recovery weights
  document.getElementById('recovWtSleep').value = Math.round(recoveryWeights.sleep * 100);
  document.getElementById('recovWtEff').value = Math.round(recoveryWeights.efficiency * 100);
  document.getElementById('recovWtResp').value = Math.round(recoveryWeights.resp * 100);
  document.getElementById('recovWtDrink').value = Math.round(recoveryWeights.drink * 100);
  updateRecoveryWeightTotal();
}

function updateRecoveryWeightTotal() {
  const total = ['recovWtSleep','recovWtEff','recovWtResp','recovWtDrink']
    .reduce((sum, id) => sum + (parseInt(document.getElementById(id).value) || 0), 0);
  const el = document.getElementById('recovWtTotal');
  if (Math.abs(total - 100) < 2) {
    el.textContent = `Total: ${total}%`;
    el.style.color = 'var(--text-faint)';
  } else {
    el.textContent = `Total: ${total}% ⚠️ Must equal 100% to save`;
    el.style.color = '#ef4444';
  }
}
['recovWtSleep','recovWtEff','recovWtResp','recovWtDrink'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateRecoveryWeightTotal);
});

function syncControlsFromState() {
  document.getElementById('themeToggle').textContent = resolvedTheme() === 'light' ? '☀️ Theme' : '🌙 Theme';
  document.getElementById('unitToggle').textContent = useMetric ? 'kg / kJ' : 'lbs / kcal';
  document.getElementById('compareMode').value = compareMode;
  document.getElementById('eventFilter').value = eventFilter;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === activeTab));
  document.querySelectorAll('.mtab[data-metric]').forEach(btn => btn.classList.toggle('active', btn.dataset.metric === currentMetric));
  document.querySelectorAll('.mtoggle[data-chart="calories"]').forEach((btn, idx) => btn.classList.toggle('off', !calVisibility[idx]));
  document.querySelectorAll('.mtoggle[data-chart="macro"]').forEach((btn, idx) => btn.classList.toggle('off', !macroVisibility[idx]));
}

function renderTabChrome() {
  const config = TAB_CHROME[activeTab] || TAB_CHROME.overview;
  const titleEl = document.getElementById('tabChromeTitle');
  const subEl = document.getElementById('tabChromeSub');
  const jumpRow = document.getElementById('tabJumpRow');
  if (titleEl) titleEl.textContent = config.title;
  if (subEl) subEl.textContent = config.summary;
  if (jumpRow) {
    jumpRow.innerHTML = config.jumps.map(jump => `<button class="jump-chip" data-jump-target="${jump.selector}">${jump.label}</button>`).join('');
  }
}

function scrollToTabTarget(selector) {
  const target = document.querySelector(selector);
  if (!target) return;
  let current = target.parentElement;
  while (current) {
    if (current.tagName === 'DETAILS') current.open = true;
    current = current.parentElement;
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function applyActiveTab() {
  document.querySelectorAll('[data-tab-section]').forEach(section => {
    section.classList.toggle('tab-section-hidden', section.dataset.tabSection !== activeTab);
  });
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === activeTab));
  renderTabChrome();
}

const MOBILE_BREAKPOINT = 900;
let responsiveLayoutInitialized = false;
let lastResponsiveMode = window.innerWidth <= MOBILE_BREAKPOINT ? 'mobile' : 'desktop';

function syncResponsiveLayout(force = false) {
  const mobile = window.innerWidth <= MOBILE_BREAKPOINT;
  const mode = mobile ? 'mobile' : 'desktop';
  if (!force && mode === lastResponsiveMode) return;
  lastResponsiveMode = mode;

  const controlShell = document.getElementById('mobileControlShell');
  if (controlShell) {
    if (mobile) {
      if (controlShell.dataset.userToggled !== 'true') controlShell.open = false;
    } else {
      controlShell.open = true;
    }
  }

  document.querySelectorAll('.advanced-shell, .mobile-detail-shell, .explore-module').forEach(shell => {
    if (mobile) {
      if (shell.dataset.userToggled !== 'true') shell.open = false;
    } else {
      shell.open = true;
    }
  });
}

function persistUiState() {
  persistState({
    themePreference,
    rangeStart: rangeStartIdx,
    rangeEnd: rangeEndIdx,
    currentMetric,
    calVisibility,
    macroVisibility,
    compareMode,
    eventFilter,
    activeTab
  });
}

function energyValue(v, digits = 0) {
  if (v == null || Number.isNaN(v)) return null;
  const val = useMetric ? v * 4.184 : v;
  return +val.toFixed(digits);
}

function weightValue(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return null;
  const val = useMetric ? v * 0.453592 : v;
  return +val.toFixed(digits);
}

function calcAxisBounds(values, padding = 1) {
  const clean = values.filter(v => v != null && !Number.isNaN(v));
  if (!clean.length) return { min: 0, max: 10 };
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  if (min === max) return { min: min - padding, max: max + padding };
  return { min: min - padding, max: max + padding };
}

function updateWeightChart(days) {
  const chart = allCharts.weightChart;
  const points = days.filter(d => d.weight).map(d => ({
    label: `${d.date.slice(5)} (${monthKey(d.date).slice(0, 3)})`,
    date: d.date,
    value: d.weight
  }));
  const vals = points.map(p => weightValue(p.value));
  const rolling = rollingAvg(points.map(p => p.value), 7).map(v => v == null ? null : weightValue(v));
  chart.data.labels = points.map(p => p.label);
  chart.data.datasets[0].data = vals;
  chart.data.datasets[1].data = rolling;
  // Linear regression line
  const validIndices = vals.map((v, i) => v != null ? i : null).filter(v => v !== null);
  const validVals = validIndices.map(i => vals[i]);
  if (validIndices.length >= 3) {
    const n = validIndices.length;
    const sumX = validIndices.reduce((a, b) => a + b, 0);
    const sumY = validVals.reduce((a, b) => a + b, 0);
    const sumXY = validIndices.reduce((s, x, i) => s + x * validVals[i], 0);
    const sumX2 = validIndices.reduce((s, x) => s + x * x, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    const regressionData = vals.map((_, i) => +(intercept + slope * i).toFixed(1));
    const lbsPerWeek = slope * 7;
    const trendDs = chart.data.datasets.find(d => d.label === 'Trend');
    if (!trendDs) {
      chart.data.datasets.push({ label: 'Trend', data: regressionData, borderColor: 'rgba(251,113,133,0.6)', borderDash: [4, 6], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0 });
    } else {
      trendDs.data = regressionData;
    }
    const rateText = `${lbsPerWeek < 0 ? '' : '+'}${weightValue(lbsPerWeek)} ${weightUnit()}/week`;
    const weightChartHeader = document.querySelector('#weightChart')?.closest('.chart-card')?.querySelector('h3');
    if (weightChartHeader) weightChartHeader.textContent = `Weight — 7d avg, regression (${rateText})`;
  }

  // Update glyco-adjusted line (what would weight be at Jan 6 glycogen level?)
  const glycoAdjData = points.map(p => {
    const s = glycogenByDate[p.date];
    if (!s) return null;
    const delta = s.massLbs - glycogenRefState.massLbs;
    return +((p.value - delta)).toFixed(1);
  });
  const glycoDs = chart.data.datasets.find(d => d.label === 'Glyco-adj (vs Jan 6)');
  if (!glycoDs) {
    chart.data.datasets.push({ label: 'Glyco-adj (vs Jan 6)', data: glycoAdjData, borderColor: 'rgba(192,132,252,0.75)', borderDash: [4,4], pointRadius: 0, tension: 0.4, fill: false, borderWidth: 1.5 });
  } else {
    glycoDs.data = glycoAdjData;
  }
  chart.data.datasets[0].pointRadius = points.map(p => drinkDates.has(p.date) || liftDates.has(p.date) ? 7 : 5);
  chart.data.datasets[0].pointStyle = points.map(p => drinkDates.has(p.date) ? 'triangle' : liftDates.has(p.date) ? 'rectRot' : 'circle');
  chart.data.datasets[0].pointBackgroundColor = points.map(p => {
    if (drinkDates.has(p.date)) return EVENT_COLORS.drink;
    if (liftDates.has(p.date)) return EVENT_COLORS.lift;
    return '#34d399';
  });
  chart.data.datasets[0].pointBorderColor = points.map(p => drinkDates.has(p.date) || liftDates.has(p.date) ? 'rgba(15,17,23,0.85)' : 'transparent');
  chart.data.datasets[0].pointBorderWidth = points.map(p => drinkDates.has(p.date) || liftDates.has(p.date) ? 1.5 : 0);
  chart.data.datasets[1].data = rolling;
  chart.options.onClick = (evt, elements) => {
    if (elements.length && elements[0].datasetIndex === 0) openPanel(points[elements[0].index].date);
  };
  const bounds = calcAxisBounds(vals, useMetric ? 0.8 : 2);
  chart.options.plugins.tooltip.callbacks.label = ctx => {
    if (ctx.datasetIndex === 0) return ` ${weightLabel(points[ctx.dataIndex].value)}`;
    if (ctx.dataset.label === '7-day Avg') return ` 7d avg: ${ctx.parsed.y} ${weightUnit()}`;
    if (ctx.dataset.label === 'Trend') return ` Trend: ${ctx.parsed.y} ${weightUnit()}`;
    if (ctx.dataset.label === 'Glyco-adj (vs Jan 6)') {
      const s = glycogenByDate[points[ctx.dataIndex]?.date];
      return s ? ` Glyco-adj: ${ctx.parsed.y} ${weightUnit()} (${s.loadPct}% glycogen loaded)` : ` Glyco-adj: ${ctx.parsed.y} ${weightUnit()}`;
    }
    return ` ${ctx.parsed.y} ${weightUnit()}`;
  };
  chart.options.scales.y.min = Math.floor(bounds.min);
  chart.options.scales.y.max = Math.ceil(bounds.max);
  chart.options.scales.y.ticks.stepSize = useMetric ? 1 : 2;
  chart.options.scales.y.ticks.callback = v => `${v} ${weightUnit()}`;
  chart.update();
}

function updateAdjustedWeightViewChart(days) {
  const chart = allCharts.gpWeightChart;
  if (!chart) return;
  const points = days
    .filter(d => d.weight && glycogenByDate[d.date])
    .map(d => {
      const state = glycogenByDate[d.date];
      const deltaRaw = +(state.massLbs - glycogenRefState.massLbs).toFixed(2);
      return {
        date: d.date,
        actualRaw: d.weight,
        adjustedRaw: +(d.weight - deltaRaw).toFixed(2),
        actual: weightValue(d.weight),
        adjusted: weightValue(+(d.weight - deltaRaw).toFixed(2)),
        delta: weightValue(deltaRaw, 2),
        deltaRaw,
        loadPct: state.loadPct,
        glycogenG: state.glycogenG,
        massLbs: state.massLbs
      };
    });
  const noteEl = document.getElementById('adjustedWeightNote');
  if (!points.length) {
    chart.data.labels = [];
    chart.data.datasets.forEach(ds => { ds.data = []; });
    chart.update();
    if (noteEl) noteEl.textContent = 'This view needs weigh-ins inside the selected range.';
    return;
  }
  chart.data.labels = points.map(p => p.date.slice(5));
  chart.data.datasets[0].data = points.map(p => p.actual);
  chart.data.datasets[1].data = points.map(p => p.adjusted);
  chart.data.datasets[2].data = points.map(p => p.delta);
  chart.data.datasets[2].backgroundColor = points.map(p => p.deltaRaw >= 0 ? 'rgba(59,130,246,0.18)' : 'rgba(251,191,36,0.18)');
  chart.data.datasets[2].borderColor = points.map(p => p.deltaRaw >= 0 ? 'rgba(59,130,246,0.45)' : 'rgba(251,191,36,0.45)');
  const weightBounds = calcAxisBounds([...points.map(p => p.actual), ...points.map(p => p.adjusted)], useMetric ? 0.8 : 2);
  const deltaBounds = calcAxisBounds(points.map(p => p.delta), useMetric ? 0.3 : 0.8);
  chart.options.plugins.tooltip.callbacks.title = ctx => points[ctx[0].dataIndex]?.date || '';
  chart.options.plugins.tooltip.callbacks.label = ctx => {
    if (ctx.datasetIndex === 0) return ` Actual: ${ctx.parsed.y} ${weightUnit()}`;
    if (ctx.datasetIndex === 1) return ` Glyco-adjusted: ${ctx.parsed.y} ${weightUnit()}`;
    if (ctx.datasetIndex === 2) return ` Glycogen/water delta vs Jan 6: ${ctx.parsed.y > 0 ? '+' : ''}${ctx.parsed.y} ${weightUnit()}`;
    return '';
  };
  chart.options.plugins.tooltip.callbacks.afterBody = ctx => {
    const point = points[ctx[0].dataIndex];
    if (!point) return [];
    return [
      `Modeled glycogen load: ${point.loadPct}% (${point.glycogenG}g)`,
      `Modeled glycogen + water mass: ~${point.massLbs} lbs`
    ];
  };
  chart.options.scales.y.min = Math.floor(weightBounds.min);
  chart.options.scales.y.max = Math.ceil(weightBounds.max);
  chart.options.scales.y.ticks.stepSize = useMetric ? 1 : 2;
  chart.options.scales.y.ticks.callback = v => `${v} ${weightUnit()}`;
  chart.options.scales.y2.min = Math.floor(deltaBounds.min);
  chart.options.scales.y2.max = Math.ceil(deltaBounds.max);
  chart.options.scales.y2.ticks.stepSize = useMetric ? 0.5 : 1;
  chart.options.scales.y2.ticks.callback = v => `${v > 0 ? '+' : ''}${v} ${weightUnit()}`;
  chart.update();
  if (noteEl) {
    const latest = points[points.length - 1];
    const signLabel = latest.deltaRaw > 0 ? 'more glycogen/water than Jan 6' : latest.deltaRaw < 0 ? 'less glycogen/water than Jan 6' : 'about the same glycogen/water as Jan 6';
    noteEl.textContent = `Latest modeled delta: ${latest.deltaRaw > 0 ? '+' : ''}${weightLabel(latest.deltaRaw, 2)} (${signLabel}); current load ${latest.loadPct}%.`;
  }
}

function updateGlycogenChart(days) {
  const chart = allCharts.glycogenChart;
  if (!chart) return;
  // Recompute glycogen model for the currently filtered days
  const tdeeEst = window.dashboardData?.bayesian?.tdeePosterior?.mean || _bayesTDEE || 2400;
  const states = glycogenStateModel(days, tdeeEst, GLYCOGEN_MAX_G);
  if (!states.length) return;
  const dxaDates = [DXA_SCAN_PREV.date, DXA_SCAN.date];
  const loadColors = states.map(s =>
    s.loadPct >= 70 ? 'rgba(52,211,153,0.55)' :
    s.loadPct >= 40 ? 'rgba(251,191,36,0.55)' :
                      'rgba(248,113,113,0.55)'
  );
  chart.data.labels = states.map(s => s.date.slice(5));
  chart.data.datasets[0].data = states.map(s => s.loadPct);
  chart.data.datasets[0].pointBackgroundColor = loadColors;
  chart.data.datasets[0].backgroundColor = loadColors;
  chart.data.datasets[0].pointRadius = states.map(s => dxaDates.includes(s.date) ? 8 : 2);
  chart.data.datasets[0].pointStyle = states.map(s => dxaDates.includes(s.date) ? 'triangle' : 'circle');
  chart.options.plugins.tooltip.callbacks.title = ctx => states[ctx[0].dataIndex]?.date || '';
  chart.options.plugins.tooltip.callbacks.label = ctx => {
    if (ctx.dataset.label === '_fill') return null;
    const s = states[ctx.dataIndex];
    if (!s) return '';
    const lines = [
      ` Glycogen: ${s.loadPct}% loaded (${s.glycogenG}g)`,
      ` Bound water: ~${(s.waterG / 453.592).toFixed(2)} lbs`,
      ` Glyco+water mass: ~${s.massLbs} lbs`,
    ];
    if (s.drinkKcal > 0) lines.push(` 🍺 Alcohol: ~${s.drinkKcal} kcal — impaired synthesis + liver depletion applied`);
    if (dxaDates.includes(s.date)) lines.unshift(` 📍 ${s.date === DXA_SCAN_PREV.date ? 'DXA Jan 6' : 'DXA Apr 8'}`);
    return lines;
  };
  chart.update();
  // Update summary note
  const latest = states[states.length - 1];
  const noteEl = document.getElementById('glycogenNote');
  if (noteEl && latest) noteEl.textContent = `Current: ${latest.loadPct}% loaded (~${latest.massLbs} lbs glyco+water)`;
}

function updateBodyCompChart(days) {
  const chart = allCharts.bodyCompChart;
  const bodyComp = bodyCompEstimate(days);
  const fatVals = bodyComp.map(d => weightValue(d.fat));
  const leanVals = bodyComp.map(d => weightValue(d.lean));
  const fatLowVals = bodyComp.map(d => d.measured ? null : weightValue(d.fatLow));
  const fatHighVals = bodyComp.map(d => d.measured ? null : weightValue(d.fatHigh));
  chart.data.labels = bodyComp.map(d => d.date.slice(5));
  chart.data.datasets[0].data = fatHighVals;
  chart.data.datasets[0].pointHoverRadius = 0;
  chart.data.datasets[0].pointHitRadius = 0;
  chart.data.datasets[1].data = fatLowVals;
  chart.data.datasets[1].pointHoverRadius = 0;
  chart.data.datasets[1].pointHitRadius = 0;
  chart.data.datasets[2].data = fatVals;
  chart.data.datasets[2].pointRadius = bodyComp.map(d => d.measured ? 0 : 4);
  chart.data.datasets[3].data = leanVals;
  chart.data.datasets[3].pointRadius = bodyComp.map(d => d.measured ? 0 : 3);
  chart.data.datasets[4].data = bodyComp.map(d => d.measured ? weightValue(d.fat) : null);
  chart.data.datasets[5].data = bodyComp.map(d => d.measured ? weightValue(d.lean) : null);
  const fatBounds = calcAxisBounds([...fatVals, ...fatHighVals.filter(v => v != null)], useMetric ? 1 : 2);
  const leanBounds = calcAxisBounds(leanVals, useMetric ? 1 : 1);
  chart.options.plugins.tooltip.callbacks.title = ctx => bodyComp[ctx[0].dataIndex]?.date || '';
  chart.options.plugins.tooltip.callbacks.label = ctx => {
    const d = bodyComp[ctx.dataIndex];
    if (!d) return '';
    if (ctx.datasetIndex === 2) return ` Est. fat: ${weightLabel(d.fat)} (~${d.bodyFatPct.toFixed(1)}% BF)`;
    if (ctx.datasetIndex === 3) return ` Est. lean: ${weightLabel(d.lean)}`;
    if (ctx.datasetIndex === 4) return ` Measured fat: ${weightLabel(d.fat)} (~${d.bodyFatPct.toFixed(1)}% BF)`;
    return ` Measured lean: ${weightLabel(d.lean)}`;
  };
  chart.options.plugins.tooltip.callbacks.afterBody = ctx => {
    const d = bodyComp[ctx[0].dataIndex];
    if (!d) return [];
    const gs = glycogenByDate[d.date];
    const glycoNote = gs ? `  Glycogen: ${gs.loadPct}% loaded (~${gs.glycogenG}g, +${gs.waterG}g water)` : '';
    if (d.measured) {
      const scanDelta = gs ? (gs.loadPct - glycogenRefState.loadPct).toFixed(1) : null;
      const deltaNote = scanDelta !== null ? `  vs Jan 6 reference: ${scanDelta > 0 ? '+' : ''}${scanDelta}% glycogen load` : '';
      return [` DXA measured point on ${d.scanLabel || d.date}`, ` Total: ${weightLabel(d.weight)}`, glycoNote, deltaNote].filter(Boolean);
    }
    return [
      ` Estimated from DXA baseline`,
      ` Likely BF range: ${d.bodyFatPctLow.toFixed(1)}%–${d.bodyFatPctHigh.toFixed(1)}%`,
      ` Total: ${weightLabel(d.weight)}`,
      glycoNote
    ].filter(Boolean);
  };
  chart.options.interaction = { mode: 'index', intersect: false, axis: 'x' };
  chart.options.scales.y.title.text = `Fat Mass (${weightUnit()})`;
  chart.options.scales.y.ticks.callback = v => `${v} ${weightUnit()}`;
  chart.options.scales.y.min = Math.floor(fatBounds.min);
  chart.options.scales.y.max = Math.ceil(fatBounds.max);
  chart.options.scales.y2.title.text = `Lean Mass (${weightUnit()})`;
  chart.options.scales.y2.ticks.callback = v => `${v} ${weightUnit()}`;
  chart.options.scales.y2.min = Math.floor(leanBounds.min);
  chart.options.scales.y2.max = Math.ceil(leanBounds.max);
  chart.update();

  const latestEstimated = [...bodyComp].reverse().find(d => !d.measured) || [...bodyComp].reverse().find(Boolean);
  const bodyCompRangeNote = document.getElementById('bodyCompRangeNote');
  if (bodyCompRangeNote) {
    bodyCompRangeNote.textContent = latestEstimated
      ? `Latest estimate: ~${latestEstimated.bodyFatPct.toFixed(1)}% body fat, with a likely range of ${latestEstimated.bodyFatPctLow.toFixed(1)}%–${latestEstimated.bodyFatPctHigh.toFixed(1)}% based on the DXA anchor, weigh-ins, lifting, and protein adherence.`
      : 'Latest estimated body fat range will appear here once the selected range has weigh-ins.';
  }
}

function updateCaloriesChart(months) {
  const chart = allCharts.caloriesChart;
  const maxLen = Math.max(...ACTIVE_MONTHS.map(m => (months[m.key]||[]).length), 1);
  chart.data.labels = Array.from({ length: maxLen }, (_, i) => i + 1);
  chart.data.datasets = [
    ...ACTIVE_MONTHS.map(m => ({ label: m.label, data: (months[m.key]||[]).map(d => energyValue(d.calories)), borderColor: m.color, backgroundColor: m.bg, tension:0.3, pointRadius:4, pointHoverRadius:7, fill:false })),
    { label:`Target (${energyLabel(goals.calories)})`, data: Array(maxLen).fill(energyValue(goals.calories)), borderColor:'rgba(251,191,36,0.5)', borderDash:[8,4], pointRadius:0, fill:false, borderWidth:2 }
  ];
  calVisibility.forEach((visible, idx) => { chart.data.datasets[idx].hidden = !visible; });
  const visibleEnergy = ACTIVE_MONTHS.flatMap(m => (months[m.key]||[]).map(d => energyValue(d.calories))).concat([energyValue(goals.calories)]);
  const bounds = calcAxisBounds(visibleEnergy, useMetric ? 400 : 250);
  chart.options.onClick = (evt, elements) => {
    if (!elements.length || elements[0].datasetIndex >= ACTIVE_MONTHS.length) return;
    const month = monthOrder[elements[0].datasetIndex];
    const day = months[month][elements[0].index];
    if (day) openPanel(day.date);
  };
  chart.options.plugins.tooltip.callbacks.label = ctx => ctx.parsed.y == null ? '' : ` ${ctx.dataset.label}: ${energyLabel(useMetric ? ctx.parsed.y / 4.184 : ctx.parsed.y)}`;
  chart.options.scales.y.min = Math.max(0, Math.floor(bounds.min / (useMetric ? 250 : 100)) * (useMetric ? 250 : 100));
  chart.options.scales.y.max = Math.ceil(bounds.max / (useMetric ? 250 : 100)) * (useMetric ? 250 : 100);
  chart.options.scales.y.ticks.stepSize = useMetric ? 500 : 250;
  chart.options.scales.y.ticks.callback = v => `${v.toLocaleString()} ${energyUnit()}`;
  chart.update();
}

function updateWaterfallChart(days) {
  const chart = allCharts.waterfallChart;
  const baseTDEE = workingTDEEProfile(getAnalyticsDays()).maintenance;
  let cum = 0;
  const view = days.map(d => {
    const totalCalories = effectiveCalories(d);
    cum += (baseTDEE - totalCalories);
    return { date: d.date, cum, delta: baseTDEE - totalCalories, calories: d.calories, totalCalories };
  });
  chart.data.labels = view.map(d => d.date.slice(5));
  chart.data.datasets[0].data = view.map(d => energyValue(d.cum));
  chart.data.datasets[0].backgroundColor = view.map(d => d.cum >= 0 ? 'rgba(52,211,153,0.7)' : 'rgba(248,113,113,0.7)');
  chart.data.datasets[1].data = view.map(d => energyValue(d.delta));
  chart.data.datasets[1].pointRadius = view.map(d => Math.abs(d.delta) > 800 ? 5 : 3);
  chart.data.datasets[1].pointBackgroundColor = view.map(d => d.delta >= 0 ? '#34d399' : '#f87171');
  chart.options.onClick = (evt, elements) => { if (elements.length) openPanel(view[elements[0].index].date); };
  chart.options.plugins.tooltip.callbacks.title = ctx => view[ctx[0].dataIndex]?.date || '';
  chart.options.plugins.tooltip.callbacks.label = ctx => {
    const d = view[ctx.dataIndex];
    if (!d) return '';
    if (ctx.datasetIndex === 0) {
      const eqLbs = Math.abs(d.cum) / 3500;
      return [` Cumulative: ${energyLabel(d.cum)}`, ` ≈ ${weightValue(eqLbs)} ${weightUnit()} equivalent`];
    }
    return [` Today: ${energyLabel(d.delta)}`, ` Ate ~${energyLabel(d.totalCalories)} incl. est. drinks vs ~${energyLabel(baseTDEE)} TDEE`];
  };
  chart.options.scales.y.title.text = `Cumulative (${energyUnit()})`;
  chart.options.scales.y.ticks.callback = v => `${v.toLocaleString()} ${energyUnit()}`;
  chart.options.scales.y2.title.text = `Daily (${energyUnit()})`;
  chart.options.scales.y2.ticks.callback = v => `${v > 0 ? '+' : ''}${v.toLocaleString()} ${energyUnit()}`;
  chart.update();
}

function updateMacroChart(months) {
  const chart = allCharts.macroChart;
  const maxLen = Math.max(...ACTIVE_MONTHS.map(m => (months[m.key]||[]).length), 1);
  const bounds = metricBounds[currentMetric];
  chart.data.labels = Array.from({ length: maxLen }, (_, i) => i + 1);
  chart.data.datasets = [
    ...ACTIVE_MONTHS.map(m => ({ label: m.label, data: (months[m.key]||[]).map(d => d[currentMetric]), borderColor: m.color, tension:0.3, pointRadius:4, pointHoverRadius:7, fill:false, borderWidth:2 })),
    { label:`Goal (${goals[currentMetric]}g)`, data:Array(maxLen).fill(goals[currentMetric]), borderColor:'rgba(251,191,36,0.5)', borderDash:[8,4], pointRadius:0, fill:false, borderWidth:2 }
  ];
  macroVisibility.forEach((visible, idx) => { chart.data.datasets[idx].hidden = !visible; });
  chart.options.scales.y.min = bounds.min;
  chart.options.scales.y.max = bounds.max;
  chart.options.scales.y.ticks.stepSize = bounds.step;
  chart.options.onClick = (evt, elements) => {
    if (!elements.length || elements[0].datasetIndex >= ACTIVE_MONTHS.length) return;
    const month = monthOrder[elements[0].datasetIndex];
    const day = months[month][elements[0].index];
    if (day) openPanel(day.date);
  };
  chart.update();
}

function updateMacroStackedChart(days) {
  const chart = allCharts.macroStackedChart;
  const splits = days.map(macroSplitForDay);
  chart.data.labels = days.map(d => d.date.slice(5));
  chart.data.datasets[0].data = splits.map(d => d.proteinPct);
  chart.data.datasets[1].data = splits.map(d => d.carbsPct);
  chart.data.datasets[2].data = splits.map(d => d.fatPct);
  chart.options.plugins.tooltip.callbacks.title = ctx => days[ctx[0].dataIndex]?.date || '';
  chart.options.plugins.tooltip.callbacks.label = ctx => {
    const split = splits[ctx.dataIndex];
    if (!split) return '';
    if (ctx.datasetIndex === 0) return ` Protein: ${split.proteinPct}% (${energyLabel(split.proteinKcal)})`;
    if (ctx.datasetIndex === 1) return ` Carbs: ${split.carbsPct}% (${energyLabel(split.carbsKcal)})`;
    return ` Fat: ${split.fatPct}% (${energyLabel(split.fatKcal)})`;
  };
  chart.options.plugins.tooltip.callbacks.afterBody = ctx => {
    const split = splits[ctx[0].dataIndex];
    return split ? [` Total from macros: ${energyLabel(split.totalKcal)}`] : [];
  };
  chart.options.scales.y.min = 0;
  chart.options.scales.y.max = 100;
  chart.options.scales.y.ticks.stepSize = 10;
  chart.options.scales.y.ticks.callback = v => `${v}%`;
  chart.update();
}

function updateDonutCharts(months) {
  ACTIVE_MONTHS.map(m => ['donut' + m.key, m.key]).forEach(([id, month]) => {
    const chart = Chart.getChart(document.getElementById(id));
    const days = months[month];
    const pCal = avg(days, 'protein') * 4;
    const cCal = avg(days, 'carbs') * 4;
    const fCal = avg(days, 'fat') * 9;
    const total = pCal + cCal + fCal || 1;
    chart.data.labels = [`Protein (${((pCal / total) * 100).toFixed(0)}%)`, `Carbs (${((cCal / total) * 100).toFixed(0)}%)`, `Fat (${((fCal / total) * 100).toFixed(0)}%)`];
    chart.data.datasets[0].data = [energyValue(pCal), energyValue(cCal), energyValue(fCal)];
    chart.options.plugins.tooltip.callbacks.label = ctx => ` ${ctx.label}: ${ctx.parsed.toLocaleString()} ${energyUnit()}`;
    chart.update();
  });
}

function updateSimpleMonthBars(months) {
  const liftingChart = Chart.getChart(document.getElementById('liftingChart'));
  const drinksChart = Chart.getChart(document.getElementById('drinksChart'));
  liftingChart.data.datasets[0].data = ACTIVE_MONTHS.map(m => (months[m.key]||[]).filter(d => d.lifting === 'Y').length);
  drinksChart.data.datasets[0].data = ACTIVE_MONTHS.map(m => (months[m.key]||[]).filter(d => d.drinks).length);
  liftingChart.update();
  drinksChart.update();
}

function updateLiftRestChart(days) {
  const chart = allCharts.liftRestChart;
  const lift = days.filter(d => d.lifting === 'Y');
  const rest = days.filter(d => d.lifting !== 'Y');
  const rows = liftRestDeltaRows(days);
  chart.data.labels = rows.map(r => r.label);
  chart.data.datasets[0].label = `Lift vs Rest (lift n=${lift.length}, rest n=${rest.length})`;
  chart.data.datasets[0].data = rows.map(r => liftRestDisplayDelta(r.pctDelta));
  chart.data.datasets[0].backgroundColor = rows.map(r => r.pctDelta > 0 ? 'rgba(245,158,11,0.75)' : r.pctDelta < 0 ? 'rgba(248,113,113,0.75)' : 'rgba(148,163,184,0.7)');
  const bounds = calcAxisBounds(rows.map(r => r.pctDelta), 6);
  chart.options.plugins.tooltip.callbacks.label = ctx => {
    const row = rows[ctx.dataIndex];
    return ` Lift vs rest: ${row.pctDelta > 0 ? '+' : ''}${row.pctDelta}%`;
  };
  chart.options.plugins.tooltip.callbacks.afterBody = ctx => {
    const row = rows[ctx[0].dataIndex];
    return [
      ` Lift days: ${row.liftValue.toLocaleString()} ${row.unit}`,
      ` Rest days: ${row.restValue.toLocaleString()} ${row.unit}`,
      ` Raw delta: ${row.deltaRaw > 0 ? '+' : ''}${row.deltaRaw.toLocaleString()} ${row.unit}`
    ];
  };
  chart.options.scales.x.min = Math.min(-5, Math.floor(bounds.min / 5) * 5);
  chart.options.scales.x.max = Math.max(5, Math.ceil(bounds.max / 5) * 5);
  chart.update();
}

function updateAdherenceChart(days) {
  const chart = allCharts.adherenceChart;
  const adh = rollingAdherence(days);
  if (adh) {
    chart.data.labels = adh.labels;
    chart.data.datasets[0].data = adh.calHit;
    chart.data.datasets[1].data = adh.proHit;
  } else {
    chart.data.labels = [];
    chart.data.datasets[0].data = [];
    chart.data.datasets[1].data = [];
  }
  chart.update();
}

function renderDeficitLagInsight(days) {
  const el = document.getElementById('deficitLagInsight');
  if (!el) return;
  const lag = deficitToScaleLag(days);
  if (!lag) { el.innerHTML = ''; return; }
  const peak = lag.strongest;
  // Convert r to a "signal strength" 0–100 for intuition (|r| of 0.3+ is strong for noisy bio data)
  const strength = Math.min(100, Math.round(Math.abs(peak.r) / 0.3 * 100));
  const strengthLabel = strength >= 80 ? 'Strong' : strength >= 40 ? 'Moderate' : 'Weak';
  const strengthColor = strength >= 80 ? 'var(--col-green)' : strength >= 40 ? 'var(--col-amber)' : 'var(--col-red)';

  // Build a simple timeline visualization
  const dotsHtml = lag.lags.map(l => {
    const isStrongest = l.lag === peak.lag;
    const opacity = Math.max(0.15, Math.abs(l.r) / 0.3);
    const size = isStrongest ? 32 : 20;
    const bg = isStrongest ? 'rgba(251,191,36,0.9)' : `rgba(100,116,139,${opacity})`;
    const border = isStrongest ? '2px solid rgba(251,191,36,1)' : '2px solid transparent';
    const labelColor = isStrongest ? '#fbbf24' : 'var(--text-faint)';
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
      <div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};border:${border};"></div>
      <span style="font-size:11px;color:${labelColor};font-weight:${isStrongest ? '600' : '400'};">${l.lag}d</span>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="padding:14px 16px;border-radius:10px;background:var(--card-bg);font-size:13px;">
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:10px;">
        <strong>When does a deficit show on the scale?</strong>
        <span style="color:${strengthColor};font-size:12px;">${strengthLabel} signal</span>
      </div>
      <div style="display:flex;align-items:center;gap:2px;margin-bottom:8px;">
        <span style="font-size:11px;color:var(--text-faint);margin-right:6px;">Deficit day</span>
        <div style="flex:1;display:flex;align-items:center;justify-content:space-around;position:relative;">
          <div style="position:absolute;top:50%;left:0;right:0;height:2px;background:var(--border);transform:translateY(-50%);z-index:0;"></div>
          ${dotsHtml}
        </div>
        <span style="font-size:11px;color:var(--text-faint);margin-left:6px;">Scale</span>
      </div>
      <div style="font-size:12px;color:var(--text-muted);">Your deficit takes about <strong>${peak.lag} day${peak.lag > 1 ? 's' : ''}</strong> to show up on the scale. Don't read too much into weigh-ins sooner than that.</div>
    </div>`;
}

function updateFoodFreqChart(days) {
  const chart = allCharts.foodFreqChart;
  const foodFreqs = foodFrequency(days).slice(0, 20);
  const prevDays = getPreviousPeriodDays();
  const prevFoodMap = {};
  if (prevDays.length) {
    foodFrequency(prevDays).forEach(([food, count]) => { prevFoodMap[food] = count; });
  }

  // Compute average calorie day when each food appears
  const foodCalAssoc = {};
  foodFreqs.forEach(([food]) => {
    const daysWithFood = days.filter(d => d.notes && d.notes.toLowerCase().includes(food.toLowerCase()));
    const daysWithoutFood = days.filter(d => !d.notes || !d.notes.toLowerCase().includes(food.toLowerCase()));
    foodCalAssoc[food] = {
      withAvg: daysWithFood.length ? Math.round(daysWithFood.reduce((s, d) => s + d.calories, 0) / daysWithFood.length) : 0,
      withoutAvg: daysWithoutFood.length ? Math.round(daysWithoutFood.reduce((s, d) => s + d.calories, 0) / daysWithoutFood.length) : 0,
      count: daysWithFood.length
    };
  });

  chart.data.labels = foodFreqs.map(f => f[0].length > 30 ? f[0].slice(0, 28) + '…' : f[0]);
  chart.data.datasets[0].data = foodFreqs.map(f => f[1]);
  chart.data.datasets[0].backgroundColor = foodFreqs.map(f => isFoodProteinRich(f[0]) ? 'rgba(245,158,11,0.7)' : 'rgba(100,116,139,0.5)');
  chart.data.datasets[0].label = 'Current Range';

  // Add or update comparison dataset
  if (prevDays.length && chart.data.datasets.length < 2) {
    chart.data.datasets.push({
      label: 'Prior Period',
      data: [],
      backgroundColor: 'rgba(148,163,184,0.3)',
      borderColor: 'rgba(148,163,184,0.6)',
      borderWidth: 1
    });
  }
  if (prevDays.length && chart.data.datasets.length >= 2) {
    chart.data.datasets[1].data = foodFreqs.map(([food]) => prevFoodMap[food] || 0);
  } else if (chart.data.datasets.length >= 2) {
    chart.data.datasets.splice(1);
  }

  chart.options.plugins.tooltip.callbacks.label = ctx => {
    const food = foodFreqs[ctx.dataIndex]?.[0];
    if (!food) return '';
    if (ctx.datasetIndex === 1) {
      const prevCount = prevFoodMap[food] || 0;
      return ` Prior period: ${prevCount} times in ${prevDays.length} days`;
    }
    const assoc = foodCalAssoc[food];
    const prevCount = prevFoodMap[food] || 0;
    const delta = prevDays.length ? ` (${ctx.parsed.x - prevCount >= 0 ? '+' : ''}${ctx.parsed.x - prevCount} vs prior)` : '';
    return [
      ` ${ctx.parsed.x} times in ${days.length} days${delta}`,
      ` Avg cal when eaten: ${energyLabel(assoc.withAvg)}`,
      ` Avg cal otherwise: ${energyLabel(assoc.withoutAvg)}`,
      ` Δ ${assoc.withAvg - assoc.withoutAvg > 0 ? '+' : ''}${energyLabel(assoc.withAvg - assoc.withoutAvg)}`
    ];
  };
  chart.update();
}

function updateSleepCharts(days) {
  const recoveryChart = allCharts.recoveryChart;
  const scores = days.map(d => recoveryScore(d));
  recoveryChart.data.labels = days.map(d => d.date.slice(5));
  recoveryChart.data.datasets[0].data = scores;
  recoveryChart.data.datasets[0].pointRadius = scores.map(s => s < 30 || s > 75 ? 6 : 3);
  recoveryChart.data.datasets[0].pointBackgroundColor = scores.map(s => perfColor(s));
  recoveryChart.data.datasets[1].data = rollingAvg(scores, 7);
  recoveryChart.options.onClick = (evt, elements) => { if (elements.length) openPanel(days[elements[0].index].date); };
  recoveryChart.options.plugins.tooltip.callbacks.title = ctx => days[ctx[0].dataIndex]?.date || '';
  recoveryChart.options.plugins.tooltip.callbacks.label = ctx => {
    if (ctx.datasetIndex === 1) return ` 7d avg: ${ctx.parsed.y.toFixed(0)}`;
    const d = days[ctx.dataIndex];
    const prev = prevDay(d.date);
    return [` Recovery: ${ctx.parsed.y}`, ` Sleep: ${d.perf}% perf, ${d.hours}h`, drinkDates.has(prev) ? ' 🍹 drank prev night' : ''];
  };
  recoveryChart.update();

  const sleepPerfChart = allCharts.sleepPerfChart;
  sleepPerfChart.data.labels = days.map(d => d.date.slice(5));
  sleepPerfChart.data.datasets[0].data = days.map(d => d.perf);
  sleepPerfChart.data.datasets[0].backgroundColor = days.map(d => perfColor(d.perf, 0.8));
  sleepPerfChart.options.onClick = (evt, elements) => { if (elements.length) openPanel(days[elements[0].index].date); };
  sleepPerfChart.options.plugins.tooltip.callbacks.title = ctx => days[ctx[0].dataIndex]?.date || '';
  sleepPerfChart.options.plugins.tooltip.callbacks.label = ctx => {
    const d = days[ctx.dataIndex];
    return [` Performance: ${d.perf}%`, ` Sleep: ${d.hours}h  Bedtime: ${d.bedtime}${drinkDates.has(prevDay(d.date)) ? ' 🍹 prev night' : ''}`];
  };
  sleepPerfChart.update();

  const sleepDurChart = allCharts.sleepDurChart;
  sleepDurChart.data.labels = days.map(d => d.date.slice(5));
  sleepDurChart.data.datasets[0].data = days.map(d => d.hours);
  sleepDurChart.data.datasets[0].pointBackgroundColor = days.map(d => perfColor(d.perf));
  sleepDurChart.options.onClick = (evt, elements) => { if (elements.length) openPanel(days[elements[0].index].date); };
  sleepDurChart.options.plugins.tooltip.callbacks.label = ctx => ` ${ctx.parsed.y.toFixed(1)}h sleep — ${days[ctx.dataIndex].perf}% performance`;
  sleepDurChart.update();

  const sleepStagesChart = Chart.getChart(document.getElementById('sleepStagesChart'));
  sleepStagesChart.data.labels = days.map(d => d.date.slice(5));
  sleepStagesChart.data.datasets[0].data = days.map(d => d.deep);
  sleepStagesChart.data.datasets[1].data = days.map(d => d.rem);
  sleepStagesChart.data.datasets[2].data = days.map(d => d.light);
  sleepStagesChart.update();

  const debtChart = allCharts.sleepDebtChart;
  const debt = sleepDebt(days);
  debtChart.data.labels = debt.map(d => d.date.slice(5));
  debtChart.data.datasets[0].data = debt.map(d => +d.debt.toFixed(1));
  debtChart.update();
}

function updateInsightCharts(days) {
  const afterDrink = [];
  const afterClean = [];
  days.forEach(d => {
    if (drinkDates.has(prevDay(d.date))) afterDrink.push(d.perf);
    else afterClean.push(d.perf);
  });
  const drinkSleepChart = Chart.getChart(document.getElementById('drinkSleepChart'));
  const avgAfterDrink = afterDrink.length ? +(afterDrink.reduce((a, b) => a + b, 0) / afterDrink.length).toFixed(1) : 0;
  const avgAfterClean = afterClean.length ? +(afterClean.reduce((a, b) => a + b, 0) / afterClean.length).toFixed(1) : 0;
  drinkSleepChart.data.labels = [`After Drink (n=${afterDrink.length})`, `After Clean (n=${afterClean.length})`];
  drinkSleepChart.data.datasets[0].data = [avgAfterDrink, avgAfterClean];
  drinkSleepChart.update();

  const dowChart = Chart.getChart(document.getElementById('dowChart'));
  const dowAvg = dayOfWeekAverages(days);
  dowChart.data.datasets[0].data = dowAvg;
  dowChart.data.datasets[0].backgroundColor = dowAvg.map(v => perfColor(v, 0.8));
  dowChart.update();

  const bedtimeChart = Chart.getChart(document.getElementById('bedtimeSleepScatter'));
  const bedtimePoints = days.map(d => {
    const hour = d.bedtime_hour > 12 ? d.bedtime_hour - 24 : d.bedtime_hour;
    return { x: hour, y: d.perf, date: d.date, bedtime: d.bedtime };
  });
  bedtimeChart.data.datasets[0].data = bedtimePoints.map(p => ({ x: p.x, y: p.y }));
  bedtimeChart.data.datasets[0].backgroundColor = bedtimePoints.map(p => perfColor(p.y, 0.7));
  bedtimeChart.options.plugins.tooltip.callbacks.label = ctx => {
    const p = bedtimePoints[ctx.dataIndex];
    return [` ${p.date}`, ` Bedtime: ${p.bedtime}`, ` Sleep: ${p.y}%`];
  };
  bedtimeChart.update();

  const bucketChart = Chart.getChart(document.getElementById('bedtimeBucketChart'));
  const buckets = bedtimeBuckets(days);
  bucketChart.data.labels = buckets.map(b => b.label);
  bucketChart.data.datasets[0].data = buckets.map(b => b.value);
  bucketChart.update();

  const respChart = Chart.getChart(document.getElementById('respRateChart'));
  respChart.data.labels = days.map(d => d.date.slice(5));
  respChart.data.datasets[0].data = days.map(d => d.resp);
  respChart.update();

  const calSleepChart = Chart.getChart(document.getElementById('calSleepScatterChart'));
  const scatter = days.map(d => {
    const nextMacro = macroByDate[nextDayStr(d.date)];
    return nextMacro ? { x: energyValue(nextMacro.calories), y: d.perf, date: d.date, nextDate: nextMacro.date } : null;
  }).filter(Boolean);
  calSleepChart.data.datasets[0].data = scatter.map(p => ({ x: p.x, y: p.y }));
  calSleepChart.data.datasets[0].backgroundColor = scatter.map(p => perfColor(p.y, 0.7));
  calSleepChart.options.plugins.tooltip.callbacks.label = ctx => {
    const p = scatter[ctx.dataIndex];
    return [` Sleep: ${p.date}`, ` Next-day calories (${p.nextDate}): ${p.x.toLocaleString()} ${energyUnit()}`, ` Sleep: ${p.y}%`];
  };
  calSleepChart.options.scales.x.title.text = `Calories (${energyUnit()})`;
  calSleepChart.options.scales.x.ticks.callback = v => `${v.toLocaleString()} ${energyUnit()}`;
  calSleepChart.update();

  const annotatedChart = Chart.getChart(document.getElementById('sleepAnnotatedChart'));
  annotatedChart.data.labels = days.map(d => d.date.slice(5));
  annotatedChart.data.datasets[0].data = days.map(d => d.perf);
  annotatedChart.data.datasets[0].pointRadius = days.map(d => drinkDates.has(prevDay(d.date)) || liftDates.has(d.date) ? 7 : 3);
  annotatedChart.data.datasets[0].pointStyle = days.map(d => {
    if (drinkDates.has(prevDay(d.date))) return 'triangle';
    if (liftDates.has(d.date)) return 'rectRot';
    return 'circle';
  });
  annotatedChart.data.datasets[0].pointBackgroundColor = days.map(d => {
    if (drinkDates.has(prevDay(d.date))) return EVENT_COLORS.drink;
    if (liftDates.has(d.date)) return EVENT_COLORS.lift;
    return EVENT_COLORS.normal;
  });
  annotatedChart.data.datasets[0].pointBorderColor = days.map(d => drinkDates.has(prevDay(d.date)) || liftDates.has(d.date) ? 'rgba(15,17,23,0.85)' : 'transparent');
  annotatedChart.data.datasets[0].pointBorderWidth = days.map(d => drinkDates.has(prevDay(d.date)) || liftDates.has(d.date) ? 1.5 : 0);
  annotatedChart.options.plugins.tooltip.callbacks.title = ctx => days[ctx[0].dataIndex]?.date || '';
  annotatedChart.options.plugins.tooltip.callbacks.label = ctx => {
    const d = days[ctx.dataIndex];
    const flags = [];
    if (drinkDates.has(prevDay(d.date))) flags.push('🍹 drank prev');
    if (liftDates.has(d.date)) flags.push('🏋️ lifted');
    return [` Perf: ${d.perf}%  Sleep: ${d.hours}h`, ...flags];
  };
  annotatedChart.update();
}

function updateStepsChart(days) {
  const chart = allCharts.stepsChart;
  if (!chart) return;
  const stats = stepStats(days);
  if (!stats) {
    chart.data.labels = [];
    chart.data.datasets[0].data = [];
    chart.data.datasets[0].backgroundColor = [];
    chart.data.datasets[1].data = [];
    chart.update();
    return;
  }
  chart.data.labels = stats.allLabels;
  chart.data.datasets[0].data = stats.allSteps;
  chart.data.datasets[0].backgroundColor = stats.allSteps.map(s =>
    s >= stats.goalSteps ? 'rgba(52,211,153,0.65)' : 'rgba(100,116,139,0.45)'
  );
  chart.data.datasets[1].data = [...Array(6).fill(null), ...stats.rollingAvg];
  chart.update();
  // Update step stat cards
  const el = document.getElementById('stepStatCards');
  if (el) {
    const trendArrow = stats.trendPerWeek > 200 ? '↑' : stats.trendPerWeek < -200 ? '↓' : '→';
    const trendColor = stats.trendPerWeek > 200 ? 'var(--col-green)' : stats.trendPerWeek < -200 ? 'var(--col-red)' : 'var(--col-amber)';
    el.innerHTML = `
      <div class="stat-card"><div class="stat-value">${stats.avg.toLocaleString()}</div><div class="stat-label">Avg steps/day</div></div>
      <div class="stat-card"><div class="stat-value">${stats.goalHit}%</div><div class="stat-label">Days ≥ 8k steps</div></div>
      <div class="stat-card"><div class="stat-value">${stats.max.toLocaleString()}</div><div class="stat-label">Best day</div></div>
      <div class="stat-card"><div class="stat-value" style="color:${trendColor}">${trendArrow} ${Math.abs(stats.trendPerWeek).toLocaleString()}</div><div class="stat-label">Trend (steps/wk)</div></div>
    `;
  }
}

function renderStepsCorrelations(days) {
  const el = document.getElementById('stepsCorrelationInsight');
  if (!el) return;
  const corr = stepsCorrelations(days);
  if (!corr || corr.n_sleep < 5) { el.innerHTML = ''; return; }
  const fmtR = r => r == null ? '—' : (r > 0 ? '+' : '') + r.toFixed(2);
  const rColor = r => r == null ? 'var(--text-faint)' : Math.abs(r) >= 0.2 ? (r > 0 ? 'var(--col-green)' : 'var(--col-red)') : 'var(--col-amber)';

  const badges = [];

  // Steps ↔ sleep
  if (corr.r_sleep != null) {
    const dir = corr.r_sleep > 0 ? 'more steps → better sleep' : 'more steps → worse sleep';
    const strength = Math.abs(corr.r_sleep) >= 0.3 ? 'Strong' : Math.abs(corr.r_sleep) >= 0.1 ? 'Weak' : 'No';
    badges.push(`<div class="insight-badge" title="Pearson r = ${fmtR(corr.r_sleep)} across ${corr.n_sleep} nights">
      <span class="badge-icon">👣</span>
      <span><strong style="color:${rColor(corr.r_sleep)}">${strength} link: ${dir}</strong>
      ${corr.highSleepAvg != null && corr.lowSleepAvg != null
        ? ` — high-step days: ${corr.highSleepAvg}% sleep vs low-step: ${corr.lowSleepAvg}%`
        : ''} <span style="color:var(--text-faint);font-size:11px;">(r = ${fmtR(corr.r_sleep)})</span>
      </span>
    </div>`);
  }

  // Steps ↔ next-day weight
  if (corr.r_weight != null) {
    const dir = corr.r_weight < 0 ? 'more steps → lower next-day weight' : 'more steps → higher next-day weight';
    const strength = Math.abs(corr.r_weight) >= 0.2 ? 'Notable' : 'Weak';
    badges.push(`<div class="insight-badge" title="Pearson r = ${fmtR(corr.r_weight)} across ${corr.n_weight} transitions">
      <span class="badge-icon">⚖️</span>
      <span><strong style="color:${rColor(corr.r_weight)}">${strength}: ${dir}</strong>
      <span style="color:var(--text-faint);font-size:11px;">(r = ${fmtR(corr.r_weight)}, n=${corr.n_weight})</span>
      </span>
    </div>`);
  }

  // Step-adjusted TDEE note — use last day of filtered range (already ≤ yesterday)
  if (corr.avgSteps != null) {
    const lastDay = days[days.length - 1];
    const baseTDEE = workingTDEEProfile(getAnalyticsDays()).maintenance;
    const adjustedTDEE = lastDay ? stepAdjustedTDEE(baseTDEE, lastDay.date) : null;
    const delta = adjustedTDEE != null ? adjustedTDEE - baseTDEE : null;
    if (delta != null && Math.abs(delta) > 20) {
      badges.push(`<div class="insight-badge">
        <span class="badge-icon">🔥</span>
        <span><strong>Step-adjusted TDEE (${lastDay.date.slice(5)}): ~${energyLabel(adjustedTDEE)}</strong>
        — ${delta > 0 ? '+' : ''}${Math.round(delta)} ${energyUnit()} vs base estimate (avg ${corr.avgSteps.toLocaleString()} steps/day)
        </span>
      </div>`);
    }
  }

  el.innerHTML = badges.length ? badges.join('') : '';
}

function refreshDashboard() {
  let usingFallback = false;
  let filteredDays = getFilteredDays();
  let filteredSleep = getFilteredSleep();
  if (!filteredDays.length) {
    suppressEventFilter = true;
    filteredDays = getFilteredDays();
    filteredSleep = getFilteredSleep();
    usingFallback = true;
  }
  const previousDays = getPreviousPeriodDays();
  const months = monthBuckets(filteredDays);
  const metricLabels = { protein: 'Daily Protein (g)', carbs: 'Daily Carbs (g)', fat: 'Daily Fat (g)' };
  document.getElementById('macroChartTitle').textContent = metricLabels[currentMetric];
  document.getElementById('headerSubtitle').innerHTML = `${currentRangeLabel()} &nbsp;|&nbsp; ${filteredDays.length} tracked days &nbsp;|&nbsp; ${filterLabel()} &nbsp;|&nbsp; compared with ${previousDays.length || 0} prior days from ${compareModeLabel()} &nbsp;|&nbsp; Click any data point for details`;
  document.getElementById('controlSummary').textContent = usingFallback
    ? `No entries matched ${filterLabel()} inside this date range, so the dashboard is temporarily showing the full selected range. Comparison still uses ${compareModeLabel()}.`
    : `Showing ${filterLabel()} in the selected range and comparing against ${compareModeLabel()}.`;
  function safe(fn, label) { try { fn(); } catch (e) { console.error(`[Dashboard] ${label} failed:`, e); } }
  safe(() => renderExecutiveSummary(), 'Executive Summary');
  safe(() => renderStatCards(), 'Stat Cards');
  safe(() => renderHighlights(), 'Highlights');
  safe(() => renderSleepStatCards(), 'Sleep Stat Cards');
  safe(() => renderWeeklyReport(), 'Weekly Report');
  safe(() => renderSleepInsights(), 'Sleep Insights');
  safe(() => renderHeatmap(), 'Heatmap');
  if (activeTab === 'explore') {
    safe(() => renderCorrMatrix(), 'Correlation Matrix');
    safe(() => renderExploreDiagnostics(), 'Explore Diagnostics');
  } else {
    _exploreDirty = true;
  }
  safe(() => updateWeightChart(filteredDays), 'Weight Chart');
  safe(() => updateAdjustedWeightViewChart(filteredDays), 'Adjusted Weight View');
  safe(() => updateBodyCompChart(filteredDays), 'Body Comp Chart');
  safe(() => updateGlycogenChart(filteredDays), 'Glycogen Chart');
  safe(() => updateCaloriesChart(months), 'Calories Chart');
  safe(() => updateWaterfallChart(filteredDays), 'Waterfall Chart');
  // Update TDEE display
  {
    const overallProfile = workingTDEEProfile(getAnalyticsDays());
    const cuttingProfile = workingTDEEProfile(getAnalyticsDays().filter(d => !isInDietBreak(d.date)));
    const usingBayes = overallProfile.source === 'bayesian';
    const activeRange = usingBayes
      ? { low: overallProfile.rangeLow, high: overallProfile.rangeHigh }
      : {
          low: Math.min(overallProfile.rangeLow, cuttingProfile.rangeLow),
          high: Math.max(overallProfile.rangeHigh, cuttingProfile.rangeHigh)
        };
    document.getElementById('waterfallTitle').textContent = usingBayes
      ? `Cumulative Calorie Deficit (Bayesian TDEE: ~${energyLabel(overallProfile.maintenance)}, 68% range: ${energyLabel(activeRange.low)}–${energyLabel(activeRange.high)}, cutting-phase fallback: ~${energyLabel(cuttingProfile.maintenance)})`
      : `Cumulative Calorie Deficit (TDEE: ~${energyLabel(overallProfile.maintenance)}, cutting phase: ~${energyLabel(cuttingProfile.maintenance)}, range: ${energyLabel(activeRange.low)}–${energyLabel(activeRange.high)})`;
  }
  safe(() => updateMacroChart(months), 'Macro Chart');
  safe(() => updateMacroStackedChart(filteredDays), 'Macro Stacked Chart');
  safe(() => updateDonutCharts(months), 'Donut Charts');
  safe(() => updateSimpleMonthBars(months), 'Month Bars');
  safe(() => updateLiftRestChart(filteredDays), 'Lift/Rest Chart');
  safe(() => updateAdherenceChart(filteredDays), 'Adherence Chart');
  safe(() => renderDeficitLagInsight(filteredDays), 'Deficit Lag');
  safe(() => updateStepsChart(filteredDays), 'Steps Chart');
  safe(() => renderStepsCorrelations(filteredDays), 'Steps Correlations');
  safe(() => updateFoodFreqChart(filteredDays), 'Food Freq Chart');
  safe(() => updateSleepCharts(filteredSleep), 'Sleep Charts');
  safe(() => updateInsightCharts(filteredSleep), 'Insight Charts');
  attachChartZoomHandlers();
  const scenarioDefaults = getScenarioDefaults(getRangeDays(), getSleepForDaysUnfiltered(getRangeDays()));
  if (!scenarioFormInitialized) {
    setScenarioInputs(scenarioDefaults.current);
    scenarioPreset = 'current';
    scenarioFormInitialized = true;
  } else if (scenarioPreset && scenarioDefaults[scenarioPreset]) {
    setScenarioInputs(scenarioDefaults[scenarioPreset]);
  }
  syncScenarioPresetButtons();
  runScenarioPlanner();
  syncControlsFromState();
  suppressEventFilter = false;
}

// =====================================================================
// INIT
// =====================================================================
document.title = `Macros/Sleep Dashboard · Build ${BUILD_VERSION}`;
document.getElementById('buildStamp').textContent = `Build ${BUILD_VERSION}`;
attachChartZoomHandlers();
renderAnnotations();
syncSettingsForm();
applyTheme(themePreference);
rangeStartEl.max = Math.max(0, allDates.length - 1);
rangeEndEl.max = Math.max(0, allDates.length - 1);
if (typeof persistedState.rangeStart === 'number') rangeStartEl.value = persistedState.rangeStart;
if (typeof persistedState.rangeEnd === 'number') {
  const persistedEndDate = allDates[persistedState.rangeEnd] || null;
  rangeEndEl.value = persistedEndDate === LEGACY_DEFAULT_RANGE_END ? defaultEndIdx : persistedState.rangeEnd;
} else {
  rangeEndEl.value = defaultEndIdx;
}
if (typeof persistedState.compareMode === 'string') compareMode = persistedState.compareMode;
if (typeof persistedState.eventFilter === 'string') eventFilter = persistedState.eventFilter;
if (typeof persistedState.activeTab === 'string') activeTab = persistedState.activeTab;
updateRangeLabels();
applyActiveTab();
syncResponsiveLayout(true);
responsiveLayoutInitialized = true;
document.querySelectorAll('#mobileControlShell, .advanced-shell, .explore-module').forEach(shell => {
  if (!shell) return;
  shell.addEventListener('toggle', () => {
    if (!responsiveLayoutInitialized) return;
    shell.dataset.userToggled = 'true';
  });
});
document.querySelectorAll('.mobile-detail-shell').forEach(shell => {
  shell.addEventListener('toggle', () => {
    if (!responsiveLayoutInitialized) return;
    shell.dataset.userToggled = 'true';
  });
});
window.addEventListener('resize', () => syncResponsiveLayout());
window.addEventListener('scroll', () => {
  document.getElementById('backToTopBtn').classList.toggle('show', window.scrollY > 640);
});

// =====================================================================
// DATA ENTRY
// =====================================================================
const DATA_STORAGE_KEY = 'macros_dashboard_v4_custom_data';

function loadCustomData() {
  try { return JSON.parse(localStorage.getItem(DATA_STORAGE_KEY) || '{"macro":[],"sleep":[]}'); }
  catch { return { macro: [], sleep: [] }; }
}

function saveCustomData(cd) {
  localStorage.setItem(DATA_STORAGE_KEY, JSON.stringify(cd));
}

function injectCustomData() {
  const cd = loadCustomData();
  const hasCustomData = !!(cd.macro.length || cd.sleep.length);
  cd.macro.forEach(entry => {
    const month = monthKey(entry.date);
    if (!data[month].find(d => d.date === entry.date)) {
      data[month].push(entry);
      data[month].sort((a, b) => a.date.localeCompare(b.date));
    }
  });
  cd.sleep.forEach(entry => {
    if (!sleepData.find(d => d.date === entry.date)) {
      sleepData.push(entry);
      sleepData.sort((a, b) => a.date.localeCompare(b.date));
    }
  });
  // Rebuild derived structures
  rebuildDerivedData({ invalidateBayes: hasCustomData });
}

function rebuildDerivedData({ invalidateBayes = false } = {}) {
  allDays.length = 0;
  ACTIVE_MONTHS.forEach(m => data[m.key].forEach(d => allDays.push(d)));
  allDates.length = 0;
  allDays.forEach(d => allDates.push(d.date));
  Object.keys(macroByDate).forEach(k => delete macroByDate[k]);
  allDays.forEach(d => macroByDate[d.date] = d);
  drinkDates.clear();
  liftDates.clear();
  allDays.forEach(d => { if (d.drinks) drinkDates.add(d.date); if (d.lifting === 'Y') liftDates.add(d.date); });
  clearAnalyticsCaches();
  if (invalidateBayes && window.dashboardData?.bayesian) delete window.dashboardData.bayesian;
  // Update range slider max
  const rangeStartEl = document.getElementById('rangeStart');
  const rangeEndEl = document.getElementById('rangeEnd');
  const maxIdx = maxAnalyticsIndex();
  if (rangeStartEl) rangeStartEl.max = maxIdx;
  if (rangeEndEl) { rangeEndEl.max = maxIdx; rangeEndEl.value = maxIdx; }
  rangeEndIdx = maxIdx;
}

function parseBedtimeHour(bedtime) {
  const m = bedtime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return 2;
  let hour = parseInt(m[1], 10) % 12;
  if (m[3].toUpperCase() === 'PM') hour += 12;
  return hour + parseInt(m[2], 10) / 60;
}

function openDataEntry() {
  document.getElementById('dataEntryModal').style.display = '';
  document.getElementById('dataEntryOverlay').classList.add('show');
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('deDate').value = today;
  document.getElementById('deMsg').className = 'de-msg';
  document.getElementById('deMsg').textContent = '';
}

function closeDataEntry() {
  document.getElementById('dataEntryModal').style.display = 'none';
  document.getElementById('dataEntryOverlay').classList.remove('show');
}

document.getElementById('dataEntryBtn').addEventListener('click', openDataEntry);
document.getElementById('deCancelBtn').addEventListener('click', closeDataEntry);
document.getElementById('dataEntryOverlay').addEventListener('click', closeDataEntry);

document.querySelectorAll('.de-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.de-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.de-section').forEach(s => s.classList.remove('active'));
    tab.classList.add('active');
    const sectionMap = { form: 'deFormSection', csv: 'deCsvSection', file: 'deFileSection' };
    document.getElementById(sectionMap[tab.dataset.de]).classList.add('active');
    const labelMap = { form: 'Save Entry', csv: 'Import CSV', file: 'Import Files' };
    document.getElementById('deSaveBtn').textContent = labelMap[tab.dataset.de];
  });
});

document.getElementById('deCsvInput').addEventListener('input', () => {
  const lines = document.getElementById('deCsvInput').value.trim().split('\n').filter(Boolean);
  if (!lines.length) { document.getElementById('deCsvPreview').innerHTML = ''; return; }
  const cols = ['date','protein','carbs','fat','calories','weight','lifting','drinks','notes'];
  let html = '<table><tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr>';
  lines.slice(0, 10).forEach(line => {
    const parts = line.split(',').map(s => s.trim());
    html += '<tr>' + cols.map((_, i) => `<td>${parts[i] || ''}</td>`).join('') + '</tr>';
  });
  if (lines.length > 10) html += `<tr><td colspan="${cols.length}" style="text-align:center;">...and ${lines.length - 10} more rows</td></tr>`;
  html += '</table>';
  document.getElementById('deCsvPreview').innerHTML = html;
});

// ===== File import helpers =====
function parseXlsxMacros(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const macroEntries = [];
  // Look for sheets ending in "Macros"
  const macroSheets = wb.SheetNames.filter(n => /macros/i.test(n));
  macroSheets.forEach(sheetName => {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
    rows.forEach(row => {
      // First column is the date (unnamed or various names)
      const dateKey = Object.keys(row).find(k => /unnamed|date/i.test(k)) || Object.keys(row)[0];
      let dateVal = row[dateKey];
      if (!dateVal) return;
      // Handle Excel date objects
      if (dateVal instanceof Date) {
        dateVal = dateVal.toISOString().slice(0, 10);
      } else if (typeof dateVal === 'number') {
        // Excel serial date
        const d = new Date((dateVal - 25569) * 86400 * 1000);
        dateVal = d.toISOString().slice(0, 10);
      } else {
        dateVal = String(dateVal).slice(0, 10);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) return;

      const protein = +row.protein || 0;
      const carbs = +row.carbs || 0;
      const fat = +row.fat || 0;
      const calories = +row.calories || 0;
      if (!calories && !protein) return; // skip empty rows

      const liftKey = Object.keys(row).find(k => /lifting/i.test(k));
      const drinkKey = Object.keys(row).find(k => /drink/i.test(k));
      const weightKey = Object.keys(row).find(k => /weight/i.test(k));
      const notesKey = Object.keys(row).find(k => /notes/i.test(k) && !/unnamed/i.test(k));

      macroEntries.push({
        date: dateVal,
        protein, carbs, fat, calories,
        weight: weightKey && row[weightKey] != null && row[weightKey] !== '' ? +row[weightKey] : null,
        lifting: liftKey && row[liftKey] && String(row[liftKey]).toUpperCase() === 'Y' ? 'Y' : null,
        drinks: drinkKey && row[drinkKey] ? String(row[drinkKey]) : null,
        notes: notesKey && row[notesKey] ? String(row[notesKey]) : ''
      });
    });
  });
  return macroEntries;
}

function parseSleepCsv(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());

  const colIdx = (pattern) => headers.findIndex(h => pattern.test(h));
  const iCycleStart = colIdx(/cycle start time/i);
  const iPerf = colIdx(/sleep performance/i);
  const iResp = colIdx(/respiratory rate/i);
  const iAsleep = colIdx(/asleep duration/i);
  const iLight = colIdx(/light sleep/i);
  const iDeep = colIdx(/deep.*duration/i);
  const iRem = colIdx(/rem.*duration/i);
  const iEfficiency = colIdx(/sleep efficiency/i);
  const iNap = colIdx(/nap/i);

  const entries = [];
  const seen = new Set();

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(s => s.trim());
    // Skip naps
    if (iNap >= 0 && cols[iNap] && cols[iNap].toLowerCase() === 'true') continue;

    const cycleStart = cols[iCycleStart];
    if (!cycleStart) continue;
    // Extract date from cycle start time (format: 2026-03-17 23:57:32)
    const dateStr = cycleStart.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    // Use only one sleep entry per date (the first/most recent one in the file)
    if (seen.has(dateStr)) continue;
    seen.add(dateStr);

    const perf = iPerf >= 0 ? +cols[iPerf] || 0 : 0;
    const resp = iResp >= 0 ? +cols[iResp] || 16 : 16;
    const asleepMin = iAsleep >= 0 ? +cols[iAsleep] || 0 : 0;
    const deepMin = iDeep >= 0 ? +cols[iDeep] || 0 : 0;
    const remMin = iRem >= 0 ? +cols[iRem] || 0 : 0;
    const lightMin = iLight >= 0 ? +cols[iLight] || 0 : 0;
    const efficiency = iEfficiency >= 0 ? +cols[iEfficiency] || 85 : 85;

    // Derive bedtime from cycle start time
    const timeMatch = cycleStart.match(/(\d{2}):(\d{2}):\d{2}$/);
    let bedtimeStr = '02:00 AM';
    let bedtimeHour = 2;
    if (timeMatch) {
      let h = +timeMatch[1];
      const m = +timeMatch[2];
      bedtimeHour = h + m / 60;
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      bedtimeStr = `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
    }

    entries.push({
      date: dateStr,
      perf,
      hours: +(asleepMin / 60).toFixed(2),
      bedtime: bedtimeStr,
      bedtime_hour: bedtimeHour,
      deep: +(deepMin / 60).toFixed(2),
      rem: +(remMin / 60).toFixed(2),
      light: +(lightMin / 60).toFixed(2),
      efficiency,
      resp
    });
  }
  return entries;
}

// File preview on select
['deFileXlsx', 'deFileCsv'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => {
    const xlsxFile = document.getElementById('deFileXlsx').files[0];
    const csvFile = document.getElementById('deFileCsv').files[0];
    const preview = document.getElementById('deFilePreview');
    const parts = [];
    if (xlsxFile) parts.push(`Macros: ${xlsxFile.name} (${(xlsxFile.size / 1024).toFixed(0)} KB)`);
    if (csvFile) parts.push(`Sleep: ${csvFile.name} (${(csvFile.size / 1024).toFixed(0)} KB)`);
    preview.innerHTML = parts.length ? parts.map(p => `<div style="margin-bottom:4px;">${p}</div>`).join('') : '';
  });
});

document.getElementById('deSaveBtn').addEventListener('click', () => {
  const msgEl = document.getElementById('deMsg');
  const activeTab = document.querySelector('.de-tab.active').dataset.de;
  const cd = loadCustomData();

  if (activeTab === 'file') {
    // ===== File Import Mode =====
    const xlsxFile = document.getElementById('deFileXlsx').files[0];
    const csvFile = document.getElementById('deFileCsv').files[0];
    if (!xlsxFile && !csvFile) { msgEl.className = 'de-msg error'; msgEl.textContent = 'Select at least one file.'; return; }

    msgEl.className = 'de-msg'; msgEl.textContent = '';
    const promises = [];
    let macroCount = 0, sleepCount = 0;

    if (xlsxFile) {
      promises.push(new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const entries = parseXlsxMacros(e.target.result);
            entries.forEach(entry => {
              cd.macro = cd.macro.filter(d => d.date !== entry.date);
              cd.macro.push(entry);
              macroCount++;
            });
            resolve();
          } catch (err) { reject(err); }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(xlsxFile);
      }));
    }

    if (csvFile) {
      promises.push(new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const entries = parseSleepCsv(e.target.result);
            entries.forEach(entry => {
              cd.sleep = cd.sleep.filter(d => d.date !== entry.date);
              cd.sleep.push(entry);
              sleepCount++;
            });
            resolve();
          } catch (err) { reject(err); }
        };
        reader.onerror = reject;
        reader.readAsText(csvFile);
      }));
    }

    Promise.all(promises).then(() => {
      saveCustomData(cd);
      injectCustomData();
      updateRangeLabels();
      refreshDashboard();
      const parts = [];
      if (macroCount) parts.push(`${macroCount} macro entries`);
      if (sleepCount) parts.push(`${sleepCount} sleep entries`);
      msgEl.className = 'de-msg success';
      msgEl.textContent = `Imported ${parts.join(' and ')}. Dashboard refreshed.`;
      // Clear file inputs
      document.getElementById('deFileXlsx').value = '';
      document.getElementById('deFileCsv').value = '';
      document.getElementById('deFilePreview').innerHTML = '';
    }).catch(err => {
      msgEl.className = 'de-msg error';
      msgEl.textContent = `Import error: ${err.message}`;
    });

  } else if (activeTab === 'csv') {
    const lines = document.getElementById('deCsvInput').value.trim().split('\n').filter(Boolean);
    if (!lines.length) { msgEl.className = 'de-msg error'; msgEl.textContent = 'Paste CSV data first.'; return; }
    let added = 0;
    lines.forEach(line => {
      const p = line.split(',').map(s => s.trim());
      if (!p[0] || !p[0].match(/^\d{4}-\d{2}-\d{2}$/)) return;
      const entry = {
        date: p[0], protein: +p[1] || 0, carbs: +p[2] || 0, fat: +p[3] || 0,
        calories: +p[4] || 0, weight: p[5] ? +p[5] : null,
        lifting: p[6] === 'Y' ? 'Y' : null, drinks: p[7] || null, notes: p[8] || ''
      };
      cd.macro = cd.macro.filter(d => d.date !== entry.date);
      cd.macro.push(entry);
      added++;
    });
    saveCustomData(cd);
    injectCustomData();
    updateRangeLabels();
    refreshDashboard();
    msgEl.className = 'de-msg success';
    msgEl.textContent = `Imported ${added} entries. Dashboard refreshed.`;
  } else {
    const date = document.getElementById('deDate').value;
    const cal = +document.getElementById('deCal').value;
    if (!date || !cal) { msgEl.className = 'de-msg error'; msgEl.textContent = 'Date and calories are required.'; return; }
    const entry = {
      date, protein: +document.getElementById('dePro').value || 0,
      carbs: +document.getElementById('deCarbs').value || 0,
      fat: +document.getElementById('deFat').value || 0, calories: cal,
      weight: document.getElementById('deWeight').value ? +document.getElementById('deWeight').value : null,
      lifting: document.getElementById('deLifting').value || null,
      drinks: document.getElementById('deDrinks').value || null,
      notes: document.getElementById('deNotes').value || ''
    };
    cd.macro = cd.macro.filter(d => d.date !== date);
    cd.macro.push(entry);

    // Sleep data
    const sleepPerf = document.getElementById('deSleepPerf').value;
    if (sleepPerf) {
      const bedtime = document.getElementById('deBedtime').value || '02:00 AM';
      const sleepEntry = {
        date, perf: +sleepPerf,
        hours: +document.getElementById('deSleepHours').value || 0,
        bedtime,
        bedtime_hour: parseBedtimeHour(bedtime),
        deep: +document.getElementById('deDeep').value || 0,
        rem: +document.getElementById('deRem').value || 0,
        light: +document.getElementById('deLight').value || 0,
        efficiency: +document.getElementById('deEfficiency').value || 85,
        resp: +document.getElementById('deResp').value || 16
      };
      cd.sleep = cd.sleep.filter(d => d.date !== date);
      cd.sleep.push(sleepEntry);
    }
    saveCustomData(cd);
    injectCustomData();
    updateRangeLabels();
    refreshDashboard();
    msgEl.className = 'de-msg success';
    msgEl.textContent = `Saved ${date}. Dashboard refreshed.`;
  }
});

// Load custom data on startup
injectCustomData();

refreshDashboard();
console.log('Dashboard v4 loaded with decision-support analysis and live filters.');
