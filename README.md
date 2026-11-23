# pi-abort-edit

Press Esc before Pi produces reply text or calls a tool. If the editor is empty, Pi returns the prompt to the editor and removes the interrupted turn from the active chat. Edit the prompt and submit it again, or clear it and write a new one.

Thinking alone does not prevent recall. The extension leaves the turn alone after reply text or a tool call, or if the editor has a draft or the prompt has images. It does not undo file changes.

The interrupted turn stays in Pi's session tree and can still appear in the editor's Up-arrow history. It is not sent with the next prompt, even if you quit and resume first.

## Install

Requires Pi 1.6 or later. Disable `pi-abort-recall` first if it is installed; both extensions respond to the same abort.

```sh
pi remove npm:pi-abort-recall
pi install npm:@patrick-lindemann/pi-abort-edit
```

To try it for one session without loading other extensions:

```sh
pi --no-extensions -e npm:@patrick-lindemann/pi-abort-edit
```

## Develop

```sh
npm ci
npm run check
npm test
```

Use `npm run format` to apply Biome fixes.
