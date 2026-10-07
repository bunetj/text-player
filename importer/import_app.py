# import_app.py
# Push files from readings/ (or specific files) into an app's data.
# Knows about apps and readings/. Never writes _chat.txt.
#
#   python import_app.py --app tg                      (walks readings/)
#   python import_app.py --app tg readings/book.txt    (single file)
#   python import_app.py --app tg --chat "pdf low"     (ops inline)

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from driver import do_import, do_import_files  # noqa: E402


def main():
    argv = sys.argv[1:]
    if not argv or argv[0] in ("-h", "--help", "help"):
        print("usage: python importer/import_app.py --app tg|ds|st [files...] [--chat \"low punct\"]")
        return

    app = None
    chat_ops = []
    files = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--app":
            if i + 1 >= len(argv):
                print("--app needs a value"); sys.exit(1)
            app = argv[i + 1].lower()
            i += 2
        elif a == "--chat":
            if i + 1 >= len(argv):
                print("--chat needs a value"); sys.exit(1)
            chat_ops = argv[i + 1].split()
            i += 2
        else:
            files.append(a)
            i += 1

    if not app:
        print("need --app tg|ds|st"); sys.exit(1)

    if files:
        do_import_files(app, files, chat_ops)
    else:
        do_import(app, chat_ops)


if __name__ == "__main__":
    main()
