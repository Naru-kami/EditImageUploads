/**
 * @name EditImageUploads
 * @author Narukami
 * @description Adds an option to edit images before sending.
 * @version 0.0.0
 */

module.exports = function (meta) {
  "use strict";

  const { React, Patcher, Webpack, Webpack: { Filters }, DOM, Logger } = BdApi;
  /** @type {typeof import("react")} */
  const { createElement: jsx, useState, useEffect, useRef, useImperativeHandle, useCallback, useMemo, Fragment } = React;

  var internals;

  function init() {
    if (internals) return;

    internals = utils.getBulk({
      uploadDispatcher: { filter: Filters.byKeys("setFile") }, // 166459
      uploadCard: { filter: Filters.bySource(".attachmentItemSmall]:") }, // 898463
      nativeUI: { filter: m => m.ConfirmModal }, // 481060
      Button: { filter: Filters.byKeys("Colors", "Link"), searchExports: true }, // 693789

      actionButtonClass: { filter: Filters.byKeys("dangerous", "button") },
      actionIconClass: { filter: m => m.actionBarIcon && m[Symbol.toStringTag] != "Module" },
      sliderClass: { filter: Filters.byKeys("sliderContainer", "slider") }
    });

    Object.assign(internals, {
      keys: {
        uploadCard: utils.getKeyInModule(internals.uploadCard, f => f.toString().includes(".attachmentItemSmall]:")),
        FocusRing: utils.getKeyInModule(internals.nativeUI, f => f.toString().includes("FocusRing was given a focusTarget")),
        openModal: utils.getKeyInModule(internals.nativeUI, f => f.toString().includes(",stackNextByDefault:")),
        MenuSliderControl: utils.getKeyInModule(internals.nativeUI, f => f.toString().includes("moveGrabber")),
      }
    })

    Logger.info(meta.slug, "Initialized");
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
          children: jsx(Components.EditIcon, { args })
        }))
      }
    });

    generateCSS();
  }

  function stop() {
    DOM.removeStyle(meta.slug);
    Patcher.unpatchAll(meta.slug);
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

    getKeyInModule(mod, fun) {
      for (const key in mod) {
        if (fun(mod[key])) return key;
      }
    },

    /**
     * @param {number} x
     * @param {number} y
     */
    atan2(x, y) {
      let angle = Math.round(Math.atan2(y, x) * 180 / Math.PI * 10) / 10;
      return (angle + 360) % 360;
    },

    /** @param {DOMMatrix} M */
    getAngle(M) {
      return utils.atan2(M.a, M.b);
    },

    /** @param {DOMMatrix} M */
    getScales(M) {
      return [Math.hypot(M.a, M.b), Math.hypot(M.c, M.d)];
    },

    /**
     * @param {HTMLCanvasElement} canvas
     * @param {{x1: number, x2: number, y1: number, y2: number}} rect
     * @param {number} strokeWidth
     * */
    resizeCanvas(canvas, rect, strokeWidth) {
      const canvasRect = {
        x1: -canvas.width / 2,
        x2: canvas.width / 2,
        y1: -canvas.height / 2,
        y2: canvas.height / 2
      }

      const dx = Math.max(0, canvasRect.x1 - (rect.x1 - strokeWidth / 2), (rect.x2 + strokeWidth / 2) - canvasRect.x2);
      const dy = Math.max(0, canvasRect.y1 - (rect.y1 - strokeWidth / 2), (rect.y2 + strokeWidth / 2) - canvasRect.y2);

      if (dx > 0 || dy > 0) {
        canvas.width += ~~(dx * 2);
        canvas.height += ~~(dy * 2);
      }
    },

    /**
     * @param {(ImageBitmap | HTMLCanvasElement)[]} images Source Images
     * @param {HTMLCanvasElement} canvas Target Canvas
     * @param {{M: DOMMatrix, width: number, height: number, strokes: {width: number, color: string, path2D: Path2D}}} transform
     */
    draw(images, canvas, transform) {
      canvas.height = transform.height;
      canvas.width = transform.width;

      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(new DOMMatrix().translateSelf(canvas.width / 2, canvas.height / 2).multiplySelf(transform.M));

      for (const img of images) {
        ctx.drawImage(img,
          -img.width / 2,
          -img.height / 2,
        );
      }
    },

    /**
     * @param {HTMLCanvasElement} canvas 
     * @param {{width: number, color: string, path2D: Path2D}[]} strokes
     */
    drawPaths(canvas, strokes) {
      const ctx = canvas.getContext("2d");
      ctx.save();
      ctx.setTransform(new DOMMatrix().translateSelf(canvas.width / 2, canvas.height / 2));
      ctx.clearRect(-canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (const stroke of strokes) {
        ctx.lineWidth = stroke.width;
        ctx.strokeStyle = stroke.color;
        ctx.stroke(stroke.path2D);
      }
      ctx.restore();
    },

    /**
     * @param {HTMLCanvasElement} canvas 
     * @param {{width: number, color: string, line: number[]}} stroke 
     */
    drawSingleLine(canvas, stroke) {
      if (!stroke?.line) return;
      const ctx = canvas.getContext("2d");

      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      ctx.beginPath();
      ctx.moveTo(stroke.line[0], stroke.line[1]);
      ctx.lineTo(stroke.line[2], stroke.line[3]);
      ctx.stroke();
    },

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
    clamp(min, x, max) {
      return Math.max(min, Math.min(x, max));
    },

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
     * Do **NOT** mutate the argument when setting state using a function.
     * It will change the previous state, if the state is not primitive.
     * @template T
     * @param {T | () => T} initialState
     * @returns {[T, typeof setState, { undo: () => void, redo: () => void, canUndo: boolean, canRedo: boolean }]}
    */
    useHistoryState(initialState) {
      const [state, _setState] = useState(initialState);
      const history = useRef([initialState instanceof Function ? initialState() : initialState]);
      const pointer = useRef(0);

      /** @type {(value: T | ((oldState: T) => T)) => void} */
      const setState = useCallback(value => {
        _setState(p => {
          const toAdd = value instanceof Function ? value(p) : value;

          history.current = history.current.slice(0, pointer.current + 1);
          history.current.push(toAdd);
          pointer.current++;
          return toAdd;
        });
      }, [_setState]);

      const undo = useCallback(() => {
        if (pointer.current <= 0) return;

        pointer.current--;
        _setState(history.current[pointer.current]);
      }, [_setState]);

      const redo = useCallback(() => {
        if (pointer.current + 1 >= history.current.length) return;

        pointer.current++;
        _setState(history.current[pointer.current]);
      }, [_setState]);

      return [state, setState, { undo, redo, canUndo: pointer.current > 0, canRedo: pointer.current < history.current.length - 1 }];
    },

    /** Wrapper for interaction events
     * @param {{
     *  onStart?: (e: PointerEvent) => void,
     *  onChange?:(e: PointerEvent) => void,
     *  onSubmit?: (e: PointerEvent) => void
     * }} props
    */
    usePointerCapture({ onStart, onChange, onSubmit }) {
      /** @type {React.RefObject<null | number>} */
      const pointerId = useRef(null);

      /** @type {(e: PointerEvent) => void} */
      const onPointerDown = useCallback(e => {
        if (!(e.buttons & 1)) return;

        pointerId.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        onStart?.(e);
      }, [onStart]);

      /** @type {(e: PointerEvent) => void} */
      const onPointerMove = useCallback(e => {
        if (!(e.buttons & 1) || pointerId.current !== e.pointerId) return;

        onChange?.(e);
      }, [onChange]);

      /** @type {(e: PointerEvent) => void} */
      const onPointerUp = useCallback(e => {
        if (!!(e.buttons & 1) || pointerId.current !== e.pointerId) return;

        e.currentTarget.releasePointerCapture(e.pointerId);
        pointerId.current = null;

        onSubmit?.(e);
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
     *  onRotate?: (M: DOMMatrix) => void,
     *  onRotateEnd?: (M: DOMMatrix) => void,
     * }} params
    */
    useRotate({ onRotate, onRotateEnd }) {
      const rotateRef = useRef(null);

      /** @type {(e: PointerEvent) => void} */
      const onStart = useCallback(e => {
        const rect = e.currentTarget.getBoundingClientRect();
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;

        rotateRef.current = {
          cx, cy,
          startAngle: utils.atan2(e.clientX - cx, e.clientY - cy)
        }
      }, []);

      /** @type {(e: PointerEvent) => void} */
      const onChange = useCallback(e => {
        if (rotateRef.current == null) return;

        let theta = utils.atan2(e.clientX - rotateRef.current.cx, e.clientY - rotateRef.current.cy) - rotateRef.current.startAngle;
        theta = Math.round((theta + 360) % 360 * 10) / 10;

        onRotate?.(new DOMMatrix().rotateSelf(theta));
      }, [onRotate]);

      /** @type {(e: PointerEvent) => void} */
      const onSubmit = useCallback(e => {
        let theta = utils.atan2(e.clientX - rotateRef.current.cx, e.clientY - rotateRef.current.cy) - rotateRef.current.startAngle;
        theta = Math.round((theta + 360) % 360 * 10) / 10;

        onRotateEnd?.(new DOMMatrix().rotateSelf(theta));
        rotateRef.current = null;
      }, [onRotateEnd]);

      return hooks.usePointerCapture({ onStart, onChange, onSubmit });
    },

    /**
     * @param {{
     *  onPan?: (M: DOMMatrix) => void,
     *  onPanEnd?:(M: DOMMatrix) => void ,
     * }} params
     */
    usePan({ onPan, onPanEnd }) {
      const panRef = useRef(null);

      const onStart = useCallback(e => {
        const rect = e.currentTarget.getBoundingClientRect();
        panRef.current = {
          x: e.clientX,
          y: e.clientY,
          rect,
        };
      }, []);

      /** @type {(e: PointerEvent) => void} */
      const onChange = useCallback(e => {
        if (panRef.current == null) return;

        onPan?.(new DOMMatrix().translateSelf(
          (e.clientX - panRef.current.x) / panRef.current.rect.width * e.currentTarget.width,
          (e.clientY - panRef.current.y) / panRef.current.rect.height * e.currentTarget.height
        ));

      }, [onPan]);

      /** @type {(e: PointerEvent) => void} */
      const onSubmit = useCallback(e => {
        onPanEnd?.(new DOMMatrix().translateSelf(
          (e.clientX - panRef.current.x) / panRef.current.rect.width * e.currentTarget.width,
          (e.clientY - panRef.current.y) / panRef.current.rect.height * e.currentTarget.height
        ));

        panRef.current = null;
      }, [onPanEnd]);

      return hooks.usePointerCapture({ onStart, onChange, onSubmit });
    },

    /**
     * @param {{
     *  onCropStart?: (e: DOMRect) => void ,
     *  onCrop?: (e: {x: number, y: number, dx: number, dy: number}) => void,
     *  onCropEnd?: (e: {width: number, height: number, M: DOMMatrix}) => void,
     *  fixedAspect?: boolean,
     * }} params
     */
    useCrop({ onCropStart, onCrop, onCropEnd, fixedAspect }) {
      /** @type {React.RefObject<null | {x: number, y: number, rect: DOMRect}>} */
      const cropRef = useRef(null);

      /** @type {(e: PointerEvent) => void} */
      const onStart = useCallback(e => {
        const rect = e.currentTarget.getBoundingClientRect();
        cropRef.current = {
          x: e.clientX,
          y: e.clientY,
          rect
        };
        onCropStart?.(rect);
      }, [onCropStart]);

      /** @type {(e: PointerEvent) => void} */
      const onChange = useCallback(e => {
        const minWidth = cropRef.current.rect.x - cropRef.current.x;
        const maxWidth = minWidth + cropRef.current.rect.width;
        const minHeight = cropRef.current.rect.y - cropRef.current.y;
        const maxHeight = minHeight + cropRef.current.rect.height;

        let dw = utils.clamp(minWidth, e.clientX - cropRef.current.x, maxWidth);
        let dh = utils.clamp(minHeight, e.clientY - cropRef.current.y, maxHeight);

        if (fixedAspect) {
          const aspect = e.currentTarget.width / e.currentTarget.height;

          dw = utils.maxAbs(dw, (Math.sign(dw) || 1) * Math.abs(dh) * aspect);
          dh = utils.maxAbs(dh, (Math.sign(dh) || 1) * Math.abs(dw) / aspect);

          dw = utils.clamp(minWidth, dw, maxWidth);
          dh = utils.clamp(minHeight, dh, maxHeight);

          dw = utils.minAbs(dw, (Math.sign(dw) || 1) * Math.abs(dh) * aspect);
          dh = utils.minAbs(dh, (Math.sign(dh) || 1) * Math.abs(dw) / aspect);
        }

        onCrop?.({
          x: (cropRef.current.x - cropRef.current.rect.x) / cropRef.current.rect.width * 100,
          y: (cropRef.current.y - cropRef.current.rect.y) / cropRef.current.rect.height * 100,
          dx: dw / cropRef.current.rect.width * 100,
          dy: dh / cropRef.current.rect.height * 100,
        });
      }, [onCrop, fixedAspect]);

      /** @type {(e: PointerEvent) => void} */
      const onSubmit = useCallback(e => {
        const minWidth = cropRef.current.rect.x - cropRef.current.x;
        const maxWidth = minWidth + cropRef.current.rect.width;
        const minHeight = cropRef.current.rect.y - cropRef.current.y;
        const maxHeight = minHeight + cropRef.current.rect.height;

        let dw = utils.clamp(minWidth, e.clientX - cropRef.current.x, maxWidth);
        let dh = utils.clamp(minHeight, e.clientY - cropRef.current.y, maxHeight);

        if (fixedAspect) {
          const aspect = e.currentTarget.width / e.currentTarget.height;

          dw = utils.maxAbs(dw, (Math.sign(dw) || 1) * Math.abs(dh) * aspect);
          dh = utils.maxAbs(dh, (Math.sign(dh) || 1) * Math.abs(dw) / aspect);

          dw = utils.clamp(minWidth, dw, maxWidth);
          dh = utils.clamp(minHeight, dh, maxHeight);

          dw = utils.minAbs(dw, (Math.sign(dw) || 1) * Math.abs(dh) * aspect);
          dh = utils.minAbs(dh, (Math.sign(dh) || 1) * Math.abs(dw) / aspect);
        }

        // canvas center
        const cx = cropRef.current.rect.x + cropRef.current.rect.width / 2;
        const cy = cropRef.current.rect.y + cropRef.current.rect.height / 2;
        // crop center
        const ccx = cropRef.current.x + dw / 2;
        const ccy = cropRef.current.y + dh / 2;

        onCropEnd?.({
          width: Math.abs(dw) / cropRef.current.rect.width * e.currentTarget.width,
          height: Math.abs(dh) / cropRef.current.rect.height * e.currentTarget.height,
          M: new DOMMatrix().translateSelf(
            (cx - ccx) / cropRef.current.rect.width * e.currentTarget.width,
            (cy - ccy) / cropRef.current.rect.height * e.currentTarget.height
          )
        });

        cropRef.current = null;
      }, [onCropEnd, fixedAspect]);

      return hooks.usePointerCapture({ onStart, onChange, onSubmit });
    },

    /**
     * @param {{
     *  initial: DOMMatrix,
     *  onScale?: (e: {s: number, M: DOMMatrix}) => void,
     *  onScaleEnd?: (e: DOMMatrix) => void,
     *  wait?: number,
     * }} params
     */
    useScale({ initial, onScale, onScaleEnd, wait = 350 }) {
      /** @type {React.RefObject<null | number>} */
      const timer = useRef(null);
      const M = useMemo(() => new DOMMatrix(), [initial]);
      const untransformedScale = useMemo(() => Math.max(...utils.getScales(initial)), [initial]);

      /** @type {(e: WheelEvent & {currentTarget: HTMLCanvasElement}) => void} */
      const onWheel = useCallback(e => {
        if (!e.deltaY) return;

        const currentScale = Math.max(...utils.getScales(M.multiply(initial)));
        const updatedScale = Number(Math.max(0.1, currentScale - 0.05 * Math.sign(e.deltaY)).toFixed(2));

        const rect = e.currentTarget.getBoundingClientRect();
        const Tx = ((e.clientX - rect.x) / rect.width - 0.5) * e.currentTarget.width;
        const Ty = ((e.clientY - rect.y) / rect.height - 0.5) * e.currentTarget.height;

        const T = new DOMMatrix().translateSelf(Tx, Ty);
        const T_inv = new DOMMatrix().translateSelf(-Tx, -Ty);
        const S = new DOMMatrix().scaleSelf(updatedScale, updatedScale);
        const S_inv = new DOMMatrix().scaleSelf(1 / currentScale, 1 / currentScale);

        M.preMultiplySelf(T.multiplySelf(S).multiplySelf(S_inv).multiplySelf(T_inv));

        onScale?.({ s: updatedScale, M: new DOMMatrix().multiply(M) });

        timer.current && clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          untransformedScale !== updatedScale && onScaleEnd?.(new DOMMatrix().multiply(M));
        }, wait);
      }, [onScale, onScaleEnd]);

      /** @type {(e: MouseEvent) => void} */
      const onMouseUp = useCallback(e => {
        if (e.button !== 0 && e.button !== 2) return;

        const currentScale = Math.max(...utils.getScales(M.multiply(initial)));
        const delta = e.button === 0 && e.ctrlKey || e.button === 2 ? -0.1 : 0.1;
        const updatedScale = Number(Math.max(0.1, currentScale + delta).toFixed(2));

        const rect = e.currentTarget.getBoundingClientRect();
        const Tx = ((e.clientX - rect.x) / rect.width - 0.5) * e.currentTarget.width;
        const Ty = ((e.clientY - rect.y) / rect.height - 0.5) * e.currentTarget.height;

        const T = new DOMMatrix().translateSelf(Tx, Ty);
        const T_inv = new DOMMatrix().translateSelf(-Tx, -Ty);
        const S = new DOMMatrix().scaleSelf(updatedScale, updatedScale);
        const S_inv = new DOMMatrix().scaleSelf(1 / currentScale, 1 / currentScale);

        M.preMultiplySelf(T.multiplySelf(S).multiplySelf(S_inv).multiplySelf(T_inv));

        onScale?.({ s: updatedScale, M: new DOMMatrix().multiply(M) });

        timer.current && clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          untransformedScale !== updatedScale && onScaleEnd?.(new DOMMatrix().multiply(M));
        }, wait);
      }, [onScale, onScaleEnd]);

      return { onWheel, onMouseUp }
    },

    /**
     * @param {{
     *  initial: DOMMatrix,
     *  onDraw?: (e: number[], strokeWidthScale: number) => void,
     *  onDrawEnd?: (path2d: Path2D, rect: {x1: number, x2: number, y1: number, y2: number}, strokeWidthScale: number) => void,
     * }} params
     */
    useHandDraw({ initial, onDraw, onDrawEnd }) {
      /**
       * @type {React.RefObject<null | {
       *  transformPoint: (x: number, y: number) => number[],
       *  path2D: Path2D,
       *  prev: number[],
       *  PathRect: {x1: number, x2: number, y1: number, y2: number},
       *  strokeWidthScale: number
       * }>}
       */
      const drawRef = useRef(null);

      /** @type {(e: PointerEvent & {currentTarget: HTMLCanvasElement}) => void} */
      const onStart = useCallback(e => {
        const rect = e.currentTarget.getBoundingClientRect();
        const width = e.currentTarget.width;
        const height = e.currentTarget.height;
        const inv = new DOMMatrix().translateSelf(width / 2, height / 2).multiplySelf(initial).invertSelf();

        const strokeWidthScale = width / rect.width / Math.max(...utils.getScales(initial));

        drawRef.current = {
          transformPoint(x, y) {
            const X = utils.clamp(0, x - rect.x, rect.width) / rect.width * width;
            const Y = utils.clamp(0, y - rect.y, rect.height) / rect.height * height;
            const point = new DOMPoint(X, Y).matrixTransform(inv);
            return [Math.round(point.x), Math.round(point.y)]
          },
          path2D: new Path2D(),
          strokeWidthScale
        }

        drawRef.current.prev = drawRef.current.transformPoint(e.clientX, e.clientY);
        drawRef.current.PathRect = {
          x1: drawRef.current.prev[0],
          x2: drawRef.current.prev[0],
          y1: drawRef.current.prev[1],
          y2: drawRef.current.prev[1],
        };
        drawRef.current.path2D.moveTo(...drawRef.current.prev);
      }, [initial]);

      /** @type {(e: PointerEvent) => void} */
      const onChange = useCallback(e => {
        if (!drawRef.current) return;
        const p = drawRef.current.transformPoint(e.clientX, e.clientY);

        drawRef.current.PathRect.x1 = Math.min(drawRef.current.PathRect.x1, p[0]);
        drawRef.current.PathRect.x2 = Math.max(drawRef.current.PathRect.x2, p[0]);
        drawRef.current.PathRect.y1 = Math.min(drawRef.current.PathRect.y1, p[1]);
        drawRef.current.PathRect.y2 = Math.max(drawRef.current.PathRect.y2, p[1]);

        onDraw?.(drawRef.current.prev.concat(p), drawRef.current.strokeWidthScale);
        drawRef.current.path2D.lineTo(...p);
        drawRef.current.prev = p;
      }, [onDraw]);

      const onSubmit = useCallback(() => {
        onDrawEnd?.(drawRef.current.path2D, drawRef.current.PathRect, drawRef.current.strokeWidthScale);
        drawRef.current = null;
      }, [onDrawEnd]);

      return hooks.usePointerCapture({ onStart, onChange, onSubmit })
    },
  }

  var Components = {
    /**
     * @param {{
     * onClick?: (e: MouseEvent) => void,
     * tooltip?: string,
     * d?: string,
     * disabled?: boolean,
     * active?: boolean}} props
     * */
    IconButton({ onClick, tooltip, d, disabled, active }) {
      return jsx(BdApi.Components.ErrorBoundary, {
        children: jsx(BdApi.Components.Tooltip, {
          text: tooltip || '',
          hideOnClick: true,
          children: e => {
            let { onMouseEnter, onMouseLeave, onClick: onClick2 } = e;
            const handleClick = e => { if (!disabled) { onClick?.(e); onClick2?.(e) } };
            const handleKeyUp = e => (e.key === 'Enter' || e.key === ' ') && handleClick(e);

            return jsx(internals.nativeUI[internals.keys.FocusRing], {
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

    EditIcon({ args }) {
      // forwardRef for submit()
      const userActions = useRef(null);

      return jsx(Components.IconButton, {
        onClick: () => {
          createImageBitmap(args.upload.item.file).then(bitmap => {
            internals.nativeUI[internals.keys.openModal]?.(e => jsx(BdApi.Components.ErrorBoundary, null,
              jsx(internals.nativeUI.ConfirmModal, {
                ...e,
                className: `${meta.slug}Root`,
                confirmText: "Save",
                cancelText: "Cancel",
                confirmButtonColor: internals.Button.Colors.BRAND,
                onConfirm: () => {
                  userActions.current?.submit({
                    draftType: args.draftType,
                    upload: args.upload,
                  })
                },
                children: jsx(Components.ImageEditor, {
                  bitmap,
                  ref: userActions
                }),
              }))
            )
          }).catch(() => {
            BdApi.UI.showToast("Could not load image", { type: "error" });
          });
        },
        tooltip: "Edit Image",
        d: utils.paths.Main
      })
    },

    /** @param {{bitmap: ImageBitmap, ref: React.RefObject<any>}} props */
    ImageEditor({ bitmap, ref }) {
      const [transform, setTransform, transformHistActions] = hooks.useHistoryState(() => ({
        M: new DOMMatrix(),
        width: bitmap.width,
        height: bitmap.height,
        /** @type {{color: string, width: number, path2D: Path2D}[]} */
        strokes: []
      }));
      const [mode, setMode] = useState(null);
      const [fixedAspect, setFixedAspect] = hooks.useStoredState("fixedAspectRatio", true);
      const [strokeStyle, setStrokeStyle] = hooks.useStoredState("strokeStyle", () => ({ width: 5, color: "#000000" }));

      /** @type { React.RefObject<HTMLCanvasElement | null> } */
      const canvas = useRef(null);
      const cachedStrokes = useRef(new OffscreenCanvas(1, 1));
      /** @type { React.RefObject<HTMLDivElement | null> } */
      const overlay = useRef(null);
      /** @type { React.RefObject<{setValue: (value: number) => void } | null> } */
      const auxRef = useRef(null);

      const cropHandlers = hooks.useCrop({
        fixedAspect,
        onCropStart: rect => {
          overlay.current.style.width = rect.width + "px";
          overlay.current.style.height = rect.height + "px";
        },
        onCrop: ({ x, y, dx, dy }) => {
          overlay.current.style.setProperty("--x1", Math.min(x, x + dx) + "%");
          overlay.current.style.setProperty("--x2", Math.max(x, x + dx) + "%");
          overlay.current.style.setProperty("--y1", Math.min(y, y + dy) + "%");
          overlay.current.style.setProperty("--y2", Math.max(y, y + dy) + "%");
        },
        onCropEnd: C => {
          overlay.current.removeAttribute("style");
          setTransform(T => ({ ...T, ...C, M: C.M.multiplySelf(T.M) }));
        }
      });

      const rotateHandlers = hooks.useRotate({
        onRotate: R => {
          const r = utils.getAngle(transform.M);
          const dr = utils.getAngle(R);
          auxRef.current.setValue(Number(((r + dr) % 360).toFixed(1)));

          utils.draw([bitmap, cachedStrokes.current], canvas.current, { ...transform, M: R.multiplySelf(transform.M) });
        },
        onRotateEnd: R => setTransform(T => ({ ...T, M: R.multiplySelf(T.M) }))
      });

      const panHandlers = hooks.usePan({
        onPan: P => utils.draw([bitmap, cachedStrokes.current], canvas.current, { ...transform, M: P.multiplySelf(transform.M) }),
        onPanEnd: P => setTransform(T => ({ ...T, M: P.multiplySelf(T.M) }))
      });

      const scaleHandlers = hooks.useScale({
        initial: transform.M,
        onScale: ({ s, M }) => {
          auxRef.current.setValue(Number(s.toFixed(2)));
          utils.draw([bitmap, cachedStrokes.current], canvas.current, { ...transform, M: M.multiplySelf(transform.M) });
        },
        onScaleEnd: S => setTransform(T => ({ ...T, M: S.multiplySelf(T.M) }))
      });

      const drawHandlers = hooks.useHandDraw({
        initial: transform.M,
        onDraw: (line, scale) => {
          utils.drawSingleLine(canvas.current, {
            color: strokeStyle.color,
            width: Math.round(strokeStyle.width * scale),
            line
          })
        },
        onDrawEnd: (path2D, pathRect, scale) => {
          utils.resizeCanvas(cachedStrokes.current, pathRect, Math.round(strokeStyle.width * scale));
          setTransform(T => ({
            ...T, strokes: [...T.strokes, {
              color: strokeStyle.color,
              width: Math.round(strokeStyle.width * scale),
              path2D
            }]
          }));
        }
      });

      useImperativeHandle(ref, () => ({
        submit: ({ draftType, upload }) => {
          if (!canvas.current) {
            BdApi.UI.showToast("Reference lost. Failed to save changes.", { type: "error" });
            return;
          }
          canvas.current.toBlob(blob => {
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
            BdApi.UI.showToast("Saved changes", { type: "success" });
          }, "image/webp");
        }
      }), []);

      useEffect(() => {
        const ctrl = new AbortController();

        addEventListener("keydown", e => {
          if (!e.ctrlKey) return;

          switch (e.key) {
            case "z":
              transformHistActions.undo();
              return;

            case "y":
              transformHistActions.redo();
              return;

            case "Control":
              !e.repeat && canvas.current.matches(".scaling") &&
                canvas.current.classList.add("out");
          }
        }, ctrl);

        addEventListener("keyup", e => {
          switch (e.key) {
            case "c":
              setMode(m => m === 0 ? null : 0);
              return;

            case "r":
              setMode(m => m === 1 ? null : 1);
              return;

            case "p":
              setMode(m => m === 2 ? null : 2);
              return;

            case "s":
              setMode(m => m === 3 ? null : 3);
              return;

            case "d":
              setMode(m => m === 4 ? null : 4);
              return;

            case "Control":
              canvas.current.matches(".out") && canvas.current.classList.remove("out");
          }
        }, ctrl);

        return () => ctrl.abort();
      }, []);

      useEffect(() => {
        // on stale cache, redraw paths 
        utils.drawPaths(cachedStrokes.current, transform.strokes);
      }, [transform.strokes])

      useEffect(() => {
        if (!canvas.current) return;
        utils.draw([bitmap, cachedStrokes.current], canvas.current, transform);
      }, [transform]);

      return jsx(Fragment, {
        children: [
          jsx("div", {
            className: "canvas-dims",
            children: [
              jsx(Components.NumberSlider, {
                value: Math.round(transform.width),
                decimals: 0,
                onChange: v => setTransform(T => ({ ...T, width: v })),
                withSlider: false,
                minValue: 0,
              }),
              "x",
              jsx(Components.NumberSlider, {
                value: Math.round(transform.height),
                decimals: 0,
                onChange: v => setTransform(T => ({ ...T, height: v })),
                withSlider: false,
                minValue: 0,
              }),
            ]
          }),
          jsx("div", {
            className: "canvas-wrapper",
            children: [
              jsx("canvas", {
                className: ["canvas", ["cropping", "rotating", "moving", "scaling", "drawing"][mode]].filter(Boolean).join(" "),
                ref: canvas,
                ...([cropHandlers, rotateHandlers, panHandlers, scaleHandlers, drawHandlers][mode] ?? {})
              }),
              (mode === 0 || mode === 4) && jsx("div", {
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
                tooltip: "Pan (P)",
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
              mode == 0 && jsx("label", {
                className: "aux-input",
                style: { gap: 8, cursor: "pointer" },
                children: [
                  jsx(Components.IconButton, {
                    tooltip: fixedAspect ? "Preserve aspect ratio" : "Free region select",
                    d: fixedAspect ? utils.paths.Lock : utils.paths.LockOpen,
                    onClick: () => setFixedAspect(e => !e),
                  }),
                ]
              }),
              mode == 1 && jsx("div", {
                className: "aux-input",
                children: jsx(Components.NumberSlider, {
                  ref: auxRef,
                  suffix: "°",
                  decimals: 0,
                  withSlider: false,
                  value: Number(utils.getAngle(transform.M).toFixed(1)),
                  onChange: r => setTransform(T => {
                    const current = Number(utils.getAngle(T.M).toFixed(1));
                    return { ...T, M: new DOMMatrix().rotateSelf(r - current).multiplySelf(T.M) };
                  })
                })
              }),
              mode == 3 && jsx("div", {
                className: "aux-input",
                children: jsx(Components.NumberSlider, {
                  ref: auxRef,
                  suffix: "x",
                  decimals: 2,
                  minValue: 0.1,
                  centerValue: 1,
                  maxValue: 10,
                  value: Number(Math.hypot(transform.M.a, transform.M.b).toFixed(2)),
                  onSlide: value => {
                    const [scaleX, scaleY] = utils.getScales(transform.M);
                    const N = new DOMMatrix().scaleSelf(1 / scaleX, 1 / scaleY);

                    utils.draw([bitmap, cachedStrokes.current], canvas.current, {
                      ...transform,
                      M: new DOMMatrix().scaleSelf(value, value).multiplySelf(N).multiplySelf(transform.M)
                    });
                  },
                  onChange: value => {
                    setTransform(T => {
                      const [scaleX, scaleY] = utils.getScales(T.M);
                      const N = new DOMMatrix().scaleSelf(1 / scaleX, 1 / scaleY);

                      return {
                        ...T,
                        M: new DOMMatrix().scaleSelf(value, value).multiplySelf(N).multiplySelf(T.M)
                      }
                    })
                  }
                })
              }),
              mode == 4 && jsx("div", {
                className: "aux-input",
                children: [
                  jsx(BdApi.Components.ColorInput, {
                    value: strokeStyle.color,                                           // Can't use x < 256: 0 -> "#0". No zero padding
                    colors: [1752220, 3066993, 3447003, 10181046, 15277667, 15844367, 15105570, 15158332, "#000000", 16777215],
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
                      overlay.current.style.setProperty("--brushsize", value);
                    },
                    onChange: v => {
                      overlay.current.style.removeProperty("--brushsize");
                      setStrokeStyle(s => ({ ...s, width: v }))
                    }
                  })
                ]
              }),
              jsx(Components.IconButton, {
                tooltip: "Flip Horizontal",
                d: utils.paths.FlipH,
                onClick: () => setTransform(T => ({ ...T, M: new DOMMatrix().scaleSelf(-1, 1).multiplySelf(T.M) })),
              }),
              jsx(Components.IconButton, {
                tooltip: "Flip Vertical",
                d: utils.paths.FlipV,
                onClick: () => setTransform(T => ({ ...T, M: new DOMMatrix().scaleSelf(1, -1).multiplySelf(T.M) })),
              }),
              jsx(Components.IconButton, {
                tooltip: "Rotate Left",
                d: utils.paths.RotL,
                onClick: () => setTransform(T => ({
                  ...T,
                  width: T.height,
                  height: T.width,
                  M: new DOMMatrix().rotateSelf(-90).multiplySelf(T.M)
                })),
              }),
              jsx(Components.IconButton, {
                tooltip: "Rotate Right",
                d: utils.paths.RotR,
                onClick: () => setTransform(T => ({
                  ...T,
                  width: T.height,
                  height: T.width,
                  M: new DOMMatrix().rotateSelf(90).multiplySelf(T.M)
                })),
              }),
              jsx(Components.IconButton, {
                tooltip: "Undo (Ctrl + Z)",
                d: utils.paths.Undo,
                onClick: transformHistActions.undo,
                disabled: !transformHistActions.canUndo
              }),
              jsx(Components.IconButton, {
                tooltip: "Redo (Ctrl + Y)",
                d: utils.paths.Redo,
                onClick: transformHistActions.redo,
                disabled: !transformHistActions.canRedo
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
      const sliderRef = useRef(null);

      useImperativeHandle(ref, () => ({
        setValue: v => {
          setTextValue(v + '');
          oldValue.current = v;

          const val = utils.logScaling(v, { minValue, centerValue, maxValue });
          setSliderValue(val);
          sliderRef.current?._reactInternals.stateNode.setState({ value: val });
        }
      }), [minValue, centerValue, maxValue]);

      useEffect(() => {
        setTextValue(value + '');
        oldValue.current = value;

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
        if (document.activeElement !== e.currentTarget || !e.deltaY) return;
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
            children: jsx(internals.nativeUI[internals.keys.MenuSliderControl], {
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
  height: calc(100% - 100px);
  display: grid;
  place-items: center;
  position: relative;
  color: var(--interactive-active);
}

.canvas {
  max-width: 100%;
  max-height: 100%;
  display: block;
  overflow: hidden;
  background: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%3E%3Cpath%20d%3D%22M8%200h8v8H0v8h8z%22%20fill%3D%22%238F8F8F%22%2F%3E%3Cpath%20d%3D%22M0%200h8v16h8V8H0z%22%20fill%3D%22%23BFBFBF%22%2F%3E%3C%2Fsvg%3E");
}                   

.canvas.cropping {
  box-shadow: 0 0 12px 0 rgb(from currentColor r g b / 0.4);
  cursor: crosshair;
}

.canvas.rotating {
  box-shadow: 0 0 12px 0 rgb(from currentColor r g b / 0.4);
  cursor: grab;
  &:active {
    cursor: grabbing;
  }
}

.canvas.moving {
  box-shadow: 0 0 12px 0 rgb(from currentColor r g b / 0.4);
  cursor: move;
}

.canvas.scaling {
  box-shadow: 0 0 12px 0 rgb(from currentColor r g b / 0.4);
  cursor: zoom-in;
  &.out {
    cursor: zoom-out;
  }
}

.canvas.drawing {
  box-shadow: 0 0 12px 0 rgb(from currentColor r g b / 0.4);
  cursor: crosshair;
  &:active {
    cursor: none;
  }
}

@keyframes pulsing {
  from {opacity: 0}
  to {opacity: 0.8}
}

.canvas-wrapper:has(> .rotating)::after {
  content: "+";
  font-size: 1.5em;
  line-height: 0.42;
  color: #000;
  background: #fff;
  position: absolute;
  pointer-events: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid currentColor;
  outline: 1px solid #fff;
  animation: pulsing 2s infinite alternate ease-out;
}

.canvas-overlay {
  position: absolute;
  pointer-events: none;
}

.canvas.cropping:active + .canvas-overlay > .cropper-region {
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.7);
  clip-path: polygon(
    0% 0%, 100% 0%, 100% 100%, 0 100%,
    var(--x1, 0%) var(--y2, 100%), var(--x2, 100%) var(--y2, 100%), var(--x2, 100%) var(--y1, 0%), var(--x1, 0%) var(--y1, 0%),
    var(--x1, 0%) var(--y2, 100%), 0 100%
  );
}

.canvas.cropping:active + .canvas-overlay > .cropper-border {
  position: absolute;
  outline: 1px dashed currentColor;
  left: var(--x1, 0%);
  right: calc(100% - var(--x2, 0%));
  top: var(--y1, 0%);
  bottom: calc(100% - var(--y2, 0%));
}

.canvas.drawing + .canvas-overlay {
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
