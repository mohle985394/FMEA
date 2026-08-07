const STORAGE_KEY = 'fmea-studio-knowledge-v1';
const ANALYSIS_QUEUE_KEY = 'fmea-studio-analysis-queue-v1';
const ANALYSIS_ENGINE_VERSION = '2.1';

const steps = [
  '检查输入上下文与分析假设',
  '分解元素功能与接口边界',
  '应用适用的失效引导词',
  '检索已审核的历史 FMEA',
  '推导潜在原因与影响链',
  '匹配预防、检测与容错机制',
  '计算风险并执行一致性检查'
];

const systemGuidewords = [
  { word: '功能丧失', label: '完全无法提供功能' },
  { word: '功能降级', label: '输出精度或能力不足' },
  { word: '输出错误', label: '输出值与真实状态不一致' },
  { word: '功能过早', label: '在不应触发时提前执行' },
  { word: '功能过晚', label: '未在要求时间内执行' },
  { word: '功能间歇', label: '功能出现不稳定或间断' },
  { word: '输出超限', label: '输出超过允许范围' },
  { word: '数据陈旧', label: '使用了过期或未更新的数据' }
];

const softwareScopeDefinitions = [
  { key: 'storage', label: '存储' },
  { key: 'communication', label: '通信' },
  { key: 'timing', label: '时序和执行' },
  { key: 'plausibility', label: '合理性' },
  { key: 'range', label: '范围检测' },
  { key: 'consistency', label: '一致性' }
];

const defaultSoftwareScopes = softwareScopeDefinitions.map((scope) => scope.key);

const automotiveScopePatterns = [
  /汽车|车辆|整车|车载|乘用车|商用车|公交车|客车|卡车|货车|摩托车|车速|轮速|车轮|驾驶|乘员|座舱|底盘|转向|制动|油门|动力总成|发动机|变速箱|电驱|电机控制|电池包|充电桩|车门|车灯|雨刮|安全气囊|胎压|泊车|行车/i,
  /\b(vehicle|automotive|car|wheel speed|steering|brake|powertrain|engine|transmission|airbag|cockpit|parking)\b/i,
  /\b(ECU|VCU|BMS|ADAS|ABS|ESC|ESP|EPS|EPB|OBC|TBOX|CAN|LIN|FlexRay|AUTOSAR|ASIL|OBD|UDS)\b/i,
  /ISO\s*26262|域控制器|高压配电盒|车载充电机|直流变换器|荷电状态|SOC|扭矩请求|驾驶辅助/i
];

const outOfScopePatterns = [
  { pattern: /猴子|猿猴|\b(monkey|ape)\b/i, label: '动物对象' },
  { pattern: /香蕉|苹果|橘子|水果|\b(banana|fruit)\b/i, label: '食品或自然对象' },
  { pattern: /火车|铁路|轨道交通|列车|高铁|地铁|机车|\b(train|railway|railroad|locomotive|metro)\b/i, label: '轨道交通对象' },
  { pattern: /飞机|航空|航天|船舶|轮船|\b(aircraft|aviation|spacecraft|ship|marine)\b/i, label: '非汽车交通对象' },
  { pattern: /医疗|药品|金融|证券|电商|农业|家电|\b(medical|pharma|finance|e-commerce|agriculture)\b/i, label: '非汽车行业对象' }
];

const softwareModeMechanisms = {
  'After/Late': {
    mechanisms: [{ scope: 'communication', text: '接收超时与报文 age/时间戳监控' }, { scope: 'timing', text: 'deadline/alive 周期监控' }],
    response: '超时数据置为无效，并切换到降级数据源'
  },
  'Before/Early': {
    mechanisms: [{ scope: 'timing', text: '任务相位与执行顺序监控' }, { scope: 'communication', text: '滚动计数器和时间窗校验' }],
    response: '生效条件满足前禁止发布或使用新数据'
  },
  Corrupt: {
    mechanisms: [{ scope: 'communication', text: '端到端 CRC 与数据 ID 校验' }, { scope: 'plausibility', text: '多源或模型合理性校验' }, { scope: 'consistency', text: '冗余计算结果比较' }],
    response: '异常数据隔离并保留诊断快照'
  },
  Memory: {
    mechanisms: [{ scope: 'storage', text: '按故障对象选择 ECC/EDC 或 MPU/栈边界保护' }, { scope: 'consistency', text: '关键数据冗余副本与读回比较' }],
    response: '检测到破坏后重建数据或执行受控复位'
  },
  No: {
    mechanisms: [{ scope: 'communication', text: '接收超时与滚动计数器监控' }],
    response: '使用安全默认值或降级通道并上报故障'
  },
  'Other than': {
    mechanisms: [{ scope: 'range', text: '物理上下限、量纲和长度检查' }, { scope: 'plausibility', text: '变化率与系统状态关联校验' }, { scope: 'communication', text: '数据 ID 和接口版本校验' }, { scope: 'consistency', text: '双通道结果一致性比较' }],
    response: '越界或语义异常数据应钳位、拒绝或置为无效'
  },
  Skipped: {
    mechanisms: [{ scope: 'timing', text: '逻辑流检查点与任务 alive 监控' }],
    response: '流程异常时停止输出并进入安全状态'
  },
  'too early': {
    mechanisms: [{ scope: 'timing', text: '状态机守卫条件和执行时间窗监控' }],
    response: '前置条件未满足时抑制控制动作'
  },
  'too late': {
    mechanisms: [{ scope: 'timing', text: '独立看门狗与任务 deadline 监控' }],
    response: '超时后终止任务并进入降级状态'
  }
};

const softwareFailureModes = [
  {
    word: 'After/Late', category: 'Data flow', label: '数据流晚到或在截止时间后到达',
    scopes: ['communication', 'timing'],
    matchTerms: ['数据陈旧', '数据延迟', '执行延迟', '超时', '过晚'],
    cause: '生产者任务执行延迟、通信排队或时间戳/缓存未及时刷新',
    effect: (data) => softwareFailureEffect('After/Late', data),
    control: '时间戳与 age/alive 监控；检测端到端截止时间；超时后置无效并切换降级数据源', scores: [9, 3, 3]
  },
  {
    word: 'Before/Early', category: 'Data flow', label: '数据流在允许窗口前提前到达或被使用',
    scopes: ['communication', 'timing'],
    matchTerms: ['数据过早', '提前更新', '功能过早', '过早'],
    cause: '任务相位或同步配置错误，接收方在数据生效条件满足前读取新值',
    effect: (data) => softwareFailureEffect('Before/Early', data),
    control: '校验时间窗、周期序号与生效条件；对跨周期数据执行双缓冲和原子切换', scores: [8, 3, 5]
  },
  {
    word: 'Corrupt', category: 'Data flow', label: '数据内容被破坏、篡改或计算错误',
    scopes: ['communication', 'plausibility', 'consistency'],
    matchTerms: ['收到错误输入', '输出结果错误', '输出错误', '数据篡改', '数据错误'],
    cause: '接口传输错误、数据竞争、错误指针写入或算法计算缺陷导致数据内容异常',
    effect: (data) => softwareFailureEffect('Corrupt', data),
    control: '端到端 CRC/序号保护、范围与合理性校验、冗余计算比较；异常数据隔离并记录诊断快照', scores: [9, 3, 4]
  },
  {
    word: 'Memory', category: 'Memory', label: '内存分配、访问权限或内容完整性异常',
    scopes: ['storage', 'consistency'],
    matchTerms: ['内存溢出', '堆栈溢出', '内存权限错误', '非法访问', '地址故障', '卡滞故障'],
    cause: '堆栈/堆耗尽、越界访问、野指针、内存保护配置错误或 RAM 内容翻转',
    effect: (data) => softwareFailureEffect('Memory', data),
    control: 'MPU 分区与访问保护、ECC/EDC、栈水位与堆边界监控；启动/周期 RAM 测试和受控复位', scores: [10, 3, 5]
  },
  {
    word: 'No', category: 'Data flow', label: '预期数据流完全缺失或未收到',
    scopes: ['communication'],
    matchTerms: ['未收到输入', '数据丢失', '数据缺失', '输出遗漏', '未收到数据'],
    cause: '生产者未发送、通信链路中断、接口配置错误或接收任务停止运行',
    effect: (data) => softwareFailureEffect('No', data),
    control: '接收超时、alive counter 与丢帧监控；缺失时使用安全默认值或降级通道并上报故障', scores: [9, 3, 3]
  },
  {
    word: 'Other than', category: 'Data flow', label: '收到非预期、越界、不完整或类型不符的数据',
    scopes: ['communication', 'plausibility', 'range', 'consistency'],
    matchTerms: ['数据过大', '数据过小', '参数不完整', '输出超限', '数据类型错误', '非预期数据'],
    cause: '接口版本或标定不一致、量纲/数据类型配置错误、参数遗漏或数据超出物理范围',
    effect: (data) => softwareFailureEffect('Other than', data),
    control: '类型、长度、版本和物理范围校验；参数完整性检查；越界数据钳位、拒绝或替换', scores: [9, 3, 4]
  },
  {
    word: 'Skipped', category: 'Control flow', label: '控制流或关键功能步骤被跳过',
    scopes: ['timing'],
    matchTerms: ['功能不执行', '功能部分执行', '程序流程异常', '非法PC跳转', '功能丧失'],
    cause: '条件分支缺陷、程序计数器异常、任务未被调度或异常路径提前返回',
    effect: (data) => softwareFailureEffect('Skipped', data),
    control: '程序流监控、检查点/签名与逻辑流校验；任务 alive 监控；异常时进入安全状态并复位', scores: [9, 3, 5]
  },
  {
    word: 'too early', category: 'Control flow', label: '控制动作或任务在要求时刻前执行',
    scopes: ['timing'],
    matchTerms: ['执行过早', '功能过早', '提前执行', '执行顺序非预期'],
    cause: '调度相位、事件触发条件或状态机转换条件配置错误',
    effect: (data) => softwareFailureEffect('too early', data),
    control: '校验状态机守卫条件和执行顺序；调度表/事件时间窗监控；开展时序与边界测试', scores: [8, 3, 5]
  },
  {
    word: 'too late', category: 'Control flow', label: '控制动作或任务执行过晚、阻塞或超时',
    scopes: ['timing'],
    matchTerms: ['执行阻塞', '执行死锁', '执行活锁', '程序运行超时', '功能过晚', '执行延迟'],
    cause: '任务阻塞、死锁/活锁、优先级反转、负载过高或执行时间超过预算',
    effect: (data) => softwareFailureEffect('too late', data),
    control: '看门狗、任务运行时间与 deadline/alive 监控；优先级和锁分析；超时后终止任务并进入降级状态', scores: [9, 3, 4]
  }
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
let activeQueueIndex = -1;
const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function normalize(value, fallback = '') { return String(value || '').trim() || fallback; }
function clampScore(value, fallback = 1) { const number = Number.parseInt(value, 10); return Number.isFinite(number) ? Math.min(10, Math.max(1, number)) : fallback; }
function createId() { return `KB-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }
function typeLabel(type) { return { software: '软件元素', system: '系统元素', hardware: '硬件组件' }[type] || '未分类'; }
function normalizeElementType(value) { return { software: 'software', system: 'system', hardware: 'hardware', 软件元素: 'software', 系统元素: 'system', 硬件组件: 'hardware' }[normalize(value).toLowerCase()] || 'software'; }

function validateAutomotiveContext(data) {
  const context = [data.elementName, data.function, data.inputs, data.outputs, data.modes, data.safetyGoal].map(normalize).filter(Boolean).join(' ');
  const excluded = outOfScopePatterns.find((item) => item.pattern.test(context));
  if (excluded) return { inScope: false, reason: `检测到${excluded.label}“${context.match(excluded.pattern)?.[0] || data.elementName}”，当前分析仅支持汽车系统、汽车电子与车载软件元素。` };
  const automotiveEvidence = automotiveScopePatterns.flatMap((pattern) => context.match(pattern) || []);
  if (automotiveEvidence.length) return { inScope: true, evidence: [...new Set(automotiveEvidence)].slice(0, 3) };
  return { inScope: false, reason: '未识别到明确的汽车领域上下文。请补充车辆功能、ECU、车载网络、底盘、动力、电池或驾驶相关信息后再分析。' };
}

function showDomainScopeWarning(message) {
  $('domainScopeWarning').textContent = message; $('domainScopeWarning').classList.remove('hidden'); showToast(message, true);
}

function clearDomainScopeWarning() { $('domainScopeWarning').classList.add('hidden'); $('domainScopeWarning').textContent = ''; }

function compactPhrase(value, maxLength = 48) {
  const text = normalize(value).replace(/\s+/g, ' ');
  if (!text || text.length <= maxLength) return text;
  const firstClause = text.split(/[。；;.!?！？]/)[0].trim();
  if (firstClause && firstClause.length <= maxLength) return firstClause;
  return `${text.slice(0, maxLength).trim()}…`;
}

function summarizeInterfaces(value, fallback = '关键接口') {
  const items = normalize(value).split(/[，,；;\n|]+/).map((item) => compactPhrase(item, 28)).filter(Boolean);
  if (!items.length) return fallback;
  if (items.length === 1) return items[0];
  return `${items.slice(0, 2).join('、')}${items.length > 2 ? `等 ${items.length} 项接口` : ''}`;
}

function softwareFailureEffect(mode, data) {
  const fn = compactPhrase(data.function, 42) || '目标功能';
  const inputs = summarizeInterfaces(data.inputs, '必要输入');
  const outputs = summarizeInterfaces(data.outputs, '关键输出');
  const safetyTail = data.safetyGoal ? '，可能违反既定安全目标' : '';
  const effects = {
    'After/Late': `直接影响：${outputs}未在截止时间内更新；系统后果：使用方可能继续采用上一周期值，导致${fn}响应滞后${safetyTail}。`,
    'Before/Early': `直接影响：${outputs}在生效条件满足前被发布；系统后果：数据与当前周期或状态不一致，可能触发提前响应${safetyTail}。`,
    Corrupt: `直接影响：${outputs}内容错误但可能仍被判为有效；系统后果：下游基于错误状态决策，导致${fn}结果偏离真实状态${safetyTail}。`,
    Memory: `直接影响：关键状态、参数或执行上下文被破坏；系统后果：计算结果不可预测、任务异常退出或软件失控${safetyTail}。`,
    No: `直接影响：${inputs}缺失，${outputs}无法更新；系统后果：${fn}中断或进入降级状态${safetyTail}。`,
    'Other than': `直接影响：${outputs}越界、类型不符或语义不完整；系统后果：下游可能误判状态或产生非预期控制量${safetyTail}。`,
    Skipped: `直接影响：${fn}的关键处理步骤被跳过；系统后果：${outputs}缺失或未经校验，安全约束可能失效。`,
    'too early': `直接影响：${outputs}在前置条件满足前更新；系统后果：产生时序竞争或非预期状态切换${safetyTail}。`,
    'too late': `直接影响：${fn}超过执行预算，${outputs}延迟更新；系统后果：控制或故障响应窗口被压缩${safetyTail}。`
  };
  return effects[mode];
}

function selectSoftwareMechanisms(mode, matchedScopes) {
  const definition = softwareModeMechanisms[mode];
  const mechanisms = definition.mechanisms.filter((item) => matchedScopes.includes(item.scope)).slice(0, 2);
  return { text: [...mechanisms.map((item) => item.text), definition.response].join('；'), scopes: mechanisms.map((item) => item.scope) };
}

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

function normalizeImportKey(value) { return String(value ?? '').replace(/^\ufeff/, '').trim().toLowerCase().replace(/[\s_\-/()（）]+/g, ''); }

function importValue(record, keys) {
  const directKey = keys.find((candidate) => Object.prototype.hasOwnProperty.call(record, candidate));
  if (directKey) return record[directKey];
  const normalizedRecordKeys = new Map(Object.keys(record).map((key) => [normalizeImportKey(key), key]));
  const matchedKey = keys.map(normalizeImportKey).map((key) => normalizedRecordKeys.get(key)).find(Boolean);
  return matchedKey ? record[matchedKey] : '';
}

function importValues(record, keys) {
  const candidates = new Set(keys.map(normalizeImportKey));
  const values = Object.entries(record).filter(([key]) => candidates.has(normalizeImportKey(key))).map(([, value]) => normalize(value)).filter(Boolean);
  return [...new Set(values)].join('；');
}

function normalizeSoftwareScopes(value, fallback = defaultSoftwareScopes) {
  const rawValues = Array.isArray(value) ? value : normalize(value).split(/[,，、/|;]/).map((item) => item.trim()).filter(Boolean);
  const scopes = rawValues.map((item) => {
    const normalized = normalize(item).toLowerCase();
    return softwareScopeDefinitions.find((scope) => scope.key === normalized || scope.label === item)?.key;
  }).filter(Boolean);
  return scopes.length ? [...new Set(scopes)] : [...fallback];
}

function getSelectedSoftwareScopes() { return [...document.querySelectorAll('input[name="softwareScope"]:checked')].map((input) => input.value); }

function softwareModeCount(scopes) { return softwareFailureModes.filter((failureMode) => failureMode.scopes.some((scope) => scopes.includes(scope))).length; }

function updateSoftwareScopeState() {
  const isSoftware = $('elementType').value === 'software'; const field = $('softwareScopeField'); const scopes = getSelectedSoftwareScopes();
  field.hidden = !isSoftware; field.classList.toggle('invalid', isSoftware && scopes.length === 0);
  $('softwareScopeSummary').textContent = scopes.length ? `已选择 ${scopes.length} 个维度 · 覆盖 ${softwareModeCount(scopes)} 个软件失效模式` : '请至少选择 1 个软件分析维度';
}

function setSoftwareScopes(scopes = defaultSoftwareScopes) {
  const selected = new Set(normalizeSoftwareScopes(scopes));
  document.querySelectorAll('input[name="softwareScope"]').forEach((input) => { input.checked = selected.has(input.value); });
  updateSoftwareScopeState();
}

function normalizeAnalysisElement(record) {
  if (!record) return null;
  const elementName = normalize(importValue(record, ['elementName', 'element', 'name', '系统 / 软件元素', '元素名称']));
  const functionText = normalize(importValue(record, ['function', '主要功能', '功能描述']));
  if (!elementName || !functionText) return null;
  const elementType = importValue(record, ['elementType', 'type', '元素类型']);
  const softwareScopes = normalizeSoftwareScopes(importValue(record, ['softwareScopes', 'analysisScopes', '软件分析维度']));
  return { elementName, elementType: normalizeElementType(elementType), standard: normalize(importValue(record, ['standard', '分析标准']), 'IEC 60812'), function: functionText, inputs: normalize(importValue(record, ['inputs', 'input', '输入 / 依赖', '输入'])), outputs: normalize(importValue(record, ['outputs', 'output', '输出 / 接口', '输出'])), modes: normalize(importValue(record, ['modes', '运行模式'])), safetyGoal: normalize(importValue(record, ['safetyGoal', 'safety', 'SG', '安全目标 / 关键约束', '安全目标'])), softwareScopes };
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

function fillSample(type) { Object.entries(samples[type]).forEach(([key, value]) => { if ($(key)) $(key).value = value; }); if (type === 'software') setSoftwareScopes(defaultSoftwareScopes); else updateSoftwareScopeState(); }

function fillAnalysisForm(data) { Object.entries(data).forEach(([key, value]) => { if (key !== 'softwareScopes' && $(key)) $(key).value = value || ''; }); setSoftwareScopes(data.softwareScopes || defaultSoftwareScopes); updateSoftwareScopeState(); }

function renderAnalysisQueue() {
  const panel = $('analysisQueuePanel'); if (!panel) return;
  const completed = analysisQueue.filter((item) => item.analysisStatus === 'complete' && item.result).length;
  const rejected = analysisQueue.filter((item) => item.analysisStatus === 'out-of-scope').length;
  panel.classList.toggle('hidden', analysisQueue.length === 0); $('analysisQueueCount').textContent = analysisQueue.length; $('analysisQueueCompleted').textContent = completed; $('analysisQueueRejected').textContent = rejected;
  $('analysisQueueList').innerHTML = analysisQueue.map((item, index) => {
    const isRejected = item.analysisStatus === 'out-of-scope'; const statusText = item.analysisStatus === 'complete' ? `已完成 · ${item.result.rows.length} 个失效模式` : isRejected ? '不在汽车 FMEA 分析范围内' : '等待分析';
    return `<div class="analysis-queue-item ${index === activeQueueIndex ? 'loaded' : ''} ${item.analysisStatus === 'complete' ? 'complete' : ''} ${isRejected ? 'out-of-scope' : ''}"><div><strong>${escapeHtml(item.elementName)}</strong><span>${escapeHtml(typeLabel(item.elementType))} · ${escapeHtml(compactPhrase(item.function, 34))}</span><small>${escapeHtml(statusText)}</small></div><button class="queue-load-btn" type="button" ${isRejected ? 'disabled' : `data-queue-index="${index}"`}>${item.analysisStatus === 'complete' ? '查看结果' : isRejected ? '不适用' : '立即分析'}</button></div>`;
  }).join('');
}

function renderBatchNavigator() {
  const nav = $('batchResultNav'); if (!nav) return;
  const completedIndexes = analysisQueue.map((item, index) => item.result ? index : -1).filter((index) => index >= 0);
  nav.classList.toggle('hidden', completedIndexes.length < 2 || activeQueueIndex < 0);
  $('batchResultSelect').innerHTML = completedIndexes.map((index, position) => `<option value="${index}">${position + 1} / ${completedIndexes.length} · ${escapeHtml(analysisQueue[index].elementName)}</option>`).join('');
  $('batchResultSelect').value = String(activeQueueIndex);
  const position = completedIndexes.indexOf(activeQueueIndex);
  $('batchPrevBtn').disabled = position <= 0; $('batchNextBtn').disabled = position < 0 || position >= completedIndexes.length - 1;
  $('exportBtn').innerHTML = completedIndexes.length > 1 && activeQueueIndex >= 0 ? `<span>⇩</span> 导出全部 ${completedIndexes.length} 个元素` : '<span>⇩</span> 导出 CSV';
}

function showAnalysisQueueResult(index, notify = true) {
  const item = analysisQueue[index]; if (!item) return;
  if (!item.result) analysisQueue[index] = analyzeElements([item])[0];
  if (analysisQueue[index].analysisStatus === 'out-of-scope') { saveAnalysisQueue(); renderAnalysisQueue(); showDomainScopeWarning(analysisQueue[index].scopeReason); return; }
  clearDomainScopeWarning();
  activeQueueIndex = index; currentResult = analysisQueue[index].result; fillAnalysisForm(currentResult.data); saveAnalysisQueue(); renderAnalysisQueue(); renderResult(currentResult); renderBatchNavigator();
  $('emptyState').classList.add('hidden'); $('loadingState').classList.add('hidden'); $('resultState').classList.remove('hidden'); $('exportBtn').disabled = false;
  if (notify) showToast(`正在查看第 ${index + 1} / ${analysisQueue.length} 个元素的分析结果`);
}

function migrateAnalysisQueue() {
  let changed = false;
  analysisQueue = analysisQueue.map((item) => {
    if (item.engineVersion === ANALYSIS_ENGINE_VERSION && ((item.analysisStatus === 'complete' && item.result) || item.analysisStatus === 'out-of-scope')) return item;
    changed = true; return analyzeElements([item])[0];
  });
  if (changed) saveAnalysisQueue();
}

function storeResultForActiveQueue(result) {
  if (activeQueueIndex < 0 || !analysisQueue[activeQueueIndex]) return;
  const analyzedAt = new Date().toISOString();
  analysisQueue[activeQueueIndex] = { ...result.data, analysisStatus: 'complete', analyzedAt, engineVersion: ANALYSIS_ENGINE_VERSION, result: { ...result, analyzedAt, engineVersion: ANALYSIS_ENGINE_VERSION } };
  currentResult = analysisQueue[activeQueueIndex].result; saveAnalysisQueue(); renderAnalysisQueue(); renderBatchNavigator();
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
  const softwareFamilyMismatch = (record.elementType === 'software') !== (data.elementType === 'software');
  if (softwareFamilyMismatch) return 0;
  const recordMode = normalizeMatchText(record.failureMode); const matchTerms = [row.guideword, ...(row.matchTerms || [])];
  if (!matchTerms.some((term) => recordMode.includes(normalizeMatchText(term)))) return 0;
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
    const control = normalize(record.control, row.control);
    return { ...row, cause: normalize(record.cause, row.cause), effect: normalize(record.effect, row.effect), control, s, o, d, rpn: s * o * d, status: '知识库复用', knowledgeId: record.id, knowledgeTitle: record.title, knowledgeSource: record.source, matchScore: Math.min(99, Math.round(score * 10)) };
  });
}

function buildSoftwareRows(data) {
  const selectedScopes = data.softwareScopes?.length ? data.softwareScopes : defaultSoftwareScopes;
  return softwareFailureModes.flatMap((failureMode, index) => {
    const matchedScopes = failureMode.scopes.filter((scope) => selectedScopes.includes(scope)); if (!matchedScopes.length) return [];
    const [s, o, d] = failureMode.scores;
    const scopeLabels = matchedScopes.map((scope) => softwareScopeDefinitions.find((definition) => definition.key === scope).label); const selectedMechanisms = selectSoftwareMechanisms(failureMode.word, matchedScopes);
    return [{ id: `SW-FM-${String(index + 1).padStart(3, '0')}`, guideword: failureMode.word, category: failureMode.category, modeSet: '软件', mode: `${failureMode.word} ${failureMode.category}：${failureMode.label}`, modeDetail: `${failureMode.category} · ${scopeLabels.join('/')} · ${failureMode.label}`, matchTerms: failureMode.matchTerms, analysisScopes: matchedScopes, mechanismScopes: selectedMechanisms.scopes, cause: failureMode.cause, effect: failureMode.effect(data), control: selectedMechanisms.text, scopeControl: selectedMechanisms.text, s, o, d, rpn: s * o * d, status: s * o * d >= 100 ? '优先行动' : '待审核' }];
  });
}

function buildSystemRows(data) {
  const fn = compactPhrase(data.function, 42) || '目标功能'; const input = summarizeInterfaces(data.inputs, '必要输入'); const output = summarizeInterfaces(data.outputs, '关键输出');
  const causes = ['传感器、执行器或供电链路发生硬件故障', '信号受到噪声、干扰或连接器接触不良影响', '保护阈值、标定参数或配置不符合设计要求', '通信报文丢失、延迟或完整性校验失败', '环境温度、振动或负载超出设计边界', '诊断机制未覆盖该故障组合', '故障恢复顺序或状态切换不正确', '维护、装配或返修过程引入异常'];
  const effects = [`直接影响：${input}无法支撑${fn}；系统后果：${output}不可用，相关功能中断或进入降级状态。`, `直接影响：${output}精度或可用性下降；系统后果：上层获得不完整信息，功能性能退化。`, `直接影响：${output}与真实状态不一致；系统后果：上层可能基于错误信息决策。`, `直接影响：${output}在触发条件满足前改变；系统后果：可能出现非预期动作或状态切换。`, `直接影响：${output}未在规定时间更新；系统后果：控制和故障响应窗口被压缩。`, '直接影响：功能输出周期性中断或抖动；系统后果：可能形成难以复现的间歇性控制异常。', `直接影响：${output}超过设计边界；系统后果：相关执行功能可能被过度驱动。`, `直接影响：${output}保持旧值；系统后果：上层无法及时感知真实状态变化。`];
  const controls = ['冗余传感器与合理性校验；异常通道隔离', '屏蔽、滤波、接地和连接器诊断；检测信号抖动', '参数范围约束、写保护和配置一致性检查', '通信超时、计数器和 CRC 校验；失联进入安全状态', '温度、电流和负载监测；超限限制功率', '诊断覆盖率评审与故障注入测试', '定义受控的故障恢复和接触器动作顺序', '装配检查、返修确认和端到端 EOL 测试'];
  const scores = [[9, 3, 4], [8, 4, 5], [9, 3, 6], [8, 3, 4], [7, 4, 5], [8, 2, 6], [9, 2, 4], [7, 3, 5]];
  return systemGuidewords.map((guideword, index) => {
    const [s, o, d] = scores[index];
    return { id: `FM-${String(index + 1).padStart(3, '0')}`, guideword: guideword.word, category: data.elementType === 'hardware' ? 'Hardware' : 'System', modeSet: '系统/硬件', mode: `${guideword.word}：${guideword.label}`, modeDetail: guideword.label, matchTerms: [guideword.word], cause: causes[index], effect: effects[index], control: controls[index], s, o, d, rpn: s * o * d, status: s * o * d >= 100 ? '优先行动' : '待审核' };
  });
}

function buildRows(data) { return applyKnowledge(data.elementType === 'software' ? buildSoftwareRows(data) : buildSystemRows(data), data); }

function analysisDataFromQueueItem(item) {
  const elementType = normalizeElementType(item.elementType);
  return { elementName: normalize(item.elementName, '未命名元素'), elementType, standard: normalize(item.standard, 'IEC 60812'), function: normalize(item.function, '执行定义的业务或控制功能'), inputs: normalize(item.inputs, '上游信号或外部输入'), outputs: normalize(item.outputs, '功能输出'), modes: normalize(item.modes), safetyGoal: normalize(item.safetyGoal), softwareScopes: elementType === 'software' ? normalizeSoftwareScopes(item.softwareScopes) : [] };
}

function createAnalysisResult(item, analyzedAt = new Date().toISOString()) {
  const data = analysisDataFromQueueItem(item);
  return { data, rows: buildRows(data), analyzedAt, engineVersion: ANALYSIS_ENGINE_VERSION };
}

function analyzeElements(items, analyzedAt = new Date().toISOString()) {
  return items.map((item) => {
    const data = analysisDataFromQueueItem(item); const scopeValidation = validateAutomotiveContext(data);
    if (!scopeValidation.inScope) return { ...data, analysisStatus: 'out-of-scope', scopeReason: scopeValidation.reason, analyzedAt, engineVersion: ANALYSIS_ENGINE_VERSION, result: null };
    const result = createAnalysisResult(data, analyzedAt);
    return { ...result.data, analysisStatus: 'complete', analyzedAt, engineVersion: ANALYSIS_ENGINE_VERSION, result };
  });
}

function riskClass(value) { return value >= 100 ? 'high' : value >= 70 ? 'mid' : 'low'; }
function scoreClass(value) { return value >= 8 ? 'score-high' : value >= 5 ? 'score-mid' : 'score-low'; }

function renderTable(rows) {
  const knowledgeCount = rows.filter((row) => row.knowledgeId).length;
  const modeSet = rows[0]?.modeSet || '适用'; const scopeLabels = [...new Set(rows.flatMap((row) => row.analysisScopes || []))].map((scope) => softwareScopeDefinitions.find((definition) => definition.key === scope)?.label).filter(Boolean);
  $('analysisCoverageText').innerHTML = `<span class="filter-icon">≡</span> 已应用 ${rows.length} 个${modeSet}失效引导词${scopeLabels.length ? ` · ${scopeLabels.join(' / ')}` : ''}${knowledgeCount ? ` · 复用 ${knowledgeCount} 条历史知识` : ''}`;
  $('fmeaBody').innerHTML = rows.map((row) => {
    const statusClass = row.status === '知识库复用' ? 'knowledge-chip' : row.status === '优先行动' ? 'risk-chip high' : 'review-chip';
    const source = row.knowledgeTitle ? `<br><span class="muted-text">来源：${escapeHtml(row.knowledgeTitle)}</span>` : '';
    return `<tr><td><strong>${escapeHtml(row.id)}</strong></td><td><strong>${escapeHtml(row.guideword)}</strong><br><span class="muted-text">${escapeHtml(row.modeDetail)}</span>${source}</td><td>${escapeHtml(row.cause)}</td><td>${escapeHtml(row.effect)}</td><td>${escapeHtml(row.control)}</td><td class="${scoreClass(row.s)}">${row.s}</td><td class="${scoreClass(row.o)}">${row.o}</td><td class="${scoreClass(row.d)}">${row.d}</td><td><strong class="${riskClass(row.rpn) === 'high' ? 'score-high' : riskClass(row.rpn) === 'mid' ? 'score-mid' : 'score-low'}">${row.rpn}</strong></td><td><span class="${statusClass}">${escapeHtml(row.status)}</span></td></tr>`;
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
  const isSoftware = data.elementType === 'software'; const modeSet = isSoftware ? '软件失效模式集（Data flow / Control flow / Memory）' : '系统/硬件通用失效模式集'; const selectedScopeLabels = isSoftware ? (data.softwareScopes || defaultSoftwareScopes).map((scope) => softwareScopeDefinitions.find((definition) => definition.key === scope)?.label).filter(Boolean) : [];
  const items = [['元素类型', typeLabel(data.elementType)], ['失效模式集', modeSet], ...(isSoftware ? [['软件分析维度', selectedScopeLabels.join('、')]] : []), ['分析标准', data.standard], ['主要功能', data.function], ['输入 / 依赖', data.inputs], ['输出 / 接口', data.outputs], ['运行模式', data.modes]];
  $('contextList').innerHTML = items.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value || '未提供')}</dd>`).join('');
  const reused = rows.filter((row) => row.knowledgeId);
  const assumptions = [`基于“${data.function}”作为当前功能定义进行分析。`, `已应用 ${rows.length} 个${isSoftware ? '软件' : '系统/硬件'}失效引导词${isSoftware ? `，覆盖维度：${selectedScopeLabels.join('、')}` : ''}，实际适用性需结合架构、接口和时序约束复核。`, data.safetyGoal ? `安全约束：${data.safetyGoal}` : '未提供明确安全目标，风险影响按通用安全假设生成。', reused.length ? `已复用 ${reused.length} 条已审核历史记录：${reused.map((row) => row.knowledgeTitle).join('、')}。` : '当前没有达到匹配阈值的已审核历史 FMEA。', 'S/O/D 评分为规则引擎或历史记录建议值，需由安全工程师结合当前项目确认。'];
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
    window.clearInterval(timer); currentResult = { data, rows: buildRows(data), analyzedAt: new Date().toISOString(), engineVersion: ANALYSIS_ENGINE_VERSION }; storeResultForActiveQueue(currentResult); renderResult(currentResult); $('loadingState').classList.add('hidden'); $('resultState').classList.remove('hidden'); $('generateBtn').disabled = false; $('generateBtn').innerHTML = '<span class="spark">✦</span> 重新生成分析'; $('exportBtn').disabled = false;
  }, 350);
}

function renderResult(result) {
  const { data, rows } = result;
  $('resultTitle').textContent = data.elementName; $('resultType').textContent = typeLabel(data.elementType); $('resultStandard').textContent = data.standard; $('resultModeSet').textContent = data.elementType === 'software' ? '软件模式集' : '系统/硬件模式集'; $('metricModes').textContent = rows.length; $('metricHigh').textContent = rows.filter((row) => row.rpn >= 100).length; $('metricRpn').textContent = Math.round(rows.reduce((sum, row) => sum + row.rpn, 0) / rows.length); $('tableCount').textContent = rows.length;
  renderTable(rows); renderOverview(rows); renderBasis(data, rows); renderBatchNavigator();
}

function downloadBlob(content, mimeType, fileName) {
  const blob = new Blob([content], { type: mimeType }); const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = fileName; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv() {
  if (!currentResult) return;
  const batchResults = activeQueueIndex >= 0 ? analysisQueue.map((item) => item.result).filter(Boolean) : [];
  const results = batchResults.length > 1 ? batchResults : [currentResult];
  const header = ['元素名称', '元素类型', '分析标准', 'ID', '失效引导词', '失效类别', '潜在失效模式', '潜在失效原因', '潜在失效影响', '安全措施/机制', 'S', 'O', 'D', 'RPN', '状态', '知识库来源'];
  const dataRows = results.flatMap((result) => result.rows.map((row) => [result.data.elementName, typeLabel(result.data.elementType), result.data.standard, row.id, row.guideword, row.category, row.mode, row.cause, row.effect, row.control, row.s, row.o, row.d, row.rpn, row.status, row.knowledgeSource || '']));
  const lines = [header, ...dataRows].map((line) => line.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','));
  const fileName = results.length > 1 ? `FMEA-batch-${results.length}-elements.csv` : `${currentResult.data.elementName}-FMEA.csv`;
  downloadBlob(`\ufeff${lines.join('\n')}`, 'text/csv;charset=utf-8;', fileName);
}

function resetAnalysis() {
  activeQueueIndex = -1; clearDomainScopeWarning(); $('fmeaForm').reset(); $('elementType').value = 'software'; setSoftwareScopes(defaultSoftwareScopes); $('emptyState').classList.remove('hidden'); $('loadingState').classList.add('hidden'); $('resultState').classList.add('hidden'); $('exportBtn').disabled = true; $('exportBtn').innerHTML = '<span>⇩</span> 导出 CSV'; currentResult = null; renderAnalysisQueue();
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
  if (!record) return null;
  const element = normalize(importValue(record, ['element', 'elementName', 'item', 'component', 'systemElement', 'softwareElement', 'hardwareElement', '元素', '元素名称', '分析元素', '系统 / 软件元素', '系统元素', '软件元素', '硬件元素']));
  const failureMode = normalize(importValue(record, ['failureMode', 'potentialFailureMode', 'mode', 'failure', '潜在失效模式', '失效模式', '故障模式']));
  const cause = normalize(importValue(record, ['cause', 'failureCause', 'potentialFailureCause', 'rootCause', '潜在失效原因', '失效原因', '故障原因', '根本原因']));
  const effect = normalize(importValue(record, ['effect', 'failureEffect', 'potentialFailureEffect', 'failureImpact', 'impact', '潜在失效影响', '失效影响', '故障影响', '后果']));
  const control = normalize(importValues(record, ['control', 'controls', 'safetyControl', 'safetyMechanism', 'safetyMeasure', 'safetyMechanismMeasure', 'preventionControl', 'detectionControl', 'mitigation', 'measure', 'mechanism', '措施', '机制', '安全措施', '安全机制', '安全机制措施', '安全机制 / 措施', '安全措施 / 机制', '预防控制', '探测控制']));
  if (!element || !failureMode || !cause || !effect || !control) return null;
  const title = normalize(importValue(record, ['title', 'recordTitle', 'fmeaTitle', '记录标题', '标题']), `${element} · ${compactPhrase(failureMode, 32)}`);
  let id = normalize(importValue(record, ['id', '记录 ID', '编号']), createId()); if (knownIds.has(id)) id = createId(); knownIds.add(id); const now = new Date().toISOString();
  const tags = importValue(record, ['tags', '标签']); const elementType = importValue(record, ['elementType', 'type', '元素类型']); const reviewStatus = importValue(record, ['reviewStatus', 'status', '审核状态']);
  return { id, title, project: normalize(importValue(record, ['project', 'projectName', 'sourceProject', '来源项目', '项目', '项目名称'])), elementType: normalizeElementType(elementType), element, function: normalize(importValue(record, ['function', '功能描述', '主要功能'])), failureMode, cause, effect, control, s: clampScore(importValue(record, ['s', 'S']), 7), o: clampScore(importValue(record, ['o', 'O']), 3), d: clampScore(importValue(record, ['d', 'D']), 4), reviewStatus: reviewStatus === 'draft' || reviewStatus === '草稿' ? 'draft' : 'approved', tags: Array.isArray(tags) ? tags.map((tag) => normalize(tag)).filter(Boolean) : normalize(tags).split(/[,，]/).map((tag) => tag.trim()).filter(Boolean), source: normalize(importValue(record, ['source', 'reference', 'basis', 'evidence', 'document', '依据 / 来源', '依据', '来源', '参考文件'])), createdAt: importValue(record, ['createdAt', '创建时间']) || now, updatedAt: now };
}

function useKnowledgeRecord(record) {
  activeQueueIndex = -1; $('elementName').value = record.element; $('elementType').value = record.elementType; $('function').value = record.function; $('safetyGoal').value = record.effect; if (record.elementType === 'software') setSoftwareScopes(defaultSoftwareScopes); else updateSoftwareScopeState(); navigate('analysis'); $('elementName').focus(); showToast('已将历史记录带入分析工作台');
}

document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
document.querySelectorAll('.sample-btn').forEach((button) => button.addEventListener('click', () => fillSample(button.dataset.sample)));
$('elementType').addEventListener('change', updateSoftwareScopeState);
document.querySelectorAll('input[name="softwareScope"]').forEach((input) => input.addEventListener('change', updateSoftwareScopeState));
$('analysisImportBtn').addEventListener('click', () => $('analysisImportFile').click());
$('analysisImportFile').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const incoming = parseBatchFile(file, await file.text()); const records = incoming.map(normalizeAnalysisElement).filter(Boolean);
    const skipped = incoming.length - records.length;
    if (!records.length) throw new Error('没有包含元素名称和主要功能的有效记录');
    const firstImportedIndex = analysisQueue.length; const analyzedRecords = analyzeElements(records); const completed = analyzedRecords.filter((item) => item.analysisStatus === 'complete').length; const rejected = analyzedRecords.length - completed;
    analysisQueue = [...analysisQueue, ...analyzedRecords]; saveAnalysisQueue(); renderAnalysisQueue(); const firstCompletedOffset = analyzedRecords.findIndex((item) => item.analysisStatus === 'complete');
    if (firstCompletedOffset >= 0) showAnalysisQueueResult(firstImportedIndex + firstCompletedOffset, false);
    if (rejected) showDomainScopeWarning(`已阻止 ${rejected} 个非汽车或领域不明确的元素生成 FMEA；已完成 ${completed} 个汽车元素。`); else showToast(`已导入并完成 ${completed} 个元素的 FMEA 分析${skipped ? `，跳过 ${skipped} 条无效记录` : ''}`);
  } catch (error) { showToast(`元素导入失败：${error.message}`, true); } finally { event.target.value = ''; }
});
$('analysisQueueList').addEventListener('click', (event) => { const button = event.target.closest('[data-queue-index]'); if (button) showAnalysisQueueResult(Number(button.dataset.queueIndex)); });
$('analysisQueueClear').addEventListener('click', () => { analysisQueue = []; activeQueueIndex = -1; currentResult = null; saveAnalysisQueue(); renderAnalysisQueue(); $('resultState').classList.add('hidden'); $('emptyState').classList.remove('hidden'); $('exportBtn').disabled = true; $('exportBtn').innerHTML = '<span>⇩</span> 导出 CSV'; showToast('批量分析结果已清空'); });
$('batchResultSelect').addEventListener('change', (event) => showAnalysisQueueResult(Number(event.target.value), false));
$('batchPrevBtn').addEventListener('click', () => { const indexes = analysisQueue.map((item, index) => item.result ? index : -1).filter((index) => index >= 0); const position = indexes.indexOf(activeQueueIndex); if (position > 0) showAnalysisQueueResult(indexes[position - 1], false); });
$('batchNextBtn').addEventListener('click', () => { const indexes = analysisQueue.map((item, index) => item.result ? index : -1).filter((index) => index >= 0); const position = indexes.indexOf(activeQueueIndex); if (position >= 0 && position < indexes.length - 1) showAnalysisQueueResult(indexes[position + 1], false); });
$('fmeaForm').addEventListener('submit', (event) => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.target).entries()); const softwareScopes = getSelectedSoftwareScopes();
  if (!data.elementName.trim()) { $('elementName').focus(); return; }
  if (!data.function.trim()) { $('function').focus(); showToast('请先填写主要功能', true); return; }
  if (data.elementType === 'software' && !softwareScopes.length) { $('softwareScopeField').classList.add('invalid'); document.querySelector('input[name="softwareScope"]').focus(); showToast('请至少选择一个软件分析维度', true); return; }
  const normalizedData = { ...data, softwareScopes: data.elementType === 'software' ? softwareScopes : [], elementName: normalize(data.elementName, '未命名元素'), function: normalize(data.function, '执行定义的业务或控制功能'), inputs: normalize(data.inputs, '上游信号或外部输入'), outputs: normalize(data.outputs, '功能输出'), modes: normalize(data.modes, '正常、降级、关闭'), safetyGoal: normalize(data.safetyGoal) }; const scopeValidation = validateAutomotiveContext(normalizedData);
  if (!scopeValidation.inScope) { $('elementName').focus(); showDomainScopeWarning(scopeValidation.reason); return; }
  clearDomainScopeWarning(); generate(normalizedData);
});
['elementName', 'function', 'inputs', 'outputs', 'safetyGoal'].forEach((id) => $(id).addEventListener('input', clearDomainScopeWarning));
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
    if (!records.length) throw new Error('没有同时包含元素、失效模式、失效原因、失效影响和安全机制/措施的有效记录');
    knowledgeRecords = [...records, ...knowledgeRecords]; saveKnowledge(); renderKnowledge(); showToast(`已导入 ${records.length} 条历史 FMEA${incoming.length > records.length ? `，跳过 ${incoming.length - records.length} 条无效记录` : ''}`);
  } catch (error) { showToast(`导入失败：${error.message}`, true); } finally { event.target.value = ''; }
});
$('kbExportBtn').addEventListener('click', () => { const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), records: knowledgeRecords }, null, 2); downloadBlob(payload, 'application/json;charset=utf-8;', `FMEA-knowledge-${new Date().toISOString().slice(0, 10)}.json`); });

migrateAnalysisQueue(); setSoftwareScopes(defaultSoftwareScopes); renderAnalysisQueue(); renderKnowledge();
if (analysisQueue.length) showAnalysisQueueResult(Math.max(0, analysisQueue.findIndex((item) => item.result)), false);
