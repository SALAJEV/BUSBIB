import importlib.util
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("busbib_python", Path(__file__).resolve().parents[1] / "python" / "script.py")
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)

DATA = (
    '# 02/07/2026\n'
    '"vehicle_id";"bus";"license_plate";"owner";"intern_id"\n'
    '"013023";"Mercedes";"1-ABC-123";"De Lijn";"42"\n'
).encode()


class Response(io.BytesIO):
    status = 200


class PythonDataTests(unittest.TestCase):
    def test_first_download_and_search(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(app, "BASE_DIR", directory), \
             patch.object(app.sys.stdin, "isatty", return_value=False), \
             patch.object(app.urllib.request, "urlopen", return_value=Response(DATA)) as request:
            data = app.load_data()
            self.assertEqual(request.call_args.args[0].full_url, app.DOWNLOAD_URL)
            self.assertTrue(app.DOWNLOAD_URL.endswith("/buses.txt"))
            self.assertTrue((Path(directory) / "buses.txt").exists())
            self.assertEqual(app.zoek_bus("013023", data)["bus"], "Mercedes")
            self.assertEqual(app.zoek_bus("1-ABC-123", data)["vehicle_id"], "013023")

    def test_update_downloads_current_bus_file(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(app, "BASE_DIR", directory), \
             patch.object(app.urllib.request, "urlopen", return_value=Response(DATA)):
            self.assertEqual(app.update_data()[0]["vehicle_id"], "013023")
            self.assertTrue((Path(directory) / "buses.txt").exists())


if __name__ == "__main__":
    unittest.main()
