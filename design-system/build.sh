#!/usr/bin/env bash
# Assemble the Tempest review bundle: wrap each fragment with a shared head + inline base.css.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
OUT="$SRC/dist"
rm -rf "$OUT"
mkdir -p "$OUT"
BASE_CSS="$(cat "$SRC/base.css")"

emit() { # emit <group> <Name> <title> [cardGroup]
  local group="$1" name="$2" title="$3" cardgroup="${4:-$1}"
  local dir="$OUT/components/$group/$name"
  mkdir -p "$dir"
  {
    printf '<!-- @dsCard group="%s" -->\n' "$cardgroup"
    printf '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>%s</title>\n<style>\n%s\n</style>\n</head>\n<body class="surface">\n' "$title" "$BASE_CSS"
    cat "$SRC/$name.frag.html"
    printf '\n</body>\n</html>\n'
  } > "$dir/$name.html"
}

emit foundations ColorsDark  "Tempest Colors (Dark)"       "Colors"
emit foundations ColorsLight "Tempest Colors (Light)"      "Colors"
emit foundations Accents     "Accent Presets"              "Colors"
emit foundations Type        "Typography and Micro Labels" "Type"
emit foundations Icons       "Icons (lucide)"              "Type"
emit surfaces    Panels      "Panels and Frames"           "Surfaces"
emit surfaces    CardsEmpty  "Selection Cards, Empty States" "Surfaces"
emit controls    Controls    "Buttons, Inputs, Toggle"     "Controls"
emit controls    FormControls "Form Controls"              "Controls"
emit motion      Transitions "Micro Transitions"           "Motion"
emit overlays    Modals      "Modals and Dialogs"          "Overlays"
emit navigation  Navigation  "Tabs, Segmented, Sidebar Items" "Navigation"
emit feedback    Feedback    "Toasts, Tags, Overflow Menu" "Feedback"
emit feedback    Badges      "Badges and Status"           "Feedback"
emit data        DataViz     "Stat Strip, Chart, Table"    "Data"
emit editor      Editor      "Tool Rail, Canvas, Layers"   "Editor"
emit editor      TemplateWizard "Template Editor Wizard"   "Editor"
emit demo        CounterMock "Hunt Counter Demo"           "Demo"

cp "$SRC/base.css" "$OUT/styles.css"
cp "$SRC/README.md" "$OUT/README.md"
echo "built: $(find "$OUT" -type f | wc -l) files in $OUT"
