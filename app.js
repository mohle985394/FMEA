const STORAGE_KEY = 'fmea-studio-knowledge-v1';
const ANALYSIS_QUEUE_KEY = 'fmea-studio-analysis-queue-v1';

const steps = [
  '检查输入上下文与分析假设',
  '分解元素功能与接口边界',
  '应用适用的失效引导词',
  '检索已审核的历史 FMEA',
  '推导潜在原因与影响链',
  '匹配预防、检测与容错机制',
  '计算风险并执行一致性检查'
];

const guidewords = [
  { word: '功能丧失', label: '完全无法提供功能' },
  { word: '功能降级', label: '输出精度或能力不足' },
  { word: '输出错误', label: '输出值与真实状态不一致' },
  { word: '功能过早', label: '在不应触发时提前执行' },
  { word: '功能过晚', label: '未在要求时间内执行' },
  { word: '功能间歇', label: '功能出现不稳定或间断' },
  { word: '输出超限', label: '输出超过允许范围' },
  { word: '数据陈旧', label: '使用了过期或未更新的数据' }
];

const samples = {
  software: {
    elementName: '车速计算模块', elementType: 'software', standard: 'ISO 26262',
    function: '基于轮速信号和时间戳计算车辆当前速度，并向上层控制功能提供速度值与有效性状态。',
    inputs: '四轮轮速信号、时间戳、轮胎周长标定参数', outputs: '车辆速度、速度有效性状态、诊断状态',
    modes: '正常、启动、降级、关闭', safetyGoal: '避免向上层提供错误或陈旧的车辆速度，确保控制功能进入可控状态。'
  },
  system: {
    elementName: '电池管理系统', elementType: 'system', standard: 'AIAG / VDA',
    function: '监测电池包状态，估算荷电状态，并在异常情况下触发保护和降级策略。',
    inputs: '单体电压、温度、电流、接触器状态', outputs: 'SOC、允许充放电功率、故障告警',
    modes: '上电、自检、正常运行、故障降级、关闭', safetyGoal: '防止电池过充、过放和热失控风险，异常时进入安全状态。'
  }
};

const seedKnowledge = [
  {
    id: 'KB-DEMO-001', title: '车速数据新鲜度监控最佳实践', project: '历史平台 A', elementType: 'software', element: '车速计算模块',
    function: '基于轮速信号和时间戳计算车辆速度并提供有效性状态', failureMode: '数据陈旧：车辆速度未按周期更新',
    cause: '接收任务未刷新缓存，时间戳仍保持上一周期有效值', effect: '上层稳定控制功能继续使用过期车速，无法及时响应实际车速变化',
    control: '对输入和输出分别执行时间戳新鲜度检查；超过 100 ms 标记无效并切换到降级车速源，同时记录诊断事件',
    s: 9, o: 3, d: 3, reviewStatus: 'approved', tags: ['时序', '数据新鲜度', '降级'], source: 'FMEA-VEH-2025 V3.2 / 评审通过',
    createdAt: '2025-11-18T09:00:00.000Z', updatedAt: '2025-11-18T09:00:00.000Z'
  },
  {
    id: 'KB-DEMO-002', title: 'BMS 采样链路完全丧失处置', project: '储能平台 B', elementType: 'system', element: '电池管理系统',
    function: '采集单体电压与温度并触发电池保护', failureMode: '功能丧失：无法获得有效的单体采样数据',
    cause: '采样芯片供电异常、菊花链通信中断或采集任务停止运行', effect: '无法识别单体过压或过温，可能延迟保护并扩大热风险',
    control: '通信超时与计数器监控；连续三周期无有效采样时禁止充放电并断开接触器；通过故障注入验证反应时间',
    s: 10, o: 2, d: 3, reviewStatus: 'approved', tags: ['采样', '通信', '安全状态'], source: 'BMS-FMEA-018 / 安全评审纪要',
    createdAt: '2025-09-10T09:00:00.000Z', updatedAt: '2025-09-10T09:00:00.000Z'
  }
];

let currentResult = null;
let knowledgeRecords = loadKnowledge();
let analysisQueue = loadAnalysisQueue();
const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function normalize(value, fallback = '') { return String(value || '').trim() || fallback; }
function clampScore(value, fallback = 1) { const number = Number.parseInt(value, 10); return Number.isFinite(number) ? Math.min(10, Math.max(1, number)) : fallback; }
function createId() { return `KB-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }
function typeLabel(type) { return { software: '软件元素', system: '系统元素', hardware: '硬件组件' }[type] || '未分类'; }
function normalizeElementType(value) { return { software: 'software', system: 'system', hardware: 'hardware', 软件元素: 'software', 系统元素: 'system', 硬件组件: 'hardware' }[normalize(value).toLowerCase()] || 'software'; }

function loadAnalysisQueue() {
  try {
    const stored = localStorage.getItem(ANALYSIS_QUEUE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function saveAnalysisQueue() { localStorage.setItem(ANALYSIS_QUEUE_KEY, JSON.stringify(analysisQueue)); }

function parseCsv(text) {
  const source = String(text || '').replace(/^\ufeff/, ''); const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]; const next = source[index + 1];
    if (character === '"' && quoted && next === '"') { cell += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (character === ',' && !quoted) { row.push(cell.trim()); cell = ''; continue; }
    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(cell.trim()); cell = '';
      if (row.some((value) => value)) rows.push(row);
      row = []; continue;
    }
    cell += character;
  }
  if (cell || row.length) { row.push(cell.trim()); if (row.some((value) => value)) rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows.shift().map((header) => header.trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function parseBatchFile(file, text) {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return parseCsv(text);
  const parsed = JSON.parse(text.replace(/^\ufeff/, ''));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.elements)) return parsed.elements;
  if (Array.isArray(parsed.records)) return parsed.records;
  throw new Error('文件中未找到 elements 或 records 数组');
}

function importValue(record, keys) {
  const key = keys.find((candidate) => Object.prototype.hasOwnProperty.call(record, candidate));
  return key ? record[key] : '';
}

function normalizeAnalysisElement(record) {
  if (!record) return null;
  const elementName = normalize(importValue(record, ['elementName', 'element', 'name', '系统 / 软件元素', '元素名称']));
  const functionText = normalize(importValue(record, ['function', '主要功能', '功能描述']));
  if (!elementName || !functionText) return null;
  const elementType = importValue(record, ['elementType', 'type', '元素类型']);
  return { elementName, elementType: normalizeElementType(elementType), standard: normalize(importValue(record, ['standard', '分析标准']), 'IEC 60812'), function: functionText, inputs: normalize(importValue(record, ['inputs', 'input', '输入 / 依赖', '输入'])), outputs: normalize(importValue(record, ['outputs', 'output', '输出 / 接口', '输出'])), modes: normalize(importValue(record, ['modes', '运行模式'])), safetyGoal: normalize(importValue(record, ['safetyGoal', 'safety', '安全目标 / 关键约束', '安全目标'])) };
}

function loadKnowledge() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return seedKnowledge.map((item) => ({ ...item, tags: [...item.tags] }));
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return seedKnowledge.map((item) => ({ ...item, tags: [...item.tags] }));
  }
}

function saveKnowledge() {
  $('kbSaveState')?.classList.add('saving');
  if ($('kbSaveState')) $('kbSaveState').innerHTML = '<i></i>保存中';
  localStorage.setItem(STORAGE_KEY, JSON.stringify(knowledgeRecords));
  window.setTimeout(() => {
    $('kbSaveState')?.classList.remove('saving');
    if ($('kbSaveState')) $('kbSaveState').innerHTML = '<i></i>已保存';
  }, 260);
}

function showToast(message, isError = false) {
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' error' : ''}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2300);
}

function fillSample(type) { Object.entries(samples[type]).forEach(([key, value]) => { if ($(key)) $(key).value = value; }); }

function fillAnalysisForm(data) { Object.entries(data).forEach(([key, value]) => { if ($(key)) $(key).value = value || ''; }); }

function renderAnalysisQueue() {
  const panel = $('analysisQueuePanel'); if (!panel) return;
  panel.classList.toggle('hidden', analysisQueue.length === 0); $('analysisQueueCount').textContent = analysisQueue.length;
  $('analysisQueueList').innerHTML = analysisQueue.map((item, index) => `<div class="analysis-queue-item ${item.loaded ? 'loaded' : ''}"><div><strong>${escapeHtml(item.elementName)}</strong><span>${escapeHtml(typeLabel(item.elementType))} · ${escapeHtml(item.function)}</span></div><button class="queue-load-btn" type="button" data-queue-index="${index}">载入</button></div>`).join('');
}

function loadAnalysisQueueItem(index) {
  const item = analysisQueue[index]; if (!item) return;
  analysisQueue = analysisQueue.map((entry, entryIndex) => ({ ...entry, loaded: entryIndex === index })); saveAnalysisQueue(); fillAnalysisForm(item); renderAnalysisQueue(); $('elementName').focus(); showToast(`已载入第 ${index + 1} 个分析元素`);
}

function navigate(view) {
  const showKnowledge = view === 'knowledge';
  $('analysisView').classList.toggle('hidden', showKnowledge);
  $('knowledgeView').classList.toggle('hidden', !showKnowledge);
  document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  if (showKnowledge) renderKnowledge();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function normalizeMatchText(value) { return String(value || '').toLowerCase().replace(/[\s，。；、,:：;()（）\-_]/g, ''); }
function bigrams(value) { const text = normalizeMatchText(value); const result = new Set(); for (let index = 0; index < text.length - 1; index += 1) result.add(text.slice(index, index + 2)); return result; }
function textSimilarity(left, right) {
  const a = bigrams(left); const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0; a.forEach((item) => { if (b.has(item)) intersection += 1; });
  return intersection / (a.size + b.size - intersection);
}

function knowledgeScore(record, row, data) {
  if (record.reviewStatus !== 'approved') return 0;
  if (!normalizeMatchText(record.failureMode).includes(normalizeMatchText(row.guideword))) return 0;
  let score = 3;
  if (record.elementType === data.elementType) score += 2;
  const recordElement = normalizeMatchText(record.element); const targetElement = normalizeMatchText(data.elementName);
  if (recordElement === targetElement) score += 5;
  else if (recordElement.includes(targetElement) || targetElement.includes(recordElement)) score += 3;
  score += textSimilarity(record.function, data.function) * 5;
  const context = normalizeMatchText(`${data.function}${data.inputs}${data.outputs}`);
  score += Math.min((record.tags || []).filter((tag) => context.includes(normalizeMatchText(tag))).length, 2);
  return score;
}

function applyKnowledge(rows, data) {
  return rows.map((row) => {
    const matches = knowledgeRecords.map((record) => ({ record, score: knowledgeScore(record, row, data) })).filter((item) => item.score >= 6.5).sort((a, b) => b.score - a.score);
    if (!matches.length) return row;
    const { record, score } = matches[0];
    const s = clampScore(record.s, row.s); const o = clampScore(record.o, row.o); const d = clampScore(record.d, row.d);
    return { ...row, cause: normalize(record.cause, row.cause), effect: normalize(record.effect, row.effect), control: normalize(record.control, row.control), s, o, d, rpn: s * o * d, status: '知识库复用', knowledgeId: record.id, knowledgeTitle: record.title, knowledgeSource: record.source, matchScore: Math.min(99, Math.round(score * 10)) };
  });
}

function buildRows(data) {
  const fn = data.function; const input = data.inputs; const output = data.outputs; const isSoftware = data.elementType === 'software';
  const baseCauses = isSoftware
    ? ['输入数据丢失、异常或未经过范围校验', '算法边界条件未覆盖，存在逻辑分支缺陷', '任务调度抖动或执行超时', '接口协议、数据类型或配置参数不一致', '异常处理路径未正确复位状态', '资源竞争、栈/堆耗尽或看门狗复位', '时间戳未更新或缓存未及时刷新', '标定值错误或版本管理失控']
    : ['传感器、执行器或供电链路发生硬件故障', '信号受到噪声、干扰或连接器接触不良影响', '保护阈值、标定参数或配置不符合设计要求', '通信报文丢失、延迟或完整性校验失败', '环境温度、振动或负载超出设计边界', '诊断机制未覆盖该故障组合', '故障恢复顺序或状态切换不正确', '维护、装配或返修过程引入异常'];
  const effects = [`无法基于${input}稳定完成${fn}`, `输出${output}精度下降，上层功能获得不完整信息`, `向上层提供与实际状态不一致的${output}`, `在不满足触发条件时提前改变${output}`, `未在规定响应时间内更新${output}，故障传播窗口扩大`, '功能表现不稳定，可能导致间歇性控制异常', '输出超出允许范围，相关执行功能可能被过度驱动', '上层继续使用过时信息，无法及时感知真实状态'];
  const controls = isSoftware
    ? ['输入范围与合理性检查；异常输入置为无效', '交叉校验与边界值测试；要求需求到代码可追溯', '执行监控与超时检测；超时后进入降级状态', '接口契约、CRC/长度校验与配置版本检查', '故障状态机复位策略；异常路径单元测试', '看门狗、资源监控与安全复位；记录诊断快照', '时间戳新鲜度检查；超过阈值禁止继续使用', '标定数据双区校验与发布审批']
    : ['冗余传感器与合理性校验；异常通道隔离', '屏蔽、滤波、接地和连接器诊断；检测信号抖动', '参数范围约束、写保护和配置一致性检查', '通信超时、计数器和 CRC 校验；失联进入安全状态', '温度、电流和负载监测；超限限制功率', '诊断覆盖率评审与故障注入测试', '定义受控的故障恢复和接触器动作顺序', '装配检查、返修确认和端到端 EOL 测试'];
  const scores = [[9, 3, 4], [8, 4, 5], [9, 3, 6], [8, 3, 4], [7, 4, 5], [8, 2, 6], [9, 2, 4], [7, 3, 5]];
  const rows = guidewords.map((guideword, index) => {
    const [s, o, d] = scores[index];
    return { id: `FM-${String(index + 1).padStart(3, '0')}`, guideword: guideword.word, mode: `${guideword.word}：${guideword.label}`, cause: baseCauses[index], effect: effects[index], control: controls[index], s, o, d, rpn: s * o * d, status: s * o * d >= 100 ? '优先行动' : '待审核' };
  });
  return applyKnowledge(rows, data);
}

function riskClass(value) { return value >= 100 ? 'high' : value >= 70 ? 'mid' : 'low'; }
function scoreClass(value) { return value >= 8 ? 'score-high' : value >= 5 ? 'score-mid' : 'score-low'; }

function renderTable(rows) {
  const knowledgeCount = rows.filter((row) => row.knowledgeId).length;
  $('analysisCoverageText').innerHTML = `<span class="filter-icon">≡</span> 已应用 8 个引导词${knowledgeCount ? ` · 复用 ${knowledgeCount} 条历史知识` : ''}`;
  $('fmeaBody').innerHTML = rows.map((row) => {
    const statusClass = row.status === '知识库复用' ? 'knowledge-chip' : row.status === '优先行动' ? 'risk-chip high' : 'review-chip';
    const source = row.knowledgeTitle ? `<br><span class="muted-text">来源：${escapeHtml(row.knowledgeTitle)}</span>` : '';
    return `<tr><td><strong>${escapeHtml(row.id)}</strong></td><td><strong>${escapeHtml(row.guideword)}</strong><br><span class="muted-text">${escapeHtml(row.mode.split('：')[1])}</span>${source}</td><td>${escapeHtml(row.cause)}</td><td>${escapeHtml(row.effect)}</td><td>${escapeHtml(row.control)}</td><td class="${scoreClass(row.s)}">${row.s}</td><td class="${scoreClass(row.o)}">${row.o}</td><td class="${scoreClass(row.d)}">${row.d}</td><td><strong class="${riskClass(row.rpn) === 'high' ? 'score-high' : riskClass(row.rpn) === 'mid' ? 'score-mid' : 'score-low'}">${row.rpn}</strong></td><td><span class="${statusClass}">${escapeHtml(row.status)}</span></td></tr>`;
  }).join('');
}

function renderOverview(rows) {
  const high = rows.filter((row) => row.rpn >= 100).length; const mid = rows.filter((row) => row.rpn >= 70 && row.rpn < 100).length; const low = rows.length - high - mid;
  $('riskBars').innerHTML = [['高风险', high, 'high'], ['中风险', mid, 'mid'], ['低风险', low, 'low']].map(([label, count, cssClass]) => `<div class="risk-row"><span>${label}</span><div class="bar-track"><div class="bar-fill ${cssClass}" style="width:${Math.max(count / rows.length * 100, count ? 8 : 0)}%"></div></div><strong>${count}</strong></div>`).join('');
  const coverage = Math.round(rows.filter((row) => row.control).length / rows.length * 100);
  $('coverageValue').textContent = `${coverage}%`; $('coverageBar').style.width = `${coverage}%`; $('coverageHint').textContent = coverage === 100 ? '每个潜在原因均已匹配至少一项控制措施。' : '仍有原因缺少明确的预防或检测措施。';
  const priorities = rows.filter((row) => row.rpn >= 100).sort((a, b) => b.rpn - a.rpn);
  $('highRiskList').innerHTML = priorities.length ? priorities.map((row) => `<div class="risk-item"><div><strong>${escapeHtml(row.id)} · ${escapeHtml(row.guideword)}</strong><span>${escapeHtml(row.cause)}</span></div><span class="risk-chip high">RPN ${row.rpn}</span></div>`).join('') : '<div class="muted-text">当前没有超过优先行动阈值的项目。</div>';
}

function renderBasis(data, rows) {
  const items = [['元素类型', typeLabel(data.elementType)], ['分析标准', data.standard], ['主要功能', data.function], ['输入 / 依赖', data.inputs], ['输出 / 接口', data.outputs], ['运行模式', data.modes]];
  $('contextList').innerHTML = items.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value || '未提供')}</dd>`).join('');
  const reused = rows.filter((row) => row.knowledgeId);
  const assumptions = [`基于“${data.function}”作为当前功能定义进行分析。`, `${rows.length} 个通用失效引导词已应用，实际适用性需结合系统边界复核。`, data.safetyGoal ? `安全约束：${data.safetyGoal}` : '未提供明确安全目标，风险影响按通用安全假设生成。', reused.length ? `已复用 ${reused.length} 条已审核历史记录：${reused.map((row) => row.knowledgeTitle).join('、')}。` : '当前没有达到匹配阈值的已审核历史 FMEA。', 'S/O/D 评分为规则引擎或历史记录建议值，需由安全工程师结合当前项目确认。'];
  $('assumptionList').innerHTML = assumptions.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
}

function setLoadingStep(index) {
  $('loadingTitle').textContent = steps[index] || '分析完成'; $('loadingText').textContent = index < steps.length ? '正在调用本地规则与历史知识...' : '正在整理结果'; $('progressBar').style.width = `${Math.min((index + 1) / steps.length * 100, 100)}%`;
  $('stepList').innerHTML = steps.map((step, stepIndex) => `<div class="step-item ${stepIndex < index ? 'done' : stepIndex === index ? 'active' : ''}"><span class="step-check">${stepIndex < index ? '✓' : stepIndex === index ? '·' : ''}</span>${escapeHtml(step)}</div>`).join('');
}

function generate(data) {
  $('emptyState').classList.add('hidden'); $('resultState').classList.add('hidden'); $('loadingState').classList.remove('hidden'); $('generateBtn').disabled = true; $('generateBtn').innerHTML = '<span class="spark">◌</span> 分析中...';
  let index = 0; setLoadingStep(index);
  const timer = window.setInterval(() => {
    index += 1;
    if (index < steps.length) { setLoadingStep(index); return; }
    window.clearInterval(timer); currentResult = { data, rows: buildRows(data) }; renderResult(currentResult); $('loadingState').classList.add('hidden'); $('resultState').classList.remove('hidden'); $('generateBtn').disabled = false; $('generateBtn').innerHTML = '<span class="spark">✦</span> 重新生成分析'; $('exportBtn').disabled = false;
  }, 350);
}

function renderResult(result) {
  const { data, rows } = result;
  $('resultTitle').textContent = data.elementName; $('resultType').textContent = typeLabel(data.elementType); $('resultStandard').textContent = data.standard; $('metricModes').textContent = rows.length; $('metricHigh').textContent = rows.filter((row) => row.rpn >= 100).length; $('metricRpn').textContent = Math.round(rows.reduce((sum, row) => sum + row.rpn, 0) / rows.length); $('tableCount').textContent = rows.length;
  renderTable(rows); renderOverview(rows); renderBasis(data, rows);
}

function downloadBlob(content, mimeType, fileName) {
  const blob = new Blob([content], { type: mimeType }); const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = fileName; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv() {
  if (!currentResult) return;
  const header = ['ID', '失效引导词', '潜在失效模式', '潜在失效原因', '潜在失效影响', '安全措施/机制', 'S', 'O', 'D', 'RPN', '状态', '知识库来源'];
  const lines = [header, ...currentResult.rows.map((row) => [row.id, row.guideword, row.mode, row.cause, row.effect, row.control, row.s, row.o, row.d, row.rpn, row.status, row.knowledgeSource || ''])].map((line) => line.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','));
  downloadBlob(`\ufeff${lines.join('\n')}`, 'text/csv;charset=utf-8;', `${currentResult.data.elementName}-FMEA.csv`);
}

function resetAnalysis() {
  $('fmeaForm').reset(); $('elementType').value = 'software'; $('emptyState').classList.remove('hidden'); $('loadingState').classList.add('hidden'); $('resultState').classList.add('hidden'); $('exportBtn').disabled = true; currentResult = null;
}

function renderKnowledge() {
  const query = normalizeMatchText($('kbSearch').value); const typeFilter = $('kbTypeFilter').value; const statusFilter = $('kbStatusFilter').value;
  const records = knowledgeRecords.filter((record) => {
    const searchable = normalizeMatchText([record.title, record.project, record.element, record.function, record.failureMode, record.cause, record.effect, record.control, ...(record.tags || [])].join(' '));
    return (!query || searchable.includes(query)) && (typeFilter === 'all' || record.elementType === typeFilter) && (statusFilter === 'all' || record.reviewStatus === statusFilter);
  });
  $('kbTotal').textContent = knowledgeRecords.length; $('kbApproved').textContent = knowledgeRecords.filter((record) => record.reviewStatus === 'approved').length; $('kbSoftware').textContent = knowledgeRecords.filter((record) => record.elementType === 'software').length; $('kbSystem').textContent = knowledgeRecords.filter((record) => record.elementType !== 'software').length; $('navKbCount').textContent = knowledgeRecords.length; $('kbExportBtn').disabled = knowledgeRecords.length === 0; $('kbEmpty').classList.toggle('hidden', records.length > 0);
  $('kbList').innerHTML = records.map((record) => {
    const rpn = clampScore(record.s) * clampScore(record.o) * clampScore(record.d); const tags = (record.tags || []).map((tag) => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join('');
    return `<article class="kb-card ${record.reviewStatus === 'draft' ? 'draft' : ''}"><div class="kb-card-head"><div class="kb-card-title"><h3>${escapeHtml(record.title)}</h3><div class="kb-card-meta"><span>${escapeHtml(record.project || '未标注项目')}</span><span>·</span><span>${escapeHtml(typeLabel(record.elementType))}</span><span class="${record.reviewStatus === 'approved' ? 'approved-chip' : 'draft-chip'}">${record.reviewStatus === 'approved' ? '已审核' : '草稿'}</span></div></div><div class="kb-card-actions"><button class="icon-btn" type="button" data-action="use" data-id="${escapeHtml(record.id)}" title="用于新分析">↗</button><button class="icon-btn" type="button" data-action="edit" data-id="${escapeHtml(record.id)}" title="编辑记录">✎</button><button class="icon-btn danger" type="button" data-action="delete" data-id="${escapeHtml(record.id)}" title="删除记录">×</button></div></div><div class="kb-content-grid"><div class="kb-detail"><span>元素 / 功能</span><p><strong>${escapeHtml(record.element)}</strong>${record.function ? `<br>${escapeHtml(record.function)}` : ''}</p></div><div class="kb-detail"><span>失效模式</span><p>${escapeHtml(record.failureMode)}</p></div><div class="kb-detail"><span>原因</span><p>${escapeHtml(record.cause || '未录入')}</p></div><div class="kb-detail"><span>影响</span><p>${escapeHtml(record.effect || '未录入')}</p></div><div class="kb-detail wide"><span>安全措施 / 机制</span><p>${escapeHtml(record.control)}</p></div></div><div class="kb-card-foot"><div class="tag-row">${tags}<span class="risk-chip ${riskClass(rpn)}">S${record.s} · O${record.o} · D${record.d} · RPN ${rpn}</span></div><span class="kb-source">${escapeHtml(record.source || '无来源说明')}</span></div></article>`;
  }).join('');
}

function resetKnowledgeForm() {
  $('kbForm').reset(); $('kbRecordId').value = ''; $('kbS').value = '7'; $('kbO').value = '3'; $('kbD').value = '4'; $('kbStatus').value = 'approved'; $('kbFormTitle').textContent = '录入历史 FMEA'; $('kbSubmitText').textContent = '加入知识库'; $('kbCancelEdit').classList.add('hidden');
}

function fillKnowledgeForm(record) {
  const ids = { id: 'kbRecordId', title: 'kbTitle', project: 'kbProject', elementType: 'kbElementType', element: 'kbElement', function: 'kbFunction', failureMode: 'kbFailureMode', cause: 'kbCause', effect: 'kbEffect', control: 'kbControl', s: 'kbS', o: 'kbO', d: 'kbD', reviewStatus: 'kbStatus', source: 'kbSource' };
  Object.entries(ids).forEach(([field, id]) => { $(id).value = record[field] ?? ''; });
  $('kbTags').value = (record.tags || []).join(', '); $('kbFormTitle').textContent = '编辑历史 FMEA'; $('kbSubmitText').textContent = '保存修改'; $('kbCancelEdit').classList.remove('hidden'); document.querySelector('.kb-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function recordFromForm(form) {
  const data = Object.fromEntries(new FormData(form).entries()); const existing = knowledgeRecords.find((record) => record.id === data.id); const now = new Date().toISOString();
  return { id: data.id || createId(), title: normalize(data.title), project: normalize(data.project), elementType: data.elementType, element: normalize(data.element), function: normalize(data.function), failureMode: normalize(data.failureMode), cause: normalize(data.cause), effect: normalize(data.effect), control: normalize(data.control), s: clampScore(data.s, 7), o: clampScore(data.o, 3), d: clampScore(data.d, 4), reviewStatus: data.reviewStatus === 'draft' ? 'draft' : 'approved', tags: normalize(data.tags).split(/[,，]/).map((tag) => tag.trim()).filter(Boolean), source: normalize(data.source), createdAt: existing?.createdAt || now, updatedAt: now };
}

function normalizeImportedRecord(record, knownIds) {
  const title = normalize(importValue(record, ['title', '记录标题', '标题'])); const element = normalize(importValue(record, ['element', 'elementName', '元素名称', '系统 / 软件元素'])); const failureMode = normalize(importValue(record, ['failureMode', 'mode', '潜在失效模式', '失效模式'])); const control = normalize(importValue(record, ['control', '措施', '安全措施 / 机制', '安全措施']));
  if (!record || !title || !element || !failureMode || !control) return null;
  let id = normalize(importValue(record, ['id', '记录 ID', '编号']), createId()); if (knownIds.has(id)) id = createId(); knownIds.add(id); const now = new Date().toISOString();
  const tags = importValue(record, ['tags', '标签']); const elementType = importValue(record, ['elementType', 'type', '元素类型']); const reviewStatus = importValue(record, ['reviewStatus', 'status', '审核状态']);
  return { id, title, project: normalize(importValue(record, ['project', '来源项目', '项目'])), elementType: normalizeElementType(elementType), element, function: normalize(importValue(record, ['function', '功能描述', '主要功能'])), failureMode, cause: normalize(importValue(record, ['cause', '潜在失效原因', '失效原因'])), effect: normalize(importValue(record, ['effect', '潜在失效影响', '失效影响'])), control, s: clampScore(importValue(record, ['s', 'S']), 7), o: clampScore(importValue(record, ['o', 'O']), 3), d: clampScore(importValue(record, ['d', 'D']), 4), reviewStatus: reviewStatus === 'draft' || reviewStatus === '草稿' ? 'draft' : 'approved', tags: Array.isArray(tags) ? tags.map((tag) => normalize(tag)).filter(Boolean) : normalize(tags).split(/[,，]/).map((tag) => tag.trim()).filter(Boolean), source: normalize(importValue(record, ['source', '依据 / 来源', '来源'])), createdAt: importValue(record, ['createdAt', '创建时间']) || now, updatedAt: now };
}

function useKnowledgeRecord(record) {
  $('elementName').value = record.element; $('elementType').value = record.elementType; $('function').value = record.function; $('safetyGoal').value = record.effect; navigate('analysis'); $('elementName').focus(); showToast('已将历史记录带入分析工作台');
}

document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
document.querySelectorAll('.sample-btn').forEach((button) => button.addEventListener('click', () => fillSample(button.dataset.sample)));
$('analysisImportBtn').addEventListener('click', () => $('analysisImportFile').click());
$('analysisImportFile').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const incoming = parseBatchFile(file, await file.text()); const records = incoming.map(normalizeAnalysisElement).filter(Boolean);
    const skipped = incoming.length - records.length;
    if (!records.length) throw new Error('没有包含元素名称和主要功能的有效记录');
    analysisQueue = [...analysisQueue, ...records]; saveAnalysisQueue(); renderAnalysisQueue();
    if (!$('elementName').value) loadAnalysisQueueItem(analysisQueue.length - records.length);
    showToast(`已导入 ${records.length} 个分析元素${skipped ? `，跳过 ${skipped} 条无效记录` : ''}`);
  } catch (error) { showToast(`元素导入失败：${error.message}`, true); } finally { event.target.value = ''; }
});
$('analysisQueueList').addEventListener('click', (event) => { const button = event.target.closest('[data-queue-index]'); if (button) loadAnalysisQueueItem(Number(button.dataset.queueIndex)); });
$('analysisQueueClear').addEventListener('click', () => { analysisQueue = []; saveAnalysisQueue(); renderAnalysisQueue(); showToast('待分析元素队列已清空'); });
$('fmeaForm').addEventListener('submit', (event) => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.target).entries());
  if (!data.elementName.trim()) { $('elementName').focus(); return; }
  if (!data.function.trim()) { $('function').focus(); showToast('请先填写主要功能', true); return; }
  generate({ ...data, elementName: normalize(data.elementName, '未命名元素'), function: normalize(data.function, '执行定义的业务或控制功能'), inputs: normalize(data.inputs, '上游信号或外部输入'), outputs: normalize(data.outputs, '功能输出'), modes: normalize(data.modes, '正常、降级、关闭'), safetyGoal: normalize(data.safetyGoal) });
});
$('resetBtn').addEventListener('click', resetAnalysis); $('exportBtn').addEventListener('click', exportCsv);
$('copyBtn').addEventListener('click', async () => {
  if (!currentResult) return;
  try { await navigator.clipboard.writeText(JSON.stringify(currentResult, null, 2)); const old = $('copyBtn').innerHTML; $('copyBtn').innerHTML = '<span>✓</span> 已复制'; window.setTimeout(() => { $('copyBtn').innerHTML = old; }, 1400); }
  catch (error) { showToast('浏览器未允许访问剪贴板', true); }
});
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => { document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === tab)); ['table', 'overview', 'basis'].forEach((id) => $(`${id}Tab`).classList.toggle('hidden', id !== tab.dataset.tab)); }));

$('kbForm').addEventListener('submit', (event) => {
  event.preventDefault(); const record = recordFromForm(event.target); const index = knowledgeRecords.findIndex((item) => item.id === record.id);
  if (index >= 0) knowledgeRecords[index] = record; else knowledgeRecords.unshift(record);
  saveKnowledge(); resetKnowledgeForm(); renderKnowledge(); showToast(index >= 0 ? '历史 FMEA 已更新' : '历史 FMEA 已加入知识库');
});
$('kbCancelEdit').addEventListener('click', resetKnowledgeForm);
['kbSearch', 'kbTypeFilter', 'kbStatusFilter'].forEach((id) => $(id).addEventListener(id === 'kbSearch' ? 'input' : 'change', renderKnowledge));
$('kbList').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]'); if (!button) return; const record = knowledgeRecords.find((item) => item.id === button.dataset.id); if (!record) return;
  if (button.dataset.action === 'edit') fillKnowledgeForm(record);
  if (button.dataset.action === 'use') useKnowledgeRecord(record);
  if (button.dataset.action === 'delete' && window.confirm(`确定删除“${record.title}”吗？此操作只影响当前浏览器中的知识库。`)) { knowledgeRecords = knowledgeRecords.filter((item) => item.id !== record.id); saveKnowledge(); renderKnowledge(); if ($('kbRecordId').value === record.id) resetKnowledgeForm(); showToast('记录已删除'); }
});
$('kbImportBtn').addEventListener('click', () => $('kbImportFile').click());
$('kbImportFile').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const incoming = parseBatchFile(file, await file.text()); const knownIds = new Set(knowledgeRecords.map((record) => record.id)); const records = incoming.map((record) => normalizeImportedRecord(record, knownIds)).filter(Boolean);
    if (!records.length) throw new Error('没有符合字段要求的记录');
    knowledgeRecords = [...records, ...knowledgeRecords]; saveKnowledge(); renderKnowledge(); showToast(`已导入 ${records.length} 条历史 FMEA${incoming.length > records.length ? `，跳过 ${incoming.length - records.length} 条无效记录` : ''}`);
  } catch (error) { showToast(`导入失败：${error.message}`, true); } finally { event.target.value = ''; }
});
$('kbExportBtn').addEventListener('click', () => { const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), records: knowledgeRecords }, null, 2); downloadBlob(payload, 'application/json;charset=utf-8;', `FMEA-knowledge-${new Date().toISOString().slice(0, 10)}.json`); });

renderAnalysisQueue(); renderKnowledge();
