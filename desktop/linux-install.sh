#!/usr/bin/env bash
# Installs Arabic Reader for the current user: no administrator rights needed.
#   ./install.sh            install (or update) and add it to the applications menu
#   ./install.sh --remove   remove the program (your words and progress are kept)
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
app="${XDG_DATA_HOME:-$HOME/.local/share}/arabic-reader"
menu="${XDG_DATA_HOME:-$HOME/.local/share}/applications/arabic-reader.desktop"
launcher="$HOME/.local/bin/arabic-reader"

if [ "${1:-}" = "--remove" ]; then
  rm -rf "$app" "$menu" "$launcher"
  echo "Arabic Reader was removed. Your data is still in ${XDG_CONFIG_HOME:-$HOME/.config}/Arabic Reader."
  exit 0
fi

rm -rf "$app"
mkdir -p "$app" "$(dirname "$menu")" "$(dirname "$launcher")"
cp -r "$here/." "$app/"

# The launcher. On systems that do not let ordinary programs use the browser
# engine's sandbox (Ubuntu 23.10 and newer), the app would refuse to start, so
# it is started without it there. The app only ever shows its own pages.
cat > "$launcher" <<LAUNCH
#!/usr/bin/env bash
flags=()
if [ "\$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = "1" ] && [ ! -u "$app/chrome-sandbox" ]; then
  flags+=(--no-sandbox)
fi
exec "$app/Arabic Reader" "\${flags[@]}" "\$@"
LAUNCH
chmod +x "$launcher"

cat > "$menu" <<ENTRY
[Desktop Entry]
Type=Application
Name=Arabic Reader
Comment=Read and practise Arabic
Exec="$launcher" %U
Icon=$app/resources/app/desktop/icon.png
Terminal=false
Categories=Education;Languages;
StartupWMClass=Arabic Reader
ENTRY

echo "Arabic Reader is installed. Find it in your applications menu, or run: arabic-reader"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "(If the command is not found, start it with: $launcher)";; esac
