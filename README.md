# Wani Notebook · 0.1.0

A personal notebook for SillyTavern with tabs, individual notes, rich text formatting, and quick copying. Independently implemented by Wanichka, without code from Extension-Notebook.

## Installation

Go to **Extensions → Install extension** and enter `https://github.com/Wanichka/sillytavern-notebook`. You can leave the branch field empty (`main`). Reload Tavern. Use the update button in the extension manager to install updates.

Open **Wani Notebook** from the extensions menu or the round floating button with a book icon. Press the floating button again to close the window. You can drag the button with a mouse or your finger; its position is saved separately for each Tavern user in this browser. If Roleplay Tools 0.1.0 is installed, the notebook automatically appears on its **Notebook** (`Блокнот`) page, and the standalone button is hidden. You can move it to another section in the Roleplay Tools settings. Other extensions do not need to be updated for this integration.

## Features

- **Tabs:** create, rename, and reorder them. The **+** button stays pinned on the right and remains visible; only the tab names scroll when space is limited. Deleting a tab moves its notes to the first remaining tab.
- **Individual note cards:** each has a title, a collapse button, a copy button, and an editor.
- **Rich text editor:** bold, italic, underline, lists, text colors, highlighting, clear formatting, and a full-screen mode.
- **Plain text copying:** copies only the note's contents, without its title. `<tags>` and `{{macros}}` remain plain text. The notebook does not send anything to the model or execute commands.
- **Plain text pasting:** pasted content does not retain external colors or HTML. Add formatting with the editor's buttons.
- **Search:** search titles and contents across all tabs. The trash has a separate search.
- **Note organization:** move notes between tabs and change their order using the controls at the bottom of the editor.
- **Trash:** deleted notes remain there until you permanently delete them manually. You can restore them.
- **JSON export and import:** export the entire notebook, including the trash. Import can add new tabs or replace the notebook; a backup of the current notebook is downloaded before replacement. Importing from other Notebook extensions is not supported.
- **Theme support:** the interface follows Tavern's theme. User-selected text colors are preserved when the theme changes.
- **Window controls:** drag the standalone window by its header and resize it from the bottom corner. Within Roleplay Tools, the shared panel controls its size. On narrow screens, the notebook uses almost the full screen.

## Saving and backups

Notes are shared across chats for the **current Tavern user**. Data is stored under the separate `wani_notebook_v1` key in extension settings. Every change also writes a local browser copy, kept separately for each Tavern account. The **Saved** (`Сохранено`) indicator confirms that the local copy has been written; Tavern itself manages saving settings to the server.

If the local copy is newer than the server copy, it is restored at startup. When you edit the notebook in two browser tabs, it asks you to choose which copy to keep and downloads the other one to a file. This is not a collaborative editor for simultaneous use on multiple devices. Changing Tavern's address or switching browsers does not transfer the local copy; use export or wait for Tavern to save settings to the server. If saving fails, export the notebook before reloading.

Export a backup periodically: clearing browser data removes local copies, and resetting Tavern settings removes server copies. Import files are limited to 5 MB. The notebook supports up to 100 tabs and 10,000 notes, with up to 2 million characters of HTML per note. Available local storage depends on the browser and other extensions.

## Testing

The browser test suite is in `tests/browser.mjs`. The recorded results include 49 passing checks covering persistence after reload, exact copying of injection text, colors, search, trash, import/export, conflicts between two browser tabs, and local storage failures. The pinned add-tab button was also checked for visibility and interaction while scrolling tabs, in a narrow window, and with the keyboard. The tests use the actual Notebook and Roleplay Tools code, with a test harness standing in for Tavern settings and the Tavern user. The harness does not run the Tavern server or actual model generation.

```sh
npm install --no-save playwright
npx playwright install chromium
RPT_HOST_DIR=../roleplay-tools node tests/browser.mjs
```

You can keep the original Notebook extension installed: Wani Notebook uses its own controls, names, and storage.

For screenshots with Tavern's actual icons, set `ST_PUBLIC_DIR=/path/to/SillyTavern/public`. The extension's own code is licensed under MIT; the installed Tavern provides the standard fonts and icons.

The Tavern menu entry and floating button are also tested with the actual styles and fonts from an installed Tavern. The recorded results include 37 passing checks for appearance, hover states, theme changes, opening and closing with a mouse or keyboard, dragging, position persistence, and touch gestures, both with and without Roleplay Tools.

```sh
ST_PUBLIC_DIR=/path/to/SillyTavern/public RPT_HOST_DIR=../roleplay-tools node tests/menu.mjs
```

## Version history

- **0.1.0:** removes the beta designation after regular use in a live Tavern; the README is now in English.
- **0.1.0-beta.4:** introduced a round 44×44 floating button in the style of Story Notes. It can be dragged with a mouse or finger. Pressing it again closes the window; dragging does not toggle visibility. Its position persists after reload and stays within the screen boundaries. The button remains above the notebook window so it can be pressed again.
- **0.1.0-beta.3:** styled the Wani Notebook entry as a standard Tavern menu row, with its icon and name on one line and theme-based colors and hover states. It can be opened with a mouse, Enter, or Space.
