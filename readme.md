# text player

*something will not work

## overview

main sim-s now

- subtitles
- telegram
- discord

why

some usage cases

- you already read transcripts instead of watching a video
- your reading notes are already especially frequent or informal like it's a live chat or even direct messages
- you already fall into rehearsing social situations in self-messages
- you already keep hidden blogs like personal notes
- you already expect those platforms to fill your time while struggling with reading through long or planned items

if any of these lands, you might want to look at this copy of a hat you could not stop touching at the shop.

demo (partial func-ty):

https://bunetj.github.io/text-player/

## how content is managed

**local**: works offline, opens in the browser; writes json, md.

export:

- chats (ds, tg): clipboard; json
- tg channels: md

made for local use: you keep heavy texts, convert hoarder's readings.

## usage cases with importing

you can just paste too.

### import from txt to ui

#1 have the files

have a folder/s with txt files or specific txt file/s.

web pages: convert to txt, eg copypaste or scrape with some script or addon to many .txt files

videos: download transcripts, eg https://savesubs.com

#2 add to the root

for one file:

```
py readings.py add [file's path]
```

for folders:

```
py readings.py add [folder/s' path] --recursive
```

adds files to readings/, the folder structure mirrored

#3 import to some app

```
py readings.py import --app tg --chat "pdf low punct rem"
```

creates mirrored chat folders in the tg sim

apps:

```
--app [tg|st|ds]
```

### just convert to chat style

if you don't want to use the user interfaces, you can just fragmentize a long text:

```
format.py [file/ folder/s path] --chat "pdf low punct rem" --sep newline
```

this script is standalone. works with folders too. creates a copy that ends with _chat. eg, you can open the formatted text in a narrow notepad window, white on black, consolas monospace.

another experimental use is splitting the book by markers, you marker parts of text with the `<<<marker>>>` by manually walking through a .txt file and get chapters as separate text files.

```
format.py split [txt/folder/s path]
```

### chat style formatters

the operators for the --chat flag

```
punct     split on punctuation, keep punctuation
rem       remove punctuation only
low       lowercase the script
lines     split on newlines
line      collapse into one message
sent      split on periods
chunk N   split into messages of N words each
pdf       unwrap PDF-paste line breaks
```

## ai note

vibecoded as a hobby.