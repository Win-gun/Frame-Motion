# 独立仓库验收

2026-10-27，使用 Node.js 22 对本仓库进行验证。

| 检查 | 结果 |
| --- | --- |
| 按锁文件全新 `npm ci` | 通过 |
| 保留的依赖版本与提取来源一致 | 通过，0项版本差异 |
| `npm run typecheck` | 通过 |
| `npm test` | 32项通过 |
| `npm run build` | 通过 |
| 独立生产服务启动 | 通过 |
| `/api/demo` 仅返回一张人像，图片请求成功 | 通过 |
| 新工作区PNG导入、队列、真实MP4导出与下载 | 通过 |
| ffprobe核对输出 | H.264 / yuv420p / 720×720 / 24fps / 24帧 / 1秒 / 无音轨 |
| 测试任务与上传照片清理 | 通过 |

真实渲染验收命令（在另一个终端启动独立服务后执行）：

```sh
PORT=5174 npm start
# 另一个终端：
RENDER_BASE_URL=http://127.0.0.1:5174 RENDER_PNG_ONLY=1 npm run test:integration
```

本次运行PNG烟测分支，未重新执行完整的多规格、HEIC、ProRes或4K验收。完整脚本与相关单元测试保留，便于后续运行。

仓库发布只包含一张人像JPEG；未携带原项目Git历史、其他工具、个人网络配置、照片缓存、任务、部署记录或导出成片。示例JPEG没有EXIF或GPS元数据。构建存在约616kB的JavaScript chunk大小提示，不影响本次构建及渲染通过。
