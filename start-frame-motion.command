#!/bin/zsh
set -e
cd "${0:A:h}"
# Prefer a working LTS Node without changing the machine's global toolchain.
for frame_node_dir in /opt/homebrew/opt/node@22/bin /opt/homebrew/opt/node@20/bin; do
  if [[ -x "$frame_node_dir/node" ]] && "$frame_node_dir/node" --version >/dev/null 2>&1; then
    export PATH="$frame_node_dir:$PATH"
    break
  fi
done
if ! node --version >/dev/null 2>&1; then
  print '请安装 Node.js 22 LTS，然后重新运行。'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  npm ci
fi
if [[ -f .frame-motion/network.json ]]; then
  print '正在更新远程访问所需的应用页面…'
  npm run build
fi
print '\nFrame Motion · http://127.0.0.1:5173\n按 Control-C 停止本地服务。\n'
npm run dev
