const WEEK_PLAN_STORAGE = 'macros_dashboard_week_plans_v1';
let progressChangeWindow = 14;
let weekPlanStorageAvailable = true;
let weekPlanState = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(WEEK_PLAN_STORAGE) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
})();

function planningToday() {
  return WeeklyPlanning.shift(analyticsCutoffDate(), 1);
}

function planningDays(endDate) {
  return dateKeysBetween(allDates[0] || endDate, endDate).map(date => {
    const day = macroByDate[date];
    return {
      ...day, date,
      drinkCalories: day ? estimateDrinkCalories(day.drinks) : null,
      steps: getStepForDate(date),
      excluded: isVacationDate(date) || isInDietBreak(date),
      creatineWater: creatineScaleAdjustmentForDate(date)
    };
  });
}

function currentPlanningModel() {
  const completed = getAnalyticsDays(allDays);
  const cutoff = analyticsCutoffDate();
  const timeline = window.dashboardData?.bayesian?.tdeeTimeline || [];
  const recent = [...timeline].reverse().find(point => point.date <= cutoff && Number.isFinite(point.mean));
  const fallback = workingTDEEProfile(completed);
  const posterior = recent || fallback.posterior;
  const baseline = posterior?.avgSteps;
  return {
    mean: recent?.mean ?? fallback.maintenance,
    low: recent?.ci68Low ?? fallback.rangeLow,
    high: recent?.ci68High ?? fallback.rangeHigh,
    baselineSteps: Number.isFinite(baseline) ? baseline : null,
    date: recent?.date || posterior?.date || null,
    label: recent ? `Recent ${recent.windowDays || 35}-day TDEE` : 'Working TDEE'
  };
}

function currentWeekPlan() {
  const today = planningToday();
  const start = WeeklyPlanning.weekStart(today);
  const model = currentPlanningModel();
  return {
    model,
    ...WeeklyPlanning.planWeek({
      today, days: planningDays(WeeklyPlanning.shift(start, 6)), drafts: weekPlanState[start] || {}, foodGoal: goals.calories,
      maintenance: model, baselineSteps: model.baselineSteps, kcalPerStep: KCAL_PER_STEP
    })
  };
}

function planBalanceText(value) {
  if (value === null || !Number.isFinite(value)) return 'Incomplete';
  if (Math.abs(value) < 1) return `${energyLabel(0)} balance`;
  return `${energyLabel(Math.abs(value))} ${value > 0 ? 'deficit' : 'surplus'}`;
}

function planBalanceClass(value) {
  return value === null ? 'plan-muted' : value >= 0 ? 'plan-positive' : 'plan-negative';
}

function planInput(date, field, value, caption, options = {}) {
  const energy = field === 'food';
  const rendered = value === null || !Number.isFinite(value) ? '' : energy ? energyValue(value) : value;
  return `<label class="week-input"><span>${caption}</span><input type="number" inputmode="decimal"
    aria-label="${date} ${caption}" data-plan-date="${date}" data-plan-field="${field}"
    min="${options.min || 0}" max="${options.max || (energy ? energyValue(10000) : 100000)}" step="any"
    value="${rendered}" ${options.placeholder ? `placeholder="${options.placeholder}"` : ''}></label>`;
}

function renderWeekPlanRows(plan) {
  const root = document.getElementById('weekPlanRows');
  if (!root) return;
  root.innerHTML = plan.rows.map(row => {
    const weekday = new Date(`${row.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
    const status = row.logged ? 'Logged' : row.isToday ? 'Today' : row.past ? 'Estimate needed' : 'Planned';
    const drinks = row.logged ? `<div class="week-record"><span>Alcohol est.</span><strong>${energyLabel(row.alcohol)}</strong></div>`
      : `<div class="week-drinks">${planInput(row.date, 'drinkCount', row.past && !Number.isFinite(weekPlanState[plan.start]?.[row.date]?.drinkCount) ? null : row.drinkCount, row.isToday ? 'More drinks' : 'Drinks', { max: 50 })}
          <label class="week-input"><span>Per drink (${energyUnit()})</span><select data-plan-date="${row.date}" data-plan-field="drinkRate" aria-label="${row.date} Drink type">
          ${[[110, 'Whiskey'], [100, 'Tequila / seltzer'], [150, 'Beer'], [125, 'Wine'], [180, 'Cocktail'], [140, 'Other']].map(([rate, name]) => `<option value="${rate}" ${row.drinkRate === rate ? 'selected' : ''}>${name} (${energyValue(rate)})</option>`).join('')}
          </select></label></div>`;
    return `<div class="week-day ${row.logged ? 'is-logged' : ''} ${row.isToday ? 'is-today' : ''}" data-week-day="${row.date}">
      <div class="week-date"><strong>${weekday} <span>${row.date.slice(5).replace('-', '/')}</span></strong>
        <small>${status}${row.excluded ? ' · Vacation / break' : ''}</small>
        ${row.isToday && (row.foodSoFar || row.drinksSoFar) ? `<small>Logged so far: ${energyLabel(row.foodSoFar)} food + ${energyLabel(row.drinksSoFar)} alcohol</small>` : ''}
      </div>
      ${row.logged ? `<div class="week-record"><span>Food</span><strong>${energyLabel(row.food)}</strong></div>` : planInput(row.date, 'food', row.food, `Food (${energyUnit()}, full day)`, { min: energyValue(row.foodSoFar) })}
      ${drinks}
      ${row.recordedSteps !== null ? `<div class="week-record"><span>Steps</span><strong>${row.recordedSteps.toLocaleString()}</strong></div>` : planInput(row.date, 'steps', row.stepInput, 'Steps (full day)', { placeholder: plan.model.baselineSteps === null ? 'Unknown' : `${plan.model.baselineSteps.toLocaleString()} assumed` })}
      <div class="week-daily-net" data-plan-net="${row.date}"></div>
    </div>`;
  }).join('');
}

function updateWeekPlanResults(plan = currentWeekPlan()) {
  const result = document.getElementById('weekPlanResult');
  if (!result) return;
  const range = plan.uncertainty;
  result.innerHTML = `<div class="week-result-main"><span>Projected week total</span>
      <strong class="${planBalanceClass(plan.totalDeficit)}">${planBalanceText(plan.totalDeficit)}</strong>
      <small>${plan.complete ? `${planBalanceText(plan.totalDeficit / 7)} per day on average` : 'Add the missing estimates to complete this week.'}</small></div>
    <div class="week-result-detail"><span>Completed logs · ${plan.loggedDays} days</span><strong>${planBalanceText(plan.loggedDeficit)}</strong></div>
    <div class="week-result-detail"><span>Today through Sunday</span><strong>${planBalanceText(plan.remainingDeficit)}</strong></div>
    <div class="week-result-detail"><span>Food + alcohol · full week</span><strong>${plan.complete ? `${energyLabel(plan.totalFood)} + ${energyLabel(plan.totalAlcohol)}` : 'Awaiting complete plan'}</strong></div>`;
  document.getElementById('weekPlanRange').textContent = `${formatShortDate(plan.start)} – ${formatShortDate(plan.end)} · This calendar week`;
  document.getElementById('weekPlanModel').textContent = `${plan.model.label}: ~${energyLabel(plan.model.mean)}/day${plan.model.date ? ` · through ${formatShortDate(plan.model.date)}` : ''} · ${plan.model.baselineSteps === null ? 'Step baseline unavailable' : `${plan.model.baselineSteps.toLocaleString()} baseline steps/day`}`;
  const notes = [
    `${plan.assumedStepDays} day${plan.assumedStepDays === 1 ? '' : 's'} use baseline steps. Walking adjustment: ~${energyLabel(KCAL_PER_STEP * 1000)} per 1,000 steps above/below baseline.`,
    'Food entries are full-day totals; today includes logged alcohol plus planned additional drinks.',
    'Drink calories are rough estimates; serving size and mixers can change the total.',
    plan.estimatedPastDays ? `${plan.estimatedPastDays} past day${plan.estimatedPastDays === 1 ? '' : 's'} need or use estimates.` : '',
    range?.low !== null && range?.low !== undefined ? `TDEE-only range for this week: ${planBalanceText(range.low)} to ${planBalanceText(range.high)}. Food and drink estimates add uncertainty.` : '',
    plan.model.date && daysBetweenDates(plan.model.date, planningToday()) > 7 ? 'TDEE data is over a week old.' : ''
  ].filter(Boolean);
  document.getElementById('weekPlanAssumptions').textContent = notes.join(' ');
  document.getElementById('weekPlanSaveState').textContent = weekPlanStorageAvailable ? 'Draft saved on this device' : 'Draft could not be saved on this device';
  plan.rows.forEach(row => {
    const cell = document.querySelector(`[data-plan-net="${row.date}"]`);
    if (!cell) return;
    cell.className = `week-daily-net ${planBalanceClass(row.deficit)}`;
    cell.textContent = row.errors.length ? row.errors.join(' · ') : planBalanceText(row.deficit);
    const dayRoot = cell.closest('.week-day');
    dayRoot.classList.toggle('has-error', row.errors.length > 0);
    dayRoot.querySelectorAll('input').forEach(input => input.setAttribute('aria-invalid', String(row.errors.length > 0)));
  });
}

function saveWeekPlan() {
  try {
    localStorage.setItem(WEEK_PLAN_STORAGE, JSON.stringify(weekPlanState));
    weekPlanStorageAvailable = true;
  } catch { weekPlanStorageAvailable = false; }
}

function progressImpactLabel(value) {
  if (value === null) return 'Coverage too low';
  return Math.abs(value) < 1 ? 'No meaningful change' : `${energyLabel(Math.abs(value))}/day ${value > 0 ? 'larger' : 'smaller'} deficit`;
}

function renderProgressChanges() {
  const root = document.getElementById('progressChangeContent');
  if (!root) return;
  const endDate = analyticsCutoffDate();
  const change = WeeklyPlanning.progressChanges({ endDate, days: planningDays(endDate), windowDays: progressChangeWindow, kcalPerStep: KCAL_PER_STEP });
  document.getElementById('progressChangeRange').textContent = `${formatShortDate(change.currentStart)} – ${formatShortDate(endDate)} vs ${formatShortDate(change.priorStart)} – ${formatShortDate(change.priorEnd)} · Completed calendar days`;
  const pace = value => value === null ? 'Not enough clean weigh-ins' : `${value > 0 ? '+' : '−'}${weightLabel(Math.abs(value), 2)}/week`;
  const changeLabel = change.observedChange === null ? 'Pace comparison unavailable'
    : Math.abs(change.observedChange) < 0.1 ? 'Weight pace is similar'
    : change.observedChange > 0 ? 'Weight pace shifted upward' : 'Weight pace shifted downward';
  const fullImpact = change.combinedImpact ?? change.intakeImpact;
  const barMax = Math.max(50, ...[change.food, change.alcohol, change.steps].map(metric => Math.abs(metric.impact || 0)));
  const metrics = [
    { label: 'Food intake', metric: change.food, format: value => energyLabel(value), unit: '/day' },
    { label: 'Alcohol estimate', metric: change.alcohol, format: value => energyLabel(value), unit: '/day' },
    { label: 'Walking', metric: change.steps, format: value => value === null ? '—' : `${Math.round(value).toLocaleString()} steps`, unit: '/day' }
  ];
  root.innerHTML = `<div class="progress-pace"><div><span>${changeLabel}</span><strong>${pace(change.priorPace)} <span>→</span> ${pace(change.currentPace)}</strong><small>First vs last 7-day mean weight in each period · negative = loss</small></div>
      <div><span>${change.combinedImpact === null ? 'Food + alcohol contribution' : 'Food, alcohol + walking contribution'}</span><strong>${progressImpactLabel(fullImpact)}</strong><small>Based on matched weekdays with recorded data</small></div></div>
    <div class="progress-driver-list">${metrics.map(({ label, metric, format, unit }) => `<div class="progress-driver">
      <div><strong>${label}</strong><small>${format(metric.before)} → ${format(metric.after)} ${unit} · ${metric.count}/${change.length} paired days</small></div>
      <div class="progress-impact-track" aria-hidden="true"><i class="${metric.impact >= 0 ? 'positive' : 'negative'}" style="width:${Math.abs(metric.impact || 0) / barMax * 50}%"></i></div>
      <strong class="${planBalanceClass(metric.impact)}">${progressImpactLabel(metric.impact)}</strong></div>`).join('')}</div>
    <div class="progress-context"><div><strong>Logging coverage</strong><p>${change.priorCoverage}/${change.priorEligible} → ${change.currentCoverage}/${change.currentEligible} eligible days with food logged. ${change.excludedDays} vacation/diet-break days excluded.${!change.foodReady ? ' Too few matched food logs to estimate their contribution.' : ''}${!change.stepsReady ? ' Too few matched step records; walking is excluded from the combined estimate.' : ''}</p></div>
      <div><strong>Unexplained scale movement</strong><p>${change.unexplainedChange === null ? 'Not enough complete data to separate logged behavior changes from the scale change.' : `About ${weightLabel(Math.abs(change.unexplainedChange), 2)}/week ${change.unexplainedChange > 0 ? 'upward' : 'downward'} beyond the change implied by food, alcohol, and walking. Water, logging error, other activity, and changes in expenditure may contribute; this does not isolate a cause.`}${Math.abs(change.creatineChange) > 0.15 ? ' Creatine loading changed across these periods and may affect scale pace.' : ''}</p></div></div>`;
}

function renderPersonalPlanning() {
  const plan = currentWeekPlan();
  renderWeekPlanRows(plan);
  updateWeekPlanResults(plan);
  renderProgressChanges();
}

document.getElementById('weekPlanRows').addEventListener('input', event => {
  const input = event.target;
  if (!input.dataset.planField) return;
  const start = WeeklyPlanning.weekStart(planningToday());
  const date = input.dataset.planDate;
  const field = input.dataset.planField;
  let value = input.value === '' ? null : Number(input.value);
  if (value !== null && field === 'food' && useMetric) value /= 4.184;
  weekPlanState[start] ||= {};
  weekPlanState[start][date] ||= {};
  weekPlanState[start][date][field] = value;
  saveWeekPlan();
  updateWeekPlanResults();
});
document.getElementById('weekPlanReset').addEventListener('click', () => {
  delete weekPlanState[WeeklyPlanning.weekStart(planningToday())];
  saveWeekPlan();
  renderPersonalPlanning();
});
document.getElementById('progressChangeWindow').addEventListener('change', event => {
  progressChangeWindow = Number(event.target.value) === 28 ? 28 : 14;
  renderProgressChanges();
});
