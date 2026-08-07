# FMEA Studio

一个无需安装依赖即可运行的 FMEA 分析网页原型。用户可以输入系统、软件或硬件元素，基于失效引导词生成 FMEA 草稿，并把经过评审的历史 FMEA 沉淀为可复用的项目知识。

## 运行

在当前目录启动静态服务器：

```powershell
python -m http.server 4173
```

然后访问 <http://localhost:4173>。

## 项目知识库

在左侧选择“项目知识库”后，可以：

- 手工录入历史 FMEA，包括失效模式、原因、影响、安全措施、S/O/D、审核状态、标签与来源。
- 搜索、筛选、编辑和删除已有记录。
- 通过 JSON 或 CSV 批量导入历史记录，并导出 JSON 进行项目备份和迁移。
- 将历史记录直接带入分析工作台。
- 在生成新分析时，自动匹配并复用状态为“已审核”的相似记录。

知识库默认保存在当前浏览器的 `localStorage` 中，存储键为 `fmea-studio-knowledge-v1`。浏览器数据不是正式项目存档，建议定期导出 JSON 备份。

## 失效模式集

- 软件元素使用 9 个软件专用模式：`After/Late Data flow`、`Before/Early Data flow`、`Corrupt Data flow`、`Memory Memory`、`No Data flow`、`Other than Data flow`、`Skipped Control flow`、`too early Control flow`、`too late Control flow`。
- 选择软件元素后，可多选存储、通信、时序和执行、合理性、范围检测、一致性六个分析维度；结果只展开与所选维度关联的失效模式。
- 安全措施会按所选维度组合 ECC/EDC、NVM 双副本、MPU、CRC、接收超时、滚动计数器、数据 ID、发送回读、看门狗、程序流监控、deadline/alive、合理性校验、范围检查和冗余一致性比较等机制。
- 系统元素和硬件组件继续使用功能丧失、功能降级、输出错误、功能过早、功能过晚、功能间歇、输出超限、数据陈旧 8 个通用模式。
- 软件模式保留中文匹配别名，已有知识库中的“数据陈旧”“功能不执行”“内存溢出”等记录仍可匹配和复用。

## 分析范围

当前规则引擎只生成汽车系统、汽车电子和车载软件相关 FMEA。手工输入和批量导入都会检查元素名称、功能、输入、输出及安全目标中的汽车领域证据。猴子、香蕉、火车、轨道交通、航空等明确的非汽车对象会被阻止；无法识别车辆、ECU、车载网络、底盘、动力、电池或驾驶相关上下文时，会要求补充信息，不生成 FMEA 结果。批量导入中的超范围元素会单独标记，也不会进入结果导出。

## 批量导入

分析工作台的“批量导入元素”支持 JSON 和 CSV。CSV 可以直接使用 `Element,Element type,Standard,Function,Inputs,Outputs,modes,SG` 表头，其中 `Element` 和 `Function` 必填，`modes` 和 `SG` 可留空。字段名匹配不区分大小写、空格、下划线和连字符。导入后系统会一次性完成全部元素的 FMEA 分析，可在批量结果列表中逐项查看，并通过“导出全部”生成合并 CSV。示例见 [`examples/analysis-elements-template.csv`](examples/analysis-elements-template.csv) 和 [`examples/analysis-elements-template.json`](examples/analysis-elements-template.json)。

潜在失效影响采用“直接影响 + 系统后果”的简洁结构；当功能描述较长或输出接口较多时，会提取功能摘要并将接口压缩为“前两项 + 接口总数”。软件安全机制按具体失效模式选择最多两项相关检测/保护机制和一项故障响应，不再为每条失效一次性附加整个机制库。

项目知识库的“批量导入 FMEA”同样支持 JSON 和 CSV。CSV 列顺序不受限制，只要每条记录能识别出元素、失效模式、失效原因、失效影响和安全机制/措施即可导入；记录标题会根据元素和失效模式自动生成。项目、来源、元素类型、功能、S/O/D、审核状态和标签均为可选字段。如果“安全机制”和“安全措施”位于不同列，导入时会自动合并。中英文常见表头及大小写、空格、下划线、连字符差异均可识别。CSV 示例见 [`examples/fmea-records-template.csv`](examples/fmea-records-template.csv)。

字段名同时支持代码字段和中文列名。例如 `elementName` / `元素名称`、`function` / `主要功能`、`failureMode` / `潜在失效模式`。软件元素可通过 `softwareScopes` 或“软件分析维度”导入多选维度。元素类型可以使用 `software`、`system`、`hardware`，也可以直接使用“软件元素”“系统元素”“硬件组件”。无效记录会被跳过并在页面提示数量。

## 当前实现

当前版本使用浏览器端规则引擎生成分析草稿，适合演示输入、分析、知识复用、审核和导出流程。后续接入 LLM 或企业知识服务时，可以将 `app.js` 中的 `buildRows` 替换为后端 API 调用，并保留当前结果数据结构与前端交互。
