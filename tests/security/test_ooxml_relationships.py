import importlib.util
from pathlib import Path
import zipfile
from xml.sax.saxutils import quoteattr

import pytest

spec = importlib.util.spec_from_file_location("relationship_parser", Path(__file__).parents[2] / "apps/worker/parser.py")
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)


def package(tmp_path, target, mode, extension):
    path = tmp_path / ("relationship" + extension)
    mode_attribute = "" if mode is None else " TargetMode=" + quoteattr(mode)
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml" if extension == ".docx" else "xl/workbook.xml", "<document/>")
        archive.writestr("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="fixture" Target=' + quoteattr(target) + mode_attribute + "/></Relationships>")
    return path


@pytest.mark.parametrize("extension", [".docx", ".xlsx"])
@pytest.mark.parametrize("target,mode", [
    ("https://example.invalid/document", None),
    ("https://example.invalid/document", "Internal"),
    ("https://example.invalid/document", "External "),
    ("https://example.invalid/document", "external"),
    ("//example.invalid/document", "Internal"),
    ("file:///etc/hostname", "Internal"),
    ("C:/private/document", None),
    (r"\\server\share\document", "Internal"),
    ("%68%74%74%70%73%3A%2F%2Fexample.invalid/document", "Internal"),
    ("%2F%2Fexample.invalid/document", "Internal"),
    ("%5C%5Cserver%5Cshare", "Internal"),
    ("%09https://example.invalid/document", "Internal"),
])
def test_rejects_remote_and_filesystem_targets_even_without_external_marker(tmp_path, target, mode, extension):
    with pytest.raises(ValueError, match="FILE_INVALID"):
        parser.inspect(package(tmp_path, target, mode, extension))


@pytest.mark.parametrize("target", ["word/document.xml", "../media/image1.png", "/word/styles.xml", "media/teacher%20image.png", "#bookmark"])
@pytest.mark.parametrize("mode", [None, "Internal"])
def test_preserves_internal_package_relationships(tmp_path, target, mode):
    parser.inspect(package(tmp_path, target, mode, ".docx"))
