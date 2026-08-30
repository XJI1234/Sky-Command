# D3.2 航线导入器模块契约

状态：已批准  
契约版本：0.1.0  
所属一级模块：D3 航线库与预览  
模块标识：`route-importer`

## 1. 阅读方法

本文是 D3.2 的使用说明书，也是 D3.2 实现、测试和后续修改的验收依据。

D3.2 只有一个外部 seam：调用方提交一个不可信的 KML/KMZ 文件，D3.2 返回安全、受控的解析结果。调用方不需要了解 ZIP、XML、摘要算法、编码探测、分块调度或第三方库。

在本文获得批准前不得编写 D3.2 实现。实现不得扩大本文接口，也不得把内部类型或第三方库类型暴露给 D3 的其他模块。

## 2. 模块目的

D3.2 把不可信的文件名和字节安全转换为结构化的 `ParsedRouteDocument`，同时保留原始文件的精确副本并计算 SHA-256。

它解决以下问题：

1. 输入是否是名称安全、大小受限且内容与扩展名一致的 KML/KMZ。
2. KMZ 是否是结构安全、未加密、路径安全且解压规模受限的 ZIP 归档。
3. 应当从 KMZ 中选择哪一份 `waylines.wpml` 或 KML 文档。
4. XML 是否可以在不解析 DTD、实体或外部资源的情况下安全读取。
5. 文档中有哪些按原始顺序排列的航点候选记录。
6. 原始文件的 SHA-256 和不可被调用方篡改的字节快照是什么。
7. 大文件解析如何保持可取消且不长期阻塞界面事件循环。

## 3. 单一职责

D3.2 的唯一职责是“安全接收并进行语法级解析”。

D3.2 负责：

- 运行时输入验证、文件名规范化和字节快照。
- 文件扩展名与实际容器格式探测。
- SHA-256 计算。
- KML/XML 的安全、命名空间感知解析。
- KMZ/ZIP 的安全检查、流式验证和航迹文档选择。
- 原始航点候选值的提取和有限摘要。
- 资源限制、协作式调度和取消检查。
- 将预期失败映射为稳定的 D3.1 `RouteLibraryError`。

D3.2 不负责：

- 判断航点坐标、高度或序号是否满足领域规则。
- 静默删除、修复、排序、合并或补齐航点。
- 判断航点数量是否足以构成最终航线；但可以为了内存安全在候选数超过上限时提前拒绝。
- 决定 `preview-only` 或 `upload-candidate`。
- 生成 `RouteWaypoint`、`QualifiedRoute`、`RouteAsset` 或 `RouteId`。
- 判断 WPML 是否符合 DJI WPMZ 规范或飞机是否能执行。
- 管理去重、目录、选择、时间或 ID。
- 生成地图预览或访问 Cesium、DOM、Vue、Electron、Android、MSDK、飞机、网络或磁盘。
- 修改、重新打包或重新生成 KML、KMZ、WPML。

上述职责分别属于 D3.3、D3.4、D3.5、D3.7、一级模块 `geo-map`、一级模块 `mission-control` 和手机端 `wayline-mission`。

## 4. 术语

### 4.1 文件快照 File Snapshot

D3.2 在任何异步工作前复制调用方传入的 `Uint8Array` 有效视图。后续解析、摘要和输出全部基于该副本。

### 4.2 容器格式 Container Format

- `kml`：XML 文档本身就是航线文件。
- `kmz`：ZIP 容器，内部包含 WPML/KML 航迹文档和可能的资源文件。

格式不能只根据扩展名判断。

### 4.3 源文档 Source Document

D3.2 从输入文件中实际选择并解析的 XML 文档。独立 KML 的源文档是规范化后的文件名；KMZ 的源文档是规范化后的归档内相对路径。

### 4.4 航点候选 Raw Waypoint Candidate

从 XML 中按文档顺序提取的一条语法级记录。字段保留为受限长度的文本，不在 D3.2 中转换为领域数值。

候选不等于合法 `RouteWaypoint`。D3.3 必须验证它。

### 4.5 正常取消 Cancelled

调用方不再需要本次结果。取消不是文件错误、系统错误或部分成功，不得创建航线，也不得显示失败提示。

## 5. 唯一外部接口

```text
RouteImporter.ingest(
  fileName: unknown,
  bytes: unknown,
  limits: RouteImportLimits,
  cancellation?: RouteImportCancellation
) -> Promise<RouteIngestOutcome>
```

D3.2 对外不得再导出 Parser、Reader、Hasher、Scheduler、ZIP entry、XML node 或第三方库类型。

### 5.1 RouteImportLimits

```text
RouteImportLimits {
  maxFileBytes: positive integer
  maxArchiveEntries: positive integer
  maxExpandedBytes: positive integer
  maxWaypoints: positive integer
}
```

规则：

- 值来自 D3 创建时已经验证和固定的配置。
- D3.2 仍必须防御性检查，以免内部调用方绕过一级模块。
- `maxExpandedBytes` 不得小于 `maxFileBytes`。
- 非法 limits 返回 `DOMAIN_INVARIANT_VIOLATION`，不得尝试读取文件。
- D3.2 不保存或修改调用方传入的 limits 对象。

### 5.2 RouteImportCancellation

```text
RouteImportCancellation {
  readonly aborted: boolean
}
```

规则：

- 参数可省略；省略表示本次操作不会被主动取消。
- 该最小结构与 Web `AbortSignal` 可做结构化适配，但 D3.2 不依赖 DOM 类型。
- D3.2 只读取 `aborted`，不修改对象、不注册永久监听器。
- 已经为 `true` 时立即返回 `cancelled`，不读取其他不可信输入。
- 解析期间必须在每个主要阶段、每个 ZIP 条目以及分块工作之间检查。
- 完成全部解析后、返回成功结果前必须最后检查一次。
- 无法安全读取 `aborted` 属于内部调用契约错误，返回 `DOMAIN_INVARIANT_VIOLATION`。

### 5.3 RouteIngestOutcome

```text
RouteIngestOutcome =
  | { status: "parsed", document: ParsedRouteDocument }
  | { status: "rejected", error: RouteLibraryError }
  | { status: "cancelled" }
```

规则：

- 三种结果互斥且对象不可变。
- `rejected` 是文件、限制或内部调用契约失败；错误来自 D3.1 `createError`。
- `cancelled` 是正常结果，不携带伪造错误，也不记录为系统故障。
- 在支持的运行环境和资源限制内，第三方 ZIP/XML 解析异常不得直接逃出 Promise。
- JavaScript 运行时终止、进程退出和无法恢复的内存耗尽不属于可转换的业务结果。

## 6. ParsedRouteDocument 契约

```text
ParsedRouteDocument {
  readonly fileName: string
  readonly format: "kml" | "kmz"
  readonly sourceDocument: string
  readonly sourceKind: "kml" | "waylines-wpml"
  readonly hasCompanionTemplate: boolean
  readonly wpmlNamespace: string | null
  readonly waypointCandidates: readonly RawWaypointCandidate[]
  readonly sha256: string
  readonly sizeBytes: number
  readonly originalBytes: Uint8Array
}
```

规则：

- 对象及 `waypointCandidates` 必须不可变。
- `fileName` 是去除首尾空白后的安全 basename，不改变中间字符或 Unicode 正规形式。
- `sourceDocument` 不得是绝对路径，也不得包含 `..`、NUL 或反斜杠。
- `sourceKind` 只描述实际解析的文档种类，不是最终航线分类。
- `hasCompanionTemplate` 只在 `format = "kmz"`、`sourceKind = "waylines-wpml"` 且归档中存在与 `sourceDocument` 同一逻辑目录的 `template.kml` 时为 `true`；大小写只按 ASCII 折叠比较。其他所有情况必须为 `false`。它是 D3.3 分类所需的归档结构事实，不代表 DJI 已校验文件内容。
- `wpmlNamespace` 只在源文档实际声明并使用受支持的 DJI WPML namespace 时保存其完整 URI，否则为 `null`；D3.3 必须同时依据它和 `sourceKind` 判断 WPML 是否可识别。
- `sha256` 是对文件快照全部字节计算的 64 位小写十六进制字符串。
- `sizeBytes` 等于文件快照的字节数。
- 每次读取 `originalBytes` 必须得到独立副本；修改一个返回值不得影响后续读取、SHA-256 或其他字段。
- `originalBytes` 必须与最初快照逐字节相同，不得重新压缩、规范化 XML 或改写换行。
- 结果中不得包含 XML 节点、ZIP entry、Buffer、Blob、DOM、Electron 或第三方实例。

## 7. RawWaypointCandidate 契约

```text
RawWaypointCandidate {
  readonly documentOrder: non-negative integer
  readonly declaredSequenceText: string | null
  readonly longitudeText: string | null
  readonly latitudeText: string | null
  readonly altitudeText: string | null
  readonly altitudeSource:
    | "coordinate"
    | "execute-height"
    | "ellipsoid-height"
    | "height"
    | "missing"
  readonly malformed: boolean
  readonly rawSummary: string
}
```

规则：

- `documentOrder` 从 0 开始，按提取顺序连续递增。
- 文本字段只做 XML 解码和首尾空白去除，不转换成 `number`。
- 缺失字段为 `null`；不得把缺失高度填为 `0`。
- `declaredSequenceText` 只来自同一 WPML Placemark 的 `wpml:index`；普通 KML 为 `null`。
- `malformed` 表示存在无法无歧义拆分的非空坐标、**取值互不相同的**重复语义字段、一个 Point 中存在多个元组或字段超过安全长度。同一语义字段重复出现但**规范化后取值完全相同**时不算 malformed，只使用第一个值；判定细则见 §13。
- 格式错误仍保留为候选，供 D3.3 返回 `INVALID_COORDINATE`；不得静默过滤。
- 完全空白的坐标文本在**普通 KML** 中不产生候选。WPML 中的空白坐标按 §13 第 5 条处理，仍产生 malformed 候选。
- 文本字段在去除首尾空白后还会移除 C0/C1 控制字符，然后才执行 160 code point 截断。控制字符移除不改变字段语义，只防止控制字符进入结果和日志。
- 单个文本字段最多保留 160 个 Unicode code point。超过限制时截断受控文本并把 `malformed` 设为 `true`。
- `rawSummary` 只包含本候选的有限坐标摘要，最多 160 个 Unicode code point，移除控制字符，不得包含整份 XML、绝对路径或相邻航点内容。

## 8. 输入接收顺序

D3.2 必须使用以下确定顺序，保证相同输入始终得到相同错误：

1. 验证 cancellation 结构；若已经取消，返回 `cancelled`。
2. 验证 limits。
3. 验证 `fileName` 的类型、安全性和扩展名。
4. 验证 `bytes` 是 `Uint8Array`、非空且未超过 `maxFileBytes`。
5. 复制 `Uint8Array` 当前有效视图，不得复制其底层缓冲区视图之外的字节。
6. 再次检查取消。
7. 根据快照探测 XML/ZIP/未知容器，并与扩展名比对。
8. 对快照计算 SHA-256，并按 KML 或 KMZ 路径解析。
9. 验证输出结构，最后检查取消。
10. 原子返回一种 `RouteIngestOutcome`。

失败或取消时不得返回半成品 `ParsedRouteDocument`。

## 9. 文件名规则

- `fileName` 必须确实是 string，不进行隐式 `String()` 转换。
- 去除首尾空白后必须非空。
- 扩展名只接受 `.kml` 和 `.kmz`，不区分大小写。
- 允许中文、空格、括号及其他非控制 Unicode 字符。
- 拒绝 `/`、`\\`、NUL、C0/C1 控制字符、绝对路径、UNC 路径和盘符路径。
- `.`、`..` 或只由扩展名构成的名字不是有效业务文件名。
- 不访问文件名指向的磁盘路径；文件名只用作显示名和格式声明。
- 非法 basename 返回 `INVALID_FILE_NAME`；非 KML/KMZ 扩展名返回 `UNSUPPORTED_FORMAT`。

## 10. 字节和格式探测

### 10.1 字节规则

- `null`、`undefined`、普通数组、ArrayBuffer、字符串和无法读取的代理对象不作为有效 `Uint8Array`。
- Node `Buffer` 作为 `Uint8Array` 子类可以接收，但输出不得保留 Buffer 类型。
- 零字节返回 `EMPTY_FILE`。
- 超过 `maxFileBytes` 返回 `FILE_TOO_LARGE`，不得复制或解析完整内容。
- 调用方在 `ingest` 返回 Promise 后修改原数组不得改变结果。

### 10.2 容器探测

- XML 可以具有 UTF BOM、XML 声明、空白和注释，不能只检查固定字符串前缀。
- ZIP 探测识别合法 ZIP 起始结构，包括空 ZIP；后续仍必须完整验证中央目录。
- `.kml` 配 ZIP 内容或 `.kmz` 配 XML 内容返回 `FORMAT_MISMATCH`。
- 声明为 `.kml` 且明显不是 XML 的内容返回 `FORMAT_MISMATCH`。
- 声明为 `.kmz` 且明显不是 ZIP 的内容返回 `FORMAT_MISMATCH`。
- 具有 ZIP 特征但结构损坏的 `.kmz` 返回 `CORRUPT_KMZ`。
- 具有 XML 特征但语法损坏的 `.kml` 返回 `INVALID_XML`。

## 11. XML 安全与编码

D3.2 使用流式、命名空间感知 XML 解析，不构建整份 DOM。

必须支持：

- UTF-8（有无 BOM）。
- UTF-16LE 和 UTF-16BE（具有 BOM 或可无歧义识别的 XML 字节模式）。
- XML 声明与实际编码一致的文档。
- KML 2.2 命名空间和为了兼容旧文件而无命名空间的 `kml` 根元素。
- 任意 XML 前缀绑定的 DJI WPML 命名空间；受支持的 URI 以 `http://www.dji.com/wpmz/` 或 `https://www.dji.com/wpmz/` 开头并带有非空版本段。语义匹配使用 namespace URI/local name，不硬编码 `wpml:` 字符串前缀。

必须拒绝：

- 任意 `DOCTYPE`，无论是否声明外部资源。
- 任意自定义实体声明、外部实体、参数实体或 XInclude 外部加载企图。
- 无法严格解码的字节序列。
- XML 声明的编码与字节实际编码冲突。
- 不受支持的传统编码。
- 多个根元素、未闭合标签、非法字符及其他不良 XML。
- 根元素 local name 不是 `kml` 的文档。
- 根元素使用既非 KML 2.2 又非空的未知 namespace。

DTD、实体和 XInclude 相关拒绝返回 `EXTERNAL_ENTITY_FORBIDDEN`；其他 XML 语法或编码问题返回 `INVALID_XML`。解析过程不得访问网络、本地文件或系统实体解析器。

## 12. KML 航点提取

普通 KML 使用以下确定规则：

1. 按文档顺序查找所有 KML `LineString`。
2. 只要文档存在至少一个带 `coordinates` 子元素的 LineString，就只使用全部这类 LineString 的 coordinates，按文档顺序串接。
3. 即使 LineString coordinates 为空或格式错误，也不得改用 Point 掩盖问题。
4. 如果不存在上述 LineString coordinates，则按文档顺序读取 KML Placemark 内 Point 的 coordinates。
5. 不读取 Polygon、LinearRing、模型位置、样式、相机、LookAt、描述文本或非 Placemark Point 作为航线。
6. 每段 coordinates 按 XML/KML 规则以空白分隔元组，以逗号分隔经度、纬度和可选高度。
7. 两段或更多 LineString 不自动插入连接点、去重或闭合。

普通 KML（`sourceKind === "kml"`）的高度优先顺序：

1. coordinate 第三个分量。
2. 在 Point fallback 中，同一 Placemark 的 `executeHeight`。
3. 同一 Placemark 的 `ellipsoidHeight`。
4. 同一 Placemark 的 `height`。
5. 缺失。

**高度优先顺序由 `sourceKind` 决定，两种来源使用两条不同的链。** 本节的链只适用于普通 KML；`waylines.wpml` 使用 §13 的链，两者不得共用一条实现。

**高度标签必须位于受支持的 WPML namespace 中**，按 local name（`executeHeight`、`ellipsoidHeight`、`height`）识别并记录文本，不解释高度基准。不在 WPML namespace 中的同名元素一律忽略：普通 KML 的标准高度载体是 coordinate 第三个分量，裸 `<height>` 不属于 KML 规范，读它会把非标准文档当成标准文档。因此一份没有声明 WPML namespace 的 KML 只可能得到 `coordinate` 或 `missing` 两种 `altitudeSource`。

## 13. WPML 航点提取

被选中的 `waylines.wpml` 使用以下规则：

1. 只读取 Placemark 内 Point 的 coordinates。
2. 按 Placemark 在文档中的顺序产生候选，不按 `wpml:index` 重新排序。
3. `wpml:index` 只记录到 `declaredSequenceText`，连续性由 D3.3 验证。
4. 不读取 action、POI、边界、Folder 元数据或模板参数中的坐标。
5. 一个 Placemark 缺少 Point/coordinates 时仍产生一个 malformed 候选，防止损坏航点被静默删除。
6. **`LineString` 的 coordinates 既不提取也不计数。** WPML 的航点载体只有 Placemark 内的 Point；WPML 文档中出现的 `LineString`（例如模板中的航迹示意）必须被完全忽略，不得产生候选，也不得计入 §14 的 `maxWaypoints` 上限。对不读取的内容计数会让一份合法 WPML 因为示意折线过长而被误拒。

WPML 高度优先顺序（`sourceKind === "waylines-wpml"`）：

1. 同一 Placemark 的 `executeHeight`。
2. `ellipsoidHeight`。
3. `height`。
4. coordinate 第三个分量。
5. 缺失。

**这条链与 §12 的普通 KML 链方向相反，必须按 `sourceKind` 分别实现。** WPML 中 coordinate 第三个分量常常是 `0` 或占位值，而 `wpml:executeHeight` 才是飞机实际执行的高度；如果在 WPML 里让坐标分量优先，操作员看到的预览高度会与飞机实际飞行高度不一致。这是安全相关的行为，不是显示偏好。

同一优先级出现多个**不同**值时把候选标记为 malformed，不擅自选择一个合法值。同一优先级出现多个**相同**值不是冲突，不标记 malformed：重复但一致的字段没有歧义，取该值即可。比较在受控文本（已去除首尾空白和控制字符）之间进行。

## 14. 候选数量保护

- D3.2 允许生成最多 `maxWaypoints` 个候选。
- 超过上限时返回 `TOO_MANY_WAYPOINTS` 并停止 XML 解析。
- **检查粒度固定为"每个 `coordinates` 元素结束时"和"每个 Placemark 结束时"，不要求逐个元组检查。** 也就是说，单个 `coordinates` 元素内部允许先完整拆分再判断，即使它一次带来远超上限的元组。这是明确接受的实现宽容度：逐元组检查需要把限制逻辑下推进拆分循环，换来的内存收益有限，而 `maxExpandedBytes` 和 `maxFileBytes` 已经限制了单个元素可能有多大。
- 上述宽容度不适用于跨元素累计：第二个及以后的 `coordinates` 元素必须在前一个元素结束后的检查中就被拦住，不得先把整份文档的元组全部展开再统一判断。
- 这是解析内存保护，不代替 D3.3 对最终航线数量和有效性的验证。
- 少于两个候选不是 D3.2 错误；D3.2 返回解析结果，由 D3.3 返回 `INSUFFICIENT_WAYPOINTS` 或 `INVALID_COORDINATE`。

## 15. KMZ 归档安全

### 15.1 全归档检查

KMZ 解析必须分两阶段：

1. 读取中央目录，检查条目元数据、数量、路径、加密状态、类型和声明解压大小。
2. 逐个流式读取全部非目录条目，计算实际总解压字节并验证条目完整性/CRC；只保留最终选中的 XML 文档字节。

不得只验证航迹文档而跳过归档中的其他条目。不得把任何条目解压到磁盘。

### 15.2 条目数量与大小

- 条目计数包括文件和目录。
- 条目数超过 `maxArchiveEntries` 返回 `ARCHIVE_ENTRY_LIMIT`。
- 声明解压大小总和或实际流式解压总和超过 `maxExpandedBytes` 返回 `ARCHIVE_EXPANSION_LIMIT`。
- 大小累加必须防止 JavaScript number 溢出；超出安全整数范围直接视为超过限制。
- ZIP64 可以读取，但仍受相同条目数和大小限制。
- 不得把全部解压条目同时保存在内存中。

### 15.3 加密、类型和完整性

- 任一条目声明为传统 ZIP 加密或 AES 加密，整个归档返回 `ENCRYPTED_KMZ`。
- 目录和普通文件可以接受。
- 符号链接、设备文件或无法识别的特殊条目返回 `CORRUPT_KMZ`。
- 不支持的压缩方法、截断数据、中央目录冲突、CRC/大小不一致返回 `CORRUPT_KMZ`。
- 空 ZIP 或没有可选航迹文档的 ZIP 返回 `ROUTE_DOCUMENT_MISSING`。

### 15.4 路径安全

每个 entry name 必须先把反斜杠视为分隔符，再进行纯内存规范化。

拒绝：

- NUL 或控制字符。
- 绝对路径、UNC 路径和盘符路径。
- 任意原始 `..` 路径段，即使最终规范化后似乎回到根目录。
- 规范化后为空的文件路径。
- 规范化后发生大小写不敏感冲突的两个条目。

允许目录末尾 `/`。输出路径统一使用 `/`，不包含 `.`、空路径段或反斜杠。路径失败返回 `UNSAFE_ARCHIVE_PATH`；重复规范化路径造成结构歧义返回 `CORRUPT_KMZ`。

## 16. KMZ 航迹文档选择

所有路径比较对 ASCII 文件名部分不区分大小写，但输出保留规范化路径的原始大小写。

### 16.1 WPML 优先级

按以下层级选择，命中较高层级后忽略较低层级：

1. `wpmz/waylines.wpml`。
2. 根目录 `waylines.wpml`，兼容当前 Wayline 项目导出格式。
3. 其他目录中 basename 为 `waylines.wpml` 的唯一条目。

同一层级有多个候选时返回 `CORRUPT_KMZ`，不得任意选择。选中后 `sourceKind` 为 `waylines-wpml`。

选中 WPML 后，D3.2 必须独立记录同一逻辑目录内是否存在唯一的 `template.kml`，作为 `hasCompanionTemplate`。该事实不改变源文档选择，也不在 D3.2 决定最终分类。

### 16.2 KML fallback 优先级

只有归档中不存在任何可识别 `waylines.wpml` 时才执行 fallback：

1. `wpmz/template.kml`。
2. 根目录 `template.kml`。
3. 其他目录中 basename 为 `template.kml` 的唯一条目。
4. 归档中唯一的其他 `.kml` 文件。

同一层级有多个候选时返回 `CORRUPT_KMZ`。没有候选时返回 `ROUTE_DOCUMENT_MISSING`。选中后 `sourceKind` 为 `kml`。

### 16.3 禁止静默降级

- `waylines.wpml` 存在但 XML 损坏、包含 DTD、无法解码或航点内容损坏时，不得改用 `template.kml`。
- 是否因 WPML 缺失而产生 `WPML_MISSING` 警告属于 D3.3，不属于 D3.2。
- D3.2 不根据文件内容宣称任务已经通过 DJI 校验。

## 17. SHA-256 与字节所有权

- 摘要算法固定为 SHA-256，不可由调用方配置。
- 摘要针对第 8 节生成的精确文件快照，而不是 XML 文本或解压内容。
- 输出为 64 个小写十六进制字符，不带 `0x`。
- 相同字节必须在所有平台得到相同摘要。
- SHA-256 计算可以与解析并行执行，但错误优先级仍必须遵守本契约。
- 取消后必须丢弃摘要和快照引用，不返回部分结果。
- D3.2 不记录、上传或持久化原始字节。

## 18. 调度、性能和资源释放

- 小于或等于 1 MiB 的输入可以在一次异步任务内解析。
- 大于 1 MiB 的摘要、XML 和解压工作必须分块并主动让出事件循环，或在等价的隔离执行环境中完成。
- 分块工作至少在每处理 1 MiB 输入/输出前后检查一次取消；ZIP 条目边界必须额外检查。
- 不得使用只会排空 microtask 队列、却仍长期阻止 UI 渲染的伪让步循环。
- 解析完成、失败或取消后必须释放 ZIP reader、解压流、解析器、临时缓冲区和取消相关资源。
- D3.2 不创建永久 worker、计时器、网络连接或文件句柄。
- 内存中可以同时保留原始快照、摘要状态、当前解压块、选中 XML 和候选结果；不得保留全部归档解压副本或完整 XML DOM。
- 任何资源限制在读取超过阈值的最早可确定时刻生效。

## 19. 错误映射与优先级

所有 `rejected` 结果必须使用 D3.1 `createError`，错误码来自 D3 父契约。

| 阶段 | 稳定错误码 |
|---|---|
| limits 非法或内部调用对象不可读 | `DOMAIN_INVARIANT_VIOLATION` |
| 文件名不安全 | `INVALID_FILE_NAME` |
| 扩展名不支持 | `UNSUPPORTED_FORMAT` |
| 字节缺失或为空 | `EMPTY_FILE` |
| 原始文件过大 | `FILE_TOO_LARGE` |
| 扩展名和实际容器冲突 | `FORMAT_MISMATCH` |
| XML 语法/编码/根元素错误 | `INVALID_XML` |
| DTD 或实体 | `EXTERNAL_ENTITY_FORBIDDEN` |
| ZIP 结构、CRC、特殊类型或压缩方法错误 | `CORRUPT_KMZ` |
| 任一加密条目 | `ENCRYPTED_KMZ` |
| 条目过多 | `ARCHIVE_ENTRY_LIMIT` |
| 声明或实际解压大小过大 | `ARCHIVE_EXPANSION_LIMIT` |
| 条目路径不安全 | `UNSAFE_ARCHIVE_PATH` |
| 没有可选择的航迹 XML | `ROUTE_DOCUMENT_MISSING` |
| 原始候选超过限制 | `TOO_MANY_WAYPOINTS` |

同一输入同时具有多个问题时，优先返回最早按第 8 节顺序确定的问题。KMZ 中完成中央目录结构读取后，条目处理优先级为：条目数量、按中央目录顺序发现的首个不安全路径、加密或特殊条目、声明解压总量、实际解压/CRC、源文档选择、XML 解析。条目数量必须最先限制，避免为了诊断其他问题而无界遍历恶意中央目录。

错误 details 只能包含完成诊断所需的有限结构，例如：

```text
{
  phase: "archive-path",
  entryIndex: 4,
  entryNameSummary: "../waylines.wpml"
}
```

details 不得包含：

- 整份 XML、KMZ 或任意原始字节。
- 用户本机绝对路径。
- 天地图 Key、令牌或其他凭据。
- 超过 160 个 Unicode code point 的文件名、entry name 或坐标摘要。
- 第三方库堆栈、内部类名或不稳定英文异常消息。

## 20. 原子性和确定性

- 一次 `ingest` 不修改任何共享目录状态。
- 成功只返回一份完整 `ParsedRouteDocument`。
- 失败和取消不产生可观察的部分文档。
- 相同文件、limits 和未取消信号必须得到相同的格式、源文档、候选顺序、摘要和错误码。
- ZIP 条目枚举顺序不得影响优先级选择；同层歧义必须拒绝。
- D3.2 实例可以同时处理多个独立输入，不使用模块级可变解析状态。
- D3 一级模块仍负责按照用户发起顺序串行提交解析结果。

## 21. 内部实现组织

D3.2 可以在 `importer/internal/` 中按职责拆分实现文件，例如：

```text
intake       输入验证、文件名规范化、字节快照和容器探测
digest       SHA-256 分块计算
archive      ZIP 元数据、安全验证、流式读取和文档选择
xml          编码、XML 安全解析和候选提取
cancellation 取消检查和协作式让步
errors       第三方异常到稳定错误的局部映射
```

这些是 D3.2 的内部实现分工，不是新的正式二级模块或外部 seam。

内部依赖必须是单向的：公开入口负责编排；intake、digest、archive 和 xml 互不回调；archive 只返回受控源文档字节，由公开入口交给 xml。禁止循环依赖。

删除 D3.2 后，文件接收、ZIP/XML 安全、摘要、编码和取消复杂度会重新扩散到 D3 一级编排中，因此该模块具有足够深度。调用方只需要学习一个方法和一个三态结果。

## 22. 依赖选择约束

- ZIP 实现必须支持浏览器/Electron 环境中的内存读取、条目加密标识、64 位大小、逐条流式解压和完整性校验。
- XML 实现必须支持严格 SAX/流式解析、namespace/local name 和 DTD 通知，且默认不访问外部资源。
- SHA-256 实现必须跨 Electron/Node 测试环境产生一致结果，并允许分块处理。
- 具体库属于实现细节，可以在不改变本契约的情况下替换。
- 引入依赖前必须锁定版本、检查许可证和已知高危漏洞。
- 不使用正则表达式代替 XML parser，不使用一次性解压整个归档的便利接口。

## 23. 测试契约

### 23.1 接口测试原则

- 行为测试只从 `importer/index.ts` 导入 D3.2 公开接口。
- 测试不得通过调用内部 Parser/Reader 来绕过真实编排。
- 第三方库类型不得出现在测试对外夹具接口中。
- 每个稳定错误码、结果状态和错误优先级都必须有直接测试。

### 23.2 正常兼容测试

至少覆盖：

- UTF-8、UTF-8 BOM、UTF-16LE、UTF-16BE KML。
- KML LineString 优先和 Placemark Point fallback。
- 多 LineString 的文档顺序。
- 高度存在、缺失及高度来源优先级。
- DJI canonical `wpmz/template.kml` + `wpmz/waylines.wpml`。
- 当前 Wayline 项目根目录 `template.kml` + `waylines.wpml`。
- WPML 缺少同目录 `template.kml` 时仍返回可预览的解析结果，并明确 `hasCompanionTemplate = false`。
- 大小写扩展名、中文和空格文件名。
- 原始字节、SHA-256 和源文档路径一致性。

### 23.3 输入和不可变性测试

至少覆盖：

- null、undefined、错误运行时类型、空文件、超限文件和不可读代理。
- 带 offset 的 Uint8Array 只复制有效视图。
- 调用方在异步解析开始后修改输入字节。
- 修改每次返回的 `originalBytes` 不影响后续读取。
- 修改输出对象、候选数组或候选对象失败且不影响内部结果。
- 非法 limits 和已取消信号。

### 23.4 XML 安全测试

至少覆盖：

- 外部 DTD、内部 DTD、通用实体、参数实体、XInclude 和合法 XML 语法允许的空白/编码变体。
- 根元素错误、多根、截断、非法编码、编码声明冲突。
- namespace 前缀变化和未知 namespace。
- Polygon/样式/描述中的坐标不会成为航点。
- 空白坐标被忽略，非空畸形坐标被保留并标记 malformed。
- 超长字段被截断并标记，不进入错误全文。

### 23.5 ZIP/KMZ 安全测试

至少覆盖：

- 截断 ZIP、CRC 错误、中央目录冲突、空 ZIP和不支持的压缩方法。
- 传统加密和 AES 加密标志。
- 条目数量边界：上限、上限加一。
- 声明解压大小和实际解压大小边界。
- 高压缩比输入不会绕过实际字节计数。
- `/`、`\\`、盘符、UNC、NUL、控制字符和各类 `..` 路径。
- 大小写/规范化重复路径、符号链接和特殊条目。
- canonical、Wayline root 和唯一 fallback 的选择优先级。
- 同层多个候选时拒绝。
- WPML 损坏时不降级到 template KML。
- 未选中的资源条目损坏仍导致归档拒绝。

### 23.6 属性与模糊测试

使用生成式测试覆盖：

- 任意安全 Unicode basename 的规范化稳定性。
- 任意路径段组合不能逃出虚拟归档根。
- 任意有限坐标文本不会导致未捕获异常。
- 任意输入字节不会泄漏第三方异常或返回半成品。
- SHA-256 对字节变化敏感且与可信实现一致。
- 快照和输出复制在任意修改序列下保持隔离。

### 23.7 取消、并发和性能测试

- 开始前取消、摘要中取消、解压中取消、XML 中取消和成功返回前取消。
- 取消返回 `cancelled`，不返回 `rejected` 或部分 document。
- 两个并发 ingest 不共享候选、字节或取消状态。
- 大于 1 MiB 的输入在完成前至少让事件循环中的独立任务获得执行机会。
- 100,000 个候选的上限场景可完成；第 100,001 个候选在构造完整结果前被拒绝。
- 性能测试不得通过放宽生产限制或使用测试后门通过。

### 23.8 覆盖率和变异测试

- statements、branches、functions、lines 均为 100%。
- 所有有效变异必须被测试杀死，mutation score 为 100%。
- TypeScript 严格类型检查通过。
- 架构测试证明 D3.2 不依赖 D3.3-D3.7、Vue、Electron、DOM、Cesium、Android 或 DJI 包。
- 依赖审计不得存在未处理的高危漏洞。

## 24. 兼容性和演进

以下变化不需要修改 D3.2 外部接口，但必须增加测试：

- 替换 ZIP、XML、摘要或调度实现。
- 增加新的已验证 WPML namespace 版本。
- 优化分块大小和内部缓冲策略。
- 增强错误 details，但不得泄漏信息或改变稳定错误码。

以下变化必须先修改 D3 父契约和本文并重新审阅：

- 支持 KML/KMZ 之外的新格式。
- 改变源文档选择优先级。
- 允许多个航迹文档合并。
- 改变 SHA-256 或去重依据。
- 在 D3.2 中增加领域校验、分类或修复行为。
- 增加新的外部方法或把内部 Parser/Reader 暴露出去。

## 25. 完成定义

D3.2 只有同时满足以下条件才算完成：

- 本契约和父契约中的 D3.2 描述一致且已批准。
- 公开入口只有 `RouteImporter.ingest`。
- KML 和 KMZ 正常样本均能产生确定的解析文档。
- 当前 Wayline 根目录 KMZ 和 DJI canonical KMZ 均有真实夹具测试。
- 文件名、字节、格式、ZIP、XML、摘要、取消和资源限制全部按契约实现。
- D3.2 不决定航线分类，不创建任何 D3.1 航线领域对象。
- 归档不落盘，XML 不访问外部资源，大文件不长期阻塞事件循环。
- 所有安全、边界、属性、并发、性能、架构、覆盖率和变异测试通过。
- 旧的正则 XML/宽松 JSZip 解析路径不再被 D3 正式实现调用。

## 26. 已批准设计决策

以下决策在本契约批准后固定：

1. 使用单一深接口，不公开分阶段 Parser/Reader。
2. 使用 `parsed/rejected/cancelled` 三态结果，取消不是错误。
3. D3.2 只做语法级解析，D3.3 独占领域校验和分类。
4. 原始字节按精确快照保留，SHA-256 固定针对该快照。
5. KMZ 验证全部条目且不落盘，只保留被选中的 XML。
6. 同层多个航迹文档视为歧义并拒绝，不任意选择。
7. 存在但损坏的 WPML 不降级为 template KML。
8. 同时兼容 DJI `wpmz/` 目录和当前 Wayline 根目录导出布局。
9. XML 使用流式 namespace-aware 解析，拒绝全部 DTD/自定义实体。
10. 非空畸形航点候选不被静默删除，由 D3.3 给出领域错误。
