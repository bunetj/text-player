# text player

(*) somth won't work

here i vibecoded a copy of a hat 🪞 that i kept touching at the shop, by which i mean messaging myself and reading chats, watching subtitles better than reading texts.

**text player** displays texts like it's messanger or subtitles with functional interface simulators and chat style converter. all runs locally. the link is a demo that i don't support: https://bunetj.github.io/text-player/

_text player is made also to read easier, which works on the surface._ with it, i follow the thought for longer, but i still need to involve with the text myself. this purpose or function is related to cultural or linguistic ie educational accessibility similar to adhd reading solutions if i will not also say how this resembles envious uglification to "low" chat. the realization involves automatic text analysis and editing like pdf unwrapping and line splitting as well as digital linguistic stuff like shorthand dictionary files and typification of typos to generate them.

## components

▶ text player simulators

💬 chatify converter

📁 texts library

## text player

simulators: telegram, subtitles, discord, led scroller.

usages:

- **read** like it's messanger or subtitles etc
- **write** in the chat or create posts and keep this as notes by exporting to clipboard or relying on json files
- **roleplay** like two or many personas

(*) a diffnt option is comments in word/lo.

## chatify

chatify is an independent cli tool that converts plain text to chat style as shown in the help message below.

```
usage: py chatify/cli.py <path> --chat "pdf low punct sep blank"

ops
  pdf         reassemble PDF-wrapped lines
  low         lowercase
  punct       split on punctuation
  rem         remove punctuation
  lines       split on newlines
  line        collapse to one line
  sent        split on sentence endings
  chunk N     split into blocks of N words
  short       shorthand (en, ru)
  typo N      insert typos, N = drunkness 0|2|..|10
  sep X       blank | newline | none (default none)
```

eg "pdf low rem": change a torn pdf copypaste to a whole one in lowercase with no punct.

shorthand converters are bref for EN (https://github.com/i0Z3R0/Bref-Shorthand-Converter) and skrpcht for RU (bunetj). bref is a large dictionary with plain text and skrpcht a little dic with plain text and regex plus some automatic rules.

optionally install to use from anywhere:

```
cd chatify
pip install -e .
```


## add texts

ui: add n convert thru the ui

readings.py: convert in batch or single files to .txt, add to readings/ folder, optionally create converted copies near to read outside of sims

import.py: import in batch or single files into an app, optionally pre-converted to chat style.


### requirements

to convert from .doc: download and place antiword.exe and antiword/ folder with encodings in importer/

https://ftp.nluug.nl/pub/os/windows/msys2/builds/mingw/mingw64/mingw-w64-x86_64-antiword-0.37-3-any.pkg.tar.zst

https://mirror.msys2.org/mingw/mingw64/mingw-w64-x86_64-antiword-0.37-3-any.pkg.tar.zst

