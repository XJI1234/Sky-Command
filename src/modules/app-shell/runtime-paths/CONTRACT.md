# runtime-paths 二级模块契约

状态：已批准实施

## 职责

只根据调用方提供的开发/打包标志和目录值生成不可变运行路径快照。它不访问文件系统，不拼接未经校验的绝对路径，不决定文件内容。

## 接口

```ts
RuntimePaths.resolve(input) -> RuntimePathsResult
```

`userData`、`appRoot` 和 `rendererEntry` 必须是非空绝对路径；开发环境和打包环境分别保留调用方提供的入口。非法输入返回 `INVALID_INPUT`，不抛异常。结果中的路径字符串和对象均为冻结副本。
