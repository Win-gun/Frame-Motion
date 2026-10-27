# Frame Motion

[![Windows CI](https://github.com/Win-gun/Frame-Motion/actions/workflows/windows.yml/badge.svg)](https://github.com/Win-gun/Frame-Motion/actions/workflows/windows.yml)

把摄影成片制作成可直接插入剪辑时间轴的动态展示视频。导入照片、读取 EXIF、调整构图与动画，逐帧预览，再用本地 Remotion 渲染器导出真实视频。

这是独立的 Frame Motion 照片工具，包含一张可替换的人像示例。照片处理、项目缓存和视频渲染在运行应用的电脑上完成，无需 AI API 或云端渲染账号。

## 启动

需要 Node.js 22 LTS、npm。真实视频验收脚本还需要系统 FFmpeg / ffprobe。

```sh
git clone https://github.com/Win-gun/Frame-Motion.git
cd Frame-Motion
npm ci
npm run dev
```

打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)。macOS 也可双击 `start-frame-motion.command`。首次导出可能下载 Remotion 所需的 Chromium；准备完成后，照片处理和视频渲染均在本机进行。

运行构建后的页面：

```sh
npm run build
npm start
```

## Windows 启动

在 Windows x64 上安装 Node.js 22 后，可在 PowerShell 中运行：

```powershell
npm.cmd ci --include=dev
npm.cmd run build
npm.cmd start
```

生产启动脚本可跨平台设置环境变量，无需手动输入 `NODE_ENV=production`。Windows 下优先使用 JPG/PNG；HEIC 解码失败时没有 macOS ImageIO 后备路径。系统 FFmpeg / ffprobe 仅为验收脚本所需，运行完整的多规格验收仍需处理其中的 macOS `sips` 步骤。

## 使用

1. 导入 JPG、PNG 或 HEIC，可以多选或拖入照片。自动读取摄影 EXIF；缺失字段可手动补充。
2. 选择画幅、分辨率和图文布局。横屏竖图可使用「图左文右」或「图右文左」，自动布局也会为这类照片左右排版。
3. 调整照片大小、位置、背景、阴影和文字。尺寸范围为10–200%，位置范围为画布宽高的±100%；「重置构图」恢复默认布局。
4. 设置1–60秒时长及24/25/30/60fps。拖动时间轴调整入场、收尾与摄影参数出现时间；空格播放，方向键逐帧检查。
5. 点击「导出视频」。队列支持进度、取消、失败重试、单文件下载和批量 ZIP。

每张照片保存独立设置。「应用当前设计到全部」复制设计和时长，保留各照片自己的 EXIF。项目参数保存在当前浏览器的 localStorage；照片缓存、任务和输出保存在 `.frame-motion/`。

## 画面与输出

- Floating Photo Reveal 模板，以及 Soft Reveal、Gallery Lift、Shutter Reveal、Cinematic Push、Still 动效。
- 静态模糊、缓慢游移、波动和呼吸背景；可调方向、速度、强度与循环。
- 9:16、16:9、4:5、1:1和自定义比例。720p、1080p、2K、4K按短边定义，长边限制为8192像素。
- MP4：H.264、yuv420p、无音轨；适合常用剪辑软件。
- MOV：ProRes HQ、yuv422p10le、无音轨。
- Player 预览与服务端导出共用 Composition 和 VideoRecipe；编辑器安全线不会写入视频。

## 示例照片

仓库只包含下面这一张人像，来源与许可见 [图片说明](public/demo/CREDITS.md)。界面中示例摄影参数为手动演示值，不代表原始 EXIF。

<img src="public/demo/02-portrait.jpg" alt="Frame Motion 人像示例" width="300" />

## 局域网与 Tailscale

默认只监听 `127.0.0.1`。需要局域网访问时，先构建，再明确设置本机实际的局域网地址，例如：

```sh
npm run build
FRAME_MOTION_HOST=0.0.0.0 \
FRAME_MOTION_PUBLIC_ORIGIN=http://192.168.1.50:5173 \
npm start
```

将示例 IP 换成运行电脑的实际私有 IPv4 地址。其他设备使用相同 origin 打开页面。服务器精确校验 Host / Origin，地址改变后需要同步修改配置。局域网访问者共享服务端照片与导出队列，适合可信网络。

Tailscale Serve 可将本地回环服务提供为私有 HTTPS 入口。在已设置好 Tailscale 的电脑上，将 `FRAME_MOTION_PUBLIC_ORIGIN` 设为自己的 HTTPS `.ts.net` 根地址，再配置 Serve 转发至 `127.0.0.1:5173`。也可把 `publicOrigin` 写入 `.frame-motion/network.json`；环境变量优先。不要把个人网络配置或 `.frame-motion/` 提交到仓库。

远程开发访问使用 `dist` 中的构建页面；前端代码变更后需重新运行 `npm run build` 更新远程页面。

## 验证

```sh
npm run typecheck
npm test
npm run build
# 服务启动后运行；需要 FFmpeg / ffprobe，完整 HEIC 验收需要 macOS
npm run test:integration
```

可用 `PORT` 指定独立验收端口，并用 `RENDER_BASE_URL` 指定验收地址。完整渲染验收会创建测试任务和视频，宜在独立测试工作区运行。

## Windows 自动验收

[Windows CI](https://github.com/Win-gun/Frame-Motion/actions/workflows/windows.yml) 在推送到 `main`、Pull Request 和手动运行时触发，使用 Windows x64 与 Node.js 22，依次验证：

1. 按锁文件安装、TypeScript检查、单元测试及生产构建。
2. 安装FFmpeg / ffprobe并准备Remotion的渲染浏览器。
3. 通过与 `npm start` 相同的生产入口启动服务，验证静态页面、唯一人像示例及照片和背景接口。
4. 实际上传PNG、排队渲染并下载MP4，核对H.264 / yuv420p / 720×720 / 24fps / 24帧 / 1秒 / 无音轨，提取关键帧。
5. 关闭本轮测试进程并核对端口释放。

在Mac浏览器打开运行详情，即可查看各步骤日志。在 **Artifacts** 下载 `windows-x64-render-proof`，其中包含MP4、关键帧、JSON报告与服务日志，保留7天。此工作流不把HEIC、ProRes、4K或桌面浏览器交互列为已验证能力。

本地运行同一验收器需要一个没有 `.frame-motion/` 数据的独立工作区、已完成的生产构建，以及FFmpeg / ffprobe：

```sh
CI=true npm run test:ci
```

验收器会拒绝已有运行数据，避免误用真实项目目录。

## 目录

```text
src/                 编辑器、共享配方、确定性动画与 Remotion Composition
server/              导入、EXIF、图片缓存、渲染队列和下载接口
public/demo/         唯一人像示例与来源说明
tests/               时间、布局、批量提交、网络和图片安全测试
scripts/             环境检查与真实视频验收
.frame-motion/       运行时数据；不进入 Git
```

[架构说明](docs/ARCHITECTURE.md) · [验收记录](docs/VERIFICATION.md) · [第三方许可](docs/LICENSES.md)

HEIC 解码取决于 sharp 的编解码支持，macOS 可回退到系统 ImageIO。4K及长片会消耗更多时间与内存，导出采用串行队列；当前默认使用软件编码。Remotion 适用其专门许可证，使用时请核对对应主体的授权条件。
