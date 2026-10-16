import type { TaskDocument } from "../../../../packages/contracts";
export function DisplayBlocks({
  blocks,
}: {
  blocks: TaskDocument["contentBlocks"];
}) {
  return (
    <div className="preview-block">
      {blocks.map((b, i) =>
        b.type === "code" ? (
          <pre key={i}>{b.text}</pre>
        ) : b.type === "list" ? (
          <ul key={i}>
            {b.items.map((s, j) => (
              <li key={j}>{s}</li>
            ))}
          </ul>
        ) : b.type === "table" ? (
          <div className="review-table-scroll" key={i}>
            <table>
              <thead>
                <tr>
                  {b.columns.map((s, j) => (
                    <th key={j}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    {r.map((s, k) => (
                      <td key={k}>{s}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p key={i}>{b.text}</p>
        ),
      )}
    </div>
  );
}
