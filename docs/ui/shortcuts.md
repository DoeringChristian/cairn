# Keyboard shortcuts

In this page, ++cmd++ means ++cmd++ on macOS and ++ctrl++ everywhere else. Press ++cmd+slash++ anywhere inside a project to open the shortcut list in the UI.

## Global (inside a project)

| Keys | Action | Notes |
|---|---|---|
| ++cmd+slash++ | Show or hide the keyboard shortcuts dialog | Works even while typing in a text field. |
| ++cmd+z++ | Undo | Not while a text field has focus: there, the field's own typing undo runs. |
| ++cmd+shift+z++ | Redo | Same rule as undo. |
| ++escape++ | Close the innermost dialog, popover or full-screen card | With a popover open inside a dialog, only the popover closes. |

Each project has its own undo stack. It starts empty when you open or switch projects. The stack covers workspace edits (cards, sections, layout, card settings, defaults), comparison edits and report cell edits. Runs table settings and the hide/pin/baseline toggles are not on the stack.

## Workspace (run page and comparisons)

| Keys | Action |
|---|---|
| ++cmd+k++ | Focus the **Search panels** box and select its text. Works from inside other text fields. |
| ++escape++ in the search box | Clear the search. |
| ++enter++ in the quick panel builder's regex box | Add the panels. |

See [Run page and workspace](workspace.md).

## Full-screen card

| Keys | Action |
|---|---|
| ++arrow-left++ / ++arrow-right++ | Previous / next card. Ignored with a modifier held or while focus is in an input, select or text area. |
| ++escape++ | Close full screen. |

## Image split view

Click the image first to give it focus, then:

| Keys | Action |
|---|---|
| ++arrow-left++ | Move the divider fully left to show the whole image. |
| ++arrow-right++ | Move the divider fully right to show the whole reference. |

The reference is on the left and the image on the right. See [Cards](cards.md).

## Reports

| Keys | Where | Action |
|---|---|---|
| ++cmd+s++ | Report editor | Save now instead of waiting for the autosave. |
| ++shift+enter++, ++cmd+enter++ or ++escape++ | Editing a markdown cell | Render the cell. |
| ++enter++ | A focused rendered markdown cell | Edit it. |
| ++enter++ / ++space++ | The focused report title | Rename. ++enter++ commits and ++escape++ cancels. |
| ++cmd+enter++ | Comment box | Post the comment. |
| ++escape++ | Comment box | Cancel the reply or edit. |
| ++escape++ | Comments panel | Close the panel. |

See [Reports](reports.md).

## Text and number fields

These rules hold across settings panels, card titles, rename boxes and query bars:

| Keys | Action |
|---|---|
| ++enter++ | Commit the edit: card title, comparison or report name, expression field, table query bar, derived column, slider key, new tag. |
| ++escape++ | Discard the draft and go back to the saved value. For a card title or a rename box, this also cancels editing. |
| ++arrow-up++ / ++arrow-down++ in a number field | Step the value up or down; hold ++shift++ for 10 steps. |
| ++arrow-up++ / ++arrow-down++ then ++enter++ in a field picker's search | Move through the matches and pick one. |
| ++arrow-up++ / ++arrow-down++ then ++enter++ in a tag input | Move through the suggestions and add the tag. ++escape++ cancels. |

## Mouse and modifier gestures

| Gesture | Where | Action |
|---|---|---|
| Click / ++shift++-click a column header | Runs table | Sort by the column / add it as another sort key. |
| ++shift++-click a checkbox | Runs table, comparison list | Select the range from the last clicked row. |
| Drag a column header | Runs table | Reorder columns. |
| Drag in the plot | Line charts | Zoom. A near-horizontal drag zooms x only, a near-vertical drag y only, anything else a box. |
| Double-click the plot | Line charts | Reset the zoom. |
| ++cmd++-click a line | Line charts | Open that line's run. |
| Click / ++alt++-click a legend entry | Line charts | Highlight the line / show only that line. |
| Scroll wheel, drag, double-click | Image panes | Zoom around the cursor, pan, reset to the fitted view. |
| Double-click | 3D views | Return to the standard framing. |
| Double-click a card title | Cards | Rename the card. |
| Double-click a comparison name | Comparison list | Rename the comparison. |

For touch gestures, see [Phones and tablets](index.md#phones-and-tablets).
