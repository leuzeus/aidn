"""Manual Windows process/resource checks; no model or optional driver needed.

Run: python -B -m unittest discover -s tests/native -p test_context_local_runner.py -v
These native controls are separate from model/task qualification and PR admission.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(os.name == "nt", "Windows Job objects required")
class LocalRunnerTests(unittest.TestCase):
    def run_owned(self, code, *, eof=False, limit=64 * 1024 ** 2, deadline=15, expected_log=None):
        runner = Path(__file__).resolve().parents[2] / "tools/verify/context-local-runner.py"
        with tempfile.TemporaryDirectory(prefix="aidn-runner-control-") as folder:
            root = Path(folder)
            spec = {"command": [sys.executable, "-c", code], "cwd": folder,
                    "memory_limit_bytes": limit, "host_reserve_bytes": 4 * 1024 ** 3,
                    "deadline_seconds": deadline, "server_log": str(root / "native.log"),
                    "receipt": str(root / "receipt.json")}
            spec_file = root / "spec.json"
            spec_file.write_text(json.dumps(spec), encoding="utf8")
            child = subprocess.Popen([sys.executable, str(runner), str(spec_file)],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)
            try:
                if eof:
                    # The startup record proves assignment before closing owner stdin.
                    started = json.loads(child.stdout.readline())
                    self.assertEqual(started["status"], "RUNNING")
                    child.stdin.close()
                # Keep stdin OPEN for native-exit tests: communicate() would hide the bug.
                child.wait(timeout=20)
                stderr = child.stderr.read().decode("utf8", errors="replace")
                self.assertEqual(child.returncode, 0, stderr[-2000:])
                self.assertNotIn("Fatal Python error", stderr)
                receipt = json.loads((root / "receipt.json").read_text(encoding="utf8"))
                self.assertTrue(receipt["process_stopped"])
                self.assertTrue(receipt["suspended_assignment"])
                self.assertTrue(receipt["kill_on_job_close"])
                self.assertLessEqual(receipt["peak_job_memory_bytes"], limit)
                if expected_log is not None:
                    self.assertIn(expected_log, (root / "native.log").read_text(encoding="utf8"))
                return receipt
            finally:
                if child.poll() is None:
                    child.kill()  # Closing its Job kills only the owned native child.
                    child.wait(timeout=10)
                for stream in (child.stdin, child.stdout, child.stderr):
                    if stream and not stream.closed:
                        stream.close()

    def test_native_exit_before_owner_eof(self):
        for exit_code in (0, 7):
            with self.subTest(exit_code=exit_code):
                receipt = self.run_owned(f"raise SystemExit({exit_code})")
                self.assertEqual(receipt["status"], "EXITED")
                self.assertEqual(receipt["exit_code"], exit_code)

    def test_owner_eof_stops_owned_child(self):
        receipt = self.run_owned("import time; time.sleep(60)", eof=True)
        self.assertEqual(receipt["status"], "CLOSED")

    def test_deadline_stops_owned_child(self):
        receipt = self.run_owned("import time; time.sleep(60)", deadline=1)
        self.assertEqual(receipt["status"], "DEADLINE_REFUSED")

    def test_hard_memory_cap_preserves_native_failure(self):
        receipt = self.run_owned("memory = bytearray(256 * 1024 ** 2)", expected_log="MemoryError")
        self.assertEqual(receipt["status"], "EXITED")
        self.assertNotEqual(receipt["exit_code"], 0)


if __name__ == "__main__":
    unittest.main()
