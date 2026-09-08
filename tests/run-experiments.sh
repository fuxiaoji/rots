#!/bin/bash
# 正式实验矩阵驱动: 4 配对 × 2 剧本 × 32 seed + 消融。产物在 tests/results/。
# 用法: bash tests/run-experiments.sh [quick]
#   quick=1: 8 seed 冒烟
set -u
cd "$(dirname "$0")/.."
N=${1:-32}
if [ "$N" = "quick" ]; then N=8; fi
S=20260903
SC1="1942-1945 (The Shortened Campaign)"
SC2="1943-1945 (The Even Shorter Campaign)"
export EOTS_HEADLESS_MOVES=1

run() { # scenario count seed jpbot albot tag profile
    local sc=$1 n=$2 seed=$3 jp=$4 al=$5 tag=$6 prof=${7:-}
    if [ -n "$prof" ]; then EOTS_OPT_PROFILE=$prof node tests/match-run.js "$sc" "$n" "$seed" "$jp" "$al" "$tag" 2>/dev/null | tail -1
    else node tests/match-run.js "$sc" "$n" "$seed" "$jp" "$al" "$tag" 2>/dev/null | tail -1; fi
}

echo "=== 主矩阵: 配对×剧本 (N=$N) ==="
for sc in "$SC1" "$SC2"; do
    slug=$(echo "$sc" | grep -o '^194[23]')
    run "$sc" "$N" $S erasmus-v2 erasmus-v2 "exp-base-$slug" &
    run "$sc" "$N" $S erasmus-v2-opt erasmus-v2 "exp-jopt-$slug" all &
    run "$sc" "$N" $S erasmus-v2 erasmus-v2-opt "exp-aopt-$slug" all &
    run "$sc" "$N" $S erasmus-v2-opt erasmus-v2-opt "exp-both-$slug" all &
    wait
done

echo "=== 消融 (1942, 双opt, N=$N) ==="
for flag in target_scoring taskforce_math allies_cv_preserve allies_pow_quota allies_resource_raid japan_resource_defense; do
    # all 减去单个开关: profile 语法支持逗号分隔白名单, 这里生成除该开关外的全开列表
    ALL="target_scoring,taskforce_math,allies_cv_preserve,allies_pow_quota,allies_resource_raid,japan_resource_defense"
    PROF=$(echo "$ALL" | tr ',' '\n' | grep -v "^$flag$" | paste -sd, -)
    run "$SC1" "$N" $S erasmus-v2-opt erasmus-v2-opt "exp-ablate-no-$flag" "$PROF"
done
echo "ALL DONE"
