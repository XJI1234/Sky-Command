# 底图提供者模块契约

状态：已批准实施

## 职责

`basemap-provider` 是 `geo-map` 内唯一负责把经过规范化的底图选择转换为“引擎无关瓦片图层描述”的二级模块。当前支持天地图 Web Mercator 矢量底图和影像底图，并为每种底图生成一个基础图层和一个注记图层。

它只产生纯数据，不创建地图场景，不请求瓦片，不访问网络、DOM、Electron、文件系统或环境变量，不持久化、不记录、不展示凭据，也不导入 Cesium、天地图 SDK 或其他地图引擎包。它不决定用户的地图设置，也不验证凭据在天地图服务端是否真实可用。

## 对外接口

```ts
type BasemapKind = "tianditu-vector" | "tianditu-image";

interface BasemapRequest {
  readonly basemap: BasemapKind;
  readonly credential: string | null;
}

interface BasemapTileLayer {
  readonly id: "base" | "annotation";
  readonly urlTemplate: string;
  readonly subdomains: readonly string[];
  readonly minimumZoom: 1;
  readonly maximumZoom: 18;
  readonly tilingScheme: "web-mercator";
}

interface BasemapDescriptor {
  readonly basemap: BasemapKind;
  readonly layers: readonly [BasemapTileLayer, BasemapTileLayer];
}

BasemapProvider.resolve(input: unknown): BasemapProviderResult<BasemapDescriptor>;
```

结果为二选一：成功时返回 `{ ok: true, value }`；失败时返回 `{ ok: false, error }`。结果、错误、描述、图层与子域名数组均为冻结副本。调用方可以把 `BasemapDescriptor` 交给未来的具体地图引擎适配器，但不能从中获得原始输入对象的可变引用。

## 输入规则

输入必须为普通可读取对象，且只读取 `basemap` 与 `credential` 各一次。`basemap` 只能为 `"tianditu-vector"` 或 `"tianditu-image"`。`credential` 为必填的非空字符串：不允许首尾空白、内部空白或控制字符，长度最多 256 个 Unicode 码点。字符串中的 URI 保留字符不视为非法；模块必须使用 URI 编码把它安全放入 `tk` 查询参数，绝不进行字符串拼接泄漏。

`credential: null` 有明确含义：尚未配置服务密钥。此时返回 `CREDENTIAL_REQUIRED`，不会生成不完整或匿名的瓦片 URL。任何 getter 读取异常、非法容器、非法字段都转换为结构化错误，绝不向调用方抛出异常，也不在错误中回显凭据或 getter 的异常文字。

## 生成规则

所有输出使用天地图 Web Mercator WMTS 端点和 `{s}` 子域名占位符，子域名固定为 `"0"` 到 `"7"`。图层顺序固定为基础图层、注记图层：

- `tianditu-vector`：`vec_w`、`cva_w`
- `tianditu-image`：`img_w`、`cia_w`

两个图层均固定使用 `SERVICE=WMTS`、`REQUEST=GetTile`、`VERSION=1.0.0`、`STYLE=default`、`TILEMATRIXSET=w`、`FORMAT=tiles`、`TILEMATRIX={z}`、`TILEROW={y}`、`TILECOL={x}` 和经过编码的 `tk`。缩放范围固定为 1 至 18，坐标方案固定为 `web-mercator`。输入相同则输出字节级等价的描述；模块没有缓存、时钟、随机数或网络状态。

## 错误契约

错误码只允许：

- `INVALID_REQUEST`：输入容器或字段不符合本契约。
- `CREDENTIAL_REQUIRED`：底图类型有效但凭据为 `null`。

`INVALID_REQUEST` 的详情只允许稳定的 `field`（`input`、`basemap`、`credential`）和 `reason`（`invalid-container`、`unreadable`、`invalid-type`、`unsupported-basemap`、`credential-empty`、`credential-too-long`、`credential-unsafe-text`）。错误信息不得包含调用方提供的凭据、URL 或异常文本。

## 依赖与验证

生产实现只能依赖 ECMAScript 标准库；不导入设置模块、地图引擎、网络、Node、UI、航线、任务或飞行控制模块。地图设置模块负责上游持久化和规范化；本模块仍在公共边界做完整防御性验证，因而可独立复用和测试。

测试只能经公开接口，覆盖两种底图、URL 编码、图层顺序、冻结副本、所有拒绝路径、恶意 getter、错误保密、架构隔离、类型边界和批量解析性能。语句、分支、函数、行覆盖率及有效变异杀灭率均为 100%。
