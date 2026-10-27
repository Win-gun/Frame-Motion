import { execFileSync } from 'node:child_process';
import { access, constants, readdir } from 'node:fs/promises';
import { arch, platform } from 'node:os';
const read = (cmd, args = []) => {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    })
      .trim()
      .split('\n')
      .slice(0, 3)
      .join('\n');
  } catch {
    return 'UNAVAILABLE';
  }
};
const result = {
  os: read('sw_vers'),
  platform: platform(),
  architecture: arch(),
  node: process.version,
  npm: read('npm', ['--version']),
  git: read('git', ['--version']),
  ffmpeg: read('ffmpeg', ['-version']),
  ffprobe: read('ffprobe', ['-version']),
  workspaceWritable: await access(process.cwd(), constants.W_OK).then(
    () => true,
    () => false,
  ),
  chineseFonts: [],
};
for (const dir of ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental', 'public/fonts']) {
  try {
    result.chineseFonts.push(
      ...(await readdir(dir))
        .filter((x) => /NotoSansSC|PingFang|STHeiti|Songti/.test(x))
        .map((x) => `${dir}/${x}`),
    );
  } catch {}
}
console.log(JSON.stringify(result, null, 2));
if (
  !result.workspaceWritable ||
  result.ffmpeg === 'UNAVAILABLE' ||
  result.ffprobe === 'UNAVAILABLE'
)
  process.exitCode = 1;
