import { initFallbackHeart } from './heartFallback.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
const TARGETS = ['Cath', 'LAD', 'LCX', 'RCA'];
const targetDisplay = { Cath: 'Overall CAD', LAD: 'LAD · Left anterior descending', LCX: 'LCX · Left circumflex', RCA: 'RCA · Right coronary artery' };
const targetShort = { Cath: 'Overall CAD', LAD: 'LAD', LCX: 'LCX', RCA: 'RCA' };
const state = {
  schema: null, fields: [], groups: [], defaults: {}, demo: null,
  syntheticMode: false, lastFeatures: null, predictions: null, selectedVessel: 'LAD', explainTarget: 'Cath',
  heart: null, renderer: 'starting', explaining: false, assessing: false,
  activeView: 'overview', previousView: 'overview',
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}
function formatPercent(value, digits = 1) { return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(digits)}%` : '—'; }
function formatAuc(value) { return Number.isFinite(Number(value)) ? Number(value).toFixed(3) : '—'; }
function titleText(text) { return text.replace(/\s+/g, ' ').trim(); }

function toast(title, message, type = 'success', duration = 3900) {
  const region = $('#toast-region');
  const node = document.createElement('div');
  node.className = `toast ${type === 'error' ? 'error' : ''}`;
  node.innerHTML = `<span class="toast-icon">${type === 'error' ? '!' : '✓'}</span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div>`;
  region.appendChild(node);
  setTimeout(() => { node.style.opacity = '0'; node.style.transform = 'translateY(6px)'; setTimeout(() => node.remove(), 220); }, duration);
}
function setLoading(show, title = 'Running prediction models', description = 'Evaluating four model pipelines…') {
  $('#global-loading').hidden = !show;
  $('#loading-title').textContent = title;
  $('#loading-description').textContent = description;
}
function setApiState(status, text) {
  const pill = $('#api-pill');
  pill.classList.remove('online', 'offline');
  if (status === 'online') pill.classList.add('online');
  if (status === 'offline') pill.classList.add('offline');
  $('#api-status-text').textContent = text;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : `Request failed (${response.status})`;
    throw new Error(detail);
  }
  return data;
}

async function bootHeart() {
  const canvas = $('#heart-canvas');
  try {
    const module = await import('./heart3d.js');
    state.heart = new module.HeartScene(canvas, key => selectVessel(key, true));
    state.renderer = 'webgl';
    $('#scene-mode-label').textContent = 'WEBGL · INTERACTIVE 3D';
  } catch (error) {
    console.warn('Three.js renderer unavailable; using fallback:', error);
    state.heart = initFallbackHeart(canvas, key => selectVessel(key, true));
    state.renderer = 'fallback';
    $('#scene-mode-label').textContent = 'INTERACTIVE SCHEMATIC';
  }
  if (state.predictions) state.heart.updateScores?.(state.predictions);
  state.heart.setSelectedVessel?.(state.selectedVessel, false);
  $('#reset-view-btn').addEventListener('click', () => state.heart?.resetView?.());
}

function buildForm() {
  const form = $('#patient-form');
  const nav = $('#group-nav');
  const scroll = $('#fields-scroll');
  nav.innerHTML = '';
  scroll.innerHTML = '';
  state.groups.forEach((group, index) => {
    const fields = state.fields.filter(field => field.group === group.id);
    const navButton = document.createElement('button');
    navButton.type = 'button';
    navButton.className = index === 0 ? 'active' : '';
    navButton.dataset.group = group.id;
    navButton.innerHTML = `<span class="group-num">${escapeHtml(group.eyebrow)}</span><span>${escapeHtml(group.title)}</span><span class="group-qty">${fields.length}</span>`;
    navButton.addEventListener('click', () => showFormGroup(group.id));
    nav.appendChild(navButton);

    const panel = document.createElement('section');
    panel.className = `fields-panel ${index === 0 ? 'active' : ''}`;
    panel.dataset.panelGroup = group.id;
    panel.innerHTML = `<h3>${escapeHtml(group.title)}</h3><p class="group-desc">${escapeHtml(group.description)}</p><div class="fields-grid">${fields.map(renderField).join('')}</div>`;
    scroll.appendChild(panel);
  });
  form.addEventListener('input', event => {
    if (event.target.matches('input, select')) {
      state.syntheticMode = false;
      invalidateAssessment();
      recalculateBMI();
    }
  });
  form.addEventListener('change', event => {
    if (event.target.matches('input, select')) {
      state.syntheticMode = false;
      invalidateAssessment();
      recalculateBMI();
    }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    await runAssessment(readFeaturesFromForm(), state.syntheticMode);
  });
  showFormGroup(state.groups[0]?.id || 'profile');
  populateForm(state.defaults);
}

function renderField(field) {
  const key = field.key;
  const slug = slugify(key);
  const unit = field.unit ? `<span class="field-unit">${escapeHtml(field.unit)}</span>` : '';
  const helper = field.type === 'constant'
    ? `<p class="field-helper">Constant in the training data; fixed to No.</p>`
    : field.trainingRangeText ? `<p class="field-helper">${escapeHtml(field.trainingRangeText)}</p>` : `<p class="field-helper">${escapeHtml(field.help || '')}</p>`;
  let control = '';
  if (field.type === 'binary') {
    const checkedNo = Number(field.default) === 0 ? 'checked' : '';
    const checkedYes = Number(field.default) === 1 ? 'checked' : '';
    control = `<div class="binary-toggle"><input type="radio" id="f-${slug}-no" name="${escapeHtml(key)}" value="0" ${checkedNo}><label for="f-${slug}-no">No</label><input type="radio" id="f-${slug}-yes" name="${escapeHtml(key)}" value="1" ${checkedYes}><label for="f-${slug}-yes">Yes</label></div>`;
  } else if (field.type === 'constant') {
    control = `<input type="hidden" name="${escapeHtml(key)}" value="0"><div class="binary-toggle"><input type="radio" id="f-${slug}-no" checked disabled><label for="f-${slug}-no">No · fixed</label><input type="radio" id="f-${slug}-yes" disabled><label for="f-${slug}-yes">Yes</label></div>`;
  } else if (field.type === 'select') {
    control = `<select name="${escapeHtml(key)}" id="f-${slug}" aria-label="${escapeHtml(field.label)}">${(field.options || []).map(opt => `<option value="${escapeHtml(opt.value)}" ${String(opt.value) === String(field.default) ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`).join('')}</select>`;
  } else {
    control = `<input type="number" name="${escapeHtml(key)}" id="f-${slug}" value="${escapeHtml(field.default)}" min="${field.min ?? ''}" max="${field.max ?? ''}" step="${field.step ?? 1}" ${field.readonly ? 'readonly' : ''} required aria-label="${escapeHtml(field.label)}">`;
  }
  const hint = field.help && field.type !== 'constant' && !field.trainingRangeText ? field.help : (field.type === 'constant' ? field.help : '');
  const description = hint ? `<p class="field-helper">${escapeHtml(hint)}</p>` : helper;
  return `<div class="form-field ${field.type === 'constant' ? 'form-field--wide' : ''}"><div class="field-label-row"><label for="f-${slug}">${escapeHtml(field.label)}</label>${unit}</div><div class="field-control ${field.readonly || field.type === 'constant' ? 'field-control--readonly' : ''}">${control}</div>${description}</div>`;
}
function slugify(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

function showFormGroup(groupId) {
  $$('.group-nav button').forEach(button => button.classList.toggle('active', button.dataset.group === groupId));
  $$('.fields-panel').forEach(panel => panel.classList.toggle('active', panel.dataset.panelGroup === groupId));
  const group = state.groups.find(g => g.id === groupId);
  const qty = state.fields.filter(f => f.group === groupId).length;
  $('#drawer-section-title').textContent = group?.title || 'Patient profile';
  $('#drawer-field-count').textContent = `${qty} field${qty === 1 ? '' : 's'}`;
  const index = Math.max(0, state.groups.findIndex(g => g.id === groupId));
  $('#drawer-progress-fill').style.width = `${((index + 1) / state.groups.length) * 100}%`;
  $('#fields-scroll').scrollTop = 0;
}

function openDrawer(groupId = null) {
  $('#drawer-overlay').hidden = false;
  document.body.style.overflow = 'hidden';
  showFormGroup(groupId || state.groups[0]?.id || 'profile');
}
function closeDrawer() {
  $('#drawer-overlay').hidden = true;
  document.body.style.overflow = '';
  if (state.activeView === 'inputs') switchView(state.previousView);
}
function switchView(view) {
  const validViews = ['overview', 'inputs', 'coronary', 'explainability'];
  if (!validViews.includes(view)) return;
  if (view === 'inputs') {
    if (state.activeView !== 'inputs') state.previousView = state.activeView;
    state.activeView = 'inputs';
    document.body.dataset.view = 'inputs';
    document.dispatchEvent(new CustomEvent('cardio:view-change', { detail: view }));
    openDrawer();
    return;
  }
  state.activeView = view;
  document.body.dataset.view = view;
  document.dispatchEvent(new CustomEvent('cardio:view-change', { detail: view }));
  const heading = {
    overview: ['Coronary <span>intelligence.</span>', 'Explore model-estimated outputs across the coronary tree, with every signal linked to its prediction pipeline.'],
    coronary: ['Coronary <span>vessel map.</span>', 'Explore the interactive coronary schematic and inspect model-linked vessel outputs.'],
    explainability: ['Model <span>explainability.</span>', 'Review approximate feature contributions for the selected model output.'],
  }[view];
  if (heading) {
    $('.heading-title').innerHTML = heading[0];
    $('.page-subtitle').textContent = heading[1];
  }
}
function populateForm(features) {
  state.fields.forEach(field => {
    const key = field.key;
    const val = features[key] ?? field.default;
    if (field.type === 'binary') {
      const input = $(`input[name="${CSS.escape(key)}"][value="${Number(val) ? 1 : 0}"]`, $('#patient-form'));
      if (input) input.checked = true;
    } else if (field.type === 'constant') {
      const hidden = $(`input[type="hidden"][name="${CSS.escape(key)}"]`, $('#patient-form'));
      if (hidden) hidden.value = 0;
    } else {
      const control = $(`[name="${CSS.escape(key)}"]`, $('#patient-form'));
      if (control) control.value = val;
    }
  });
  recalculateBMI();
}
function recalculateBMI() {
  const weight = Number($('[name="Weight"]', $('#patient-form'))?.value);
  const height = Number($('[name="Length"]', $('#patient-form'))?.value);
  const bmi = $('[name="BMI"]', $('#patient-form'));
  if (bmi && weight > 0 && height > 0) bmi.value = (weight / Math.pow(height / 100, 2)).toFixed(2);
}
function readFeaturesFromForm() {
  const features = {};
  state.fields.forEach(field => {
    const key = field.key;
    if (field.type === 'constant') { features[key] = 0; return; }
    if (field.type === 'binary') {
      features[key] = Number($(`input[name="${CSS.escape(key)}"]:checked`, $('#patient-form'))?.value ?? field.default);
      return;
    }
    const control = $(`[name="${CSS.escape(key)}"]`, $('#patient-form'));
    const raw = control?.value;
    if (field.type === 'select' && ['Sex', 'BBB', 'VHD'].includes(key)) features[key] = raw;
    else features[key] = Number(raw);
  });
  const weight = Number(features.Weight), length = Number(features.Length);
  if (weight > 0 && length > 0) features.BMI = weight / Math.pow(length / 100, 2);
  return features;
}

function invalidateAssessment() {
  if (!state.predictions && !state.lastFeatures) return;
  state.predictions = null;
  state.lastFeatures = null;
  setMetricIdle();
  state.heart?.updateScores?.({ LAD: { score: null }, LCX: { score: null }, RCA: { score: null } });
  $('#explain-btn').disabled = true;
  $('#explain-results').hidden = true;
  $('#explain-empty').hidden = false;
  $('#explain-empty').innerHTML = `<div class="empty-spark">✳</div><strong>Inputs changed</strong><p>Run the model again to refresh scores and explanations for this profile.</p>`;
  $('#session-title').textContent = 'Inputs changed · results cleared';
  $('#session-description').textContent = 'Previous outputs were cleared so they are not mistaken for predictions on the edited profile.';
}

function setMetricIdle() {
  document.dispatchEvent(new CustomEvent('cardio:prediction-update', { detail: null }));
  $('#selected-score').innerHTML = '—<span>%</span>';
  $('#selected-classification').textContent = 'Awaiting input';
  $('#selected-classification').className = 'classification-chip classification-chip--idle';
  $('#selected-score-fill').style.width = '0%';
  $('#stage-empty-state').classList.remove('hidden');
  $('#session-title').textContent = 'No assessment run yet';
  $('#session-description').textContent = 'Use a synthetic demo profile or enter the clinical features to evaluate the model pipelines.';
}

function updateMetrics(predictions) {
  document.dispatchEvent(new CustomEvent('cardio:prediction-update', { detail: predictions }));
  $('#stage-empty-state').classList.add('hidden');
  $('#explain-btn').disabled = false;
  $$('.metric-card').forEach(card => card.classList.toggle('active', card.dataset.target === state.explainTarget));
  updateVesselInspector();
}

function selectVessel(key, fromScene = false) {
  if (!key || !['LAD', 'LCX', 'RCA'].includes(key)) return;
  state.selectedVessel = key;
  $$('.vessel-chip').forEach(chip => {
    const active = chip.dataset.vessel === key;
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
  });
  if (!fromScene) state.heart?.setSelectedVessel?.(key, false);
  updateVesselInspector();
}

function updateVesselInspector() {
  const target = state.selectedVessel;
  const item = state.predictions?.[target];
  const names = {
    LAD: 'LAD <span class="vessel-full-name">· Left anterior descending</span>',
    LCX: 'LCX <span class="vessel-full-name">· Left circumflex</span>',
    RCA: 'RCA <span class="vessel-full-name">· Right coronary artery</span>',
  };
  $('#vessel-title').innerHTML = names[target];
  const threshold = Number(state.schema?.thresholds?.[target] ?? .5);
  const auc = state.schema?.cvMetrics?.[target]?.roc_auc;
  $('#selected-threshold').textContent = formatPercent(threshold, 0);
  $('#selected-threshold-label').textContent = `Threshold · ${formatPercent(threshold, 0)}`;
  $('#selected-threshold-marker').style.left = `${threshold * 100}%`;
  $('#selected-auc').textContent = formatAuc(auc);
  if (!item) {
    $('#selected-score').innerHTML = '—<span>%</span>';
    $('#selected-classification').textContent = 'Awaiting input';
    $('#selected-classification').className = 'classification-chip classification-chip--idle';
    $('#selected-score-fill').style.width = '0%';
    return;
  }
  $('#selected-score').innerHTML = `${(item.score * 100).toFixed(1)}<span>%</span>`;
  $('#selected-classification').textContent = item.prediction ? 'Above threshold' : 'Below threshold';
  $('#selected-classification').className = `classification-chip ${item.prediction ? 'classification-chip--positive' : 'classification-chip--negative'}`;
  $('#selected-score-fill').style.width = `${item.score * 100}%`;
}

function selectMetricTarget(target) {
  if (!TARGETS.includes(target)) return;
  state.explainTarget = target;
  $('#explain-target').value = target;
  $$('.metric-card').forEach(card => card.classList.toggle('active', card.dataset.target === target));
  if (['LAD', 'LCX', 'RCA'].includes(target)) selectVessel(target, false);
  if (state.lastFeatures) $('#explain-btn').disabled = false;
}

async function runAssessment(features, synthetic = false) {
  if (state.assessing) return;
  state.assessing = true;
  $('#run-analysis-btn').disabled = true;
  setLoading(true, 'Running prediction models', 'Scoring overall CAD and three vessel-specific pipelines…');
  try {
    const data = await requestJson('/api/predict', { method: 'POST', body: JSON.stringify({ features, synthetic }) });
    state.lastFeatures = features;
    state.predictions = data.predictions;
    state.syntheticMode = Boolean(synthetic);
    state.explaining = false;
    updateMetrics(data.predictions);
    state.heart?.updateScores?.(data.predictions);
    $('#session-title').textContent = synthetic ? 'Synthetic demo assessment complete' : 'Assessment completed in this session';
    $('#session-description').textContent = synthetic
      ? 'This profile is synthetic and intended to demonstrate the interface, not represent an actual person.'
      : 'Outputs were generated from the entered features. No input values are saved by this prototype.';
    $('#explain-results').hidden = true;
    $('#explain-empty').hidden = false;
    $('#explain-empty').innerHTML = `<div class="empty-spark">✳</div><strong>Explanation ready on demand</strong><p>Select a target, then request approximate Kernel SHAP feature contributions.</p>`;
    $('#explain-btn').disabled = false;
    closeDrawer();
    const cath = data.predictions.Cath;
    toast('Assessment complete', `Four model outputs returned. Overall CAD score: ${formatPercent(cath.score)} (model-estimated score).`, 'success');
  } catch (error) {
    toast('Prediction unavailable', error.message || 'Could not reach the prediction API. Start the FastAPI service and try again.', 'error', 6000);
  } finally {
    setLoading(false);
    state.assessing = false;
    $('#run-analysis-btn').disabled = false;
  }
}

async function loadDemo(run = false) {
  try {
    const response = await requestJson('/api/demo');
    state.demo = response.features;
    invalidateAssessment();
    populateForm(response.features);
    state.syntheticMode = true;
    if (run) await runAssessment(response.features, true);
    else toast('Demo profile loaded', 'Synthetic reference values are ready. Select Run assessment to generate model outputs.');
  } catch (error) {
    toast('Could not load demo', error.message, 'error');
  }
}

function renderEvaluation(metrics) {
  const rows = $('#evaluation-rows');
  rows.innerHTML = TARGETS.map(target => {
    const m = metrics[target] || {};
    const names = { Cath: 'Overall CAD', LAD: 'LAD', LCX: 'LCX', RCA: 'RCA' };
    const val = Number(m.roc_auc || 0);
    return `<div class="evaluation-row"><span>${names[target]}</span><div class="eval-track"><span style="width:${Math.max(0,Math.min(100,val*100))}%"></span></div><b>${formatAuc(val)}</b></div>`;
  }).join('');
}

async function explainSelected() {
  if (!state.lastFeatures || state.explaining) return;
  state.explainTarget = $('#explain-target').value;
  state.explaining = true;
  $('#explain-btn').disabled = true;
  $('#explain-btn').innerHTML = '<span class="loading-inline"></span> Explaining…';
  $('#explain-empty').hidden = true;
  $('#explain-results').hidden = false;
  $('#explain-results').innerHTML = `<div class="explain-loading"><span class="loading-spinner loading-spinner--small"></span><p>Estimating feature contributions…</p></div>`;
  try {
    const data = await requestJson('/api/explain', {
      method: 'POST',
      body: JSON.stringify({ features: state.lastFeatures, target: state.explainTarget, max_features: 8, nsamples: 128 })
    });
    const maxAbs = Math.max(0.0001, ...data.contributions.map(c => Math.abs(c.value)));
    const rows = data.contributions.map(c => {
      const positive = c.value >= 0;
      const width = Math.max(2, Math.abs(c.value) / maxAbs * 100);
      const units = `${c.value >= 0 ? '+' : '−'}${Math.abs(c.value * 100).toFixed(1)}`;
      return `<div class="shap-row"><span class="shap-feature" title="${escapeHtml(c.label)}">${escapeHtml(titleText(c.label))}</span><div class="shap-bar-track"><span class="shap-bar ${positive ? 'positive' : 'negative'}" style="width:${width}%"></span></div><span class="shap-value">${units}</span></div>`;
    }).join('');
    $('#explain-results').innerHTML = `<div class="explain-method"><span>Method</span><strong>${escapeHtml(data.method)}</strong></div>${rows}<p class="explain-caveat">Bars are approximate score contributions relative to the background dataset. They describe model behaviour, not causation.</p>`;
    toast('Explanation generated', `Computed feature contributions for ${targetDisplay[data.target]}.`);
  } catch (error) {
    $('#explain-results').hidden = true;
    $('#explain-empty').hidden = false;
    $('#explain-empty').innerHTML = `<div class="empty-spark">!</div><strong>Explanation unavailable</strong><p>${escapeHtml(error.message || 'The explainer could not calculate contributions.')}</p>`;
    toast('Explanation unavailable', error.message || 'Try again with the selected target.', 'error', 6000);
  } finally {
    state.explaining = false;
    $('#explain-btn').disabled = !state.lastFeatures;
    $('#explain-btn').innerHTML = 'Explain score <span>↗</span>';
  }
}

function setupInteractions() {
  $('#open-inputs-btn').addEventListener('click', () => switchView('inputs'));
  $('#session-input-btn').addEventListener('click', () => switchView('inputs'));
  document.addEventListener('cardio:open-inputs', () => switchView('inputs'));
  document.addEventListener('cardio:navigate', event => switchView(event.detail?.view));
  $('#close-drawer-btn').addEventListener('click', closeDrawer);
  $('#drawer-overlay').addEventListener('click', event => { if (event.target === $('#drawer-overlay')) closeDrawer(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#drawer-overlay').hidden) closeDrawer(); });
  $('#demo-run-btn').addEventListener('click', () => loadDemo(true));
  $('#reset-demo-btn').addEventListener('click', () => loadDemo(false));
  $('#explain-btn').addEventListener('click', explainSelected);
  document.addEventListener('cardio:select-target', event => selectMetricTarget(event.detail?.target));
  $('#explain-target').addEventListener('change', () => {
    state.explainTarget = $('#explain-target').value;
    $$('.metric-card').forEach(card => card.classList.toggle('active', card.dataset.target === state.explainTarget));
  });
  $$('.vessel-chip').forEach(chip => chip.addEventListener('click', () => selectVessel(chip.dataset.vessel, false)));
}

async function initialize() {
  setupInteractions();
  setApiState('connecting', 'Connecting');
  bootHeart();
  try {
    const [schema, health, demo] = await Promise.all([
      requestJson('/api/schema'), requestJson('/api/health'), requestJson('/api/demo')
    ]);
    state.schema = schema;
    state.fields = schema.fields;
    state.groups = schema.groups;
    state.defaults = Object.fromEntries(schema.fields.map(f => [f.key, f.default]));
    state.demo = demo.features;
    $('#selected-auc').textContent = formatAuc(schema.cvMetrics.LAD.roc_auc);
    renderEvaluation(schema.cvMetrics);
    buildForm();
    populateForm(state.defaults);
    setApiState(health.models_loaded ? 'online' : 'offline', health.models_loaded ? '4 models ready' : 'Model error');
    $('#session-description').textContent = 'Enter the 55 expected model inputs, or load the synthetic demo profile to preview the prediction flow.';
  } catch (error) {
    console.error(error);
    setApiState('offline', 'API unreachable');
    toast('Backend not connected', 'Start the FastAPI service from the backend folder, then refresh this page.', 'error', 8500);
    $('#session-description').textContent = 'The frontend loaded, but the prediction API could not be reached. Start the backend and refresh to enable all 55 input fields and model inference.';
    $('#demo-run-btn').disabled = true;
    $('#open-inputs-btn').disabled = true;
    $('#session-input-btn').disabled = true;
  }
}

initialize();
