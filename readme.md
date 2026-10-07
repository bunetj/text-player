# text player

here i vibecoded a copy of a hat 🪞 that i kept touching at the shop, by which i mean messaging myself and reading chats, watching subtitles better than reading texts.

**text player** displays texts like it's messanger or subtitles. you can use its chat style converter separately. all runs locally. the link is a demo that i don't support: https://bunetj.github.io/text-player/

_text player is made also to read easier, which works on the surface._ with it, i follow the thought for longer, but i still need to know enough about the text myself.

## usage

download and run server

## components

▶ text player simulators

💬 chatify converter

📁 texts library

## text player

simulators: telegram, subtitles, discord, led scroller.

usages:

- **read** like it's messanger or subtitles etc
- **write** in the chat or create posts and keep this as notes by exporting to clipboard or using json files
- **roleplay** like two or many personas

## chatify

chatify is an independent cli tool that converts plain text to chat stlye as shown in the help message:

```
usage: python chatify/cli.py <path> --chat "pdf low punct rem" [--sep blank|newline|none]

ops
  pdf       reassemble PDF-wrapped lines
  low       lowercase
  punct     split on punctuation
  rem       remove punctuation
  lines     split on newlines
  line      collapse to one line
  sent      split on sentence endings
  chunk N   split into blocks of N words
  short     shorthand (en, ru)

sep
  none      whole file is one block (default)
  blank     \n\n
  newline   \n
```

eg "pdf low punct rem": change a torn pdf copypaste to a whole one in lowercase with no punct.

shorthand converters are bref for EN (https://github.com/i0Z3R0/Bref-Shorthand-Converter) and skrpcht for RU (bunetj). bref is a large dictionary with plain text and skrpcht a little dic with plain text and regex plus some automatic rules.

## import texts

readings.py: convert to .txt, add to readings/ folder, optionally create converted copies near to read outside of sims

import.py: import into an app, optionally pre-converted to chat style.