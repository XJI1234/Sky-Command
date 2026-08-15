# 设置存储模块契约

状态：已批准实施

## 职责

`settings-store` 拥有一份内存中的桌面设置快照，并在它与小型、带版本的 UTF-8 JSON 文档之间转换。它是唯一可与存储适配器交互的设置模块；适配器可以是文件、IndexedDB 或内存测试替身，但本模块不导入 Node、Electron 或文件系统实现。

## 对外接口

```ts
interface SettingsStorage {
  read(): Promise<Uint8Array | null>;
  writeAtomically(bytes: Uint8Array): Promise<void>;
}

DesktopSettings.create(storage: SettingsStorage): DesktopSettingsInstance;
```

实例从版本 1 的默认快照开始，`create` 不进行 I/O。`snapshot`、`load`、`updateNetwork`、`updateMap`、`save` 的所有返回快照及嵌套对象均不可变。

## 快照、加载和恢复

快照固定为 `{ version: 1, network: { listenPort, relayPort, manualHost }, map: { basemap, credential } }`；默认 RTMP 口 `19500`、中继口 `8080`、自动选择主机、天地图矢量底图、无凭据。两类更新必须委托各自设置模块，且只在成功时提交。

`read()` 返回 `null`、无效 UTF-8/JSON、非对象根、无效设置或不支持版本时，返回带默认值的 `recovered`，但绝不覆盖原字节。v0 在内存中迁移：顶层 `port`、`host` 映射到 `network.listenPort`、`network.manualHost`，缺失的 `relayPort` 与地图字段使用默认值；成功迁移仍返回 `loaded`。读取异常返回 `failed/STORAGE_READ_FAILED`，不得泄露适配器消息或路径。

## 保存与并发

`save()` 以稳定字段顺序编码完整 UTF-8 快照，并把新字节数组交给 `writeAtomically`。适配器即使修改该数组也不得影响内存快照；写入失败返回 `STORAGE_WRITE_FAILED`，保留快照。

`load` 与 `save` 按调用顺序串行；保存必须捕获调用时的完整快照，后续更新不得混入本次写入。更新同步，可在异步读写期间执行。

## 错误、边界和验证

错误码固定为 `INVALID_CONFIGURATION`、`INVALID_NETWORK_SETTINGS`、`INVALID_MAP_SETTINGS`、`STORAGE_READ_FAILED`、`STORAGE_WRITE_FAILED`。错误只含稳定字段/原因或受托校验错误，绝不含凭据、原始 JSON、适配器消息或堆栈。

本模块不决定飞行是否可用，不打开 Socket，不加载地图。测试只经公开接口和内存适配器，覆盖默认值、合法更新、所有恢复原因、v0 迁移、畸形字节、读写失败、稳定序列化、字节隔离、并发顺序及不可变快照；覆盖率和有效变异杀灭率均须为 100%。
