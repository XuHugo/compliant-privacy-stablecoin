#!/bin/bash
set -e

# 获取脚本所在目录的绝对路径
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$DIR/.."

# 确保 wasm-pack 路径在 PATH 中
export PATH=$PATH:/home/zaq1/.cargo/bin

echo "=== 开始编译 WebAssembly 模块 ==="
cd "$PROJECT_ROOT/wasm"

# 编译并生成 Web 绑定包，输出到 frontend/pkg
wasm-pack build --target web --out-dir ../frontend/pkg

echo "=== WASM 模块编译成功，输出至 frontend/pkg ==="
