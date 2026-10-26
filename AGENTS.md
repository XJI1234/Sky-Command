# Sky Command 测试记录约定

先读根 `CONTRACT.md` 及所改模块的 `CONTRACT.md`，先契约后实现，最小 diff，完成真实验证和自我 Code Review。

用户要求从 2026-10-19 起保留所有自动化测试、构建和真机测试记录。所有验证命令从原工作目录通过统一入口运行：

```powershell
node '../XJICloud/scripts/test-records/run.mjs' --label sky-regression -- node node_modules/vitest/vitest.mjs run <测试文件>
# sdk 工作目录使用 ../../XJICloud/scripts/test-records/run.mjs
```

档案默认 `D:\XJI-Test-Records`，不删除、不轮换。完整输出、退出码和工作区差异应可追溯；真机的 SDK 回执、应用状态与人工观察分别记录，不能把飞机实际动作倒推为 SDK 成功。人工观察与附件使用相邻 XJICloud 仓库 `scripts/test-records/view.mjs mark/attach`。详细契约见该仓库 `scripts/test-records/CONTRACT.md`。
