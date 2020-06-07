"use strict";
const vm = require("vm");
const webIDLConversions = require("webidl-conversions");
const { CSSStyleDeclaration } = require("cssstyle");
const { Performance: RawPerformance } = require("w3c-hr-time");
const notImplemented = require("./not-implemented");
const { define, mixin } = require("../utils");
const EventTarget = require("../living/generated/EventTarget");
const namedPropertiesWindow = require("../living/named-properties-window");
const cssom = require("cssom");
const postMessage = require("../living/post-message");
const DOMException = require("domexception");
const { btoa, atob } = require("abab");
const idlUtils = require("../living/generated/utils");
const createXMLHttpRequest = require("../living/xmlhttprequest");
const createFileReader = require("../living/generated/FileReader").createInterface;
const createWebSocket = require("../living/generated/WebSocket").createInterface;
const WebSocketImpl = require("../living/websockets/WebSocket-impl").implementation;
const BarProp = require("../living/generated/BarProp");
const Document = require("../living/generated/Document");
const External = require("../living/generated/External");
const Navigator = require("../living/generated/Navigator");
const Performance = require("../living/generated/Performance");
const Screen = require("../living/generated/Screen");
const Storage = require("../living/generated/Storage");
const createAbortController = require("../living/generated/AbortController").createInterface;
const createAbortSignal = require("../living/generated/AbortSignal").createInterface;
const reportException = require("../living/helpers/runtime-script-errors");
const { matchesDontThrow } = require("../living/helpers/selectors");
const SessionHistory = require("../living/window/SessionHistory");

const GlobalEventHandlersImpl = require("../living/nodes/GlobalEventHandlers-impl").implementation;
const WindowEventHandlersImpl = require("../living/nodes/WindowEventHandlers-impl").implementation;

// NB: the require() must be after assigning `module.exports` because this require() is circular
// TODO: this above note might not even be true anymore... figure out the cycle and document it, or clean up.
module.exports = Window;
const dom = require("../living");

const cssSelectorSplitRE = /((?:[^,"']|"[^"]*"|'[^']*')+)/;

const defaultStyleSheet = cssom.parse(require("./default-stylesheet"));

dom.Window = Window;

// NOTE: per https://heycam.github.io/webidl/#Global, all properties on the Window object must be own-properties.
// That is why we assign everything inside of the constructor, instead of using a shared prototype.
// You can verify this in e.g. Firefox or Internet Explorer, which do a good job with Web IDL compliance.

function Window(options) {
  EventTarget.setup(this);

  const rawPerformance = new RawPerformance();
  const windowInitialized = rawPerformance.now();

  const window = this;

  mixin(window, WindowEventHandlersImpl.prototype);
  mixin(window, GlobalEventHandlersImpl.prototype);

  this._initGlobalEvents();

  ///// INTERFACES FROM THE DOM
  // TODO: consider a mode of some sort where these are not shared between all DOM instances
  // It'd be very memory-expensive in most cases, though.
  for (const name in dom) {
    Object.defineProperty(window, name, {
      enumerable: false,
      configurable: true,
      writable: true,
      value: dom[name]
    });
  }

  ///// PRIVATE DATA PROPERTIES

  this._resourceLoader = options.resourceLoader;

  // vm initialization is deferred until script processing is activated
  this._globalProxy = this;
  Object.defineProperty(idlUtils.implForWrapper(this), idlUtils.wrapperSymbol, { get: () => this._globalProxy });

  // List options explicitly to be clear which are passed through
  this._document = Document.create([], {
    options: {
      parsingMode: options.parsingMode,
      contentType: options.contentType,
      encoding: options.encoding,
      cookieJar: options.cookieJar,
      url: options.url,
      lastModified: options.lastModified,
      referrer: options.referrer,
      concurrentNodeIterators: options.concurrentNodeIterators,
      parseOptions: options.parseOptions,
      defaultView: this._globalProxy,
      global: this
    }
  });
  // https://html.spec.whatwg.org/#session-history
  this._sessionHistory = new SessionHistory({
    document: idlUtils.implForWrapper(this._document),
    url: idlUtils.implForWrapper(this._document)._URL,
    stateObject: null
  }, this);

  this._virtualConsole = options.virtualConsole;

  this._runScripts = options.runScripts;
  if (this._runScripts === "outside-only" || this._runScripts === "dangerously") {
    contextifyWindow(this);
  }

  // Set up the window as if it's a top level window.
  // If it's not, then references will be corrected by frame/iframe code.
  this._parent = this._top = this._globalProxy;
  this._frameElement = null;

  // This implements window.frames.length, since window.frames returns a
  // self reference to the window object.  This value is incremented in the
  // HTMLFrameElement implementation.
  this._length = 0;

  this._pretendToBeVisual = options.pretendToBeVisual;
  this._storageQuota = options.storageQuota;

  // Some properties (such as localStorage and sessionStorage) share data
  // between windows in the same origin. This object is intended
  // to contain such data.
  if (options.commonForOrigin && options.commonForOrigin[this._document.origin]) {
    this._commonForOrigin = options.commonForOrigin;
  } else {
    this._commonForOrigin = {
      [this._document.origin]: {
        localStorageArea: new Map(),
        sessionStorageArea: new Map(),
        windowsInSameOrigin: [this]
      }
    };
  }

  this._currentOriginData = this._commonForOrigin[this._document.origin];

  ///// WEB STORAGE

  this._localStorage = Storage.create([], {
    associatedWindow: this,
    storageArea: this._currentOriginData.localStorageArea,
    type: "localStorage",
    url: this._document.documentURI,
    storageQuota: this._storageQuota
  });
  this._sessionStorage = Storage.create([], {
    associatedWindow: this,
    storageArea: this._currentOriginData.sessionStorageArea,
    type: "sessionStorage",
    url: this._document.documentURI,
    storageQuota: this._storageQuota
  });

  ///// GETTERS

  const locationbar = BarProp.create();
  const menubar = BarProp.create();
  const personalbar = BarProp.create();
  const scrollbars = BarProp.create();
  const statusbar = BarProp.create();
  const toolbar = BarProp.create();
  const external = External.create();
  const navigator = Navigator.create([], { userAgent: this._resourceLoader._userAgent });
  const performance = Performance.create([], { rawPerformance });
  const screen = Screen.create();

  define(this, {
    get length() {
      return window._length;
    },
    get window() {
      return window._globalProxy;
    },
    get frameElement() {
      return idlUtils.wrapperForImpl(window._frameElement);
    },
    get frames() {
      return window._globalProxy;
    },
    get self() {
      return window._globalProxy;
    },
    get parent() {
      return window._parent;
    },
    get top() {
      return window._top;
    },
    get document() {
      return window._document;
    },
    get external() {
      return external;
    },
    get location() {
      return idlUtils.wrapperForImpl(idlUtils.implForWrapper(window._document)._location);
    },
    get history() {
      return idlUtils.wrapperForImpl(idlUtils.implForWrapper(window._document)._history);
    },
    get navigator() {
      return navigator;
    },
    get locationbar() {
      return locationbar;
    },
    get menubar() {
      return menubar;
    },
    get personalbar() {
      return personalbar;
    },
    get scrollbars() {
      return scrollbars;
    },
    get statusbar() {
      return statusbar;
    },
    get toolbar() {
      return toolbar;
    },
    get performance() {
      return performance;
    },
    get screen() {
      return screen;
    },
    get localStorage() {
      if (this._document.origin === "null") {
        throw new DOMException("localStorage is not available for opaque origins", "SecurityError");
      }

      return this._localStorage;
    },
    get sessionStorage() {
      if (this._document.origin === "null") {
        throw new DOMException("sessionStorage is not available for opaque origins", "SecurityError");
      }

      return this._sessionStorage;
    }
  });

  namedPropertiesWindow.initializeWindow(this, this._globalProxy);

  ///// METHODS for [ImplicitThis] hack
  // See https://lists.w3.org/Archives/Public/public-script-coord/2015JanMar/0109.html
  this.addEventListener = this.addEventListener.bind(this);
  this.removeEventListener = this.removeEventListener.bind(this);
  this.dispatchEvent = this.dispatchEvent.bind(this);

  ///// METHODS

  // Shahar: I updated timers implementation based on the following commits:
  // https://github.com/jsdom/jsdom/commit/1ebb1fcd3823882e2cee36afcd1b78217b629ee4#diff-d2945e8f0e1420500da68155ca6a49f0
  // https://github.com/jsdom/jsdom/commit/55fc024429e95ba9fe278ab4546affefae9f7207#diff-d2945e8f0e1420500da68155ca6a49f0
  // https://github.com/jsdom/jsdom/commit/086c241b6678e18cb0805152d25bc48789cc9cc6#diff-d2945e8f0e1420500da68155ca6a49f0

  // https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers

  // In the spec the list of active timers is a set of IDs. We make it a map of IDs to Node.js timer objects, so that
  // we can call Node.js-side clearTimeout() when clearing, and thus allow process shutdown faster.
  const listOfActiveTimers = new Map();
  let latestTimerId = 0;

  this.setTimeout = function (handler, timeout = 0, ...args) {
    if (typeof handler !== "function") {
      handler = webIDLConversions.DOMString(handler);
    }
    timeout = webIDLConversions.long(timeout);

    return timerInitializationSteps(handler, timeout, args, { methodContext: window, repeat: false });
  };
  this.setInterval = function (handler, timeout = 0, ...args) {
    if (typeof handler !== "function") {
      handler = webIDLConversions.DOMString(handler);
    }
    timeout = webIDLConversions.long(timeout);

    return timerInitializationSteps(handler, timeout, args, { methodContext: window, repeat: true });
  };

  this.clearTimeout = function (handle = 0) {
    handle = webIDLConversions.long(handle);

    const nodejsTimer = listOfActiveTimers.get(handle);
    if (nodejsTimer) {
      clearTimeout(nodejsTimer);
      listOfActiveTimers.delete(handle);
    }
  };
  this.clearInterval = function (handle = 0) {
    handle = webIDLConversions.long(handle);

    const nodejsTimer = listOfActiveTimers.get(handle);
    if (nodejsTimer) {
      // We use setTimeout() in timerInitializationSteps even for this.setInterval().
      clearTimeout(nodejsTimer);
      listOfActiveTimers.delete(handle);
    }
  };

  function timerInitializationSteps(handler, timeout, args, { methodContext, repeat, previousHandle }) {
    // This appears to be unspecced, but matches browser behavior for close()ed windows.
    if (!methodContext._document) {
      return 0;
    }

    if (methodContext.__closed) {
      console.warn('Trying to create a timer after window closed.');
      return 0;
    }

    // TODO: implement timer nesting level behavior.

    const methodContextProxy = methodContext._globalProxy;
    const handle = previousHandle !== undefined ? previousHandle : ++latestTimerId;

    function task() {
      if (!listOfActiveTimers.has(handle)) {
        return;
      }

      try {
        if (typeof handler === "function") {
          handler.apply(methodContextProxy, args);
        } else if (window._runScripts === "dangerously") {
          vm.runInContext(handler, window, { filename: window.location.href, displayErrors: false });
        }
      } catch (e) {
        reportException(window, e, window.location.href);
      }

      if (listOfActiveTimers.has(handle)) {
        if (repeat) {
          timerInitializationSteps(handler, timeout, args, { methodContext, repeat: true, previousHandle: handle });
        } else {
          listOfActiveTimers.delete(handle);
        }
      }
    }

    if (timeout < 0) {
      timeout = 0;
    }

    const nodejsTimer = setTimeout(task, timeout);
    listOfActiveTimers.set(handle, nodejsTimer);

    return handle;
  }

  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#animation-frames

  let animationFrameCallbackId = 0;
  const mapOfAnimationFrameCallbacks = new Map();
  let animationFrameNodejsInterval = null;

  // Unlike the spec, where an animation frame happens every 60 Hz regardless, we optimize so that if there are no
  // requestAnimationFrame() calls outstanding, we don't fire the timer. This helps us track that.
  let numberOfOngoingAnimationFrameCallbacks = 0;

  if (this._pretendToBeVisual) {
    this.requestAnimationFrame = function (callback) {
      callback = webIDLConversions.Function(callback);

      const handle = ++animationFrameCallbackId;
      mapOfAnimationFrameCallbacks.set(handle, callback);

      ++numberOfOngoingAnimationFrameCallbacks;
      if (numberOfOngoingAnimationFrameCallbacks === 1) {
        animationFrameNodejsInterval = setInterval(() => {
          runAnimationFrameCallbacks(rawPerformance.now() - windowInitialized);
        }, 1000 / 60);
      }

      return handle;
    };
    this.cancelAnimationFrame = function (handle) {
      handle = webIDLConversions["unsigned long"](handle);
      removeAnimationFrameCallback(handle);
    };

    function runAnimationFrameCallbacks(now) {
      // Converting to an array is important to get a sync snapshot and thus match spec semantics.
      const callbackHandles = [...mapOfAnimationFrameCallbacks.keys()];
      for (const handle of callbackHandles) {
        // This has() can be false if a callback calls cancelAnimationFrame().
        if (mapOfAnimationFrameCallbacks.has(handle)) {
          const callback = mapOfAnimationFrameCallbacks.get(handle);
          removeAnimationFrameCallback(handle);
          try {
            callback(now);
          } catch (e) {
            reportException(window, e, window.location.href);
          }
        }
      }
    }
  
    function removeAnimationFrameCallback(handle) {
      if (mapOfAnimationFrameCallbacks.has(handle)) {
        --numberOfOngoingAnimationFrameCallbacks;
        if (numberOfOngoingAnimationFrameCallbacks === 0) {
          clearInterval(animationFrameNodejsInterval);
        }
      }

      mapOfAnimationFrameCallbacks.delete(handle);
    }
  }

  function stopAllTimers() {
    for (const nodejsTimer of listOfActiveTimers.values()) {
      clearTimeout(nodejsTimer);
    }
    listOfActiveTimers.clear();

    clearInterval(animationFrameNodejsInterval);
  }
  
  function Option(text, value, defaultSelected, selected) {
    if (text === undefined) {
      text = "";
    }
    text = webIDLConversions.DOMString(text);

    if (value !== undefined) {
      value = webIDLConversions.DOMString(value);
    }

    defaultSelected = webIDLConversions.boolean(defaultSelected);
    selected = webIDLConversions.boolean(selected);

    const option = window._document.createElement("option");
    const impl = idlUtils.implForWrapper(option);

    if (text !== "") {
      impl.text = text;
    }
    if (value !== undefined) {
      impl.setAttribute("value", value);
    }
    if (defaultSelected) {
      impl.setAttribute("selected", "");
    }
    impl._selectedness = selected;

    return option;
  }
  Object.defineProperty(Option, "prototype", {
    value: this.HTMLOptionElement.prototype,
    configurable: false,
    enumerable: false,
    writable: false
  });
  Object.defineProperty(window, "Option", {
    value: Option,
    configurable: true,
    enumerable: false,
    writable: true
  });

  function Image() {
    const img = window._document.createElement("img");
    const impl = idlUtils.implForWrapper(img);

    if (arguments.length > 0) {
      impl.setAttribute("width", String(arguments[0]));
    }
    if (arguments.length > 1) {
      impl.setAttribute("height", String(arguments[1]));
    }

    return img;
  }
  Object.defineProperty(Image, "prototype", {
    value: this.HTMLImageElement.prototype,
    configurable: false,
    enumerable: false,
    writable: false
  });
  Object.defineProperty(window, "Image", {
    value: Image,
    configurable: true,
    enumerable: false,
    writable: true
  });

  function Audio(src) {
    const audio = window._document.createElement("audio");
    const impl = idlUtils.implForWrapper(audio);
    impl.setAttribute("preload", "auto");

    if (src !== undefined) {
      impl.setAttribute("src", String(src));
    }

    return audio;
  }
  Object.defineProperty(Audio, "prototype", {
    value: this.HTMLAudioElement.prototype,
    configurable: false,
    enumerable: false,
    writable: false
  });
  Object.defineProperty(window, "Audio", {
    value: Audio,
    configurable: true,
    enumerable: false,
    writable: true
  });

  this.postMessage = postMessage;

  this.atob = function (str) {
    const result = atob(str);
    if (result === null) {
      throw new DOMException("The string to be decoded contains invalid characters.", "InvalidCharacterError");
    }
    return result;
  };

  this.btoa = function (str) {
    const result = btoa(str);
    if (result === null) {
      throw new DOMException("The string to be encoded contains invalid characters.", "InvalidCharacterError");
    }
    return result;
  };

  this.FileReader = createFileReader({
    window: this
  }).interface;
  this.WebSocket = createWebSocket({
    window: this
  }).interface;

  const AbortSignalWrapper = createAbortSignal({
    window: this
  });
  this.AbortSignal = AbortSignalWrapper.interface;
  this.AbortController = createAbortController({
    AbortSignal: AbortSignalWrapper
  }).interface;
  
  // Store the window on in global.__JSDOM_WINDOWS so we can access it without holding a direct reference to it because
  // such a reference causes memory leaks since the window is indirectly referenced through the context
  if (!global.__JSDOM_WINDOWS) {
    global.__JSDOM_WINDOWS = {};
    global.__JSDOM_WINDOW_NEXT_INSTANCE_ID = 1;
  }
  const windowInstanceId = (global.__JSDOM_WINDOW_NEXT_INSTANCE_ID++).toString();
  global.__JSDOM_WINDOWS[windowInstanceId] = this;
  this.__windowInstanceId = windowInstanceId;

  const removeWindow = (windowInstanceId) => {
    delete global.__JSDOM_WINDOWS[windowInstanceId];
    try {
      // Remove all XHRs associated with the removed Window
      if (global.__JSDOM_XHRS_INFO) {
        const xhrInfoKeys = Object.keys(global.__JSDOM_XHRS_INFO);
        for (const xhrInstanceId of xhrInfoKeys) {
          const xhrInfo = global.__JSDOM_XHRS_INFO[xhrInstanceId];
          if (xhrInfo.windowInstanceId === windowInstanceId) {
            delete global.__JSDOM_XHRS[xhrInstanceId];
            delete global.__JSDOM_XHRS_INFO[xhrInstanceId];
          }
        }
      }
    } catch (err) {
      console.error('Failed to remove XHRs associated with removed Window %o: %o', windowInstanceId, err);
    }
  }

  // Note that although we pass a reference to the Window object, internally in XHR we only keep 
  // the windowInstanceId in a variable
  this.XMLHttpRequest = createXMLHttpRequest(this);

  // TODO: necessary for Blob and FileReader due to different-globals weirdness; investigate how to avoid this.
  this.ArrayBuffer = ArrayBuffer;
  this.Int8Array = Int8Array;
  this.Uint8Array = Uint8Array;
  this.Uint8ClampedArray = Uint8ClampedArray;
  this.Int16Array = Int16Array;
  this.Uint16Array = Uint16Array;
  this.Int32Array = Int32Array;
  this.Uint32Array = Uint32Array;
  this.Float32Array = Float32Array;
  this.Float64Array = Float64Array;

  this.stop = function () {
    const manager = idlUtils.implForWrapper(this._document)._requestManager;
    if (manager) {
      manager.close();
    }
  };

  this.close = function () {
    // Recursively close child frame windows, then ourselves (depth-first).
    for (let i = 0; i < this.length; ++i) {
      this[i].close();
    }

    // Clear out all listeners. Any in-flight or upcoming events should not get delivered.
    idlUtils.implForWrapper(this)._eventListeners = Object.create(null);

    if (this._document) {
      if (this._document.body) {
        this._document.body.innerHTML = "";
      }

      if (this._document.close) {
        // It's especially important to clear out the listeners here because document.close() causes a "load" event to
        // fire.
        idlUtils.implForWrapper(this._document)._eventListeners = Object.create(null);
        this._document.close();
      }
      const doc = idlUtils.implForWrapper(this._document);
      if (doc._requestManager) {
        doc._requestManager.close();
      }
      delete this._document;
    }

    stopAllTimers();
    WebSocketImpl.cleanUpWindow(this);

    // Marking the window as closed to avoid creating any new timers
    this.__closed = true;

    // Remove the Window from the global __JSDOM_WINDOWS
    removeWindow(this.__windowInstanceId);
  };

  this.getComputedStyle = function (node) {
    const nodeImpl = idlUtils.implForWrapper(node);
    const s = node.style;
    const cs = new CSSStyleDeclaration();
    const { forEach } = Array.prototype;

    function setPropertiesFromRule(rule) {
      if (!rule.selectorText) {
        return;
      }

      const selectors = rule.selectorText.split(cssSelectorSplitRE);
      let matched = false;
      for (const selectorText of selectors) {
        if (selectorText !== "" && selectorText !== "," && !matched && matchesDontThrow(nodeImpl, selectorText)) {
          matched = true;
          forEach.call(rule.style, property => {
            cs.setProperty(property, rule.style.getPropertyValue(property), rule.style.getPropertyPriority(property));
          });
        }
      }
    }

    function readStylesFromStyleSheet(sheet) {
      forEach.call(sheet.cssRules, rule => {
        if (rule.media) {
          if (Array.prototype.indexOf.call(rule.media, "screen") !== -1) {
            forEach.call(rule.cssRules, setPropertiesFromRule);
          }
        } else {
          setPropertiesFromRule(rule);
        }
      });
    }

    readStylesFromStyleSheet(defaultStyleSheet);
    forEach.call(node.ownerDocument.styleSheets, readStylesFromStyleSheet);

    forEach.call(s, property => {
      cs.setProperty(property, s.getPropertyValue(property), s.getPropertyPriority(property));
    });

    return cs;
  };

  // The captureEvents() and releaseEvents() methods must do nothing
  this.captureEvents = function () {};

  this.releaseEvents = function () {};

  ///// PUBLIC DATA PROPERTIES (TODO: should be getters)

  function wrapConsoleMethod(method) {
    return (...args) => {
      window._virtualConsole.emit(method, ...args);
    };
  }

  this.console = {
    assert: wrapConsoleMethod("assert"),
    clear: wrapConsoleMethod("clear"),
    count: wrapConsoleMethod("count"),
    countReset: wrapConsoleMethod("countReset"),
    debug: wrapConsoleMethod("debug"),
    dir: wrapConsoleMethod("dir"),
    dirxml: wrapConsoleMethod("dirxml"),
    error: wrapConsoleMethod("error"),
    group: wrapConsoleMethod("group"),
    groupCollapsed: wrapConsoleMethod("groupCollapsed"),
    groupEnd: wrapConsoleMethod("groupEnd"),
    info: wrapConsoleMethod("info"),
    log: wrapConsoleMethod("log"),
    table: wrapConsoleMethod("table"),
    time: wrapConsoleMethod("time"),
    timeEnd: wrapConsoleMethod("timeEnd"),
    trace: wrapConsoleMethod("trace"),
    warn: wrapConsoleMethod("warn")
  };

  function notImplementedMethod(name) {
    return function () {
      notImplemented(name, window);
    };
  }

  define(this, {
    name: "",
    status: "",
    devicePixelRatio: 1,
    innerWidth: 1024,
    innerHeight: 768,
    outerWidth: 1024,
    outerHeight: 768,
    pageXOffset: 0,
    pageYOffset: 0,
    screenX: 0,
    screenY: 0,
    scrollX: 0,
    scrollY: 0,

    // Not in spec, but likely to be added eventually:
    // https://github.com/w3c/csswg-drafts/issues/1091
    screenLeft: 0,
    screenTop: 0,

    alert: notImplementedMethod("window.alert"),
    blur: notImplementedMethod("window.blur"),
    confirm: notImplementedMethod("window.confirm"),
    focus: notImplementedMethod("window.focus"),
    moveBy: notImplementedMethod("window.moveBy"),
    moveTo: notImplementedMethod("window.moveTo"),
    open: notImplementedMethod("window.open"),
    print: notImplementedMethod("window.print"),
    prompt: notImplementedMethod("window.prompt"),
    resizeBy: notImplementedMethod("window.resizeBy"),
    resizeTo: notImplementedMethod("window.resizeTo"),
    scroll: notImplementedMethod("window.scroll"),
    scrollBy: notImplementedMethod("window.scrollBy"),
    scrollTo: notImplementedMethod("window.scrollTo")
  });

  ///// INITIALIZATION

  process.nextTick(() => {
    if (!window.document) {
      return; // window might've been closed already
    }

    if (window.document.readyState === "complete") {
      const ev = window.document.createEvent("HTMLEvents");
      ev.initEvent("load", false, false);
      window.dispatchEvent(ev);
    } else {
      window.document.addEventListener("load", () => {
        const ev = window.document.createEvent("HTMLEvents");
        ev.initEvent("load", false, false);
        window.dispatchEvent(ev);
      });
    }
  });
}

Object.setPrototypeOf(Window, EventTarget.interface);
Object.setPrototypeOf(Window.prototype, EventTarget.interface.prototype);
Object.defineProperty(Window.prototype, Symbol.toStringTag, {
  value: "Window",
  writable: false,
  enumerable: false,
  configurable: true
});

function contextifyWindow(window) {
  if (vm.isContext(window)) {
    return;
  }

  vm.createContext(window);
  const documentImpl = idlUtils.implForWrapper(window._document);
  documentImpl._defaultView = window._globalProxy = vm.runInContext("this", window);
}
