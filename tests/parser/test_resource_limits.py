import importlib.util
from pathlib import Path
import zipfile

import pytest

spec = importlib.util.spec_from_file_location("bounded_parser", Path("apps/worker/parser.py"))
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)


def test_rejects_malicious_word_span_before_expanding_a_billion_cells(tmp_path):
    path = tmp_path / "wide.docx"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="1000000000"/></w:tcPr></w:tc></w:tr></w:tbl></w:document>')
    with pytest.raises(ValueError, match="FILE_SIZE"):
        parser.inspect(path)


@pytest.mark.parametrize("ranges", [["A1:XFD1048576"], ["A1:B40000", "D1:E40000"]])
def test_rejects_merged_excel_expansion_before_openpyxl_loads_cells(tmp_path, ranges):
    path = tmp_path / "merged.xlsx"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("xl/workbook.xml", "<workbook/>")
        merged = "".join(f'<mergeCell ref="{area}"/>' for area in ranges)
        archive.writestr("xl/worksheets/sheet1.xml", f'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><mergeCells>{merged}</mergeCells></worksheet>')
    with pytest.raises(ValueError, match="FILE_SIZE"):
        parser.inspect(path)


def test_rejects_ambiguous_duplicate_archive_members(tmp_path):
    path = tmp_path / "duplicate.docx"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", "<document/>")
        archive.writestr("WORD/DOCUMENT.XML", "<different-document/>")
    with pytest.raises(ValueError, match="FILE_INVALID"):
        parser.inspect(path)


def test_cell_budget_is_cumulative_and_applies_before_retaining_the_next_row(monkeypatch):
    monkeypatch.setattr(parser, "MAX_CELLS", 3)
    rows = parser.BoundedTables()
    rows.append((["one", "two"], parser.source()))
    with pytest.raises(ValueError, match="FILE_SIZE"):
        rows.append((["three", "four"], parser.source()))
    assert len(rows) == 1


@pytest.mark.parametrize("cells", [["x"] * 201, ["x" * 12001]])
def test_rejects_oversized_rows_without_silent_truncation(cells):
    with pytest.raises(ValueError, match="FILE_SIZE"):
        parser.BoundedTables().append((cells, parser.source()))


def test_rejects_more_than_two_thousand_lessons_before_serializing_them():
    tables = [(["Тема урока", "Цели обучения", "Часы"], parser.source())]
    tables.extend(([f"Тема {i}", "Описывать алгоритмы", "1"], parser.source()) for i in range(2001))
    with pytest.raises(ValueError, match="FILE_SIZE"):
        parser.normalize(tables)
