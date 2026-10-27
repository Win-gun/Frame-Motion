# 架构

Frame Motion 是 React / TypeScript / Vite 编辑器与 Express 同源服务。浏览器使用 Remotion Player，Node 服务使用 Remotion Renderer；双方共用 `src/video/FloatingPhoto.tsx`、`VideoRecipe` 和帧动画计算。

| 模块 | 职责 |
| --- | --- |
| `src/App.tsx`、`src/store.ts` | 编辑器、逐帧预览、时间轴、任务界面与浏览器保存 |
| `src/shared/types.ts`、`recipe.ts` | 配方、默认设置、尺寸限制、整数帧预算和旧配置归一化 |
| `src/shared/animation.ts` | 按 frame / fps 确定性计算动画、图文布局与位置 |
| `src/video/` | 同一套预览与导出画面 |
| `server/assets.ts`、`heic.ts` | EXIF白名单、转正、去除源元数据、图片与背景缓存 |
| `server/jobs.ts` | 单并发任务队列、Remotion构建缓存、取消、恢复与编码 |
| `server/network.ts`、`index.ts` | 监听配置、精确Host/Origin校验、API、静态页面和下载 |

## 数据流

上传照片只在内存中解析原始EXIF；白名单摄影参数与已转正、移除原始元数据的JPEG落盘到 `.frame-motion/`。不保留GPS或序列号。背景按照片、模糊值与画布尺寸缓存为预模糊纹理，渲染时只变换纹理。

浏览器为每张照片保存独立配方。提交导出时，服务器依据已登记asset id重建规范资源URL，忽略客户端提供的任意外部图片地址。渲染器始终通过本机回环地址读取资源；客户端任务响应使用同源相对地址，支持远程浏览器访问。

任务与文件使用唯一ID，支持取消、失败重试、MP4预览、单文件下载和ZIP。服务重启后未完成任务标为失败，避免把部分文件误认为成功输出。运行数据不会进入Git。

## 时间与布局

`round(seconds * fps)` 定义输出帧数。入场与出场共享有限预算，为作品展示保留时间。动画只由当前帧与配方推导，没有实时CSS动画、随机数或录屏。

横屏竖图且存在可见元数据时，自动布局使用图文左右排列。手动尺寸和位置允许越界裁切；旧配方偏移通过归一化迁移一次。预览和渲染使用同一布局函数，安全辅助线只属于编辑器覆盖层。

## 网络

默认监听回环。显式配置私有IPv4 HTTP origin或Tailscale HTTPS origin后，允许对应的精确Host / Origin；监听全部接口还需 `FRAME_MOTION_HOST=0.0.0.0`。服务器不信任任意转发头，不提供任意URL或路径读取。远程页面使用生产构建，避免浏览器连接服务端电脑的开发HMR地址。
