# D3.1 航线领域内核契约

状态：已批准  
契约版本：0.1.0  
父契约：`../CONTRACT.md` 0.2.3  
模块标识：`route-domain`

## 1. 文档目的

本文定义 D3.1 航线领域内核的完整接口、领域值、不变量、错误行为、不可变性和测试要求。

D3.1 是 D3 其他二级模块共同使用的领域基础。调用方只通过本文定义的构造和读取接口获得领域对象，不得通过对象字面量、类型断言、反序列化结果或直接修改属性制造领域对象。

本文批准前不得编写实现。批准后先写能够验证本契约的测试，再写实现。

## 2. 模块目的

D3.1 把普通字符串、数字、数组和字节转换为合法、不可变、带明确语义的航线领域对象。

它集中保证以下事实：

- RouteId 始终合法且不可与普通字符串混用。
- RouteWaypoint 始终包含合法 WGS84 坐标和连续序号所需的合法单点值。
- QualifiedRoute 始终具有合法格式、分类、航点集合、摘要和警告组合。
- RouteAsset 始终具有合法 ID、导入时间和不可变原始文件副本。
- RouteLibraryError 始终使用父契约规定的错误码和恢复属性。
- 调用方取得的对象、数组和字节不能修改模块内部状态。

## 3. 明确不负责的内容

D3.1 不负责：

- 读取磁盘、文件选择器或拖放数据。
- 识别 KML/KMZ 文件内容。
- 解压 ZIP 或解析 XML/WPML。
- 把字符串坐标转换为数字。
- 计算 SHA-256。
- 判断 WPML 是否存在。
- 决定一份解析文档是否具备成为航线的资格。
- 管理多条航线、去重、排序、选择或删除。
- 计算地图相机范围。
- 调用 Vue、Electron、Cesium、Android、DJI MSDK 或网络接口。
- 生成当前时间、UUID 或随机数。
- 规划、编辑、上传或执行航线。

上述职责分别属于 D3.2、D3.3、D3.4、D3.5、D3.7、一级模块 `geo-map`、一级模块 `mission-control` 或手机端 `wayline-mission` 模块。

## 4. 设计原则

### 4.1 受控构造

所有领域对象必须由 D3.1 的构造接口创建。构造接口验证输入并返回 `DomainResult<T>`，不允许先创建非法对象再依赖后续调用修复。

### 4.2 运行时与类型系统双重保护

TypeScript 的 readonly 或品牌类型只能提供编译期帮助，不能代替运行时验证。所有构造接口必须在运行时验证不可信输入。

### 4.3 不可变性

构造成功后，领域对象在整个生命周期内不可变化。任何“修改”都必须创建新对象，并重新经过构造接口。

### 4.4 无副作用

D3.1 不访问时钟、随机数、文件系统、网络、日志或全局状态。同样输入必须产生同样结果。

### 4.5 封闭领域集合

格式、分类、警告码和错误码均为封闭集合。新增值必须先修改父契约和本文，再修改测试和实现。

## 5. 公开接口

以下是概念接口。实现可以采用函数、工厂对象或不可变类，但公开语义必须一致。

```text
RouteDomain.createRouteId(raw) -> DomainResult<RouteId>
RouteDomain.createWaypoint(input) -> DomainResult<RouteWaypoint>
RouteDomain.createQualifiedRoute(input) -> DomainResult<QualifiedRoute>
RouteDomain.createRouteAsset(input) -> DomainResult<RouteAsset>
RouteDomain.createError(code, details?) -> RouteLibraryError

RouteDomain.toSummary(asset) -> RouteSummary
RouteDomain.toDetail(asset) -> RouteDetail
RouteDomain.copyOriginalBytes(asset) -> Uint8Array
```

禁止公开：

- 品牌类型使用的私有 symbol。
- RouteAsset 内部保存的原始 Uint8Array。
- 可修改的航点或警告数组。
- 任意第三方库类型。
- 绕过验证的 `unsafeCreate`、`fromUnchecked` 或测试后门。

## 6. DomainResult 契约

```text
DomainResult<T> =
  | { ok: true, value: T }
  | { ok: false, error: RouteLibraryError }
```

规则：

- 对预期的非法输入返回 `ok: false`，不得抛出普通 Error。
- 成功结果不能同时包含 error。
- 失败结果不能同时包含 value。
- Result 对象自身不可变。
- 调用方必须显式处理两个分支。
- 内存耗尽、JavaScript 引擎故障等不可恢复系统异常不属于本契约。

## 7. RouteId 契约

`RouteId` 是不透明的领域值，不是任意字符串。

### 7.1 输入

```text
createRouteId(raw: unknown) -> DomainResult<RouteId>
```

### 7.2 合法格式

- 输入必须是 string。
- 输入按原值验证，不自动 trim；包含首尾空白直接拒绝。
- 长度为 1 至 128 个 ASCII 字符。
- 第一个字符必须是 ASCII 字母或数字。
- 后续字符只允许 ASCII 字母、数字、点、下划线和连字符。
- 推荐 IdProvider 使用 UUID，但 D3.1 不生成 UUID。

等价正则：

```text
^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$
```

### 7.3 失败

IdProvider 提供非法值属于内部契约错误，返回：

```text
DOMAIN_INVARIANT_VIOLATION
details.field = "routeId"
```

### 7.4 保证

- RouteId 可以比较相等和作为 Map key。
- RouteId 序列化时只输出规范字符串。
- 普通 string 不能在类型层直接赋值给 RouteId。

## 8. RouteWaypoint 契约

### 8.1 输入

```text
CreateWaypointInput {
  longitude: unknown
  latitude: unknown
  altitude: unknown
  sequence: unknown
}
```

### 8.2 经度

- 必须是 number。
- 必须是有限值。
- 允许范围为 `[-180, 180]`，包含边界。
- 不进行角度归一化；181 不得自动变成 -179。

### 8.3 纬度

- 必须是 number。
- 必须是有限值。
- 允许范围为 `[-90, 90]`，包含边界。
- 不进行钳制；91 不得自动变成 90。

### 8.4 高度

- 必须是有限 number 或 `null`。
- `undefined`、空字符串和 NaN 不等于缺失高度，必须拒绝。
- 允许零高度和负高度。
- D3.1 不解释高度基准，也不进行单位换算。

### 8.5 sequence

- 必须是 number。
- 必须是非负安全整数。
- 单个航点只保证 sequence 合法；整条航线是否从 0 连续排列由 QualifiedRoute 构造检查。

### 8.6 失败

任意坐标、高度或 sequence 非法时返回：

```text
INVALID_COORDINATE
details.field = "longitude" | "latitude" | "altitude" | "sequence"
details.sequence = 可用时的航点位置
details.reason = 稳定的机器可读原因
```

错误 details 不得包含整份 XML 或完整文件内容。

### 8.7 保证

- 返回对象不可变。
- 不保留输入对象引用。
- `-0` 可以接受，但输出必须规范化为 `0`，避免摘要和显示差异。

## 9. 文件元数据值契约

QualifiedRoute 构造接口必须重新验证 D3.2/D3.3 提供的文件元数据。

### 9.1 displayName

- 必须是非空 string。
- 允许中文、Unicode、空格、括号、点、下划线和连字符。
- 不允许首尾空白。
- 不允许 `/`、反斜杠、盘符、NUL 或 Unicode/ASCII 控制字符。
- 必须以 `.kml` 或 `.kmz` 结尾，大小写不敏感。
- D3.1 保留显示名称原始大小写，不擅自改名。
- 非法时返回 `INVALID_FILE_NAME`。

### 9.2 format

```text
RouteFileFormat = "kml" | "kmz"
```

- 格式必须属于封闭集合。
- displayName 扩展名必须与 format 一致。
- 不一致返回 `DOMAIN_INVARIANT_VIOLATION`。

### 9.3 sourceDocument

- KML 为安全显示名称或解析器提供的逻辑文档名。
- KMZ 可以是安全的相对归档路径，例如 `wpmz/waylines.wpml`。
- 不允许绝对路径、盘符、NUL、控制字符或规范化后的 `..` 路径穿越。
- 不允许空值。
- 非法时返回 `DOMAIN_INVARIANT_VIOLATION`。

### 9.4 sha256

- 必须是 64 个小写十六进制字符。
- 不接受大写、空白、前缀或分隔符。
- D3.1 只验证格式，不重新计算摘要。
- 非法时返回 `DOMAIN_INVARIANT_VIOLATION`。

### 9.5 sizeBytes

- 必须是正安全整数。
- 必须等于 originalBytes.length。
- D3.1 不负责最大文件限制，但拒绝内部长度不一致。

## 10. 分类契约

```text
RouteClassification =
  | "preview-only"
  | "upload-candidate"
```

分类不变量：

- KML 只能是 `preview-only`。
- `upload-candidate` 必须是 KMZ。
- `upload-candidate` 的 sourceDocument 必须以 `.wpml` 结尾。
- `upload-candidate` 不得包含 `WPML_MISSING` 或 `DJI_TEMPLATE_MISSING` 警告。
- 缺少 WPML 的 KMZ 必须是 `preview-only`，并包含 `WPML_MISSING`。
- WPML 缺少同目录 DJI 模板的 KMZ 必须是 `preview-only`，并包含 `DJI_TEMPLATE_MISSING`。
- D3.1 不自行推断分类；它验证 D3.3 给出的分类是否自洽。
- 分类组合不一致返回 `DOMAIN_INVARIANT_VIOLATION`。

## 11. RouteWarning 契约

```text
RouteWarningCode =
  | "WPML_MISSING"
  | "DJI_TEMPLATE_MISSING"
  | "ALTITUDE_MISSING"

RouteWarning {
  code: RouteWarningCode
  message: string
  details?: readonly JsonValue
}
```

规则：

- 警告码是封闭集合。
- 同一警告码最多出现一次。
- 警告按固定顺序输出：`WPML_MISSING`、`DJI_TEMPLATE_MISSING`，然后 `ALTITUDE_MISSING`；前两者互斥。
- 任意航点 altitude 为 null 时必须包含 `ALTITUDE_MISSING`。
- 所有航点高度存在时不得包含 `ALTITUDE_MISSING`。
- message 是面向人的中文说明；业务判断只能依赖 code。
- details 必须是不可变、JSON-safe 且不包含字节、密钥、完整 XML 或本地绝对路径。
- 地图警告不属于 RouteWarning，不能进入 RouteDetail.warnings。

## 12. QualifiedRoute 契约

QualifiedRoute 是 D3.3 成功判定后的不透明领域对象，尚未拥有 routeId 和 importedAt。

### 12.1 输入

```text
CreateQualifiedRouteInput {
  displayName: unknown
  format: unknown
  classification: unknown
  sourceDocument: unknown
  waypoints: readonly RouteWaypoint[]
  warnings: readonly RouteWarning[]
  sha256: unknown
  sizeBytes: unknown
  originalBytes: Uint8Array
}
```

### 12.2 聚合不变量

- 至少包含两个航点。
- 航点 sequence 必须严格为 `0, 1, 2, ... n-1`。
- 不允许重复、跳号或乱序 sequence。
- 每个航点必须由 D3.1 构造，不能接受伪造对象。
- format、classification、sourceDocument 和 warnings 必须符合第 9 至 11 节。
- originalBytes 必须非空。
- sizeBytes 必须与 originalBytes.length 一致。
- sha256 格式必须合法；摘要内容一致性由 D3.2 和 D3 一级集成测试保证。
- 输入数组和字节在构造时复制。

### 12.3 失败

- 航点少于两个：`INSUFFICIENT_WAYPOINTS`。
- 航点值非法：`INVALID_COORDINATE`。
- 其他聚合组合不一致：`DOMAIN_INVARIANT_VIOLATION`。

### 12.4 保证

- QualifiedRoute 不公开可变原始字节。
- QualifiedRoute 不包含 routeId、importedAt 或目录位置。
- 对象可安全交给 D3.4 去重查询之前的一级编排使用。

## 13. RouteAsset 契约

RouteAsset 是加入航线目录前创建的完整不透明领域对象。

### 13.1 输入

```text
CreateRouteAssetInput {
  qualifiedRoute: QualifiedRoute
  routeId: RouteId
  importedAt: unknown
}
```

### 13.2 importedAt

- 必须是 string。
- 必须是规范 UTC ISO-8601 格式：`YYYY-MM-DDTHH:mm:ss.sssZ`。
- `new Date(value).toISOString()` 必须与输入完全相同。
- D3.1 不读取系统时间，也不自动修复时区。
- 非法时间返回 `DOMAIN_INVARIANT_VIOLATION`，details.field 为 `importedAt`。

### 13.3 保证

- RouteAsset 保留 QualifiedRoute 的全部不变量。
- routeId 和 importedAt 构造后不可改变。
- RouteAsset 不暴露内部 originalBytes 引用。
- 创建 Asset 不修改 QualifiedRoute。

## 14. 读取和复制契约

### 14.1 toSummary

返回父契约定义的 RouteSummary：

- 不包含原始字节、航点数组或内部对象。
- 每次调用结果在语义上相同。
- 返回对象不可变或与内部状态完全隔离。

### 14.2 toDetail

返回父契约定义的 RouteDetail：

- 航点和警告按契约顺序返回。
- 数组不可修改内部状态。
- 不包含原始字节。

### 14.3 copyOriginalBytes

- 每次调用返回新的 Uint8Array。
- 修改返回数组不得影响 RouteAsset。
- 两次返回的数组引用必须不同，但字节内容相同。
- D3.1 不缓存或返回共享的可变数组。

## 15. RouteLibraryError 契约

### 15.1 错误码来源

`RouteErrorCode` 必须与 D3 父契约完全一致。D3.1 不得定义只有自己知道的额外错误码。

### 15.2 recoverable

`recoverable` 由错误码决定，调用方不能传入或覆盖。

至少满足：

- `INVALID_FILE_NAME`、`INVALID_COORDINATE`、`INSUFFICIENT_WAYPOINTS` 为可恢复错误。
- `DOMAIN_INVARIANT_VIOLATION`、`INVALID_CONFIGURATION` 为不可恢复错误。

其余错误码的恢复属性以父契约表格为准。

### 15.3 details

details 必须：

- 只包含 null、boolean、有限 number、string、数组和普通对象。
- 深拷贝并成为只读值。
- 不包含 Error、Date、Map、Set、函数、symbol、DOM、Buffer 或 Uint8Array。
- 不包含完整文件字节、完整 XML、地图 Key 或绝对本地路径。
- 遇到非法 details 时忽略非法字段并记录稳定的安全摘要，不得让错误构造本身失败。

### 15.4 message

- message 必须非空。
- 默认中文消息由错误码稳定映射。
- details 可以补充上下文，但不得改变错误码含义。
- 调用方不得通过解析 message 做业务判断。

## 16. 不可变性实现约束

契约不强制使用 class 或函数，但实现必须满足：

- 品牌 symbol、构造 token 或等价证明不得导出。
- 普通对象和数组必须深冻结或完全封装。
- Uint8Array 不能依靠 Object.freeze 保证安全，必须使用私有副本和复制读取。
- 构造器不得保留调用方输入对象、数组或字节引用。
- RouteAsset 不得提供可变 setter。
- 测试不得使用生产代码中的绕过入口。

## 17. 依赖契约

D3.1 生产代码只允许依赖：

- TypeScript/JavaScript 标准语言能力。
- 同一 D3.1 模块内部文件。

D3.1 生产代码禁止依赖：

- Vue、Electron、DOM、Cesium。
- Node.js fs、path、crypto、Buffer。
- JSZip 或 XML 解析库。
- 日期、UUID 或随机数生成库。
- D3.2 至 D3.7、`geo-map`、`mission-control`、手机端代码。
- 全局应用状态、日志单例或配置文件。

测试代码可以使用属性测试和测试运行器依赖，但不能让这些依赖进入生产导出。

## 18. 文件与内部结构

D3.1 可以拆成多个实现文件，例如 values、errors、route、asset，但它们仍属于一个正式二级模块，共享一个 `CONTRACT.md` 和一个公开入口。

建议只有一个公开导出入口：

```text
domain/index.ts
```

调用方不得深层导入内部文件。构建或 lint 必须阻止：

```text
domain/internal/*
domain/values/*
domain/errors/*
```

D3.1 当前不需要继续拆分为正式三级模块，因为其内部没有多个真实调用方或可替换 Adapter。

## 19. 复杂度和性能契约

- createRouteId、createWaypoint 和 createError 为 O(1)。
- createQualifiedRoute 和 createRouteAsset 为 O(n + b)，n 为航点数，b 为需要复制的字节数。
- 不允许对航点进行嵌套全量扫描形成 O(n²)。
- toSummary 为 O(1)。
- toDetail 为 O(n)，因为需要隔离航点和警告集合。
- copyOriginalBytes 为 O(b)。
- D3.1 不计算 SHA-256、不解析 XML、不解压 ZIP。
- 对 100,000 个航点的验证必须保持线性增长；测试使用规模倍率验证复杂度趋势，不使用脆弱的固定毫秒阈值作为唯一判断。

## 20. 并发与可重入性

- D3.1 无共享可变状态。
- 所有构造和读取接口可并发调用。
- 同样输入产生语义相同的结果。
- 并发调用 copyOriginalBytes 返回彼此独立的数组。
- D3.1 不负责对目录变更加锁；那是 D3.4 的职责。

## 21. 使用示例

### 21.1 创建航点

```text
result = createWaypoint({
  longitude: 120.1665,
  latitude: 30.3214,
  altitude: 80,
  sequence: 0
})

result.ok == true
```

### 21.2 拒绝非法坐标

```text
result = createWaypoint({
  longitude: 181,
  latitude: 30,
  altitude: null,
  sequence: 0
})

result.ok == false
result.error.code == "INVALID_COORDINATE"
result.error.details.field == "longitude"
```

### 21.3 防止 KML 被标记为上传候选

```text
createQualifiedRoute({
  format: "kml",
  classification: "upload-candidate",
  ...
})

返回 DOMAIN_INVARIANT_VIOLATION
```

### 21.4 原始字节隔离

```text
copyA = copyOriginalBytes(asset)
copyB = copyOriginalBytes(asset)

copyA !== copyB
copyA 的内容等于 copyB
修改 copyA 不影响 copyB 或 asset
```

## 22. 测试契约

### 22.1 RouteId 测试

- 最短 1 字符和最长 128 字符。
- 129 字符。
- 合法字母、数字、点、下划线、连字符。
- 空字符串、空白、首尾空白、中文、斜杠、反斜杠、控制字符。
- 首字符为点、下划线或连字符。
- 普通 string 在类型测试中不能赋给 RouteId。
- 私有品牌不得出现在公开导出中。

### 22.2 RouteWaypoint 测试

- 经度 -180、0、180 和边界外最小偏差。
- 纬度 -90、0、90 和边界外最小偏差。
- null、0、负数和正数高度。
- undefined、字符串、NaN、Infinity 和负 Infinity。
- sequence 0、正整数、负数、小数、超出安全整数。
- `-0` 输出规范化。
- 输入对象修改不影响结果。

### 22.3 元数据测试

- 中文、空格和大小写扩展名文件名。
- 空名、首尾空白、路径、盘符、NUL 和控制字符。
- format 与扩展名一致或冲突。
- 安全相对 sourceDocument 和路径穿越。
- 正确 64 位小写 SHA-256、错误长度、大写和非法字符。
- sizeBytes 与字节长度一致或不一致。
- 空 originalBytes。

### 22.4 分类和警告测试

- KML preview-only。
- KML upload-candidate 被拒绝。
- KMZ preview-only + WPML_MISSING。
- KMZ preview-only + DJI_TEMPLATE_MISSING。
- KMZ upload-candidate + WPML sourceDocument。
- upload-candidate 包含 WPML_MISSING 或 DJI_TEMPLATE_MISSING 被拒绝。
- 任意缺失高度对应 ALTITUDE_MISSING。
- 高度完整时错误携带 ALTITUDE_MISSING 被拒绝。
- 重复警告、未知警告和警告顺序规范化。
- 地图警告不能进入 RouteWarning。

### 22.5 QualifiedRoute 测试

- 0、1、2 和大量航点。
- sequence 连续、重复、跳号和乱序。
- 伪造 RouteWaypoint 对象。
- 输入数组、警告和字节修改不影响结果。
- 分类、格式、sourceDocument 和 warnings 的所有合法/非法组合。
- 构造失败不返回部分领域对象。

### 22.6 RouteAsset 测试

- 合法和非法 RouteId。
- 规范 UTC importedAt。
- 非 UTC、无毫秒、不可解析和可解析但非规范时间。
- Asset 保留 QualifiedRoute 语义。
- 输入 QualifiedRoute 不被修改。
- routeId 和 importedAt 不可修改。

### 22.7 读取隔离测试

- Summary 不包含航点、警告和字节。
- Detail 不包含字节。
- 修改 Summary/Detail 不影响 Asset。
- 两次读取 Detail 不共享可变数组。
- 每次 copyOriginalBytes 返回新引用。
- 修改任意返回字节不影响后续读取。

### 22.8 错误测试

- 父契约每个错误码都能生成正确 recoverable。
- message 非空且稳定。
- details 深拷贝且不可修改。
- 非 JSON-safe details 被安全处理。
- details 不泄漏字节、完整 XML、密钥和绝对路径。
- createError 本身不得因为 details 异常而失败。

### 22.9 属性测试

- 任意有限且范围内的经纬度都成功。
- 任意范围外或非有限经纬度都失败。
- 任意非负安全整数 sequence 都通过单点验证。
- 任意合法 RouteId 字符串往返不变。
- 任意非法 RouteId 不会生成 RouteId。
- 任意输入数组和字节后续变更不影响已创建对象。
- 任意航点排列只有从 0 连续递增时可创建 QualifiedRoute。

### 22.10 依赖和接口测试

- 生产依赖图中不存在禁止依赖。
- 只有 domain/index.ts 可以被外部导入。
- 品牌 symbol、内部构造 token 和原始字节字段未导出。
- 不存在 `unsafe`、`unchecked`、`as unknown as` 绕过入口。
- D3.1 不读取 Date.now、crypto.randomUUID 或全局状态。

### 22.11 覆盖要求

- 语句、函数和分支覆盖率均为 100%。
- 每个不变量至少有一个接受测试和一个拒绝测试。
- 每个错误分支至少有一个直接测试。
- 属性测试使用固定 seed 输出，失败可以复现。
- 对关键不变量运行 mutation testing；改变范围边界、分类组合、复制行为或 sequence 检查的变异不得存活。
- 缺陷修复必须先添加能够稳定复现缺陷的回归测试。

## 23. 一级集成交接契约

D3.1 完成后还必须证明它能被后续模块正确使用：

- D3.2 可以提供经过解析的原始值，但不能直接创建 RouteAsset。
- D3.3 只能通过 D3.1 构造 RouteWaypoint 和 QualifiedRoute。
- D3 一级实现只能通过 D3.1 创建 RouteId 和 RouteAsset。
- D3.4 只接收合法 RouteAsset。
- D3.5 只接收由 D3.1 输出的 RouteDetail。
- `mission-control` 无法从 D3.1 直接取得内部原始字节，必须通过 D3 一级 `getMissionPayload`。

## 24. 完成定义

D3.1 只有同时满足以下条件才算完成：

- 本契约已批准。
- 先写测试并观察关键测试在无实现时失败。
- 全部构造接口和读取接口符合本文。
- 所有领域对象和 Result 不可变。
- 原始字节无法通过任何公开路径被共享修改。
- 100% 语句、函数和分支覆盖率达成。
- 属性测试、mutation testing 和依赖测试通过。
- 没有禁止依赖、深层导入或绕过构造入口。
- D3 父契约的相关验收场景可以只通过 D3.1 公开接口准备合法领域对象。
- 实现与本文不存在未记录差异。

## 25. 已批准技术决策

以下决策已于 2026-08-09 经项目方授权，由技术负责人按可维护性、可扩展性和合理实现成本进行评估后批准。修改任何一项都必须先更新契约版本并说明对调用方和测试的影响。

1. D3.1 所有预期校验失败返回 DomainResult，不使用异常作为正常控制流。
2. RouteId 使用 1 至 128 位 ASCII 安全字符，不允许自动 trim。
3. 高度允许 null、零和负数，但不允许 undefined、字符串或非有限数。
4. D3.1 不解释高度基准，也不转换单位。
5. KML 永远不能构造为 upload-candidate。
6. originalBytes 在构造和读取时都执行防御性复制。
7. importedAt 必须由外部 Clock 提供规范 UTC ISO 字符串。
8. SHA-256 只验证格式，内容计算和一致性由 D3.2 与集成测试负责。
9. RouteWarning 只包含 WPML_MISSING、DJI_TEMPLATE_MISSING 和 ALTITUDE_MISSING；地图警告属于一级模块 `geo-map`。
10. D3.1 生产代码不使用任何第三方运行时依赖。
11. D3.1 不再拆成正式三级模块，多个实现文件仍共享一个公开入口和契约。

### 25.1 通俗说明

| 决策 | 选择理由 |
|---|---|
| 校验失败返回 DomainResult | 文件数据有问题时返回明确结果，不依赖崩溃或猜异常类型。 |
| RouteId 使用安全字符 | ID 可以稳定用于日志、Map、测试和未来持久化，不受中文编码或路径字符影响。 |
| 高度允许 null、零和负数 | 忠实保留原始语义，不把“缺失高度”错误改成零，也不误删合法负高度。 |
| 不解释高度基准 | D3.1 没有足够上下文判断海拔、椭球高或相对高度，猜测会造成飞行风险。 |
| KML 不能成为上传候选 | 普通 KML 没有完整 DJI 任务语义，禁止误上传。 |
| 字节进行防御性复制 | 防止界面、测试或其他模块无意修改即将上传的任务文件。 |
| 时间由外部 Clock 提供 | 测试结果稳定，将来切换时间来源也不需要修改领域核心。 |
| D3.1 不计算 SHA-256 | 摘要计算只保留在文件导入模块，避免重复工作和职责重叠。 |
| 航线警告与地图警告分离 | 文件本身的问题不会与网络、底图或三维模型故障混在一起。 |
| 核心不使用第三方运行时依赖 | 领域规则不会被 UI、地图或解析库升级牵连。 |
| 不继续拆分三级模块 | 保持一个小而稳定的公开入口，避免大量只做转发的浅模块。 |
