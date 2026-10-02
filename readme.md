# text player

do you already

- rehearse situations in self-messages
- keep notes in chats
- watch videos but not texts
- write notes in chat style

then here is a copy of a hat you kept touching at the shop.

main sims now: subtitles, telegram, discord.

- chat to yourself - two or multiple personas
- read texts as subtitles
- read texts like someone messages you

partial demo:

https://bunetj.github.io/text-player/

## local

works offline etc. writes json, md, also exports to clipboard. made for local use.

## usage

install in c:\portable apps eg

## import

here are some cases.

### from text

web pages: scrape into .txt first.

transcripts: https://savesubs.com

```
py readings.py add folder --recursive
py readings.py add text.txt
```

this converts to text / places into readings/ folder.

```
py readings.py import --app tg --chat "pdf low punct rem"
```

this imports to an app and formats in chat style as you prefer.

### format to chat

you can go without apps:

```
py format.py file/folder --chat "pdf low punct rem" --sep newline
```

this script is isolated. creates a name_chat file/folder.

also splits a text into files with an index by manual markers.

### --chat style operators

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