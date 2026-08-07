const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appPath = path.join(__dirname, '..', 'app.js');
const source = fs.readFileSync(appPath, 'utf8');
const logicSource = source.slice(0, source.indexOf('function riskClass'));
const knowledgeImportSource = source.slice(source.indexOf('function normalizeImportedRecord'), source.indexOf('function useKnowledgeRecord'));
const context = {
  localStorage: { getItem: () => null, setItem: () => {} },
  document: { getElementById: () => null },
  console
};

vm.createContext(context);
vm.runInContext(`${logicSource}\n${knowledgeImportSource}\nthis.fmeaApi = { buildSoftwareRows, buildSystemRows, parseCsv, normalizeAnalysisElement, analyzeElements, normalizeImportedRecord, validateAutomotiveContext };`, context);

const baseData = {
  elementName: '车速计算测试模块',
  elementType: 'software',
  function: '根据轮速信号计算车辆速度',
  inputs: '轮速信号',
  outputs: '车辆速度'
};

function softwareRows(scopes) {
  return context.fmeaApi.buildSoftwareRows({ ...baseData, softwareScopes: scopes });
}

assert.equal(softwareRows(['storage', 'communication', 'timing', 'plausibility', 'range', 'consistency']).length, 9);

const storageRows = softwareRows(['storage']);
assert.equal(storageRows.map((row) => row.id).join(','), 'SW-FM-004');
for (const mechanism of ['ECC/EDC', 'MPU/栈边界保护', '受控复位']) {
  assert.match(storageRows[0].control, new RegExp(mechanism));
}
assert.doesNotMatch(storageRows[0].control, /CRC|滚动计数器|看门狗/);

assert.equal(
  softwareRows(['communication', 'consistency']).map((row) => row.guideword).join(','),
  'After/Late,Before/Early,Corrupt,Memory,No,Other than'
);
assert.equal(softwareRows(['timing']).length, 5);
assert.equal(softwareRows(['plausibility']).length, 2);
assert.equal(softwareRows(['range']).length, 1);
assert.equal(softwareRows(['consistency']).length, 3);

assert.equal(context.fmeaApi.buildSystemRows({ ...baseData, elementType: 'system' }).length, 8);
assert.equal(context.fmeaApi.buildSystemRows({ ...baseData, elementType: 'hardware' }).length, 8);

const importedRows = context.fmeaApi.parseCsv([
  'Element,Element type,Standard,Function,Inputs,Outputs,modes,SG',
  'Speed module,Software,ISO 26262,Calculate speed,Wheel speed,Vehicle speed,,',
  'BMS,System,AIAG / VDA,Monitor battery,Voltage and temperature,SOC,Normal,Prevent thermal runaway'
].join('\n')).map(context.fmeaApi.normalizeAnalysisElement);

assert.equal(importedRows.length, 2);
assert.equal(importedRows[0].elementName, 'Speed module');
assert.equal(importedRows[0].elementType, 'software');
assert.equal(importedRows[0].function, 'Calculate speed');
assert.equal(importedRows[0].modes, '');
assert.equal(importedRows[0].safetyGoal, '');
assert.equal(importedRows[1].elementType, 'system');
assert.equal(importedRows[1].modes, 'Normal');
assert.equal(importedRows[1].safetyGoal, 'Prevent thermal runaway');

const verboseData = {
  ...baseData,
  function: '采集多个传感器输入，完成滤波、状态估计、故障诊断、降级判断并向多个下游控制器发布计算结果和有效性状态',
  outputs: '车辆速度,车辆加速度,有效性状态,诊断状态,降级请求',
  softwareScopes: ['communication', 'timing', 'plausibility', 'range', 'consistency']
};
const verboseRows = context.fmeaApi.buildSoftwareRows(verboseData);
assert.match(verboseRows[0].effect, /车辆速度、车辆加速度等 5 项接口/);
assert.doesNotMatch(verboseRows[0].effect, /诊断状态|降级请求/);
assert.match(verboseRows.find((row) => row.guideword === 'Corrupt').control, /CRC|合理性/);
assert.doesNotMatch(verboseRows.find((row) => row.guideword === 'Corrupt').control, /ECC|看门狗|物理上下限/);

const batchInput = Array.from({ length: 25 }, (_, index) => ({ ...baseData, elementName: `批量元素 ${index + 1}`, softwareScopes: ['communication'] }));
const batchResults = context.fmeaApi.analyzeElements(batchInput, '2026-08-07T00:00:00.000Z');
assert.equal(batchResults.length, 25);
assert.equal(batchResults.filter((item) => item.analysisStatus === 'complete' && item.result.rows.length > 0).length, 25);
assert.equal(batchResults[24].result.data.elementName, '批量元素 25');

const shuffledKnowledgeRows = context.fmeaApi.parseCsv([
  '安全机制措施,失效影响,Element,失效原因,Failure Mode,来源项目,来源',
  '超时监控并切换降级数据,控制功能使用旧值,车速接口,通信任务未刷新缓存,数据陈旧,底盘项目,评审记录 A'
].join('\n'));
const shuffledKnowledge = context.fmeaApi.normalizeImportedRecord(shuffledKnowledgeRows[0], new Set());
assert.equal(shuffledKnowledge.element, '车速接口');
assert.equal(shuffledKnowledge.failureMode, '数据陈旧');
assert.equal(shuffledKnowledge.cause, '通信任务未刷新缓存');
assert.equal(shuffledKnowledge.effect, '控制功能使用旧值');
assert.equal(shuffledKnowledge.control, '超时监控并切换降级数据');
assert.equal(shuffledKnowledge.project, '底盘项目');
assert.equal(shuffledKnowledge.source, '评审记录 A');
assert.match(shuffledKnowledge.title, /车速接口.*数据陈旧/);

const splitControlRow = context.fmeaApi.parseCsv([
  'Failure Effect,Safety Measure,Element,Failure Cause,Safety Mechanism,Failure Mode',
  'Output unavailable,Switch to fallback,Gateway,Link interrupted,Timeout monitoring,No Data flow'
].join('\n'))[0];
const splitControlKnowledge = context.fmeaApi.normalizeImportedRecord(splitControlRow, new Set());
assert.equal(splitControlKnowledge.control, 'Switch to fallback；Timeout monitoring');
assert.equal(context.fmeaApi.normalizeImportedRecord({ Element: 'A', 'Failure Mode': 'B', 'Failure Cause': 'C', 'Safety Measure': 'D' }, new Set()), null);

for (const elementName of ['猴子', '香蕉', '火车制动控制器']) {
  const scope = context.fmeaApi.validateAutomotiveContext({ elementName, function: '执行状态控制' });
  assert.equal(scope.inScope, false, `${elementName} 不应进入汽车 FMEA 分析`);
}
assert.equal(context.fmeaApi.validateAutomotiveContext({ elementName: '通用数据处理模块', function: '处理输入并输出结果' }).inScope, false);
assert.equal(context.fmeaApi.validateAutomotiveContext(baseData).inScope, true);
assert.equal(context.fmeaApi.validateAutomotiveContext({ elementName: 'BMS', function: '监控电池包 SOC 并控制车载高压接触器' }).inScope, true);
for (const elementName of ['感知模块', '规划模块', '控制模块', '地图模块', '定位模块', 'Perception Module', 'Planning Module', 'Localization Module']) {
  assert.equal(context.fmeaApi.validateAutomotiveContext({ elementName, function: '处理输入并输出结果' }).inScope, true, `${elementName} 应识别为智驾模块`);
}
assert.equal(context.fmeaApi.validateAutomotiveContext({ elementName: '工业控制模块', function: '控制生产线设备' }).inScope, false);

const mixedScopeBatch = context.fmeaApi.analyzeElements([
  baseData,
  { ...baseData, elementName: '猴子', function: '猴子状态识别' },
  { ...baseData, elementName: '火车', function: '列车速度控制' }
]);
assert.equal(mixedScopeBatch.filter((item) => item.analysisStatus === 'complete').length, 1);
assert.equal(mixedScopeBatch.filter((item) => item.analysisStatus === 'out-of-scope' && item.result === null).length, 2);

const adasCsvRows = context.fmeaApi.parseCsv([
  'Element,Element type,Standard,Function,Inputs,Outputs,modes,SG',
  '感知模块,software,ISO 26262,识别车辆周围目标,摄像头和雷达,目标列表,正常,避免漏检关键障碍物',
  '规划模块,software,ISO 26262,生成可行驶轨迹,目标和道路信息,规划轨迹,正常,避免生成不可执行轨迹',
  '控制模块,software,ISO 26262,跟踪规划轨迹,规划轨迹和车辆状态,转向和制动请求,正常,保持车辆稳定控制',
  '地图模块,software,ISO 26262,提供高精地图信息,地图数据,道路拓扑,正常,避免使用错误地图',
  '定位模块,software,ISO 26262,融合 GNSS 和 IMU 计算车辆位置,GNSS 和 IMU,车辆位姿,正常,保证定位连续可信'
].join('\n')).map(context.fmeaApi.normalizeAnalysisElement).filter(Boolean);
const adasBatchResults = context.fmeaApi.analyzeElements(adasCsvRows);
assert.equal(adasCsvRows.length, 5);
assert.equal(adasBatchResults.filter((item) => item.analysisStatus === 'complete' && item.result.rows.length === 9).length, 5);

console.log('FMEA logic tests passed');
