"""Read-only package/PDF QA for the isolated document-export verifier output."""
import json
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from zipfile import ZipFile
from pypdf import PdfReader

output = Path.cwd() / "artifacts" / "document-export"
ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
with ZipFile(output / "formatted-brief.docx") as package:
    document = ET.fromstring(package.read("word/document.xml"))
    styles = ET.fromstring(package.read("word/styles.xml"))
    numbering = ET.fromstring(package.read("word/numbering.xml"))

paragraphs = document.findall(".//w:body/w:p", ns)
paragraph_styles = Counter(
    style.get(f"{{{ns['w']}}}val")
    for paragraph in paragraphs
    if (style := paragraph.find("w:pPr/w:pStyle", ns)) is not None
)
native_lists = document.findall(".//w:numPr", ns)
title = styles.find("w:style[@w:styleId='Title']", ns)
title_color = title.find("w:rPr/w:color", ns)
reader = PdfReader(output / "formatted-brief.pdf")
report = {
    "source": "isolated browser downloads, matched to product snapshots",
    "docx": {
        "paragraphs": len(paragraphs),
        "paragraphStyles": dict(paragraph_styles),
        "nativeListParagraphs": len(native_lists),
        "numberingDefinitions": len(numbering.findall("w:abstractNum", ns)),
        "titleColor": title_color.get(f"{{{ns['w']}}}val"),
        "bodyHalfPointSize": styles.find("w:docDefaults/w:rPrDefault/w:rPr/w:sz", ns).get(f"{{{ns['w']}}}val"),
        "renderVerified": False,
        "renderLimitation": "No bundled LibreOffice on Windows",
    },
    "pdf": {
        "pages": len(reader.pages),
        "tagged": bool(reader.trailer["/Root"].get("/StructTreeRoot")),
        "visualReview": "Recorded separately after inspecting the Poppler PNG",
    },
}
assert paragraph_styles["Title"] == 1
assert paragraph_styles["Heading2"] == 5
assert len(native_lists) == 23
assert len(reader.pages) == 1
(output / "package-qa.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
