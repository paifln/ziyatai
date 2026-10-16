# Third-party components

ZiyatAI's own source licensing and sale terms are determined by its owner. This file inventories components; it does not grant rights to the project's own source or certify the legal terms of a future sale.

Production npm dependency versions are locked in `package-lock.json`. `npm run licenses:generate` reads the installed production dependency tree, copies available LICENSE/NOTICE texts into the generated `public/licenses.txt`, and records metadata in [node-licenses.json](docs/reports/node-licenses.json). The notices are included in the standalone web build and the worker image. The public file is generated and is not a source asset to edit manually.

| Component | License metadata / treatment |
| --- | --- |
| Next.js, React, Better Auth, docx, pg, Zod | MIT; preserve package notices |
| AWS SDK, OpenAI Node SDK | Apache-2.0; preserve LICENSE/NOTICE |
| Lucide icons | ISC |
| Nodemailer | MIT-0 |
| Node.js | License copied from official Node distribution into runtime image |
| PDFium / pypdfium2 | BSD-style / Apache-2.0 and bundled dependency notices; licenses remain in wheel distribution |
| pdfplumber, openpyxl, xlrd, lxml, Pillow | Preserve installed distribution notices; see their package metadata |
| LibreOffice, Tesseract, Ubuntu and Python packages | Keep `/usr/share/doc` and Python distribution license directories in image |
| PostgreSQL | PostgreSQL License; official container notices |
| Caddy, gosu and Go modules | Apache/BSD/MIT and individual module notices; generated THIRD-PARTY-NOTICES retained in custom proxy/PostgreSQL images |
| Garage | AGPL, used only as the local S3 service; production uses separately provisioned S3 |
| Windows fonts | Not distributed in repository or images; deployment operator supplies a legally licensed font directory |
| Onest interface font | SIL Open Font License 1.1; local WOFF2 and full notice in [public/fonts](public/fonts/README.md) |

PyMuPDF was removed from runtime, fixtures and QA scripts on 15 October 2026. PDF reading/rendering now uses PDFium and pdfplumber. [PDFium binding licenses](https://github.com/pypdfium2-team/pypdfium2), [LibreOffice licensing](https://www.libreoffice.org/about-us/licenses/).

Generated demo material and test fixtures are explicitly synthetic. Source reference logo was supplied by the owner; its ownership and use rights are not independently established here.
