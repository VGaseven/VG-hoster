#!/usr/bin/env python3
"""Run every test and print a pass/fail table. Usage: python3 tests/run_all.py"""
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SUITES = [("Unit (prices, totals, matching, URLs)", "test_unit"), ("Browser (fresh no-cookie context)", "test_browser"),
          ("Pages (publish/update, local stand-in)", "test_pages"), ("Amazon script (offline pages)", "test_amazon_offline")]

failed = False
rows = []
for label, mod in SUITES:
    suite = unittest.defaultTestLoader.loadTestsFromName(mod)
    res = unittest.TextTestRunner(verbosity=0, stream=open("/dev/null", "w") if sys.platform != "win32" else sys.stderr).run(suite)
    bad = len(res.failures) + len(res.errors)
    rows.append((label, res.testsRun - bad - len(res.skipped), bad, len(res.skipped)))
    for t, tb in res.failures + res.errors:
        print(f"FAIL {t}\n{tb}")
    failed |= bad > 0
w = max(len(r[0]) for r in rows)
print(f"{'Suite'.ljust(w)}  pass  fail  skip")
for r in rows:
    print(f"{r[0].ljust(w)}  {r[1]:>4}  {r[2]:>4}  {r[3]:>4}")
sys.exit(1 if failed else 0)
