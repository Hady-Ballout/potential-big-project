"""Flatten the PlatformIO firmware into a folder you can upload to a wokwi.com ESP32 project."""
import pathlib, shutil

here = pathlib.Path(__file__).resolve().parent
src = here.parent / "src"
out = here / "browser-project"
if out.exists():
    shutil.rmtree(out)
out.mkdir()

for f in src.iterdir():
    if f.suffix in {".h", ".cpp"}:
        shutil.copy(f, out / f.name)

# Arduino needs a .ino as the project entry; setup()/loop() live in main.cpp.
(out / "sketch.ino").write_text(
    "// Entry point lives in main.cpp. This file only exists because Arduino requires a .ino.\n"
)
(out / "libraries.txt").write_text("ArduinoJson\n")
shutil.copy(here / "diagram.json", out / "diagram.json")
print(f"Wrote {out}. Upload all its files to a new ESP32 project on wokwi.com.")
