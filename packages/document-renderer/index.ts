import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  PageBreak,
  Footer,
  PageNumber,
  AlignmentType,
  LevelFormat,
  WidthType,
  BorderStyle,
  ShadingType,
} from "docx";
import { Styles, type GenerationDocument } from "../contracts";
import { displayLevel } from "../domain/validation";
import { assertDocumentBudget } from "../domain/document-budget";
const cm = (n: number) => Math.round(n * 567);
export async function renderDocx(
  doc: GenerationDocument,
  snapshot: any,
  stylesInput: unknown,
  audience: "full" | "student",
  teacherReviewed = false,
) {
  assertDocumentBudget(doc);
  const styles = Styles.parse(stylesInput),
    ru = doc.localeMode === "ru";
  const children: (Paragraph | Table)[] = [];
  const p = (text: string, options: Record<string, unknown> = {}) =>
    new Paragraph({ children: [new TextRun(text)], ...options });
  const h = (text: string) =>
    p(text, { heading: HeadingLevel.HEADING_2, keepNext: true });
  const block = (
    b: GenerationDocument["tasks"][number]["contentBlocks"][number],
    keepNext = false,
  ): (Paragraph | Table)[] => {
    if (b.type === "list")
      return b.items.map((text) =>
        p(text, { numbering: { reference: "bullets", level: 0 }, keepNext }),
      );
    if (b.type === "code")
      return b.text.split("\n").map(
        (text) =>
          new Paragraph({
            children: [new TextRun({ text, font: "Courier New", size: 22 })],
            spacing: { after: 0 },
            keepNext,
          }),
      );
    if (b.type === "table") {
      const borders = {
        top: { style: BorderStyle.SINGLE, size: 4, color: "D9D9D9" },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: "D9D9D9" },
        left: { style: BorderStyle.SINGLE, size: 4, color: "D9D9D9" },
        right: { style: BorderStyle.SINGLE, size: 4, color: "D9D9D9" },
      };
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              tableHeader: true,
              cantSplit: true,
              children: b.columns.map(
                (text) =>
                  new TableCell({
                    children: [p(text,{keepNext:true})],
                    borders,
                    shading: { type: ShadingType.CLEAR, fill: "F1F0E8" },
                    margins: { top: 100, bottom: 100, left: 100, right: 100 },
                  }),
              ),
            }),
            ...b.rows.map(
              (row,rowIndex) =>
                new TableRow({
                  cantSplit:true,
                  children: row.map(
                    (text) =>
                      new TableCell({
                        children: [p(text,{keepNext:keepNext && rowIndex===b.rows.length-1})],
                        borders,
                        margins: {
                          top: 100,
                          bottom: 100,
                          left: 100,
                          right: 100,
                        },
                      }),
                  ),
                }),
            ),
          ],
        }),
      ];
    }
    return b.text.split("\n").map((text) => p(text,{keepNext}));
  };
  if (styles.includeLogo) children.push(p("ZiyatAI", { style: "Brand" }));
  children.push(
    p(doc.title, { heading: HeadingLevel.TITLE }),
    p(`${ru ? "Информатика • Класс" : "Информатика • Сынып"} ${doc.grade}`),
    p(`${ru ? "Тема" : "Тақырып"}: ${snapshot.topic}`),
    p(`${ru ? "Цели обучения" : "Оқу мақсаттары"}: ${snapshot.goals}`),
    p(
      ru
        ? "Выполните задания. Покажите ход решения."
        : "Тапсырмаларды орындаңыз. Шешу жолын көрсетіңіз.",
    ),
  );
  if (snapshot.demo)
    children.push(
      p(
        ru
          ? "Синтетический демонстрационный материал. Генерация OpenAI не выполнялась."
          : "Синтетикалық демонстрациялық материал. OpenAI генерациясы орындалмаған.",
      ),
    );
  if (!teacherReviewed) children.push(
    p(
      ru
        ? "Черновик. Требуется педагогическая проверка."
        : "Жоба. Педагогикалық тексеру қажет.",
    ),
  );
  for (const level of ["easy", "medium", "advanced"]) {
    children.push(h(displayLevel(level, doc.localeMode)));
    for (const task of doc.tasks.filter((t) => t.level === level)) {
      const index = doc.tasks.findIndex((t) => t.id === task.id) + 1;
      children.push(
        p(
          `${index}. ${ru ? "Задание" : "Тапсырма"} (${task.points} ${ru ? "баллов" : "балл"}, ${task.estimatedMinutes} ${ru ? "мин" : "мин"})`,
          { style: "TaskTitle", keepNext: true },
        ),
      );
      for (const b of task.contentBlocks) children.push(...block(b,styles.answerSpace));
      if (task.translation) {
        children.push(p("Русская версия", { keepNext: true }));
        for (const b of task.translation.contentBlocks)
          children.push(...block(b,styles.answerSpace));
      }
      if (styles.answerSpace) {
        const lines = task.level === "advanced" ? 3 : task.level === "medium" ? 2 : 1;
        for(let line=0;line<lines;line++)children.push(p("________________________________________________________________",{keepNext:line<lines-1}));
      }
    }
  }
  if (audience === "full") {
    children.push(
      new Paragraph({ children: [new PageBreak()] }),
      h(ru ? "Ответы и объяснения" : "Жауаптар және түсіндірмелер"),
    );
    for (let i = 0; i < doc.tasks.length; i++) {
      const task = doc.tasks[i];
      children.push(
        p(`${i + 1}. ${ru ? "Ответ" : "Жауап"}`, {
          style: "TaskTitle",
          keepNext: true,
        }),
      );
      for (const b of task.answerBlocks) children.push(...block(b));
      children.push(
        p(`${ru ? "Как" : "Қалай"}: ${task.explanationHow}`),
        p(`${ru ? "Почему" : "Неге"}: ${task.explanationWhy}`),
      );
      for (const r of task.rubric)
        children.push(
          p(`${r.criterion} — ${r.points} ${ru ? "баллов" : "балл"}`),
        );
      if (task.translation) {
        children.push(p("Русская версия", { keepNext: true }));
        for (const b of task.translation.answerBlocks)
          children.push(...block(b));
        children.push(
          p(`Как: ${task.translation.explanationHow}`),
          p(`Почему: ${task.translation.explanationWhy}`),
        );
        for (const r of task.translation.rubric)
          children.push(p(`${r.criterion} — ${r.points} баллов`));
      }
    }
  }
  const document = new Document({
    creator: "ZiyatAI",
    title: doc.title,
    description: teacherReviewed ? "Teacher review acknowledged for this exported version" : "Draft differentiated assignments; teacher review required",
    styles: {
      default: {
        document: {
          run: { font: styles.font, size: styles.size * 2, color: "000000" },
          paragraph: {
            spacing: {
              before: 0,
              after: 120,
              line: Math.round(240 * styles.lineSpacing),
            },
          },
        },
        title: {
          run: {
            font: styles.font,
            size: styles.size * 2 + 8,
            bold: true,
            color: "000000",
          },
          paragraph: { spacing: { after: 240 }, keepNext: true },
        },
        heading2: {
          run: {
            font: styles.font,
            size: styles.size * 2,
            bold: true,
            color: "000000",
          },
          paragraph: { spacing: { before: 240, after: 120 }, keepNext: true },
        },
      },
      paragraphStyles: [
        {
          id: "Brand",
          name: "ZiyatAI Brand",
          basedOn: "Normal",
          run: { bold: true, size: 24, color: "000000" },
        },
        {
          id: "TaskTitle",
          name: "Task title",
          basedOn: "Normal",
          run: { bold: true },
          paragraph: { keepNext: true },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 360, hanging: 180 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: {
              top: cm(styles.marginTop),
              bottom: cm(styles.marginBottom),
              left: cm(styles.marginLeft),
              right: cm(styles.marginRight),
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ children: [PageNumber.CURRENT] })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(document);
}
