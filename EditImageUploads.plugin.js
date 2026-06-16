/**
 * @name EditImageUploads
 * @author Narukami
 * @description Adds an option to edit images before sending.
 * @version 0.2.0
 * @source https://github.com/Naru-kami/EditImageUploads
 */

module.exports = (meta) => {
  /** @type {{React: typeof import("react")}} */
  const { React, Patcher, Webpack, Webpack: { Filters }, DOM, UI, ContextMenu, Data } = BdApi;

  const {
    createElement: jsx, useState, useEffect, useLayoutEffect, useRef,
    useImperativeHandle, useCallback, Fragment, useTransition, useId,
  } = React;

  var internals, ctrl;

  function init() {
    if (internals) return;

    internals = Webpack.getBulkKeyed({
      ModalSystem: { firstId: 935462, filter: Filters.byStrings(".MODAL_ROOT_LEGACY,"), searchExports: true },
      ManaButton: { firstId: 657718, filter: Filters.byStrings(".BUTTON_LOADING_STARTED_LABEL,"), searchExports: true },

      openModal: { firstId: 192308, filter: Filters.byStrings('"stack":"replace"'), searchExports: true },
      closeModal: { firstId: 192308, filter: Filters.byStrings(".onCloseCallback(),"), searchExports: true },
      closeModalInAllContexts: { firstId: 192308, filter: Filters.byStrings("onCloseCallback?.()}"), searchExports: true },
      FocusRing: { firstId: 187322, filter: Filters.byStrings("FocusRing was given a focusTarget"), searchExports: true },
      MenuSliderControl: { firstId: 106236, filter: Filters.byStrings("moveGrabber"), searchExports: true },

      actionButtonClass: { firstId: 874280, filter: Filters.byKeys("dangerous", "button") },
      actionIconClass: { firstId: 389116, filter: m => m.actionBarIcon && !m.action },
      contextMenuClass: { firstId: 32271, filter: Filters.byKeys("switchContainer") },
      scrollbarClass: { firstId: 457845, filter: m => m.thin && !m.none },
      sliderClass: { firstId: 598286, filter: m => m.sliderContainer && m.slider && !m.infoContainer },
    });

    Object.assign(internals, {
      uploadDispatcher: Webpack.getByKeys("setFile", { firstId: 608299 }),
      SelectedChannelStore: Webpack.getStore("SelectedChannelStore"),
      urlConverter: Webpack.getMangled(Filters.bySource(".searchParams.delete(\"width\"),"), {
        isConvertable: Filters.byStrings("canSaveImage"),
        toMediaUrl: Filters.byStrings("if(null!="),
        toCdnUrl: Filters.byStrings("searchParams"),
      }, { firstId: 803316 }),
      ModalSystem: Webpack.getMangled(Filters.bySource(".MODAL_ROOT_LEGACY,"), {
        ModalRoot: Filters.byStrings(".MODAL_ROOT_LEGACY,"),
        ModalContent: Filters.byStrings(",scrollbarType:"),
        ModalFooter: Filters.byStrings(".HORIZONTAL_REVERSE,"),
      }, { firstId: 935462 }),
    });
    BdApi.Logger.info(meta.slug, "Initialized");

    if (Data.load(meta.slug, "version") !== meta.version) {
      UI.showChangelogModal({
        title: meta.name,
        subtitle: meta.version,
        changes: [{
          title: "Added",
          type: "added",
          items: [
            "Export Quality:\n\nAdded an option to change the export quality under the modal settings. Can only applies to lossy compression types (jpg, webp). This can be helpful to reduce the final image size.\n\nValue can range from 0 (maximum compression) to 1 (maximum quality). Defaults to 1."
          ]
        }]
      });
      Data.save(meta.slug, "version", meta.version);
    }
  }

  function start() {
    init();

    if (!["ModalRoot", "ModalContent", "ModalFooter"].every(key => key in internals.ModalSystem) || !("openModal" in internals)) return;

    const [uploadCard, uploadCardkey] = Webpack.getWithKey(Filters.byStrings(".attachmentItemSmall]:"), { firstId: 914905 });
    uploadCardkey && Patcher.after(meta.slug, uploadCard, uploadCardkey, (_, [args], ret) => {
      if (
        args?.upload?.mimeType?.startsWith("image/") && !args?.upload?.mimeType?.endsWith("gif") &&
        !ret?.props?.actions?.props?.children?.some(e => e?.key === meta.slug)
      ) {
        ret.props.actions.props.children.splice(0, 0, jsx(Components.ErrorBoundary, {
          key: meta.slug,
          children: jsx(Components.UploadIcon, { args })
        }))
      }
    });

    ctrl = new AbortController()
    Webpack.waitForModule(Filters.bySource('FOCUS_SENSITIVE="FOCUS_SENSITIVE"'), {
      firstId: 358731, signal: ctrl.signal
    }).then(m => {
      if (!m) return;

      const key = Object.keys(m).find(k => m[k]?.type?.toString().includes('FOCUS_SENSITIVE'));
      key && Patcher.after(meta.slug, m[key], "type", (_, [props], res) => {
        if (props.mode !== "FOCUS_SENSITIVE") return;

        const item = res.props.children.find(child => child.type === Fragment)?.props.children[0].props.item;
        if (item?.type !== "IMAGE" || item?.srcIsAnimated || item?.animated) return res;

        try {
          const convertable = internals.urlConverter.isConvertable(item.original ?? item.url)
          const mediaUrl = convertable ? internals.urlConverter.toMediaUrl(item.original, item.url) : item.url;
          const url = internals.urlConverter.toCdnUrl(mediaUrl, item.contentType, item.originalContentType);
          url && res.props.children.unshift(jsx(Components.ErrorBoundary, {
            key: meta.slug,
            children: jsx(Components.RemixIcon, { url })
          }))
        } catch { }

        return res;
      })
    });

    Webpack.waitForModule(Filters.byStrings("renderLeading:", ",onChange:"), {
      firstId: 843282, signal: ctrl.signal, searchExports: true
    }).then(f => {
      internals.SingleSelect = f
    });

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
    #viewportTransform_inv;
    #staleViewportInv;

    #state;
    #activeLayerIndex;

    #bottomCache;
    #middleCache;
    #topCache;

    #interactionCache;
    /** @type {"medium" | "low" | "high" | "off" | "auto"} */
    #imageSmoothing;

    /** @param {HTMLCanvasElement} canvas @param {ImageBitmap} bitmap */
    constructor(canvas, bitmap) {
      this.#mainCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      this.#bottomCache = new OffscreenCanvas(bitmap.width, bitmap.height);
      this.#middleCache = new OffscreenCanvas(bitmap.width, bitmap.height);
      this.#topCache = new OffscreenCanvas(bitmap.width, bitmap.height);
      this.#viewportCanvas = canvas;

      /** @type {string} */
      this.backgroundColor = Data.load(meta.slug, "backgroundColor") ?? "#393946";
      const initialScale = Math.min(canvas.width / bitmap.width * 0.96, canvas.height / bitmap.height * 0.96);
      this.#viewportTransform = new DOMMatrix().scaleSelf(initialScale, initialScale);
      this.#viewportTransform_inv = new DOMMatrix()
        .translateSelf(this.#viewportCanvas.width / 2, this.#viewportCanvas.height / 2)
        .multiplySelf(this.#viewportTransform)
        .translateSelf(-this.#mainCanvas.width / 2, -this.#mainCanvas.height / 2)
        .invertSelf();
      this.#staleViewportInv = false;

      [this.#mainCanvas, this.#bottomCache, this.#middleCache, this.#topCache].forEach(canv => {
        canv.getContext("2d").imageSmoothingEnabled = false;
      })
      this.setImageSmoothing(Data.load(meta.slug, "smoothing") ?? "auto");

      const layer = new Layer("Main", bitmap);
      this.#state = new utils.StateHistory({
        width: bitmap.width,
        height: bitmap.height,
        layers: [{ layer, state: layer.state }]
      });
      this.#activeLayerIndex = 0;
      this.fullRender();

      this.#interactionCache = {
        layerTransform_inv: new DOMMatrix(),
        path2D: new Path2D(),
        lastPoint: new DOMPoint(NaN, NaN),
        lastMidPoint: new DOMPoint(NaN, NaN),
        /** @type {DOMRect | null} */
        rect: null,
        /** @type {DOMRect | null} */
        clipRect: null,
        width: 0,
        color: "#000",
        globalCompositeOperation: "source-over",
        text: "",
        font: "1rem sans-serif"
      };
    }

    get layers() { return this.#state.state.layers }
    get #activeLayer() { return this.layers[this.activeLayerIndex].layer }
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
    get lastPoint() {
      return Number.isNaN(this.#interactionCache.lastPoint.x) || Number.isNaN(this.#interactionCache.lastPoint.y) ? null : this.#interactionCache.lastPoint.matrixTransform(this.viewportTransform_inv.inverse());
    }
    get regionRect() {
      if (!this.#interactionCache.rect) return null;

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
    get clipRect() {
      if (!this.#interactionCache.clipRect) return null;

      const T = this.viewportTransform_inv.inverse();
      const topLeft = new DOMPoint(this.#interactionCache.clipRect.left, this.#interactionCache.clipRect.top).matrixTransform(T);
      const bottomRight = new DOMPoint(this.#interactionCache.clipRect.right, this.#interactionCache.clipRect.bottom).matrixTransform(T);
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

    get viewportDims() { return { width: this.#viewportCanvas.width, height: this.#viewportCanvas.height } }
    set viewportDims(dims) {
      this.#staleViewportInv = true;
      this.#viewportCanvas.width = dims.width;
      this.#viewportCanvas.height = dims.height;
    }

    get canvasDims() { return { width: this.#mainCanvas.width, height: this.#mainCanvas.height } }
    set canvasDims(dims) {
      this.#resizeCanvas(dims.width, dims.height);
      this.#state.state = { ...this.#state.state, width: dims.width, height: dims.height };
    }

    get activeLayerIndex() { return this.#activeLayerIndex }
    set activeLayerIndex(layerIndex) {
      this.#activeLayerIndex = utils.clamp(0, layerIndex, this.layers.length - 1);
      this.sandwichLayer();
    }

    sandwichLayer(layerIndex = this.#activeLayerIndex) {
      if (!(layerIndex in this.layers)) return;

      this.#bottomCache.getContext("2d").clearRect(0, 0, this.#bottomCache.width, this.#bottomCache.height);
      this.#topCache.getContext("2d").clearRect(0, 0, this.#topCache.width, this.#topCache.height);

      this.layers.slice(0, layerIndex).forEach(layer => { layer.layer.drawOn(this.#bottomCache) });
      this.layers.slice(layerIndex + 1).forEach(layer => { layer.layer.drawOn(this.#topCache) });
    }

    /** @param {ImageBitmap | null} bitmap */
    createNewLayer(bitmap) {
      const newLayer = new Layer(
        `Layer ${(this.layers.length)}`,
        bitmap instanceof ImageBitmap ? bitmap : { width: 2 - (this.#activeLayer.width & 1), height: 2 - (this.#activeLayer.height & 1) }
      );
      this.#state.state = {
        ...this.#state.state,
        layers: [
          ...this.#state.state.layers,
          { layer: newLayer, state: newLayer.state }
        ]
      };
      this.activeLayerIndex = this.layers.length - 1;
      this.render();
    }

    deleteLayer(layerIndex = this.activeLayerIndex) {
      if (layerIndex in this.layers && this.layers.length > 1) {
        const updated = { ...this.#state.state, layers: [...this.#state.state.layers] };
        updated.layers.splice(layerIndex, 1);
        this.#state.state = updated;
        this.activeLayerIndex = Math.min(this.activeLayerIndex, updated.layers.length - 1);
        this.render();
      }
    }

    /** @param {number} layerIndex */
    toggleLayerVisibility(layerIndex) {
      if (!(layerIndex in this.layers)) return;

      const isVisible = !this.layers[layerIndex].state.isVisible;
      const updated = { ...this.#state.state, layers: [...this.#state.state.layers] };
      updated.layers[layerIndex] = { ...updated.layers[layerIndex], state: { ...updated.layers[layerIndex].state, isVisible } };
      this.#state.state = updated;
      this.layers[layerIndex].layer.state = this.layers[layerIndex].state;

      this.fullRender();
    }

    /** 
     * @typedef {Partial<{
     *  blur: number, brightness: number, contrast: number, grayscale: number,
     * ["hue-rotate"]: number, invert: number, saturate: number, sepia: number
     * }>} LayerAdjustments
     * 
     * @param {(current: LayerAdjustments) => LayerAdjustments} setter
     * @param {number} layerIndex
     * @param {boolean} shouldPushToStack 
     */
    setLayerAdjustment(layerIndex, setter, shouldPushToStack) {
      const adjustments = setter(this.layers[layerIndex].state.adjustments);
      const updated = { ...this.#state.state, layers: [...this.#state.state.layers] };
      updated.layers[layerIndex] = { ...updated.layers[layerIndex], state: { ...updated.layers[layerIndex].state, adjustments } };
      if (shouldPushToStack) {
        this.#state.state = updated;
      }
      updated.layers[layerIndex].layer.state = updated.layers[layerIndex].state;

      this.render(layerIndex);
    }

    /** @param {number} layerIndex */
    resetLayerTransform(layerIndex) {
      if (!(layerIndex in this.layers)) return;

      const updated = { ...this.#state.state, layers: [...this.#state.state.layers] };
      updated.layers[layerIndex] = { ...updated.layers[layerIndex], state: { ...updated.layers[layerIndex].state, transform: new DOMMatrix() } };
      this.#state.state = updated;
      this.layers[layerIndex].layer.state = this.layers[layerIndex].state;

      this.render(layerIndex);
    }

    /** @param {number} layerIndex */
    async copyLayerContents(layerIndex) {
      if (!(layerIndex in this.layers)) return;

      const ctx = this.#middleCache.getContext("2d");
      ctx.clearRect(0, 0, this.#middleCache.width, this.#middleCache.height);
      this.layers[layerIndex].layer.drawOn(this.#middleCache);
      const blob = await this.#middleCache.convertToBlob({ type: 'image/png' });
      ctx.clearRect(0, 0, this.#middleCache.width, this.#middleCache.height);
      return blob;
    }

    async duplicateLayer(layerIndex = this.#activeLayerIndex) {
      if (!(layerIndex in this.layers)) return;

      const targetLayer = this.layers[layerIndex].layer;
      const bitmap = await targetLayer.toBitmap();
      const newLayer = new Layer(targetLayer.name, bitmap);
      newLayer.state = { ...targetLayer.state, strokes: [] };

      this.#state.state = {
        ...this.#state.state,
        layers: [
          ...this.#state.state.layers,
          { layer: newLayer, state: newLayer.state }
        ]
      };
      this.activeLayerIndex = this.layers.length - 1;
      this.render();
    }

    /** @param {number} delta */
    moveLayers(delta, layerIndex = this.activeLayerIndex) {
      if (!((layerIndex + delta) in this.layers) || !(layerIndex in this.layers) || delta === 0) return;

      const activeLayer = this.#activeLayer;

      const updated = { ...this.#state.state, layers: [...this.#state.state.layers] };
      updated.layers.splice(layerIndex + delta, 0, updated.layers.splice(layerIndex, 1)[0]);
      this.#state.state = updated;

      this.activeLayerIndex = this.#state.state.layers.findIndex(layer => layer.layer === activeLayer);
      this.render();
    }

    /** @param {string} smoothing */
    setImageSmoothing(smoothing) {
      const ctx = this.#viewportCanvas.getContext("2d");

      switch (smoothing) {
        case "auto": {
          this.#autoSmooth();
          break;
        }
        case "off": {
          ctx.imageSmoothingEnabled = false;
          break;
        }
        case "low":
        case "medium":
        case "high": {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = smoothing;
          break;
        }
        default: throw new Error("Unsupported image smoothing quality.");
      }
      this.#imageSmoothing = smoothing;
    }

    #autoSmooth() {
      const scale = utils.getScale(this.#viewportTransform);
      const ctx = this.#viewportCanvas.getContext("2d");

      switch (true) {
        case scale > 2: {
          ctx.imageSmoothingEnabled = false;
          break;
        }
        case scale > 1 / 2: {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "low";
          break;
        }
        case scale > 1 / 8: {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "medium";
          break;
        }
        default: {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          break;
        }
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
      this.#imageSmoothing === "auto" && this.#autoSmooth();
      this.refreshViewport();
      this.#staleViewportInv = true;
    }

    resetViewport() {
      const scale = Math.min(this.#viewportCanvas.width / this.#mainCanvas.width * 0.96, this.#viewportCanvas.height / this.#mainCanvas.height * 0.96);
      this.#viewportTransform = new DOMMatrix().scaleSelf(scale, scale);
      this.#imageSmoothing === "auto" && this.#autoSmooth();
      this.#staleViewportInv = true;
    }

    refreshViewport() {
      const ctx = this.#viewportCanvas.getContext("2d");

      ctx.fillStyle = this.backgroundColor;
      ctx.fillRect(0, 0, this.#viewportCanvas.width, this.#viewportCanvas.height);
      ctx.setTransform(new DOMMatrix().translateSelf(this.#viewportCanvas.width / 2, this.#viewportCanvas.height / 2).multiplySelf(this.#viewportTransform));

      ctx.clearRect(-this.#mainCanvas.width / 2, -this.#mainCanvas.height / 2, this.#mainCanvas.width, this.#mainCanvas.height);
      ctx.drawImage(this.#mainCanvas, -this.#mainCanvas.width / 2, -this.#mainCanvas.height / 2);

      ctx.resetTransform();
    }

    /** @param {DOMMatrix} M */
    previewLayerTransformBy(M) {
      this.#activeLayer.previewTransformBy(M);
      this.render();
    }
    /** @param {DOMMatrix} M  */
    previewLayerTransformTo(M) {
      this.#activeLayer.previewTransformTo(M);
      this.render();
    }
    finalizeLayerPreview() {
      const layerState = this.#activeLayer.finalizePreview();
      if (!layerState) return;

      const updated = { ...this.#state.state, layers: [...this.#state.state.layers] };
      updated.layers[this.activeLayerIndex] = { ...updated.layers[this.activeLayerIndex], state: layerState };
      this.#state.state = updated;
    }

    #prepareMiddleCanvas() {
      const adjustments = { ...this.#activeLayer.state.adjustments };
      this.setLayerAdjustment(this.#activeLayerIndex, () => ({}));
      this.#activeLayer.drawOn(this.#middleCache);
      this.setLayerAdjustment(this.#activeLayerIndex, () => adjustments);
    }

    /** @param {DOMPoint} startPoint @param {number} width @param {string} color */
    startDrawing(startPoint, width, color, globalCompositeOperation = "source-over") {
      const ctx = this.#middleCache.getContext("2d");
      ctx.clearRect(0, 0, this.#middleCache.width, this.#middleCache.height);
      this.#prepareMiddleCanvas();
      ctx.save();
      ctx.beginPath();

      this.#interactionCache.width = width;
      this.#interactionCache.color = color;
      this.#interactionCache.globalCompositeOperation = globalCompositeOperation;

      ctx.globalCompositeOperation = globalCompositeOperation;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      this.#interactionCache.path2D = new Path2D();
      this.#interactionCache.lastPoint = startPoint.matrixTransform(this.viewportTransform_inv);
      this.#interactionCache.lastMidPoint = startPoint.matrixTransform(this.viewportTransform_inv);

      const availRect = this.#interactionCache.clipRect ?? new DOMRect(0, 0, this.#mainCanvas.width, this.#mainCanvas.height);
      const clipPath = new Path2D();
      clipPath.rect(availRect.x, availRect.y, availRect.width, availRect.height);
      ctx.clip(clipPath);

      const isOOB = !utils.pointInRect(this.#interactionCache.lastPoint, availRect, Math.ceil(width / 2));

      this.#interactionCache.layerTransform_inv = new DOMMatrix()
        .translateSelf(
          this.#mainCanvas.width / 2 - ((this.#mainCanvas.width - this.#activeLayer.width) & 1) / 2,
          this.#mainCanvas.height / 2 - ((this.#mainCanvas.height - this.#activeLayer.height) & 1) / 2
        ).multiplySelf(this.layerTransform).invertSelf();

      if (isOOB) {
        this.#interactionCache.rect = new DOMRect();
        return;
      }

      const rawPoint = this.#interactionCache.lastPoint.matrixTransform(this.#interactionCache.layerTransform_inv);
      this.#interactionCache.rect = new DOMRect(rawPoint.x, rawPoint.y);

      if (this.#activeLayer.state.isVisible) {
        ctx.beginPath();
        ctx.arc(this.#interactionCache.lastPoint.x, this.#interactionCache.lastPoint.y, width / 2, 0, 2 * Math.PI);
        ctx.fill();

        const p1 = new DOMPoint(
          Math.floor(this.#interactionCache.lastPoint.x - this.#interactionCache.width / 2),
          Math.floor(this.#interactionCache.lastPoint.y - this.#interactionCache.width / 2)
        );
        const p2 = new DOMPoint(
          Math.ceil(this.#interactionCache.lastPoint.x + this.#interactionCache.width / 2),
          Math.ceil(this.#interactionCache.lastPoint.y + this.#interactionCache.width / 2)
        )

        const mainCtx = this.#mainCanvas.getContext("2d");
        mainCtx.clearRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
        this.#activeLayerIndex > 0 && mainCtx.drawImage(this.#bottomCache, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);

        mainCtx.filter = this.#activeLayer.filter;
        mainCtx.drawImage(this.#middleCache, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
        mainCtx.filter = "none";

        this.#activeLayerIndex < this.layers.length - 1 && mainCtx.drawImage(this.#topCache, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);

        this.refreshViewport();
      }

      this.#interactionCache.path2D.moveTo(this.#interactionCache.lastPoint.x, this.#interactionCache.lastPoint.y);
      this.#interactionCache.path2D.lineTo(this.#interactionCache.lastPoint.x, this.#interactionCache.lastPoint.y);
      this.#interactionCache.path2D.moveTo(this.#interactionCache.lastPoint.x, this.#interactionCache.lastPoint.y);
    }

    /** @param {DOMPoint} point */
    curveTo(point) {
      const ctx = this.#middleCache.getContext("2d");
      const to_inv = point.matrixTransform(this.viewportTransform_inv);

      const availRect = this.#interactionCache.clipRect ?? new DOMRect(0, 0, this.#mainCanvas.width, this.#mainCanvas.height);
      // out of bounds
      const isOOB = !utils.pointInRect(to_inv, availRect, Math.ceil(this.#interactionCache.width / 2));
      const prevIsOOB = !utils.pointInRect(this.#interactionCache.lastPoint, availRect, Math.ceil(this.#interactionCache.width / 2));

      const intersections = utils.lineRect(this.#interactionCache.lastPoint, to_inv, availRect, Math.ceil(this.#interactionCache.width / 2));

      if (isOOB && prevIsOOB && !intersections.length) {
        this.#interactionCache.lastPoint = to_inv;
        this.#interactionCache.lastMidPoint = to_inv;
        return;
      }

      const [clampedFrom, clampedTo] = utils.clampLineToRect(this.#interactionCache.lastPoint, to_inv, availRect, Math.ceil(this.#interactionCache.width / 2));
      const midpoint = new DOMPoint((clampedTo.x + clampedFrom.x) / 2, (clampedTo.y + clampedFrom.y) / 2);

      if (isOOB && !prevIsOOB) {
        clampedFrom.x = midpoint.x;
        clampedFrom.y = midpoint.y;
        midpoint.x = clampedTo.x;
        midpoint.y = clampedTo.y;
      }

      if (this.#activeLayer.state.isVisible) {
        ctx.beginPath();
        ctx.moveTo(this.#interactionCache.lastMidPoint.x, this.#interactionCache.lastMidPoint.y);
        ctx.quadraticCurveTo(clampedFrom.x, clampedFrom.y, midpoint.x, midpoint.y);
        ctx.stroke();

        const p1 = new DOMPoint(
          Math.floor(Math.min(this.#interactionCache.lastMidPoint.x, clampedFrom.x, midpoint.x) - this.#interactionCache.width / 2),
          Math.floor(Math.min(this.#interactionCache.lastMidPoint.y, clampedFrom.y, midpoint.y) - this.#interactionCache.width / 2)
        )
        const p2 = new DOMPoint(
          Math.ceil(Math.max(this.#interactionCache.lastMidPoint.x, clampedFrom.x, midpoint.x) + this.#interactionCache.width / 2),
          Math.ceil(Math.max(this.#interactionCache.lastMidPoint.y, clampedFrom.y, midpoint.y) + this.#interactionCache.width / 2)
        )

        const mainCtx = this.#mainCanvas.getContext("2d");
        mainCtx.clearRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
        this.#activeLayerIndex > 0 && mainCtx.drawImage(this.#bottomCache, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
        mainCtx.filter = this.#activeLayer.filter;
        mainCtx.drawImage(this.#middleCache, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
        mainCtx.filter = "none";
        this.#activeLayerIndex < this.layers.length - 1 && mainCtx.drawImage(this.#topCache, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);

        this.refreshViewport();
      }

      prevIsOOB && this.#interactionCache.path2D.moveTo(this.#interactionCache.lastMidPoint.x, this.#interactionCache.lastMidPoint.y);
      this.#interactionCache.path2D.quadraticCurveTo(clampedFrom.x, clampedFrom.y, midpoint.x, midpoint.y);

      const rawMidpoint = midpoint.matrixTransform(this.#interactionCache.layerTransform_inv);
      this.#interactionCache.rect.width += Math.max(this.#interactionCache.rect.left - rawMidpoint.x, rawMidpoint.x - this.#interactionCache.rect.right, 0);
      this.#interactionCache.rect.height += Math.max(this.#interactionCache.rect.top - rawMidpoint.y, rawMidpoint.y - this.#interactionCache.rect.bottom, 0);
      this.#interactionCache.rect.x = Math.min(rawMidpoint.x, this.#interactionCache.rect.left);
      this.#interactionCache.rect.y = Math.min(rawMidpoint.y, this.#interactionCache.rect.top);

      this.#interactionCache.lastPoint = to_inv;
      this.#interactionCache.lastMidPoint = midpoint;
    }

    /** @param {DOMPoint} point */
    lineTo(point) {
      const ctx = this.#middleCache.getContext("2d");
      const to_inv = point.matrixTransform(this.viewportTransform_inv);

      const availRect = this.#interactionCache.clipRect ?? new DOMRect(0, 0, this.#mainCanvas.width, this.#mainCanvas.height);
      // out of bounds
      const isOOB = !utils.pointInRect(to_inv, availRect, Math.ceil(this.#interactionCache.width / 2));
      const prevIsOOB = !utils.pointInRect(this.#interactionCache.lastPoint, availRect, Math.ceil(this.#interactionCache.width / 2));

      const intersections = utils.lineRect(this.#interactionCache.lastPoint, to_inv, availRect, Math.ceil(this.#interactionCache.width / 2));

      if (isOOB && prevIsOOB && !intersections.length) {
        this.#interactionCache.lastPoint = to_inv;
        return;
      }

      const [clampedFrom, clampedTo] = utils.clampLineToRect(this.#interactionCache.lastPoint, to_inv, availRect, Math.ceil(this.#interactionCache.width / 2));

      if (this.#activeLayer.state.isVisible) {
        ctx.beginPath();
        ctx.moveTo(clampedFrom.x, clampedFrom.y);
        ctx.lineTo(clampedTo.x, clampedTo.y);
        ctx.stroke();

        const p1 = new DOMPoint(
          Math.floor(Math.min(clampedFrom.x, clampedTo.x) - this.#interactionCache.width / 2),
          Math.floor(Math.min(clampedFrom.y, clampedTo.y) - this.#interactionCache.width / 2)
        );
        const p2 = new DOMPoint(
          Math.ceil(Math.max(clampedFrom.x, clampedTo.x) + this.#interactionCache.width / 2),
          Math.ceil(Math.max(clampedFrom.y, clampedTo.y) + this.#interactionCache.width / 2)
        )

        const mainCtx = this.#mainCanvas.getContext("2d");
        mainCtx.clearRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
        this.#activeLayerIndex > 0 && mainCtx.drawImage(this.#bottomCache, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
        mainCtx.filter = this.#activeLayer.filter;
        mainCtx.drawImage(this.#middleCache, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
        mainCtx.filter = "none";
        this.#activeLayerIndex < this.layers.length - 1 && mainCtx.drawImage(this.#topCache, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);

        this.refreshViewport();
      }

      prevIsOOB && this.#interactionCache.path2D.moveTo(clampedFrom.x, clampedFrom.y);
      this.#interactionCache.path2D.lineTo(clampedTo.x, clampedTo.y);

      const rawClampedTo = clampedTo.matrixTransform(this.#interactionCache.layerTransform_inv);
      this.#interactionCache.rect.width += Math.max(this.#interactionCache.rect.left - rawClampedTo.x, rawClampedTo.x - this.#interactionCache.rect.right, 0);
      this.#interactionCache.rect.height += Math.max(this.#interactionCache.rect.top - rawClampedTo.y, rawClampedTo.y - this.#interactionCache.rect.bottom, 0);
      this.#interactionCache.rect.x = Math.min(rawClampedTo.x, this.#interactionCache.rect.left);
      this.#interactionCache.rect.y = Math.min(rawClampedTo.y, this.#interactionCache.rect.top);

      this.#interactionCache.lastPoint = to_inv;
    }

    endDrawing() {
      const availRect = this.#interactionCache.clipRect ?? new DOMRect(0, 0, this.#mainCanvas.width, this.#mainCanvas.height);
      const clipPath = new Path2D();
      clipPath.rect(availRect.x, availRect.y, availRect.width, availRect.height);

      this.#activeLayer.resizeFitStroke(this.#interactionCache.rect, this.#interactionCache.width);
      this.#interactionCache.rect = null;
      const layerState = this.#activeLayer.addStroke({
        color: this.#interactionCache.color,
        width: this.#interactionCache.width,
        path2D: this.#interactionCache.path2D,
        globalCompositeOperation: this.#interactionCache.globalCompositeOperation,
        clipPath,
        transform: this.#interactionCache.layerTransform_inv
      });

      const updated = { ...this.#state.state, layers: [...this.#state.state.layers] };
      updated.layers[this.activeLayerIndex] = { ...updated.layers[this.activeLayerIndex], state: layerState };
      this.#state.state = updated;

      const middleCtx = this.#middleCache.getContext("2d");
      middleCtx.restore();
      middleCtx.clearRect(0, 0, this.#middleCache.width, this.#middleCache.height);
      this.render();
    }

    /** @param {DOMPoint} startPoint */
    startRegionSelect(startPoint, fixedAspect = false) {
      const start_T = startPoint.matrixTransform(this.viewportTransform_inv);
      start_T.x = Math.round(utils.clamp(0, start_T.x, this.#mainCanvas.width));
      start_T.y = Math.round(utils.clamp(0, start_T.y, this.#mainCanvas.height));
      this.#interactionCache.clipRect = new DOMRect(start_T.x, start_T.y, 0, 0);
      this.#interactionCache.width = Number(fixedAspect);
    }

    /** @param {DOMPoint} to */
    regionSelect(to) {
      const to_T = to.matrixTransform(this.viewportTransform_inv);
      to_T.x = Math.round(utils.clamp(0, to_T.x, this.#mainCanvas.width));
      to_T.y = Math.round(utils.clamp(0, to_T.y, this.#mainCanvas.height));

      this.#interactionCache.clipRect.width = to_T.x - this.#interactionCache.clipRect.x;
      this.#interactionCache.clipRect.height = to_T.y - this.#interactionCache.clipRect.y;

      if (this.#interactionCache.width) {
        // fixed Aspect ratio
        const aspect = this.#mainCanvas.width / this.#mainCanvas.height;

        this.#interactionCache.clipRect.width = utils.maxAbs(this.#interactionCache.clipRect.width, (Math.sign(this.#interactionCache.clipRect.width) || 1) * Math.abs(this.#interactionCache.clipRect.height) * aspect);
        this.#interactionCache.clipRect.height = utils.maxAbs(this.#interactionCache.clipRect.height, (Math.sign(this.#interactionCache.clipRect.height) || 1) * Math.abs(this.#interactionCache.clipRect.width) / aspect);

        this.#interactionCache.clipRect.width = utils.clamp(-this.#interactionCache.clipRect.x, this.#interactionCache.clipRect.width, this.#mainCanvas.width - this.#interactionCache.clipRect.x);
        this.#interactionCache.clipRect.height = utils.clamp(-this.#interactionCache.clipRect.y, this.#interactionCache.clipRect.height, this.#mainCanvas.height - this.#interactionCache.clipRect.y);

        this.#interactionCache.clipRect.width = Math.round(utils.minAbs(this.#interactionCache.clipRect.width, (Math.sign(this.#interactionCache.clipRect.width) || 1) * Math.abs(this.#interactionCache.clipRect.height) * aspect));
        this.#interactionCache.clipRect.height = Math.round(utils.minAbs(this.#interactionCache.clipRect.height, (Math.sign(this.#interactionCache.clipRect.height) || 1) * Math.abs(this.#interactionCache.clipRect.width) / aspect));
      }
    }

    endRegionSelect() {
      if (!this.#interactionCache.clipRect || Math.abs(this.#interactionCache.clipRect.width) < 1 || Math.abs(this.#interactionCache.clipRect.height) < 1) {
        this.#interactionCache.clipRect = null;
      }
    }

    cropToRegionRect() {
      if (!this.#interactionCache.clipRect || Math.abs(this.#interactionCache.clipRect.width) < 1 || Math.abs(this.#interactionCache.clipRect.height) < 1) {
        this.#interactionCache.clipRect = null;
        return false;
      }
      const width = Math.abs(this.#interactionCache.clipRect.width);
      const height = Math.abs(this.#interactionCache.clipRect.height);

      const ccx = this.#interactionCache.clipRect.left + width / 2;
      const ccy = this.#interactionCache.clipRect.top + height / 2;

      const cx = this.#mainCanvas.width / 2;
      const cy = this.#mainCanvas.height / 2;

      const subPixelX = ((width - this.#activeLayer.width) & 1) / 2;
      const subPixelY = ((height - this.#activeLayer.height) & 1) / 2;

      const T = new DOMMatrix().translateSelf(cx - ccx + subPixelX, cy - ccy + subPixelY);

      const updated = { ...this.#state.state, width, height };
      updated.layers = updated.layers.map(({ layer, state }) => {
        const newState = { ...state, transform: T.multiply(state.transform) };
        layer.state = newState;
        return { layer, state: newState };
      });
      this.#state.state = updated;
      this.#resizeCanvas(width, height);
      this.fullRender();

      this.#interactionCache.clipRect = null;
      return true;
    }

    /** @param {DOMPoint} point @param {string} font @param {string} color */
    insertTextAt(point, font, color) {
      const ctx = this.#middleCache.getContext("2d");
      ctx.save();
      ctx.font = font;

      this.#interactionCache.layerTransform_inv = new DOMMatrix()
        .translateSelf(
          this.#mainCanvas.width / 2 - ((this.#mainCanvas.width - this.#activeLayer.width) & 1) / 2,
          this.#mainCanvas.height / 2 - ((this.#mainCanvas.height - this.#activeLayer.height) & 1) / 2
        ).multiplySelf(this.layerTransform).invertSelf();

      const textMetrics = ctx.measureText("");
      const width = Math.ceil(textMetrics.actualBoundingBoxRight + textMetrics.actualBoundingBoxLeft);
      const height = Math.ceil(textMetrics.fontBoundingBoxDescent + textMetrics.fontBoundingBoxAscent);
      ctx.restore();

      const to_inv = point.matrixTransform(this.viewportTransform_inv);
      this.#interactionCache.rect = new DOMRect(Math.round(to_inv.x), Math.round(to_inv.y - height / 2), width, height);
      this.#interactionCache.color = color;
      this.#interactionCache.font = font;
    }

    updateText(text = this.#interactionCache.text, font = this.#interactionCache.font) {
      const ctx = this.#middleCache.getContext("2d");
      ctx.save();
      ctx.clearRect(0, 0, this.#middleCache.width, this.#middleCache.height);
      this.#prepareMiddleCanvas();

      ctx.textBaseline = "middle";
      ctx.fillStyle = this.#interactionCache.color;
      ctx.font = font;
      this.#interactionCache.text = text;
      this.#interactionCache.font = font;

      const availRect = this.#interactionCache.clipRect ?? new DOMRect(0, 0, this.#mainCanvas.width, this.#mainCanvas.height);
      const clipPath = new Path2D();
      clipPath.rect(availRect.x, availRect.y, availRect.width, availRect.height);
      ctx.clip(clipPath);

      const [w, h] = utils.renderMultilineText(
        ctx, this.#interactionCache.text,
        new DOMPoint(this.#interactionCache.rect.x + 1, this.#interactionCache.rect.y)
      );
      ctx.restore();

      this.#interactionCache.rect.width = Math.ceil(w + !!(w));
      this.#interactionCache.rect.height = Math.ceil(h);

      const mainCtx = this.#mainCanvas.getContext("2d");
      mainCtx.clearRect(0, 0, this.#mainCanvas.width, this.#mainCanvas.height);
      this.#activeLayerIndex > 0 && mainCtx.drawImage(this.#bottomCache, 0, 0);

      mainCtx.filter = this.#activeLayer.filter;
      mainCtx.drawImage(this.#middleCache, 0, 0);
      mainCtx.filter = "none";

      this.#activeLayerIndex < this.layers.length - 1 && mainCtx.drawImage(this.#topCache, 0, 0);

      this.refreshViewport();
    }

    finalizeText() {
      const ctx = this.#middleCache.getContext("2d");

      if (this.#interactionCache.text === "") {
        ctx.restore();
        this.#interactionCache.rect = null;
        return;
      }

      const availRect = this.#interactionCache.clipRect ?? new DOMRect(0, 0, this.#mainCanvas.width, this.#mainCanvas.height);
      const clipPath = new Path2D();
      clipPath.rect(availRect.x, availRect.y, availRect.width, availRect.height);

      const intersect = utils.rectRect(availRect, this.#interactionCache.rect);
      const rawOrigin1 = new DOMPoint(intersect.left, intersect.top).matrixTransform(this.#interactionCache.layerTransform_inv);
      const rawOrigin2 = new DOMPoint(intersect.right, intersect.bottom).matrixTransform(this.#interactionCache.layerTransform_inv);
      this.#activeLayer.resizeFitStroke(new DOMRect(rawOrigin1.x, rawOrigin1.y, rawOrigin2.x - rawOrigin1.x, rawOrigin2.y - rawOrigin1.y));

      const layerState = this.#activeLayer.addStroke({
        text: this.#interactionCache.text,
        font: this.#interactionCache.font,
        origin: new DOMPoint(this.#interactionCache.rect.x + 1, this.#interactionCache.rect.y),
        color: this.#interactionCache.color,
        globalCompositeOperation: "source-over",
        clipPath,
        transform: this.#interactionCache.layerTransform_inv
      });

      this.#interactionCache.text = "";
      this.#interactionCache.rect = null;
      ctx.restore();
      ctx.clearRect(0, 0, this.#middleCache.width, this.#middleCache.height);

      const updated = { ...this.#state.state, layers: [...this.#state.state.layers] };
      updated.layers[this.activeLayerIndex] = { ...updated.layers[this.activeLayerIndex], state: layerState };
      this.#state.state = updated;

      this.render();
    }

    /** @param {number} width @param {number} height  */
    #resizeCanvas(width, height) {
      this.#staleViewportInv = true;
      [this.#mainCanvas, this.#bottomCache, this.#middleCache, this.#topCache].forEach(c => {
        c.width = width;
        c.height = height;
        c.getContext("2d").imageSmoothingEnabled = false;
      })

      this.layers.forEach(({ layer }) => { layer.staleThumbnail = true });
    }

    /** @param {1 | -1} x @param {-1 | 1} y */
    scale(x, y) {
      const S = new DOMMatrix().scaleSelf(x, y);
      const layers = this.layers.map(({ layer }) => {
        layer.previewTransformBy(S);
        return { layer, state: layer.finalizePreview() }
      });
      this.#state.state = { ...this.#state.state, layers };
    }

    /** @param {90 | -90} angle  */
    rotate(angle) {
      const R = new DOMMatrix().rotateSelf(angle);
      const layers = this.layers.map(({ layer }) => {
        layer.previewTransformBy(R);
        return { layer, state: layer.finalizePreview() }
      });
      this.#resizeCanvas(this.#state.state.height, this.#state.state.width);
      this.#state.state = { ...this.#state.state, layers, width: this.#state.state.height, height: this.#state.state.width };

      this.resetViewport();
      this.fullRender();
    }

    /** @type {typeof OffscreenCanvas.prototype.convertToBlob} */
    toBlob(options) { return this.#mainCanvas.convertToBlob(options) }

    render(layerIndex = this.#activeLayerIndex) {
      const ctx = this.#mainCanvas.getContext("2d");
      ctx.clearRect(0, 0, this.#mainCanvas.width, this.#mainCanvas.height);

      layerIndex > 0 && ctx.drawImage(this.#bottomCache, 0, 0);
      this.layers[layerIndex].layer.drawOn(this.#mainCanvas);
      layerIndex < this.layers.length - 1 && ctx.drawImage(this.#topCache, 0, 0);

      this.refreshViewport();
    }

    fullRender() {
      this.sandwichLayer();
      this.render();
    }

    undo() {
      const oldWidth = this.#mainCanvas.width;
      const oldHeight = this.#mainCanvas.height;
      if (!this.#state.undo()) return false;
      if (this.#state.state.width !== oldWidth || this.#state.state.height !== oldHeight) {
        this.#resizeCanvas(this.#state.state.width, this.#state.state.height);
        this.resetViewport();
      }
      this.#state.state.layers.forEach(({ layer, state }) => { layer.state = state });
      this.activeLayerIndex = utils.clamp(0, this.activeLayerIndex, this.#state.state.layers.length - 1);
      this.render();
      return true;
    }

    redo() {
      const oldWidth = this.#mainCanvas.width;
      const oldHeight = this.#mainCanvas.height;
      if (!this.#state.redo()) return false;
      if (this.#state.state.width !== oldWidth || this.#state.state.height !== oldHeight) {
        this.#resizeCanvas(this.#state.state.width, this.#state.state.height);
        this.resetViewport();
      }
      this.#state.state.layers.forEach(({ layer, state }) => { layer.state = state });
      this.activeLayerIndex = utils.clamp(0, this.activeLayerIndex, this.#state.state.layers.length - 1);
      this.render();
      return true;
    }
  }

  class Layer {
    #img;
    #canvas;
    #state;
    #previewTransform;
    #subPixelCorrection;
    #filter;

    /** @param {ImageBitmap | {width: number, height: number}} bitmap @param {string} name */
    constructor(name, bitmap) {
      this.name = name;
      this.id = Date.now() + Math.random();
      this.#canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      this.#canvas.getContext("2d").imageSmoothingEnabled = false;

      this.#subPixelCorrection = { x: 0, y: 0 };
      this.#state = {
        transform: new DOMMatrix(),
        isVisible: true,
        /** @type {LayerAdjustments} */
        adjustments: {},
        /**
         * @type {{
         *  color: string, width?: number, clipPath: Path2D, globalCompositeOperation: string,
         *  path2D?: Path2D, text?: string, font?: string, origin?: DOMPoint, transform: DOMMatrix
         * }[]}
         */
        strokes: [],
      };
      this.#filter = "none";
      this.#previewTransform = new DOMMatrix();
      this.staleThumbnail = true;
      if (bitmap instanceof ImageBitmap) {
        this.#img = bitmap;
        this.#drawImage();
      }
    }

    get filter() { return this.#filter }
    get width() { return this.#canvas.width }
    get height() { return this.#canvas.height }
    get state() { return this.#state }
    get previewTransform() { return this.#previewTransform.multiply(this.#state.transform) }

    set state(state) {
      if (this.#state.strokes.length < state.strokes.length) {
        // adding strokes
        for (let i = this.#state.strokes.length; i < state.strokes.length; i++) {
          this.drawStroke(state.strokes[i]);
        }
      } else if (this.#state.strokes.length > state.strokes.length) {
        // removing strokes
        this.#drawImage();
        this.#drawStrokes(state.strokes);
      }
      if (this.#state.adjustments !== state.adjustments) {
        this.#filter = Object.entries(state.adjustments).reduce((acc, [key, value]) => value != null ? `${acc} ${key}(${value}${utils.filterUnits[key] ?? ""})` : acc, "") || "none";
      }
      if (state !== this.#state) { this.staleThumbnail = true }
      this.#state = state;
    }

    toBitmap() { return createImageBitmap(this.#canvas) }

    /** @param {DOMMatrix} dM */
    previewTransformBy(dM) { this.#previewTransform.preMultiplySelf(dM) }
    /** @param {DOMMatrix} M */
    previewTransformTo(M) { this.#previewTransform = M }

    finalizePreview() {
      if (this.#previewTransform.isIdentity) return null;
      const applied = this.#previewTransform.multiplySelf(this.#state.transform);
      this.#state = { ...this.#state, transform: applied };
      this.#previewTransform = new DOMMatrix();
      this.staleThumbnail = true;
      return this.#state;
    }

    /** @param {DOMRect} strokeRect */
    resizeFitStroke(strokeRect, strokeWidth = 0) {
      const canvasRect = new DOMRect(-this.width / 2, -this.height / 2, this.width, this.height);

      const dx = Math.max(0, canvasRect.left - (strokeRect.left - strokeWidth / utils.getScale(this.#state.transform) / 2), (strokeRect.right + strokeWidth / utils.getScale(this.#state.transform) / 2) - canvasRect.right);
      const dy = Math.max(0, canvasRect.top - (strokeRect.top - strokeWidth / utils.getScale(this.#state.transform) / 2), (strokeRect.bottom + strokeWidth / utils.getScale(this.#state.transform) / 2) - canvasRect.bottom);

      if (dx || dy) {
        this.#canvas.width += 2 * Math.ceil(dx);
        this.#canvas.height += 2 * Math.ceil(dy);
        this.#canvas.getContext("2d").imageSmoothingEnabled = false;
        this.#drawImage();
        this.#drawStrokes();
      }
    }

    /**
     * @param {{
     *  color: string, width?: number, clipPath: Path2D, globalCompositeOperation: string,
     *  path2D?: Path2D, text?: string, font?: string, origin?: DOMPoint, transform: DOMMatrix
     * }} stroke
     */
    addStroke(stroke) {
      this.#state = { ...this.#state, strokes: [...this.#state.strokes, stroke] };
      this.drawStroke(stroke);
      this.staleThumbnail = true;
      return this.#state;
    }

    /** 
     * @param {{
     *  color: string, width?: number, clipPath: Path2D, globalCompositeOperation: string,
     *  path2D?: Path2D, text?: string, font?: string, origin?: DOMPoint, transform: DOMMatrix
     * }} stroke
     */
    drawStroke(stroke) {
      const ctx = this.#canvas.getContext("2d");
      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.textBaseline = "middle";
      ctx.globalCompositeOperation = stroke.globalCompositeOperation;
      ctx.setTransform(new DOMMatrix().translateSelf(this.width / 2, this.height / 2).multiplySelf(stroke.transform));
      ctx.clip(stroke.clipPath);
      if (stroke.path2D) {
        ctx.lineWidth = stroke.width;
        ctx.stroke(stroke.path2D);
      }
      if (stroke.text) {
        ctx.font = stroke.font;
        utils.renderMultilineText(ctx, stroke.text, stroke.origin);
      }
      ctx.restore();
    }

    #drawStrokes(strokes = this.#state.strokes) {
      const ctx = this.#canvas.getContext("2d");
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (const stroke of strokes) {
        ctx.save();
        ctx.strokeStyle = stroke.color;
        ctx.fillStyle = stroke.color;
        ctx.textBaseline = "middle";
        ctx.globalCompositeOperation = stroke.globalCompositeOperation;
        ctx.setTransform(new DOMMatrix().translateSelf(this.width / 2, this.height / 2).multiplySelf(stroke.transform));
        ctx.clip(stroke.clipPath);
        if (stroke.path2D) {
          ctx.lineWidth = stroke.width;
          ctx.stroke(stroke.path2D);
        }
        if (stroke.text) {
          ctx.font = stroke.font;
          utils.renderMultilineText(ctx, stroke.text, stroke.origin);
        }
        ctx.restore();
      }
    }

    #drawImage() {
      const ctx = this.#canvas.getContext("2d");
      ctx.clearRect(0, 0, this.width, this.height);
      if (this.#img) {
        ctx.setTransform(new DOMMatrix().translateSelf(this.width / 2, this.height / 2));
        ctx.drawImage(this.#img, -this.#img.width / 2, -this.#img.height / 2);
        ctx.resetTransform();
      }
    }

    /** @param {OffscreenCanvas} canvas */
    drawOn(canvas) {
      this.#subPixelCorrection.x = ((canvas.width - this.width) & 1) / 2;
      this.#subPixelCorrection.y = ((canvas.height - this.height) & 1) / 2;

      if (!this.#state.isVisible || this.#state.adjustments.opacity === 0 || this.#state.strokes.length === 0 && !this.#img) return;

      const ctx = canvas.getContext("2d");
      ctx.save();
      ctx.filter = this.#filter;
      ctx.setTransform(new DOMMatrix()
        .translateSelf(canvas.width / 2 - this.#subPixelCorrection.x, canvas.height / 2 - this.#subPixelCorrection.y)
        .multiplySelf(this.#previewTransform)
        .multiplySelf(this.#state.transform)
      );
      ctx.drawImage(this.#canvas, -this.width / 2, -this.height / 2);
      ctx.restore();
    }

    /** @param {HTMLCanvasElement} canvas */
    drawThumbnailOn(canvas, scale = 1, forced = false) {
      if (!this.staleThumbnail && !forced) return;

      const ctx = canvas.getContext("2d");
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(new DOMMatrix()
        .translateSelf(canvas.width / 2, canvas.height / 2)
        .scaleSelf(scale, scale)
        .translateSelf(-this.#subPixelCorrection.x, -this.#subPixelCorrection.y)
        .multiplySelf(this.#previewTransform)
        .multiplySelf(this.#state.transform)
      );
      ctx.drawImage(this.#canvas, -this.width / 2, -this.height / 2);
      ctx.restore();

      this.staleThumbnail = false;
    }
  }

  var utils = {
    /** @param {...string} classNames */
    clsx(...classNames) { return classNames.filter(Boolean).join(" ") },

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

    /** @param {number} x @param {number} y */
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

    /** @param {number[]} values */
    minAbs(...values) {
      let best = values[0];
      for (let i = 1; i < values.length; i++) {
        if (Math.abs(values[i]) < Math.abs(best)) {
          best = values[i];
        }
      }
      return best;
    },

    /** @param {number[]} values */
    maxAbs(...values) {
      let best = values[0];
      for (let i = 1; i < values.length; i++) {
        if (Math.abs(values[i]) > Math.abs(best)) {
          best = values[i];
        }
      }
      return best;
    },

    /** @param {number} min @param {number} x @param {number} max */
    clamp(min, x, max) { return Math.max(min, Math.min(x, max)) },

    /** @param {number} x @param {{minValue: number, centerValue: number, maxValue: number}} params */
    expScaling(x, { minValue, centerValue, maxValue }) {
      if (x <= 0.5) {
        return Math.exp((1 - 2 * x) * Math.log(minValue) + 2 * x * Math.log(centerValue));
      } else {
        return Math.exp((1 - (2 * x - 1)) * Math.log(centerValue) + (2 * x - 1) * Math.log(maxValue));
      }
    },

    /** @param {number} x @param {{minValue: number, centerValue: number, maxValue: number}} params */
    logScaling(x, { minValue, centerValue, maxValue }) {
      x = utils.clamp(minValue, x, maxValue);
      if (x <= centerValue) {
        const val = (Math.log(x) - Math.log(minValue)) / (Math.log(centerValue) - Math.log(minValue));
        return val / 2 * 100;
      } else {
        const val = (Math.log(x) - Math.log(centerValue)) / (Math.log(maxValue) - Math.log(centerValue));
        return (1 + val) / 2 * 100;
      }
    },

    /** @param {OffscreenCanvasRenderingContext2D} ctx @param {string} text @param {DOMPoint} origin  */
    renderMultilineText(ctx, text, origin) {
      const lines = text.split("\n");
      let height = 0;
      let width = 0;
      for (const line of lines) {
        const textMetrics = ctx.measureText(line);
        const lineheight = textMetrics.fontBoundingBoxAscent + textMetrics.fontBoundingBoxDescent;
        ctx.fillText(line, origin.x, origin.y + height + lineheight / 2);
        height += lineheight;
        width = Math.max(width, ctx.measureText(line).width);
      }
      return [width, height];
    },

    /** @param {DOMPoint} p @param {DOMRect} rect */
    pointInRect(p, rect, padding = 0) {
      return p.x >= rect.left - padding &&
        p.x <= rect.right + padding &&
        p.y >= rect.top - padding &&
        p.y <= rect.bottom + padding
    },

    /** @param {DOMPoint} p1 @param {DOMPoint} p2 @param {DOMPoint} p3 @param {DOMPoint} p4 */
    lineLine(p1, p2, p3, p4) {
      const uA = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / ((p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y));
      const uB = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / ((p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y));

      if (uA >= 0 && uA <= 1 && uB >= 0 && uB <= 1) {
        return new DOMPoint(p1.x + (uA * (p2.x - p1.x)), p1.y + (uA * (p2.y - p1.y)));
      }
      return null;
    },

    /** @param {DOMPoint} p1 @param {DOMPoint} p2 @param {DOMRect} rect @returns {DOMPoint[]} */
    lineRect(p1, p2, rect, padding = 0) {
      const top = utils.lineLine(p1, p2, new DOMPoint(rect.left - padding, rect.top - padding), new DOMPoint(rect.right + padding, rect.top - padding));
      const right = utils.lineLine(p1, p2, new DOMPoint(rect.right + padding, rect.top - padding), new DOMPoint(rect.right + padding, rect.bottom + padding));
      const bottom = utils.lineLine(p1, p2, new DOMPoint(rect.left - padding, rect.bottom + padding), new DOMPoint(rect.right + padding, rect.bottom + padding));
      const left = utils.lineLine(p1, p2, new DOMPoint(rect.left - padding, rect.top - padding), new DOMPoint(rect.left - padding, rect.bottom + padding));

      return [top, right, bottom, left].filter(Boolean);
    },

    /** @param {DOMPoint} p1 @param {DOMPoint} p2 @param {DOMRect} rect */
    clampLineToRect(p1, p2, rect, padding = 0) {
      const intersects = utils.lineRect(p1, p2, rect, padding);

      switch (intersects.length) {
        case 1: {
          return utils.pointInRect(p1, rect, padding) ? [p1, intersects[0]] : [intersects[0], p2];
        }
        case 2: {
          return intersects.sort((a, b) => {
            const distA = Math.hypot(a.x - p1.x, a.y - p1.y);
            const distB = Math.hypot(b.x - p1.x, b.y - p1.y);
            return distA - distB;
          });
        }
        default: {
          return [p1, p2];
        }
      }
    },

    /** @param {DOMRect} rect1 @param {DOMRect} rect2 */
    rectRect(rect1, rect2) {
      return new DOMRect(
        Math.max(rect1.left, rect2.left),
        Math.max(rect1.top, rect2.top),
        Math.min(rect1.right, rect2.right) - Math.max(rect1.left, rect2.left),
        Math.min(rect1.bottom, rect2.bottom) - Math.max(rect1.top, rect2.top),
      )
    },

    /** @param {{onSubmit: () => void, bitmap: ImageBitmap, userActions: React.RefObject<any>}} */
    openEditor({ onSubmit, bitmap, userActions }) {
      const id = internals.openModal?.(e => {
        const channelId = internals.SelectedChannelStore.getCurrentlySelectedChannelId();

        return jsx(BdApi.Components.ErrorBoundary, null, jsx(internals.ModalSystem.ModalRoot, {
          ...e,
          animation: "subtle",
          size: "dynamic",
          className: `${meta.slug}Root`,
          children: [
            jsx(internals.ModalSystem.ModalFooter, {
              className: "modal-footer",
              children: internals.uploadDispatcher && channelId ? [
                jsx(internals.ManaButton, {
                  text: "Save",
                  variant: "active",
                  type: "submit",
                  onClick: () => {
                    onSubmit?.();
                    internals.closeModal?.(id);
                  }
                }),
                jsx(internals.ManaButton, {
                  text: "Cancel",
                  variant: "secondary",
                  onClick: () => {
                    internals.closeModal?.(id);
                  }
                })
              ] : jsx("div", {
                style: { color: "var(--red-430, #d6363f)" },
                children: "Unable to save. Please use [Ctrl] + [C] instead."
              })
            }),
            jsx(internals.ModalSystem.ModalContent, {
              className: "image-editor",
              children: jsx(Components.ImageEditor, {
                bitmap,
                ref: userActions,
              })
            })
          ]
        }))
      });
    },

    /** @type {{[K in keyof LayerAdjustments]: string}} */
    filterUnits: { opacity: "", blur: "px", brightness: "%", contrast: "%", grayscale: "%", "hue-rotate": "deg", invert: "%", saturate: "%", sepia: "%" },
    paintingColors: ["#000000", 0xffffff, 0xffea00, 0xff9100, 0xff1744, 0xff4081, 0xd500f9, 0x651fff, 0x2979ff, 0x10e5ff, 0x1de9b6, 0x10e676],
    backgroundColors: [0x303038, 0x373038, 0x383032, 0x383530, 0x353830, 0x303832, 0x303738, 0x363649, 0x473649, 0x49363c, 0x494136, 0x414936, 0x36493c, 0x364749],

    paths: {
      Main: "m22.7 14.3l-1 1l-2-2l1-1c.1-.1.2-.2.4-.2c.1 0 .3.1.4.2l1.3 1.3c.1.2.1.5-.1.7M13 19.9V22h2.1l6.1-6.1l-2-2zm-1.79-4.07l-1.96-2.36L6.5 17h6.62l2.54-2.45l-1.7-2.26zM11 19.9v-.85l.05-.05H5V5h14v6.31l2-1.93V5a2 2 0 0 0-2-2H5c-1.1 0-2 .9-2 2v14a2 2 0 0 0 2 2h6z",
      FlipH: "M1.2656 20.1094 8.7188 4.4531C9.1406 3.6094 10.3594 3.8906 10.3594 4.8281L10.3594 20.4375C10.3594 21.375 9.8906 21.7969 8.9531 21.7969L2.2969 21.7969C1.3594 21.7969.8438 20.9531 1.2656 20.1094ZM22.8281 20.1094 15.375 4.4531C14.9531 3.6094 13.7344 3.8906 13.7344 4.8281L13.7344 20.4375C13.7344 21.375 14.2031 21.7969 15.1406 21.7969L21.7969 21.7969C22.7344 21.7969 23.25 20.9531 22.8281 20.1094Z",
      FlipV: "M20.1094 22.7344 4.4531 15.2812C3.6094 14.8594 3.8906 13.6406 4.8281 13.6406L20.4375 13.6406C21.375 13.6406 21.7969 14.1094 21.7969 15.0469L21.7969 21.7031C21.7969 22.6406 20.9531 23.1563 20.1094 22.7344ZM20.1094 1.1719 4.4531 8.625C3.6094 9.0469 3.8906 10.2656 4.8281 10.2656L20.4375 10.2656C21.375 10.2656 21.7969 9.7969 21.7969 8.8594L21.7969 2.2031C21.7969 1.2656 20.9531.75 20.1094 1.1719Z",
      RotR: "M9.75 7.8516 7.8516 9.75C7.5 10.1016 7.5 10.6641 7.8516 11.0157 8.2032 11.3671 8.7657 11.3671 9.1171 11.0157L12.5625 7.5704C12.9844 7.1484 12.9844 6.7266 12.5625 6.3046L9.1171 2.8594C8.7657 2.5078 8.2032 2.5078 7.8516 2.8594 7.5 3.2109 7.5 3.7734 7.8516 4.125L9.75 6.0234 5.6719 6.0234C3.8438 6.0234 2.4375 7.4296 2.4375 9.2579L2.4375 12.0704C2.4375 12.5625 2.8594 12.9844 3.3516 12.9844 3.8438 12.9844 4.2657 12.5625 4.2657 12.0704L4.2657 9.1875C4.2657 8.4844 4.8984 7.8516 5.6016 7.8516ZM16.0313 21.7969 21.75 21.7969C22.3594 21.7969 23.0625 21.2813 22.6406 20.25L16.4063 5.2969C16.0313 4.2656 14.7656 4.5469 14.7656 5.5781L14.7656 20.3906C14.7656 21.2344 15.1875 21.7969 16.0313 21.7969ZM1.3594 20.3438C.7969 20.7188.8906 21.7969 1.9219 21.7969L12.5625 21.7969C13.3125 21.7969 13.6875 21.2344 13.6875 20.625L13.6875 14.7188C13.6875 14.0625 13.0313 13.4531 12.3281 13.875Z",
      RotL: "M14.25 7.8516 16.1484 9.75C16.5 10.1016 16.5 10.6641 16.1484 11.0157 15.7968 11.3671 15.2343 11.3671 14.8829 11.0157L11.4375 7.5704C11.0156 7.1484 11.0156 6.7266 11.4375 6.3046L14.8829 2.8594C15.2343 2.5078 15.7968 2.5078 16.1484 2.8594 16.5 3.2109 16.5 3.7734 16.1484 4.125L14.25 6.0234 18.3281 6.0234C20.1562 6.0234 21.5625 7.4296 21.5625 9.2579L21.5625 12.0704C21.5625 12.5625 21.1406 12.9844 20.6484 12.9844 20.1562 12.9844 19.7343 12.5625 19.7343 12.0704L19.7343 9.1875C19.7343 8.4844 19.1016 7.8516 18.3984 7.8516ZM7.9687 21.7969 2.25 21.7969C1.6406 21.7969.9375 21.2813 1.3594 20.25L7.5937 5.2969C7.9687 4.2656 9.2344 4.5469 9.2344 5.5781L9.2344 20.3906C9.2344 21.2344 8.8125 21.7969 7.9687 21.7969ZM22.6406 20.3438C23.2031 20.7188 23.1094 21.7969 22.0781 21.7969L11.4375 21.7969C10.6875 21.7969 10.3125 21.2344 10.3125 20.625L10.3125 14.7188C10.3125 14.0625 10.9687 13.4531 11.6719 13.875Z",
      Undo: "M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8",
      Redo: "M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7z",
      Select: "M7 21v-2h2v2zM3 5V3h2v2zm4 0V3h2v2zm4 16v-2h2v2zm0-16V3h2v2zm4 0V3h2v2zm0 16v-2h2v2zm4-16V3h2v2zM3 21v-2h2v2zm0-4v-2h2v2zm0-4v-2h2v2zm0-4V7h2v2zm16 12v-2h2v2zm0-4v-2h2v2zm0-4v-2h2v2zm0-4V7h2v2z",
      Crop: "M17 15h2V7c0-1.1-.9-2-2-2H9v2h8zM7 17V1H5v4H1v2h4v10c0 1.1.9 2 2 2h10v4h2v-4h4v-2z",
      Cut: "m16.9 18.3-4.9-4.9-1.645 1.645q.14.2625.1925.56T10.6 16.2q0 1.155-.8225 1.9775T7.8 19t-1.9775-.8225T5 16.2t.8225-1.9775T7.8 13.4q.2975 0 .595.0525t.56.1925L10.6 12 8.955 10.355q-.2625.14-.56.1925T7.8 10.6q-1.155 0-1.9775-.8225T5 7.8t.8225-1.9775T7.8 5t1.9775.8225T10.6 7.8q0 .2975-.0525.595t-.1925.56L19 17.6v.7zm-2.8-7-1.4-1.4 4.2-4.2H19v.7zM7.8 9.2q.5775 0 .9891-.4109T9.2 7.8t-.4109-.9884T7.8 6.4t-.9884.4116T6.4 7.8t.4116.9891T7.8 9.2m4.2 3.15q.14 0 .245-.105t.105-.245-.105-.245-.245-.105-.245.105-.105.245.105.245.245.105M7.8 17.6q.5775 0 .9891-.4109T9.2 16.2t-.4109-.9884T7.8 14.8t-.9884.4116T6.4 16.2t.4116.9891T7.8 17.6ZM1 23v-6h2v4h4v2zm16 0v-2h4v-4h2v6zM1 7V1h6v2H3v4zM21 7V3h-4V1h6v6Z",
      Rotate: "M10.217 19.339C6.62 17.623 4.046 14.136 3.65 10H2c.561 6.776 6.226 12.1 13.145 12.1.253 0 .484-.022.726-.033L11.68 17.865ZM8.855 1.9c-.253 0-.484.022-.726.044L12.32 6.135l1.463-1.463C17.38 6.377 19.954 9.864 20.35 14H22C21.439 7.224 15.774 1.9 8.855 1.9Z",
      Draw: "M4 21v-4.25L17.175 3.6q.3-.3.675-.45T18.6 3q.4 0 .763.15T20 3.6L21.4 5q.3.275.45.638T22 6.4q0 .375-.15.75t-.45.675L8.25 21zm2-2h1.4l9.825-9.8l-.7-.725l-.725-.7L6 17.6zM20 6.425L18.575 5zm-3.475 2.05l-.725-.7L17.225 9.2zM14 21q1.85 0 3.425-.925T19 17.5q0-.9-.475-1.55t-1.275-1.125L15.775 16.3q.575.25.9.55t.325.65q0 .575-.913 1.038T14 19q-.425 0-.712.288T13 20t.288.713T14 21m-9.425-7.65l1.5-1.5q-.5-.2-.788-.412T5 11q0-.3.45-.6t1.9-.925q2.2-.95 2.925-1.725T11 6q0-1.375-1.1-2.187T7 3q-1.125 0-2.013.4t-1.362.975Q3.35 4.7 3.4 5.1t.375.65q.325.275.725.225t.675-.325q.35-.35.775-.5T7 5q1.025 0 1.513.3T9 6q0 .35-.437.637T6.55 7.65q-2 .875-2.775 1.588T3 11q0 .8.425 1.363t1.15.987",
      Eraser: "m16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4.01 4.01 0 0 1-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0M4.22 15.58l3.54 3.53c.78.79 2.04.79 2.83 0l3.53-3.53l-4.95-4.95z",
      Text: "m18.5 4l1.16 4.35l-.96.26c-.45-.87-.91-1.74-1.44-2.18C16.73 6 16.11 6 15.5 6H13v10.5c0 .5 0 1 .33 1.25c.34.25 1 .25 1.67.25v1H9v-1c.67 0 1.33 0 1.67-.25c.33-.25.33-.75.33-1.25V6H8.5c-.61 0-1.23 0-1.76.43c-.53.44-.99 1.31-1.44 2.18l-.96-.26L5.5 4z",
      LockOpen: "M6 20h12V10H6zm6-3q.825 0 1.413-.587T14 15t-.587-1.412T12 13t-1.412.588T10 15t.588 1.413T12 17m-6 3V10zm0 2q-.825 0-1.412-.587T4 20V10q0-.825.588-1.412T6 8h7V6q0-2.075 1.463-3.537T18 1q1.775 0 3.1 1.075t1.75 2.7q.125.425-.162.825T22 6q-.425 0-.7-.175t-.4-.575q-.275-.95-1.062-1.6T18 3q-1.25 0-2.125.875T15 6v2h3q.825 0 1.413.588T20 10v10q0 .825-.587 1.413T18 22z",
      Lock: "M12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2m5 3c.55 0 1-.45 1-1V11c0-.55-.45-1-1-1H7c-.55 0-1 .45-1 1v8c0 .55.45 1 1 1H17M9 8h6V6c0-1.66-1.34-3-3-3S9 4.34 9 6Zm9 0c1.1 0 2 .9 2 2V20c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V10c0-1.1.9-2 2-2H7V6c0-2.76 2.24-5 5-5s5 2.24 5 5V8h1",
      Pan: "M23 12 18.886 7.864v2.772h-5.5v-5.5h2.75L12 1 7.886 5.136h2.75v5.5H5.092V7.886L1 12l4.136 4.136v-2.75h5.5v5.5H7.886L12 23l4.136-4.114h-2.75v-5.5h5.5v2.75L23 12Z",
      Scale: "M16 3a1 1 0 100 2h1.586L11 11.586V10A1 1 0 009 10v3.75c0 .69.56 1.25 1.25 1.25H14a1 1 0 100-2H12.414L19 6.414V8a1 1 0 102 0V4.25C21 3.56 20.44 3 19.75 3ZM5 3l-.15.005A2 2 0 003 5V19l.005.15A2 2 0 005 21H19l.15-.005A2 2 0 0021 19V13l-.007-.117A1 1 0 0019 13v6H5V5h6l.117-.007A1 1 0 0011 3Z",
      ResetTransform: "M8 9H4q-.425 0-.712-.288T3 8V4q0-.425.288-.712T4 3t.713.288T5 4v2.35Q6.25 4.8 8.063 3.9T12 3q2.475 0 4.488 1.2T19.7 7.35q.2.35.113.75t-.438.6-.763.113T18 8.375q-.925-1.525-2.5-2.45T12 5q-1.425 0-2.687.525T7.1 7H8q.425 0 .713.288T9 8t-.288.713T8 9 M18.94 16.002 11.976 12.143 5.059 15.965l6.964 3.89Zm2.544-.877a1 1 0 01.002 1.749l-8.978 5a1 1 0 01-.973-.001l-9.022-5.04a1 1 0 01.003-1.749l8.978-4.96a1 1 0 01.968.001l9.022 5z",
      ResetFilters: "M13.75 14.25h2.5q.325 0 .538.213T17 15t-.213.538-.537.212h-2.5q-.325 0-.537-.213T13 15t.213-.537.537-.213m.75 6v-.5h-.75q-.325 0-.537-.213T13 19t.213-.537.537-.213h.75v-.5q0-.325.213-.537T15.25 17t.538.213.212.537v2.5q0 .325-.213.538T15.25 21t-.537-.213-.213-.537m3.25-2h2.5q.325 0 .538.213T21 19t-.213.538-.537.212h-2.5q-.325 0-.537-.213T17 19t.213-.537.537-.213m.25-2v-2.5q0-.325.213-.537T18.75 13t.538.213.212.537v.5h.75q.325 0 .538.213T21 15t-.213.538-.537.212h-.75v.5q0 .325-.213.538T18.75 17t-.537-.213T18 16.25M12 5Q9.075 5 7.038 7.038T5 12q0 1.8.813 3.3T8 17.75V16q0-.425.288-.712T9 15t.713.288T10 16v4q0 .425-.288.713T9 21H5q-.425 0-.712-.288T4 20t.288-.712T5 19h1.35Q4.8 17.75 3.9 15.938T3 12q0-1.875.713-3.512t1.924-2.85 2.85-1.925T12 3q2.825 0 5.088 1.575t3.262 4.05q.15.4 0 .775t-.55.525-.788 0-.537-.55q-.775-1.95-2.513-3.162T12 5",
      AddLayer: "M18.94 12.002 11.976 8.143 5.059 11.965l6.964 3.89Zm2.544-.877a1 1 0 01.002 1.749l-8.978 5a1 1 0 01-.973-.001l-9.022-5.04a1 1 0 01.003-1.749l8.978-4.96a1 1 0 01.968.001l9.022 5zM12 22a1 1 0 00.485-.126l9-5-.971-1.748L12 19.856l-8.515-4.73-.971 1.748 9 5A1 1 0 0012 22m8-22h-2v3h-3v2h3v3h2V5h3V3h-3z",
      DuplicateLayer: "M14 16h-3v-2h3v-3h2v3h3v2h-3v3h-2zM20.5 9.5h-11v11h11zM20.5 7.5a2 2 0 012 2v11a2 2 0 01-2 2h-11a2 2 0 01-2-2v-11a2 2 0 012-2h11M3.5 14.5h3v2h-3a2 2 0 01-2-2v-11a2 2 0 012-2h11a2 2 0 012 2v3h-2v-3h-11z",
      CopyLayer: "M21.73 12H19A3 3 0 0116 9V6.27a3 3 0 01.88.61l4.25 4.24a3 3 0 01.6.88ZM6 18V10a4 4 0 014-4h4V9a5 5 0 005 5h3v4a4 4 0 01-4 4H10A4 4 0 016 18ZM3 16h.5a.5.5 0 00.5-.5V10a6 6 0 016-6h5.5a.5.5 0 00.5-.5V3A1 1 0 0015 2H10A8 8 0 002 10v5a1 1 0 001 1Z",
      DeleteLayer: "M5.06 11.965l6.964 3.89 6.917-3.853-6.964-3.859Zm-2.547.868a1 1 0 01.003-1.749l8.978-4.96a1 1 0 01.968.001l9.022 5a1 1 0 01.002 1.749l-8.978 5a1 1 0 01-.973-.001l-9.022-5.04M15 5h8V3H15ZM12 19.856l8.514-4.73.971 1.748-9 5a1 1 0 01-.971 0l-9-5 .971-1.748Z",
      MoveLayerUp: "M10 11l-7.484 4.084a1 1 0 000 1.75l9 5a1 1 0 001 0l9-5a1 1 0 000-1.75L14 11v2.235L19 16l-7 3.855L5 16l5-2.765Zm3-7.8284 3.4142 3.4142A1 1 0 0115 8L13 6v9.5a1 1 0 01-2 0V6L9 8A1 1 0 017.5858 6.5858L11 3.1716a1.4142 1.4142 0 012 0",
      MoveLayerDown: "M14 13l7.484-4.084a1 1 90 000-1.75l-9-5a1 1 90 00-1 0l-9 5a1 1 90 000 1.75L10 13v-2.235L5 8l7-3.855L19 8l-5 2.765Zm-3 7.8284-3.4142-3.4142A1 1 90 019 16l2 2V8.5a1 1 90 012 0V18l2-2a1 1 90 011.4142 1.4142L13 20.8284a1.4142 1.4142 90 01-2 0",
      Visibility: "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5M12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5m0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3",
      VisibilityOff: "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7M2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2m4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3z",
      Settings: "M12 15.6c1.98 0 3.6-1.62 3.6-3.6S13.98 8.4 12 8.4 8.4 10.02 8.4 12s1.62 3.6 3.6 3.6m9.15-1.08c.19.14.24.39.12.61l-1.92 3.32c-.12.22-.37.3-.59.22l-2.39-.96c-.49.38-1.03.7-1.62.94l-.36 2.54c-.03.24-.23.41-.47.41H10.08c-.24 0-.43-.17-.48-.41l-.36-2.54c-.59-.24-1.12-.56-1.62-.94l-2.39.96c-.22.07-.47 0-.59-.22L2.72 15.13c-.11-.2-.06-.47.12-.61l2.03-1.58c-.05-.3-.07-.63-.07-.94s.04-.64.09-.94L2.86 9.48c-.2-.14-.24-.4-.12-.61L4.65 5.55c.12-.22.37-.3.59-.22l2.39.96c.49-.37 1.03-.7 1.62-.94l.36-2.54c.04-.24.23-.41.47-.41h3.84c.24 0 .44.17.48.41l.36 2.54c.59.24 1.12.56 1.62.94l2.39-.96c.22-.07.47 0 .59.22l1.92 3.32c.11.2.06.47-.12.61l-2.03 1.58c.05.3.07.62.07.94 0 .33-.02.64-.06.94Z",
    },
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
        const stored = Data.load(meta.slug, key);
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
        Data.save(meta.slug, key, val);
      }, [val, key]);

      return [val, setval]
    },

    /**
     * @param {{
     *  buttons?: number,
     *  onStart?: (e: Omit<React.PointerEvent, "currentTarget">, store: Record<string, any>) => void,
     *  onChange?:(e: Omit<React.PointerEvent, "currentTarget">, store: Record<string, any>) => void,
     *  onSubmit?: (e: Omit<React.PointerEvent, "currentTarget">, store: Record<string, any>) => void
     * }} props
     */
    usePointerCapture({ onStart, onChange, onSubmit, buttons = 5 }) {
      /** @type {React.RefObject<number?>} */
      const pointerId = useRef(null);
      /** @type {React.RefObject<number?>} */
      const rafId = useRef(null);
      const smolStore = useRef({});

      /** @type {(e: React.PointerEvent<HTMLElement>) => void} */
      const onPointerDown = useCallback(e => {
        if (!(e.buttons & buttons) || pointerId.current != null) return;

        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
        pointerId.current = e.pointerId;
        onStart?.(e, smolStore.current);
      }, [onStart]);

      /** @type {(e: React.PointerEvent<HTMLElement>) => void} */
      const onPointerMove = useCallback(e => {
        if (!(e.buttons & buttons) || pointerId.current !== e.pointerId || rafId.current) return;

        rafId.current = requestAnimationFrame(() => {
          onChange?.(e, smolStore.current);
          rafId.current = null;
        })
      }, [onChange]);

      /** @type {(e: React.PointerEvent<HTMLElement>) => void} */
      const onPointerUp = useCallback(e => {
        if (pointerId.current !== e.pointerId) return;

        e.preventDefault();
        e.currentTarget.releasePointerCapture(e.pointerId);
        pointerId.current = null;
        rafId.current && cancelAnimationFrame(rafId.current);
        rafId.current = null;
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
     *  onStart?: (e: React.WheelEvent<HTMLCanvasElement>, store: Record<string, any>) => void,
     *  onChange?: (e: React.WheelEvent<HTMLCanvasElement>, store: Record<string, any>) => void,
     *  onSubmit?: (e: React.WheelEvent<HTMLCanvasElement>, store: Record<string, any>) => void,
     *  wait?: number,
     * }} params
     */
    useDebouncedWheel({ onStart, onChange, onSubmit, wait = 250 }) {
      /** @type {React.RefObject<number?>} */
      const timer = useRef(null);

      /** @type {(e: React.WheelEvent<HTMLCanvasElement>) => void} */
      const onWheel = useCallback(e => {
        if (!e.deltaY) return;

        onChange?.(e);

        timer.current && clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          onSubmit?.(e);
          timer.current = null;
        }, wait);

      }, [onStart, onChange, onSubmit, wait]);

      return onWheel;
    }
  }

  var Components = {
    /** @param {React.PropsWithChildren<{fallback?: React.ReactNode}>} props */
    ErrorBoundary({ fallback, ...restProps }) {
      return jsx(BdApi.Components.ErrorBoundary, {
        ...restProps,
        fallback: fallback ?? jsx("div", { style: { color: "var(--red-430, #d6363f)" } }, "Component Error")
      })
    },

    /** @param {{d: string}} props */
    Icon({ d }) {
      return jsx("svg", {
        className: internals.actionIconClass?.actionBarIcon,
        "aria-hidden": "true",
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
    },

    /**
     * @param {{
     *  onClick?: (e: React.MouseEvent<HTMLElement>) => void, tooltip?: string, disabled?: boolean,
     *  active?: boolean, position?: string, className?: string, d?: string
     * }} props
     */
    IconButton({ onClick, tooltip, d, disabled, active, className }) {
      return jsx(Components.ErrorBoundary, {
        children: jsx(BdApi.Components.Tooltip, {
          spacing: 11,
          text: tooltip,
          children: ({ onContextMenu, ...restProps }) => jsx(internals.FocusRing, {
            children: jsx("div", {
              ...restProps,
              onClick: (e) => { if (onClick && !disabled) { e.stopPropagation(); onClick(e) } },
              onKeyDown: e => { if (!e.repeat && (e.key === "Enter" || e.key === " ") && !disabled) onClick?.(e) },
              className: utils.clsx(internals.actionButtonClass?.button, className, "icon-button", disabled && "disabled", active && "active"),
              role: "button",
              tabIndex: disabled ? null : 0,
              children: jsx(Components.Icon, { d }),
            })
          })
        })
      })
    },

    /** @param {{url: string}} props */
    RemixIcon({ url }) {
      const [isPending, startTransition] = useTransition();
      const ctrl = useRef(new AbortController());
      const userActions = useRef(null);

      useEffect(() => () => ctrl.current.abort(), []);

      return jsx(BdApi.Components.Tooltip, {
        spacing: 11,
        position: "bottom",
        text: "Edit Image",
        children: ({ onContextMenu, ...tooltipProps }) => jsx(internals.ManaButton, {
          ...tooltipProps,
          loading: isPending,
          size: "sm",
          variant: "icon-only",
          icon: () => jsx(Components.Icon, { d: utils.paths.Main }),
          onClick: () => {
            startTransition(async () => {
              try {
                const response = await fetch(url, { signal: ctrl.current.signal }); // BdApi.Net.fetch will reject blobs
                if (!response.headers.get('Content-Type').startsWith('image')) {
                  throw new Error("Url is not an image");
                }
                const blob = await response.blob();
                const bitmap = await createImageBitmap(blob);

                internals.closeModalInAllContexts?.("Media Viewer Modal");
                utils.openEditor({
                  onSubmit: () => { userActions.current?.upload() },
                  userActions,
                  bitmap
                });
              } catch (e) {
                if (e.name === "AbortError") return;

                BdApi.Logger.error(meta.slug, e);
                UI.showToast("Could not fetch image.", { type: "error" });
              }
            })
          },
        })
      })
    },

    UploadIcon({ args }) {
      const [isPending, startTransition] = useTransition();
      const userActions = useRef(null);

      return !isPending ? jsx(Components.IconButton, {
        onClick: () => {
          startTransition(async () => {
            try {
              const bitmap = await createImageBitmap(args.upload.item.file);
              utils.openEditor({
                onSubmit: () => {
                  userActions.current?.replace({
                    draftType: args.draftType,
                    upload: args.upload,
                  })
                },
                userActions,
                bitmap,
              });
            } catch {
              UI.showToast("Could not load image", { type: "error" });
            }
          })
        },
        tooltip: "Edit Image",
        d: utils.paths.Main
      }) : jsx(BdApi.Components.Spinner, {
        type: BdApi.Components.Spinner.Type.SPINNING_CIRCLE_SIMPLE
      })
    },

    /**
     * @typedef {{ visible: boolean, adjustments: LayerAdjustments, active: boolean, name: string, id: number }} LayerState
     *
     * @param {{
     *  layers: LayerState[],
     *  onChange: () => void, width: number, height: number, editor: React.RefObject<CanvasEditor>
     * }} props
     */
    LayerThumbnails({ layers, onChange, width, height, editor }) {
      /** @type {React.RefObject<number?>} */
      const dragIndex = useRef(null);
      const stableLayers = useRef(layers);
      /** @type {React.RefObject<(() => Promise<void>)[] >} */
      const actions = useRef([]);
      /** @type {React.RefObject<number?>} */
      const timer = useRef(null);

      useEffect(() => {
        if (stableLayers.current.length !== layers.length) {
          stableLayers.current = layers;
        } else {
          Object.assign(stableLayers.current, layers)
        }
      }, [layers]);

      /** @type {(e: React.MouseEvent<HTMLLIElement>, i: number) => void} */
      const handleContextMenu = useCallback((e, i) => {
        (i !== editor.current.activeLayerIndex) && editor.current.sandwichLayer(i);

        ContextMenu.open(e, ContextMenu.buildMenu([{
          label: "Name",
          type: "custom",
          render: () => jsx(Components.TextInput, {
            className: utils.clsx(internals.contextMenuClass?.item, internals.contextMenuClass?.labelContainer),
            label: "Name",
            value: stableLayers.current[i].name,
            onChange: newName => { editor.current.layers[i].layer.name = newName; onChange() },
          })
        }, {
          label: "Visible",
          type: "toggle",
          checked: stableLayers.current[i].visible,
          action: () => {
            editor.current.toggleLayerVisibility(i);
            onChange();
          }
        }, {
          label: "Reset Transform",
          disabled: editor.current.layers[i].state.transform.isIdentity,
          action: () => {
            actions.current.push(() => {
              editor.current.resetLayerTransform(i);
              onChange();
            })
          },
          icon: () => jsx(Components.Icon, { d: utils.paths.ResetTransform })
        }, {
          label: "Color Adjustments",
          type: "submenu",
          items: [{
            label: "Reset Adjustments",
            action: () => {
              actions.current.push(() => {
                if (editor.current.layers[i].layer.filter === "none") return;

                editor.current.setLayerAdjustment(i, () => ({}), true);
                onChange();
              })
            },
            icon: () => jsx(Components.Icon, { d: utils.paths.ResetFilters })
          }, { type: "separator" }, {
            label: "Opacity",
            type: "custom",
            render: () => jsx(Components.NumberSlider, {
              className: utils.clsx(internals.contextMenuClass?.item, internals.contextMenuClass?.labelContainer),
              value: stableLayers.current[i].adjustments.opacity ?? 1,
              minValue: 0,
              maxValue: 1,
              label: "Opacity",
              decimals: 2,
              expScaling: false,
              onChange: val => {
                const opacity = val === 1 ? undefined : val;
                if (opacity === editor.current.layers[i].state.adjustments.opacity) return;
                editor.current.setLayerAdjustment(i, ({ opacity: o, ...p }) => ({ ...p, opacity }), true);
                onChange();
              },
              onSlide: opacity => editor.current.setLayerAdjustment(i, ({ opacity: o, ...p }) => ({ ...p, opacity }))
            })
          }, {
            label: "Brightness",
            type: "custom",
            render: () => jsx(Components.NumberSlider, {
              label: "Brightness",
              className: utils.clsx(internals.contextMenuClass?.item, internals.contextMenuClass?.labelContainer),
              value: stableLayers.current[i].adjustments.brightness ?? 100,
              minValue: 0,
              maxValue: 300,
              suffix: "%",
              expScaling: false,
              onChange: val => {
                const brightness = val === 100 ? undefined : val;
                if (brightness === editor.current.layers[i].state.adjustments.brightness) return;
                editor.current.setLayerAdjustment(i, ({ brightness: b, ...p }) => ({ ...p, brightness }), true);
                onChange();
              },
              onSlide: brightness => editor.current.setLayerAdjustment(i, ({ brightness: b, ...p }) => ({ ...p, brightness }))
            })
          }, {
            label: "Contrast",
            type: "custom",
            render: () => jsx(Components.NumberSlider, {
              label: "Contrast",
              className: utils.clsx(internals.contextMenuClass?.item, internals.contextMenuClass?.labelContainer),
              value: stableLayers.current[i].adjustments.contrast ?? 100,
              minValue: 0,
              maxValue: 300,
              suffix: "%",
              expScaling: false,
              onChange: val => {
                const contrast = val === 100 ? undefined : val;
                if (contrast === editor.current.layers[i].state.adjustments.contrast) return;
                editor.current.setLayerAdjustment(i, ({ contrast: c, ...p }) => ({ ...p, contrast }), true);
                onChange();
              },
              onSlide: contrast => editor.current.setLayerAdjustment(i, ({ contrast: c, ...p }) => ({ ...p, contrast }))
            })
          }, {
            label: "Greyscale",
            type: "custom",
            render: () => jsx(Components.NumberSlider, {
              label: "Greyscale",
              className: utils.clsx(internals.contextMenuClass?.item, internals.contextMenuClass?.labelContainer),
              value: stableLayers.current[i].adjustments.grayscale ?? 0,
              minValue: 0,
              maxValue: 100,
              suffix: "%",
              expScaling: false,
              onChange: val => {
                const grayscale = val === 0 ? undefined : val;
                if (grayscale === editor.current.layers[i].state.adjustments.grayscale) return;
                editor.current.setLayerAdjustment(i, ({ grayscale: g, ...p }) => ({ ...p, grayscale }), true);
                onChange();
              },
              onSlide: grayscale => editor.current.setLayerAdjustment(i, ({ grayscale: g, ...p }) => ({ ...p, grayscale }))
            })
          }, {
            label: "Hue-Rotate",
            type: "custom",
            render: () => jsx(Components.NumberSlider, {
              label: "Hue-Rotate",
              className: utils.clsx(internals.contextMenuClass?.item, internals.contextMenuClass?.labelContainer),
              value: stableLayers.current[i].adjustments["hue-rotate"] ?? 0,
              minValue: 0,
              maxValue: 360,
              suffix: "°",
              expScaling: false,
              onChange: val => {
                const hueRotate = val === 0 ? undefined : val;
                if (hueRotate === editor.current.layers[i].state.adjustments["hue-rotate"]) return;
                editor.current.setLayerAdjustment(i, ({ "hue-rotate": h, ...p }) => ({ ...p, "hue-rotate": hueRotate }), true);
                onChange();
              },
              onSlide: hueRotate => editor.current.setLayerAdjustment(i, ({ "hue-rotate": h, ...p }) => ({ ...p, "hue-rotate": hueRotate }))
            })
          }, {
            label: "Invert",
            type: "custom",
            render: () => jsx(Components.NumberSlider, {
              label: "Invert",
              className: utils.clsx(internals.contextMenuClass?.item, internals.contextMenuClass?.labelContainer),
              value: stableLayers.current[i].adjustments.invert ?? 0,
              minValue: 0,
              maxValue: 100,
              suffix: "%",
              expScaling: false,
              onChange: val => {
                const invert = val === 0 ? undefined : val;
                if (invert === editor.current.layers[i].state.adjustments.invert) return;
                editor.current.setLayerAdjustment(i, ({ invert: i, ...p }) => ({ ...p, invert }), true);
                onChange();
              },
              onSlide: invert => editor.current.setLayerAdjustment(i, ({ invert: i, ...p }) => ({ ...p, invert }))
            })
          }, {
            label: "Saturate",
            type: "custom",
            render: () => jsx(Components.NumberSlider, {
              label: "Saturate",
              className: utils.clsx(internals.contextMenuClass?.item, internals.contextMenuClass?.labelContainer),
              value: stableLayers.current[i].adjustments.saturate ?? 100,
              minValue: 0,
              maxValue: 300,
              suffix: "%",
              expScaling: false,
              onChange: val => {
                const saturate = val === 100 ? undefined : val;
                if (saturate === editor.current.layers[i].state.adjustments.saturate) return;
                editor.current.setLayerAdjustment(i, ({ saturate: s, ...p }) => ({ ...p, saturate }), true);
                onChange();
              },
              onSlide: saturate => editor.current.setLayerAdjustment(i, ({ saturate: s, ...p }) => ({ ...p, saturate }))
            })
          }, {
            label: "Sepia",
            type: "custom",
            render: () => jsx(Components.NumberSlider, {
              label: "Sepia",
              className: utils.clsx(internals.contextMenuClass?.item, internals.contextMenuClass?.labelContainer),
              value: stableLayers.current[i].adjustments.sepia ?? 0,
              minValue: 0,
              maxValue: 100,
              suffix: "%",
              expScaling: false,
              onChange: val => {
                const sepia = val === 0 ? undefined : val;
                if (sepia === editor.current.layers[i].state.adjustments.sepia) return;
                editor.current.setLayerAdjustment(i, ({ sepia: s, ...p }) => ({ ...p, sepia }), true);
                onChange();
              },
              onSlide: sepia => editor.current.setLayerAdjustment(i, ({ sepia: s, ...p }) => ({ ...p, sepia }))
            })
          }]
        }, { type: "separator" }, {
          label: "Copy Layer Contents",
          action: () => {
            actions.current.push(async () => {
              if (!DiscordNative?.clipboard?.copyImage) return;

              UI.showToast("Processing...", { type: "warning" });
              try {
                const blob = await editor.current.copyLayerContents(i);
                if (!blob) throw new Error("Layer index out of range.");

                const buffer = await blob.arrayBuffer();
                await DiscordNative.clipboard.copyImage(new Uint8Array(buffer), "image.png");
                UI.showToast("Layer copied", { type: "success" });
              } catch (err) {
                UI.showToast("Failed to copy image", { type: "error" });
                BdApi.Logger.error(meta.slug, err)
              }
            })
          },
          icon: () => jsx(Components.Icon, { d: utils.paths.CopyLayer })
        }, {
          label: "Duplicate Layer",
          action: () => {
            actions.current.push(async () => {
              await editor.current.duplicateLayer(i);
              onChange();
            })
          },
          icon: () => jsx(Components.Icon, { d: utils.paths.DuplicateLayer })
        }, { type: "separator" }, {
          label: "Move Layer Up",
          disabled: i >= stableLayers.current.length - 1,
          action: () => {
            if (i >= editor.current.layers.length - 1) return;

            actions.current.push(() => {
              editor.current.moveLayers(1, i);
              onChange();
            })
          },
          icon: () => jsx(Components.Icon, { d: utils.paths.MoveLayerUp })
        }, {
          label: "Move Layer Down",
          disabled: i <= 0,
          action: () => {
            if (i <= 0) return;

            actions.current.push(() => {
              editor.current.moveLayers(-1, i);
              onChange();
            })
          },
          icon: () => jsx(Components.Icon, { d: utils.paths.MoveLayerDown })
        }, {
          label: "Remove Layer",
          color: "danger",
          disabled: stableLayers.current.length <= 1,
          action: () => {
            if (editor.current.layers.length <= 1) return;

            actions.current.push(() => {
              editor.current.deleteLayer(i);
              onChange();
            })
          },
          icon: () => jsx(Components.Icon, { d: utils.paths.DeleteLayer })
        }]), {
          align: "bottom",
          position: "center",
          onClose: () => {
            // For some stupid reason, onClose is called before the action of a menu item.
            // So use timeout to "wait" until the action is added to the set,
            // then execute them as callbacks, and only then we can cleanup...
            if (timer.current != null) {
              clearTimeout(timer.current);
              timer.current == null;
            }
            timer.current = setTimeout(async () => {
              await Promise.all(actions.current.map(f => f()));
              actions.current = [];
              timer.current = null;

              if (i !== editor.current.activeLayerIndex) {
                editor.current.sandwichLayer();
              }
            })
          }
        });
      }, [onChange]);

      return jsx(Components.ErrorBoundary, null, jsx("div", {
        className: utils.clsx("thumbnails", internals.scrollbarClass?.thin),
        children: jsx("ul", {
          className: "thumbnails-wrapper",
          children: layers.map((state, i) => jsx(internals.FocusRing, {
            key: state.id,
            children: jsx("li", {
              tabIndex: 0,
              draggable: true,
              onDragStart: (e) => {
                e.currentTarget.classList.add("dragging");
                e.dataTransfer.setData("text/plain", String(i));
                e.dataTransfer.effectAllowed = "move";
                dragIndex.current = i;
              },
              onDragEnd: (e) => {
                e.currentTarget.classList.remove("dragging");
                dragIndex.current = null;
              },
              onDragEnter: (e) => { e.currentTarget.classList.add("droptarget") },
              onDragLeave: (e) => { !e.currentTarget.contains(e.relatedTarget) && e.currentTarget.classList.remove("droptarget") },
              onDrop: (e) => {
                e.currentTarget.classList.remove("droptarget");
                if (dragIndex.current != null) {
                  editor.current.moveLayers(i - dragIndex.current, dragIndex.current);
                  onChange();
                }
              },
              onContextMenu: (e) => { handleContextMenu(e, i) },
              onClick: (e) => {
                if (editor.current.activeLayerIndex === i) return;
                editor.current.activeLayerIndex = i;
                e.currentTarget.scrollIntoView({ block: "nearest" })
                onChange();
              },
              onKeyDown: (e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.currentTarget.click();
                }
              },
              className: utils.clsx("thumbnail", state.active && "active"),
              children: [
                jsx(Components.Thumbnail, { index: i, editor, width, height }),
                jsx("span", { className: "layer-label" }, state.name),
                jsx(Components.IconButton, {
                  className: "layer-visibility",
                  tooltip: state.visible ? "Visible" : "Hidden",
                  d: state.visible ? utils.paths.Visibility : utils.paths.VisibilityOff,
                  onClick: () => {
                    editor.current.toggleLayerVisibility(i);
                    onChange();
                  },
                }),
              ]
            })
          }))
        })
      }))
    },

    /** @param {{index: number, editor: React.RefObject<CanvasEditor>, width: number, height: number}} */
    Thumbnail({ index, editor, width, height }) {
      /** @type {React.RefObject<HTMLCanvasElement | null>} */
      const canvas = useRef(null);

      useEffect(() => {
        canvas.current.getContext("2d").imageSmoothingEnabled = false;
      }, [width, height]);

      useEffect(() => {
        // on mount, force render initial thumbnail.
        const s = Math.max(canvas.current.width / width, canvas.current.height / height);
        editor.current.layers[index].layer.drawThumbnailOn(canvas.current, s, true);
      }, []);

      useEffect(() => {
        const s = Math.max(canvas.current.width / width, canvas.current.height / height);
        editor.current.layers[index].layer.drawThumbnailOn(canvas.current, s);
      }) // yes, no dependency! Update the thumbnail on rerenders. However, repainting will only occur if thumbnail is stale!

      return jsx("canvas", {
        width: ~~Math.min(40, 40 * width / height),
        height: ~~Math.min(40, 40 / width * height),
        className: "canvas-thumbnail",
        ref: canvas,
      })
    },

    /** @param {{bitmap: ImageBitmap, ref: React.RefObject<any>}} props */
    ImageEditor({ bitmap, ref }) {
      const [canUndoRedo, setCanUndoRedo] = useState(0);
      /** @type {[LayerState[], React.Dispatch<React.SetStateAction<LayerState[]>>]} */
      const [layers, setLayers] = useState(() => []);
      const [dims, setDims] = useState({ width: bitmap.width, height: bitmap.height });

      const [mode, _setMode] = useState(null);
      const [font, setFont] = hooks.useStoredState("font", () => ({ family: "gg sans", weight: 500 }));
      const [fixedAspect, setFixedAspect] = hooks.useStoredState("fixedAspectRatio", true);
      const [strokeStyle, setStrokeStyle] = hooks.useStoredState("strokeStyle", () => ({ width: 25, color: "#000000" }));

      const isInteracting = useRef(false);
      /** @type { React.RefObject<HTMLCanvasElement?> } */
      const canvasRef = useRef(null);
      const canvasRect = useRef(new DOMRect());
      /** @type { React.RefObject<CanvasEditor?> } */
      const editor = useRef(null);
      /** @type { React.RefObject<HTMLDivElement?> } */
      const overlay = useRef(null);
      /** @type { React.RefObject<{ focus: () => void }> } */
      const textarea = useRef(null);
      /**  @type { React.RefObject<{ setValue: (value: number) => void, previewValue: (value: number) => void }?> } */
      const auxRef = useRef(null);

      const setMode = useCallback((newVal) => {
        if (isInteracting.current) return;

        _setMode((oldMode) => {
          const newMode = newVal instanceof Function ? newVal(oldMode) : newVal;
          ["--translate", "--line-from", "--phi", "r", "--brushsize"].forEach(prop => { overlay.current.style.removeProperty(prop) });

          if (newMode === 1) {
            const { x: ctx, y: cty } = utils.getTranslate(editor.current.viewportTransform);
            overlay.current.style.setProperty("--translate", `${ctx.toFixed(1)}px ${cty.toFixed(1)}px`);
          }
          return newMode;
        })
      }, []);

      useImperativeHandle(ref, () => ({
        replace({ draftType, upload }) {
          UI.showToast("Processing...", { type: "warning" });
          editor.current?.toBlob({
            type: Data.load(meta.slug, "exportType") ?? "image/webp",
            quality: Data.load(meta.slug, "exportQuality") ?? 1,
          }).then(blob => {
            internals.uploadDispatcher.setFile({
              channelId: upload.channelId,
              id: upload.id,
              draftType,
              file: {
                file: new File([blob], upload.item.file.name.match(/.*\./i)[0] + (blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg"), { type: blob.type }),
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
          const channelId = internals.SelectedChannelStore.getCurrentlySelectedChannelId();
          if (!channelId) return;

          UI.showToast("Processing...", { type: "warning" });
          editor.current?.toBlob({
            type: Data.load(meta.slug, "exportType") ?? "image/webp",
            quality: Data.load(meta.slug, "exportQuality") ?? 1,
          }).then(blob => {
            internals.uploadDispatcher.addFile({
              file: {
                file: new File([blob], `image.${(blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg")}`, { type: blob.type }),
                isThumbnail: false,
                origin: "clipboard",
                platform: 1     // 0: React Native, 1: Web
              },
              channelId,
              showLargeMessageDialog: false,
              draftType: 0,
            })
            UI.showToast("Saved changes", { type: "success" });
          }).catch(() => {
            UI.showToast("Failed to process image.", { type: "error" });
          });
        }
      }), []);

      const updateClipRect = useCallback(() => {
        const clipRect = editor.current.clipRect;
        if (!clipRect) return;

        overlay.current.style.setProperty("--cx1", `${100 * clipRect.left}%`);
        overlay.current.style.setProperty("--cx2", `${100 * clipRect.right}%`);
        overlay.current.style.setProperty("--cy1", `${100 * clipRect.top}%`);
        overlay.current.style.setProperty("--cy2", `${100 * clipRect.bottom}%`);
      }, []);

      const updateRegionRect = useCallback(() => {
        const rect = editor.current.regionRect;
        if (!rect) return;

        overlay.current.style.setProperty("--rx1", `${100 * rect.left}%`);
        overlay.current.style.setProperty("--rx2", `${100 * rect.right}%`);
        overlay.current.style.setProperty("--ry1", `${100 * rect.top}%`);
        overlay.current.style.setProperty("--ry2", `${100 * rect.bottom}%`);
      }, [])

      const syncStates = useCallback(() => {
        setCanUndoRedo(editor.current.canUndo << 1 ^ editor.current.canRedo);
        setDims(d => {
          const { width, height } = editor.current.canvasDims;
          if (d.width === width && d.height === height)
            return d;
          editor.current.startRegionSelect(new DOMPoint(0, 0));
          editor.current.endRegionSelect();
          ["--cx1", "--cx2", "--cy1", "--cy2"].forEach(a => { overlay.current.style.removeProperty(a) });
          return { width, height }
        });
        setLayers(editor.current.layers.map((layer, i) => ({
          visible: layer.state.isVisible,
          adjustments: layer.state.adjustments,
          active: i === editor.current.activeLayerIndex,
          name: layer.layer.name,
          id: layer.layer.id,
        })));
      }, []);

      useEffect(() => {
        const rect = canvasRef.current.offsetParent.getBoundingClientRect();
        canvasRef.current.width = ~~(rect.width);
        canvasRef.current.height = ~~(rect.height);
        canvasRect.current = canvasRef.current.getBoundingClientRect();
        editor.current = new CanvasEditor(canvasRef.current, bitmap);
        setLayers(editor.current.layers.map((layer, i) => ({
          visible: layer.state.isVisible,
          adjustments: layer.state.adjustments,
          active: i === editor.current.activeLayerIndex,
          name: layer.layer.name,
          id: layer.layer.id
        })));

        const ctrl = new AbortController();
        addEventListener("keydown", e => {
          if (document.activeElement.tagName === "INPUT") return;

          let matchedCase = true;
          switch (e.key) {
            case !isInteracting.current && (e.ctrlKey || e.metaKey) && "z":
              if (editor.current.undo()) { e.preventDefault(); syncStates() };
              break;

            case !isInteracting.current && (e.ctrlKey || e.metaKey) && "y":
              if (editor.current.redo()) { e.preventDefault(); syncStates() };
              break;

            case !isInteracting.current && !e.repeat && (e.ctrlKey || e.metaKey) && DiscordNative?.clipboard?.copyImage && "c":
              UI.showToast("Processing...", { type: "warning" });
              editor.current.toBlob({
                type: 'image/png'
              }).then(blob =>
                blob.arrayBuffer()
              ).then(buffer => {
                DiscordNative.clipboard.copyImage(new Uint8Array(buffer), "image.png");
              }).then(() => {
                UI.showToast("Image copied", { type: "success" })
              }).catch(() => {
                UI.showToast("Failed to copy image", { type: "error" })
              });
              break;

            case !e.repeat && (e.ctrlKey || e.metaKey) && "b":
              editor.current.resetViewport();
              editor.current.refreshViewport();
              if (canvasRef.current?.matches(".rotating")) {
                overlay.current.style.removeProperty("--translate");
              }
              if (canvasRef.current?.matches(".texting")) {
                updateRegionRect();
              }
              updateClipRect();
              break;

            case !e.repeat && !(e.ctrlKey || e.metaKey) && "c":
              setMode(m => m === 0 ? null : 0);
              break;

            case !e.repeat && !(e.ctrlKey || e.metaKey) && "r":
              setMode(m => m === 1 ? null : 1);
              break;

            case !e.repeat && !(e.ctrlKey || e.metaKey) && "m":
              setMode(m => m === 2 ? null : 2);
              break;

            case !e.repeat && !(e.ctrlKey || e.metaKey) && "s":
              setMode(m => m === 3 ? null : 3);
              break;

            case !e.repeat && !(e.ctrlKey || e.metaKey) && "b":
              setMode(m => m === 4 ? null : 4);
              break;

            case !e.repeat && !(e.ctrlKey || e.metaKey) && "t":
              setMode(m => m === 5 ? null : 5);
              break;

            case !e.repeat && !(e.ctrlKey || e.metaKey) && "e":
              setMode(m => m === 6 ? null : 6);
              break;

            case !e.repeat && "p":
              if (e.ctrlKey || e.metaKey) {
                if (isInteracting.current) break;
                editor.current.startRegionSelect(new DOMPoint(0, 0));
                editor.current.endRegionSelect();
                ["--cx1", "--cx2", "--cy1", "--cy2"].forEach(a => { overlay.current.style.removeProperty(a) });
              } else {
                setMode(m => m === 7 ? null : 7);
              }
              break;

            case !e.repeat && canvasRef.current.matches(".drawing") && "Shift": {
              const lastPoint = editor.current.lastPoint;
              if (!lastPoint || isInteracting.current) break;
              overlay.current.style.setProperty("--line-from", `${lastPoint.x}px ${lastPoint.y}px`);
              overlay.current.style.setProperty("--phi", "0deg");
              overlay.current.style.setProperty("--r", "0px");
              break;
            }

            case "Escape": {
              if (!isInteracting.current && editor.current.clipRect) {
                editor.current.startRegionSelect(new DOMPoint(0, 0));
                editor.current.endRegionSelect();
                ["--cx1", "--cx2", "--cy1", "--cy2"].forEach(a => { overlay.current.style.removeProperty(a) });
                break;
              }
              if (isInteracting.current && !canvasRef.current.matches(".texting")) {
                break;
              }
              // Intentional fall-through
            }

            default: {
              matchedCase = false;
            }
          }
          matchedCase && e.stopPropagation();
        }, { signal: ctrl.signal, capture: true });
        addEventListener("keyup", e => {
          if (e.key === "Shift") {
            overlay.current.style.removeProperty("--line-from");
            overlay.current.style.removeProperty("--phi");
            overlay.current.style.removeProperty("--r");
          }
        }, ctrl);
        addEventListener("resize", () => {
          const rect = canvasRef.current.offsetParent.getBoundingClientRect();
          editor.current.viewportDims = { width: ~~(rect.width), height: ~~(rect.height) };
          editor.current.setImageSmoothing(Data.load(meta.slug, "smoothing") ?? "auto")
          editor.current.refreshViewport();

          updateClipRect();
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
              syncStates();
              break;
            }
          }
        }, { signal: ctrl.signal, capture: true });

        return () => {
          ctrl.abort();
          editor.current = null;
          bitmap?.close();
        }
      }, []);

      /** @type {(e: React.MouseEvent<HTMLElement>) => void} */
      const handleMouseMove = useCallback(e => {
        if (mode !== 4 && mode !== 6 || (e.buttons & ~4)) return;

        if (e.shiftKey) {
          const lastPoint = editor.current.lastPoint;
          if (!lastPoint) return;
          overlay.current.style.setProperty("--line-from", `${lastPoint.x}px ${lastPoint.y}px`);
          const phi = utils.atan2(e.clientX - canvasRect.current.x - lastPoint.x, e.clientY - canvasRect.current.y - lastPoint.y);
          const r = Math.hypot(e.clientY - canvasRect.current.y - lastPoint.y, e.clientX - canvasRect.current.x - lastPoint.x);
          overlay.current.style.setProperty("--phi", `${phi || 0}deg`);
          overlay.current.style.setProperty("--r", `${r || 0}px`);
        } else if (overlay.current.style.getPropertyValue("--r")) {
          ["--line-from", "--phi", "--r"].forEach(prop => { overlay.current.style.removeProperty(prop) });
        }
      }, [mode]);

      const handleWheel = hooks.useDebouncedWheel({
        onChange: (e) => {
          if (mode === 3 && !(e.ctrlKey || e.metaKey)) {
            const delta = 1 - 0.05 * Math.sign(e.deltaY);
            const { x: ctx, y: cty } = utils.getTranslate(editor.current.viewportTransform);
            const viewportScale = utils.getScale(editor.current.viewportTransform);
            const boxScale = canvasRect.current.width / canvasRef.current.width;

            const Tx = (e.clientX - (canvasRect.current.x + canvasRect.current.width / 2 + ctx * boxScale)) / viewportScale;
            const Ty = (e.clientY - (canvasRect.current.y + canvasRect.current.height / 2 + cty * boxScale)) / viewportScale;

            editor.current.previewLayerTransformBy(new DOMMatrix().scaleSelf(delta, delta, 1, Tx, Ty));

            const cs = utils.getScale(editor.current.previewLayerTransform).toFixed(2);
            auxRef.current?.previewValue(cs);

            isInteracting.current = true;
          } else {
            const delta = 1 - 0.05 * Math.sign(e.deltaY);
            const x = (e.clientX - canvasRect.current.x) / canvasRect.current.width;
            const y = (e.clientY - canvasRect.current.y) / canvasRect.current.height;
            editor.current.scaleViewportBy(delta, x, y);
            updateClipRect()

            switch (mode) {
              case 1: {
                const { x: ctx, y: cty } = utils.getTranslate(editor.current.viewportTransform);
                overlay.current.style.setProperty("--translate", `${ctx.toFixed(1)}px ${cty.toFixed(1)}px`);
                break;
              }
              case isInteracting.current && 5: {
                updateRegionRect();
                break;
              }
              case 4:
              case 6: {
                handleMouseMove(e);
                break;
              }
            }
          }
        },
        onSubmit: () => {
          if (mode === 3 && isInteracting.current) {
            isInteracting.current = false;
            editor.current.finalizeLayerPreview();
            syncStates();

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

          if (mode !== 5 && !(e.buttons & 4 || mode == null || mode === 3)) isInteracting.current = true;

          switch (mode) {
            case !!(e.buttons & 1) && 7:
            case !!(e.buttons & 1) && 0: {
              canvasRef.current.classList.add("pointerdown");
              const boxScale = canvasRect.current.width / canvasRef.current.width;
              const startX = (e.clientX - canvasRect.current.x) / boxScale;
              const startY = (e.clientY - canvasRect.current.y) / boxScale;
              editor.current.startRegionSelect(new DOMPoint(startX, startY), mode === 0 ? fixedAspect : false);
              ["--cx1", "--cx2", "--cy1", "--cy2"].forEach(a => { overlay.current.style.removeProperty(a) });
              break;
            }
            case !!(e.buttons & 1) && 1: {
              canvasRef.current.classList.add("pointerdown");
              break;
            }
            case !!(e.buttons & 1) && 5: {
              store.changed = true;

              const boxScale = canvasRect.current.width / canvasRef.current.width;
              const startX = (e.clientX - canvasRect.current.x) / boxScale;
              const startY = (e.clientY - canvasRect.current.y) / boxScale;
              editor.current.insertTextAt(new DOMPoint(startX, startY), `${font.weight} ${strokeStyle.width}px ${font.family}`, strokeStyle.color);
              editor.current.updateText();
              updateRegionRect();
              break;
            }
            case !!(e.buttons & 1) && 4:
            case !!(e.buttons & 1) && 6: {
              store.changed = true;

              const lastPoint = editor.current.lastPoint;
              if (e.shiftKey && lastPoint) {
                const boxScale = canvasRect.current.width / canvasRef.current.width;
                const toX = (e.clientX - canvasRect.current.x) / boxScale;
                const toY = (e.clientY - canvasRect.current.y) / boxScale;

                editor.current.startDrawing(
                  lastPoint,
                  strokeStyle.width,
                  strokeStyle.color,
                  mode === 6 ? "destination-out" : "source-over"
                );

                editor.current.lineTo(new DOMPoint(toX, toY));

                canvasRef.current.releasePointerCapture(e.pointerId);

                ["--line-from", "--phi", "--r"].forEach(prop => { overlay.current.style.removeProperty(prop) });
              } else {
                const boxScale = canvasRect.current.width / canvasRef.current.width;
                const startX = (e.clientX - canvasRect.current.x) / boxScale;
                const startY = (e.clientY - canvasRect.current.y) / boxScale;
                editor.current.startDrawing(
                  new DOMPoint(startX, startY),
                  strokeStyle.width,
                  strokeStyle.color,
                  mode === 6 ? "destination-out" : "source-over"
                );
              }
              break;
            }
          }
        },
        onChange: (e, store) => {
          if (e.buttons & 4 || mode == null || mode === 3) {
            const dx = (e.clientX - store.startX) / canvasRect.current.width * canvasRef.current.width;
            const dy = (e.clientY - store.startY) / canvasRect.current.height * canvasRef.current.height;
            editor.current.translateViewportBy(dx, dy);

            updateClipRect();

            if (isInteracting.current && mode === 5) {
              updateRegionRect();
            }

            if (mode === 1) {
              const { x: ctx, y: cty } = utils.getTranslate(editor.current.viewportTransform);
              overlay.current.style.setProperty("--translate", `${ctx.toFixed(1)}px ${cty.toFixed(1)}px`);
            }

            if (e.shiftKey && (mode === 4 || mode === 6)) {
              handleMouseMove(e);
            }
          } else {
            store.changed = true;
            switch (mode) {
              case 7:
              case 0: {
                const boxScale = canvasRect.current.width / canvasRef.current.width;
                const startX = (e.clientX - canvasRect.current.x) / boxScale;
                const startY = (e.clientY - canvasRect.current.y) / boxScale;
                editor.current.regionSelect(new DOMPoint(startX, startY));

                updateClipRect();
                break;
              }
              case 1: {
                const currentTranslate = utils.getTranslate(editor.current.viewportTransform);
                const boxScale = canvasRect.current.width / canvasRef.current.width;

                const currentX = e.clientX - (canvasRect.current.x + canvasRect.current.width / 2 + currentTranslate.x * boxScale);
                const currentY = e.clientY - (canvasRect.current.y + canvasRect.current.height / 2 + currentTranslate.y * boxScale);

                const previousX = currentX - (e.clientX - store.startX);
                const previousY = currentY - (e.clientY - store.startY);

                const dTheta = utils.atan2(
                  previousX * currentX + previousY * currentY,
                  previousX * currentY - previousY * currentX
                );

                editor.current.previewLayerTransformBy(new DOMMatrix().rotateSelf(dTheta));

                const cr = utils.getAngle(editor.current.previewLayerTransform).toFixed(1);
                auxRef.current?.previewValue(cr);
                break;
              }
              case 5: {
                store.changed = true;

                const boxScale = canvasRect.current.width / canvasRef.current.width;
                const startX = (e.clientX - canvasRect.current.x) / boxScale;
                const startY = (e.clientY - canvasRect.current.y) / boxScale;
                editor.current.insertTextAt(new DOMPoint(startX, startY), `${font.weight} ${strokeStyle.width}px ${font.family}`, strokeStyle.color);
                editor.current.updateText();
                updateRegionRect();
                break;
              }
              case 2: {
                const dx = (e.clientX - store.startX) / utils.getScale(editor.current.viewportTransform);
                const dy = (e.clientY - store.startY) / utils.getScale(editor.current.viewportTransform);
                editor.current.previewLayerTransformBy(new DOMMatrix().translateSelf(dx, dy));
                break;
              }
              case 6:
              case 4: {
                const boxScale = canvasRect.current.width / canvasRef.current.width;
                const startX = (e.clientX - canvasRect.current.x) / boxScale;
                const startY = (e.clientY - canvasRect.current.y) / boxScale;
                editor.current.curveTo(new DOMPoint(startX, startY));
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
          if (mode !== 5 && !(e.buttons & 4 || mode == null || mode === 3)) isInteracting.current = false;

          switch (mode) {
            case 7: {
              editor.current.endRegionSelect();
              canvasRef.current.classList.remove("pointerdown");
              ["--cx1", "--cx2", "--cy1", "--cy2"].forEach(a => { overlay.current.style.removeProperty(a) });
              updateClipRect();
              break;
            }
            case 0: {
              editor.current.endRegionSelect();
              canvasRef.current.classList.remove("pointerdown");
              ["--cx1", "--cx2", "--cy1", "--cy2"].forEach(a => { overlay.current.style.removeProperty(a) });
              if (store.changed && editor.current.cropToRegionRect()) {
                syncStates();
                editor.current.resetViewport();
                editor.current.refreshViewport();
              };
              break;
            }
            case store.changed && 1: {
              canvasRef.current.classList.remove("pointerdown");
              const cr = utils.getAngle(editor.current.previewLayerTransform).toFixed(1);
              auxRef.current?.setValue(cr);
            } // Intentional fall-through
            case store.changed && 2: {
              editor.current.finalizeLayerPreview();
              syncStates();
              break;
            }
            case store.changed && 5: {
              isInteracting.current = true;
              textarea.current.focus();
              break;
            }
            case store.changed && 4:
            case store.changed && 6: {
              editor.current.endDrawing();
              syncStates();
              break;
            }
          }
        }
      });

      return jsx(Fragment, {
        children: [
          jsx("div", {
            className: "canvas-wrapper",
            children: [
              jsx("canvas", {
                className: utils.clsx("canvas", ["cropping", "rotating", "moving", "scaling", "drawing", "texting", "drawing", "selecting"][mode]),
                ref: canvasRef,
                onWheel: handleWheel,
                onMouseMove: handleMouseMove,
                ...pointerHandlers,
              }),
              jsx("div", {
                className: "canvas-overlay",
                ref: overlay,
                children: [
                  jsx("div", { className: "cropper-region" }),
                  jsx("div", {
                    className: "cropper-border",
                    children: mode === 5 && jsx(Components.TextAreaHidden, {
                      ref: textarea,
                      onSubmit: () => {
                        editor.current.finalizeText();
                        syncStates();
                        isInteracting.current = false;
                        ["--rx1", "--rx2", "--ry1", "--ry2"].forEach(prop => { overlay.current.style.removeProperty(prop) });
                      },
                      onChange: value => {
                        editor.current.updateText(value);
                        updateRegionRect();
                      }
                    })
                  })
                ]
              })
            ]
          }),
          jsx("aside", {
            className: utils.clsx("sidebar", internals.scrollbarClass?.thin),
            children: [
              jsx(Components.Resizer, {
                dimensions: dims,
                layerCount: editor.current?.layers.length ?? 0,
                onCanvasResize: ({ width: w, height: h }) => {
                  const { width, height } = editor.current.canvasDims;
                  if (w === width && h === height) return;

                  editor.current.canvasDims = { width: w, height: h };
                  editor.current.resetViewport();
                  editor.current.fullRender();
                  syncStates();
                },
                onImageResize: p => {
                  if (p === 1) return;

                  const { width, height } = editor.current.canvasDims;
                  const newWidth = Math.round(width * p);
                  const newHeight = Math.round(height * p);
                  p = Math.max(newWidth / width, newHeight / height);

                  editor.current.canvasDims = { width: newWidth, height: newHeight };
                  editor.current.scale(p, p)
                  editor.current.resetViewport();
                  editor.current.fullRender();
                  syncStates();
                }
              }),
              jsx("div", {
                className: "canvas-actions",
                children: [
                  jsx(Components.IconButton, {
                    tooltip: "Draw (B)",
                    d: utils.paths.Draw,
                    active: mode === 4,
                    onClick: () => setMode(m => m === 4 ? null : 4)
                  }),
                  jsx(Components.IconButton, {
                    tooltip: "Eraser (E)",
                    d: utils.paths.Eraser,
                    active: mode === 6,
                    onClick: () => setMode(m => m === 6 ? null : 6)
                  }),
                  jsx(Components.IconButton, {
                    tooltip: "Text (T)",
                    d: utils.paths.Text,
                    active: mode === 5,
                    onClick: () => setMode(m => m === 5 ? null : 5)
                  }),
                  jsx(Components.IconButton, {
                    tooltip: "Clip (P)",
                    d: utils.paths.Select,
                    active: mode === 7,
                    onClick: () => setMode(m => m === 7 ? null : 7)
                  }),
                  jsx(Components.IconButton, {
                    tooltip: "Move (M)",
                    d: utils.paths.Pan,
                    active: mode === 2,
                    onClick: () => setMode(m => m === 2 ? null : 2)
                  }),
                  jsx(Components.IconButton, {
                    tooltip: "Rotate (R)",
                    d: utils.paths.Rotate,
                    active: mode === 1,
                    onClick: () => setMode(m => m === 1 ? null : 1)
                  }),
                  jsx(Components.IconButton, {
                    tooltip: "Scale (S)",
                    d: utils.paths.Scale,
                    active: mode === 3,
                    onClick: () => setMode(m => m === 3 ? null : 3)
                  }),
                  jsx(Components.IconButton, {
                    tooltip: "Crop (C)",
                    d: utils.paths.Crop,
                    active: mode === 0,
                    onClick: () => setMode(m => m === 0 ? null : 0)
                  }),
                  jsx(Components.IconButton, {
                    tooltip: "Flip Horizontal",
                    d: utils.paths.FlipH,
                    onClick: () => {
                      editor.current.scale(-1, 1);
                      editor.current.fullRender();
                      syncStates();
                      if (mode === 1) {
                        auxRef.current.setValue(utils.getAngle(editor.current.layerTransform).toFixed(1));
                      }
                    },
                  }),
                  jsx(Components.IconButton, {
                    tooltip: "Flip Vertical",
                    d: utils.paths.FlipV,
                    onClick: () => {
                      editor.current.scale(1, -1);
                      editor.current.fullRender();
                      syncStates();
                      if (mode === 1) {
                        auxRef.current.setValue(utils.getAngle(editor.current.layerTransform).toFixed(1));
                      }
                    },
                  }),
                  jsx(Components.IconButton, {
                    tooltip: "Rotate Left",
                    d: utils.paths.RotL,
                    onClick: () => {
                      editor.current.rotate(-90);
                      syncStates();
                      if (mode === 1) {
                        auxRef.current.setValue(utils.getAngle(editor.current.layerTransform).toFixed(1));
                      }
                    },
                  }),
                  jsx(Components.IconButton, {
                    tooltip: "Rotate Right",
                    d: utils.paths.RotR,
                    onClick: () => {
                      editor.current.rotate(90);
                      syncStates();
                      if (mode === 1) {
                        auxRef.current.setValue(utils.getAngle(editor.current.layerTransform).toFixed(1));
                      }
                    },
                  })
                ]
              }),
              jsx("div", {
                className: "aux-inputs",
                children: [
                  (mode === 4 || mode === 5) && jsx(Components.ColorInput, {
                    colors: utils.paintingColors,
                    value: strokeStyle.color,
                    onChange: c => setStrokeStyle(s => ({ ...s, color: c }))
                  }),
                  (mode === 4 || mode === 5 || mode === 6) && jsx(Components.NumberSlider, {
                    ref: auxRef,
                    label: "Size",
                    suffix: "px",
                    minValue: 1,
                    centerValue: 100,
                    maxValue: 400,
                    value: strokeStyle.width,
                    onSlide: value => {
                      switch (mode) {
                        case 4:
                        case 6: {
                          const boxScale = canvasRect.current.width / canvasRef.current.width;
                          const cs = utils.getScale(editor.current.viewportTransform);
                          overlay.current.style.setProperty("--brushsize", (value * cs * boxScale).toFixed(4));
                          break;
                        }
                        case isInteracting.current && 5: {
                          editor.current.updateText(undefined, `${font.weight} ${value}px ${font.family}`);
                          updateRegionRect();
                          break;
                        }
                      }
                    },
                    onChange: value => {
                      switch (mode) {
                        case 4:
                        case 6: {
                          overlay.current.style.removeProperty("--brushsize");
                          break;
                        }
                        case isInteracting.current && 5: {
                          editor.current.updateText(undefined, `${font.weight} ${value}px ${font.family}`);
                          updateRegionRect();
                          break;
                        }
                      }
                      setStrokeStyle(s => ({ ...s, width: value }));
                    }
                  }),
                  mode === 5 && jsx(Components.ErrorBoundary, null, jsx(Components.FontSelector, { // to-do: Wrap in <Activity/> once Discord hits React 19.2.0
                    value: font,
                    onChange: setFont
                  })),
                  mode === 0 && jsx(Components.IconButton, {
                    tooltip: fixedAspect ? "Preserve aspect ratio" : "Free region select",
                    d: fixedAspect ? utils.paths.Lock : utils.paths.LockOpen,
                    onClick: () => !isInteracting.current && setFixedAspect(e => !e),
                  }),
                  mode === 1 && jsx(Components.NumberSlider, {
                    ref: auxRef,
                    label: "Angle",
                    suffix: "°",
                    withSlider: false,
                    value: editor.current ? Number(utils.getAngle(editor.current.layerTransform).toFixed(1)) : 0,
                    onChange: value => {
                      const cr = utils.getAngle(editor.current.layerTransform);
                      const r = new DOMMatrix().rotateSelf(value - cr);
                      editor.current.previewLayerTransformBy(r);
                      editor.current.finalizeLayerPreview();
                      syncStates();
                    }
                  }),
                  mode === 3 && jsx(Components.NumberSlider, {
                    ref: auxRef,
                    label: "Scale",
                    suffix: "x",
                    decimals: 2,
                    minValue: 0.01,
                    centerValue: 1,
                    maxValue: 10,
                    value: editor.current ? Number(utils.getScale(editor.current.layerTransform).toFixed(2)) : 1,
                    onSlide: s => {
                      const cs = utils.getScale(editor.current.layerTransform);
                      const S = new DOMMatrix().scaleSelf(s / cs, s / cs);
                      editor.current.previewLayerTransformTo(S);
                    },
                    onChange: s => {
                      const cs = utils.getScale(editor.current.layerTransform);
                      const S = new DOMMatrix().scaleSelf(s / cs, s / cs);
                      editor.current.previewLayerTransformTo(S);
                      editor.current.finalizeLayerPreview();
                      syncStates();
                    }
                  }),
                ]
              }),
              jsx(Components.LayerThumbnails, {
                editor: editor,
                width: dims.width,
                height: dims.height,
                layers,
                onChange: syncStates
              }),
              jsx("div", {
                className: "layer-actions",
                children: [
                  jsx(Components.IconButton, {
                    tooltip: "Add Layer",
                    d: utils.paths.AddLayer,
                    onClick: () => {
                      editor.current.createNewLayer();
                      syncStates();
                    }
                  }),
                  jsx(Components.IconButton, {
                    tooltip: "Remove Layer",
                    d: utils.paths.DeleteLayer,
                    disabled: layers.length <= 1,
                    onClick: () => {
                      editor.current.deleteLayer();
                      syncStates();
                    }
                  }),
                  jsx(Components.IconButton, {
                    tooltip: "Move Layer Up",
                    d: utils.paths.MoveLayerUp,
                    disabled: editor.current?.activeLayerIndex >= layers.length - 1,
                    onClick: () => {
                      editor.current.moveLayers(1);
                      syncStates();
                    }
                  }),
                  jsx(Components.IconButton, {
                    tooltip: "Move Layer Down",
                    d: utils.paths.MoveLayerDown,
                    disabled: editor.current?.activeLayerIndex <= 0,
                    onClick: () => {
                      editor.current.moveLayers(-1);
                      syncStates();
                    }
                  }),
                ]
              }),
              jsx("div", {
                className: "undo-redo-actions",
                children: [
                  jsx(Components.IconButton, {
                    tooltip: "Undo (Ctrl + Z)",
                    d: utils.paths.Undo,
                    onClick: () => { if (editor.current.undo()) syncStates() },
                    disabled: !(canUndoRedo & 2)
                  }),
                  jsx(Components.IconButton, {
                    tooltip: "Redo (Ctrl + Y)",
                    d: utils.paths.Redo,
                    onClick: () => { if (editor.current.redo()) syncStates() },
                    disabled: !(canUndoRedo & 1)
                  }),
                  jsx(Components.Settings, {
                    onChange: ({ smoothing, background }) => {
                      if (smoothing != null) editor.current.setImageSmoothing(smoothing);
                      if (background != null) editor.current.backgroundColor = background;
                      editor.current.refreshViewport();
                    }
                  })
                ]
              })
            ]
          }),
        ]
      })
    },

    /**
     * @param {{
     *  dimensions: {width: number, height: number}, onImageResize: (percentage: number) => void,
     *  layerCount: number, onCanvasResize: ({width: number, height: number}) => void
     * }}
     */
    Resizer({ dimensions, layerCount, onCanvasResize, onImageResize }) {
      /** @type {React.RefObject<{mode: number, keepAspect: boolean}?>} */
      const resize = useRef(Data.load(meta.slug, "resize") ?? { mode: 0, keepAspect: false });
      const menuData = useRef({ ...dimensions, canvasP: 100, imageP: 100 });

      const handleClick = e => {
        Object.assign(menuData.current, { width: dimensions.width, height: dimensions.height, canvasP: 100, imageP: 100 });
        const id = ContextMenu.open(e, ContextMenu.buildMenu([{
          label: "resize-selector",
          type: "custom",
          render: () => jsx(Components.ErrorBoundary, null, jsx(Components.MenuItemSelect, {
            label: "Resize...",
            options: [
              { label: "Canvas (px)", value: 0 },
              { label: "Canvas (%)", value: 1 },
              { label: "Image  (%)", value: 2 },
            ],
            initialValue: resize.current.mode,
            onChange: v => {
              resize.current.mode = v;
              Data.save(meta.slug, "resize", resize.current);
            }
          }))
        }, {
          label: "resizer",
          type: "custom",
          render: () => jsx("div", {
            className: utils.clsx(internals.contextMenuClass?.item, internals.contextMenuClass?.labelContainer),
            children: [
              jsx("style", null, `@scope {
                :scope {
                  display: grid;
                  justify-content: stretch;
                  font-size: 16px;
                  cursor: auto;
                }

                .number-input-wrapper label { font-size: 0.875em }
                #resizer-x .number-input { anchor-name: --resizer-x }
                #resizer-y .number-input { anchor-name: --resizer-y }

                .resizer-lock {
                  position: absolute;
                  top: anchor(--resizer-x center);
                  bottom: anchor(--resizer-y center);
                  right: max(anchor(--resizer-x left) + 8px, anchor(--resizer-y left) + 8px);
                  display: grid;
                  
                  .icon-button {
                    background: none;
                    padding: 0;
                    width: auto;
                    height: auto;
                    svg {
                      width: 14px;
                      height: 14px;
                    }
                  }
                  &::before,
                  &::after {
                    content: "";
                    position: relative;
                    left: 50%;
                    width: calc(50% + 4px);
                    border-inline-start: 1px solid hsl(from currentColor h s l / 0.5);
                  }
                  &::before {
                    border-block-start: 1px solid hsl(from currentColor h s l / 0.5);
                    border-start-start-radius: 4px;
                  }
                  &::after {
                    border-block-end: 1px solid hsl(from currentColor h s l / 0.5);
                    border-end-start-radius: 4px;
                  }
                }
              }`),
              resize.current.mode === 0 && jsx(Fragment, null,
                jsx(Components.NumberSlider, {
                  id: "resizer-x",
                  value: menuData.current.width,
                  minValue: 1,
                  label: "Width",
                  suffix: "px",
                  withSlider: false,
                  onChange: v => {
                    menuData.current.width = Math.round(v);
                    if (resize.current.keepAspect) {
                      menuData.current.height = Math.round(menuData.current.width * dimensions.height / dimensions.width);
                    }
                  }
                }),
                jsx(Components.NumberSlider, {
                  id: "resizer-y",
                  value: menuData.current.height,
                  minValue: 1,
                  label: "Height",
                  suffix: "px",
                  withSlider: false,
                  onChange: v => {
                    menuData.current.height = Math.round(v);
                    if (resize.current.keepAspect) {
                      menuData.current.width = Math.round(menuData.current.height * dimensions.width / dimensions.height);
                    }
                  }
                }),
                jsx("div", {
                  className: "resizer-lock",
                  children: jsx(Components.IconButton, {
                    d: resize.current.keepAspect ? utils.paths.Lock : utils.paths.LockOpen,
                    onClick: (e) => {
                      resize.current.keepAspect = !resize.current.keepAspect;
                      if (resize.current.keepAspect) {
                        menuData.current.height = Math.round(menuData.current.width * dimensions.height / dimensions.width);
                      }
                      e.currentTarget.blur();
                      e.currentTarget.focus();
                      Data.save(meta.slug, "resize", resize.current)
                    }
                  })
                })
              ),
              resize.current.mode === 1 && jsx(Components.NumberSlider, {
                value: menuData.current.canvasP,
                minValue: 0.1,
                label: "Scale",
                decimals: 1,
                suffix: "%",
                withSlider: false,
                onChange: v => { menuData.current.canvasP = v }
              }),
              resize.current.mode === 2 && jsx(Components.NumberSlider, {
                value: menuData.current.imageP,
                minValue: 0.1,
                label: "Scale",
                decimals: 1,
                suffix: "%",
                withSlider: false,
                onChange: v => { menuData.current.imageP = v }
              })
            ]
          })
        }, { type: "separator" }, {
          label: "size-indicator",
          type: "custom",
          render: () => jsx("div", {
            children: [
              jsx("style", null, `@scope { :scope {
                display: flex;
                align-items: flex-end;
                justify-content: flex-end;
                gap: 4px;
                padding-inline: 8px;
                font-size: smaller;
              } }`),
              jsx("span", { style: { marginInlineEnd: "auto" } },
                `${((resize.current.mode === 0 ? menuData.current.width * menuData.current.height :
                  resize.current.mode === 1 ? Math.round(dimensions.width * dimensions.height * menuData.current.canvasP ** 2 / 100 ** 2) :
                    Math.round(dimensions.width * dimensions.height * menuData.current.imageP ** 2 / 100 ** 2)) * layerCount / 65536).toFixed(2)} MiB`
              ),
              jsx("span", null,
                resize.current.mode === 0 ? menuData.current.width :
                  resize.current.mode === 1 ? Math.round(dimensions.width * menuData.current.canvasP / 100) :
                    Math.round(dimensions.width * menuData.current.imageP / 100)
              ),
              jsx("span", null, "⨯"),
              jsx("span", null,
                resize.current.mode === 0 ? menuData.current.height :
                  resize.current.mode === 1 ? Math.round(dimensions.height * menuData.current.canvasP / 100) :
                    Math.round(dimensions.height * menuData.current.imageP / 100)
              ),
            ]
          })
        }, {
          label: "save",
          type: "custom",
          render: () => jsx(Components.ErrorBoundary, null, jsx("div", {
            style: { minWidth: 200 },
            className: utils.clsx(internals.contextMenuClass?.item, internals.contextMenuClass?.labelContainer),
            children: jsx(internals.ManaButton, {
              size: "sm",
              fullWidth: true,
              text: "Apply",
              onClick: () => {
                switch (resize.current.mode) {
                  case 0: {
                    onCanvasResize({ width: menuData.current.width, height: menuData.current.height });
                    break;
                  }
                  case 1: {
                    const newWidth = Math.round(dimensions.width * menuData.current.canvasP / 100);
                    const newHeight = Math.round(dimensions.height * menuData.current.canvasP / 100);
                    onCanvasResize({ width: newWidth, height: newHeight });
                    break;
                  }
                  case 2: {
                    onImageResize(menuData.current.imageP / 100)
                    break;
                  }
                }
                ContextMenu.close(id);
              }
            })
          }))
        }]), {
          align: "top",
          position: "left"
        })
      };

      return jsx("span", {
        className: "canvas-dims",
        children: jsx(internals.ManaButton, {
          variant: "secondary",
          fullWidth: true,
          size: "sm",
          text: jsx("div", {
            className: "canvas-dims-resizer",
            children: [
              jsx("span", { className: "canvas-dims-resizer-number" }, dimensions.width),
              jsx("span", null, "⨯"),
              jsx("span", { className: "canvas-dims-resizer-number" }, dimensions.height),
            ]
          }),
          onClick: handleClick
        }),
      })
    },

    /** @param {{onChange?: (e: {exportType?: string, smoothing?: string | false, background?: string}) => void}} */
    Settings({ onChange }) {
      const [exportType, setExportType] = hooks.useStoredState("exportType", "image/webp");
      const [exportQuality, setExportQuality] = hooks.useStoredState("exportQuality", 1);
      const [smoothing, setSmoothing] = hooks.useStoredState("smoothing", "auto");
      const [background, setBackground] = hooks.useStoredState("backgroundColor", "#303038")

      const exportOptions = useRef([{ label: "jpg", value: "image/jpeg" }, { label: "png", value: "image/png" }, { label: "webp", value: "image/webp" }]);
      const smoothingOptions = useRef(["Auto", "High", "Medium", "Low", "Off"].map(e => ({ label: e, value: e.toLowerCase() })));
      /** @type {React.RefObject<{setValue: (value: number) => void}>} */
      const exportQualityRef = useRef(null);

      const handleClick = (e) => {
        ContextMenu.open(e, ContextMenu.buildMenu([{
          label: "background",
          type: "custom",
          render: () => jsx("div", {
            className: utils.clsx(internals.contextMenuClass?.item, internals.contextMenuClass?.labelContainer),
            children: [
              jsx("style", null, `@scope {
                :scope { 
                  display: grid;
                  grid-template-columns: 1fr;
                  gap: 4px;
                }
                .bd-color-picker-container {
                  display: grid;
                  gap: 4px;
                }
                .bd-color-picker-swatch {
                  max-width: 156px;
                  margin: 0 !important;
                  display: grid;
                  place-items: center;
                  grid-template-columns: repeat(auto-fill, minmax(21px, 1fr));
                }
                .bd-color-picker {
                  width: 155px;
                  height: 56px;
                  outline: 1px solid var(--border-normal);
                }
                .bd-color-picker-swatch-item {
                  margin: 3px;
                  outline: 1px solid var(--border-normal);
                }
              }`),
              jsx("span", null, "Background color"),
              jsx(Components.ColorInput, {
                colors: utils.backgroundColors,
                value: background,
                onChange: bg => {
                  setBackground(bg);
                  onChange({ background: bg })
                }
              })
            ]
          })
        }, {
          label: "Smoothing",
          type: "custom",
          render: () => jsx(Components.ErrorBoundary, null, jsx(Components.MenuItemSelect, {
            label: "Image smoothing",
            options: smoothingOptions.current,
            initialValue: smoothing,
            onChange: s => {
              setSmoothing(s);
              onChange?.({ smoothing: s })
            }
          }))
        }, {
          label: "Export",
          type: "custom",
          render: () => jsx(Components.ErrorBoundary, null, jsx(Fragment, null,
            jsx(Components.MenuItemSelect, {
              label: "Export as",
              options: exportOptions.current,
              initialValue: exportType,
              onChange: setExportType
            }),
            jsx(Components.NumberSlider, {
              className: utils.clsx(internals.contextMenuClass?.item, internals.contextMenuClass?.labelContainer),
              value: exportQuality,
              minValue: 0,
              maxValue: 1,
              label: "Export Quality",
              decimals: 2,
              expScaling: false,
              ref: exportQualityRef,
              onChange: val => {
                const value = utils.clamp(0, val, 1);
                setExportQuality(value);
                exportQualityRef.current.setValue(value);
              }
            })
          )
          )
        }]), {
          align: "bottom",
          position: "left"
        })
      };

      return jsx(Components.IconButton, {
        tooltip: "Settings",
        d: utils.paths.Settings,
        onClick: handleClick,
      });
    },

    /**
     * @template T
     * @param {{ initialValue: T, options: { label: string, value: T }[], onChange?: (newValue: T) => void, label?: string }}
     */
    MenuItemSelect({ initialValue, options, onChange, label }) {
      const [value, setValue] = useState(initialValue);

      return jsx("div", {
        className: utils.clsx(internals.contextMenuClass?.item, internals.contextMenuClass?.labelContainer),
        children: [
          jsx("style", null, `@scope {
            :scope {
              display: grid;
              grid-template-columns: 1fr;
              gap: 4px;
            }
            .select { display: unset }
          }`),
          label && jsx("span", null, label),
          jsx(internals.SingleSelect, {
            options: options,
            value: value,
            className: "select",
            onChange: v => {
              setValue(v);
              onChange?.(v);
            }
          })
        ]
      })
    },

    /** @param {{ value: { family: string, weight: number }, onChange: (e: { family: string, weight: number }) => void }} */
    FontSelector({ onChange, value }) {
      const [family, _setFamily] = useState(() => value.family);
      const [weight, setWeight] = useState(() => value.weight);

      const [familyOptions, setFamilyOptions] = useState(() => []);
      const [weightOptions, setWeightsOptions] = useState(() => []);

      const getWeightsOptions = useCallback((f) => {
        return Array.from({ length: 9 }, (_, i) => {
          const w = (i + 1) * 100;
          const loaded = document.fonts.check(`${w} 1rem ${f}`);
          return loaded ? { value: w, label: w } : null;
        }).filter(Boolean)
      }, []);

      const setFamily = useCallback((newFamily) => {
        const f = newFamily instanceof Function ? newFamily(family) : newFamily;
        const wo = getWeightsOptions(f);
        setWeightsOptions(wo);
        if (wo.every(w => w.label !== weight)) {
          const closest = wo.toSorted((a, b) => Math.abs(a.label - weight) - Math.abs(b.label - weight))[0];
          setWeight(closest.value);
        }
        _setFamily(f);
      }, [])

      useLayoutEffect(() => {
        Promise.all(Array.from(document.fonts, f => f.load())).finally(() => {
          const defaults = ['Arial', 'Arial Black', 'cursive', 'fantasy', 'Garamond', 'Georgia', 'Helvetica', 'monospace', 'sans-serif', 'serif', 'system-ui', 'Tahoma', 'Times New Roman', 'Verdana'];
          const docFonts = Array.from(document.fonts, e => e.family);
          const merged = [...new Set(defaults.concat(docFonts))];
          merged.sort((a, b) => a.localeCompare(b));

          setFamilyOptions(merged.filter(f => document.fonts.check(`1rem ${f}`)).map(e => ({ value: e, label: e })));

          const purifiedFamily = !merged.includes(family) || !document.fonts.check(`1rem ${family}`) ? "gg sans" : family;
          setFamily(purifiedFamily);

          const wo = getWeightsOptions(purifiedFamily);
          setWeightsOptions(wo);

          if (wo.every(w => w.label !== weight)) {
            const closest = wo.toSorted((a, b) => Math.abs(a.label - weight) - Math.abs(b.label - weight))[0];
            setWeight(closest.value);
          }
        });
      }, []);

      return jsx("div", {
        className: "font-selector",
        children: [
          jsx(internals.SingleSelect, {
            options: familyOptions,
            value: family,
            className: "select",
            onChange: f => {
              setFamily(f);
              onChange({ family: f, weight });
            },
            renderOptionValue: ([option]) => jsx("span", { style: { fontFamily: option.value } }, option.value),
            renderOptionLabel: option => jsx("span", {
              ref: node => { option.value === family && node?.scrollIntoView({ block: "nearest" }) },
              style: { fontFamily: option.label, scrollMarginBlock: "24px" },
              children: option.label
            }),
          }),
          jsx(internals.SingleSelect, {
            options: weightOptions,
            value: weight,
            className: "select",
            onChange: w => {
              setWeight(w);
              onChange({ family, weight: w });
            },
            renderOptionValue: ([option]) => jsx("span", { style: { fontFamily: family, fontWeight: option.value } }, option.value),
            renderOptionLabel: option => jsx("span", {
              ref: node => { option.value === weight && node?.scrollIntoView({ block: "nearest" }) },
              style: { fontFamily: family, fontWeight: option.label, scrollMarginBlock: "24px" },
              children: option.label
            }),
          })
        ]
      })
    },

    /** @param {{onChange: (value: string) => void, value: string, colors?: string[], wait?: number}} */
    ColorInput({ onChange, value, colors, wait = 150 }) {
      /** @type {React.RefObject<number | null>} */
      const timer = useRef(null);

      return jsx(BdApi.Components.ColorInput, {
        value,
        colors,
        onChange: c => {
          timer.current && clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            onChange(c)
            timer.current = null;
          }, wait);
        }
      })
    },

    /**
     * @param {{
     *  value: number, onChange?: (e: number) => void, withSlider?: boolean, suffix?: string, label?: string,
     *  ref?: React.RefObject<any>, minValue?: number, centerValue?: number, maxValue?: number,
     *  onSlide?: (e: number) => void, decimals?: number, expScaling?: boolean, className?: string
     * }} props
     */
    NumberSlider({ value, onChange, className, suffix, ref, minValue, centerValue, maxValue, decimals, onSlide, label, withSlider = true, expScaling = true, ...restProps }) {
      const [textValue, setTextValue] = useState(`${value}`);
      const [sliderValue, setSliderValue] = useState(() => expScaling && withSlider ? utils.logScaling(value, { minValue, centerValue, maxValue }) : value);
      const id = useId();
      const oldValue = useRef(value);
      /** @type {React.RefObject<HTMLInputElement?>} */
      const inputRef = useRef(null);
      const sliderRef = useRef(null);

      useImperativeHandle(ref, () => ({
        setValue: v => {
          setTextValue(`${v}`);
          oldValue.current = v;

          if (!withSlider) return;
          const val = expScaling ? utils.logScaling(v, { minValue, centerValue, maxValue }) : v;
          setSliderValue(val);
          sliderRef.current?._reactInternals.stateNode.setState({ value: val });
        },
        previewValue: v => {
          inputRef.current.value = `${v}`;
          if (!withSlider) return;
          const val = expScaling ? utils.logScaling(v, { minValue, centerValue, maxValue }) : v;
          sliderRef.current?._reactInternals.stateNode.setState({ value: val });
        }
      }), [minValue, centerValue, maxValue]);

      useEffect(() => {
        const ctrl = new AbortController();
        inputRef.current?.addEventListener("wheel", e => {
          if (document.activeElement !== e.currentTarget || !e.deltaY || e.buttons) return;
          const delta = -Math.sign(e.deltaY) * (decimals ? 10 ** (-1 * decimals) : 1) * ((e.ctrlKey || e.metaKey) ? 100 : e.shiftKey ? 10 : 1);
          setTextValue(val => {
            val = (Number(val) + delta).toFixed(decimals ?? 0);
            return `${Math.max(Number(val), minValue ?? Number(val))}`;
          });
          e.preventDefault();
        }, { signal: ctrl.signal, passive: false });

        return () => { ctrl.abort() }
      }, [])

      useEffect(() => {
        setTextValue(`${value}`);
        oldValue.current = value;

        if (!withSlider) return;
        const val = expScaling ? utils.logScaling(value, { minValue, centerValue, maxValue }) : value;
        setSliderValue(val);
        sliderRef.current?._reactInternals.stateNode.setState({ value: val });
      }, [value]);

      const handleChange = useCallback(e => {
        setTextValue(e.target.value)
      }, []);

      const handleTextCommit = useCallback(() => {
        const newValue = !Number.isNaN(Number(textValue)) && textValue !== "" ? Math.max(minValue ?? Number(textValue), Number(textValue)) : oldValue.current;
        if (oldValue.current === newValue) return;

        oldValue.current = newValue
        setTextValue(`${oldValue.current}`);
        onChange?.(oldValue.current);

        if (!withSlider) return;
        const val = expScaling ? utils.logScaling(oldValue.current, { minValue, centerValue, maxValue }) : oldValue.current;
        setSliderValue(val);
        sliderRef.current?._reactInternals.stateNode.setState({ value: val });
      }, [onChange, textValue]);

      const handleSliderChange = useCallback(newValue => {
        setSliderValue(newValue);

        let val = expScaling ? utils.expScaling(newValue / 100, { minValue, centerValue, maxValue }) : newValue;
        val = Number(val.toFixed(decimals ?? 0));
        onSlide?.(val);
      }, [onSlide, minValue, centerValue, maxValue]);

      const handleSliderCommit = useCallback(newValue => {
        let val = expScaling ? utils.expScaling(newValue / 100, { minValue, centerValue, maxValue }) : newValue;
        val = Number(val.toFixed(decimals ?? 0));
        if (val === oldValue.current) return;

        setTextValue(`${val}`);
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
            const delta = (e.key === 'ArrowUp' ? 1 : -1) * (decimals ? 10 ** (-1 * decimals) : 1);
            setTextValue(val => {
              val = (Number(val) + delta).toFixed(decimals ?? 0);
              return `${Math.max(Number(val), minValue ?? Number(val))}`;
            });
          }
        }
      }, []);

      const handleBeforeInput = useCallback(e => {
        if (e.data && /[^0-9e+\-.]+/.test(e.data)) e.preventDefault?.();
      }, []);

      const handleMouseEnter = useCallback(e => !e.buttons && !document.activeElement.matches(`.${meta.slug}Root textarea.hiddenVisually`) && e.currentTarget.focus(), []);
      const handleMouseLeave = useCallback(e => e.currentTarget.blur(), []);

      const pointerHanders = hooks.usePointerCapture({
        buttons: 7,
        onStart: (e) => {
          if (!sliderRef.current?.state.boundingRect) {
            // The state for boundingRect will be set internally only *after* the handleMouseDown event fired,
            // so the first mousedown event doesn't have the boundingRect. _reactInternals.stateNode.setState
            // will only update the boundingRect after the render cycle, so we hijack the current state.
            sliderRef.current.state.boundingRect = sliderRef.current.containerRef.current.getBoundingClientRect();
          }
          sliderRef.current?.handleMouseDown(e);
          sliderRef.current?.moveSmoothly(e);
        },
        onChange: (e) => { sliderRef.current?.handleMouseMove(e) },
        onSubmit: (e) => { sliderRef.current?.handleMouseUp(e) },
      })

      return jsx("div", {
        ...restProps,
        className: utils.clsx(className, "number-input-wrapper"),
        children: [
          jsx("style", null, `@scope {
            div& {
              display: flex;
              align-items: center;
              flex-wrap: wrap;
              row-gap: 6px;
              color: var(--interactive-text-active);
              padding-inline: 4px;
            }
            .slider-wrapper {
              cursor: inherit;
              flex-basis: 100%;
              margin-block-start: 6px;
            }
            label {
              cursor: inherit;
              margin-inline-end: 6px;
            }
            .number-input {
              border: 1px solid var(--border-normal);
              border-radius: 6px;
              padding: 4px 8px;
              margin: 2px;
              background: var(--interactive-background-active);
              color: currentColor;
              flex: 1 1 0%;
              width: 0;
              min-width: 1em;
              max-width: 3em;
              margin-left: auto;
              text-align: right;
              font-size: smaller;
            }
          }`),
          label && jsx("label", { htmlFor: id, children: `${label}: ` }),
          jsx("input", {
            className: "number-input",
            id,
            value: textValue,
            ref: inputRef,
            onBlur: handleTextCommit,
            onKeyDown: handleKeyDown,
            onChange: handleChange,
            onBeforeInput: handleBeforeInput,
            onMouseEnter: handleMouseEnter,
            onMouseLeave: handleMouseLeave
          }),
          suffix != null && jsx("span", null, suffix),
          withSlider && internals.MenuSliderControl && jsx("div", {
            ...pointerHanders,
            className: "slider-wrapper",
            children: jsx(internals.MenuSliderControl, {
              ref: sliderRef,
              mini: true,
              className: internals.sliderClass?.slider,
              initialValue: sliderValue,
              minValue: !expScaling ? minValue : undefined,
              maxValue: !expScaling ? maxValue : undefined,
              onValueRender: (newValue) => {
                const val = expScaling ? utils.expScaling(newValue / 100, { minValue, centerValue, maxValue }) : newValue;
                return Number(val.toFixed(decimals ?? 0)) + (suffix ?? '');
              },
              onValueChange: handleSliderCommit,
              asValueChanges: handleSliderChange,
            }),
          })
        ]
      })
    },

    /** @param {{ value: string, onChange?: (value: string) => void, label?: string, className: string }} props */
    TextInput({ value, onChange, label, className }) {
      const [text, setText] = useState(value);
      const oldValue = useRef(value);
      const id = useId();

      const handleChange = useCallback((e) => {
        setText(e.target.value);
      }, []);

      /** @type {(e: React.KeyboardEvent<HTMLInputElement>) => void} */
      const handleKeyDown = useCallback(e => {
        e.stopPropagation();

        if (e.repeat) return;
        switch (e.key) {
          case "Enter": {
            e.currentTarget.blur();
            break;
          }
          case "Escape": {
            setText(oldValue.current);
            break;
          }
          case " ": {
            const start = e.currentTarget.selectionStart;
            const end = e.currentTarget.selectionEnd;
            setText(t => `${t.slice(0, start)} ${t.slice(end)}`);
            requestAnimationFrame(() => {
              e.target.selectionStart = e.target.selectionEnd = start + 1;
            })
            e.preventDefault();
            break;
          }
        }
      }, []);

      const handleBlur = useCallback(e => {
        if (oldValue.current === e.target.value) return;

        if (!e.target.value) {
          setText(oldValue.current);
        } else {
          oldValue.current = e.target.value;
          onChange?.(e.target.value);
        }
      }, [onChange]);

      const handleMouseEnter = useCallback(e => !e.buttons && e.currentTarget.focus(), []);
      const handleMouseLeave = useCallback(e => e.currentTarget.blur(), []);

      return jsx("div", {
        className: utils.clsx(className),
        children: [
          jsx("style", null, `@scope {
            :scope {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 16px;
              padding: 4px 8px;
              color: var(--interactive-text-active);
            }
            .text-input {
              border: 1px solid var(--border-normal);
              border-radius: 6px;
              padding: 4px;
              background: var(--interactive-background-active);
              flex: 0 0 45%;
              min-width: 0;
              color: currentColor;
            }
            label { cursor: inherit }
          )`),
          label && jsx("label", { htmlFor: id }, label),
          jsx("input", {
            id,
            className: "text-input",
            value: text,
            onKeyDown: handleKeyDown,
            onChange: handleChange,
            onBlur: handleBlur,
            onMouseEnter: handleMouseEnter,
            onMouseLeave: handleMouseLeave,
          })
        ]
      })
    },

    /** @param {{ onChange?: (value: string) => void, onSubmit?: () => void, ref?: React.RefObject<any> }} */
    TextAreaHidden({ onChange, onSubmit, ref }) {
      /** @type {React.RefObject<HTMLTextAreaElement?>} */
      const textarea = useRef(null);

      useImperativeHandle(ref, () => ({
        focus: () => {
          if (!textarea.current) return;
          textarea.current.hidden = false;
          textarea.current.focus();
        }
      }))

      const handleChange = useCallback(e => {
        onChange?.(e.target.value);
      }, [onChange])

      /** @type {(e: React.FocusEvent<HTMLTextAreaElement) => void} */
      const handleBlur = useCallback(() => {
        textarea.current.hidden = true;
        onSubmit?.();
        textarea.current.value = "";
      }, [onSubmit]);

      const handleKeyDown = useCallback(e => {
        if (!(e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "Enter" || e.key === "Escape")) {
          textarea.current.blur();
          e.stopPropagation();
        }
      }, [])

      return jsx("textarea", {
        ref: textarea,
        tabIndex: -1,
        hidden: true,
        className: "hiddenVisually",
        onBlur: handleBlur,
        onInput: handleChange,
        onKeyDown: handleKeyDown
      })
    }
  }

  function generateCSS() {
    DOM.addStyle(meta.slug, `@scope (.${meta.slug}Root) {
:scope {
  min-height: unset;
  max-height: unset;
  width: calc(100vw - 72px * 2);
  max-width: 1400px;
  height: calc(100vh - 72px * 2);
  flex-direction: column-reverse;
}

.image-editor {
  height: 100%;
  display: grid;
  gap: 8px;
  grid-template-columns: 1fr auto;
  padding-block: 24px 8px;
  overflow: hidden !important;
}

.modal-footer {
  gap: 12px;
  align-items: center;
}

.canvas-dims {
  justify-items: center;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-normal);
}

.canvas-dims-resizer {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  font-size: 16px;
  
  > * { font-size: smaller }
  > .canvas-dims-resizer-number {
    border-bottom: 1px solid hsl(from currentColor h s l / 0.35);
    padding-inline: 2px;
  }
}

.canvas-wrapper {
  height: 100%;
  overflow: hidden;
  display: grid;
  place-items: center;
  position: relative;
  color: var(--interactive-text-active);
}

.canvas {
  max-width: 100%;
  max-height: 100%;
  border-radius: 8px;
  display: block;
  anchor-name: --canvas;
  overflow: hidden;
  outline: 1px solid var(--border-normal);
  outline-offset: -1px;
  touch-action: none;
  background: repeating-conic-gradient(#666 0 25%, #999 0 50%) 0 0 / 20px 20px fixed content-box;
}
  
.canvas-thumbnail {
  background: repeating-conic-gradient(#666 0 25%, #999 0 50%) 2px 2px / 6px 6px fixed content-box;
}

.canvas:is(.cropping, .drawing, .selecting) {
  cursor: crosshair;
}

.canvas.rotating {
  cursor: grab;
  &.pointerdown {
    cursor: grabbing;
  }
}

.canvas.moving { cursor: move }

.canvas.texting { cursor: text }

@keyframes fade-in {
  from { opacity: 0 }
  to { opacity: 1 }
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
  animation: fade-in 1s infinite alternate ease-out;
}

.canvas-overlay {
  position: absolute;
  pointer-events: none;
  overflow: hidden;
  inset: anchor(--canvas inside);
  container-name: overlay;
}

.canvas.cropping.pointerdown + .canvas-overlay > .cropper-region {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  clip-path: polygon(
    0% 0%, 100% 0%, 100% 100%, 0 100%,
    var(--cx1, 50%) var(--cy2, 50%), var(--cx2, 50%) var(--cy2, 50%), var(--cx2, 50%) var(--cy1, 50%), var(--cx1, 50%) var(--cy1, 50%),
    var(--cx1, 50%) var(--cy2, 50%), 0 100%
  );
}

.canvas.cropping.pointerdown + .canvas-overlay > .cropper-border,
.canvas.selecting.pointerdown + .canvas-overlay > .cropper-region,
.canvas:not(.cropping.pointerdown) + .canvas-overlay > .cropper-region {
  position: absolute;
  border: 1px solid black;
  outline: 1px dashed white;
  outline-offset: -1px;
  left: max(-2px, var(--cx1, -2px));
  right: max(-2px, 100% - var(--cx2, 0px));
  top: max(-2px, var(--cy1, -2px));
  bottom: max(-2px, 100% - var(--cy2, 0px));
  opacity: max(
    min(1000 * (var(--cx2, 0) - var(--cx1, 0)), 1),
    min(1000 * (var(--cy2, 0) - var(--cy1, 0)), 1)
  );
}

.canvas.texting + .canvas-overlay > .cropper-border {
  position: absolute;
  border: 1px solid black;
  outline: 1px dashed white;
  outline-offset: -1px;
  left: max(-2px, var(--rx1, -2px));
  right: max(-2px, 100% - var(--rx2, 0px));
  top: max(-2px, var(--ry1, -2px));
  bottom: max(-2px, 100% - var(--ry2, 0px));
}

@container overlay style(--line-from) {
  .canvas.drawing + .canvas-overlay > .cropper-border {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: top left;
    translate: var(--line-from);
    width: var(--r, 0px);
    rotate: var(--phi, 0rad);
    height: 1px;
    background: white;
    outline: 1px solid grey;
    
    &::before,
    &::after {
      content: '';
      position: absolute;
      outline: 2px solid grey;
      outline-offset: 6px;
      border-radius: 100vmax;
      width: 2px;
      height: 2px;
      translate: 0 -1px;
    }
    &::after { right: -1px }
    &::before { left: -1px }
  }
}

@container overlay style(--brushsize) {
  .canvas.drawing + .canvas-overlay > .cropper-border {
    position: absolute;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    opacity: calc(var(--brushsize, 0) / var(--brushsize, 1));
    width: calc(1px * var(--brushsize, 0) - 1px);
    height: calc(1px * var(--brushsize, 0) - 1px);
    border: 1px solid black;
    background: transparent;
    outline: 1px dashed white;
    outline-offset: -1px;
    border-radius: 100vmax;
    &::before, &::after {
      content: none;
    }
  }
}

.canvas-actions {
  width: 128px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
}

.aux-inputs {
  display: grid;
  gap: 16px;
  grid-template-rows: auto auto 1fr;
  align-self: start;
  align-items: start;
  color: var(--interactive-text-active);
  box-sizing: border-box;
  height: 100%;
  padding-block: 8px;
  border-top: 1px solid var(--border-normal);
  border-bottom: 1px solid var(--border-normal);
}

.hiddenVisually {
  all: unset;
  position: absolute;
  bottom: 0;
  left: 50%;
  opacity: 0;
  z-index: -1000;
  width: 1px;
  height: 1px;
  overflow: hidden;
  scrollbar-width: none;
  clip-path: inset(50%);
}

.font-selector {
  display: grid;
  gap: 6px;
  justify-content: stretch;
  width: 128px;
}

.select { display: inline-block }

.icon-button {
  border-radius: 8px;

  &.active {
    background-color: rgb(from var(--interactive-text-default) r g b / 0.2);
    color: var(--interactive-text-active);
  }

  &.disabled {
    opacity: 0.5;
    cursor: default;
    color: var(--interactive-text-default);
    background: none;
    padding-block: 4px;
  }
}

.bd-color-picker-container {
  display: grid;
  gap: 4px;
}

.bd-color-picker {
  display: block;
  height: 56px;
  width: 127px;
  outline: 1px solid var(--border-normal);
}

.bd-color-picker-swatch {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  place-items: center;
  margin: 0 !important;
}

.bd-color-picker-swatch-item {
  margin: 3px;
  outline: 1px solid var(--border-normal);
}

.sidebar {
  width: 136px;
  display: grid;
  grid-template-rows: auto auto 1fr min-content auto auto;
  gap: 8px;
  align-items: end;
  justify-content: center;
  overflow: auto;
  scrollbar-gutter: stable;
  margin-inline-end: -8px;
  font-size: 16px;
}

.thumbnails {
  --thumbnail-height: 40px;
  max-height: calc((var(--thumbnail-height) + 8px) * 4);
  max-width: 128px;
  box-sizing: content-box;
  overflow: auto;
  overflow-anchor: none;
}

.thumbnails-wrapper {
  display: flex;
  flex-direction: column-reverse;
  
  &::before {
    content: "";
    position: absolute;
    position-anchor: --active-thumbnail;
    inset-inline: anchor(inside);
    bottom: min(anchor(bottom), 100% - anchor-size(height));
    height: anchor-size();
    background: rgb(from var(--interactive-text-default) r g b / 0.2);
    border-radius: 4px;
    pointer-events: none;
    transition: bottom 200ms ease-out;
  }
}

.thumbnail {
  position: relative;
  display: grid;
  align-items: center;
  grid-template-columns: var(--thumbnail-height) 1fr min-content;
  justify-items: center;
  gap: 4px;
  flex: 0 0 var(--thumbnail-height);
  outline: none;
  border-radius: 4px;
  overflow: hidden;
  padding: 4px;
  cursor: pointer;
  color: var(--interactive-text-default);
  transition: background-color 200ms ease;

  &.active {
    anchor-name: --active-thumbnail
  }
  &:hover {
    background: rgb(from var(--interactive-text-default) r g b / 0.1)
  }
}

.thumbnail.droptarget:has(~ .dragging)::after {
  content: "";
  position: absolute;
  bottom: 0;
  z-index: 1;
  height: 2px;
  width: 100%;
  border-radius: 4px;
  background-color: var(--brand-500);
}

.thumbnail.dragging ~ .thumbnail.droptarget::before {
  content: "";
  position: absolute;
  top: 0;
  z-index: 1;
  height: 2px;
  width: 100%;
  border-radius: 4px;
  background-color: var(--brand-500);
}

.icon-button.layer-visibility {
  min-width: 0;
  padding-inline: 0;
  background-color: transparent;
  svg {
    width: 18px;
    height: 18px;
  }
}

.layer-label {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
  font-size: smaller;
  line-height: 1.25;
  text-align: center;
}

.layer-actions {
  display: flex;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-normal);
}

.undo-redo-actions {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  align-items: center;
}
}`);
  }

  return { start, stop };
}
