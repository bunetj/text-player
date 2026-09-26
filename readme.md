
# text player



_display text in different existing social interfaces._

just a demo. https://bunetj.github.io/text-player/

the main simulators now are

- subtitles, 
- telegram and 
- discord.

the interaction types are basically

- roleplay and 
- reader

you can 

- watch a text like subtitles, 
- "chat to pdf" (play a text like someone messages you and answer back), 
- chat to yourself (two or multiple personas), 
- keep personal notes like telegram channels. 

various subtle features, such as 

- going to the specific place in the text or 
- having a folders system in the user interface.

## management of texts

**local**: the app works offline, in the browser, with the writing of local files (json or md).

export options: 

- for chats, ie discord/telegram: export to clipboard + writes json files; 
- for telegram channels: writes md files.

the app is made for the local use, bc you import and keep heavy texts, and it is not like you try to have them online.

## import from files

for web pages: convert to txt somehow.

### readings.py

typical commands

from a folder or file to readings/ (pdf, epub, docx to txt):

```
py readings.py convert c:\books --recursive
```

the whole readings/ folder to tg:

```
py readings.py import --app tg --chat "pdf low punct rem"
```

some file to tg:

```
py readings.py import readings\text.txt --app tg --chat "pdf low punct rem"
```

### chat style formatters

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
