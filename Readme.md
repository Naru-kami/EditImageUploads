Adds an option to edit images before sending.
Also adds an option to edit sent images and upload into the currently selected channel.

Supporting modes:
- <kbd>D</kbd> Drawing
- <kbd>E</kbd> Eraser
- <kbd>T</kbd> Insert Text
- <kbd>S</kbd> Region Select. Allows clipping of drawn, erased and text content to selected region.
- <kbd>M</kbd> Move current layer
- <kbd>R</kbd> Rotate current layer
- <kbd>Z</kbd> Zoom current layer
- <kbd>C</kbd> Crop the canvas to selected region.

Useful keybinds controls:
- <kbd>Ctrl</kbd> + <kbd>Z</kbd>: Undo
- <kbd>Ctrl</kbd> + <kbd>Y</kbd>: Redo
- <kbd>Ctrl</kbd> + <kbd>B</kbd>: Reset Viewport
- <kbd>Ctrl</kbd> + <kbd>C</kbd>: Copy current canvas content to clipboard
- <kbd>Ctrl</kbd> + <kbd>V</kbd>: Paste an image onto a new layer.
- <kbd>Ctrl</kbd> + <kbd>S</kbd>: Remove current clipping region (selection tool).
- <kbd>Shift</kbd> in drawing mode: Draw straight line from the last point.

Regaring text insertion:
- Text is rendered directly onto the canvas. As such, text highlighting for selected text cannot occur. You can, however, still select text using <kbd>Shift</kbd> + <kbd>←/→</kbd>, it is just not highlighted.
- To include a custom font for inserting text, import the font inside the custom CSS.
The plugin will then force load the font and make it available in the dropdown select. <br/>
Example: To include the font `Inter`, grab the css import url from the [Google fonts](https://fonts.google.com/) website and paste into the Custom CSS at the very top.
  ```css
  /* Top of your custom css */
  @import url('https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap');
  ```