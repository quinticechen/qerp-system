#!/usr/bin/env bash
# 產生可貼到 Supabase SQL Editor 執行的單一測試檔 supabase/tests/run.sql。
# 用法：supabase/tests/build-run.sh <尚未套用的 migration 檔...> -- <測試檔...>
# 整批 SQL 以例外結束，因此一定會回滾，不會留下任何資料或結構變更。
set -euo pipefail
cd "$(dirname "$0")"

migrations=()
tests=()
target=migrations
for arg in "$@"; do
  if [[ "$arg" == "--" ]]; then target=tests; continue; fi
  if [[ "$target" == migrations ]]; then migrations+=("$arg"); else tests+=("$arg"); fi
done

{
  echo "-- 自動產生（build-run.sh），請勿手動修改。"
  echo "-- 結果為 \"ALL TESTS PASSED\" 代表通過；\"FAIL: ...\" 或其他錯誤代表未通過。"
  echo "-- 最後一定會丟出例外，整批 SQL 會回滾，不會留下任何變更。"
  for file in "${migrations[@]}"; do echo; echo "-- ===== migration: $file"; cat "../migrations/$file"; done
  echo; echo "-- ===== _helpers.sql"; cat _helpers.sql
  for file in "${tests[@]}"; do echo; echo "-- ===== test: $file"; grep -v "raise exception 'ALL TESTS PASSED'" "$file"; done
  echo; echo "do \$\$ begin raise exception 'ALL TESTS PASSED'; end \$\$;"
} > run.sql

echo "supabase/tests/run.sql ($(wc -l < run.sql | tr -d ' ') 行)"
