import importlib.util
from pathlib import Path

from docx import Document

spec = importlib.util.spec_from_file_location("english_parser", Path("apps/worker/parser.py"))
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)


def test_english_plan_across_tables_without_repeated_header_keeps_all_68_lessons(tmp_path):
    document = Document()
    document.add_paragraph("Calendar Thematic Plan for the 3 th grade")
    headings = ["№", "Units/ Changing lessons", "Theme", "Learning objectives", "Hours", "Date", "Notes"]
    def append_spanned_row(table, values, spans):
        cells = list(table.add_row().cells)
        column = 0
        for value, width in zip(values, spans):
            cell = cells[column]
            if width > 1:
                cell = cell.merge(cells[column + width - 1])
            cell.text = value
            column += width
    number = 0
    for table_index, count in enumerate([32, 36]):
        table = document.add_table(rows=0, cols=10 if table_index == 0 else 7)
        if table_index == 0:
            append_spanned_row(table, headings, [1, 1, 1, 3, 2, 1, 1])
        term = table.add_row().cells
        term[0].merge(term[-1]).text = "TERM 1" if table_index == 0 else "TERM 3"
        for index in range(count):
            number += 1
            values = [str(index + 1), f"Module {number}" if index % 8 == 0 else "", f"Synthetic lesson {number}", "3.1.1.1 recognise familiar words", "1", "02-04.09", ""]
            # Word grid spans differ between header and data in the reported file.
            append_spanned_row(table, values, [1, 1, 1, 2, 2, 2, 1] if table_index == 0 else [1] * 7)
    path = tmp_path / "english-plan.docx"
    document.save(path)
    result = parser.extract(path)
    rows = result["rows"]
    assert len(rows) == 68
    assert [row["topic"] for row in rows] == [f"Synthetic lesson {i}" for i in range(1, 69)]
    assert all(row["grade"] == 3 for row in rows)
    assert all(row["objectiveCodes"] == ["3.1.1.1"] for row in rows)
    assert all(row["goals"] == "3.1.1.1 recognise familiar words" for row in rows)
    assert all(row["hours"] == "1" for row in rows)
    assert rows[0]["section"] == rows[7]["section"] == "Module 1"
    assert rows[8]["section"] == "Module 9"
    assert rows[0]["quarter"] == "TERM 1"
    assert rows[32]["quarter"] == "TERM 3"
    assert all(row["dateRaw"] == "02-04.09" and row["dateStart"] is None for row in rows)
    assert "no_lesson_rows_found" not in result["warnings"]


def test_english_headers_and_grade_labels_do_not_confuse_ranges_or_objective_codes():
    assert parser.header_map(["No.", "Unit", "Topic", "Learning objectives", "Hours", "Date", "Notes"]) == {
        "lessonNumberRaw": 0, "section": 1, "topic": 2, "goals": 3, "hours": 4, "dateRaw": 5, "notes": 6,
    }
    assert parser.grade_from_label("Grade 3") == 3
    assert parser.grade_from_label("3rd grade") == 3
    assert parser.grade_from_label("Grades 3-4") is None
    assert parser.grade_from_label("3.1.1.1") is None
