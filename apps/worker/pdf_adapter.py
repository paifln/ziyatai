"""Small permissively licensed PDFium boundary. Callers own/close returned PIL images."""
import math
import pypdfium2 as pdfium


def render_page(path, page_number=0, scale=2, max_pixels=25_000_000):
    with pdfium.PdfDocument(path) as document:
        if not 0 <= page_number < len(document):
            raise ValueError('FILE_INVALID')
        page = document[page_number]
        try:
            width, height = page.get_size()
            # Bound allocation BEFORE invoking the native renderer.
            if not all(math.isfinite(v) and v > 0 for v in (width, height, scale)):
                raise ValueError('FILE_INVALID')
            if math.ceil(width * scale) * math.ceil(height * scale) > max_pixels:
                raise ValueError('FILE_SIZE')
            bitmap = page.render(scale=scale)
            try:
                return bitmap.to_pil().convert('RGB')
            finally:
                bitmap.close()
        finally:
            page.close()


def preview_page(path, page_number):
    with pdfium.PdfDocument(path) as document:
        if not 0 <= page_number < len(document):
            raise ValueError('FILE_INVALID')
        page = document[page_number]
        try:
            width, height = page.get_size()
            if width <= 0 or height <= 0:
                raise ValueError('FILE_INVALID')
            scale = min(1200 / width, 1600 / height, 2)
        finally:
            page.close()
    return render_page(path, page_number, scale, max_pixels=2_000_000)
