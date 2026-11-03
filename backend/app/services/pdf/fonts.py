from functools import lru_cache
from pathlib import Path

from reportlab.lib.fonts import addMapping
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

FONT_DIR = Path(__file__).resolve().parents[2] / "assets" / "fonts"

FAMILIES = {
    # family: (regular, bold, italic)
    "Sans": ("LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf", "LiberationSans-Italic.ttf"),
    "Serif": ("LiberationSerif-Regular.ttf", "LiberationSerif-Bold.ttf", "LiberationSerif-Italic.ttf"),
    "Poppins": ("Poppins-Regular.ttf", "Poppins-Bold.ttf", "Poppins-Light.ttf"),
}


@lru_cache
def register_fonts() -> None:
    for family, (regular, bold, italic) in FAMILIES.items():
        pdfmetrics.registerFont(TTFont(family, str(FONT_DIR / regular)))
        pdfmetrics.registerFont(TTFont(f"{family}-Bold", str(FONT_DIR / bold)))
        pdfmetrics.registerFont(TTFont(f"{family}-Italic", str(FONT_DIR / italic)))
        addMapping(family, 0, 0, family)
        addMapping(family, 1, 0, f"{family}-Bold")
        addMapping(family, 0, 1, f"{family}-Italic")
        addMapping(family, 1, 1, f"{family}-Bold")
    pdfmetrics.registerFont(TTFont("Poppins-Medium", str(FONT_DIR / "Poppins-Medium.ttf")))
    pdfmetrics.registerFont(TTFont("Poppins-Light", str(FONT_DIR / "Poppins-Light.ttf")))
