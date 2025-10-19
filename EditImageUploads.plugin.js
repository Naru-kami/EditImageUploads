/**
 * @name EditImageUploads
 * @author Narukami
 * @description Adds an option to edit images before sending.
 * @version 0.0.0
 * @source https://github.com/Naru-kami/EditImageUploads
 */

module.exports = function (meta) {
  "use strict";

  const { React, Patcher, Webpack, Webpack: { Filters }, DOM, UI } = BdApi;
  /** @type {typeof import("react")} */
  const { createElement: jsx, useState, useEffect, useRef, useImperativeHandle, useCallback, cloneElement } = React;

  var internals, ctrl;

  function init() {
    if (internals) return;

    internals = utils.getBulk({
      uploadDispatcher: { filter: Filters.byKeys("setFile") }, // 166459
      uploadCard: { filter: Filters.bySource(".attachmentItemSmall]:") }, // 898463
      nativeUI: { filter: m => m.showToast }, // 481060
      Modal: { filter: Filters.bySource(".MODAL_ROOT_LEGACY,") },
      Button: { filter: Filters.byKeys("Colors", "Link"), searchExports: true }, // 693789

      actionButtonClass: { filter: Filters.byKeys("dangerous", "button") },
      actionIconClass: { filter: m => m.actionBarIcon && m[Symbol.toStringTag] != "Module" },
      sliderClass: { filter: Filters.byKeys("sliderContainer", "slider") }
    });

    Object.assign(internals, {
      SelectedChannelStore: Webpack.getStore("SelectedChannelStore"),
      keys: {
        ...utils.getKeysInModule(internals.uploadCard, {
          uploadCard: ".attachmentItemSmall]:",
        }),
        ...utils.getKeysInModule(internals.nativeUI, {
          FocusRing: "FocusRing was given a focusTarget",
          openModal: ",stackNextByDefault:",
          MenuSliderControl: "moveGrabber",
          closeModalInAllContexts: ".onCloseCallback)",
          Popout: "Unsupported animation config:",
        }),
        ...utils.getKeysInModule(internals.Modal, {
          ModalRoot: ".MODAL_ROOT_LEGACY,",
          ModalContent: ",scrollbarType:"
        })
      }
    })
    BdApi.Logger.info(meta.slug, "Initialized");
  }

  function start() {
    init();

    Patcher.after(meta.slug, internals.uploadCard, internals.keys.uploadCard, (_, [args], ret) => {
      if (
        args?.upload?.mimeType?.startsWith("image/") && !args?.upload?.mimeType?.endsWith("gif") &&
        !ret?.props?.actions?.props?.children?.some(e => e?.key === meta.slug)
      ) {
        ret.props.actions.props.children.splice(0, 0, jsx(BdApi.Components.ErrorBoundary, {
          key: meta.slug,
          children: jsx(Components.UploadIcon, { args })
        }))
      }
    });

    ctrl = new AbortController()
    Webpack.waitForModule(Filters.bySource('children:["IMAGE"==='), ctrl).then(m => { // 73249
      Patcher.after(meta.slug, m.Z, "type", (_, [args], res) => {
        return cloneElement(res, {
          children: className => {
            const ret = res.props.children(className);

            const url = args.item.original || args.item.url;
            url && ret.props.children.unshift(jsx(Components.RemixIcon, { url }))

            return ret;
          }
        })
      })
    })

    generateCSS();
  }

  function stop() {
    DOM.removeStyle(meta.slug);
    ctrl?.abort();
    Patcher.unpatchAll(meta.slug);
  }

  class CanvasEditor {
    #mainCanvas;
    #viewportCanvas;
    #viewportTransform;
    #viewportTransform_inv
    #staleViewportInv;

    #state;
    #activeLayerIndex;

    #interactionCache;

    /** 
     * @param {HTMLCanvasElement} canvas
     * @param {ImageBitmap} bitmap 
     */
    constructor(canvas, bitmap) {
      this.#mainCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      this.#viewportCanvas = canvas;

      const initialScale = Math.min(canvas.width / bitmap.width * 0.95, canvas.height / bitmap.height * 0.95);
      this.#viewportTransform = new DOMMatrix().scaleSelf(initialScale, initialScale);
      this.#viewportTransform_inv = new DOMMatrix()
        .translateSelf(this.#viewportCanvas.width / 2, this.#viewportCanvas.height / 2)
        .multiplySelf(this.#viewportTransform)
        .translateSelf(-this.#mainCanvas.width / 2, -this.#mainCanvas.height / 2)
        .invertSelf();
      this.#staleViewportInv = false;

      const layer = new Layer(bitmap);
      this.#state = new utils.StateHistory({
        width: bitmap.width,
        height: bitmap.height,
        layers: [{ layer, state: layer.state }]
      });
      this.#activeLayerIndex = 0;
      this.render();

      this.#interactionCache = {
        canvas: new OffscreenCanvas(this.#mainCanvas.width, this.#mainCanvas.height),
        path2D: new Path2D(),
        lastPoint: new DOMPoint(),
        rect: new DOMRect(),
        width: 0,
        color: "#000",
      };
    }

    get #layers() { return this.#state.state.layers }
    get #activeLayer() { return this.#layers[this.#activeLayerIndex].layer }
    get viewportTransform() { return this.#viewportTransform }
    get viewportTransform_inv() {
      if (this.#staleViewportInv) {
        this.#viewportTransform_inv = new DOMMatrix()
          .translateSelf(this.#viewportCanvas.width / 2, this.#viewportCanvas.height / 2)
          .multiplySelf(this.#viewportTransform)
          .translateSelf(-this.#mainCanvas.width / 2, -this.#mainCanvas.height / 2)
          .invertSelf();
        this.#staleViewportInv = false;
      }
      return this.#viewportTransform_inv;
    }
    get regionRect() {
      const T = this.viewportTransform_inv.inverse();
      const topLeft = new DOMPoint(this.#interactionCache.rect.left, this.#interactionCache.rect.top).matrixTransform(T);
      const bottomRight = new DOMPoint(this.#interactionCache.rect.right, this.#interactionCache.rect.bottom).matrixTransform(T);
      return new DOMRect(
        Math.min(topLeft.x, bottomRight.x) / this.#viewportCanvas.width,
        Math.min(topLeft.y, bottomRight.y) / this.#viewportCanvas.height,
        Math.abs(topLeft.x - bottomRight.x) / this.#viewportCanvas.width,
        Math.abs(topLeft.y - bottomRight.y) / this.#viewportCanvas.height,
      );
    }
    get canUndo() { return this.#state.canUndo }
    get canRedo() { return this.#state.canRedo }
    get previewLayerTransform() { return this.#activeLayer.previewTransform }
    get layerTransform() { return this.#activeLayer.state.transform }

    get width() { return this.#mainCanvas.width }
    get height() { return this.#mainCanvas.height }
    set width(width) {
      this.#mainCanvas.width = width;
      this.#state.state = { ...this.#state.state, width }
    }
    set height(height) {
      this.#mainCanvas.height = height;
      this.#state.state = { ...this.#state.state, height }
    }

    /** @param {ImageBitmap | null} bitmap */
    createNewLayer(bitmap) {
      const newLayer = new Layer(bitmap instanceof ImageBitmap ? bitmap : { width: this.#mainCanvas.width, height: this.#mainCanvas.height });
      this.#state.state = {
        ...this.#state.state,
        layers: [
          ...this.#state.state.layers,
          { layer: newLayer, state: newLayer.state }
        ]
      };
      bitmap && newLayer.drawOn(this.#mainCanvas);
      this.#activeLayerIndex = this.#state.state.layers.length - 1;
    }

    /** @param {number} layerIndex */
    deleteLayer(layerIndex) {
      if (layerIndex in this.#layers && this.#layers.length > 1) {
        const updated = { ...this.#state.state, layers: [...this.#state.state.layers] };
        updated.layers.splice(layerIndex, 1);
        this.#state.state = updated;
        this.#activeLayerIndex = Math.min(this.#activeLayerIndex, updated.layers.length - 1);
      }
    }

    translateViewportBy(dx = 0, dy = 0) {
      this.#viewportTransform.preMultiplySelf(new DOMMatrix().translateSelf(dx, dy));
      this.refreshViewport();
      this.#staleViewportInv = true;
    }

    scaleViewportBy(ds = 1, x = 0.5, y = 0.5) {
      const Tx = (x - 0.5) * this.#viewportCanvas.width;
      const Ty = (y - 0.5) * this.#viewportCanvas.height;

      this.#viewportTransform.preMultiplySelf(new DOMMatrix().scaleSelf(ds, ds, 1, Tx, Ty));
      this.refreshViewport();
      this.#staleViewportInv = true;
    }

    resetViewport() {
      const scale = Math.min(this.#viewportCanvas.width / this.#mainCanvas.width * 0.95, this.#viewportCanvas.height / this.#mainCanvas.height * 0.95);
      this.#viewportTransform = new DOMMatrix().scaleSelf(scale, scale);
      this.refreshViewport();
      this.#staleViewportInv = true;
    }

    /** @param {DOMMatrix} M  */
    previewLayerTransformBy(M) { this.#activeLayer.previewTransformBy(M) }
    /** @param {DOMMatrix} M  */
    previewLayerTransformTo(M) { this.#activeLayer.previewTransformTo(M) }
    finalizeLayerPreview() {
      const layerState = this.#activeLayer.finalizePreview();
      const updated = { ...this.#state.state, layers: [...this.#state.state.layers] };
      updated.layers[this.#activeLayerIndex] = { ...updated.layers[this.#activeLayerIndex], state: layerState };
      this.#state.state = updated;
    }

    /** 
     * @param {DOMPoint} startPoint
     * @param {number} width
     * @param {string} color
     */
    startDrawing(startPoint, width, color) {
      // sandwich setup
      const bottomCtx = this.#mainCanvas.getContext("2d");
      const topCtx = this.#interactionCache.canvas.getContext("2d");
      bottomCtx.save();
      bottomCtx.clearRect(0, 0, this.#mainCanvas.width, this.#mainCanvas.height);
      topCtx.clearRect(0, 0, this.#interactionCache.canvas.width, this.#interactionCache.canvas.height);
      this.#layers.slice(0, this.#activeLayerIndex + 1).forEach(layer => layer.layer.drawOn(this.#mainCanvas));
      this.#layers.slice(this.#activeLayerIndex + 1).forEach(layer => layer.layer.drawOn(this.#interactionCache.canvas));

      this.#interactionCache.width = width;
      this.#interactionCache.color = color;
      bottomCtx.strokeStyle = color;
      bottomCtx.lineWidth = width;
      bottomCtx.lineCap = "round";
      bottomCtx.lineJoin = "round";

      this.#interactionCache.layerTransform_inv = new DOMMatrix()
        .translateSelf(this.#mainCanvas.width / 2, this.#mainCanvas.height / 2)
        .multiplySelf(this.layerTransform).invertSelf();

      this.#interactionCache.lastPoint = startPoint.matrixTransform(this.viewportTransform_inv);
      bottomCtx.beginPath();
      bottomCtx.moveTo(this.#interactionCache.lastPoint.x, this.#interactionCache.lastPoint.y);

      const rawPoint = this.#interactionCache.lastPoint.matrixTransform(this.#interactionCache.layerTransform_inv);
      this.#interactionCache.path2D.moveTo(rawPoint.x, rawPoint.y);
      this.#interactionCache.rect = new DOMRect(rawPoint.x, rawPoint.y, 0, 0);
    }

    /** @param {DOMPoint} to */
    drawLine(to) {
      const bottomCtx = this.#mainCanvas.getContext("2d");
      const to_inv = to.matrixTransform(this.viewportTransform_inv);

      // out of bounds
      const isOOB =
        to_inv.x < -this.#interactionCache.width / 2 ||
        to_inv.x > this.#mainCanvas.width + this.#interactionCache.width / 2 ||
        to_inv.y < -this.#interactionCache.height / 2 ||
        to_inv.y > this.#mainCanvas.height + this.#interactionCache.height / 2;
      const prevIsOOB =
        this.#interactionCache.lastPoint.x < -this.#interactionCache.width / 2 ||
        this.#interactionCache.lastPoint.x > this.#mainCanvas.width + this.#interactionCache.width / 2 ||
        this.#interactionCache.lastPoint.y < -this.#interactionCache.height / 2 ||
        this.#interactionCache.lastPoint.y > this.#mainCanvas.height + this.#interactionCache.height / 2;

      if (prevIsOOB && isOOB) {
        this.#interactionCache.lastPoint = to_inv;
        return;
      }

      if (!isOOB && prevIsOOB) {
        const rawLast = this.#interactionCache.lastPoint.matrixTransform(this.#interactionCache.layerTransform_inv);
        this.#interactionCache.path2D.moveTo(rawLast.x, rawLast.y);
        bottomCtx.moveTo(this.#interactionCache.lastPoint.x, this.#interactionCache.lastPoint.y);
      }

      bottomCtx.lineTo(to_inv.x, to_inv.y);
      bottomCtx.stroke();

      bottomCtx.drawImage(this.#interactionCache.canvas, 0, 0);
      this.refreshViewport();

      this.#interactionCache.lastPoint = to_inv;
      const rawPoint = to_inv.matrixTransform(this.#interactionCache.layerTransform_inv);
      this.#interactionCache.path2D.lineTo(rawPoint.x, rawPoint.y);

      this.#interactionCache.rect.width += Math.max(this.#interactionCache.rect.x - rawPoint.x, rawPoint.x - this.#interactionCache.rect.right, 0);
      this.#interactionCache.rect.height += Math.max(this.#interactionCache.rect.y - rawPoint.y, rawPoint.y - this.#interactionCache.rect.bottom, 0);
      this.#interactionCache.rect.x = Math.min(rawPoint.x, this.#interactionCache.rect.x);
      this.#interactionCache.rect.y = Math.min(rawPoint.y, this.#interactionCache.rect.y);
    }

    endDrawing() {
      const rawClipPath = new Path2D();
      rawClipPath.rect(0, 0, this.#mainCanvas.width, this.#mainCanvas.height);
      const clipPath = new Path2D();
      clipPath.addPath(rawClipPath, this.#interactionCache.layerTransform_inv);

      this.#activeLayer.resizeFitStroke(this.#interactionCache.rect, this.#interactionCache.width);
      const layerState = this.#activeLayer.addStroke({
        color: this.#interactionCache.color,
        width: this.#interactionCache.width / utils.getScale(this.#activeLayer.state.transform),
        path2D: this.#interactionCache.path2D,
        clipPath
      });

      const updated = { ...this.#state.state, layers: [...this.#state.state.layers] };
      updated.layers[this.#activeLayerIndex] = { ...updated.layers[this.#activeLayerIndex], state: layerState };
      this.#state.state = updated;

      this.#mainCanvas.getContext("2d").restore();
      this.#interactionCache.canvas.getContext("2d").clearRect(0, 0, this.#interactionCache.canvas.width, this.#interactionCache.canvas.height);
      this.#interactionCache.path2D = new Path2D();
    }

    /** @param {DOMPoint} startPoint  */
    startRegionSelect(startPoint) {
      const start_T = startPoint.matrixTransform(this.viewportTransform_inv);
      start_T.x = utils.clamp(0, start_T.x, this.#mainCanvas.width);
      start_T.y = utils.clamp(0, start_T.y, this.#mainCanvas.height);
      this.#interactionCache.lastPoint = start_T;
      this.#interactionCache.rect = new DOMRect(start_T.x, start_T.y, 0, 0);
    }

    /** @param {DOMPoint} to  */
    regionSelect(to) {
      const to_T = to.matrixTransform(this.viewportTransform_inv);
      to_T.x = utils.clamp(0, to_T.x, this.#mainCanvas.width);
      to_T.y = utils.clamp(0, to_T.y, this.#mainCanvas.height);

      this.#interactionCache.rect.x = Math.min(this.#interactionCache.lastPoint.x, to_T.x);
      this.#interactionCache.rect.y = Math.min(this.#interactionCache.lastPoint.y, to_T.y);
      this.#interactionCache.rect.width = Math.abs(this.#interactionCache.lastPoint.x - to_T.x);
      this.#interactionCache.rect.height = Math.abs(this.#interactionCache.lastPoint.y - to_T.y);
    }

    endRegionSelect() {
      if (this.#interactionCache.rect.width === 0 || this.#interactionCache.rect.height === 0) return false;

      const ccx = this.#interactionCache.rect.left + this.#interactionCache.rect.width / 2;
      const ccy = this.#interactionCache.rect.top + this.#interactionCache.rect.height / 2;

      const cx = this.#mainCanvas.width / 2;
      const cy = this.#mainCanvas.height / 2;

      const T = new DOMMatrix().translateSelf(cx - ccx, cy - ccy);
      const updated = { ...this.#state.state, width: this.#interactionCache.rect.width, height: this.#interactionCache.rect.height };
      updated.layers = updated.layers.map(({ layer, state }) => {
        const newState = { ...state, transform: T.multiply(state.transform) };
        layer.state = newState;
        return { layer, state: newState };
      });
      this.#mainCanvas.width = this.#interactionCache.rect.width;
      this.#mainCanvas.height = this.#interactionCache.rect.height;
      this.#state.state = updated;
      this.#staleViewportInv = true;

      return true;
    }

    /** @param {ImageEncodeOptions?} options */
    toBlob(options) { return this.#mainCanvas.convertToBlob(options) }

    /** @param {number} layerIndex  */
    toggleLayerVisibility(layerIndex) {
      if (!(layerIndex in this.#layers)) return;

      const updated = { ...this.#state.state, layers: [...this.#state.state.layers] };
      updated.layers[layerIndex] = { ...updated.layers[layerIndex], visible: !updated.layers[layerIndex].visible };
      this.#state.state = updated;
    }

    refreshViewport() {
      const ctx = this.#viewportCanvas.getContext("2d");
      ctx.save();

      ctx.fillStyle = "#424242";
      ctx.fillRect(0, 0, this.#viewportCanvas.width, this.#viewportCanvas.height);

      ctx.setTransform(new DOMMatrix().translateSelf(this.#viewportCanvas.width / 2, this.#viewportCanvas.height / 2).multiplySelf(this.#viewportTransform));

      ctx.clearRect(-this.#mainCanvas.width / 2, -this.#mainCanvas.height / 2, this.#mainCanvas.width, this.#mainCanvas.height);
      ctx.drawImage(this.#mainCanvas, -this.#mainCanvas.width / 2, -this.#mainCanvas.height / 2);

      ctx.restore();
    }

    render() {
      const ctx = this.#mainCanvas.getContext("2d");
      ctx.clearRect(0, 0, this.#mainCanvas.width, this.#mainCanvas.height);
      this.#layers.forEach(layer => layer.layer.drawOn(this.#mainCanvas));
      this.refreshViewport();
    }

    undo() {
      const oldWidth = this.#mainCanvas.width;
      const oldHeight = this.#mainCanvas.height;

      const undid = this.#state.undo();
      if (!undid) return false;
      if (this.#state.state.width !== oldWidth || this.#state.state.height !== oldHeight) {
        this.#mainCanvas.width = this.#state.state.width;
        this.#mainCanvas.height = this.#state.state.height;
      }
      this.#state.state.layers.forEach(({ layer, state }) => layer.state = state);
      return true;
    }

    redo() {
      const oldWidth = this.#mainCanvas.width;
      const oldHeight = this.#mainCanvas.height;

      const redid = this.#state.redo();
      if (!redid) return false;
      if (this.#state.state.width !== oldWidth || this.#state.state.height !== oldHeight) {
        this.#mainCanvas.width = this.#state.state.width;
        this.#mainCanvas.height = this.#state.state.height;
      }
      this.#state.state.layers.forEach(({ layer, state }) => layer.state = state);
      return true;
    }
  }

  class Layer {
    #img;
    #canvas;
    #state;
    #previewTransform;

    /** @param {ImageBitmap | {width: number, height: number}} bitmap */
    constructor(bitmap) {
      this.#canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      this.#state = {
        transform: new DOMMatrix(),
        /** @type {{color: string, width: number, path2D: Path2D, clipPath: Path2D}[]} */
        strokes: [],
        isVisible: true,
      };
      this.#previewTransform = new DOMMatrix();
      if (bitmap instanceof ImageBitmap) {
        this.#img = bitmap;
        this.#drawImage();
      }
    }

    get width() { return this.#canvas.width }
    get height() { return this.#canvas.height }
    get state() { return this.#state }
    get previewTransform() { return this.#previewTransform.multiply(this.#state.transform) }

    set state(state) {
      if (this.#state.strokes.length < state.strokes.length) {
        // adding strokes
        for (let i = this.#state.strokes.length; i < state.strokes.length; i++) {
          this.#drawStroke(state.strokes[i]);
        }
      } else if (this.#state.strokes.length > state.strokes.length) {
        // removing strokes
        this.#drawImage();
        this.#drawStrokes(state.strokes);
      }
      this.#state = state;
    }

    previewTransformBy(dM) { this.#previewTransform.preMultiplySelf(dM) }
    previewTransformTo(M) { this.#previewTransform = M }

    finalizePreview() {
      const applied = this.#previewTransform.multiplySelf(this.#state.transform);
      this.#state = { ...this.#state, transform: applied };
      this.#previewTransform = new DOMMatrix();
      return this.#state;
    }

    /**
     * @param {DOMRect} strokeRect
     * @param {number} strokeWidth 
     */
    resizeFitStroke(strokeRect, strokeWidth) {
      const canvasRect = new DOMRect(-this.width / 2, -this.height / 2, this.width, this.height);

      const dx = Math.max(0, canvasRect.left - (strokeRect.left - strokeWidth / 2), (strokeRect.right + strokeWidth / 2) - canvasRect.right);
      const dy = Math.max(0, canvasRect.top - (strokeRect.top - strokeWidth / 2), (strokeRect.bottom + strokeWidth / 2) - canvasRect.bottom);

      if (dx || dy) {
        this.#canvas.width += ~~(2 * dx);
        this.#canvas.height += ~~(2 * dy);
        this.#drawImage();
        this.#drawStrokes();
      }
    }

    /** @param {{color: string, width: number, path2D: Path2D, clipPath: Path2D}} stroke  */
    addStroke(stroke) {
      this.#state = { ...this.#state, strokes: [...this.#state.strokes, stroke] };
      this.#drawStroke(stroke);
      return this.#state;
    }

    /** @param {{color: string, width: number, path2D: Path2D, clipPath: Path2D}} stroke  */
    #drawStroke(stroke) {
      const ctx = this.#canvas.getContext("2d");
      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.lineWidth = stroke.width;
      ctx.strokeStyle = stroke.color;
      ctx.setTransform(new DOMMatrix().translateSelf(this.width / 2, this.height / 2));
      ctx.clip(stroke.clipPath);
      ctx.stroke(stroke.path2D);
      ctx.restore();
    }

    #drawStrokes(strokes = this.#state.strokes) {
      const ctx = this.#canvas.getContext("2d");
      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.setTransform(new DOMMatrix().translateSelf(this.width / 2, this.height / 2));
      for (const stroke of strokes) {
        ctx.save();
        ctx.lineWidth = stroke.width;
        ctx.strokeStyle = stroke.color;
        ctx.clip(stroke.clipPath);
        ctx.stroke(stroke.path2D);
        ctx.restore();
      }
      ctx.restore();
    }

    #drawImage() {
      if (!this.#img) return;
      const ctx = this.#canvas.getContext("2d");
      ctx.save();
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.setTransform(new DOMMatrix().translateSelf(this.width / 2, this.height / 2));
      ctx.drawImage(this.#img, -this.#img.width / 2, -this.#img.height / 2);
      ctx.restore();
    }

    /** @param {OffscreenCanvas} canvas */
    drawOn(canvas) {
      if (!this.#state.isVisible) return;

      const ctx = canvas.getContext("2d");
      ctx.save();
      ctx.setTransform(new DOMMatrix()
        .translateSelf(canvas.width / 2, canvas.height / 2)
        .multiplySelf(this.#previewTransform)
        .multiplySelf(this.#state.transform)
      );
      ctx.drawImage(this.#canvas, -this.width / 2, -this.height / 2);
      ctx.restore();
    }
  }

  var utils = {
    getBulk(filters) {
      const t = Webpack.getBulk(
        ...Object.values(filters)
      );

      return Object.fromEntries(
        Object.entries(filters)
          .map((e, i) => (e[1] = t[i], e))
      );
    },

    getKeysInModule(mod, strs) {
      const entries = new Map(Object.entries(strs));
      const found = {};

      outer: for (const key in mod) {
        const src = mod[key]?.toString?.();
        if (!src) continue;

        for (const [name, search] of entries) {
          if (!src.includes(search)) continue;

          found[name] = key;
          entries.delete(name)
          if (entries.size === 0) break outer; else break;
        }
      }
      return found;
    },

    StateHistory:
    /** @template T */ class {
        #state;
        #history;
        #pointer;

        /** @param {T} initialState  */
        constructor(initialState) {
          this.#state = initialState;
          this.#history = [initialState];
          this.#pointer = 0;
        }

        get state() { return this.#state }
        set state(value) {
          if (this.#pointer < this.#history.length - 1) {
            this.#history = this.#history.slice(0, this.#pointer + 1);
          }
          this.#history.push(value);
          this.#pointer++;
          this.#state = value;
        }

        undo() {
          if (this.#pointer <= 0) return false;

          this.#pointer--;
          this.#state = this.#history[this.#pointer];
          return true;
        }

        redo() {
          if (this.#pointer + 1 >= this.#history.length) return false;

          this.#pointer++;
          this.#state = this.#history[this.#pointer];
          return true;
        }
        get canUndo() { return this.#pointer > 0 }
        get canRedo() { return this.#pointer < this.#history.length - 1 }
      },

    /**
     * @param {number} x
     * @param {number} y
     */
    atan2(x, y) {
      const angle = Math.round(Math.atan2(y, x) * 180 / Math.PI * 10) / 10;
      return (angle + 360) % 360;
    },

    /** @param {DOMMatrix} M */
    getAngle(M) { return utils.atan2(M.a, M.b) },

    /** @param {DOMMatrix} M */
    getScale(M) { return Math.max(Math.hypot(M.a, M.b), Math.hypot(M.c, M.d)) },

    /** @param {DOMMatrix} M */
    getTranslate(M) { return { x: M.e, y: M.f } },

    /** @param {...number} values */
    minAbs: function (...values) {
      let best = values[0];
      for (let i = 1; i < values.length; i++) {
        if (Math.abs(values[i]) < Math.abs(best)) {
          best = values[i];
        }
      }
      return best;
    },

    /** @param {...number} values */
    maxAbs: function (...values) {
      let best = values[0];
      for (let i = 1; i < values.length; i++) {
        if (Math.abs(values[i]) > Math.abs(best)) {
          best = values[i];
        }
      }
      return best;
    },

    /**
     * @param {number} min
     * @param {number} x
     * @param {number} max
     */
    clamp(min, x, max) { return Math.max(min, Math.min(x, max)) },

    /**
     * @param {number} x 
     * @param {{minValue: number, centerValue: number, maxValue: number}} params
     */
    expScaling(x, { minValue, centerValue, maxValue }) {
      if (x <= 0.5) {
        return Math.exp((1 - 2 * x) * Math.log(minValue) + 2 * x * Math.log(centerValue));
      } else {
        return Math.exp((1 - (2 * x - 1)) * Math.log(centerValue) + (2 * x - 1) * Math.log(maxValue));
      }
    },

    /**
     * @param {number} x 
     * @param {{minValue: number, centerValue: number, maxValue: number}} params
     */
    logScaling(x, { minValue, centerValue, maxValue }) {
      x = utils.clamp(minValue, x, maxValue);
      if (x <= centerValue) {
        const val = (Math.log(x) - Math.log(minValue)) / (Math.log(centerValue) - Math.log(minValue));
        return Math.round(val / 2 * 100);
      } else {
        const val = (Math.log(x) - Math.log(centerValue)) / (Math.log(maxValue) - Math.log(centerValue));
        return Math.round((1 + val) / 2 * 100);
      }
    },

    paths: {
      Main: "M7.47 21.49C4.2 19.93 1.86 16.76 1.5 13H0c.51 6.16 5.66 11 11.95 11 .23 0 .44-.02.66-.03L8.8 20.15zM12.05 0c-.23 0-.44.02-.66.04l3.81 3.81 1.33-1.33C19.8 4.07 22.14 7.24 22.5 11H24c-.51-6.16-5.66-11-11.95-11M16 14h2V8c0-1.11-.9-2-2-2h-6v2h6zm-8 2V4H6v2H4v2h2v8c0 1.1.89 2 2 2h8v2h2v-2h2v-2z",
      FlipH: "M1.2656 20.1094 8.7188 4.4531C9.1406 3.6094 10.3594 3.8906 10.3594 4.8281L10.3594 20.4375C10.3594 21.375 9.8906 21.7969 8.9531 21.7969L2.2969 21.7969C1.3594 21.7969.8438 20.9531 1.2656 20.1094ZM22.8281 20.1094 15.375 4.4531C14.9531 3.6094 13.7344 3.8906 13.7344 4.8281L13.7344 20.4375C13.7344 21.375 14.2031 21.7969 15.1406 21.7969L21.7969 21.7969C22.7344 21.7969 23.25 20.9531 22.8281 20.1094Z",
      FlipV: "M20.1094 22.7344 4.4531 15.2812C3.6094 14.8594 3.8906 13.6406 4.8281 13.6406L20.4375 13.6406C21.375 13.6406 21.7969 14.1094 21.7969 15.0469L21.7969 21.7031C21.7969 22.6406 20.9531 23.1563 20.1094 22.7344ZM20.1094 1.1719 4.4531 8.625C3.6094 9.0469 3.8906 10.2656 4.8281 10.2656L20.4375 10.2656C21.375 10.2656 21.7969 9.7969 21.7969 8.8594L21.7969 2.2031C21.7969 1.2656 20.9531.75 20.1094 1.1719Z",
      RotR: "M9.75 7.8516 7.8516 9.75C7.5 10.1016 7.5 10.6641 7.8516 11.0157 8.2032 11.3671 8.7657 11.3671 9.1171 11.0157L12.5625 7.5704C12.9844 7.1484 12.9844 6.7266 12.5625 6.3046L9.1171 2.8594C8.7657 2.5078 8.2032 2.5078 7.8516 2.8594 7.5 3.2109 7.5 3.7734 7.8516 4.125L9.75 6.0234 5.6719 6.0234C3.8438 6.0234 2.4375 7.4296 2.4375 9.2579L2.4375 12.0704C2.4375 12.5625 2.8594 12.9844 3.3516 12.9844 3.8438 12.9844 4.2657 12.5625 4.2657 12.0704L4.2657 9.1875C4.2657 8.4844 4.8984 7.8516 5.6016 7.8516ZM16.0313 21.7969 21.75 21.7969C22.3594 21.7969 23.0625 21.2813 22.6406 20.25L16.4063 5.2969C16.0313 4.2656 14.7656 4.5469 14.7656 5.5781L14.7656 20.3906C14.7656 21.2344 15.1875 21.7969 16.0313 21.7969ZM1.3594 20.3438C.7969 20.7188.8906 21.7969 1.9219 21.7969L12.5625 21.7969C13.3125 21.7969 13.6875 21.2344 13.6875 20.625L13.6875 14.7188C13.6875 14.0625 13.0313 13.4531 12.3281 13.875Z",
      RotL: "M14.25 7.8516 16.1484 9.75C16.5 10.1016 16.5 10.6641 16.1484 11.0157 15.7968 11.3671 15.2343 11.3671 14.8829 11.0157L11.4375 7.5704C11.0156 7.1484 11.0156 6.7266 11.4375 6.3046L14.8829 2.8594C15.2343 2.5078 15.7968 2.5078 16.1484 2.8594 16.5 3.2109 16.5 3.7734 16.1484 4.125L14.25 6.0234 18.3281 6.0234C20.1562 6.0234 21.5625 7.4296 21.5625 9.2579L21.5625 12.0704C21.5625 12.5625 21.1406 12.9844 20.6484 12.9844 20.1562 12.9844 19.7343 12.5625 19.7343 12.0704L19.7343 9.1875C19.7343 8.4844 19.1016 7.8516 18.3984 7.8516ZM7.9687 21.7969 2.25 21.7969C1.6406 21.7969.9375 21.2813 1.3594 20.25L7.5937 5.2969C7.9687 4.2656 9.2344 4.5469 9.2344 5.5781L9.2344 20.3906C9.2344 21.2344 8.8125 21.7969 7.9687 21.7969ZM22.6406 20.3438C23.2031 20.7188 23.1094 21.7969 22.0781 21.7969L11.4375 21.7969C10.6875 21.7969 10.3125 21.2344 10.3125 20.625L10.3125 14.7188C10.3125 14.0625 10.9687 13.4531 11.6719 13.875Z",
      Undo: "M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8",
      Redo: "M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7z",
      Crop: "M17 15h2V7c0-1.1-.9-2-2-2H9v2h8zM7 17V1H5v4H1v2h4v10c0 1.1.9 2 2 2h10v4h2v-4h4v-2z",
      Rotate: "M10.217 19.339C6.62 17.623 4.046 14.136 3.65 10H2c.561 6.776 6.226 12.1 13.145 12.1.253 0 .484-.022.726-.033L11.68 17.865ZM8.855 1.9c-.253 0-.484.022-.726.044L12.32 6.135l1.463-1.463C17.38 6.377 19.954 9.864 20.35 14H22C21.439 7.224 15.774 1.9 8.855 1.9Z",
      Draw: "M22 24H2v-4h20zM13.06 5.19l3.75 3.75L7.75 18H4v-3.75zm4.82 2.68-3.75-3.75 1.83-1.83c.39-.39 1.02-.39 1.41 0l2.34 2.34c.39.39.39 1.02 0 1.41z",
      Pan: "M23 12 18.886 7.864v2.772h-5.5v-5.5h2.75L12 1 7.886 5.136h2.75v5.5H5.092V7.886L1 12l4.136 4.136v-2.75h5.5v5.5H7.886L12 23l4.136-4.114h-2.75v-5.5h5.5v2.75L23 12Z",
      Scale: "M16 3a1 1 0 100 2h1.586L11 11.586V10A1 1 0 009 10v3.75c0 .69.56 1.25 1.25 1.25H14a1 1 0 100-2H12.414L19 6.414V8a1 1 0 102 0V4.25C21 3.56 20.44 3 19.75 3ZM5 3l-.15.005A2 2 0 003 5V19l.005.15A2 2 0 005 21H19l.15-.005A2 2 0 0021 19V13l-.007-.117A1 1 0 0019 13v6H5V5h6l.117-.007A1 1 0 0011 3Z",
      LockOpen: "M6 20h12V10H6zm6-3q.825 0 1.413-.587T14 15t-.587-1.412T12 13t-1.412.588T10 15t.588 1.413T12 17m-6 3V10zm0 2q-.825 0-1.412-.587T4 20V10q0-.825.588-1.412T6 8h7V6q0-2.075 1.463-3.537T18 1q1.775 0 3.1 1.075t1.75 2.7q.125.425-.162.825T22 6q-.425 0-.7-.175t-.4-.575q-.275-.95-1.062-1.6T18 3q-1.25 0-2.125.875T15 6v2h3q.825 0 1.413.588T20 10v10q0 .825-.587 1.413T18 22z",
      Lock: "M12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2m5 3c.55 0 1-.45 1-1V11c0-.55-.45-1-1-1H7c-.55 0-1 .45-1 1v8c0 .55.45 1 1 1H17M9 8h6V6c0-1.66-1.34-3-3-3S9 4.34 9 6Zm9 0c1.1 0 2 .9 2 2V20c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V10c0-1.1.9-2 2-2H7V6c0-2.76 2.24-5 5-5s5 2.24 5 5V8h1",
    }
  }

  var hooks = {
    /**
     * @template T
     * @param {T | (() => T)} initialvalue
     * @param {string} key
     * @returns {[T, typeof setval]}
    */
    useStoredState(key, initialvalue) {
      const [val, setval] = useState(() => {
        /** @type {T | null} */
        const stored = BdApi.Data.load(meta.slug, key);
        if (stored == null) {
          if (initialvalue instanceof Function) {
            return initialvalue();
          } else {
            return initialvalue;
          }
        } else {
          return stored;
        }
      });

      useEffect(() => {
        BdApi.Data.save(key, BdApi.Data.save(meta.slug, key, val));
      }, [val, key]);

      return [val, setval]
    },

    /**
     * Wrapper for interaction events
     * @param {{
     *  buttons?: number,
     *  onStart?: (e: PointerEvent, store: Record<string, any>) => void,
     *  onChange?:(e: PointerEvent, store: Record<string, any>) => void,
     *  onSubmit?: (e: PointerEvent, store: Record<string, any>) => void
     * }} props
    */
    usePointerCapture({ onStart, onChange, onSubmit }) {
      /** @type {React.RefObject<null | number>} */
      const pointerId = useRef(null);
      const smolStore = useRef({});

      /** @type {(e: PointerEvent) => void} */
      const onPointerDown = useCallback(e => {
        if (!(e.buttons & 5) || pointerId.current != null) return;

        e.currentTarget.setPointerCapture(e.pointerId);
        pointerId.current = e.pointerId;
        onStart?.(e, smolStore.current);
      }, [onStart]);

      /** @type {(e: PointerEvent) => void} */
      const onPointerMove = useCallback(e => {
        if (!(e.buttons & 5) || pointerId.current !== e.pointerId) return;

        onChange?.(e, smolStore.current);
      }, [onChange]);

      /** @type {(e: PointerEvent) => void} */
      const onPointerUp = useCallback(e => {
        if (pointerId.current !== e.pointerId) return;

        e.currentTarget.releasePointerCapture(e.pointerId);
        pointerId.current = null;
        onSubmit?.(e, smolStore.current);
        smolStore.current = {};
      }, [onSubmit]);

      return {
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onLostPointerCapture: onPointerUp,
      }
    },

    /**
     * @param {{
     *  onStart?: (e: React.WheelEvent, store: Record<string, any>) => void,
     *  onChange?: (e: React.WheelEvent, store: Record<string, any>) => void,
     *  onSubmit?: (e: React.WheelEvent, store: Record<string, any>) => void,
     *  wait?: number,
     * }} params
     */
    useDebouncedWheel({ onStart, onChange, onSubmit, wait = 350 }) {
      /** @type {React.RefObject<null | number>} */
      const timer = useRef(null);
      const smolStore = useRef({});

      /** @type {(e: WheelEvent & {currentTarget: HTMLCanvasElement}) => void} */
      const onWheel = useCallback(e => {
        if (!e.deltaY) return;

        if (timer.current == null) {
          onStart?.(e, smolStore.current);
        }

        onChange?.(e, smolStore.current);

        timer.current && clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          onSubmit?.(e, smolStore.current);
          smolStore.current = {};
          timer.current = null;
        }, wait);

      }, [onStart, onChange, onSubmit, wait]);

      return onWheel;
    }
  }

  var Components = {
    /**
     * @param {{
     * onClick?: (e: MouseEvent) => void,
     * tooltip?: string,
     * d?: string,
     * disabled?: boolean,
     * active?: boolean,
     * position?: string}} props
     */
    IconButton({ onClick, tooltip, d, disabled, active, position = 'top' }) {
      return jsx(BdApi.Components.ErrorBoundary, {
        children: jsx(BdApi.Components.Tooltip, {
          text: tooltip || '',
          hideOnClick: true,
          position,
          children: e => {
            let { onMouseEnter, onMouseLeave, onClick: onClick2 } = e;
            const handleClick = e => { if (!disabled) { onClick?.(e); onClick2?.(e) } };
            const handleKeyUp = e => (e.key === 'Enter' || e.key === ' ') && handleClick(e);

            return [internals.keys.FocusRing] && jsx(internals.nativeUI[internals.keys.FocusRing], {
              children: jsx("div", {
                onMouseEnter,
                onMouseLeave,
                onClick: handleClick,
                onKeyUp: handleKeyUp,
                className: [internals.actionButtonClass.button, disabled && "disabled", active && "active"].filter(Boolean).join(" "),
                role: "button",
                tabIndex: 0,
                children: jsx("svg", {
                  className: internals.actionIconClass.actionBarIcon,
                  ["aria-hidden"]: "true",
                  role: "img",
                  xmlns: "http://www.w3.org/2000/svg",
                  width: "16",
                  height: "16",
                  fill: "none",
                  viewBox: "0 0 24 24",
                  children: jsx("path", {
                    fill: "currentColor",
                    d
                  })
                })
              })
            })
          }
        })
      })
    },

    /** @param {{url: string}} props */
    RemixIcon({ url }) {
      if (!internals.keys.ModalRoot || !internals.keys.ModalContent) return;

      const [fetching, setFetching] = useState(false);
      const ctrl = useRef(new AbortController());
      const userActions = useRef(null);

      useEffect(() => () => ctrl.current.abort(), []);

      return !fetching ? jsx(Components.IconButton, {
        onClick: async () => {
          try {
            setFetching(true);
            const response = await fetch(url, { signal: ctrl.current.signal }); // BdApi.Net.fetch will reject blobs
            const blob = await response.blob();
            const bitmap = await createImageBitmap(blob);

            internals.nativeUI[internals.keys.closeModalInAllContexts]?.("Media Viewer Modal");
            internals.nativeUI[internals.keys.openModal]?.(e => jsx(BdApi.Components.ErrorBoundary, {
              children: jsx(internals.Modal[internals.keys.ModalRoot], {
                ...e,
                animation: "subtle",
                size: "dynamic",
                className: `${meta.slug}Root`,
                children: jsx(internals.Modal[internals.keys.ModalContent], {
                  children: jsx(Components.ImageEditor, {
                    bitmap,
                    ref: userActions,
                  })
                }),
              })
            })
            );
            setFetching(false);
          } catch (e) {
            setFetching(false);
            if (e.name !== "AbortError")
              UI.showToast("Could not fetch image.", { type: "error" });
          }
        },
        position: 'bottom',
        tooltip: "Edit Image",
        d: utils.paths.Main
      }) : jsx(BdApi.Components.Spinner, {
        type: BdApi.Components.Spinner.Type.SPINNING_CIRCLE_SIMPLE
      })
    },

    UploadIcon({ args }) {
      if (!internals.keys.ModalRoot || !internals.keys.ModalContent) return;
      // forwardRef for replace()
      const userActions = useRef(null);

      return jsx(Components.IconButton, {
        onClick: () => {
          createImageBitmap(args.upload.item.file).then(bitmap => {
            internals.nativeUI[internals.keys.openModal]?.(e => jsx(BdApi.Components.ErrorBoundary, {
              children: jsx(internals.Modal[internals.keys.ModalRoot], {
                ...e,
                animation: "subtle",
                size: "dynamic",
                className: `${meta.slug}Root`,
                children: jsx(internals.Modal[internals.keys.ModalContent], {
                  children: jsx(Components.ImageEditor, {
                    bitmap,
                    ref: userActions,
                  }),
                })
              })
            }))
          }).catch(() => {
            UI.showToast("Could not load image", { type: "error" });
          });
        },
        tooltip: "Edit Image",
        d: utils.paths.Main
      })
    },

    /** @param {{bitmap: ImageBitmap, ref: React.RefObject<any>}} props */
    ImageEditor({ bitmap, ref }) {
      const [mode, _setMode] = useState(null);
      const [canUndoRedo, setCanUndoRedo] = useState(0);
      const [dims, setDims] = useState({ width: bitmap.width, height: bitmap.height });
      const [fixedAspect, setFixedAspect] = hooks.useStoredState("fixedAspectRatio", true);
      const [strokeStyle, setStrokeStyle] = hooks.useStoredState("strokeStyle", () => ({ width: 5, color: "#000000" }));

      const isInteracting = useRef(false);
      /** @type { React.RefObject<HTMLCanvasElement | null> } */
      const canvasRef = useRef(null);
      const canvasRect = useRef(new DOMRect());
      /** @type { React.RefObject<CanvasEditor | null> } */
      const editor = useRef(null);
      /** @type { React.RefObject<HTMLDivElement | null> } */
      const overlay = useRef(null);
      /**  @type { React.RefObject<{ setValue: (value: number) => void, previewValue: (value: number) => void } | null> } */
      const auxRef = useRef(null);

      const setMode = useCallback((newVal) => {
        if (isInteracting.current) return;

        _setMode((oldMode) => {
          const newMode = newVal instanceof Function ? newVal(oldMode) : newVal;
          ["--translate"].forEach(prop => overlay.current.style.removeProperty(prop));

          switch (newMode) {
            case 1: {
              const { x: ctx, y: cty } = utils.getTranslate(editor.current.viewportTransform);
              overlay.current.style.setProperty("--translate", `${ctx.toFixed(1)}px ${cty.toFixed(1)}px`);
              break;
            }
          }
          return newMode;
        })
      }, []);

      useImperativeHandle(ref, () => ({
        replace({ draftType, upload }) {
          UI.showToast("Processing...", { type: "warn" });
          editor.current?.toBlob({ type: "image/webp" }).then(blob => {
            internals.uploadDispatcher.setFile({
              channelId: upload.channelId,
              id: upload.id,
              draftType,
              file: {
                file: new File([blob], upload.item.file.name.match(/.*\./i)[0] + "webp", { type: blob.type }),
                isThumbnail: upload.isThumbnail,
                origin: upload.origin,
                platform: upload.item.platform,
                compressionMetadata: {
                  compressTimeMs: 0,
                  earlyClipboardCompressionAttempted: false,
                  originalContentType: blob.type,
                  preCompressionSize: blob.size,
                }
              }
            });
            UI.showToast("Saved changes", { type: "success" });
          }).catch(() => {
            UI.showToast("Failed to process image.", { type: "error" });
          });
        },
        upload() {
          UI.showToast("Processing...", { type: "warn" });
          editor.current?.toBlob({ type: "image/webp" }).then(blob => {
            internals.uploadDispatcher.addFile({
              file: {
                file: new File([blob], "image.webp", { type: blob.type }),
                isThumbnail: false,
                origin: "clipboard",
                platform: 1
              },
              channelId: internals.SelectedChannelStore.getCurrentlySelectedChannelId(),
              showLargeMessageDialog: false,
              draftType: 0,
            })
            UI.showToast("Saved changes", { type: "success" });
          }).catch(() => {
            UI.showToast("Failed to process image.", { type: "error" });
          });
        }
      }), []);

      const render = useCallback(() => {
        editor.current.render();
        setCanUndoRedo(editor.current.canUndo << 1 ^ editor.current.canRedo);
        setDims(d => {
          if (d.width === editor.current.width && d.height === editor.current.height)
            return d;
          return { width: editor.current.width, height: editor.current.height }
        });
      }, []);

      useEffect(() => {
        const rect = canvasRef.current.offsetParent.getBoundingClientRect();
        canvasRef.current.width = ~~(rect.width);
        canvasRef.current.height = ~~(rect.height);
        editor.current = new CanvasEditor(canvasRef.current, bitmap);
        canvasRect.current = canvasRef.current.getBoundingClientRect();

        const ctrl = new AbortController();
        addEventListener("keydown", e => {
          switch (e.key) {
            case e.ctrlKey && "z":
              if (editor.current.undo()) render();
              return;

            case e.ctrlKey && "y":
              if (editor.current.redo()) render();
              return;

            case !e.repeat && e.ctrlKey && "b":
              editor.current.resetViewport();
              if (canvasRef.current?.matches(".rotating")) {
                overlay.current.style.removeProperty("--translate");
              }
              return;

            case !e.repeat && e.ctrlKey && "c":
              if (DiscordNative?.clipboard.copyImage) {
                editor.current.toBlob({
                  type: 'image/png'
                }).then(blob =>
                  blob.arrayBuffer()
                ).then(buf => {
                  DiscordNative.clipboard.copyImage(new Uint8Array(buf), "image.png");
                }).then(() => {
                  UI.showToast("Image copied", { type: "success" })
                }).catch(() => {
                  UI.showToast("Failed to copy image", { type: "error" })
                });
              }
              return;

            case !e.repeat && !e.ctrlKey && "c":
              setMode(m => m === 0 ? null : 0);
              return;

            case !e.repeat && !e.ctrlKey && "r":
              setMode(m => m === 1 ? null : 1);
              return;

            case !e.repeat && !e.ctrlKey && "m":
              setMode(m => m === 2 ? null : 2);
              return;

            case !e.repeat && !e.ctrlKey && "s":
              setMode(m => m === 3 ? null : 3);
              return;

            case !e.repeat && !e.ctrlKey && "d":
              setMode(m => m === 4 ? null : 4);
              return;
          }
        }, ctrl);
        addEventListener("resize", () => {
          canvasRect.current = canvasRef.current.getBoundingClientRect();
        }, ctrl);
        addEventListener("paste", async (e) => {
          e.stopPropagation()
          const items = e.clipboardData.items;
          for (const index in items) {
            const item = items[index];
            if (item.kind === 'file') {
              const file = item.getAsFile();
              if (!file) continue;

              const bitmap = await createImageBitmap(file)
              editor.current.createNewLayer(bitmap);
              render();
              break;
            }
          }
        }, { signal: ctrl.signal, capture: true });

        return () => ctrl.abort()
      }, []);

      const handleWheel = hooks.useDebouncedWheel({
        onChange: (e, store) => {
          if (mode === 3 && !e.ctrlKey) {
            const delta = 1 - 0.05 * Math.sign(e.deltaY);
            const { x: ctx, y: cty } = utils.getTranslate(editor.current.viewportTransform);
            const viewportScale = utils.getScale(editor.current.viewportTransform);
            const boxScale = canvasRect.current.width / e.currentTarget.width;

            const Tx = (e.clientX - (canvasRect.current.x + canvasRect.current.width / 2 + ctx * boxScale)) / viewportScale;
            const Ty = (e.clientY - (canvasRect.current.y + canvasRect.current.height / 2 + cty * boxScale)) / viewportScale;

            editor.current.previewLayerTransformBy(new DOMMatrix().scaleSelf(delta, delta, 1, Tx, Ty));
            editor.current.render();

            const cs = utils.getScale(editor.current.previewLayerTransform).toFixed(2);
            auxRef.current?.previewValue(cs);

            store.changed = true;
          } else {
            const delta = 1 - 0.05 * Math.sign(e.deltaY);
            const x = (e.clientX - canvasRect.current.x) / canvasRect.current.width;
            const y = (e.clientY - canvasRect.current.y) / canvasRect.current.height;
            editor.current.scaleViewportBy(delta, x, y);

            switch (mode) {
              case 0: {
                const rect = editor.current.regionRect;
                overlay.current.style.setProperty("--x1", 100 * rect.left + "%");
                overlay.current.style.setProperty("--x2", 100 * rect.right + "%");
                overlay.current.style.setProperty("--y1", 100 * rect.top + "%");
                overlay.current.style.setProperty("--y2", 100 * rect.bottom + "%");
              }
              case 1: {
                const { x: ctx, y: cty } = utils.getTranslate(editor.current.viewportTransform);
                overlay.current.style.setProperty("--translate", `${ctx.toFixed(1)}px ${cty.toFixed(1)}px`);
                break;
              }
            }
          }
        },
        onSubmit: (e, store) => {
          if (mode === 3 && store.changed) {
            editor.current.finalizeLayerPreview();
            render();

            const cs = utils.getScale(editor.current.previewLayerTransform).toFixed(2);
            auxRef.current?.setValue(cs);
          }
        }
      });

      const pointerHandlers = hooks.usePointerCapture({
        onStart: (e, store) => {
          Object.assign(store, {
            changed: false,
            startX: e.clientX,
            startY: e.clientY,
          });
          isInteracting.current = true;

          switch (mode) {
            case !!(e.buttons & 1) && 0: {
              canvasRef.current.classList.add("pointerdown");
              const boxScale = canvasRect.current.width / e.currentTarget.width;
              const startX = (e.clientX - canvasRect.current.x) / boxScale;
              const startY = (e.clientY - canvasRect.current.y) / boxScale;
              editor.current.startRegionSelect(new DOMPoint(startX, startY));
              break;
            }
            case 4: {
              const boxScale = canvasRect.current.width / e.currentTarget.width;
              const startX = (e.clientX - canvasRect.current.x) / boxScale;
              const startY = (e.clientY - canvasRect.current.y) / boxScale;
              editor.current.startDrawing(new DOMPoint(startX, startY), strokeStyle.width, strokeStyle.color);
              break;
            }
          }
        },
        onChange: (e, store) => {
          if (e.buttons & 4 || mode == null || mode == 3) {
            const dx = (e.clientX - store.startX) / canvasRect.current.width * e.currentTarget.width;
            const dy = (e.clientY - store.startY) / canvasRect.current.height * e.currentTarget.height;
            editor.current.translateViewportBy(dx, dy);

            switch (mode) {
              case 0: {
                const rect = editor.current.regionRect;
                overlay.current.style.setProperty("--x1", 100 * rect.left + "%");
                overlay.current.style.setProperty("--x2", 100 * rect.right + "%");
                overlay.current.style.setProperty("--y1", 100 * rect.top + "%");
                overlay.current.style.setProperty("--y2", 100 * rect.bottom + "%");
                break;
              }
              case 1: {
                const { x: ctx, y: cty } = utils.getTranslate(editor.current.viewportTransform);
                overlay.current.style.setProperty("--translate", `${ctx.toFixed(1)}px ${cty.toFixed(1)}px`);
                break;
              }
            }
          } else {
            store.changed = true;
            switch (mode) {
              case 0: {
                const boxScale = canvasRect.current.width / e.currentTarget.width;
                const startX = (e.clientX - canvasRect.current.x) / boxScale;
                const startY = (e.clientY - canvasRect.current.y) / boxScale;
                editor.current.regionSelect(new DOMPoint(startX, startY));

                const rect = editor.current.regionRect;
                overlay.current.style.setProperty("--x1", 100 * rect.left + "%");
                overlay.current.style.setProperty("--x2", 100 * rect.right + "%");
                overlay.current.style.setProperty("--y1", 100 * rect.top + "%");
                overlay.current.style.setProperty("--y2", 100 * rect.bottom + "%");
                break;
              }
              case 1: {
                const currentTranslate = utils.getTranslate(editor.current.viewportTransform);
                const boxScale = canvasRect.current.width / e.currentTarget.width;

                const currentX = e.clientX - (canvasRect.current.x + canvasRect.current.width / 2 + currentTranslate.x * boxScale);
                const currentY = e.clientY - (canvasRect.current.y + canvasRect.current.height / 2 + currentTranslate.y * boxScale);

                const previousX = currentX - (e.clientX - store.startX);
                const previousY = currentY - (e.clientY - store.startY);

                const dTheta = utils.atan2(
                  previousX * currentX + previousY * currentY,
                  previousX * currentY - previousY * currentX
                );

                editor.current.previewLayerTransformBy(new DOMMatrix().rotateSelf(dTheta));
                editor.current.render();

                const cr = utils.getAngle(editor.current.previewLayerTransform).toFixed(1);
                auxRef.current?.previewValue(cr);
                break;
              }
              case 2: {
                const dx = (e.clientX - store.startX) / utils.getScale(editor.current.viewportTransform);
                const dy = (e.clientY - store.startY) / utils.getScale(editor.current.viewportTransform);
                editor.current.previewLayerTransformBy(new DOMMatrix().translateSelf(dx, dy));
                editor.current.render();
                break;
              }
              case 4: {
                const boxScale = canvasRect.current.width / e.currentTarget.width;
                const startX = (e.clientX - canvasRect.current.x) / boxScale;
                const startY = (e.clientY - canvasRect.current.y) / boxScale;
                editor.current.drawLine(new DOMPoint(startX, startY));
                break;
              }
            }
          }
          Object.assign(store, {
            startX: e.clientX,
            startY: e.clientY
          });
        },
        onSubmit: (e, store) => {
          isInteracting.current = false;

          switch (mode) {
            case 0: {
              canvasRef.current.classList.remove("pointerdown");
              ["--x1", "--x2", "--y1", "--y2"].forEach(a => overlay.current.style.removeProperty(a));
              if (store.changed && editor.current.endRegionSelect()) render();

              break;
            }
            case store.changed && 1:
              const cr = utils.getAngle(editor.current.previewLayerTransform).toFixed(1);
              auxRef.current?.setValue(cr);
            // Intentional fall-through
            case store.changed && 2: {
              editor.current.finalizeLayerPreview();
              render();
              break;
            }
            case store.changed && 4: {
              editor.current.endDrawing();
              render();
              break;
            }
          }
        }
      });

      return jsx("div", {
        className: "image-editor",
        children: [
          jsx("div", {
            className: "canvas-dims",
            children: [
              jsx(Components.NumberSlider, {
                value: dims.width,
                decimals: 0,
                onChange: null,
                withSlider: false,
                minValue: 0,
                onChange: width => {
                  if (width !== editor.current.width) {
                    editor.current.width = width;
                    render();
                  }
                }
              }),
              "x",
              jsx(Components.NumberSlider, {
                value: dims.height,
                decimals: 0,
                onChange: null,
                withSlider: false,
                minValue: 0,
                onChange: height => {
                  if (height !== editor.current.width) {
                    editor.current.height = height;
                    render();
                  }
                }
              }),
            ]
          }),
          jsx("div", {
            className: "canvas-wrapper",
            children: [
              jsx("canvas", {
                className: ["canvas", ["cropping", "rotating", "moving", "scaling", "drawing"][mode]].filter(Boolean).join(" "),
                ref: canvasRef,
                onWheel: handleWheel,
                ...pointerHandlers,
              }),
              jsx("div", {
                className: "canvas-overlay",
                ref: overlay,
                children: [
                  jsx("div", { className: "cropper-region" }),
                  jsx("div", { className: "cropper-border" })
                ]
              })
            ]
          }),
          jsx("div", {
            className: "image-actions",
            children: [
              jsx(Components.IconButton, {
                tooltip: "Crop (C)",
                d: utils.paths.Crop,
                active: mode === 0,
                onClick: () => setMode(m => m === 0 ? null : 0)
              }),
              jsx(Components.IconButton, {
                tooltip: "Rotate (R)",
                d: utils.paths.Rotate,
                active: mode === 1,
                onClick: () => setMode(m => m === 1 ? null : 1)
              }),
              jsx(Components.IconButton, {
                tooltip: "Move (M)",
                d: utils.paths.Pan,
                active: mode === 2,
                onClick: () => setMode(m => m === 2 ? null : 2)
              }),
              jsx(Components.IconButton, {
                tooltip: "Scale (S)",
                d: utils.paths.Scale,
                active: mode === 3,
                onClick: () => setMode(m => m === 3 ? null : 3)
              }),
              jsx(Components.IconButton, {
                tooltip: "Draw (D)",
                d: utils.paths.Draw,
                active: mode === 4,
                onClick: () => setMode(m => m === 4 ? null : 4)
              }),
              // mode == 0 && jsx("label", {
              //   className: "aux-input",
              //   style: { gap: 8, cursor: "pointer" },
              //   children: [
              //     jsx(Components.IconButton, {
              //       tooltip: fixedAspect ? "Preserve aspect ratio" : "Free region select",
              //       d: fixedAspect ? utils.paths.Lock : utils.paths.LockOpen,
              //       onClick: () => setFixedAspect(e => !e),
              //     }),
              //   ]
              // }),
              mode == 1 && jsx("div", {
                className: "aux-input",
                children: jsx(Components.NumberSlider, {
                  ref: auxRef,
                  suffix: "°",
                  decimals: 0,
                  withSlider: false,
                  value: Number(utils.getAngle(editor.current.layerTransform).toFixed(1)),
                  onChange: value => {
                    const cr = utils.getAngle(editor.current.layerTransform);
                    const r = new DOMMatrix().rotateSelf(value - cr);
                    editor.current.previewLayerTransformBy(r);
                    editor.current.finalizeLayerPreview();
                    render();
                  }
                })
              }),
              mode == 3 && jsx("div", {
                className: "aux-input",
                children: jsx(Components.NumberSlider, {
                  ref: auxRef,
                  suffix: "x",
                  decimals: 2,
                  minValue: 0.01,
                  centerValue: 1,
                  maxValue: 10,
                  value: Number(utils.getScale(editor.current.layerTransform).toFixed(2)),
                  onSlide: s => {
                    const cs = utils.getScale(editor.current.layerTransform);
                    const S = new DOMMatrix().scaleSelf(s / cs, s / cs);
                    editor.current.previewLayerTransformTo(S);
                    editor.current.render();
                  },
                  onChange: s => {
                    const cs = utils.getScale(editor.current.layerTransform);
                    const S = new DOMMatrix().scaleSelf(s / cs, s / cs);
                    editor.current.previewLayerTransformTo(S);
                    editor.current.finalizeLayerPreview();
                    render();
                  }
                })
              }),
              mode == 4 && jsx("div", {
                className: "aux-input",
                children: [
                  jsx(BdApi.Components.ColorInput, {
                    value: strokeStyle.color,
                    colors: ["#000000", 16777215, 16771899, 16750592, 16007990, 15277667, 10233776, 2201331, 1087112, 5025616],
                    onChange: c => setStrokeStyle(s => ({ ...s, color: c }))
                  }),
                  jsx(Components.NumberSlider, {
                    ref: auxRef,
                    suffix: "px",
                    decimals: 0,
                    minValue: 1,
                    centerValue: 100,
                    maxValue: 400,
                    value: strokeStyle.width,
                    onSlide: value => {
                      const boxScale = canvasRect.current.width / canvasRef.current.width;
                      const cs = utils.getScale(editor.current.viewportTransform);
                      overlay.current.style.setProperty("--brushsize", (value * cs * boxScale).toFixed(4));
                    },
                    onChange: value => {
                      overlay.current.style.removeProperty("--brushsize");
                      setStrokeStyle(s => ({ ...s, width: value }));
                    }
                  })
                ]
              }),
              jsx(Components.IconButton, {
                tooltip: "Flip Horizontal",
                d: utils.paths.FlipH,
                onClick: () => {
                  editor.current.previewLayerTransformBy(new DOMMatrix().scaleSelf(-1, 1));
                  editor.current.finalizeLayerPreview();
                  render();
                  if (mode === 1) {
                    auxRef.current.setValue(utils.getAngle(editor.current.layerTransform).toFixed(1));
                  }
                },
              }),
              jsx(Components.IconButton, {
                tooltip: "Flip Vertical",
                d: utils.paths.FlipV,
                onClick: () => {
                  editor.current.previewLayerTransformBy(new DOMMatrix().scaleSelf(1, -1));
                  editor.current.finalizeLayerPreview();
                  render();
                  if (mode === 1) {
                    auxRef.current.setValue(utils.getAngle(editor.current.layerTransform).toFixed(1));
                  }
                },
              }),
              jsx(Components.IconButton, {
                tooltip: "Rotate Left",
                d: utils.paths.RotL,
                onClick: () => { },
              }),
              jsx(Components.IconButton, {
                tooltip: "Rotate Right",
                d: utils.paths.RotR,
                onClick: () => { },
              }),
              jsx(Components.IconButton, {
                tooltip: "Undo (Ctrl + Z)",
                d: utils.paths.Undo,
                onClick: () => { if (editor.current.undo()) render() },
                disabled: !(canUndoRedo & 2)
              }),
              jsx(Components.IconButton, {
                tooltip: "Redo (Ctrl + Y)",
                d: utils.paths.Redo,
                onClick: () => { if (editor.current.redo()) render() },
                disabled: !(canUndoRedo & 1)
              }),
            ]
          })
        ]
      })
    },

    /**
     * @param {{
     *  value: number,
     *  onChange?: (e: number) => void,
     *  withSlider?: boolean,
     *  suffix?: string,
     *  ref?: React.RefObject<any>
     *  minValue?: number,
     *  centerValue?: number
     *  maxValue?: number,
     *  decimals?: number,
     *  onSlide?: (e: number) => void,
     * }} props
     */
    NumberSlider({ value, onChange, suffix, ref, minValue, centerValue, maxValue, decimals, onSlide, withSlider = true, ...restProps }) {
      const [textValue, setTextValue] = useState(value + '');
      const [sliderValue, setSliderValue] = useState(() => {
        return utils.logScaling(value, { minValue, centerValue, maxValue });
      });
      const oldValue = useRef(value);
      const inputRef = useRef(null);
      const sliderRef = useRef(null);

      useImperativeHandle(ref, () => ({
        setValue: v => {
          setTextValue(v + '');
          oldValue.current = v;

          if (!withSlider) return;
          const val = utils.logScaling(v, { minValue, centerValue, maxValue });
          setSliderValue(val);
          sliderRef.current?._reactInternals.stateNode.setState({ value: val });
        },
        previewValue: v => {
          inputRef.current.value = v + '';
          if (!withSlider) return;
          const val = utils.logScaling(v, { minValue, centerValue, maxValue });
          sliderRef.current?._reactInternals.stateNode.setState({ value: val });
        }
      }), [minValue, centerValue, maxValue]);

      useEffect(() => {
        setTextValue(value + '');
        oldValue.current = value;

        if (!withSlider) return;
        const val = utils.logScaling(value, { minValue, centerValue, maxValue });
        setSliderValue(val);
        sliderRef.current?._reactInternals.stateNode.setState({ value: val });
      }, [value]);

      const handleChange = useCallback(e => {
        setTextValue(e.target.value)
      }, []);

      const handleTextCommit = useCallback(() => {
        const newValue = !isNaN(Number(textValue)) && textValue !== "" ? Math.max(minValue ?? Number(textValue), Number(textValue)) : oldValue.current;
        if (oldValue.current === newValue) return;

        oldValue.current = newValue
        setTextValue(oldValue.current + "");
        onChange?.(oldValue.current);

        if (!withSlider) return;
        const val = utils.logScaling(oldValue.current, { minValue, centerValue, maxValue })
        setSliderValue(val);
        sliderRef.current?._reactInternals.stateNode.setState({ value: val });
      }, [onChange, textValue]);

      const handleSliderChange = useCallback(newValue => {
        setSliderValue(newValue);

        let val = utils.expScaling(utils.clamp(0, newValue / 100, 1), { minValue, centerValue, maxValue });
        val = Number(val.toFixed(decimals ?? 0));
        onSlide?.(val);
      }, [onSlide, minValue, centerValue, maxValue]);

      const handleSliderCommit = useCallback(newValue => {
        let val = utils.expScaling(utils.clamp(0, newValue / 100, 1), { minValue, centerValue, maxValue });
        val = Number(val.toFixed(decimals ?? 0));

        setTextValue(val + '');
        oldValue.current = val;
        onChange?.(val);
      }, [onChange, setTextValue, minValue, maxValue]);

      const handleKeyDown = useCallback(e => {
        if (e.key === "Enter" || e.key === "Escape") {
          e.currentTarget.blur()
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.stopPropagation?.();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault?.();
            const delta = (e.key === 'ArrowUp' ? 1 : -1) * (decimals ? Math.pow(10, -1 * decimals) : 1);
            setTextValue(val => {
              val = (Number(val) + delta).toFixed(decimals ?? 0);
              return Math.max(Number(val), minValue ?? Number(val)) + '';
            });
          }
        }
      }, []);

      const handleWheel = useCallback(e => {
        if (document.activeElement !== e.currentTarget || !e.deltaY || e.buttons) return;
        const delta = -Math.sign(e.deltaY) * (decimals ? Math.pow(10, -1 * decimals) : 1);
        setTextValue(val => {
          val = (Number(val) + delta).toFixed(decimals ?? 0);
          return Math.max(Number(val), minValue ?? Number(val)) + '';
        });
      }, []);

      const handleBeforeInput = useCallback(e => {
        if (e.data && /[^0-9e\+\-.]+/.test(e.data)) e.preventDefault?.();
      }, []);

      const handleMouseEnter = useCallback(e => !e.buttons && e.currentTarget.focus(), []);
      const handleMouseLeave = useCallback(e => e.currentTarget.blur(), []);

      return jsx("div", {
        ...restProps,
        className: "number-input-wrapper",
        children: [
          withSlider && jsx("span", {
            children: internals.keys.MenuSliderControl && jsx(internals.nativeUI[internals.keys.MenuSliderControl], {
              ref: sliderRef,
              mini: true,
              className: internals.sliderClass?.slider,
              initialValue: sliderValue,
              onValueRender: (newValue) => {
                const x = utils.clamp(0, newValue / 100, 1);
                const val = utils.expScaling(x, { minValue, centerValue, maxValue })
                return Number(val.toFixed(decimals ?? 0)) + (suffix ?? '');
              },
              onValueChange: handleSliderCommit,
              asValueChanges: handleSliderChange,
            }),
          }),
          jsx("input", {
            className: "number-input",
            value: textValue,
            ref: inputRef,
            onBlur: handleTextCommit,
            onKeyDown: handleKeyDown,
            onChange: handleChange,
            onBeforeInput: handleBeforeInput,
            onWheel: handleWheel,
            onMouseEnter: handleMouseEnter,
            onMouseLeave: handleMouseLeave
          }),
          suffix != null && jsx("span", { style: { alignContent: 'center' } }, suffix)
        ]
      })
    },
  }

  function generateCSS() {
    DOM.addStyle(meta.slug, `@scope (.${meta.slug}Root){
:scope {
  min-height: unset;
  max-height: unset;
  width: clamp(800px, 80vw, 1100px);
  height: clamp(440px, 80vh, 900px);
  margin-block: auto;
}

.image-editor {
  height: 100%;
  display: grid;
  grid-template-rows: auto 1fr auto;
}

.canvas-dims {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 4px;
  padding-bottom: 4px;
  margin-bottom: 8px;
  color: var(--interactive-active);
  border-bottom: 1px solid var(--border-normal);
  & .number-input {
    text-align: center;
  }
}

.canvas-wrapper {
  height: 100%;
  overflow: hidden;
  position: relative;
  display: grid;
  place-items: center;
  position: relative;
  color: var(--interactive-active);
}

.canvas {
  max-width: 100%;
  max-height: 100%;
  border-radius: 8px;
  display: block;
  anchor-name: --canvas;
  overflow: hidden;
  touch-action: none;
  background: repeating-conic-gradient(#666 0 25%, #999 0 50%) 0 0 / 20px 20px fixed content-box;
}                   

.canvas.cropping {
  cursor: crosshair;
}

.canvas.rotating {
  cursor: grab;
  &:active {
    cursor: grabbing;
  }
}

.canvas.moving {
  cursor: move;
}

.canvas.drawing {
  cursor: crosshair;
}

@keyframes pulsing {
  from {opacity: 0}
  to {opacity: 0.8}
}

.canvas.rotating + .canvas-overlay::after {
  content: "";
  position: absolute;
  inset: 0;
  margin: auto;
  translate: var(--translate, 0px) 0px;
  border-radius: 100vmax;
  width: 15px;
  aspect-ratio: 1;
  --c: linear-gradient(#000 0 0) 50%;
  background:
    var(--c) / 58% 5% space no-repeat,
    var(--c) / 5% 58% no-repeat space,
    white;
  outline: 1px solid black;
  outline-offset: -2px;
  animation: pulsing 1s infinite alternate ease-out;
}

.canvas-overlay {
  position: absolute;
  pointer-events: none;
  overflow: hidden;
  inset: anchor(--canvas inside)
}

.canvas.cropping.pointerdown + .canvas-overlay > .cropper-region {
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.7);
  clip-path: polygon(
    0% 0%, 100% 0%, 100% 100%, 0 100%,
    var(--x1, 0%) var(--y2, 100%), var(--x2, 100%) var(--y2, 100%), var(--x2, 100%) var(--y1, 0%), var(--x1, 0%) var(--y1, 0%),
    var(--x1, 0%) var(--y2, 100%), 0 100%
  );
}

.canvas.cropping.pointerdown + .canvas-overlay > .cropper-border {
  position: absolute;
  outline: 1px dashed currentColor;
  outline-offset: -1px;
  left: var(--x1, 0%);
  right: calc(100% - var(--x2, 0%));
  top: var(--y1, 0%);
  bottom: calc(100% - var(--y2, 0%));
}

.canvas.drawing + .canvas-overlay > .cropper-border {
  position: absolute;
  inset: 0;
  margin: auto;
  opacity: calc(var(--brushsize, 0) / var(--brushsize, 1));
  width: calc(1px * var(--brushsize, 0) - 1px);
  aspect-ratio: 1 / 1;
  border: 1px solid black;
  outline: 1px dashed white;
  outline-offset: -1px;
  border-radius: 100vmax;
}

.image-actions {
  display: flex;
  border-top: 1px solid var(--border-normal);
  margin-top: 8px;
  padding-top: 4px;
  min-height: 42px;
  align-items: end;
}

.image-actions > :nth-last-child(6 of div) {
  margin-left: auto;
}

.image-actions > :nth-last-child(2 of div) {
  margin-left: 12px;
}

.image-actions > .active {
  background-color: var(--background-modifier-active);
  color: var(--interactive-active);
  padding-bottom: 3px;
  padding-top: 5px;
}

.image-actions .disabled {
  opacity: 0.5;
  cursor: default;
  color: var(--interactive-normal);
  background: none;
  padding: 4px;
}

.aux-input {
  padding-inline: 0.5rem;
  flex: 1;
  display: flex;
  flex-wrap: nowrap;
  justify-content: center;
  align-items: center;
  gap: 8px;
  color: var(--interactive-active);
}

.number-input-wrapper {
  display: flex;
  flex-wrap: nowrap;
}

.number-input-wrapper > :has(+ .number-input) {
  margin-right: 8px;
  margin-top: 0.5rem;
  width: 100px;
}

.number-input {
  border: 1px solid var(--border-normal);
  border-radius: 6px;
  padding: 4px;
  margin: 2px;
  background: var(--background-modifier-active);
  color: currentColor;
  width: 2.75em;
  text-align: right;
}

.bd-color-picker-container {
  margin-bottom: -3px;
}

.bd-color-picker {
  display: block;
  height: 2.25rem;
}

.bd-color-picker-swatch {
  max-width: 105px;
}

.bd-color-picker-swatch-item {
  margin: 3px;
}

}`);
  }

  return { start, stop };
}
