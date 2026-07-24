import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from adapter_contract import (
    LORA_WEIGHT_NAME,
    MAX_ADAPTER_MEMBERS,
    extract_lora_archive,
    materialize_path,
    validate_lora_config,
)


class AdapterContractTest(unittest.TestCase):
    def test_production_config_matches_serving_contract(self):
        config_path = Path(__file__).with_name("afroone_lora_config.json")
        config = validate_lora_config(config_path)
        self.assertEqual(config["r"], 32)
        self.assertNotIn("speaker_embedder", config["target_modules"])

    def test_archive_extracts_the_single_diffusers_adapter(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "weights.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr(LORA_WEIGHT_NAME, b"x" * 2048)
            adapter_dir = extract_lora_archive(archive, root / "extracted")
            self.assertEqual(
                adapter_dir / LORA_WEIGHT_NAME,
                root / "extracted" / LORA_WEIGHT_NAME,
            )

    def test_archive_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "weights.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("../outside.safetensors", b"x" * 2048)
            with self.assertRaisesRegex(RuntimeError, "unsafe path"):
                extract_lora_archive(archive, root / "extracted")
            self.assertFalse((root / "extracted").exists())

    def test_archive_rejects_excessive_member_count_and_cleans_up(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "weights.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                for index in range(MAX_ADAPTER_MEMBERS + 1):
                    bundle.writestr(f"member-{index}.txt", b"x")
            destination = root / "extracted"
            with self.assertRaisesRegex(RuntimeError, "members"):
                extract_lora_archive(archive, destination)
            self.assertFalse(destination.exists())

    def test_archive_rejects_excessive_compression_ratio(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "weights.zip"
            with zipfile.ZipFile(
                archive, "w", compression=zipfile.ZIP_DEFLATED
            ) as bundle:
                bundle.writestr(LORA_WEIGHT_NAME, b"x" * (2 * 1024 * 1024))
            with self.assertRaisesRegex(RuntimeError, "compression ratio"):
                extract_lora_archive(archive, root / "extracted")

    def test_cog_lazy_url_path_is_materialized(self):
        with tempfile.TemporaryDirectory() as temp:
            local = Path(temp) / "weights.zip"

            class LazyWeights:
                def __init__(self):
                    self.converted = False

                def convert(self):
                    self.converted = True
                    return local

                def __str__(self):
                    return "https://replicate.delivery/weights.zip"

            weights = LazyWeights()
            self.assertEqual(materialize_path(weights), local)
            self.assertTrue(weights.converted)

    def test_config_rejects_the_unsupported_speaker_target(self):
        with tempfile.TemporaryDirectory() as temp:
            config_path = Path(temp) / "config.json"
            config_path.write_text(
                json.dumps(
                    {
                        "r": 32,
                        "lora_alpha": 32,
                        "target_modules": [
                            "speaker_embedder",
                            "linear_q",
                            "linear_k",
                            "linear_v",
                            "to_q",
                            "to_k",
                            "to_v",
                            "to_out.0",
                        ],
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(RuntimeError, "exactly"):
                validate_lora_config(config_path)


if __name__ == "__main__":
    unittest.main()
