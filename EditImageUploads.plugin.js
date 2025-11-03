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
  const { createElement: jsx, useState, useEffect, useRef, useImperativeHandle, useCallback, useId, Fragment, cloneElement } = React;

  var internals, ctrl;

  function init() {
    if (internals) return;

    internals = utils.getBulk({
      uploadDispatcher: { filter: Filters.byKeys("setFile") }, // 166459
      uploadCard: { filter: Filters.bySource(".attachmentItemSmall]:") }, // 898463
      nativeUI: { filter: m => m.showToast }, // 481060
      Modal: { filter: Filters.bySource(".MODAL_ROOT_LEGACY,") }, // 466377
      Button: { filter: Filters.bySource("BUTTON_LOADING_STARTED_LABEL,") }, // 906003

      actionButtonClass: { filter: Filters.byKeys("dangerous", "button") },
      actionIconClass: { filter: m => m.actionBarIcon && m[Symbol.toStringTag] != "Module" },
      sliderClass: { filter: Filters.byKeys("sliderContainer", "slider") },
      scrollbarClass: { filter: Filters.byKeys("thin") },
    });

    Object.assign(internals, {
      SelectedChannelStore: Webpack.getStore("SelectedChannelStore"),
      keys: {
        ...utils.getKeysInModule(internals.uploadCard, {
          uploadCard: ".attachmentItemSmall]:",
        }),
        ...utils.getKeysInModule(internals.Button, {
          Button: "BUTTON_LOADING_STARTED_LABEL,"
        }),
        ...utils.getKeysInModule(internals.nativeUI, {
          FocusRing: "FocusRing was given a focusTarget",
          openModal: ",stackNextByDefault:",
          closeModal: ".onCloseCallback()",
          MenuSliderControl: "moveGrabber",
          closeModalInAllContexts: ".onCloseCallback)",
          Popout: "Unsupported animation config:",
        }),
        ...utils.getKeysInModule(internals.Modal, {
          ModalRoot: ".MODAL_ROOT_LEGACY,",
          ModalContent: ",scrollbarType:",
          ModalFooter: "footerSeparator]",
        })
      }
    });
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
      m?.Z && Patcher.after(meta.slug, m.Z, "type", (_, [args], res) => {
        if (args.item.type !== "IMAGE" || args.item.srcIsAnimated || args.item.animated)
          return res;
        return cloneElement(res, {
          children: className => {
            const ret = res.props.children(className);

            const url = utils.toImgSrc(args.item.url, args.item.proxyUrl);
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

    #inc_layer_id;
    #state;
    #activeLayerIndex;

    #bottomCache;
    #middleCache;
    #topCache;
    #interactionCache;

    /** 
     * @param {HTMLCanvasElement} canvas
     * @param {ImageBitmap} bitmap 
     */
    constructor(canvas, bitmap) {
      this.#mainCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      this.#bottomCache = new OffscreenCanvas(bitmap.width, bitmap.height);
      this.#middleCache = new OffscreenCanvas(bitmap.width, bitmap.height);
      this.#topCache = new OffscreenCanvas(bitmap.width, bitmap.height);
      this.#viewportCanvas = canvas;

      const initialScale = Math.min(canvas.width / bitmap.width * 0.95, canvas.height / bitmap.height * 0.95);
      this.#viewportTransform = new DOMMatrix().scaleSelf(initialScale, initialScale);
      this.#viewportTransform_inv = new DOMMatrix()
        .translateSelf(this.#viewportCanvas.width / 2, this.#viewportCanvas.height / 2)
        .multiplySelf(this.#viewportTransform)
        .translateSelf(-this.#mainCanvas.width / 2, -this.#mainCanvas.height / 2)
        .invertSelf();
      this.#staleViewportInv = false;

      this.#inc_layer_id = 0;
      const layer = new Layer(this.#inc_layer_id++, bitmap);
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
        rect: new DOMRect(),
        width: 0,
        color: "#000",
        globalCompositeOperation: "source-over",
        text: "",
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

      this.#bottomCache.getContext("2d").clearRect(0, 0, this.#bottomCache.width, this.#bottomCache.height);
      this.#middleCache.getContext("2d").clearRect(0, 0, this.#middleCache.width, this.#middleCache.height);
      this.#topCache.getContext("2d").clearRect(0, 0, this.#topCache.width, this.#topCache.height);

      this.layers.slice(0, this.#activeLayerIndex).forEach(layer => layer.layer.drawOn(this.#bottomCache));
      this.#activeLayer.drawOn(this.#middleCache);
      this.layers.slice(this.#activeLayerIndex + 1).forEach(layer => layer.layer.drawOn(this.#topCache));
    }

    /** @param {ImageBitmap | null} bitmap */
    createNewLayer(bitmap) {
      const newLayer = new Layer(this.#inc_layer_id++, bitmap instanceof ImageBitmap ? bitmap : { width: this.#mainCanvas.width, height: this.#mainCanvas.height });
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

    /** @param {number} layerIndex  */
    toggleLayerVisibility(layerIndex) {
      if (!(layerIndex in this.layers)) return;

      const isVisible = !this.layers[layerIndex].state.isVisible;
      const updated = { ...this.#state.state, layers: [...this.#state.state.layers] };
      updated.layers[layerIndex] = { ...updated.layers[layerIndex], state: { ...updated.layers[layerIndex].state, isVisible } };
      this.#state.state = updated;
      this.layers[layerIndex].layer.state.isVisible = isVisible;

      this.fullRender();
    }

    /** @param {1 | -1} delta  */
    moveLayers(delta) {
      if (!((this.activeLayerIndex + delta) in this.layers)) return;

      const updated = { ...this.#state.state, layers: [...this.#state.state.layers] };
      [updated.layers[this.activeLayerIndex], updated.layers[this.activeLayerIndex + delta]] = [updated.layers[this.activeLayerIndex + delta], updated.layers[this.activeLayerIndex]];
      this.#state.state = updated;

      this.activeLayerIndex = this.activeLayerIndex + delta;
      this.render();
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
    previewLayerTransformBy(M) {
      this.#activeLayer.previewTransformBy(M);
      const canvas = this.layers.length > 1 ? this.#middleCache : this.#mainCanvas;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.#activeLayer.drawOn(canvas);
      this.layers.length > 1 ? this.render() : this.refreshViewport();
    }
    /** @param {DOMMatrix} M  */
    previewLayerTransformTo(M) {
      this.#activeLayer.previewTransformTo(M);
      const canvas = this.layers.length > 1 ? this.#middleCache : this.#mainCanvas;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.#activeLayer.drawOn(canvas);
      this.layers.length > 1 ? this.render() : this.refreshViewport();
    }
    finalizeLayerPreview() {
      const layerState = this.#activeLayer.finalizePreview();
      const updated = { ...this.#state.state, layers: [...this.#state.state.layers] };
      updated.layers[this.activeLayerIndex] = { ...updated.layers[this.activeLayerIndex], state: layerState };
      this.#state.state = updated;
    }

    /** 
     * @param {DOMPoint} startPoint
     * @param {number} width
     * @param {string} color
     */
    startDrawing(startPoint, width, color, globalCompositeOperation = "source-over") {
      const ctx = (this.layers.length > 1 ? this.#middleCache : this.#mainCanvas).getContext("2d");
      ctx.save();

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
      const isOOB = !utils.pointInRect(this.#interactionCache.lastPoint, new DOMRect(-width / 2, -width / 2, this.#mainCanvas.width + width, this.#mainCanvas.height + width));

      this.#interactionCache.layerTransform_inv = new DOMMatrix()
        .translateSelf(this.#mainCanvas.width / 2, this.#mainCanvas.height / 2)
        .multiplySelf(this.layerTransform).invertSelf();

      if (isOOB) {
        this.#interactionCache.rect = new DOMRect(0, 0, 0, 0);
        return;
      }

      const rawPoint = this.#interactionCache.lastPoint.matrixTransform(this.#interactionCache.layerTransform_inv);
      this.#interactionCache.rect = new DOMRect(rawPoint.x, rawPoint.y, 0, 0);

      if (this.#activeLayer.state.isVisible) {
        ctx.beginPath();
        ctx.arc(this.#interactionCache.lastPoint.x, this.#interactionCache.lastPoint.y, width / 2, 0, 2 * Math.PI);
        ctx.fill();

        const mainCtx = this.#mainCanvas.getContext("2d");
        this.layers.length > 1 && mainCtx.clearRect(0, 0, this.#mainCanvas.width, this.#mainCanvas.height);
        this.#activeLayerIndex > 0 && mainCtx.drawImage(this.#bottomCache, 0, 0);
        this.layers.length > 1 && mainCtx.drawImage(this.#middleCache, 0, 0);
        this.#activeLayerIndex < this.layers.length - 1 && mainCtx.drawImage(this.#topCache, 0, 0)

        this.refreshViewport();

        ctx.beginPath();
        ctx.moveTo(this.#interactionCache.lastPoint.x, this.#interactionCache.lastPoint.y);
      }

      this.#interactionCache.path2D.moveTo(this.#interactionCache.lastPoint.x, this.#interactionCache.lastPoint.y);
      this.#interactionCache.path2D.lineTo(this.#interactionCache.lastPoint.x, this.#interactionCache.lastPoint.y);
    }

    /** @param {DOMPoint} point */
    curveTo(point) {
      const ctx = (this.layers.length > 1 ? this.#middleCache : this.#mainCanvas).getContext("2d");
      const to_inv = point.matrixTransform(this.viewportTransform_inv);

      const availRect = new DOMRect(-this.#interactionCache.width / 2, -this.#interactionCache.width / 2, this.#mainCanvas.width + this.#interactionCache.width, this.#mainCanvas.height + this.#interactionCache.width);
      // out of bounds
      const isOOB = !utils.pointInRect(to_inv, availRect);
      const prevIsOOB = !utils.pointInRect(this.#interactionCache.lastPoint, availRect);

      const intersections = utils.lineRect(this.#interactionCache.lastPoint, to_inv, availRect);

      if (isOOB && prevIsOOB && !intersections.length) {
        this.#interactionCache.lastPoint = to_inv;
        return;
      }

      const [clampedFrom, clampedTo] = utils.clampLineToRect(this.#interactionCache.lastPoint, to_inv, availRect);

      if (prevIsOOB) {
        this.#interactionCache.path2D.moveTo(clampedFrom.x, clampedFrom.y);
        ctx.moveTo(clampedFrom.x, clampedFrom.y);
      }

      const midpoint = new DOMPoint((clampedTo.x + clampedFrom.x) / 2, (clampedTo.y + clampedFrom.y) / 2);

      if (this.#activeLayer.state.isVisible) {
        ctx.quadraticCurveTo(clampedFrom.x, clampedFrom.y, midpoint.x, midpoint.y);
        ctx.stroke();

        const mainCtx = this.#mainCanvas.getContext("2d");
        this.layers.length > 1 && mainCtx.clearRect(0, 0, this.#mainCanvas.width, this.#mainCanvas.height);
        this.#activeLayerIndex > 0 && mainCtx.drawImage(this.#bottomCache, 0, 0);
        this.layers.length > 1 && mainCtx.drawImage(this.#middleCache, 0, 0);
        this.#activeLayerIndex < this.layers.length - 1 && mainCtx.drawImage(this.#topCache, 0, 0);

        this.refreshViewport();
      }

      const rawMidpoint = midpoint.matrixTransform(this.#interactionCache.layerTransform_inv);
      this.#interactionCache.path2D.quadraticCurveTo(clampedFrom.x, clampedFrom.y, midpoint.x, midpoint.y);
      this.#interactionCache.lastPoint = to_inv;

      this.#interactionCache.rect.width += Math.max(this.#interactionCache.rect.x - rawMidpoint.x, rawMidpoint.x - this.#interactionCache.rect.right, 0);
      this.#interactionCache.rect.height += Math.max(this.#interactionCache.rect.y - rawMidpoint.y, rawMidpoint.y - this.#interactionCache.rect.bottom, 0);
      this.#interactionCache.rect.x = Math.min(rawMidpoint.x, this.#interactionCache.rect.x);
      this.#interactionCache.rect.y = Math.min(rawMidpoint.y, this.#interactionCache.rect.y);
    }

    /** @param {DOMPoint} point */
    lineTo(point) {
      const ctx = (this.layers.length > 1 ? this.#middleCache : this.#mainCanvas).getContext("2d");
      const to_inv = point.matrixTransform(this.viewportTransform_inv);

      const availRect = new DOMRect(-this.#interactionCache.width / 2, -this.#interactionCache.width / 2, this.#mainCanvas.width + this.#interactionCache.width, this.#mainCanvas.height + this.#interactionCache.width);
      // out of bounds
      const isOOB = !utils.pointInRect(to_inv, availRect);
      const prevIsOOB = !utils.pointInRect(this.#interactionCache.lastPoint, availRect);

      const intersections = utils.lineRect(this.#interactionCache.lastPoint, to_inv, availRect);

      if (isOOB && prevIsOOB && !intersections.length) {
        this.#interactionCache.lastPoint = to_inv;
        return;
      }

      const [clampedFrom, clampedTo] = utils.clampLineToRect(this.#interactionCache.lastPoint, to_inv, availRect);

      if (prevIsOOB) {
        this.#interactionCache.path2D.moveTo(clampedFrom.x, clampedFrom.y);
        ctx.moveTo(clampedFrom.x, clampedFrom.y);
      }

      if (this.#activeLayer.state.isVisible) {
        ctx.lineTo(clampedTo.x, clampedTo.y);
        ctx.stroke();

        const mainCtx = this.#mainCanvas.getContext("2d");
        this.layers.length > 1 && mainCtx.clearRect(0, 0, this.#mainCanvas.width, this.#mainCanvas.height);
        this.#activeLayerIndex > 0 && mainCtx.drawImage(this.#bottomCache, 0, 0);
        this.layers.length > 1 && mainCtx.drawImage(this.#middleCache, 0, 0);
        this.#activeLayerIndex < this.layers.length - 1 && mainCtx.drawImage(this.#topCache, 0, 0);

        this.refreshViewport();
      }

      const rawClampedTo = clampedTo.matrixTransform(this.#interactionCache.layerTransform_inv);
      this.#interactionCache.path2D.lineTo(clampedTo.x, clampedTo.y);
      this.#interactionCache.lastPoint = to_inv;

      this.#interactionCache.rect.width += Math.max(this.#interactionCache.rect.x - rawClampedTo.x, rawClampedTo.x - this.#interactionCache.rect.right, 0);
      this.#interactionCache.rect.height += Math.max(this.#interactionCache.rect.y - rawClampedTo.y, rawClampedTo.y - this.#interactionCache.rect.bottom, 0);
      this.#interactionCache.rect.x = Math.min(rawClampedTo.x, this.#interactionCache.rect.x);
      this.#interactionCache.rect.y = Math.min(rawClampedTo.y, this.#interactionCache.rect.y);
    }

    endDrawing() {
      const clipPath = new Path2D();
      clipPath.rect(0, 0, this.#mainCanvas.width, this.#mainCanvas.height);

      this.#activeLayer.resizeFitStroke(this.#interactionCache.rect, this.#interactionCache.width);
      const layerState = this.#activeLayer.addStroke({
        color: this.#interactionCache.color,
        width: this.#interactionCache.width / utils.getScale(this.#activeLayer.state.transform),
        path2D: this.#interactionCache.path2D,
        globalCompositeOperation: this.#interactionCache.globalCompositeOperation,
        clipPath,
        transform: this.#interactionCache.layerTransform_inv
      });

      const updated = { ...this.#state.state, layers: [...this.#state.state.layers] };
      updated.layers[this.activeLayerIndex] = { ...updated.layers[this.activeLayerIndex], state: layerState };
      this.#state.state = updated;

      const canvas = this.layers.length > 1 ? this.#middleCache : this.#mainCanvas;
      const ctx = canvas.getContext("2d");
      ctx.restore();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.#activeLayer.drawOn(canvas);
      this.layers.length > 1 ? this.render() : this.refreshViewport();
    }

    /** @param {DOMPoint} startPoint  */
    startRegionSelect(startPoint, fixedAspect = false) {
      const start_T = startPoint.matrixTransform(this.viewportTransform_inv);
      start_T.x = utils.clamp(0, start_T.x, this.#mainCanvas.width);
      start_T.y = utils.clamp(0, start_T.y, this.#mainCanvas.height);
      this.#interactionCache.rect = new DOMRect(start_T.x, start_T.y, 0, 0);
      this.#interactionCache.width = Number(fixedAspect);
    }

    /** @param {DOMPoint} to  */
    regionSelect(to) {
      const to_T = to.matrixTransform(this.viewportTransform_inv);
      to_T.x = utils.clamp(0, to_T.x, this.#mainCanvas.width);
      to_T.y = utils.clamp(0, to_T.y, this.#mainCanvas.height);

      this.#interactionCache.rect.width = to_T.x - this.#interactionCache.rect.x;
      this.#interactionCache.rect.height = to_T.y - this.#interactionCache.rect.y;

      if (this.#interactionCache.width) {
        // fixed Aspect ratio
        const aspect = this.#mainCanvas.width / this.#mainCanvas.height;

        this.#interactionCache.rect.width = utils.maxAbs(this.#interactionCache.rect.width, (Math.sign(this.#interactionCache.rect.width) || 1) * Math.abs(this.#interactionCache.rect.height) * aspect);
        this.#interactionCache.rect.height = utils.maxAbs(this.#interactionCache.rect.height, (Math.sign(this.#interactionCache.rect.height) || 1) * Math.abs(this.#interactionCache.rect.width) / aspect);

        this.#interactionCache.rect.width = utils.clamp(-this.#interactionCache.rect.x, this.#interactionCache.rect.width, this.#mainCanvas.width - this.#interactionCache.rect.x);
        this.#interactionCache.rect.height = utils.clamp(-this.#interactionCache.rect.y, this.#interactionCache.rect.height, this.#mainCanvas.height - this.#interactionCache.rect.y);

        this.#interactionCache.rect.width = utils.minAbs(this.#interactionCache.rect.width, (Math.sign(this.#interactionCache.rect.width) || 1) * Math.abs(this.#interactionCache.rect.height) * aspect);
        this.#interactionCache.rect.height = utils.minAbs(this.#interactionCache.rect.height, (Math.sign(this.#interactionCache.rect.height) || 1) * Math.abs(this.#interactionCache.rect.width) / aspect);
      }
    }

    endRegionSelect() {
      if (Math.abs(this.#interactionCache.rect.width) < 1 || Math.abs(this.#interactionCache.rect.height) < 1)
        return false;

      const width = Math.abs(this.#interactionCache.rect.width);
      const height = Math.abs(this.#interactionCache.rect.height);

      const ccx = this.#interactionCache.rect.left + width / 2;
      const ccy = this.#interactionCache.rect.top + height / 2;

      const cx = this.#mainCanvas.width / 2;
      const cy = this.#mainCanvas.height / 2;

      const T = new DOMMatrix().translateSelf(cx - ccx, cy - ccy);

      const updated = { ...this.#state.state, width, height };
      updated.layers = updated.layers.map(({ layer, state }) => {
        const newState = { ...state, transform: T.multiply(state.transform) };
        layer.state = newState;
        return { layer, state: newState };
      });
      this.#state.state = updated;
      this.#resizeCanvas(width, height);
      this.fullRender();

      return true;
    }

    /** @param {DOMPoint} point @param {number} fontsize @param {string} color   */
    insertTextAt(point, fontsize, color) {
      const ctx = (this.layers.length > 1 ? this.#middleCache : this.#mainCanvas).getContext("2d");
      ctx.save();
      const to_inv = point.matrixTransform(this.viewportTransform_inv);
      ctx.font = `${fontsize}px sans-serif`;
      ctx.textBaseline = "middle";
      ctx.fillStyle = color;

      this.#interactionCache.layerTransform_inv = new DOMMatrix()
        .translateSelf(this.#mainCanvas.width / 2, this.#mainCanvas.height / 2)
        .multiplySelf(this.layerTransform).invertSelf();

      const textMetrics = ctx.measureText("");
      const width = textMetrics.actualBoundingBoxRight + textMetrics.actualBoundingBoxLeft;
      const height = textMetrics.fontBoundingBoxDescent + textMetrics.fontBoundingBoxAscent;

      this.#interactionCache.rect = new DOMRect(to_inv.x, to_inv.y - height / 2, width, height);
      this.#interactionCache.width = fontsize;
      this.#interactionCache.color = color;
    }

    /** @param {(oldText: string) => string} setText */
    updateText(setText) {
      const canvas = this.layers.length > 1 ? this.#middleCache : this.#mainCanvas;
      const ctx = canvas.getContext("2d");

      this.#interactionCache.text = setText(this.#interactionCache.text);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.#activeLayer.drawOn(canvas);
      [this.#interactionCache.rect.width, this.#interactionCache.rect.height] = utils.renderMultilineText(
        ctx, this.#interactionCache.text,
        new DOMPoint(this.#interactionCache.rect.x, this.#interactionCache.rect.y)
      );
      this.layers.length > 1 ? this.render() : this.refreshViewport();
    }

    finalizeText() {
      const canvas = this.layers.length > 1 ? this.#middleCache : this.#mainCanvas;
      const ctx = canvas.getContext("2d");

      const clipPath = new Path2D();
      clipPath.rect(0, 0, this.#mainCanvas.width, this.#mainCanvas.height);

      const layerState = this.#activeLayer.addStroke({
        text: this.#interactionCache.text,
        origin: new DOMPoint(this.#interactionCache.rect.x, this.#interactionCache.rect.y),
        color: this.#interactionCache.color,
        width: this.#interactionCache.width / utils.getScale(this.#activeLayer.state.transform),
        globalCompositeOperation: "source-over",
        clipPath,
        transform: this.#interactionCache.layerTransform_inv
      });

      const updated = { ...this.#state.state, layers: [...this.#state.state.layers] };
      updated.layers[this.activeLayerIndex] = { ...updated.layers[this.activeLayerIndex], state: layerState };
      this.#state.state = updated;

      this.#interactionCache.text = "";
      ctx.restore();
    }

    /** @param {number} width @param {number} height  */
    #resizeCanvas(width, height) {
      this.#staleViewportInv = true;
      this.#mainCanvas.width = width;
      this.#mainCanvas.height = height;

      this.#bottomCache.width = width;
      this.#bottomCache.height = height;
      this.#middleCache.width = width;
      this.#middleCache.height = height;
      this.#topCache.width = width;
      this.#topCache.height = height;
    }

    /** @param {1 | -1} x @param {1 | -1} y */
    flip(x, y) {
      const T = new DOMMatrix().scaleSelf(x, y);
      const layers = this.layers.map(({ layer }) => {
        layer.previewTransformBy(T);
        return { layer, state: layer.finalizePreview() }
      });
      this.#state.state = { ...this.#state.state, layers };
      this.fullRender();
    }

    /** @param {90 | -90} angle  */
    rotate(angle) {
      const T = new DOMMatrix().rotateSelf(angle);
      const layers = this.layers.map(({ layer }) => {
        layer.previewTransformBy(T);
        return { layer, state: layer.finalizePreview() }
      });
      this.#resizeCanvas(this.#state.state.height, this.#state.state.width);
      this.#state.state = { ...this.#state.state, layers, width: this.#state.state.height, height: this.#state.state.width };
      this.fullRender();
    }

    /** @param {ImageEncodeOptions?} options */
    toBlob(options) { return this.#mainCanvas.convertToBlob(options) }

    refreshViewport() {
      const ctx = this.#viewportCanvas.getContext("2d");

      ctx.fillStyle = "#303038";
      ctx.fillRect(0, 0, this.#viewportCanvas.width, this.#viewportCanvas.height);
      ctx.setTransform(new DOMMatrix().translateSelf(this.#viewportCanvas.width / 2, this.#viewportCanvas.height / 2).multiplySelf(this.#viewportTransform));

      ctx.clearRect(-this.#mainCanvas.width / 2, -this.#mainCanvas.height / 2, this.#mainCanvas.width, this.#mainCanvas.height);
      ctx.drawImage(this.#mainCanvas, -this.#mainCanvas.width / 2, -this.#mainCanvas.height / 2);

      ctx.resetTransform();
    }

    render() {
      const ctx = this.#mainCanvas.getContext("2d");
      ctx.clearRect(0, 0, this.#mainCanvas.width, this.#mainCanvas.height);

      this.#activeLayerIndex > 0 && ctx.drawImage(this.#bottomCache, 0, 0);
      ctx.drawImage(this.#middleCache, 0, 0);
      this.#activeLayerIndex < this.layers.length - 1 && ctx.drawImage(this.#topCache, 0, 0);

      this.refreshViewport();
    }

    fullRender() {
      const ctx = this.#mainCanvas.getContext("2d");

      ctx.clearRect(0, 0, this.#mainCanvas.width, this.#mainCanvas.height);
      this.#activeLayerIndex > 0 && this.#bottomCache.getContext("2d").clearRect(0, 0, this.#bottomCache.width, this.#bottomCache.height);
      this.layers.length > 1 && this.#middleCache.getContext("2d").clearRect(0, 0, this.#middleCache.width, this.#middleCache.height);
      this.#activeLayerIndex < this.layers.length - 1 && this.#topCache.getContext("2d").clearRect(0, 0, this.#topCache.width, this.#topCache.height);

      this.layers.slice(0, this.activeLayerIndex).forEach(layer => layer.layer.drawOn(this.#bottomCache));
      this.#activeLayer.drawOn(this.layers.length > 1 ? this.#middleCache : this.#mainCanvas);
      this.layers.slice(this.activeLayerIndex + 1).forEach(layer => layer.layer.drawOn(this.#topCache));

      this.#activeLayerIndex > 0 && ctx.drawImage(this.#bottomCache, 0, 0);
      this.layers.length > 1 && ctx.drawImage(this.#middleCache, 0, 0);
      this.#activeLayerIndex < this.layers.length - 1 && ctx.drawImage(this.#topCache, 0, 0);

      this.refreshViewport();
    }

    undo() {
      const oldWidth = this.#mainCanvas.width;
      const oldHeight = this.#mainCanvas.height;
      if (!this.#state.undo()) return false;
      if (this.#state.state.width !== oldWidth || this.#state.state.height !== oldHeight) {
        this.#resizeCanvas(this.#state.state.width, this.#state.state.height);
      }
      this.#state.state.layers.forEach(({ layer, state }) => layer.state = state);
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
      }
      this.#state.state.layers.forEach(({ layer, state }) => layer.state = state);
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

    /** @param {ImageBitmap | {width: number, height: number}} bitmap @param {string} id */
    constructor(id, bitmap) {
      this.id = id;
      this.#canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      this.#state = {
        transform: new DOMMatrix(),
        /** @type {({color: string, width: number, clipPath: Path2D, globalCompositeOperation: string, path2D: Path2D, text: string, origin: DOMPoint})[]} */
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
        console.log(dx, dy)
        this.#canvas.width += ~~(2 * dx);
        this.#canvas.height += ~~(2 * dy);
        this.#drawImage();
        this.#drawStrokes();
      }
    }

    /** @param {{color: string, width: number, clipPath: Path2D, globalCompositeOperation: string, path2D?: Path2D, text?: string, origin: DOMPoint, transform: DOMMatrix}} stroke  */
    addStroke(stroke) {
      this.#state = { ...this.#state, strokes: [...this.#state.strokes, stroke] };
      this.#drawStroke(stroke);
      return this.#state;
    }

    /** @param {{color: string, width: number, clipPath: Path2D, globalCompositeOperation: string, path2D?: Path2D, text?: string, origin: DOMPoint, transform: DOMMatrix}} stroke  */
    #drawStroke(stroke) {
      const ctx = this.#canvas.getContext("2d");
      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.lineWidth = stroke.width;
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.textBaseline = "middle";
      ctx.globalCompositeOperation = stroke.globalCompositeOperation;
      ctx.font = `${stroke.width}px sans-serif`;
      ctx.setTransform(new DOMMatrix().translateSelf(this.width / 2, this.height / 2).multiplySelf(stroke.transform));
      ctx.clip(stroke.clipPath);
      if (stroke.path2D) ctx.stroke(stroke.path2D);
      if (stroke.text) utils.renderMultilineText(ctx, stroke.text, stroke.origin);
      ctx.restore();
    }

    #drawStrokes(strokes = this.#state.strokes) {
      const ctx = this.#canvas.getContext("2d");
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (const stroke of strokes) {
        ctx.save();
        ctx.lineWidth = stroke.width;
        ctx.strokeStyle = stroke.color;
        ctx.fillStyle = stroke.color;
        ctx.textBaseline = "middle";
        ctx.globalCompositeOperation = stroke.globalCompositeOperation;
        ctx.font = `${stroke.width}px sans-serif`;
        ctx.setTransform(new DOMMatrix().translateSelf(this.width / 2, this.height / 2).multiplySelf(stroke.transform));
        ctx.clip(stroke.clipPath);
        if (stroke.path2D) ctx.stroke(stroke.path2D);
        if (stroke.text) utils.renderMultilineText(ctx, stroke.text, stroke.origin);
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
      if (!this.#state.isVisible) return;

      const ctx = canvas.getContext("2d");
      ctx.setTransform(new DOMMatrix()
        .translateSelf(canvas.width / 2, canvas.height / 2)
        .multiplySelf(this.#previewTransform)
        .multiplySelf(this.#state.transform)
      );
      ctx.drawImage(this.#canvas, -this.width / 2, -this.height / 2);
      ctx.resetTransform();
    }

    /** @param {OffscreenCanvas} canvas */
    drawThumbnail(canvas) {
      const ctx = canvas.getContext("2d");
      ctx.setTransform(new DOMMatrix()
        .translateSelf(canvas.width / 2, canvas.height / 2)
        .multiplySelf(this.#previewTransform)
        .multiplySelf(this.#state.transform)
      );
      ctx.drawImage(this.#canvas, -this.width / 2, -this.height / 2, canvas.width, canvas.height);
      ctx.resetTransform();
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
        return Math.round(val / 2 * 100);
      } else {
        const val = (Math.log(x) - Math.log(centerValue)) / (Math.log(maxValue) - Math.log(centerValue));
        return Math.round((1 + val) / 2 * 100);
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
    pointInRect(p, rect) { return p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom },

    /** @param {DOMPoint} p1 @param {DOMPoint} p2 @param {DOMPoint} p3 @param {DOMPoint} p4 Intersection point between two lines */
    lineLine(p1, p2, p3, p4) {
      const uA = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / ((p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y));
      const uB = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / ((p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y));

      if (uA >= 0 && uA <= 1 && uB >= 0 && uB <= 1) {
        return new DOMPoint(p1.x + (uA * (p2.x - p1.x)), p1.y + (uA * (p2.y - p1.y)));
      }
      return null;
    },

    /** @param {DOMPoint} p1 @param {DOMPoint} p2 @param {DOMRect} rect @returns {DOMPoint[]} Intersection points between line and Rect */
    lineRect(p1, p2, rect) {
      const top = utils.lineLine(p1, p2, new DOMPoint(rect.left, rect.top), new DOMPoint(rect.right, rect.top));
      const right = utils.lineLine(p1, p2, new DOMPoint(rect.right, rect.top), new DOMPoint(rect.right, rect.bottom));
      const bottom = utils.lineLine(p1, p2, new DOMPoint(rect.left, rect.bottom), new DOMPoint(rect.right, rect.bottom));
      const left = utils.lineLine(p1, p2, new DOMPoint(rect.left, rect.top), new DOMPoint(rect.left, rect.bottom));

      return [top, right, bottom, left].filter(Boolean);
    },

    /** @param {DOMPoint} p1 @param {DOMPoint} p2 @param {DOMRect} rect */
    clampLineToRect(p1, p2, rect) {
      const intersects = utils.lineRect(p1, p2, rect);

      switch (intersects.length) {
        case 1: {
          return utils.pointInRect(p1, rect) ? [p1, intersects[0]] : [intersects[0], p2];
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

    openEditor({ onSubmit, bitmap, userActions }) {
      const id = internals.nativeUI[internals.keys.openModal]?.(e => jsx(BdApi.Components.ErrorBoundary, {
        children: jsx(internals.Modal[internals.keys.ModalRoot], {
          ...e,
          animation: "subtle",
          size: "dynamic",
          className: `${meta.slug}Root`,
          children: [
            jsx(internals.Modal[internals.keys.ModalFooter], {
              className: "modal-footer",
              children: [
                jsx(internals.Button[internals.keys.Button], {
                  text: "Save",
                  type: "submit",
                  variant: "primary",
                  onClick: () => {
                    onSubmit?.();
                    internals.nativeUI[internals.keys.closeModal](id);
                  }
                }),
                jsx(internals.Button[internals.keys.Button], {
                  text: "Cancel",
                  variant: "secondary",
                  onClick: () => {
                    internals.nativeUI[internals.keys.closeModal](id);
                  }
                }),
              ]
            }),
            jsx(internals.Modal[internals.keys.ModalContent], {
              className: "image-editor",
              children: jsx(Components.ImageEditor, {
                bitmap,
                ref: userActions,
              })
            })
          ]
        })
      }));
    },

    toImgSrc(url, proxyUrl) {
      function toURLSafe(e) {
        try { return new URL(e) }
        catch (e) { return null }
      }
      function cdn(e) {
        let t = toURLSafe(e);
        return null != t && (t.host === "cdn.discordapp.com" || /^.*\.discordapp\.net$/.test(t.hostname))
      }
      function g(e) {
        let l = "https://media.discordapp.net", a = "cdn.discordapp.com", t = toURLSafe(e);
        return null == t || t.host === l ? e : (t.origin === a ? (t.host = l,
          t.searchParams.delete("size"),
          t.searchParams.delete("width"),
          t.searchParams.delete("height"),
          t.searchParams.delete("quality")) : (
          t.searchParams.delete("width"),
          t.searchParams.delete("height"),
          t.searchParams.set("quality", "lossless")),
          t.searchParams.delete("format"),
          t.toString())
      }
      return cdn(url) ? g(url) : (null != proxyUrl && "" !== proxyUrl ? proxyUrl : url)
    },

    paths: {
      Main: "m22.7 14.3l-1 1l-2-2l1-1c.1-.1.2-.2.4-.2c.1 0 .3.1.4.2l1.3 1.3c.1.2.1.5-.1.7M13 19.9V22h2.1l6.1-6.1l-2-2zm-1.79-4.07l-1.96-2.36L6.5 17h6.62l2.54-2.45l-1.7-2.26zM11 19.9v-.85l.05-.05H5V5h14v6.31l2-1.93V5a2 2 0 0 0-2-2H5c-1.1 0-2 .9-2 2v14a2 2 0 0 0 2 2h6z",
      FlipH: "M1.2656 20.1094 8.7188 4.4531C9.1406 3.6094 10.3594 3.8906 10.3594 4.8281L10.3594 20.4375C10.3594 21.375 9.8906 21.7969 8.9531 21.7969L2.2969 21.7969C1.3594 21.7969.8438 20.9531 1.2656 20.1094ZM22.8281 20.1094 15.375 4.4531C14.9531 3.6094 13.7344 3.8906 13.7344 4.8281L13.7344 20.4375C13.7344 21.375 14.2031 21.7969 15.1406 21.7969L21.7969 21.7969C22.7344 21.7969 23.25 20.9531 22.8281 20.1094Z",
      FlipV: "M20.1094 22.7344 4.4531 15.2812C3.6094 14.8594 3.8906 13.6406 4.8281 13.6406L20.4375 13.6406C21.375 13.6406 21.7969 14.1094 21.7969 15.0469L21.7969 21.7031C21.7969 22.6406 20.9531 23.1563 20.1094 22.7344ZM20.1094 1.1719 4.4531 8.625C3.6094 9.0469 3.8906 10.2656 4.8281 10.2656L20.4375 10.2656C21.375 10.2656 21.7969 9.7969 21.7969 8.8594L21.7969 2.2031C21.7969 1.2656 20.9531.75 20.1094 1.1719Z",
      RotR: "M9.75 7.8516 7.8516 9.75C7.5 10.1016 7.5 10.6641 7.8516 11.0157 8.2032 11.3671 8.7657 11.3671 9.1171 11.0157L12.5625 7.5704C12.9844 7.1484 12.9844 6.7266 12.5625 6.3046L9.1171 2.8594C8.7657 2.5078 8.2032 2.5078 7.8516 2.8594 7.5 3.2109 7.5 3.7734 7.8516 4.125L9.75 6.0234 5.6719 6.0234C3.8438 6.0234 2.4375 7.4296 2.4375 9.2579L2.4375 12.0704C2.4375 12.5625 2.8594 12.9844 3.3516 12.9844 3.8438 12.9844 4.2657 12.5625 4.2657 12.0704L4.2657 9.1875C4.2657 8.4844 4.8984 7.8516 5.6016 7.8516ZM16.0313 21.7969 21.75 21.7969C22.3594 21.7969 23.0625 21.2813 22.6406 20.25L16.4063 5.2969C16.0313 4.2656 14.7656 4.5469 14.7656 5.5781L14.7656 20.3906C14.7656 21.2344 15.1875 21.7969 16.0313 21.7969ZM1.3594 20.3438C.7969 20.7188.8906 21.7969 1.9219 21.7969L12.5625 21.7969C13.3125 21.7969 13.6875 21.2344 13.6875 20.625L13.6875 14.7188C13.6875 14.0625 13.0313 13.4531 12.3281 13.875Z",
      RotL: "M14.25 7.8516 16.1484 9.75C16.5 10.1016 16.5 10.6641 16.1484 11.0157 15.7968 11.3671 15.2343 11.3671 14.8829 11.0157L11.4375 7.5704C11.0156 7.1484 11.0156 6.7266 11.4375 6.3046L14.8829 2.8594C15.2343 2.5078 15.7968 2.5078 16.1484 2.8594 16.5 3.2109 16.5 3.7734 16.1484 4.125L14.25 6.0234 18.3281 6.0234C20.1562 6.0234 21.5625 7.4296 21.5625 9.2579L21.5625 12.0704C21.5625 12.5625 21.1406 12.9844 20.6484 12.9844 20.1562 12.9844 19.7343 12.5625 19.7343 12.0704L19.7343 9.1875C19.7343 8.4844 19.1016 7.8516 18.3984 7.8516ZM7.9687 21.7969 2.25 21.7969C1.6406 21.7969.9375 21.2813 1.3594 20.25L7.5937 5.2969C7.9687 4.2656 9.2344 4.5469 9.2344 5.5781L9.2344 20.3906C9.2344 21.2344 8.8125 21.7969 7.9687 21.7969ZM22.6406 20.3438C23.2031 20.7188 23.1094 21.7969 22.0781 21.7969L11.4375 21.7969C10.6875 21.7969 10.3125 21.2344 10.3125 20.625L10.3125 14.7188C10.3125 14.0625 10.9687 13.4531 11.6719 13.875Z",
      Undo: "M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8",
      Redo: "M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7z",
      Crop: "M17 15h2V7c0-1.1-.9-2-2-2H9v2h8zM7 17V1H5v4H1v2h4v10c0 1.1.9 2 2 2h10v4h2v-4h4v-2z",
      Cut: "m16.9 18.3-4.9-4.9-1.645 1.645q.14.2625.1925.56T10.6 16.2q0 1.155-.8225 1.9775T7.8 19t-1.9775-.8225T5 16.2t.8225-1.9775T7.8 13.4q.2975 0 .595.0525t.56.1925L10.6 12 8.955 10.355q-.2625.14-.56.1925T7.8 10.6q-1.155 0-1.9775-.8225T5 7.8t.8225-1.9775T7.8 5t1.9775.8225T10.6 7.8q0 .2975-.0525.595t-.1925.56L19 17.6v.7zm-2.8-7-1.4-1.4 4.2-4.2H19v.7zM7.8 9.2q.5775 0 .9891-.4109T9.2 7.8t-.4109-.9884T7.8 6.4t-.9884.4116T6.4 7.8t.4116.9891T7.8 9.2m4.2 3.15q.14 0 .245-.105t.105-.245-.105-.245-.245-.105-.245.105-.105.245.105.245.245.105M7.8 17.6q.5775 0 .9891-.4109T9.2 16.2t-.4109-.9884T7.8 14.8t-.9884.4116T6.4 16.2t.4116.9891T7.8 17.6ZM1 23v-6h2v4h4v2zm16 0v-2h4v-4h2v6zM1 7V1h6v2H3v4zM21 7V3h-4V1h6v6Z",
      Rotate: "M10.217 19.339C6.62 17.623 4.046 14.136 3.65 10H2c.561 6.776 6.226 12.1 13.145 12.1.253 0 .484-.022.726-.033L11.68 17.865ZM8.855 1.9c-.253 0-.484.022-.726.044L12.32 6.135l1.463-1.463C17.38 6.377 19.954 9.864 20.35 14H22C21.439 7.224 15.774 1.9 8.855 1.9Z",
      Draw: "M4 21v-4.25L17.175 3.6q.3-.3.675-.45T18.6 3q.4 0 .763.15T20 3.6L21.4 5q.3.275.45.638T22 6.4q0 .375-.15.75t-.45.675L8.25 21zm2-2h1.4l9.825-9.8l-.7-.725l-.725-.7L6 17.6zM20 6.425L18.575 5zm-3.475 2.05l-.725-.7L17.225 9.2zM14 21q1.85 0 3.425-.925T19 17.5q0-.9-.475-1.55t-1.275-1.125L15.775 16.3q.575.25.9.55t.325.65q0 .575-.913 1.038T14 19q-.425 0-.712.288T13 20t.288.713T14 21m-9.425-7.65l1.5-1.5q-.5-.2-.788-.412T5 11q0-.3.45-.6t1.9-.925q2.2-.95 2.925-1.725T11 6q0-1.375-1.1-2.187T7 3q-1.125 0-2.013.4t-1.362.975Q3.35 4.7 3.4 5.1t.375.65q.325.275.725.225t.675-.325q.35-.35.775-.5T7 5q1.025 0 1.513.3T9 6q0 .35-.437.637T6.55 7.65q-2 .875-2.775 1.588T3 11q0 .8.425 1.363t1.15.987",
      Eraser: "m16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4.01 4.01 0 0 1-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0M4.22 15.58l3.54 3.53c.78.79 2.04.79 2.83 0l3.53-3.53l-4.95-4.95z",
      Text: "m18.5 4l1.16 4.35l-.96.26c-.45-.87-.91-1.74-1.44-2.18C16.73 6 16.11 6 15.5 6H13v10.5c0 .5 0 1 .33 1.25c.34.25 1 .25 1.67.25v1H9v-1c.67 0 1.33 0 1.67-.25c.33-.25.33-.75.33-1.25V6H8.5c-.61 0-1.23 0-1.76.43c-.53.44-.99 1.31-1.44 2.18l-.96-.26L5.5 4z",
      Pan: "M23 12 18.886 7.864v2.772h-5.5v-5.5h2.75L12 1 7.886 5.136h2.75v5.5H5.092V7.886L1 12l4.136 4.136v-2.75h5.5v5.5H7.886L12 23l4.136-4.114h-2.75v-5.5h5.5v2.75L23 12Z",
      Scale: "M16 3a1 1 0 100 2h1.586L11 11.586V10A1 1 0 009 10v3.75c0 .69.56 1.25 1.25 1.25H14a1 1 0 100-2H12.414L19 6.414V8a1 1 0 102 0V4.25C21 3.56 20.44 3 19.75 3ZM5 3l-.15.005A2 2 0 003 5V19l.005.15A2 2 0 005 21H19l.15-.005A2 2 0 0021 19V13l-.007-.117A1 1 0 0019 13v6H5V5h6l.117-.007A1 1 0 0011 3Z",
      LockOpen: "M6 20h12V10H6zm6-3q.825 0 1.413-.587T14 15t-.587-1.412T12 13t-1.412.588T10 15t.588 1.413T12 17m-6 3V10zm0 2q-.825 0-1.412-.587T4 20V10q0-.825.588-1.412T6 8h7V6q0-2.075 1.463-3.537T18 1q1.775 0 3.1 1.075t1.75 2.7q.125.425-.162.825T22 6q-.425 0-.7-.175t-.4-.575q-.275-.95-1.062-1.6T18 3q-1.25 0-2.125.875T15 6v2h3q.825 0 1.413.588T20 10v10q0 .825-.587 1.413T18 22z",
      Lock: "M12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2m5 3c.55 0 1-.45 1-1V11c0-.55-.45-1-1-1H7c-.55 0-1 .45-1 1v8c0 .55.45 1 1 1H17M9 8h6V6c0-1.66-1.34-3-3-3S9 4.34 9 6Zm9 0c1.1 0 2 .9 2 2V20c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V10c0-1.1.9-2 2-2H7V6c0-2.76 2.24-5 5-5s5 2.24 5 5V8h1",
      AddLayer: "M18.94 12.002 11.976 8.143 5.059 11.965l6.964 3.89Zm2.544-.877a1 1 0 01.002 1.749l-8.978 5a1 1 0 01-.973-.001l-9.022-5.04a1 1 0 01.003-1.749l8.978-4.96a1 1 0 01.968.001l9.022 5zM12 22a1 1 0 00.485-.126l9-5-.971-1.748L12 19.856l-8.515-4.73-.971 1.748 9 5A1 1 0 0012 22m8-22h-2v3h-3v2h3v3h2V5h3V3h-3z",
      DeleteLayer: "M5.06 11.965l6.964 3.89 6.917-3.853-6.964-3.859Zm-2.547.868a1 1 0 01.003-1.749l8.978-4.96a1 1 0 01.968.001l9.022 5a1 1 0 01.002 1.749l-8.978 5a1 1 0 01-.973-.001l-9.022-5.04M15 5h8V3H15ZM12 19.856l8.514-4.73.971 1.748-9 5a1 1 0 01-.971 0l-9-5 .971-1.748Z",
      MoveLayerUp: "M11.604 3.061c-.687.193-1.306.752-2.604 2.353-.913 1.126-.958 1.193-.987 1.476-.076.733.611 1.281 1.311 1.049.27-.09.45-.27 1.139-1.143l.517-.654.02 4.582.02 4.582.121.197c.402.653 1.316.653 1.718 0l.121-.197.02-4.582.02-4.582.517.654c.689.873.869 1.053 1.139 1.143.7.232 1.387-.316 1.311-1.049-.029-.282-.073-.348-.985-1.477-1.15-1.421-1.883-2.107-2.471-2.311-.276-.096-.67-.113-.927-.041M7.8 10.549c-.033.013-.96.436-2.06.941-2.632 1.207-3.468 1.632-3.9 1.98-.888.715-1.085 1.674-.518 2.523.306.458.764.787 1.817 1.306.724.356 6.326 2.934 7.001 3.222 1.498.637 2.223.637 3.72-.001.684-.291 6.283-2.868 7.001-3.221 1.054-.519 1.511-.848 1.817-1.306.567-.849.37-1.808-.518-2.523-.429-.346-1.247-.762-3.92-1.993-1.863-.858-2.04-.932-2.283-.948-.492-.032-.888.242-1.024.71-.111.38.036.814.355 1.053.073.053.87.436 1.772.849.902.413 1.946.893 2.32 1.067.686.32 1.5.75 1.5.794 0 .04-.551.341-1.12.612-1.087.519-6.512 3.001-6.891 3.154-.733.295-1.005.295-1.738 0-.215-.087-1.732-.773-3.371-1.525-2.858-1.311-4.412-2.052-4.578-2.182-.077-.06-.077-.062 0-.12.154-.118 1.635-.83 3.498-1.682 1.045-.478 1.959-.914 2.032-.967.761-.568.342-1.779-.612-1.768-.132.001-.267.013-.3.025",
      MoveLayerDown: "M11.449 3.057c-.701.134-.701.134-4.749 1.992C3.093 6.705 2.298 7.101 1.84 7.47c-.888.715-1.085 1.674-.518 2.523.31.464.765.789 1.858 1.325 1.212.595 4.561 2.117 4.751 2.16.137.031.235.026.413-.021a.966.966 0 00.743-.78.988.988 0 00-.21-.809c-.152-.184-.218-.217-2.337-1.186-1.7-.778-3.216-1.509-3.358-1.621-.077-.06-.077-.062 0-.121.167-.128 1.64-.83 4.478-2.132 1.628-.747 3.131-1.43 3.34-1.519.418-.178.802-.289 1-.289s.582.111 1 .289c.209.088 1.712.772 3.34 1.519 2.799 1.283 4.303 2 4.478 2.133.077.058.077.06 0 .119-.147.114-1.681.855-3.358 1.622-2.119.969-2.185 1.002-2.337 1.186-.123.149-.243.462-.243.632 0 .18.124.49.258.647.23.269.607.401.936.329.095-.021 1.04-.436 2.1-.923 3.083-1.415 3.555-1.657 4.07-2.085.811-.675.979-1.66.423-2.478-.276-.405-.718-.728-1.625-1.186-.76-.386-6.232-2.914-7.249-3.35-.903-.387-1.693-.521-2.344-.397m.246 5a1.04 1.04 0 00-.567.459l-.108.184-.02 4.579-.02 4.579-.52-.658c-.696-.881-.878-1.06-1.166-1.144-.704-.204-1.356.332-1.281 1.055.029.281.073.348.985 1.476.795.983 1.557 1.782 1.942 2.033.983.643 1.749.468 2.862-.654.428-.433 1.795-2.075 2.05-2.464.24-.365.172-.885-.157-1.205-.417-.405-1-.39-1.426.036-.115.115-.444.506-.729.867l-.52.658-.02-4.579-.02-4.579-.108-.184a1.005 1.005 0 00-1.177-.459",
      Visibility: "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5M12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5m0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3",
      VisibilityOff: "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7M2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2m4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3z",
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
     *  onStart?: (e: Omit<React.PointerEvent, "currentTarget">, store: Record<string, any>) => void,
     *  onChange?:(e: Omit<React.PointerEvent, "currentTarget">, store: Record<string, any>) => void,
     *  onSubmit?: (e: Omit<React.PointerEvent, "currentTarget">, store: Record<string, any>) => void
     * }} props
    */
    usePointerCapture({ onStart, onChange, onSubmit }) {
      /** @type {React.RefObject<null | number>} */
      const pointerId = useRef(null);
      const rafId = useRef(null);
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
        if (!(e.buttons & 5) || pointerId.current !== e.pointerId || rafId.current) return;

        rafId.current = requestAnimationFrame(() => {
          onChange?.(e, smolStore.current);
          rafId.current = null;
        })
      }, [onChange]);

      /** @type {(e: PointerEvent) => void} */
      const onPointerUp = useCallback(e => {
        if (pointerId.current !== e.pointerId) return;

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
          text: tooltip ?? '',
          hideOnClick: true,
          position,
          children: e => {
            let { onMouseEnter, onMouseLeave, onClick: onClick2 } = e;
            const handleClick = e => { if (!disabled) { onClick?.(e); onClick2?.(e); e.stopPropagation() } };
            const handleKeyUp = e => (e.key === 'Enter' || e.key === ' ') && handleClick(e);

            return internals.keys.FocusRing && jsx(internals.nativeUI[internals.keys.FocusRing], {
              children: jsx("div", {
                onMouseEnter,
                onMouseLeave,
                onClick: handleClick,
                onKeyUp: handleKeyUp,
                className: utils.clsx(internals.actionButtonClass.button, disabled && "disabled", active && "active"),
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
      if (!internals.keys.ModalRoot || !internals.keys.ModalContent || !internals.keys.ModalFooter) return;

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
            utils.openEditor({
              onSubmit: () => { userActions.current?.upload() },
              userActions,
              bitmap
            });
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
          }).catch(() => {
            UI.showToast("Could not load image", { type: "error" });
          });
        },
        tooltip: "Edit Image",
        d: utils.paths.Main
      })
    },

    /** @param {{onSelect: () => void, onVisibilityToggle: () => void, active: boolean, visible: boolean}} props */
    LayerThumbnail({ onSelect, onVisibilityToggle, active, visible, name }) {
      return internals.keys.FocusRing && jsx(internals.nativeUI[internals.keys.FocusRing], {
        children: jsx("li", {
          onClick: onSelect,
          className: utils.clsx("thumbnail", active && "active"),
          children: [
            jsx(Components.IconButton, {
              tooltip: visible ? "Visible" : "Hidden",
              d: visible ? utils.paths.Visibility : utils.paths.VisibilityOff,
              onClick: onVisibilityToggle
            }),
            jsx("div", null, name)
          ]
        })
      })
    },

    /** @param {{bitmap: ImageBitmap, ref: React.RefObject<any>}} props */
    ImageEditor({ bitmap, ref }) {
      const [canUndoRedo, setCanUndoRedo] = useState(0);
      const [layers, setLayers] = useState(() => []);
      const [dims, setDims] = useState({ width: bitmap.width, height: bitmap.height });

      const [mode, _setMode] = hooks.useStoredState("mode", null);
      const [fixedAspect, setFixedAspect] = hooks.useStoredState("fixedAspectRatio", true);
      const [strokeStyle, setStrokeStyle] = hooks.useStoredState("strokeStyle", () => ({ width: 25, color: "#000000" }));

      const isInteracting = useRef(false);
      /** @type { React.RefObject<HTMLCanvasElement | null> } */
      const canvasRef = useRef(null);
      const canvasRect = useRef(new DOMRect());
      /** @type { React.RefObject<CanvasEditor | null> } */
      const editor = useRef(null);
      /** @type { React.RefObject<HTMLDivElement | null> } */
      const overlay = useRef(null);
      /** @type { React.RefObject<HTMLDivElement | null> } */
      const thumbnailContainer = useRef(null);
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

      const syncStates = useCallback(() => {
        setCanUndoRedo(editor.current.canUndo << 1 ^ editor.current.canRedo);
        setDims(d => {
          const { width, height } = editor.current.canvasDims;
          if (d.width === width && d.height === height)
            return d;
          return { width, height }
        });
        setLayers(l => {
          if (
            editor.current.layers.length !== l.length ||
            l.some((e, i) => e.active !== (i === editor.current.activeLayerIndex)) ||
            editor.current.layers.some((e, i) => e.state.isVisible !== l[i]?.visible)
          ) {
            return editor.current.layers.map((layer, i) => ({
              visible: layer.state.isVisible,
              active: i === editor.current.activeLayerIndex,
              id: layer.layer.id
            }));
          }
          return l;
        })
      }, []);

      useEffect(() => {
        const rect = canvasRef.current.offsetParent.getBoundingClientRect();
        canvasRef.current.width = ~~(rect.width);
        canvasRef.current.height = ~~(rect.height);
        canvasRect.current = canvasRef.current.getBoundingClientRect();
        editor.current = new CanvasEditor(canvasRef.current, bitmap);
        setLayers(editor.current.layers.map((layer, i) => ({
          visible: layer.state.isVisible,
          active: i === editor.current.activeLayerIndex,
          id: layer.layer.id
        })));

        const ctrl = new AbortController();
        addEventListener("keydown", e => {
          if (canvasRef.current.matches(".texting") && isInteracting.current) {
            switch (e.key) {
              case (e.ctrlKey || e.shiftKey) && "Enter":
                editor.current.updateText(t => t + "\n");
                const rect = editor.current.regionRect;
                overlay.current.style.setProperty("--x1", 100 * rect.left + "%");
                overlay.current.style.setProperty("--x2", 100 * rect.right + "%");
                overlay.current.style.setProperty("--y1", 100 * rect.top + "%");
                overlay.current.style.setProperty("--y2", 100 * rect.bottom + "%");
                return;
              case "Enter": {
                editor.current.finalizeText();
                syncStates();
                isInteracting.current = false;
                ["--x1", "--x2", "--y1", "--y2"].forEach(prop => overlay.current.style.removeProperty(prop));
                return;
              }
              case "Backspace": {
                editor.current.updateText(t => t.slice(0, -1));
                const rect = editor.current.regionRect;
                overlay.current.style.setProperty("--x1", 100 * rect.left + "%");
                overlay.current.style.setProperty("--x2", 100 * rect.right + "%");
                overlay.current.style.setProperty("--y1", 100 * rect.top + "%");
                overlay.current.style.setProperty("--y2", 100 * rect.bottom + "%");
                return;
              }
              case !e.ctrlKey && e.key.length === 1 && e.key: {
                editor.current.updateText(t => t + e.key);
                const rect = editor.current.regionRect;
                overlay.current.style.setProperty("--x1", 100 * rect.left + "%");
                overlay.current.style.setProperty("--x2", 100 * rect.right + "%");
                overlay.current.style.setProperty("--y1", 100 * rect.top + "%");
                overlay.current.style.setProperty("--y2", 100 * rect.bottom + "%");
                return;
              }
            }
          }
          switch (e.key) {
            case e.ctrlKey && "z":
              if (editor.current.undo()) syncStates();
              return;

            case e.ctrlKey && "y":
              if (editor.current.redo()) syncStates();
              return;

            case !e.repeat && e.ctrlKey && "c":
              if (document.activeElement.tagName === "INPUT" || !DiscordNative?.clipboard.copyImage) return;

              UI.showToast("Processing...", { type: "warn" });
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

              return;

            case !e.repeat && e.ctrlKey && !e.shiftKey && "b":
              editor.current.resetViewport();
              if (canvasRef.current?.matches(".rotating")) {
                overlay.current.style.removeProperty("--translate");
              }
              return;

            case !e.repeat && !e.ctrlKey && !e.shiftKey && "c":
              setMode(m => m === 0 ? null : 0);
              return;

            case !e.repeat && !e.ctrlKey && !e.shiftKey && "r":
              setMode(m => m === 1 ? null : 1);
              return;

            case !e.repeat && !e.ctrlKey && !e.shiftKey && "m":
              setMode(m => m === 2 ? null : 2);
              return;

            case !e.repeat && !e.ctrlKey && !e.shiftKey && "s":
              setMode(m => m === 3 ? null : 3);
              return;

            case !e.repeat && !e.ctrlKey && !e.shiftKey && "d":
              setMode(m => m === 4 ? null : 4);
              return;

            case !e.repeat && !e.ctrlKey && !e.shiftKey && "t":
              setMode(m => m === 5 ? null : 5);
              return;

            case !e.repeat && !e.ctrlKey && !e.shiftKey && "e":
              setMode(m => m === 6 ? null : 6);
              return;

            case !e.repeat && canvasRef.current.matches(".drawing") && "Shift": {
              const lastPoint = editor.current.lastPoint;
              if (!lastPoint || isInteracting.current) return;
              overlay.current.style.setProperty("--line-from", `${lastPoint.x}px ${lastPoint.y}px`);
              const phi = utils.atan2(e.clientX - canvasRect.current.x - lastPoint.x, e.clientY - canvasRect.current.y - lastPoint.y);
              const r = Math.hypot(e.clientY - canvasRect.current.y - lastPoint.y, e.clientX - canvasRect.current.x - lastPoint.x);
              overlay.current.style.setProperty("--phi", `${phi || 0}deg`);
              overlay.current.style.setProperty("--r", `${r || 0}px`);
              return;
            }
          }
        }, ctrl);
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
          editor.current.refreshViewport();

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

        return () => ctrl.abort()
      }, []);

      const handleWheel = hooks.useDebouncedWheel({
        onChange: (e, store) => {
          if (mode === 3 && !e.ctrlKey) {
            const delta = 1 - 0.05 * Math.sign(e.deltaY);
            const { x: ctx, y: cty } = utils.getTranslate(editor.current.viewportTransform);
            const viewportScale = utils.getScale(editor.current.viewportTransform);
            const boxScale = canvasRect.current.width / canvasRef.current.width;

            const Tx = (e.clientX - (canvasRect.current.x + canvasRect.current.width / 2 + ctx * boxScale)) / viewportScale;
            const Ty = (e.clientY - (canvasRect.current.y + canvasRect.current.height / 2 + cty * boxScale)) / viewportScale;

            editor.current.previewLayerTransformBy(new DOMMatrix().scaleSelf(delta, delta, 1, Tx, Ty));

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
              case isInteracting.current && 5: {
                const rect = editor.current.regionRect;
                overlay.current.style.setProperty("--x1", 100 * rect.left + "%");
                overlay.current.style.setProperty("--x2", 100 * rect.right + "%");
                overlay.current.style.setProperty("--y1", 100 * rect.top + "%");
                overlay.current.style.setProperty("--y2", 100 * rect.bottom + "%");
                break;
              }
              case 4:
              case 6: {
                if (!e.shiftKey) {
                  overlay.current.style.removeProperty("--line-from");
                  overlay.current.style.removeProperty("--phi");
                  overlay.current.style.removeProperty("--r");
                } else {
                  const lastPoint = editor.current.lastPoint;
                  if (!lastPoint) return;
                  overlay.current.style.setProperty("--line-from", `${lastPoint.x}px ${lastPoint.y}px`);
                  const phi = utils.atan2(e.clientX - canvasRect.current.x - lastPoint.x, e.clientY - canvasRect.current.y - lastPoint.y);
                  const r = Math.hypot(e.clientY - canvasRect.current.y - lastPoint.y, e.clientX - canvasRect.current.x - lastPoint.x);
                  overlay.current.style.setProperty("--phi", `${phi || 0}deg`);
                  overlay.current.style.setProperty("--r", `${r || 0}px`);
                }
                break;
              }
            }
          }
        },
        onSubmit: (e, store) => {
          if (mode === 3 && store.changed) {
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
          isInteracting.current = true;

          switch (mode) {
            case !!(e.buttons & 1) && 0: {
              canvasRef.current.classList.add("pointerdown");
              const boxScale = canvasRect.current.width / canvasRef.current.width;
              const startX = (e.clientX - canvasRect.current.x) / boxScale;
              const startY = (e.clientY - canvasRect.current.y) / boxScale;
              editor.current.startRegionSelect(new DOMPoint(startX, startY), fixedAspect);
              break;
            }
            case !!(e.buttons & 1) && 1: {
              canvasRef.current.classList.add("pointerdown");
              break;
            }
            case !!(e.buttons & 1) && 5: {
              const boxScale = canvasRect.current.width / canvasRef.current.width;
              const startX = (e.clientX - canvasRect.current.x) / boxScale;
              const startY = (e.clientY - canvasRect.current.y) / boxScale;
              editor.current.insertTextAt(new DOMPoint(startX, startY), strokeStyle.width, strokeStyle.color);
              canvasRef.current.focus();

              const rect = editor.current.regionRect;
              overlay.current.style.setProperty("--x1", 100 * rect.left + "%");
              overlay.current.style.setProperty("--x2", 100 * rect.right + "%");
              overlay.current.style.setProperty("--y1", 100 * rect.top + "%");
              overlay.current.style.setProperty("--y2", 100 * rect.bottom + "%");

              canvasRef.current.releasePointerCapture(e.pointerId);
              break;
            }
            case !!(e.buttons & 1) && 4:
            case !!(e.buttons & 1) && 6: {
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

                overlay.current.style.removeProperty("--line-from");
                overlay.current.style.removeProperty("--phi");
                overlay.current.style.removeProperty("--r");
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
          if (e.buttons & 4 || mode == null || mode == 3) {
            const dx = (e.clientX - store.startX) / canvasRect.current.width * canvasRef.current.width;
            const dy = (e.clientY - store.startY) / canvasRect.current.height * canvasRef.current.height;
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
              case isInteracting.current && 5: {
                const rect = editor.current.regionRect;
                overlay.current.style.setProperty("--x1", 100 * rect.left + "%");
                overlay.current.style.setProperty("--x2", 100 * rect.right + "%");
                overlay.current.style.setProperty("--y1", 100 * rect.top + "%");
                overlay.current.style.setProperty("--y2", 100 * rect.bottom + "%");
                break;
              }
            }
          } else {
            store.changed = true;
            switch (mode) {
              case 0: {
                const boxScale = canvasRect.current.width / canvasRef.current.width;
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
          isInteracting.current = false;

          switch (mode) {
            case 0: {
              canvasRef.current.classList.remove("pointerdown");
              ["--x1", "--x2", "--y1", "--y2"].forEach(a => overlay.current.style.removeProperty(a));
              if (store.changed && editor.current.endRegionSelect()) {
                syncStates();
                editor.current.resetViewport();
              };

              break;
            }
            case store.changed && 1:
              canvasRef.current.classList.remove("pointerdown");
              const cr = utils.getAngle(editor.current.previewLayerTransform).toFixed(1);
              auxRef.current?.setValue(cr);
            // Intentional fall-through
            case store.changed && 2: {
              editor.current.finalizeLayerPreview();
              syncStates();
              break;
            }
            case 5: {
              isInteracting.current = true;
              break;
            }
            case 4:
            case 6: {
              editor.current.endDrawing();
              syncStates();
              break;
            }
          }
        }
      });

      /** @type {(e: React.MouseEvent) => void} */
      const handleMouseMove = useCallback(e => {
        if (!canvasRef.current.matches(".drawing") || (e.buttons & ~4)) return;
        if (!e.shiftKey) {
          overlay.current.style.removeProperty("--line-from");
          overlay.current.style.removeProperty("--phi");
          overlay.current.style.removeProperty("--r");
        } else {
          const lastPoint = editor.current.lastPoint;
          if (!lastPoint) return;
          overlay.current.style.setProperty("--line-from", `${lastPoint.x}px ${lastPoint.y}px`);
          const phi = utils.atan2(e.clientX - canvasRect.current.x - lastPoint.x, e.clientY - canvasRect.current.y - lastPoint.y);
          const r = Math.hypot(e.clientY - canvasRect.current.y - lastPoint.y, e.clientX - canvasRect.current.x - lastPoint.x);
          overlay.current.style.setProperty("--phi", `${phi || 0}deg`);
          overlay.current.style.setProperty("--r", `${r || 0}px`);
        }
      }, []);

      const handleBlur = useCallback(() => {
        if (canvasRef.current.matches(".texting") && isInteracting.current) {
          editor.current.finalizeText();
          syncStates();
          isInteracting.current = false;
          ["--x1", "--x2", "--y1", "--y2"].forEach(prop => overlay.current.style.removeProperty(prop));
        }
      });

      return jsx(Fragment, {
        children: [
          jsx("div", {
            className: "canvas-wrapper",
            children: [
              jsx("canvas", {
                className: utils.clsx("canvas", ["cropping", "rotating", "moving", "scaling", "drawing", "texting", "drawing"][mode]),
                tabIndex: -1,
                ref: canvasRef,
                onBlur: handleBlur,
                onWheel: handleWheel,
                onMouseMove: handleMouseMove,
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
          jsx("aside", {
            className: utils.clsx("sidebar", internals.scrollbarClass.thin),
            children: [
              jsx("div", {
                className: "canvas-dims",
                children: [
                  jsx(Components.NumberSlider, {
                    value: dims.width,
                    decimals: 0,
                    withSlider: false,
                    minValue: 0,
                    onChange: newWidth => {
                      const { width, height } = editor.current.canvasDims;
                      console.log(newWidth, width)
                      if (newWidth !== width) {
                        editor.current.canvasDims = { width: newWidth, height };
                        editor.current.fullRender();
                        syncStates();
                      }
                    }
                  }),
                  "x",
                  jsx(Components.NumberSlider, {
                    value: dims.height,
                    decimals: 0,
                    withSlider: false,
                    minValue: 0,
                    onChange: newHeight => {
                      const { width, height } = editor.current.canvasDims;
                      if (newHeight !== height) {
                        editor.current.canvasDims = { width, height: newHeight };
                        editor.current.fullRender();
                        syncStates();
                      }
                    }
                  }),
                ]
              }),
              jsx("div", {
                className: "canvas-actions",
                children: [
                  jsx(Components.IconButton, {
                    tooltip: "Draw (D)",
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
                  jsx("div"),
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
                      editor.current.flip(-1, 1);
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
                      editor.current.flip(1, -1);
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
                  (mode === 4 || mode === 5 || mode === 6) && jsx(Fragment, {
                    children: [
                      mode !== 6 && jsx(BdApi.Components.ColorInput, {
                        value: strokeStyle.color,
                        colors: ["#000000", 0xffffff, 0xffea00, 0xff9100, 0xff1744, 0xff4081, 0xd500f9, 0x651fff, 0x2979ff, 0x10e5ff, 0x1de9b6, 0x10e676],
                        onChange: c => setStrokeStyle(s => ({ ...s, color: c }))
                      }),
                      jsx(Components.NumberSlider, {
                        ref: auxRef,
                        label: "Size",
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
                  mode == 0 && jsx(Components.IconButton, {
                    tooltip: fixedAspect ? "Preserve aspect ratio" : "Free region select",
                    d: fixedAspect ? utils.paths.Lock : utils.paths.LockOpen,
                    onClick: () => !isInteracting.current && setFixedAspect(e => !e),
                  }),
                  mode == 1 && jsx(Components.NumberSlider, {
                    ref: auxRef,
                    label: "Angle",
                    suffix: "°",
                    decimals: 0,
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
                  mode == 3 && jsx(Components.NumberSlider, {
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
              jsx("ul", {
                ref: thumbnailContainer,
                className: utils.clsx("thumbnails", internals.scrollbarClass.thin),
                children: layers.map(({ visible, active, id }, idx) => {
                  return jsx(Components.LayerThumbnail, {
                    key: id,
                    name: "Layer " + id,
                    visible,
                    active,
                    onVisibilityToggle: () => {
                      editor.current.toggleLayerVisibility(idx);
                      syncStates();
                    },
                    onSelect: () => {
                      if (editor.current.activeLayerIndex === idx) return;
                      editor.current.activeLayerIndex = idx;
                      syncStates();
                    }
                  })
                })
              }),
              jsx("div", {
                className: "thumbnail-actions",
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
            ]
          }),
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
     *  label?: string
     * }} props
     */
    NumberSlider({ value, onChange, suffix, ref, minValue, centerValue, maxValue, decimals, onSlide, label, withSlider = true, ...restProps }) {
      const [textValue, setTextValue] = useState(value + '');
      const [sliderValue, setSliderValue] = useState(() => utils.logScaling(value, { minValue, centerValue, maxValue }));
      const id = useId();
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
        const delta = -Math.sign(e.deltaY) * (decimals ? Math.pow(10, -1 * decimals) : 1) * (e.ctrlKey ? 100 : e.shiftKey ? 10 : 1);
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
          label && jsx("label", {
            htmlFor: id,
            children: label + ": "
          }),
          jsx("input", {
            className: "number-input",
            id: id,
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
          suffix != null && jsx("span", { style: { alignContent: 'center' } }, suffix),
          withSlider && internals.keys.MenuSliderControl && jsx(internals.nativeUI[internals.keys.MenuSliderControl], {
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
        ]
      })
    },
  }

  function generateCSS() {
    DOM.addStyle(meta.slug, `@scope (.${meta.slug}Root){
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
}

.canvas-dims {
  grid-column: 1 / -1;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 4px;
  color: var(--interactive-active);
  padding-bottom: 8px;
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
  &.pointerdown {
    cursor: grabbing;
  }
}

.canvas.moving {
  cursor: move;
}

.canvas.drawing {
  cursor: crosshair;
}

.canvas.texting {
  cursor: text;
}

@keyframes fade-in {
  from {opacity: 0}
  to {opacity: 1}
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
  inset: anchor(--canvas inside)
}

.canvas.cropping.pointerdown + .canvas-overlay > .cropper-region {
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.7);
  clip-path: polygon(
    0% 0%, 100% 0%, 100% 100%, 0 100%,
    var(--x1, 50%) var(--y2, 50%), var(--x2, 50%) var(--y2, 50%), var(--x2, 50%) var(--y1, 50%), var(--x1, 50%) var(--y1, 50%),
    var(--x1, 50%) var(--y2, 50%), 0 100%
  );
}

.canvas.cropping.pointerdown + .canvas-overlay > .cropper-border,
.canvas.texting + .canvas-overlay > .cropper-border {
  position: absolute;
  border: 1px solid black;
  outline: 1px dashed currentColor;
  outline-offset: -1px;
  left: var(--x1, -2px);
  right: calc(100% - var(--x2));
  top: var(--y1, -2px);
  bottom: calc(100% - var(--y2));
}

.canvas.drawing + .canvas-overlay > .cropper-region {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: top left;
  translate: var(--line-from, -1000px -1000px);
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
  &::after {
    right: -1px;
  }
  &::before {
    left: -1px;
  }
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

.canvas-actions {
  grid-column: 1 / -1;
  width: 128px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  & > .active {
    background-color: var(--background-modifier-active);
    color: var(--interactive-active);
    padding-bottom: 3px;
    padding-top: 5px;
  }
}

.aux-inputs {
  display: grid;
  gap: 16px;
  grid-template-rows: auto auto 1fr;
  align-self: start;
  grid-column: 1 / -1;
  color: var(--interactive-active);
  box-sizing: border-box;
  height: 100%;
  padding-top: 8px;
  border-top: 1px solid var(--border-normal);
  & > :nth-child(3) {
    align-self: end;
  }
}
[role=button] {
  border-radius: 8px;
}
[role=button].disabled {
  opacity: 0.5;
  cursor: default;
  color: var(--interactive-normal);
  background: none;
  padding: 4px;
}

.number-input-wrapper {
  display: flex;
  flex-wrap: wrap;
  color: var(--interactive-active);
  & > label {
    align-content: center;
  }
  & > .number-input ~ div {
    flex-basis: 100%;
    margin-top: 6px;
    margin-inline: 6px;
  }
}

.number-input {
  border: 1px solid var(--border-normal);
  border-radius: 6px;
  padding: 4px;
  margin: 2px;
  background: var(--background-modifier-active);
  color: currentColor;
  width: 2.75em;
  margin-left: auto;
  text-align: right;
}

.bd-color-picker-container {
  flex-direction: column;
  gap: 4px;
}

.bd-color-picker-controls {
  flex-basis: 100%;
}

.bd-color-picker {
  display: block;
  height: 3rem;
  width: 127px;
}

.bd-color-picker-swatch {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  place-items: center;
  margin: 0 !important;
}

.bd-color-picker-swatch-item {
  margin: 3px;
}

.sidebar {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto auto 1fr auto auto auto;
  gap: 8px;
  align-items: end;
  justify-content: center;
  overflow: auto;
}

.thumbnails {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column-reverse;
  max-height: calc(40px * 4);
  box-sizing: content-box;
  padding-top: 8px;
  border-top: 1px solid var(--border-normal);
  overflow: auto;
  scrollbar-gutter: stable;
  font-size: .8125em;
  &::before {
    content: "";
    position: absolute;
    inset: anchor(--active-thumbnail inside);
    background: #fff1;
    pointer-events: none;
    transition: inset 200ms ease-out;
  }
}

.thumbnail {
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 8px 4px;
  cursor: pointer;
  color: var(--interactive-normal);
  animation: fade-in 250ms;
  & > [role=button] {
    padding: 0;
  }
  &.active {
    anchor-name: --active-thumbnail;
  }
  &:hover {
    background: #fff1;
  }
}

.thumbnail-actions {
  display: flex;
  grid-column: 1 / -1;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-normal);
}

}`);
  }

  return { start, stop };
}
