"""260. 매매 규칙 숫자 — config/rules.json 한 파일 (앱 src/rules.js · 서버 api · 이 파이프라인 공통)
   from rules import R          R["secCap"] · R["slots"]["us"] · R["tranche2"]["lo"] …
"""
import json, os
R = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "config", "rules.json"), encoding="utf-8"))
