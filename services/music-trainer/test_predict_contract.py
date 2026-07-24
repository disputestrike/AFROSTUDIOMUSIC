import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


def load_predict_module():
    fake_cog = types.ModuleType("cog")
    fake_cog.BasePredictor = object
    fake_cog.Path = Path
    fake_cog.Input = lambda *args, **kwargs: kwargs.get("default")
    module_path = Path(__file__).with_name("predict.py")
    spec = importlib.util.spec_from_file_location(
        "afroone_predict_contract",
        module_path,
    )
    module = importlib.util.module_from_spec(spec)
    with mock.patch.dict(sys.modules, {"cog": fake_cog}):
        spec.loader.exec_module(module)
    return module


class PredictContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.predict_module = load_predict_module()

    def test_failed_render_removes_partial_output_directory(self):
        predictor = self.predict_module.Predictor()
        predictor.trained_lora_path = "none"

        def fail_render(**kwargs):
            Path(kwargs["save_path"]).write_bytes(b"partial")
            raise RuntimeError("render failed")

        predictor.pipeline = fail_render
        with tempfile.TemporaryDirectory() as temp:
            output_dir = Path(temp) / "afh-out"

            def create_output_dir(*args, **kwargs):
                output_dir.mkdir()
                return str(output_dir)

            with mock.patch.object(
                self.predict_module.tempfile,
                "mkdtemp",
                side_effect=create_output_dir,
            ):
                with self.assertRaisesRegex(RuntimeError, "render failed"):
                    predictor.predict(
                        tags="afrobeats, vocal",
                        lyrics="[Verse]\nOkan mi",
                        duration=10,
                        lora_weights_zip=None,
                        infer_steps=10,
                        guidance_scale=15,
                        seed=7,
                    )
            self.assertFalse(output_dir.exists())

    def test_successful_render_returns_nonempty_audio(self):
        predictor = self.predict_module.Predictor()
        predictor.trained_lora_path = "none"

        def render(**kwargs):
            Path(kwargs["save_path"]).write_bytes(b"x" * 44100)

        predictor.pipeline = render
        with tempfile.TemporaryDirectory() as temp:
            output_dir = Path(temp) / "afh-out"

            def create_output_dir(*args, **kwargs):
                output_dir.mkdir()
                return str(output_dir)

            with mock.patch.object(
                self.predict_module.tempfile,
                "mkdtemp",
                side_effect=create_output_dir,
            ):
                result = predictor.predict(
                    tags="afrobeats, vocal",
                    lyrics="[Verse]\nOkan mi",
                    duration=10,
                    lora_weights_zip=None,
                    infer_steps=10,
                    guidance_scale=15,
                    seed=7,
                )
            self.assertEqual(Path(result), output_dir / "output.wav")
            self.assertTrue(Path(result).exists())


if __name__ == "__main__":
    unittest.main()
