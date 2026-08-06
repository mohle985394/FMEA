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

## 批量导入

分析工作台的“批量导入元素”支持 JSON 和 CSV。每条记录至少需要元素名称与主要功能，导入后会进入待分析队列，并可逐项载入当前分析表单。JSON 示例见 [`examples/analysis-elements-template.json`](examples/analysis-elements-template.json)。

项目知识库的“批量导入 FMEA”同样支持 JSON 和 CSV。每条记录至少需要记录标题、元素名称、潜在失效模式和安全措施。CSV 示例见 [`examples/fmea-records-template.csv`](examples/fmea-records-template.csv)。

字段名同时支持代码字段和中文列名。例如 `elementName` / `元素名称`、`function` / `主要功能`、`failureMode` / `潜在失效模式`。元素类型可以使用 `software`、`system`、`hardware`，也可以直接使用“软件元素”“系统元素”“硬件组件”。无效记录会被跳过并在页面提示数量。

## 当前实现

当前版本使用浏览器端规则引擎生成分析草稿，适合演示输入、分析、知识复用、审核和导出流程。后续接入 LLM 或企业知识服务时，可以将 `app.js` 中的 `buildRows` 替换为后端 API 调用，并保留当前结果数据结构与前端交互。
