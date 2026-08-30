# D3.3 航线资格判定模块契约

状态：已批准  
契约版本：0.1.0  
父契约：`../CONTRACT.md` 0.2.3  
模块标识：`route-qualification`

## 1. 模块目的

D3.3 把 D3.2 已安全解析的 `ParsedRouteDocument` 转换为 D3.1 已验证、不可变的 `QualifiedRoute`。它是“语法读取”和“会话目录”之间唯一的业务判定层：决定整份航线是否可作为资产保存，以及其分类是 `preview-only` 还是 `upload-candidate`。

调用方只能使用：

```text
RouteQualification.qualify(parsedDocument, limits) -> DomainResult<QualifiedRoute>
```

`DomainResult`、`QualifiedRoute`、`RouteLibraryError` 和 `ParsedRouteDocument` 都只通过各自一级公开入口导入。D3.3 不暴露内部文本转换器、候选记录验证器或分类规则。

## 2. 单一职责与非职责

D3.3 负责：

1. 重新验证 D3.2 输出的结构、文档元数据和候选记录，避免 TypeScript 类型断言或跨语言调用绕过不变量。
2. 将经纬度、高度和 WPML 航点索引的文本按本契约转换为有限数值。
3. 使用 D3.1 `createWaypoint` 创建每个航点，验证航点数量和序号连续性。
4. 按文件格式、来源文档和 WPML 存在性决定分类，并生成唯一、固定顺序的领域警告。
5. 使用 D3.1 `createQualifiedRoute` 原子创建最终结果；任一步失败都不返回部分航线。

D3.3 不负责：

- 读取文件、复制调用方输入、识别容器、解压 KMZ、解析 XML、计算 SHA-256 或取消任务；这些属于 D3.2。
- 生成 routeId、读取时间、保存原始文件、去重、排序、选择、删除或会话状态；这些属于 D3.1/D3.4 和 D3 一级编排。
- 创建地图预览、调用地图、Vue、Electron、DOM、网络、Android、DJI MSDK 或文件系统。
- 判断飞机、固件或 DJI WPMZManager 是否最终允许执行任务。

## 3. 公开数据与配置

```text
RouteQualificationLimits {
  maxWaypoints: number
}
```

规则：

- `maxWaypoints` 必须是正安全整数；否则返回 `DOMAIN_INVARIANT_VIOLATION`，`details.field = "maxWaypoints"`。
- D3.3 只消费这一个限制，不能依赖 D3.2 的私有 limits 类型，也不重复文件大小、归档条目或解压总量检查。
- `parsedDocument` 可以来自 D3.2 的公开结果，但运行时仍视为不可信对象；读取 getter 或属性抛错时返回 `DOMAIN_INVARIANT_VIOLATION`，不得泄漏原始异常。

## 4. 输入完整性

成功判定前必须验证以下关系：

| 字段 | 要求 | 不满足时 |
|---|---|---|
| `fileName` | 非空安全 basename，扩展名为 `.kml` 或 `.kmz` | `DOMAIN_INVARIANT_VIOLATION` |
| `format` | 作为原始文档元数据传入 D3.1；D3.1 原子构造时强制仅为 `kml` 或 `kmz`，并验证文件名扩展名一致性 | `DOMAIN_INVARIANT_VIOLATION` |
| `sourceDocument` | 非空安全逻辑相对路径，无盘符、绝对路径、控制字符或 `..` | `DOMAIN_INVARIANT_VIOLATION` |
| `sourceKind` | 仅为 `kml` 或 `waylines-wpml` | `DOMAIN_INVARIANT_VIOLATION` |
| `hasCompanionTemplate` | boolean；仅 `kmz` 的 `waylines-wpml` 来源可以为 `true` | `DOMAIN_INVARIANT_VIOLATION` |
| `sha256` | 作为原始文档元数据传入 D3.1；D3.1 原子构造时强制为 64 位小写十六进制 | `DOMAIN_INVARIANT_VIOLATION` |
| `sizeBytes` | 作为原始文档元数据传入 D3.1；D3.1 原子构造时强制为正安全整数且等于 `originalBytes.byteLength` | `DOMAIN_INVARIANT_VIOLATION` |
| `originalBytes` | 作为原始文档元数据传入 D3.1；D3.1 原子构造时强制为非空 `Uint8Array`。D3.3 不在模块状态中保留它 | `DOMAIN_INVARIANT_VIOLATION` |
| `waypointCandidates` | 真实数组，长度不超过 `maxWaypoints` | `DOMAIN_INVARIANT_VIOLATION` 或 `TOO_MANY_WAYPOINTS` |

来源一致性：

- `format = "kml"` 时必须 `sourceKind = "kml"`，且 `sourceDocument` 以 `.kml` 结尾。
- `format = "kmz"`、`sourceKind = "waylines-wpml"` 时 `sourceDocument` 必须以 `.wpml` 结尾，且 `wpmlNamespace` 必须是 D3.2 已识别的 DJI WPML URI。
- `format = "kmz"`、`sourceKind = "kml"` 时 `sourceDocument` 必须以 `.kml` 结尾；它代表归档中没有被选中的 `waylines.wpml`。
- `hasCompanionTemplate = true` 时必须是 `format = "kmz"`、`sourceKind = "waylines-wpml"`；`false` 不表示文件无效，而是会参与第 6 节的确定分类。
- 其他组合均为内部契约破坏，不应伪装为用户文件错误。

DJI WPML URI 的有效形式为以 `http://www.dji.com/wpmz/` 或 `https://www.dji.com/wpmz/` 开头且前缀后至少还有一个字符的 URI。D3.3 不解释具体版本号，只验证 D3.2 的识别结果未被伪造。

## 5. 候选航点转换

每个候选记录按数组位置 `i` 处理。它的 `documentOrder` 必须是安全整数且恰为 `i`，否则返回 `DOMAIN_INVARIANT_VIOLATION`，`details.field = "documentOrder"`、`details.index = i`。

### 5.1 文本数字语法

经度、纬度和非空高度只接受下列 ASCII 十进制语法：

```text
^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$
```

不得自动 trim、不得接受 `NaN`、`Infinity`、十六进制、千分位、Unicode 数字、空格或本地化小数点。转换结果必须是有限数值；边界范围由 D3.1 `createWaypoint` 决定。

高度文本为 `null` 时生成 `altitude = null`；任何非空高度文本不合法时都是 `INVALID_COORDINATE`，`details.field = "altitude"`。高度为零或负数合法。

### 5.2 普通 KML 与预览 KMZ

当 `sourceKind = "kml"`：

- `declaredSequenceText` 必须为 `null`。
- 最终 sequence 为候选的 `documentOrder`。
- 经度和纬度必须存在并满足第 5.1 节；候选的 `malformed = true` 立即失败。

### 5.3 WPML

当 `sourceKind = "waylines-wpml"`：

- `declaredSequenceText` 必须匹配 `^(?:0|[1-9][0-9]*)$`，并能转换为非负安全整数。
- 最终 sequence 使用该数值，必须严格等于候选位置 `i`。不允许重复、跳号、乱序、前导零、正负号或科学计数法。
- 经度、纬度、高度和 `malformed` 的规则与第 5.2 节相同。

序号文本问题返回 `INVALID_COORDINATE`，`details.field = "sequence"`、`details.index = i`。候选格式问题返回 `INVALID_COORDINATE`，`details.field` 为 `longitude`、`latitude`、`altitude` 或 `candidate`。

错误 details 的 `rawSummary` 只能使用候选提供值的前 160 个 Unicode 码点；若其中可能含绝对路径，则替换为 `[redacted]`。不得包含 XML、原始字节、完整本地路径或第三方异常消息。

### 5.4 空候选规则

- 候选数组为空，或所有候选同时缺少经度、纬度且 `rawSummary` 为空，返回 `INSUFFICIENT_WAYPOINTS`，`details.count = 0`。
- 少于两个可处理候选时返回 `INSUFFICIENT_WAYPOINTS`，`details.count` 为候选数。
- 一旦存在非空候选，任何缺失或非法坐标都必须失败，绝不静默删除后继续导入。
- 成功航线至少有两个 D3.1 创建的航点。

## 6. 分类与警告

分类只能通过以下真值表得到：

| format | sourceKind | hasCompanionTemplate | classification | warnings |
|---|---|---|---|
| `kml` | `kml` | `false` | `preview-only` | 高度缺失时仅 `ALTITUDE_MISSING` |
| `kmz` | `kml` | `false` | `preview-only` | 始终 `WPML_MISSING`；高度缺失时再加 `ALTITUDE_MISSING` |
| `kmz` | `waylines-wpml` | `false` | `preview-only` | 始终 `DJI_TEMPLATE_MISSING`；高度缺失时再加 `ALTITUDE_MISSING` |
| `kmz` | `waylines-wpml` | `true` | `upload-candidate` | 高度缺失时仅 `ALTITUDE_MISSING` |

固定警告定义：

```text
WPML_MISSING: "KMZ 中未找到可提交的 waylines.wpml，仅可预览。"
DJI_TEMPLATE_MISSING: "KMZ 缺少与 waylines.wpml 配套的 template.kml，仅可预览。"
ALTITUDE_MISSING: "部分航点未提供高度，将按文件缺失状态预览。"
```

- 警告顺序永远是 `WPML_MISSING`、`DJI_TEMPLATE_MISSING`、`ALTITUDE_MISSING`；前两者互斥。
- 每种警告最多一次，警告 `details` 不存在。
- `upload-candidate` 仅表示桌面侧已具备把原始 KMZ 交给任务模块的条件，绝不表示 DJI 校验、上传或飞行一定成功。

## 7. 原子性、复杂度与隔离

- `qualify` 是同步、无副作用、可重入操作；相同的语义输入得到语义相同的结果。
- 它不保存模块级可变状态，不修改输入 `ParsedRouteDocument`、候选数组、候选对象或原始字节。
- 任一失败不返回部分 `QualifiedRoute`，也不创建任何目录、任务或地图状态。
- 时间复杂度为 O(n + b)：n 为候选数，b 为 D3.1 为隔离原始字节所做的必要复制；不得对候选进行嵌套全量扫描。
- 除 D3.1 最终所有权副本外，不额外复制整份原始文件；候选和警告只保留必要的受控领域对象。

## 8. 内部结构

`qualification/index.ts` 是唯一公开入口。实现可有以下私有文件，但它们不是三级模块，也不得被 D3.3 外部导入：

```text
internal/input.ts       安全读取并验证 ParsedRouteDocument 结构与元数据
internal/number.ts      受限十进制和序号文本转换、受限错误摘要
internal/candidates.ts  候选序列到 D3.1 RouteWaypoint 的线性转换
internal/classify.ts    真值表与固定警告生成
```

只有当出现多个真实调用方或可替换实现需求时，才允许经父契约修订提升新的公开 seam。

## 9. 依赖方向

生产代码只允许导入：

- `../domain/index.ts` 的公开函数和类型；
- `../importer/index.ts` 的公开类型；
- 本模块内部文件和 JavaScript/TypeScript 标准能力。

生产代码禁止导入 D3.2 `internal/*`、D3.4-D3.7、Vue、Electron、DOM、Cesium、Node `fs/path/crypto/Buffer`、ZIP/XML 库、地图或 DJI 代码。D3.3 不创建额外 Adapter；目前不存在可变实现或第二个真实调用方。

## 10. 测试与质量门禁

测试只能从 `qualification/index.ts` 的公开接口调用 D3.3。至少覆盖：

1. KML、仅 template KML 的 KMZ、有效 WPML KMZ 三种分类和全部警告组合。
2. 经度纬度边界、零和负高度、科学计数法、非有限数、空格、空文本、Unicode 数字与超长文本。
3. WPML 索引缺失、前导零、重复、跳号、乱序、超过安全整数和文档顺序不一致。
4. `malformed` 候选、空候选、全空候选、一个候选和超过限制的候选。
5. 所有输入完整性关系、抛错 getter、伪造对象、摘要与字节长度不一致、危险 sourceDocument。
6. 原始输入和输出的不可变性、无共享状态、线性工作量及随机有效/无效候选属性测试。
7. 架构测试：唯一公开入口、无内部深导入、无禁止依赖、无 `unsafe` 或测试后门。

要求：D3.3 生产代码的 statements、branches、functions、lines 均为 100%；所有稳定错误路径有直接测试；变异测试有效变异体 100% killed 或 timeout、无 survivor/no-coverage；`npm run check`、`npm audit --audit-level=high` 均必须通过。任何缺陷先写失败回归测试，再修改实现。

## 11. 完成定义

D3.3 只有同时满足以下条件才算完成：

- 保持唯一 `RouteQualification.qualify` 公开 seam。
- 每个成功结果都由 D3.1 `createWaypoint` 和 `createQualifiedRoute` 创建。
- 分类和警告严格符合第 6 节，KMZ 不被错误承诺为可执行任务。
- 非法候选永不被静默过滤，失败没有部分结果或副作用。
- 所有测试、覆盖率、性能、审计和变异门禁通过，并完成独立只读契约复核。
