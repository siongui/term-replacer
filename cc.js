"use strict";
(function() {

Error.stackTraceLimit = Infinity;

var $global, $module;
if (typeof window !== "undefined") { /* web page */
  $global = window;
} else if (typeof self !== "undefined") { /* web worker */
  $global = self;
} else if (typeof global !== "undefined") { /* Node.js */
  $global = global;
  $global.require = require;
} else { /* others (e.g. Nashorn) */
  $global = this;
}

if ($global === undefined || $global.Array === undefined) {
  throw new Error("no global object found");
}
if (typeof module !== "undefined") {
  $module = module;
}

var $packages = {}, $idCounter = 0;
var $keys = function(m) { return m ? Object.keys(m) : []; };
var $flushConsole = function() {};
var $throwRuntimeError; /* set by package "runtime" */
var $throwNilPointerError = function() { $throwRuntimeError("invalid memory address or nil pointer dereference"); };
var $call = function(fn, rcvr, args) { return fn.apply(rcvr, args); };
var $makeFunc = function(fn) { return function() { return $externalize(fn(this, new ($sliceType($jsObjectPtr))($global.Array.prototype.slice.call(arguments, []))), $emptyInterface); }; };
var $unused = function(v) {};

var $mapArray = function(array, f) {
  var newArray = new array.constructor(array.length);
  for (var i = 0; i < array.length; i++) {
    newArray[i] = f(array[i]);
  }
  return newArray;
};

var $methodVal = function(recv, name) {
  var vals = recv.$methodVals || {};
  recv.$methodVals = vals; /* noop for primitives */
  var f = vals[name];
  if (f !== undefined) {
    return f;
  }
  var method = recv[name];
  f = function() {
    $stackDepthOffset--;
    try {
      return method.apply(recv, arguments);
    } finally {
      $stackDepthOffset++;
    }
  };
  vals[name] = f;
  return f;
};

var $methodExpr = function(typ, name) {
  var method = typ.prototype[name];
  if (method.$expr === undefined) {
    method.$expr = function() {
      $stackDepthOffset--;
      try {
        if (typ.wrapped) {
          arguments[0] = new typ(arguments[0]);
        }
        return Function.call.apply(method, arguments);
      } finally {
        $stackDepthOffset++;
      }
    };
  }
  return method.$expr;
};

var $ifaceMethodExprs = {};
var $ifaceMethodExpr = function(name) {
  var expr = $ifaceMethodExprs["$" + name];
  if (expr === undefined) {
    expr = $ifaceMethodExprs["$" + name] = function() {
      $stackDepthOffset--;
      try {
        return Function.call.apply(arguments[0][name], arguments);
      } finally {
        $stackDepthOffset++;
      }
    };
  }
  return expr;
};

var $subslice = function(slice, low, high, max) {
  if (high === undefined) {
    high = slice.$length;
  }
  if (max === undefined) {
    max = slice.$capacity;
  }
  if (low < 0 || high < low || max < high || high > slice.$capacity || max > slice.$capacity) {
    $throwRuntimeError("slice bounds out of range");
  }
  if (slice === slice.constructor.nil) {
    return slice;
  }
  var s = new slice.constructor(slice.$array);
  s.$offset = slice.$offset + low;
  s.$length = high - low;
  s.$capacity = max - low;
  return s;
};

var $substring = function(str, low, high) {
  if (low < 0 || high < low || high > str.length) {
    $throwRuntimeError("slice bounds out of range");
  }
  return str.substring(low, high);
};

var $sliceToArray = function(slice) {
  if (slice.$array.constructor !== Array) {
    return slice.$array.subarray(slice.$offset, slice.$offset + slice.$length);
  }
  return slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
};

var $decodeRune = function(str, pos) {
  var c0 = str.charCodeAt(pos);

  if (c0 < 0x80) {
    return [c0, 1];
  }

  if (c0 !== c0 || c0 < 0xC0) {
    return [0xFFFD, 1];
  }

  var c1 = str.charCodeAt(pos + 1);
  if (c1 !== c1 || c1 < 0x80 || 0xC0 <= c1) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xE0) {
    var r = (c0 & 0x1F) << 6 | (c1 & 0x3F);
    if (r <= 0x7F) {
      return [0xFFFD, 1];
    }
    return [r, 2];
  }

  var c2 = str.charCodeAt(pos + 2);
  if (c2 !== c2 || c2 < 0x80 || 0xC0 <= c2) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF0) {
    var r = (c0 & 0x0F) << 12 | (c1 & 0x3F) << 6 | (c2 & 0x3F);
    if (r <= 0x7FF) {
      return [0xFFFD, 1];
    }
    if (0xD800 <= r && r <= 0xDFFF) {
      return [0xFFFD, 1];
    }
    return [r, 3];
  }

  var c3 = str.charCodeAt(pos + 3);
  if (c3 !== c3 || c3 < 0x80 || 0xC0 <= c3) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF8) {
    var r = (c0 & 0x07) << 18 | (c1 & 0x3F) << 12 | (c2 & 0x3F) << 6 | (c3 & 0x3F);
    if (r <= 0xFFFF || 0x10FFFF < r) {
      return [0xFFFD, 1];
    }
    return [r, 4];
  }

  return [0xFFFD, 1];
};

var $encodeRune = function(r) {
  if (r < 0 || r > 0x10FFFF || (0xD800 <= r && r <= 0xDFFF)) {
    r = 0xFFFD;
  }
  if (r <= 0x7F) {
    return String.fromCharCode(r);
  }
  if (r <= 0x7FF) {
    return String.fromCharCode(0xC0 | r >> 6, 0x80 | (r & 0x3F));
  }
  if (r <= 0xFFFF) {
    return String.fromCharCode(0xE0 | r >> 12, 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
  }
  return String.fromCharCode(0xF0 | r >> 18, 0x80 | (r >> 12 & 0x3F), 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
};

var $stringToBytes = function(str) {
  var array = new Uint8Array(str.length);
  for (var i = 0; i < str.length; i++) {
    array[i] = str.charCodeAt(i);
  }
  return array;
};

var $bytesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "";
  for (var i = 0; i < slice.$length; i += 10000) {
    str += String.fromCharCode.apply(undefined, slice.$array.subarray(slice.$offset + i, slice.$offset + Math.min(slice.$length, i + 10000)));
  }
  return str;
};

var $stringToRunes = function(str) {
  var array = new Int32Array(str.length);
  var rune, j = 0;
  for (var i = 0; i < str.length; i += rune[1], j++) {
    rune = $decodeRune(str, i);
    array[j] = rune[0];
  }
  return array.subarray(0, j);
};

var $runesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "";
  for (var i = 0; i < slice.$length; i++) {
    str += $encodeRune(slice.$array[slice.$offset + i]);
  }
  return str;
};

var $copyString = function(dst, src) {
  var n = Math.min(src.length, dst.$length);
  for (var i = 0; i < n; i++) {
    dst.$array[dst.$offset + i] = src.charCodeAt(i);
  }
  return n;
};

var $copySlice = function(dst, src) {
  var n = Math.min(src.$length, dst.$length);
  $copyArray(dst.$array, src.$array, dst.$offset, src.$offset, n, dst.constructor.elem);
  return n;
};

var $copyArray = function(dst, src, dstOffset, srcOffset, n, elem) {
  if (n === 0 || (dst === src && dstOffset === srcOffset)) {
    return;
  }

  if (src.subarray) {
    dst.set(src.subarray(srcOffset, srcOffset + n), dstOffset);
    return;
  }

  switch (elem.kind) {
  case $kindArray:
  case $kindStruct:
    if (dst === src && dstOffset > srcOffset) {
      for (var i = n - 1; i >= 0; i--) {
        elem.copy(dst[dstOffset + i], src[srcOffset + i]);
      }
      return;
    }
    for (var i = 0; i < n; i++) {
      elem.copy(dst[dstOffset + i], src[srcOffset + i]);
    }
    return;
  }

  if (dst === src && dstOffset > srcOffset) {
    for (var i = n - 1; i >= 0; i--) {
      dst[dstOffset + i] = src[srcOffset + i];
    }
    return;
  }
  for (var i = 0; i < n; i++) {
    dst[dstOffset + i] = src[srcOffset + i];
  }
};

var $clone = function(src, type) {
  var clone = type.zero();
  type.copy(clone, src);
  return clone;
};

var $pointerOfStructConversion = function(obj, type) {
  if(obj.$proxies === undefined) {
    obj.$proxies = {};
    obj.$proxies[obj.constructor.string] = obj;
  }
  var proxy = obj.$proxies[type.string];
  if (proxy === undefined) {
    var properties = {};
    for (var i = 0; i < type.elem.fields.length; i++) {
      (function(fieldProp) {
        properties[fieldProp] = {
          get: function() { return obj[fieldProp]; },
          set: function(value) { obj[fieldProp] = value; }
        };
      })(type.elem.fields[i].prop);
    }
    proxy = Object.create(type.prototype, properties);
    proxy.$val = proxy;
    obj.$proxies[type.string] = proxy;
    proxy.$proxies = obj.$proxies;
  }
  return proxy;
};

var $append = function(slice) {
  return $internalAppend(slice, arguments, 1, arguments.length - 1);
};

var $appendSlice = function(slice, toAppend) {
  if (toAppend.constructor === String) {
    var bytes = $stringToBytes(toAppend);
    return $internalAppend(slice, bytes, 0, bytes.length);
  }
  return $internalAppend(slice, toAppend.$array, toAppend.$offset, toAppend.$length);
};

var $internalAppend = function(slice, array, offset, length) {
  if (length === 0) {
    return slice;
  }

  var newArray = slice.$array;
  var newOffset = slice.$offset;
  var newLength = slice.$length + length;
  var newCapacity = slice.$capacity;

  if (newLength > newCapacity) {
    newOffset = 0;
    newCapacity = Math.max(newLength, slice.$capacity < 1024 ? slice.$capacity * 2 : Math.floor(slice.$capacity * 5 / 4));

    if (slice.$array.constructor === Array) {
      newArray = slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
      newArray.length = newCapacity;
      var zero = slice.constructor.elem.zero;
      for (var i = slice.$length; i < newCapacity; i++) {
        newArray[i] = zero();
      }
    } else {
      newArray = new slice.$array.constructor(newCapacity);
      newArray.set(slice.$array.subarray(slice.$offset, slice.$offset + slice.$length));
    }
  }

  $copyArray(newArray, array, newOffset + slice.$length, offset, length, slice.constructor.elem);

  var newSlice = new slice.constructor(newArray);
  newSlice.$offset = newOffset;
  newSlice.$length = newLength;
  newSlice.$capacity = newCapacity;
  return newSlice;
};

var $equal = function(a, b, type) {
  if (type === $jsObjectPtr) {
    return a === b;
  }
  switch (type.kind) {
  case $kindComplex64:
  case $kindComplex128:
    return a.$real === b.$real && a.$imag === b.$imag;
  case $kindInt64:
  case $kindUint64:
    return a.$high === b.$high && a.$low === b.$low;
  case $kindArray:
    if (a.length !== b.length) {
      return false;
    }
    for (var i = 0; i < a.length; i++) {
      if (!$equal(a[i], b[i], type.elem)) {
        return false;
      }
    }
    return true;
  case $kindStruct:
    for (var i = 0; i < type.fields.length; i++) {
      var f = type.fields[i];
      if (!$equal(a[f.prop], b[f.prop], f.typ)) {
        return false;
      }
    }
    return true;
  case $kindInterface:
    return $interfaceIsEqual(a, b);
  default:
    return a === b;
  }
};

var $interfaceIsEqual = function(a, b) {
  if (a === $ifaceNil || b === $ifaceNil) {
    return a === b;
  }
  if (a.constructor !== b.constructor) {
    return false;
  }
  if (a.constructor === $jsObjectPtr) {
    return a.object === b.object;
  }
  if (!a.constructor.comparable) {
    $throwRuntimeError("comparing uncomparable type " + a.constructor.string);
  }
  return $equal(a.$val, b.$val, a.constructor);
};

var $min = Math.min;
var $mod = function(x, y) { return x % y; };
var $parseInt = parseInt;
var $parseFloat = function(f) {
  if (f !== undefined && f !== null && f.constructor === Number) {
    return f;
  }
  return parseFloat(f);
};

var $froundBuf = new Float32Array(1);
var $fround = Math.fround || function(f) {
  $froundBuf[0] = f;
  return $froundBuf[0];
};

var $imul = Math.imul || function(a, b) {
  var ah = (a >>> 16) & 0xffff;
  var al = a & 0xffff;
  var bh = (b >>> 16) & 0xffff;
  var bl = b & 0xffff;
  return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0) >> 0);
};

var $floatKey = function(f) {
  if (f !== f) {
    $idCounter++;
    return "NaN$" + $idCounter;
  }
  return String(f);
};

var $flatten64 = function(x) {
  return x.$high * 4294967296 + x.$low;
};

var $shiftLeft64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high << y | x.$low >>> (32 - y), (x.$low << y) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$low << (y - 32), 0);
  }
  return new x.constructor(0, 0);
};

var $shiftRightInt64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$high >> 31, (x.$high >> (y - 32)) >>> 0);
  }
  if (x.$high < 0) {
    return new x.constructor(-1, 4294967295);
  }
  return new x.constructor(0, 0);
};

var $shiftRightUint64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >>> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(0, x.$high >>> (y - 32));
  }
  return new x.constructor(0, 0);
};

var $mul64 = function(x, y) {
  var high = 0, low = 0;
  if ((y.$low & 1) !== 0) {
    high = x.$high;
    low = x.$low;
  }
  for (var i = 1; i < 32; i++) {
    if ((y.$low & 1<<i) !== 0) {
      high += x.$high << i | x.$low >>> (32 - i);
      low += (x.$low << i) >>> 0;
    }
  }
  for (var i = 0; i < 32; i++) {
    if ((y.$high & 1<<i) !== 0) {
      high += x.$low << i;
    }
  }
  return new x.constructor(high, low);
};

var $div64 = function(x, y, returnRemainder) {
  if (y.$high === 0 && y.$low === 0) {
    $throwRuntimeError("integer divide by zero");
  }

  var s = 1;
  var rs = 1;

  var xHigh = x.$high;
  var xLow = x.$low;
  if (xHigh < 0) {
    s = -1;
    rs = -1;
    xHigh = -xHigh;
    if (xLow !== 0) {
      xHigh--;
      xLow = 4294967296 - xLow;
    }
  }

  var yHigh = y.$high;
  var yLow = y.$low;
  if (y.$high < 0) {
    s *= -1;
    yHigh = -yHigh;
    if (yLow !== 0) {
      yHigh--;
      yLow = 4294967296 - yLow;
    }
  }

  var high = 0, low = 0, n = 0;
  while (yHigh < 2147483648 && ((xHigh > yHigh) || (xHigh === yHigh && xLow > yLow))) {
    yHigh = (yHigh << 1 | yLow >>> 31) >>> 0;
    yLow = (yLow << 1) >>> 0;
    n++;
  }
  for (var i = 0; i <= n; i++) {
    high = high << 1 | low >>> 31;
    low = (low << 1) >>> 0;
    if ((xHigh > yHigh) || (xHigh === yHigh && xLow >= yLow)) {
      xHigh = xHigh - yHigh;
      xLow = xLow - yLow;
      if (xLow < 0) {
        xHigh--;
        xLow += 4294967296;
      }
      low++;
      if (low === 4294967296) {
        high++;
        low = 0;
      }
    }
    yLow = (yLow >>> 1 | yHigh << (32 - 1)) >>> 0;
    yHigh = yHigh >>> 1;
  }

  if (returnRemainder) {
    return new x.constructor(xHigh * rs, xLow * rs);
  }
  return new x.constructor(high * s, low * s);
};

var $divComplex = function(n, d) {
  var ninf = n.$real === Infinity || n.$real === -Infinity || n.$imag === Infinity || n.$imag === -Infinity;
  var dinf = d.$real === Infinity || d.$real === -Infinity || d.$imag === Infinity || d.$imag === -Infinity;
  var nnan = !ninf && (n.$real !== n.$real || n.$imag !== n.$imag);
  var dnan = !dinf && (d.$real !== d.$real || d.$imag !== d.$imag);
  if(nnan || dnan) {
    return new n.constructor(NaN, NaN);
  }
  if (ninf && !dinf) {
    return new n.constructor(Infinity, Infinity);
  }
  if (!ninf && dinf) {
    return new n.constructor(0, 0);
  }
  if (d.$real === 0 && d.$imag === 0) {
    if (n.$real === 0 && n.$imag === 0) {
      return new n.constructor(NaN, NaN);
    }
    return new n.constructor(Infinity, Infinity);
  }
  var a = Math.abs(d.$real);
  var b = Math.abs(d.$imag);
  if (a <= b) {
    var ratio = d.$real / d.$imag;
    var denom = d.$real * ratio + d.$imag;
    return new n.constructor((n.$real * ratio + n.$imag) / denom, (n.$imag * ratio - n.$real) / denom);
  }
  var ratio = d.$imag / d.$real;
  var denom = d.$imag * ratio + d.$real;
  return new n.constructor((n.$imag * ratio + n.$real) / denom, (n.$imag - n.$real * ratio) / denom);
};

var $kindBool = 1;
var $kindInt = 2;
var $kindInt8 = 3;
var $kindInt16 = 4;
var $kindInt32 = 5;
var $kindInt64 = 6;
var $kindUint = 7;
var $kindUint8 = 8;
var $kindUint16 = 9;
var $kindUint32 = 10;
var $kindUint64 = 11;
var $kindUintptr = 12;
var $kindFloat32 = 13;
var $kindFloat64 = 14;
var $kindComplex64 = 15;
var $kindComplex128 = 16;
var $kindArray = 17;
var $kindChan = 18;
var $kindFunc = 19;
var $kindInterface = 20;
var $kindMap = 21;
var $kindPtr = 22;
var $kindSlice = 23;
var $kindString = 24;
var $kindStruct = 25;
var $kindUnsafePointer = 26;

var $methodSynthesizers = [];
var $addMethodSynthesizer = function(f) {
  if ($methodSynthesizers === null) {
    f();
    return;
  }
  $methodSynthesizers.push(f);
};
var $synthesizeMethods = function() {
  $methodSynthesizers.forEach(function(f) { f(); });
  $methodSynthesizers = null;
};

var $ifaceKeyFor = function(x) {
  if (x === $ifaceNil) {
    return 'nil';
  }
  var c = x.constructor;
  return c.string + '$' + c.keyFor(x.$val);
};

var $identity = function(x) { return x; };

var $typeIDCounter = 0;

var $idKey = function(x) {
  if (x.$id === undefined) {
    $idCounter++;
    x.$id = $idCounter;
  }
  return String(x.$id);
};

var $newType = function(size, kind, string, named, pkg, exported, constructor) {
  var typ;
  switch(kind) {
  case $kindBool:
  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8:
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindUnsafePointer:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = $identity;
    break;

  case $kindString:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = function(x) { return "$" + x; };
    break;

  case $kindFloat32:
  case $kindFloat64:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = function(x) { return $floatKey(x); };
    break;

  case $kindInt64:
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$high + "$" + x.$low; };
    break;

  case $kindUint64:
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >>> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$high + "$" + x.$low; };
    break;

  case $kindComplex64:
    typ = function(real, imag) {
      this.$real = $fround(real);
      this.$imag = $fround(imag);
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$real + "$" + x.$imag; };
    break;

  case $kindComplex128:
    typ = function(real, imag) {
      this.$real = real;
      this.$imag = imag;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$real + "$" + x.$imag; };
    break;

  case $kindArray:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.ptr = $newType(4, $kindPtr, "*" + string, false, "", false, function(array) {
      this.$get = function() { return array; };
      this.$set = function(v) { typ.copy(this, v); };
      this.$val = array;
    });
    typ.init = function(elem, len) {
      typ.elem = elem;
      typ.len = len;
      typ.comparable = elem.comparable;
      typ.keyFor = function(x) {
        return Array.prototype.join.call($mapArray(x, function(e) {
          return String(elem.keyFor(e)).replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }), "$");
      };
      typ.copy = function(dst, src) {
        $copyArray(dst, src, 0, 0, src.length, elem);
      };
      typ.ptr.init(typ);
      Object.defineProperty(typ.ptr.nil, "nilCheck", { get: $throwNilPointerError });
    };
    break;

  case $kindChan:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = $idKey;
    typ.init = function(elem, sendOnly, recvOnly) {
      typ.elem = elem;
      typ.sendOnly = sendOnly;
      typ.recvOnly = recvOnly;
    };
    break;

  case $kindFunc:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.init = function(params, results, variadic) {
      typ.params = params;
      typ.results = results;
      typ.variadic = variadic;
      typ.comparable = false;
    };
    break;

  case $kindInterface:
    typ = { implementedBy: {}, missingMethodFor: {} };
    typ.keyFor = $ifaceKeyFor;
    typ.init = function(methods) {
      typ.methods = methods;
      methods.forEach(function(m) {
        $ifaceNil[m.prop] = $throwNilPointerError;
      });
    };
    break;

  case $kindMap:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.init = function(key, elem) {
      typ.key = key;
      typ.elem = elem;
      typ.comparable = false;
    };
    break;

  case $kindPtr:
    typ = constructor || function(getter, setter, target) {
      this.$get = getter;
      this.$set = setter;
      this.$target = target;
      this.$val = this;
    };
    typ.keyFor = $idKey;
    typ.init = function(elem) {
      typ.elem = elem;
      typ.wrapped = (elem.kind === $kindArray);
      typ.nil = new typ($throwNilPointerError, $throwNilPointerError);
    };
    break;

  case $kindSlice:
    typ = function(array) {
      if (array.constructor !== typ.nativeArray) {
        array = new typ.nativeArray(array);
      }
      this.$array = array;
      this.$offset = 0;
      this.$length = array.length;
      this.$capacity = array.length;
      this.$val = this;
    };
    typ.init = function(elem) {
      typ.elem = elem;
      typ.comparable = false;
      typ.nativeArray = $nativeArray(elem.kind);
      typ.nil = new typ([]);
    };
    break;

  case $kindStruct:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.ptr = $newType(4, $kindPtr, "*" + string, false, pkg, exported, constructor);
    typ.ptr.elem = typ;
    typ.ptr.prototype.$get = function() { return this; };
    typ.ptr.prototype.$set = function(v) { typ.copy(this, v); };
    typ.init = function(pkgPath, fields) {
      typ.pkgPath = pkgPath;
      typ.fields = fields;
      fields.forEach(function(f) {
        if (!f.typ.comparable) {
          typ.comparable = false;
        }
      });
      typ.keyFor = function(x) {
        var val = x.$val;
        return $mapArray(fields, function(f) {
          return String(f.typ.keyFor(val[f.prop])).replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }).join("$");
      };
      typ.copy = function(dst, src) {
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          switch (f.typ.kind) {
          case $kindArray:
          case $kindStruct:
            f.typ.copy(dst[f.prop], src[f.prop]);
            continue;
          default:
            dst[f.prop] = src[f.prop];
            continue;
          }
        }
      };
      /* nil value */
      var properties = {};
      fields.forEach(function(f) {
        properties[f.prop] = { get: $throwNilPointerError, set: $throwNilPointerError };
      });
      typ.ptr.nil = Object.create(constructor.prototype, properties);
      typ.ptr.nil.$val = typ.ptr.nil;
      /* methods for embedded fields */
      $addMethodSynthesizer(function() {
        var synthesizeMethod = function(target, m, f) {
          if (target.prototype[m.prop] !== undefined) { return; }
          target.prototype[m.prop] = function() {
            var v = this.$val[f.prop];
            if (f.typ === $jsObjectPtr) {
              v = new $jsObjectPtr(v);
            }
            if (v.$val === undefined) {
              v = new f.typ(v);
            }
            return v[m.prop].apply(v, arguments);
          };
        };
        fields.forEach(function(f) {
          if (f.embedded) {
            $methodSet(f.typ).forEach(function(m) {
              synthesizeMethod(typ, m, f);
              synthesizeMethod(typ.ptr, m, f);
            });
            $methodSet($ptrType(f.typ)).forEach(function(m) {
              synthesizeMethod(typ.ptr, m, f);
            });
          }
        });
      });
    };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  switch (kind) {
  case $kindBool:
  case $kindMap:
    typ.zero = function() { return false; };
    break;

  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8 :
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindUnsafePointer:
  case $kindFloat32:
  case $kindFloat64:
    typ.zero = function() { return 0; };
    break;

  case $kindString:
    typ.zero = function() { return ""; };
    break;

  case $kindInt64:
  case $kindUint64:
  case $kindComplex64:
  case $kindComplex128:
    var zero = new typ(0, 0);
    typ.zero = function() { return zero; };
    break;

  case $kindPtr:
  case $kindSlice:
    typ.zero = function() { return typ.nil; };
    break;

  case $kindChan:
    typ.zero = function() { return $chanNil; };
    break;

  case $kindFunc:
    typ.zero = function() { return $throwNilPointerError; };
    break;

  case $kindInterface:
    typ.zero = function() { return $ifaceNil; };
    break;

  case $kindArray:
    typ.zero = function() {
      var arrayClass = $nativeArray(typ.elem.kind);
      if (arrayClass !== Array) {
        return new arrayClass(typ.len);
      }
      var array = new Array(typ.len);
      for (var i = 0; i < typ.len; i++) {
        array[i] = typ.elem.zero();
      }
      return array;
    };
    break;

  case $kindStruct:
    typ.zero = function() { return new typ.ptr(); };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  typ.id = $typeIDCounter;
  $typeIDCounter++;
  typ.size = size;
  typ.kind = kind;
  typ.string = string;
  typ.named = named;
  typ.pkg = pkg;
  typ.exported = exported;
  typ.methods = [];
  typ.methodSetCache = null;
  typ.comparable = true;
  return typ;
};

var $methodSet = function(typ) {
  if (typ.methodSetCache !== null) {
    return typ.methodSetCache;
  }
  var base = {};

  var isPtr = (typ.kind === $kindPtr);
  if (isPtr && typ.elem.kind === $kindInterface) {
    typ.methodSetCache = [];
    return [];
  }

  var current = [{typ: isPtr ? typ.elem : typ, indirect: isPtr}];

  var seen = {};

  while (current.length > 0) {
    var next = [];
    var mset = [];

    current.forEach(function(e) {
      if (seen[e.typ.string]) {
        return;
      }
      seen[e.typ.string] = true;

      if (e.typ.named) {
        mset = mset.concat(e.typ.methods);
        if (e.indirect) {
          mset = mset.concat($ptrType(e.typ).methods);
        }
      }

      switch (e.typ.kind) {
      case $kindStruct:
        e.typ.fields.forEach(function(f) {
          if (f.embedded) {
            var fTyp = f.typ;
            var fIsPtr = (fTyp.kind === $kindPtr);
            next.push({typ: fIsPtr ? fTyp.elem : fTyp, indirect: e.indirect || fIsPtr});
          }
        });
        break;

      case $kindInterface:
        mset = mset.concat(e.typ.methods);
        break;
      }
    });

    mset.forEach(function(m) {
      if (base[m.name] === undefined) {
        base[m.name] = m;
      }
    });

    current = next;
  }

  typ.methodSetCache = [];
  Object.keys(base).sort().forEach(function(name) {
    typ.methodSetCache.push(base[name]);
  });
  return typ.methodSetCache;
};

var $Bool          = $newType( 1, $kindBool,          "bool",           true, "", false, null);
var $Int           = $newType( 4, $kindInt,           "int",            true, "", false, null);
var $Int8          = $newType( 1, $kindInt8,          "int8",           true, "", false, null);
var $Int16         = $newType( 2, $kindInt16,         "int16",          true, "", false, null);
var $Int32         = $newType( 4, $kindInt32,         "int32",          true, "", false, null);
var $Int64         = $newType( 8, $kindInt64,         "int64",          true, "", false, null);
var $Uint          = $newType( 4, $kindUint,          "uint",           true, "", false, null);
var $Uint8         = $newType( 1, $kindUint8,         "uint8",          true, "", false, null);
var $Uint16        = $newType( 2, $kindUint16,        "uint16",         true, "", false, null);
var $Uint32        = $newType( 4, $kindUint32,        "uint32",         true, "", false, null);
var $Uint64        = $newType( 8, $kindUint64,        "uint64",         true, "", false, null);
var $Uintptr       = $newType( 4, $kindUintptr,       "uintptr",        true, "", false, null);
var $Float32       = $newType( 4, $kindFloat32,       "float32",        true, "", false, null);
var $Float64       = $newType( 8, $kindFloat64,       "float64",        true, "", false, null);
var $Complex64     = $newType( 8, $kindComplex64,     "complex64",      true, "", false, null);
var $Complex128    = $newType(16, $kindComplex128,    "complex128",     true, "", false, null);
var $String        = $newType( 8, $kindString,        "string",         true, "", false, null);
var $UnsafePointer = $newType( 4, $kindUnsafePointer, "unsafe.Pointer", true, "", false, null);

var $nativeArray = function(elemKind) {
  switch (elemKind) {
  case $kindInt:
    return Int32Array;
  case $kindInt8:
    return Int8Array;
  case $kindInt16:
    return Int16Array;
  case $kindInt32:
    return Int32Array;
  case $kindUint:
    return Uint32Array;
  case $kindUint8:
    return Uint8Array;
  case $kindUint16:
    return Uint16Array;
  case $kindUint32:
    return Uint32Array;
  case $kindUintptr:
    return Uint32Array;
  case $kindFloat32:
    return Float32Array;
  case $kindFloat64:
    return Float64Array;
  default:
    return Array;
  }
};
var $toNativeArray = function(elemKind, array) {
  var nativeArray = $nativeArray(elemKind);
  if (nativeArray === Array) {
    return array;
  }
  return new nativeArray(array);
};
var $arrayTypes = {};
var $arrayType = function(elem, len) {
  var typeKey = elem.id + "$" + len;
  var typ = $arrayTypes[typeKey];
  if (typ === undefined) {
    typ = $newType(12, $kindArray, "[" + len + "]" + elem.string, false, "", false, null);
    $arrayTypes[typeKey] = typ;
    typ.init(elem, len);
  }
  return typ;
};

var $chanType = function(elem, sendOnly, recvOnly) {
  var string = (recvOnly ? "<-" : "") + "chan" + (sendOnly ? "<- " : " ") + elem.string;
  var field = sendOnly ? "SendChan" : (recvOnly ? "RecvChan" : "Chan");
  var typ = elem[field];
  if (typ === undefined) {
    typ = $newType(4, $kindChan, string, false, "", false, null);
    elem[field] = typ;
    typ.init(elem, sendOnly, recvOnly);
  }
  return typ;
};
var $Chan = function(elem, capacity) {
  if (capacity < 0 || capacity > 2147483647) {
    $throwRuntimeError("makechan: size out of range");
  }
  this.$elem = elem;
  this.$capacity = capacity;
  this.$buffer = [];
  this.$sendQueue = [];
  this.$recvQueue = [];
  this.$closed = false;
};
var $chanNil = new $Chan(null, 0);
$chanNil.$sendQueue = $chanNil.$recvQueue = { length: 0, push: function() {}, shift: function() { return undefined; }, indexOf: function() { return -1; } };

var $funcTypes = {};
var $funcType = function(params, results, variadic) {
  var typeKey = $mapArray(params, function(p) { return p.id; }).join(",") + "$" + $mapArray(results, function(r) { return r.id; }).join(",") + "$" + variadic;
  var typ = $funcTypes[typeKey];
  if (typ === undefined) {
    var paramTypes = $mapArray(params, function(p) { return p.string; });
    if (variadic) {
      paramTypes[paramTypes.length - 1] = "..." + paramTypes[paramTypes.length - 1].substr(2);
    }
    var string = "func(" + paramTypes.join(", ") + ")";
    if (results.length === 1) {
      string += " " + results[0].string;
    } else if (results.length > 1) {
      string += " (" + $mapArray(results, function(r) { return r.string; }).join(", ") + ")";
    }
    typ = $newType(4, $kindFunc, string, false, "", false, null);
    $funcTypes[typeKey] = typ;
    typ.init(params, results, variadic);
  }
  return typ;
};

var $interfaceTypes = {};
var $interfaceType = function(methods) {
  var typeKey = $mapArray(methods, function(m) { return m.pkg + "," + m.name + "," + m.typ.id; }).join("$");
  var typ = $interfaceTypes[typeKey];
  if (typ === undefined) {
    var string = "interface {}";
    if (methods.length !== 0) {
      string = "interface { " + $mapArray(methods, function(m) {
        return (m.pkg !== "" ? m.pkg + "." : "") + m.name + m.typ.string.substr(4);
      }).join("; ") + " }";
    }
    typ = $newType(8, $kindInterface, string, false, "", false, null);
    $interfaceTypes[typeKey] = typ;
    typ.init(methods);
  }
  return typ;
};
var $emptyInterface = $interfaceType([]);
var $ifaceNil = {};
var $error = $newType(8, $kindInterface, "error", true, "", false, null);
$error.init([{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}]);

var $mapTypes = {};
var $mapType = function(key, elem) {
  var typeKey = key.id + "$" + elem.id;
  var typ = $mapTypes[typeKey];
  if (typ === undefined) {
    typ = $newType(4, $kindMap, "map[" + key.string + "]" + elem.string, false, "", false, null);
    $mapTypes[typeKey] = typ;
    typ.init(key, elem);
  }
  return typ;
};
var $makeMap = function(keyForFunc, entries) {
  var m = {};
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    m[keyForFunc(e.k)] = e;
  }
  return m;
};

var $ptrType = function(elem) {
  var typ = elem.ptr;
  if (typ === undefined) {
    typ = $newType(4, $kindPtr, "*" + elem.string, false, "", elem.exported, null);
    elem.ptr = typ;
    typ.init(elem);
  }
  return typ;
};

var $newDataPointer = function(data, constructor) {
  if (constructor.elem.kind === $kindStruct) {
    return data;
  }
  return new constructor(function() { return data; }, function(v) { data = v; });
};

var $indexPtr = function(array, index, constructor) {
  array.$ptr = array.$ptr || {};
  return array.$ptr[index] || (array.$ptr[index] = new constructor(function() { return array[index]; }, function(v) { array[index] = v; }));
};

var $sliceType = function(elem) {
  var typ = elem.slice;
  if (typ === undefined) {
    typ = $newType(12, $kindSlice, "[]" + elem.string, false, "", false, null);
    elem.slice = typ;
    typ.init(elem);
  }
  return typ;
};
var $makeSlice = function(typ, length, capacity) {
  capacity = capacity || length;
  if (length < 0 || length > 2147483647) {
    $throwRuntimeError("makeslice: len out of range");
  }
  if (capacity < 0 || capacity < length || capacity > 2147483647) {
    $throwRuntimeError("makeslice: cap out of range");
  }
  var array = new typ.nativeArray(capacity);
  if (typ.nativeArray === Array) {
    for (var i = 0; i < capacity; i++) {
      array[i] = typ.elem.zero();
    }
  }
  var slice = new typ(array);
  slice.$length = length;
  return slice;
};

var $structTypes = {};
var $structType = function(pkgPath, fields) {
  var typeKey = $mapArray(fields, function(f) { return f.name + "," + f.typ.id + "," + f.tag; }).join("$");
  var typ = $structTypes[typeKey];
  if (typ === undefined) {
    var string = "struct { " + $mapArray(fields, function(f) {
      return f.name + " " + f.typ.string + (f.tag !== "" ? (" \"" + f.tag.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"") : "");
    }).join("; ") + " }";
    if (fields.length === 0) {
      string = "struct {}";
    }
    typ = $newType(0, $kindStruct, string, false, "", false, function() {
      this.$val = this;
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        var arg = arguments[i];
        this[f.prop] = arg !== undefined ? arg : f.typ.zero();
      }
    });
    $structTypes[typeKey] = typ;
    typ.init(pkgPath, fields);
  }
  return typ;
};

var $assertType = function(value, type, returnTuple) {
  var isInterface = (type.kind === $kindInterface), ok, missingMethod = "";
  if (value === $ifaceNil) {
    ok = false;
  } else if (!isInterface) {
    ok = value.constructor === type;
  } else {
    var valueTypeString = value.constructor.string;
    ok = type.implementedBy[valueTypeString];
    if (ok === undefined) {
      ok = true;
      var valueMethodSet = $methodSet(value.constructor);
      var interfaceMethods = type.methods;
      for (var i = 0; i < interfaceMethods.length; i++) {
        var tm = interfaceMethods[i];
        var found = false;
        for (var j = 0; j < valueMethodSet.length; j++) {
          var vm = valueMethodSet[j];
          if (vm.name === tm.name && vm.pkg === tm.pkg && vm.typ === tm.typ) {
            found = true;
            break;
          }
        }
        if (!found) {
          ok = false;
          type.missingMethodFor[valueTypeString] = tm.name;
          break;
        }
      }
      type.implementedBy[valueTypeString] = ok;
    }
    if (!ok) {
      missingMethod = type.missingMethodFor[valueTypeString];
    }
  }

  if (!ok) {
    if (returnTuple) {
      return [type.zero(), false];
    }
    $panic(new $packages["runtime"].TypeAssertionError.ptr(
      $packages["runtime"]._type.ptr.nil,
      (value === $ifaceNil ? $packages["runtime"]._type.ptr.nil : new $packages["runtime"]._type.ptr(value.constructor.string)),
      new $packages["runtime"]._type.ptr(type.string),
      missingMethod));
  }

  if (!isInterface) {
    value = value.$val;
  }
  if (type === $jsObjectPtr) {
    value = value.object;
  }
  return returnTuple ? [value, true] : value;
};

var $stackDepthOffset = 0;
var $getStackDepth = function() {
  var err = new Error();
  if (err.stack === undefined) {
    return undefined;
  }
  return $stackDepthOffset + err.stack.split("\n").length;
};

var $panicStackDepth = null, $panicValue;
var $callDeferred = function(deferred, jsErr, fromPanic) {
  if (!fromPanic && deferred !== null && deferred.index >= $curGoroutine.deferStack.length) {
    throw jsErr;
  }
  if (jsErr !== null) {
    var newErr = null;
    try {
      $curGoroutine.deferStack.push(deferred);
      $panic(new $jsErrorPtr(jsErr));
    } catch (err) {
      newErr = err;
    }
    $curGoroutine.deferStack.pop();
    $callDeferred(deferred, newErr);
    return;
  }
  if ($curGoroutine.asleep) {
    return;
  }

  $stackDepthOffset--;
  var outerPanicStackDepth = $panicStackDepth;
  var outerPanicValue = $panicValue;

  var localPanicValue = $curGoroutine.panicStack.pop();
  if (localPanicValue !== undefined) {
    $panicStackDepth = $getStackDepth();
    $panicValue = localPanicValue;
  }

  try {
    while (true) {
      if (deferred === null) {
        deferred = $curGoroutine.deferStack[$curGoroutine.deferStack.length - 1];
        if (deferred === undefined) {
          /* The panic reached the top of the stack. Clear it and throw it as a JavaScript error. */
          $panicStackDepth = null;
          if (localPanicValue.Object instanceof Error) {
            throw localPanicValue.Object;
          }
          var msg;
          if (localPanicValue.constructor === $String) {
            msg = localPanicValue.$val;
          } else if (localPanicValue.Error !== undefined) {
            msg = localPanicValue.Error();
          } else if (localPanicValue.String !== undefined) {
            msg = localPanicValue.String();
          } else {
            msg = localPanicValue;
          }
          throw new Error(msg);
        }
      }
      var call = deferred.pop();
      if (call === undefined) {
        $curGoroutine.deferStack.pop();
        if (localPanicValue !== undefined) {
          deferred = null;
          continue;
        }
        return;
      }
      var r = call[0].apply(call[2], call[1]);
      if (r && r.$blk !== undefined) {
        deferred.push([r.$blk, [], r]);
        if (fromPanic) {
          throw null;
        }
        return;
      }

      if (localPanicValue !== undefined && $panicStackDepth === null) {
        throw null; /* error was recovered */
      }
    }
  } finally {
    if (localPanicValue !== undefined) {
      if ($panicStackDepth !== null) {
        $curGoroutine.panicStack.push(localPanicValue);
      }
      $panicStackDepth = outerPanicStackDepth;
      $panicValue = outerPanicValue;
    }
    $stackDepthOffset++;
  }
};

var $panic = function(value) {
  $curGoroutine.panicStack.push(value);
  $callDeferred(null, null, true);
};
var $recover = function() {
  if ($panicStackDepth === null || ($panicStackDepth !== undefined && $panicStackDepth !== $getStackDepth() - 2)) {
    return $ifaceNil;
  }
  $panicStackDepth = null;
  return $panicValue;
};
var $throw = function(err) { throw err; };

var $noGoroutine = { asleep: false, exit: false, deferStack: [], panicStack: [] };
var $curGoroutine = $noGoroutine, $totalGoroutines = 0, $awakeGoroutines = 0, $checkForDeadlock = true;
var $mainFinished = false;
var $go = function(fun, args) {
  $totalGoroutines++;
  $awakeGoroutines++;
  var $goroutine = function() {
    try {
      $curGoroutine = $goroutine;
      var r = fun.apply(undefined, args);
      if (r && r.$blk !== undefined) {
        fun = function() { return r.$blk(); };
        args = [];
        return;
      }
      $goroutine.exit = true;
    } catch (err) {
      if (!$goroutine.exit) {
        throw err;
      }
    } finally {
      $curGoroutine = $noGoroutine;
      if ($goroutine.exit) { /* also set by runtime.Goexit() */
        $totalGoroutines--;
        $goroutine.asleep = true;
      }
      if ($goroutine.asleep) {
        $awakeGoroutines--;
        if (!$mainFinished && $awakeGoroutines === 0 && $checkForDeadlock) {
          console.error("fatal error: all goroutines are asleep - deadlock!");
          if ($global.process !== undefined) {
            $global.process.exit(2);
          }
        }
      }
    }
  };
  $goroutine.asleep = false;
  $goroutine.exit = false;
  $goroutine.deferStack = [];
  $goroutine.panicStack = [];
  $schedule($goroutine);
};

var $scheduled = [];
var $runScheduled = function() {
  try {
    var r;
    while ((r = $scheduled.shift()) !== undefined) {
      r();
    }
  } finally {
    if ($scheduled.length > 0) {
      setTimeout($runScheduled, 0);
    }
  }
};

var $schedule = function(goroutine) {
  if (goroutine.asleep) {
    goroutine.asleep = false;
    $awakeGoroutines++;
  }
  $scheduled.push(goroutine);
  if ($curGoroutine === $noGoroutine) {
    $runScheduled();
  }
};

var $setTimeout = function(f, t) {
  $awakeGoroutines++;
  return setTimeout(function() {
    $awakeGoroutines--;
    f();
  }, t);
};

var $block = function() {
  if ($curGoroutine === $noGoroutine) {
    $throwRuntimeError("cannot block in JavaScript callback, fix by wrapping code in goroutine");
  }
  $curGoroutine.asleep = true;
};

var $send = function(chan, value) {
  if (chan.$closed) {
    $throwRuntimeError("send on closed channel");
  }
  var queuedRecv = chan.$recvQueue.shift();
  if (queuedRecv !== undefined) {
    queuedRecv([value, true]);
    return;
  }
  if (chan.$buffer.length < chan.$capacity) {
    chan.$buffer.push(value);
    return;
  }

  var thisGoroutine = $curGoroutine;
  var closedDuringSend;
  chan.$sendQueue.push(function(closed) {
    closedDuringSend = closed;
    $schedule(thisGoroutine);
    return value;
  });
  $block();
  return {
    $blk: function() {
      if (closedDuringSend) {
        $throwRuntimeError("send on closed channel");
      }
    }
  };
};
var $recv = function(chan) {
  var queuedSend = chan.$sendQueue.shift();
  if (queuedSend !== undefined) {
    chan.$buffer.push(queuedSend(false));
  }
  var bufferedValue = chan.$buffer.shift();
  if (bufferedValue !== undefined) {
    return [bufferedValue, true];
  }
  if (chan.$closed) {
    return [chan.$elem.zero(), false];
  }

  var thisGoroutine = $curGoroutine;
  var f = { $blk: function() { return this.value; } };
  var queueEntry = function(v) {
    f.value = v;
    $schedule(thisGoroutine);
  };
  chan.$recvQueue.push(queueEntry);
  $block();
  return f;
};
var $close = function(chan) {
  if (chan.$closed) {
    $throwRuntimeError("close of closed channel");
  }
  chan.$closed = true;
  while (true) {
    var queuedSend = chan.$sendQueue.shift();
    if (queuedSend === undefined) {
      break;
    }
    queuedSend(true); /* will panic */
  }
  while (true) {
    var queuedRecv = chan.$recvQueue.shift();
    if (queuedRecv === undefined) {
      break;
    }
    queuedRecv([chan.$elem.zero(), false]);
  }
};
var $select = function(comms) {
  var ready = [];
  var selection = -1;
  for (var i = 0; i < comms.length; i++) {
    var comm = comms[i];
    var chan = comm[0];
    switch (comm.length) {
    case 0: /* default */
      selection = i;
      break;
    case 1: /* recv */
      if (chan.$sendQueue.length !== 0 || chan.$buffer.length !== 0 || chan.$closed) {
        ready.push(i);
      }
      break;
    case 2: /* send */
      if (chan.$closed) {
        $throwRuntimeError("send on closed channel");
      }
      if (chan.$recvQueue.length !== 0 || chan.$buffer.length < chan.$capacity) {
        ready.push(i);
      }
      break;
    }
  }

  if (ready.length !== 0) {
    selection = ready[Math.floor(Math.random() * ready.length)];
  }
  if (selection !== -1) {
    var comm = comms[selection];
    switch (comm.length) {
    case 0: /* default */
      return [selection];
    case 1: /* recv */
      return [selection, $recv(comm[0])];
    case 2: /* send */
      $send(comm[0], comm[1]);
      return [selection];
    }
  }

  var entries = [];
  var thisGoroutine = $curGoroutine;
  var f = { $blk: function() { return this.selection; } };
  var removeFromQueues = function() {
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var queue = entry[0];
      var index = queue.indexOf(entry[1]);
      if (index !== -1) {
        queue.splice(index, 1);
      }
    }
  };
  for (var i = 0; i < comms.length; i++) {
    (function(i) {
      var comm = comms[i];
      switch (comm.length) {
      case 1: /* recv */
        var queueEntry = function(value) {
          f.selection = [i, value];
          removeFromQueues();
          $schedule(thisGoroutine);
        };
        entries.push([comm[0].$recvQueue, queueEntry]);
        comm[0].$recvQueue.push(queueEntry);
        break;
      case 2: /* send */
        var queueEntry = function() {
          if (comm[0].$closed) {
            $throwRuntimeError("send on closed channel");
          }
          f.selection = [i];
          removeFromQueues();
          $schedule(thisGoroutine);
          return comm[1];
        };
        entries.push([comm[0].$sendQueue, queueEntry]);
        comm[0].$sendQueue.push(queueEntry);
        break;
      }
    })(i);
  }
  $block();
  return f;
};

var $jsObjectPtr, $jsErrorPtr;

var $needsExternalization = function(t) {
  switch (t.kind) {
    case $kindBool:
    case $kindInt:
    case $kindInt8:
    case $kindInt16:
    case $kindInt32:
    case $kindUint:
    case $kindUint8:
    case $kindUint16:
    case $kindUint32:
    case $kindUintptr:
    case $kindFloat32:
    case $kindFloat64:
      return false;
    default:
      return t !== $jsObjectPtr;
  }
};

var $externalize = function(v, t) {
  if (t === $jsObjectPtr) {
    return v;
  }
  switch (t.kind) {
  case $kindBool:
  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8:
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindFloat32:
  case $kindFloat64:
    return v;
  case $kindInt64:
  case $kindUint64:
    return $flatten64(v);
  case $kindArray:
    if ($needsExternalization(t.elem)) {
      return $mapArray(v, function(e) { return $externalize(e, t.elem); });
    }
    return v;
  case $kindFunc:
    return $externalizeFunction(v, t, false);
  case $kindInterface:
    if (v === $ifaceNil) {
      return null;
    }
    if (v.constructor === $jsObjectPtr) {
      return v.$val.object;
    }
    return $externalize(v.$val, v.constructor);
  case $kindMap:
    var m = {};
    var keys = $keys(v);
    for (var i = 0; i < keys.length; i++) {
      var entry = v[keys[i]];
      m[$externalize(entry.k, t.key)] = $externalize(entry.v, t.elem);
    }
    return m;
  case $kindPtr:
    if (v === t.nil) {
      return null;
    }
    return $externalize(v.$get(), t.elem);
  case $kindSlice:
    if ($needsExternalization(t.elem)) {
      return $mapArray($sliceToArray(v), function(e) { return $externalize(e, t.elem); });
    }
    return $sliceToArray(v);
  case $kindString:
    if ($isASCII(v)) {
      return v;
    }
    var s = "", r;
    for (var i = 0; i < v.length; i += r[1]) {
      r = $decodeRune(v, i);
      var c = r[0];
      if (c > 0xFFFF) {
        var h = Math.floor((c - 0x10000) / 0x400) + 0xD800;
        var l = (c - 0x10000) % 0x400 + 0xDC00;
        s += String.fromCharCode(h, l);
        continue;
      }
      s += String.fromCharCode(c);
    }
    return s;
  case $kindStruct:
    var timePkg = $packages["time"];
    if (timePkg !== undefined && v.constructor === timePkg.Time.ptr) {
      var milli = $div64(v.UnixNano(), new $Int64(0, 1000000));
      return new Date($flatten64(milli));
    }

    var noJsObject = {};
    var searchJsObject = function(v, t) {
      if (t === $jsObjectPtr) {
        return v;
      }
      switch (t.kind) {
      case $kindPtr:
        if (v === t.nil) {
          return noJsObject;
        }
        return searchJsObject(v.$get(), t.elem);
      case $kindStruct:
        var f = t.fields[0];
        return searchJsObject(v[f.prop], f.typ);
      case $kindInterface:
        return searchJsObject(v.$val, v.constructor);
      default:
        return noJsObject;
      }
    };
    var o = searchJsObject(v, t);
    if (o !== noJsObject) {
      return o;
    }

    o = {};
    for (var i = 0; i < t.fields.length; i++) {
      var f = t.fields[i];
      if (!f.exported) {
        continue;
      }
      o[f.name] = $externalize(v[f.prop], f.typ);
    }
    return o;
  }
  $throwRuntimeError("cannot externalize " + t.string);
};

var $externalizeFunction = function(v, t, passThis) {
  if (v === $throwNilPointerError) {
    return null;
  }
  if (v.$externalizeWrapper === undefined) {
    $checkForDeadlock = false;
    v.$externalizeWrapper = function() {
      var args = [];
      for (var i = 0; i < t.params.length; i++) {
        if (t.variadic && i === t.params.length - 1) {
          var vt = t.params[i].elem, varargs = [];
          for (var j = i; j < arguments.length; j++) {
            varargs.push($internalize(arguments[j], vt));
          }
          args.push(new (t.params[i])(varargs));
          break;
        }
        args.push($internalize(arguments[i], t.params[i]));
      }
      var result = v.apply(passThis ? this : undefined, args);
      switch (t.results.length) {
      case 0:
        return;
      case 1:
        return $externalize(result, t.results[0]);
      default:
        for (var i = 0; i < t.results.length; i++) {
          result[i] = $externalize(result[i], t.results[i]);
        }
        return result;
      }
    };
  }
  return v.$externalizeWrapper;
};

var $internalize = function(v, t, recv) {
  if (t === $jsObjectPtr) {
    return v;
  }
  if (t === $jsObjectPtr.elem) {
    $throwRuntimeError("cannot internalize js.Object, use *js.Object instead");
  }
  if (v && v.__internal_object__ !== undefined) {
    return $assertType(v.__internal_object__, t, false);
  }
  var timePkg = $packages["time"];
  if (timePkg !== undefined && t === timePkg.Time) {
    if (!(v !== null && v !== undefined && v.constructor === Date)) {
      $throwRuntimeError("cannot internalize time.Time from " + typeof v + ", must be Date");
    }
    return timePkg.Unix(new $Int64(0, 0), new $Int64(0, v.getTime() * 1000000));
  }
  switch (t.kind) {
  case $kindBool:
    return !!v;
  case $kindInt:
    return parseInt(v);
  case $kindInt8:
    return parseInt(v) << 24 >> 24;
  case $kindInt16:
    return parseInt(v) << 16 >> 16;
  case $kindInt32:
    return parseInt(v) >> 0;
  case $kindUint:
    return parseInt(v);
  case $kindUint8:
    return parseInt(v) << 24 >>> 24;
  case $kindUint16:
    return parseInt(v) << 16 >>> 16;
  case $kindUint32:
  case $kindUintptr:
    return parseInt(v) >>> 0;
  case $kindInt64:
  case $kindUint64:
    return new t(0, v);
  case $kindFloat32:
  case $kindFloat64:
    return parseFloat(v);
  case $kindArray:
    if (v.length !== t.len) {
      $throwRuntimeError("got array with wrong size from JavaScript native");
    }
    return $mapArray(v, function(e) { return $internalize(e, t.elem); });
  case $kindFunc:
    return function() {
      var args = [];
      for (var i = 0; i < t.params.length; i++) {
        if (t.variadic && i === t.params.length - 1) {
          var vt = t.params[i].elem, varargs = arguments[i];
          for (var j = 0; j < varargs.$length; j++) {
            args.push($externalize(varargs.$array[varargs.$offset + j], vt));
          }
          break;
        }
        args.push($externalize(arguments[i], t.params[i]));
      }
      var result = v.apply(recv, args);
      switch (t.results.length) {
      case 0:
        return;
      case 1:
        return $internalize(result, t.results[0]);
      default:
        for (var i = 0; i < t.results.length; i++) {
          result[i] = $internalize(result[i], t.results[i]);
        }
        return result;
      }
    };
  case $kindInterface:
    if (t.methods.length !== 0) {
      $throwRuntimeError("cannot internalize " + t.string);
    }
    if (v === null) {
      return $ifaceNil;
    }
    if (v === undefined) {
      return new $jsObjectPtr(undefined);
    }
    switch (v.constructor) {
    case Int8Array:
      return new ($sliceType($Int8))(v);
    case Int16Array:
      return new ($sliceType($Int16))(v);
    case Int32Array:
      return new ($sliceType($Int))(v);
    case Uint8Array:
      return new ($sliceType($Uint8))(v);
    case Uint16Array:
      return new ($sliceType($Uint16))(v);
    case Uint32Array:
      return new ($sliceType($Uint))(v);
    case Float32Array:
      return new ($sliceType($Float32))(v);
    case Float64Array:
      return new ($sliceType($Float64))(v);
    case Array:
      return $internalize(v, $sliceType($emptyInterface));
    case Boolean:
      return new $Bool(!!v);
    case Date:
      if (timePkg === undefined) {
        /* time package is not present, internalize as &js.Object{Date} so it can be externalized into original Date. */
        return new $jsObjectPtr(v);
      }
      return new timePkg.Time($internalize(v, timePkg.Time));
    case Function:
      var funcType = $funcType([$sliceType($emptyInterface)], [$jsObjectPtr], true);
      return new funcType($internalize(v, funcType));
    case Number:
      return new $Float64(parseFloat(v));
    case String:
      return new $String($internalize(v, $String));
    default:
      if ($global.Node && v instanceof $global.Node) {
        return new $jsObjectPtr(v);
      }
      var mapType = $mapType($String, $emptyInterface);
      return new mapType($internalize(v, mapType));
    }
  case $kindMap:
    var m = {};
    var keys = $keys(v);
    for (var i = 0; i < keys.length; i++) {
      var k = $internalize(keys[i], t.key);
      m[t.key.keyFor(k)] = { k: k, v: $internalize(v[keys[i]], t.elem) };
    }
    return m;
  case $kindPtr:
    if (t.elem.kind === $kindStruct) {
      return $internalize(v, t.elem);
    }
  case $kindSlice:
    return new t($mapArray(v, function(e) { return $internalize(e, t.elem); }));
  case $kindString:
    v = String(v);
    if ($isASCII(v)) {
      return v;
    }
    var s = "";
    var i = 0;
    while (i < v.length) {
      var h = v.charCodeAt(i);
      if (0xD800 <= h && h <= 0xDBFF) {
        var l = v.charCodeAt(i + 1);
        var c = (h - 0xD800) * 0x400 + l - 0xDC00 + 0x10000;
        s += $encodeRune(c);
        i += 2;
        continue;
      }
      s += $encodeRune(h);
      i++;
    }
    return s;
  case $kindStruct:
    var noJsObject = {};
    var searchJsObject = function(t) {
      if (t === $jsObjectPtr) {
        return v;
      }
      if (t === $jsObjectPtr.elem) {
        $throwRuntimeError("cannot internalize js.Object, use *js.Object instead");
      }
      switch (t.kind) {
      case $kindPtr:
        return searchJsObject(t.elem);
      case $kindStruct:
        var f = t.fields[0];
        var o = searchJsObject(f.typ);
        if (o !== noJsObject) {
          var n = new t.ptr();
          n[f.prop] = o;
          return n;
        }
        return noJsObject;
      default:
        return noJsObject;
      }
    };
    var o = searchJsObject(t);
    if (o !== noJsObject) {
      return o;
    }
  }
  $throwRuntimeError("cannot internalize " + t.string);
};

/* $isASCII reports whether string s contains only ASCII characters. */
var $isASCII = function(s) {
  for (var i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) >= 128) {
      return false;
    }
  }
  return true;
};

$packages["github.com/gopherjs/gopherjs/js"] = (function() {
	var $pkg = {}, $init, Object, Error, sliceType, ptrType, ptrType$1, init;
	Object = $pkg.Object = $newType(0, $kindStruct, "js.Object", true, "github.com/gopherjs/gopherjs/js", true, function(object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.object = null;
			return;
		}
		this.object = object_;
	});
	Error = $pkg.Error = $newType(0, $kindStruct, "js.Error", true, "github.com/gopherjs/gopherjs/js", true, function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	sliceType = $sliceType($emptyInterface);
	ptrType = $ptrType(Object);
	ptrType$1 = $ptrType(Error);
	Object.ptr.prototype.Get = function(key) {
		var key, o;
		o = this;
		return o.object[$externalize(key, $String)];
	};
	Object.prototype.Get = function(key) { return this.$val.Get(key); };
	Object.ptr.prototype.Set = function(key, value) {
		var key, o, value;
		o = this;
		o.object[$externalize(key, $String)] = $externalize(value, $emptyInterface);
	};
	Object.prototype.Set = function(key, value) { return this.$val.Set(key, value); };
	Object.ptr.prototype.Delete = function(key) {
		var key, o;
		o = this;
		delete o.object[$externalize(key, $String)];
	};
	Object.prototype.Delete = function(key) { return this.$val.Delete(key); };
	Object.ptr.prototype.Length = function() {
		var o;
		o = this;
		return $parseInt(o.object.length);
	};
	Object.prototype.Length = function() { return this.$val.Length(); };
	Object.ptr.prototype.Index = function(i) {
		var i, o;
		o = this;
		return o.object[i];
	};
	Object.prototype.Index = function(i) { return this.$val.Index(i); };
	Object.ptr.prototype.SetIndex = function(i, value) {
		var i, o, value;
		o = this;
		o.object[i] = $externalize(value, $emptyInterface);
	};
	Object.prototype.SetIndex = function(i, value) { return this.$val.SetIndex(i, value); };
	Object.ptr.prototype.Call = function(name, args) {
		var args, name, o, obj;
		o = this;
		return (obj = o.object, obj[$externalize(name, $String)].apply(obj, $externalize(args, sliceType)));
	};
	Object.prototype.Call = function(name, args) { return this.$val.Call(name, args); };
	Object.ptr.prototype.Invoke = function(args) {
		var args, o;
		o = this;
		return o.object.apply(undefined, $externalize(args, sliceType));
	};
	Object.prototype.Invoke = function(args) { return this.$val.Invoke(args); };
	Object.ptr.prototype.New = function(args) {
		var args, o;
		o = this;
		return new ($global.Function.prototype.bind.apply(o.object, [undefined].concat($externalize(args, sliceType))));
	};
	Object.prototype.New = function(args) { return this.$val.New(args); };
	Object.ptr.prototype.Bool = function() {
		var o;
		o = this;
		return !!(o.object);
	};
	Object.prototype.Bool = function() { return this.$val.Bool(); };
	Object.ptr.prototype.String = function() {
		var o;
		o = this;
		return $internalize(o.object, $String);
	};
	Object.prototype.String = function() { return this.$val.String(); };
	Object.ptr.prototype.Int = function() {
		var o;
		o = this;
		return $parseInt(o.object) >> 0;
	};
	Object.prototype.Int = function() { return this.$val.Int(); };
	Object.ptr.prototype.Int64 = function() {
		var o;
		o = this;
		return $internalize(o.object, $Int64);
	};
	Object.prototype.Int64 = function() { return this.$val.Int64(); };
	Object.ptr.prototype.Uint64 = function() {
		var o;
		o = this;
		return $internalize(o.object, $Uint64);
	};
	Object.prototype.Uint64 = function() { return this.$val.Uint64(); };
	Object.ptr.prototype.Float = function() {
		var o;
		o = this;
		return $parseFloat(o.object);
	};
	Object.prototype.Float = function() { return this.$val.Float(); };
	Object.ptr.prototype.Interface = function() {
		var o;
		o = this;
		return $internalize(o.object, $emptyInterface);
	};
	Object.prototype.Interface = function() { return this.$val.Interface(); };
	Object.ptr.prototype.Unsafe = function() {
		var o;
		o = this;
		return o.object;
	};
	Object.prototype.Unsafe = function() { return this.$val.Unsafe(); };
	Error.ptr.prototype.Error = function() {
		var err;
		err = this;
		return "JavaScript error: " + $internalize(err.Object.message, $String);
	};
	Error.prototype.Error = function() { return this.$val.Error(); };
	Error.ptr.prototype.Stack = function() {
		var err;
		err = this;
		return $internalize(err.Object.stack, $String);
	};
	Error.prototype.Stack = function() { return this.$val.Stack(); };
	init = function() {
		var e;
		e = new Error.ptr(null);
		$unused(e);
	};
	ptrType.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([$String], [ptrType], false)}, {prop: "Set", name: "Set", pkg: "", typ: $funcType([$String, $emptyInterface], [], false)}, {prop: "Delete", name: "Delete", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Length", name: "Length", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Index", name: "Index", pkg: "", typ: $funcType([$Int], [ptrType], false)}, {prop: "SetIndex", name: "SetIndex", pkg: "", typ: $funcType([$Int, $emptyInterface], [], false)}, {prop: "Call", name: "Call", pkg: "", typ: $funcType([$String, sliceType], [ptrType], true)}, {prop: "Invoke", name: "Invoke", pkg: "", typ: $funcType([sliceType], [ptrType], true)}, {prop: "New", name: "New", pkg: "", typ: $funcType([sliceType], [ptrType], true)}, {prop: "Bool", name: "Bool", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Int", name: "Int", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Int64", name: "Int64", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Uint64", name: "Uint64", pkg: "", typ: $funcType([], [$Uint64], false)}, {prop: "Float", name: "Float", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Interface", name: "Interface", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "Unsafe", name: "Unsafe", pkg: "", typ: $funcType([], [$Uintptr], false)}];
	ptrType$1.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Stack", name: "Stack", pkg: "", typ: $funcType([], [$String], false)}];
	Object.init("github.com/gopherjs/gopherjs/js", [{prop: "object", name: "object", embedded: false, exported: false, typ: ptrType, tag: ""}]);
	Error.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["internal/cpu"] = (function() {
	var $pkg = {}, $init;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["internal/bytealg"] = (function() {
	var $pkg = {}, $init, cpu;
	cpu = $packages["internal/cpu"];
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = cpu.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["runtime/internal/sys"] = (function() {
	var $pkg = {}, $init;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["runtime"] = (function() {
	var $pkg = {}, $init, js, bytealg, sys, _type, TypeAssertionError, errorString, ptrType, ptrType$4, init, throw$1;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	bytealg = $packages["internal/bytealg"];
	sys = $packages["runtime/internal/sys"];
	_type = $pkg._type = $newType(0, $kindStruct, "runtime._type", true, "runtime", false, function(str_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.str = "";
			return;
		}
		this.str = str_;
	});
	TypeAssertionError = $pkg.TypeAssertionError = $newType(0, $kindStruct, "runtime.TypeAssertionError", true, "runtime", true, function(_interface_, concrete_, asserted_, missingMethod_) {
		this.$val = this;
		if (arguments.length === 0) {
			this._interface = ptrType.nil;
			this.concrete = ptrType.nil;
			this.asserted = ptrType.nil;
			this.missingMethod = "";
			return;
		}
		this._interface = _interface_;
		this.concrete = concrete_;
		this.asserted = asserted_;
		this.missingMethod = missingMethod_;
	});
	errorString = $pkg.errorString = $newType(8, $kindString, "runtime.errorString", true, "runtime", false, null);
	ptrType = $ptrType(_type);
	ptrType$4 = $ptrType(TypeAssertionError);
	_type.ptr.prototype.string = function() {
		var t;
		t = this;
		return t.str;
	};
	_type.prototype.string = function() { return this.$val.string(); };
	_type.ptr.prototype.pkgpath = function() {
		var t;
		t = this;
		return "";
	};
	_type.prototype.pkgpath = function() { return this.$val.pkgpath(); };
	init = function() {
		var e, jsPkg;
		jsPkg = $packages[$externalize("github.com/gopherjs/gopherjs/js", $String)];
		$jsObjectPtr = jsPkg.Object.ptr;
		$jsErrorPtr = jsPkg.Error.ptr;
		$throwRuntimeError = throw$1;
		e = $ifaceNil;
		e = new TypeAssertionError.ptr(ptrType.nil, ptrType.nil, ptrType.nil, "");
		$unused(e);
	};
	throw$1 = function(s) {
		var s;
		$panic(new errorString((s)));
	};
	TypeAssertionError.ptr.prototype.RuntimeError = function() {
	};
	TypeAssertionError.prototype.RuntimeError = function() { return this.$val.RuntimeError(); };
	TypeAssertionError.ptr.prototype.Error = function() {
		var as, cs, e, inter, msg;
		e = this;
		inter = "interface";
		if (!(e._interface === ptrType.nil)) {
			inter = e._interface.string();
		}
		as = e.asserted.string();
		if (e.concrete === ptrType.nil) {
			return "interface conversion: " + inter + " is nil, not " + as;
		}
		cs = e.concrete.string();
		if (e.missingMethod === "") {
			msg = "interface conversion: " + inter + " is " + cs + ", not " + as;
			if (cs === as) {
				if (!(e.concrete.pkgpath() === e.asserted.pkgpath())) {
					msg = msg + (" (types from different packages)");
				} else {
					msg = msg + (" (types from different scopes)");
				}
			}
			return msg;
		}
		return "interface conversion: " + cs + " is not " + as + ": missing method " + e.missingMethod;
	};
	TypeAssertionError.prototype.Error = function() { return this.$val.Error(); };
	errorString.prototype.RuntimeError = function() {
		var e;
		e = this.$val;
	};
	$ptrType(errorString).prototype.RuntimeError = function() { return new errorString(this.$get()).RuntimeError(); };
	errorString.prototype.Error = function() {
		var e;
		e = this.$val;
		return "runtime error: " + (e);
	};
	$ptrType(errorString).prototype.Error = function() { return new errorString(this.$get()).Error(); };
	ptrType.methods = [{prop: "string", name: "string", pkg: "runtime", typ: $funcType([], [$String], false)}, {prop: "pkgpath", name: "pkgpath", pkg: "runtime", typ: $funcType([], [$String], false)}];
	ptrType$4.methods = [{prop: "RuntimeError", name: "RuntimeError", pkg: "", typ: $funcType([], [], false)}, {prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	errorString.methods = [{prop: "RuntimeError", name: "RuntimeError", pkg: "", typ: $funcType([], [], false)}, {prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	_type.init("runtime", [{prop: "str", name: "str", embedded: false, exported: false, typ: $String, tag: ""}]);
	TypeAssertionError.init("runtime", [{prop: "_interface", name: "_interface", embedded: false, exported: false, typ: ptrType, tag: ""}, {prop: "concrete", name: "concrete", embedded: false, exported: false, typ: ptrType, tag: ""}, {prop: "asserted", name: "asserted", embedded: false, exported: false, typ: ptrType, tag: ""}, {prop: "missingMethod", name: "missingMethod", embedded: false, exported: false, typ: $String, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = bytealg.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sys.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/siongui/godom"] = (function() {
	var $pkg = {}, $init, js, CSSStyleDeclaration, Object, DOMRect, Event, DOMTokenList, funcType, ptrType, sliceType, ptrType$1, ptrType$2, ptrType$3, ptrType$4, sliceType$1;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	CSSStyleDeclaration = $pkg.CSSStyleDeclaration = $newType(0, $kindStruct, "godom.CSSStyleDeclaration", true, "github.com/siongui/godom", true, function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	Object = $pkg.Object = $newType(0, $kindStruct, "godom.Object", true, "github.com/siongui/godom", true, function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	DOMRect = $pkg.DOMRect = $newType(0, $kindStruct, "godom.DOMRect", true, "github.com/siongui/godom", true, function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	Event = $pkg.Event = $newType(0, $kindStruct, "godom.Event", true, "github.com/siongui/godom", true, function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	DOMTokenList = $pkg.DOMTokenList = $newType(0, $kindStruct, "godom.DOMTokenList", true, "github.com/siongui/godom", true, function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	funcType = $funcType([Event], [], false);
	ptrType = $ptrType(Object);
	sliceType = $sliceType(ptrType);
	ptrType$1 = $ptrType(CSSStyleDeclaration);
	ptrType$2 = $ptrType(js.Object);
	ptrType$3 = $ptrType(DOMTokenList);
	ptrType$4 = $ptrType(DOMRect);
	sliceType$1 = $sliceType($emptyInterface);
	CSSStyleDeclaration.ptr.prototype.CssText = function() {
		var s;
		s = this;
		return $internalize(s.Object.cssText, $String);
	};
	CSSStyleDeclaration.prototype.CssText = function() { return this.$val.CssText(); };
	CSSStyleDeclaration.ptr.prototype.Length = function() {
		var s;
		s = this;
		return $parseInt(s.Object.length) >> 0;
	};
	CSSStyleDeclaration.prototype.Length = function() { return this.$val.Length(); };
	CSSStyleDeclaration.ptr.prototype.AlignContent = function() {
		var s;
		s = this;
		return $internalize(s.Object.alignContent, $String);
	};
	CSSStyleDeclaration.prototype.AlignContent = function() { return this.$val.AlignContent(); };
	CSSStyleDeclaration.ptr.prototype.SetAlignContent = function(v) {
		var s, v;
		s = this;
		s.Object.alignContent = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetAlignContent = function(v) { return this.$val.SetAlignContent(v); };
	CSSStyleDeclaration.ptr.prototype.AlignItems = function() {
		var s;
		s = this;
		return $internalize(s.Object.alignItems, $String);
	};
	CSSStyleDeclaration.prototype.AlignItems = function() { return this.$val.AlignItems(); };
	CSSStyleDeclaration.ptr.prototype.SetAlignItems = function(v) {
		var s, v;
		s = this;
		s.Object.alignItems = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetAlignItems = function(v) { return this.$val.SetAlignItems(v); };
	CSSStyleDeclaration.ptr.prototype.AlignSelf = function() {
		var s;
		s = this;
		return $internalize(s.Object.alignSelf, $String);
	};
	CSSStyleDeclaration.prototype.AlignSelf = function() { return this.$val.AlignSelf(); };
	CSSStyleDeclaration.ptr.prototype.SetAlignSelf = function(v) {
		var s, v;
		s = this;
		s.Object.alignSelf = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetAlignSelf = function(v) { return this.$val.SetAlignSelf(v); };
	CSSStyleDeclaration.ptr.prototype.Animation = function() {
		var s;
		s = this;
		return $internalize(s.Object.animation, $String);
	};
	CSSStyleDeclaration.prototype.Animation = function() { return this.$val.Animation(); };
	CSSStyleDeclaration.ptr.prototype.SetAnimation = function(v) {
		var s, v;
		s = this;
		s.Object.animation = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetAnimation = function(v) { return this.$val.SetAnimation(v); };
	CSSStyleDeclaration.ptr.prototype.AnimationDelay = function() {
		var s;
		s = this;
		return $internalize(s.Object.animationDelay, $String);
	};
	CSSStyleDeclaration.prototype.AnimationDelay = function() { return this.$val.AnimationDelay(); };
	CSSStyleDeclaration.ptr.prototype.SetAnimationDelay = function(v) {
		var s, v;
		s = this;
		s.Object.animationDelay = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetAnimationDelay = function(v) { return this.$val.SetAnimationDelay(v); };
	CSSStyleDeclaration.ptr.prototype.AnimationDirection = function() {
		var s;
		s = this;
		return $internalize(s.Object.animationDirection, $String);
	};
	CSSStyleDeclaration.prototype.AnimationDirection = function() { return this.$val.AnimationDirection(); };
	CSSStyleDeclaration.ptr.prototype.SetAnimationDirection = function(v) {
		var s, v;
		s = this;
		s.Object.animationDirection = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetAnimationDirection = function(v) { return this.$val.SetAnimationDirection(v); };
	CSSStyleDeclaration.ptr.prototype.AnimationDuration = function() {
		var s;
		s = this;
		return $internalize(s.Object.animationDuration, $String);
	};
	CSSStyleDeclaration.prototype.AnimationDuration = function() { return this.$val.AnimationDuration(); };
	CSSStyleDeclaration.ptr.prototype.SetAnimationDuration = function(v) {
		var s, v;
		s = this;
		s.Object.animationDuration = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetAnimationDuration = function(v) { return this.$val.SetAnimationDuration(v); };
	CSSStyleDeclaration.ptr.prototype.AnimationFillMode = function() {
		var s;
		s = this;
		return $internalize(s.Object.animationFillMode, $String);
	};
	CSSStyleDeclaration.prototype.AnimationFillMode = function() { return this.$val.AnimationFillMode(); };
	CSSStyleDeclaration.ptr.prototype.SetAnimationFillMode = function(v) {
		var s, v;
		s = this;
		s.Object.animationFillMode = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetAnimationFillMode = function(v) { return this.$val.SetAnimationFillMode(v); };
	CSSStyleDeclaration.ptr.prototype.AnimationIterationCount = function() {
		var s;
		s = this;
		return $internalize(s.Object.animationIterationCount, $String);
	};
	CSSStyleDeclaration.prototype.AnimationIterationCount = function() { return this.$val.AnimationIterationCount(); };
	CSSStyleDeclaration.ptr.prototype.SetAnimationIterationCount = function(v) {
		var s, v;
		s = this;
		s.Object.animationIterationCount = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetAnimationIterationCount = function(v) { return this.$val.SetAnimationIterationCount(v); };
	CSSStyleDeclaration.ptr.prototype.AnimationName = function() {
		var s;
		s = this;
		return $internalize(s.Object.animationName, $String);
	};
	CSSStyleDeclaration.prototype.AnimationName = function() { return this.$val.AnimationName(); };
	CSSStyleDeclaration.ptr.prototype.SetAnimationName = function(v) {
		var s, v;
		s = this;
		s.Object.animationName = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetAnimationName = function(v) { return this.$val.SetAnimationName(v); };
	CSSStyleDeclaration.ptr.prototype.AnimationTimingFunction = function() {
		var s;
		s = this;
		return $internalize(s.Object.animationTimingFunction, $String);
	};
	CSSStyleDeclaration.prototype.AnimationTimingFunction = function() { return this.$val.AnimationTimingFunction(); };
	CSSStyleDeclaration.ptr.prototype.SetAnimationTimingFunction = function(v) {
		var s, v;
		s = this;
		s.Object.animationTimingFunction = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetAnimationTimingFunction = function(v) { return this.$val.SetAnimationTimingFunction(v); };
	CSSStyleDeclaration.ptr.prototype.AnimationPlayState = function() {
		var s;
		s = this;
		return $internalize(s.Object.animationPlayState, $String);
	};
	CSSStyleDeclaration.prototype.AnimationPlayState = function() { return this.$val.AnimationPlayState(); };
	CSSStyleDeclaration.ptr.prototype.SetAnimationPlayState = function(v) {
		var s, v;
		s = this;
		s.Object.animationPlayState = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetAnimationPlayState = function(v) { return this.$val.SetAnimationPlayState(v); };
	CSSStyleDeclaration.ptr.prototype.Background = function() {
		var s;
		s = this;
		return $internalize(s.Object.background, $String);
	};
	CSSStyleDeclaration.prototype.Background = function() { return this.$val.Background(); };
	CSSStyleDeclaration.ptr.prototype.SetBackground = function(v) {
		var s, v;
		s = this;
		s.Object.background = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBackground = function(v) { return this.$val.SetBackground(v); };
	CSSStyleDeclaration.ptr.prototype.BackgroundAttachment = function() {
		var s;
		s = this;
		return $internalize(s.Object.backgroundAttachment, $String);
	};
	CSSStyleDeclaration.prototype.BackgroundAttachment = function() { return this.$val.BackgroundAttachment(); };
	CSSStyleDeclaration.ptr.prototype.SetBackgroundAttachment = function(v) {
		var s, v;
		s = this;
		s.Object.backgroundAttachment = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBackgroundAttachment = function(v) { return this.$val.SetBackgroundAttachment(v); };
	CSSStyleDeclaration.ptr.prototype.BackgroundColor = function() {
		var s;
		s = this;
		return $internalize(s.Object.backgroundColor, $String);
	};
	CSSStyleDeclaration.prototype.BackgroundColor = function() { return this.$val.BackgroundColor(); };
	CSSStyleDeclaration.ptr.prototype.SetBackgroundColor = function(v) {
		var s, v;
		s = this;
		s.Object.backgroundColor = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBackgroundColor = function(v) { return this.$val.SetBackgroundColor(v); };
	CSSStyleDeclaration.ptr.prototype.BackgroundImage = function() {
		var s;
		s = this;
		return $internalize(s.Object.backgroundImage, $String);
	};
	CSSStyleDeclaration.prototype.BackgroundImage = function() { return this.$val.BackgroundImage(); };
	CSSStyleDeclaration.ptr.prototype.SetBackgroundImage = function(v) {
		var s, v;
		s = this;
		s.Object.backgroundImage = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBackgroundImage = function(v) { return this.$val.SetBackgroundImage(v); };
	CSSStyleDeclaration.ptr.prototype.BackgroundPosition = function() {
		var s;
		s = this;
		return $internalize(s.Object.backgroundPosition, $String);
	};
	CSSStyleDeclaration.prototype.BackgroundPosition = function() { return this.$val.BackgroundPosition(); };
	CSSStyleDeclaration.ptr.prototype.SetBackgroundPosition = function(v) {
		var s, v;
		s = this;
		s.Object.backgroundPosition = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBackgroundPosition = function(v) { return this.$val.SetBackgroundPosition(v); };
	CSSStyleDeclaration.ptr.prototype.BackgroundRepeat = function() {
		var s;
		s = this;
		return $internalize(s.Object.backgroundRepeat, $String);
	};
	CSSStyleDeclaration.prototype.BackgroundRepeat = function() { return this.$val.BackgroundRepeat(); };
	CSSStyleDeclaration.ptr.prototype.SetBackgroundRepeat = function(v) {
		var s, v;
		s = this;
		s.Object.backgroundRepeat = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBackgroundRepeat = function(v) { return this.$val.SetBackgroundRepeat(v); };
	CSSStyleDeclaration.ptr.prototype.BackgroundClip = function() {
		var s;
		s = this;
		return $internalize(s.Object.backgroundClip, $String);
	};
	CSSStyleDeclaration.prototype.BackgroundClip = function() { return this.$val.BackgroundClip(); };
	CSSStyleDeclaration.ptr.prototype.SetBackgroundClip = function(v) {
		var s, v;
		s = this;
		s.Object.backgroundClip = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBackgroundClip = function(v) { return this.$val.SetBackgroundClip(v); };
	CSSStyleDeclaration.ptr.prototype.BackgroundOrigin = function() {
		var s;
		s = this;
		return $internalize(s.Object.backgroundOrigin, $String);
	};
	CSSStyleDeclaration.prototype.BackgroundOrigin = function() { return this.$val.BackgroundOrigin(); };
	CSSStyleDeclaration.ptr.prototype.SetBackgroundOrigin = function(v) {
		var s, v;
		s = this;
		s.Object.backgroundOrigin = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBackgroundOrigin = function(v) { return this.$val.SetBackgroundOrigin(v); };
	CSSStyleDeclaration.ptr.prototype.BackgroundSize = function() {
		var s;
		s = this;
		return $internalize(s.Object.backgroundSize, $String);
	};
	CSSStyleDeclaration.prototype.BackgroundSize = function() { return this.$val.BackgroundSize(); };
	CSSStyleDeclaration.ptr.prototype.SetBackgroundSize = function(v) {
		var s, v;
		s = this;
		s.Object.backgroundSize = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBackgroundSize = function(v) { return this.$val.SetBackgroundSize(v); };
	CSSStyleDeclaration.ptr.prototype.BackfaceVisibility = function() {
		var s;
		s = this;
		return $internalize(s.Object.backfaceVisibility, $String);
	};
	CSSStyleDeclaration.prototype.BackfaceVisibility = function() { return this.$val.BackfaceVisibility(); };
	CSSStyleDeclaration.ptr.prototype.SetBackfaceVisibility = function(v) {
		var s, v;
		s = this;
		s.Object.backfaceVisibility = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBackfaceVisibility = function(v) { return this.$val.SetBackfaceVisibility(v); };
	CSSStyleDeclaration.ptr.prototype.Border = function() {
		var s;
		s = this;
		return $internalize(s.Object.border, $String);
	};
	CSSStyleDeclaration.prototype.Border = function() { return this.$val.Border(); };
	CSSStyleDeclaration.ptr.prototype.SetBorder = function(v) {
		var s, v;
		s = this;
		s.Object.border = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorder = function(v) { return this.$val.SetBorder(v); };
	CSSStyleDeclaration.ptr.prototype.BorderBottom = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderBottom, $String);
	};
	CSSStyleDeclaration.prototype.BorderBottom = function() { return this.$val.BorderBottom(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderBottom = function(v) {
		var s, v;
		s = this;
		s.Object.borderBottom = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderBottom = function(v) { return this.$val.SetBorderBottom(v); };
	CSSStyleDeclaration.ptr.prototype.BorderBottomColor = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderBottomColor, $String);
	};
	CSSStyleDeclaration.prototype.BorderBottomColor = function() { return this.$val.BorderBottomColor(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderBottomColor = function(v) {
		var s, v;
		s = this;
		s.Object.borderBottomColor = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderBottomColor = function(v) { return this.$val.SetBorderBottomColor(v); };
	CSSStyleDeclaration.ptr.prototype.BorderBottomLeftRadius = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderBottomLeftRadius, $String);
	};
	CSSStyleDeclaration.prototype.BorderBottomLeftRadius = function() { return this.$val.BorderBottomLeftRadius(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderBottomLeftRadius = function(v) {
		var s, v;
		s = this;
		s.Object.borderBottomLeftRadius = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderBottomLeftRadius = function(v) { return this.$val.SetBorderBottomLeftRadius(v); };
	CSSStyleDeclaration.ptr.prototype.BorderBottomRightRadius = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderBottomRightRadius, $String);
	};
	CSSStyleDeclaration.prototype.BorderBottomRightRadius = function() { return this.$val.BorderBottomRightRadius(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderBottomRightRadius = function(v) {
		var s, v;
		s = this;
		s.Object.borderBottomRightRadius = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderBottomRightRadius = function(v) { return this.$val.SetBorderBottomRightRadius(v); };
	CSSStyleDeclaration.ptr.prototype.BorderBottomStyle = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderBottomStyle, $String);
	};
	CSSStyleDeclaration.prototype.BorderBottomStyle = function() { return this.$val.BorderBottomStyle(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderBottomStyle = function(v) {
		var s, v;
		s = this;
		s.Object.borderBottomStyle = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderBottomStyle = function(v) { return this.$val.SetBorderBottomStyle(v); };
	CSSStyleDeclaration.ptr.prototype.BorderBottomWidth = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderBottomWidth, $String);
	};
	CSSStyleDeclaration.prototype.BorderBottomWidth = function() { return this.$val.BorderBottomWidth(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderBottomWidth = function(v) {
		var s, v;
		s = this;
		s.Object.borderBottomWidth = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderBottomWidth = function(v) { return this.$val.SetBorderBottomWidth(v); };
	CSSStyleDeclaration.ptr.prototype.BorderCollapse = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderCollapse, $String);
	};
	CSSStyleDeclaration.prototype.BorderCollapse = function() { return this.$val.BorderCollapse(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderCollapse = function(v) {
		var s, v;
		s = this;
		s.Object.borderCollapse = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderCollapse = function(v) { return this.$val.SetBorderCollapse(v); };
	CSSStyleDeclaration.ptr.prototype.BorderColor = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderColor, $String);
	};
	CSSStyleDeclaration.prototype.BorderColor = function() { return this.$val.BorderColor(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderColor = function(v) {
		var s, v;
		s = this;
		s.Object.borderColor = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderColor = function(v) { return this.$val.SetBorderColor(v); };
	CSSStyleDeclaration.ptr.prototype.BorderImage = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderImage, $String);
	};
	CSSStyleDeclaration.prototype.BorderImage = function() { return this.$val.BorderImage(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderImage = function(v) {
		var s, v;
		s = this;
		s.Object.borderImage = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderImage = function(v) { return this.$val.SetBorderImage(v); };
	CSSStyleDeclaration.ptr.prototype.BorderImageOutset = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderImageOutset, $String);
	};
	CSSStyleDeclaration.prototype.BorderImageOutset = function() { return this.$val.BorderImageOutset(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderImageOutset = function(v) {
		var s, v;
		s = this;
		s.Object.borderImageOutset = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderImageOutset = function(v) { return this.$val.SetBorderImageOutset(v); };
	CSSStyleDeclaration.ptr.prototype.BorderImageRepeat = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderImageRepeat, $String);
	};
	CSSStyleDeclaration.prototype.BorderImageRepeat = function() { return this.$val.BorderImageRepeat(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderImageRepeat = function(v) {
		var s, v;
		s = this;
		s.Object.borderImageRepeat = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderImageRepeat = function(v) { return this.$val.SetBorderImageRepeat(v); };
	CSSStyleDeclaration.ptr.prototype.BorderImageSlice = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderImageSlice, $String);
	};
	CSSStyleDeclaration.prototype.BorderImageSlice = function() { return this.$val.BorderImageSlice(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderImageSlice = function(v) {
		var s, v;
		s = this;
		s.Object.borderImageSlice = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderImageSlice = function(v) { return this.$val.SetBorderImageSlice(v); };
	CSSStyleDeclaration.ptr.prototype.BorderImageSource = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderImageSource, $String);
	};
	CSSStyleDeclaration.prototype.BorderImageSource = function() { return this.$val.BorderImageSource(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderImageSource = function(v) {
		var s, v;
		s = this;
		s.Object.borderImageSource = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderImageSource = function(v) { return this.$val.SetBorderImageSource(v); };
	CSSStyleDeclaration.ptr.prototype.BorderImageWidth = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderImageWidth, $String);
	};
	CSSStyleDeclaration.prototype.BorderImageWidth = function() { return this.$val.BorderImageWidth(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderImageWidth = function(v) {
		var s, v;
		s = this;
		s.Object.borderImageWidth = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderImageWidth = function(v) { return this.$val.SetBorderImageWidth(v); };
	CSSStyleDeclaration.ptr.prototype.BorderLeft = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderLeft, $String);
	};
	CSSStyleDeclaration.prototype.BorderLeft = function() { return this.$val.BorderLeft(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderLeft = function(v) {
		var s, v;
		s = this;
		s.Object.borderLeft = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderLeft = function(v) { return this.$val.SetBorderLeft(v); };
	CSSStyleDeclaration.ptr.prototype.BorderLeftColor = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderLeftColor, $String);
	};
	CSSStyleDeclaration.prototype.BorderLeftColor = function() { return this.$val.BorderLeftColor(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderLeftColor = function(v) {
		var s, v;
		s = this;
		s.Object.borderLeftColor = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderLeftColor = function(v) { return this.$val.SetBorderLeftColor(v); };
	CSSStyleDeclaration.ptr.prototype.BorderLeftStyle = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderLeftStyle, $String);
	};
	CSSStyleDeclaration.prototype.BorderLeftStyle = function() { return this.$val.BorderLeftStyle(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderLeftStyle = function(v) {
		var s, v;
		s = this;
		s.Object.borderLeftStyle = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderLeftStyle = function(v) { return this.$val.SetBorderLeftStyle(v); };
	CSSStyleDeclaration.ptr.prototype.BorderLeftWidth = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderLeftWidth, $String);
	};
	CSSStyleDeclaration.prototype.BorderLeftWidth = function() { return this.$val.BorderLeftWidth(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderLeftWidth = function(v) {
		var s, v;
		s = this;
		s.Object.borderLeftWidth = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderLeftWidth = function(v) { return this.$val.SetBorderLeftWidth(v); };
	CSSStyleDeclaration.ptr.prototype.BorderRadius = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderRadius, $String);
	};
	CSSStyleDeclaration.prototype.BorderRadius = function() { return this.$val.BorderRadius(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderRadius = function(v) {
		var s, v;
		s = this;
		s.Object.borderRadius = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderRadius = function(v) { return this.$val.SetBorderRadius(v); };
	CSSStyleDeclaration.ptr.prototype.BorderRight = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderRight, $String);
	};
	CSSStyleDeclaration.prototype.BorderRight = function() { return this.$val.BorderRight(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderRight = function(v) {
		var s, v;
		s = this;
		s.Object.borderRight = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderRight = function(v) { return this.$val.SetBorderRight(v); };
	CSSStyleDeclaration.ptr.prototype.BorderRightColor = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderRightColor, $String);
	};
	CSSStyleDeclaration.prototype.BorderRightColor = function() { return this.$val.BorderRightColor(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderRightColor = function(v) {
		var s, v;
		s = this;
		s.Object.borderRightColor = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderRightColor = function(v) { return this.$val.SetBorderRightColor(v); };
	CSSStyleDeclaration.ptr.prototype.BorderRightStyle = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderRightStyle, $String);
	};
	CSSStyleDeclaration.prototype.BorderRightStyle = function() { return this.$val.BorderRightStyle(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderRightStyle = function(v) {
		var s, v;
		s = this;
		s.Object.borderRightStyle = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderRightStyle = function(v) { return this.$val.SetBorderRightStyle(v); };
	CSSStyleDeclaration.ptr.prototype.BorderRightWidth = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderRightWidth, $String);
	};
	CSSStyleDeclaration.prototype.BorderRightWidth = function() { return this.$val.BorderRightWidth(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderRightWidth = function(v) {
		var s, v;
		s = this;
		s.Object.borderRightWidth = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderRightWidth = function(v) { return this.$val.SetBorderRightWidth(v); };
	CSSStyleDeclaration.ptr.prototype.BorderSpacing = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderSpacing, $String);
	};
	CSSStyleDeclaration.prototype.BorderSpacing = function() { return this.$val.BorderSpacing(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderSpacing = function(v) {
		var s, v;
		s = this;
		s.Object.borderSpacing = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderSpacing = function(v) { return this.$val.SetBorderSpacing(v); };
	CSSStyleDeclaration.ptr.prototype.BorderStyle = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderStyle, $String);
	};
	CSSStyleDeclaration.prototype.BorderStyle = function() { return this.$val.BorderStyle(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderStyle = function(v) {
		var s, v;
		s = this;
		s.Object.borderStyle = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderStyle = function(v) { return this.$val.SetBorderStyle(v); };
	CSSStyleDeclaration.ptr.prototype.BorderTop = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderTop, $String);
	};
	CSSStyleDeclaration.prototype.BorderTop = function() { return this.$val.BorderTop(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderTop = function(v) {
		var s, v;
		s = this;
		s.Object.borderTop = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderTop = function(v) { return this.$val.SetBorderTop(v); };
	CSSStyleDeclaration.ptr.prototype.BorderTopColor = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderTopColor, $String);
	};
	CSSStyleDeclaration.prototype.BorderTopColor = function() { return this.$val.BorderTopColor(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderTopColor = function(v) {
		var s, v;
		s = this;
		s.Object.borderTopColor = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderTopColor = function(v) { return this.$val.SetBorderTopColor(v); };
	CSSStyleDeclaration.ptr.prototype.BorderTopLeftRadius = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderTopLeftRadius, $String);
	};
	CSSStyleDeclaration.prototype.BorderTopLeftRadius = function() { return this.$val.BorderTopLeftRadius(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderTopLeftRadius = function(v) {
		var s, v;
		s = this;
		s.Object.borderTopLeftRadius = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderTopLeftRadius = function(v) { return this.$val.SetBorderTopLeftRadius(v); };
	CSSStyleDeclaration.ptr.prototype.BorderTopRightRadius = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderTopRightRadius, $String);
	};
	CSSStyleDeclaration.prototype.BorderTopRightRadius = function() { return this.$val.BorderTopRightRadius(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderTopRightRadius = function(v) {
		var s, v;
		s = this;
		s.Object.borderTopRightRadius = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderTopRightRadius = function(v) { return this.$val.SetBorderTopRightRadius(v); };
	CSSStyleDeclaration.ptr.prototype.BorderTopStyle = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderTopStyle, $String);
	};
	CSSStyleDeclaration.prototype.BorderTopStyle = function() { return this.$val.BorderTopStyle(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderTopStyle = function(v) {
		var s, v;
		s = this;
		s.Object.borderTopStyle = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderTopStyle = function(v) { return this.$val.SetBorderTopStyle(v); };
	CSSStyleDeclaration.ptr.prototype.BorderTopWidth = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderTopWidth, $String);
	};
	CSSStyleDeclaration.prototype.BorderTopWidth = function() { return this.$val.BorderTopWidth(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderTopWidth = function(v) {
		var s, v;
		s = this;
		s.Object.borderTopWidth = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderTopWidth = function(v) { return this.$val.SetBorderTopWidth(v); };
	CSSStyleDeclaration.ptr.prototype.BorderWidth = function() {
		var s;
		s = this;
		return $internalize(s.Object.borderWidth, $String);
	};
	CSSStyleDeclaration.prototype.BorderWidth = function() { return this.$val.BorderWidth(); };
	CSSStyleDeclaration.ptr.prototype.SetBorderWidth = function(v) {
		var s, v;
		s = this;
		s.Object.borderWidth = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBorderWidth = function(v) { return this.$val.SetBorderWidth(v); };
	CSSStyleDeclaration.ptr.prototype.Bottom = function() {
		var s;
		s = this;
		return $internalize(s.Object.bottom, $String);
	};
	CSSStyleDeclaration.prototype.Bottom = function() { return this.$val.Bottom(); };
	CSSStyleDeclaration.ptr.prototype.SetBottom = function(v) {
		var s, v;
		s = this;
		s.Object.bottom = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBottom = function(v) { return this.$val.SetBottom(v); };
	CSSStyleDeclaration.ptr.prototype.BoxShadow = function() {
		var s;
		s = this;
		return $internalize(s.Object.boxShadow, $String);
	};
	CSSStyleDeclaration.prototype.BoxShadow = function() { return this.$val.BoxShadow(); };
	CSSStyleDeclaration.ptr.prototype.SetBoxShadow = function(v) {
		var s, v;
		s = this;
		s.Object.boxShadow = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBoxShadow = function(v) { return this.$val.SetBoxShadow(v); };
	CSSStyleDeclaration.ptr.prototype.BoxSizing = function() {
		var s;
		s = this;
		return $internalize(s.Object.boxSizing, $String);
	};
	CSSStyleDeclaration.prototype.BoxSizing = function() { return this.$val.BoxSizing(); };
	CSSStyleDeclaration.ptr.prototype.SetBoxSizing = function(v) {
		var s, v;
		s = this;
		s.Object.boxSizing = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetBoxSizing = function(v) { return this.$val.SetBoxSizing(v); };
	CSSStyleDeclaration.ptr.prototype.CaptionSide = function() {
		var s;
		s = this;
		return $internalize(s.Object.captionSide, $String);
	};
	CSSStyleDeclaration.prototype.CaptionSide = function() { return this.$val.CaptionSide(); };
	CSSStyleDeclaration.ptr.prototype.SetCaptionSide = function(v) {
		var s, v;
		s = this;
		s.Object.captionSide = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetCaptionSide = function(v) { return this.$val.SetCaptionSide(v); };
	CSSStyleDeclaration.ptr.prototype.Clear = function() {
		var s;
		s = this;
		return $internalize(s.Object.clear, $String);
	};
	CSSStyleDeclaration.prototype.Clear = function() { return this.$val.Clear(); };
	CSSStyleDeclaration.ptr.prototype.SetClear = function(v) {
		var s, v;
		s = this;
		s.Object.clear = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetClear = function(v) { return this.$val.SetClear(v); };
	CSSStyleDeclaration.ptr.prototype.Clip = function() {
		var s;
		s = this;
		return $internalize(s.Object.clip, $String);
	};
	CSSStyleDeclaration.prototype.Clip = function() { return this.$val.Clip(); };
	CSSStyleDeclaration.ptr.prototype.SetClip = function(v) {
		var s, v;
		s = this;
		s.Object.clip = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetClip = function(v) { return this.$val.SetClip(v); };
	CSSStyleDeclaration.ptr.prototype.Color = function() {
		var s;
		s = this;
		return $internalize(s.Object.color, $String);
	};
	CSSStyleDeclaration.prototype.Color = function() { return this.$val.Color(); };
	CSSStyleDeclaration.ptr.prototype.SetColor = function(v) {
		var s, v;
		s = this;
		s.Object.color = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetColor = function(v) { return this.$val.SetColor(v); };
	CSSStyleDeclaration.ptr.prototype.ColumnCount = function() {
		var s;
		s = this;
		return $internalize(s.Object.columnCount, $String);
	};
	CSSStyleDeclaration.prototype.ColumnCount = function() { return this.$val.ColumnCount(); };
	CSSStyleDeclaration.ptr.prototype.SetColumnCount = function(v) {
		var s, v;
		s = this;
		s.Object.columnCount = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetColumnCount = function(v) { return this.$val.SetColumnCount(v); };
	CSSStyleDeclaration.ptr.prototype.ColumnFill = function() {
		var s;
		s = this;
		return $internalize(s.Object.columnFill, $String);
	};
	CSSStyleDeclaration.prototype.ColumnFill = function() { return this.$val.ColumnFill(); };
	CSSStyleDeclaration.ptr.prototype.SetColumnFill = function(v) {
		var s, v;
		s = this;
		s.Object.columnFill = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetColumnFill = function(v) { return this.$val.SetColumnFill(v); };
	CSSStyleDeclaration.ptr.prototype.ColumnGap = function() {
		var s;
		s = this;
		return $internalize(s.Object.columnGap, $String);
	};
	CSSStyleDeclaration.prototype.ColumnGap = function() { return this.$val.ColumnGap(); };
	CSSStyleDeclaration.ptr.prototype.SetColumnGap = function(v) {
		var s, v;
		s = this;
		s.Object.columnGap = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetColumnGap = function(v) { return this.$val.SetColumnGap(v); };
	CSSStyleDeclaration.ptr.prototype.ColumnRule = function() {
		var s;
		s = this;
		return $internalize(s.Object.columnRule, $String);
	};
	CSSStyleDeclaration.prototype.ColumnRule = function() { return this.$val.ColumnRule(); };
	CSSStyleDeclaration.ptr.prototype.SetColumnRule = function(v) {
		var s, v;
		s = this;
		s.Object.columnRule = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetColumnRule = function(v) { return this.$val.SetColumnRule(v); };
	CSSStyleDeclaration.ptr.prototype.ColumnRuleColor = function() {
		var s;
		s = this;
		return $internalize(s.Object.columnRuleColor, $String);
	};
	CSSStyleDeclaration.prototype.ColumnRuleColor = function() { return this.$val.ColumnRuleColor(); };
	CSSStyleDeclaration.ptr.prototype.SetColumnRuleColor = function(v) {
		var s, v;
		s = this;
		s.Object.columnRuleColor = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetColumnRuleColor = function(v) { return this.$val.SetColumnRuleColor(v); };
	CSSStyleDeclaration.ptr.prototype.ColumnRuleStyle = function() {
		var s;
		s = this;
		return $internalize(s.Object.columnRuleStyle, $String);
	};
	CSSStyleDeclaration.prototype.ColumnRuleStyle = function() { return this.$val.ColumnRuleStyle(); };
	CSSStyleDeclaration.ptr.prototype.SetColumnRuleStyle = function(v) {
		var s, v;
		s = this;
		s.Object.columnRuleStyle = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetColumnRuleStyle = function(v) { return this.$val.SetColumnRuleStyle(v); };
	CSSStyleDeclaration.ptr.prototype.ColumnRuleWidth = function() {
		var s;
		s = this;
		return $internalize(s.Object.columnRuleWidth, $String);
	};
	CSSStyleDeclaration.prototype.ColumnRuleWidth = function() { return this.$val.ColumnRuleWidth(); };
	CSSStyleDeclaration.ptr.prototype.SetColumnRuleWidth = function(v) {
		var s, v;
		s = this;
		s.Object.columnRuleWidth = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetColumnRuleWidth = function(v) { return this.$val.SetColumnRuleWidth(v); };
	CSSStyleDeclaration.ptr.prototype.Columns = function() {
		var s;
		s = this;
		return $internalize(s.Object.columns, $String);
	};
	CSSStyleDeclaration.prototype.Columns = function() { return this.$val.Columns(); };
	CSSStyleDeclaration.ptr.prototype.SetColumns = function(v) {
		var s, v;
		s = this;
		s.Object.columns = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetColumns = function(v) { return this.$val.SetColumns(v); };
	CSSStyleDeclaration.ptr.prototype.ColumnSpan = function() {
		var s;
		s = this;
		return $internalize(s.Object.columnSpan, $String);
	};
	CSSStyleDeclaration.prototype.ColumnSpan = function() { return this.$val.ColumnSpan(); };
	CSSStyleDeclaration.ptr.prototype.SetColumnSpan = function(v) {
		var s, v;
		s = this;
		s.Object.columnSpan = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetColumnSpan = function(v) { return this.$val.SetColumnSpan(v); };
	CSSStyleDeclaration.ptr.prototype.ColumnWidth = function() {
		var s;
		s = this;
		return $internalize(s.Object.columnWidth, $String);
	};
	CSSStyleDeclaration.prototype.ColumnWidth = function() { return this.$val.ColumnWidth(); };
	CSSStyleDeclaration.ptr.prototype.SetColumnWidth = function(v) {
		var s, v;
		s = this;
		s.Object.columnWidth = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetColumnWidth = function(v) { return this.$val.SetColumnWidth(v); };
	CSSStyleDeclaration.ptr.prototype.CounterIncrement = function() {
		var s;
		s = this;
		return $internalize(s.Object.counterIncrement, $String);
	};
	CSSStyleDeclaration.prototype.CounterIncrement = function() { return this.$val.CounterIncrement(); };
	CSSStyleDeclaration.ptr.prototype.SetCounterIncrement = function(v) {
		var s, v;
		s = this;
		s.Object.counterIncrement = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetCounterIncrement = function(v) { return this.$val.SetCounterIncrement(v); };
	CSSStyleDeclaration.ptr.prototype.CounterReset = function() {
		var s;
		s = this;
		return $internalize(s.Object.counterReset, $String);
	};
	CSSStyleDeclaration.prototype.CounterReset = function() { return this.$val.CounterReset(); };
	CSSStyleDeclaration.ptr.prototype.SetCounterReset = function(v) {
		var s, v;
		s = this;
		s.Object.counterReset = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetCounterReset = function(v) { return this.$val.SetCounterReset(v); };
	CSSStyleDeclaration.ptr.prototype.Cursor = function() {
		var s;
		s = this;
		return $internalize(s.Object.cursor, $String);
	};
	CSSStyleDeclaration.prototype.Cursor = function() { return this.$val.Cursor(); };
	CSSStyleDeclaration.ptr.prototype.SetCursor = function(v) {
		var s, v;
		s = this;
		s.Object.cursor = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetCursor = function(v) { return this.$val.SetCursor(v); };
	CSSStyleDeclaration.ptr.prototype.Direction = function() {
		var s;
		s = this;
		return $internalize(s.Object.direction, $String);
	};
	CSSStyleDeclaration.prototype.Direction = function() { return this.$val.Direction(); };
	CSSStyleDeclaration.ptr.prototype.SetDirection = function(v) {
		var s, v;
		s = this;
		s.Object.direction = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetDirection = function(v) { return this.$val.SetDirection(v); };
	CSSStyleDeclaration.ptr.prototype.Display = function() {
		var s;
		s = this;
		return $internalize(s.Object.display, $String);
	};
	CSSStyleDeclaration.prototype.Display = function() { return this.$val.Display(); };
	CSSStyleDeclaration.ptr.prototype.SetDisplay = function(v) {
		var s, v;
		s = this;
		s.Object.display = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetDisplay = function(v) { return this.$val.SetDisplay(v); };
	CSSStyleDeclaration.ptr.prototype.EmptyCells = function() {
		var s;
		s = this;
		return $internalize(s.Object.emptyCells, $String);
	};
	CSSStyleDeclaration.prototype.EmptyCells = function() { return this.$val.EmptyCells(); };
	CSSStyleDeclaration.ptr.prototype.SetEmptyCells = function(v) {
		var s, v;
		s = this;
		s.Object.emptyCells = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetEmptyCells = function(v) { return this.$val.SetEmptyCells(v); };
	CSSStyleDeclaration.ptr.prototype.Filter = function() {
		var s;
		s = this;
		return $internalize(s.Object.filter, $String);
	};
	CSSStyleDeclaration.prototype.Filter = function() { return this.$val.Filter(); };
	CSSStyleDeclaration.ptr.prototype.SetFilter = function(v) {
		var s, v;
		s = this;
		s.Object.filter = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetFilter = function(v) { return this.$val.SetFilter(v); };
	CSSStyleDeclaration.ptr.prototype.Flex = function() {
		var s;
		s = this;
		return $internalize(s.Object.flex, $String);
	};
	CSSStyleDeclaration.prototype.Flex = function() { return this.$val.Flex(); };
	CSSStyleDeclaration.ptr.prototype.SetFlex = function(v) {
		var s, v;
		s = this;
		s.Object.flex = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetFlex = function(v) { return this.$val.SetFlex(v); };
	CSSStyleDeclaration.ptr.prototype.FlexBasis = function() {
		var s;
		s = this;
		return $internalize(s.Object.flexBasis, $String);
	};
	CSSStyleDeclaration.prototype.FlexBasis = function() { return this.$val.FlexBasis(); };
	CSSStyleDeclaration.ptr.prototype.SetFlexBasis = function(v) {
		var s, v;
		s = this;
		s.Object.flexBasis = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetFlexBasis = function(v) { return this.$val.SetFlexBasis(v); };
	CSSStyleDeclaration.ptr.prototype.FlexDirection = function() {
		var s;
		s = this;
		return $internalize(s.Object.flexDirection, $String);
	};
	CSSStyleDeclaration.prototype.FlexDirection = function() { return this.$val.FlexDirection(); };
	CSSStyleDeclaration.ptr.prototype.SetFlexDirection = function(v) {
		var s, v;
		s = this;
		s.Object.flexDirection = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetFlexDirection = function(v) { return this.$val.SetFlexDirection(v); };
	CSSStyleDeclaration.ptr.prototype.FlexFlow = function() {
		var s;
		s = this;
		return $internalize(s.Object.flexFlow, $String);
	};
	CSSStyleDeclaration.prototype.FlexFlow = function() { return this.$val.FlexFlow(); };
	CSSStyleDeclaration.ptr.prototype.SetFlexFlow = function(v) {
		var s, v;
		s = this;
		s.Object.flexFlow = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetFlexFlow = function(v) { return this.$val.SetFlexFlow(v); };
	CSSStyleDeclaration.ptr.prototype.FlexGrow = function() {
		var s;
		s = this;
		return $internalize(s.Object.flexGrow, $String);
	};
	CSSStyleDeclaration.prototype.FlexGrow = function() { return this.$val.FlexGrow(); };
	CSSStyleDeclaration.ptr.prototype.SetFlexGrow = function(v) {
		var s, v;
		s = this;
		s.Object.flexGrow = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetFlexGrow = function(v) { return this.$val.SetFlexGrow(v); };
	CSSStyleDeclaration.ptr.prototype.FlexShrink = function() {
		var s;
		s = this;
		return $internalize(s.Object.flexShrink, $String);
	};
	CSSStyleDeclaration.prototype.FlexShrink = function() { return this.$val.FlexShrink(); };
	CSSStyleDeclaration.ptr.prototype.SetFlexShrink = function(v) {
		var s, v;
		s = this;
		s.Object.flexShrink = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetFlexShrink = function(v) { return this.$val.SetFlexShrink(v); };
	CSSStyleDeclaration.ptr.prototype.FlexWrap = function() {
		var s;
		s = this;
		return $internalize(s.Object.flexWrap, $String);
	};
	CSSStyleDeclaration.prototype.FlexWrap = function() { return this.$val.FlexWrap(); };
	CSSStyleDeclaration.ptr.prototype.SetFlexWrap = function(v) {
		var s, v;
		s = this;
		s.Object.flexWrap = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetFlexWrap = function(v) { return this.$val.SetFlexWrap(v); };
	CSSStyleDeclaration.ptr.prototype.CssFloat = function() {
		var s;
		s = this;
		return $internalize(s.Object.cssFloat, $String);
	};
	CSSStyleDeclaration.prototype.CssFloat = function() { return this.$val.CssFloat(); };
	CSSStyleDeclaration.ptr.prototype.SetCssFloat = function(v) {
		var s, v;
		s = this;
		s.Object.cssFloat = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetCssFloat = function(v) { return this.$val.SetCssFloat(v); };
	CSSStyleDeclaration.ptr.prototype.Font = function() {
		var s;
		s = this;
		return $internalize(s.Object.font, $String);
	};
	CSSStyleDeclaration.prototype.Font = function() { return this.$val.Font(); };
	CSSStyleDeclaration.ptr.prototype.SetFont = function(v) {
		var s, v;
		s = this;
		s.Object.font = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetFont = function(v) { return this.$val.SetFont(v); };
	CSSStyleDeclaration.ptr.prototype.FontFamily = function() {
		var s;
		s = this;
		return $internalize(s.Object.fontFamily, $String);
	};
	CSSStyleDeclaration.prototype.FontFamily = function() { return this.$val.FontFamily(); };
	CSSStyleDeclaration.ptr.prototype.SetFontFamily = function(v) {
		var s, v;
		s = this;
		s.Object.fontFamily = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetFontFamily = function(v) { return this.$val.SetFontFamily(v); };
	CSSStyleDeclaration.ptr.prototype.FontSize = function() {
		var s;
		s = this;
		return $internalize(s.Object.fontSize, $String);
	};
	CSSStyleDeclaration.prototype.FontSize = function() { return this.$val.FontSize(); };
	CSSStyleDeclaration.ptr.prototype.SetFontSize = function(v) {
		var s, v;
		s = this;
		s.Object.fontSize = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetFontSize = function(v) { return this.$val.SetFontSize(v); };
	CSSStyleDeclaration.ptr.prototype.FontStyle = function() {
		var s;
		s = this;
		return $internalize(s.Object.fontStyle, $String);
	};
	CSSStyleDeclaration.prototype.FontStyle = function() { return this.$val.FontStyle(); };
	CSSStyleDeclaration.ptr.prototype.SetFontStyle = function(v) {
		var s, v;
		s = this;
		s.Object.fontStyle = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetFontStyle = function(v) { return this.$val.SetFontStyle(v); };
	CSSStyleDeclaration.ptr.prototype.FontVariant = function() {
		var s;
		s = this;
		return $internalize(s.Object.fontVariant, $String);
	};
	CSSStyleDeclaration.prototype.FontVariant = function() { return this.$val.FontVariant(); };
	CSSStyleDeclaration.ptr.prototype.SetFontVariant = function(v) {
		var s, v;
		s = this;
		s.Object.fontVariant = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetFontVariant = function(v) { return this.$val.SetFontVariant(v); };
	CSSStyleDeclaration.ptr.prototype.FontWeight = function() {
		var s;
		s = this;
		return $internalize(s.Object.fontWeight, $String);
	};
	CSSStyleDeclaration.prototype.FontWeight = function() { return this.$val.FontWeight(); };
	CSSStyleDeclaration.ptr.prototype.SetFontWeight = function(v) {
		var s, v;
		s = this;
		s.Object.fontWeight = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetFontWeight = function(v) { return this.$val.SetFontWeight(v); };
	CSSStyleDeclaration.ptr.prototype.FontSizeAdjust = function() {
		var s;
		s = this;
		return $internalize(s.Object.fontSizeAdjust, $String);
	};
	CSSStyleDeclaration.prototype.FontSizeAdjust = function() { return this.$val.FontSizeAdjust(); };
	CSSStyleDeclaration.ptr.prototype.SetFontSizeAdjust = function(v) {
		var s, v;
		s = this;
		s.Object.fontSizeAdjust = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetFontSizeAdjust = function(v) { return this.$val.SetFontSizeAdjust(v); };
	CSSStyleDeclaration.ptr.prototype.Height = function() {
		var s;
		s = this;
		return $internalize(s.Object.height, $String);
	};
	CSSStyleDeclaration.prototype.Height = function() { return this.$val.Height(); };
	CSSStyleDeclaration.ptr.prototype.SetHeight = function(v) {
		var s, v;
		s = this;
		s.Object.height = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetHeight = function(v) { return this.$val.SetHeight(v); };
	CSSStyleDeclaration.ptr.prototype.JustifyContent = function() {
		var s;
		s = this;
		return $internalize(s.Object.justifyContent, $String);
	};
	CSSStyleDeclaration.prototype.JustifyContent = function() { return this.$val.JustifyContent(); };
	CSSStyleDeclaration.ptr.prototype.SetJustifyContent = function(v) {
		var s, v;
		s = this;
		s.Object.justifyContent = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetJustifyContent = function(v) { return this.$val.SetJustifyContent(v); };
	CSSStyleDeclaration.ptr.prototype.Left = function() {
		var s;
		s = this;
		return $internalize(s.Object.left, $String);
	};
	CSSStyleDeclaration.prototype.Left = function() { return this.$val.Left(); };
	CSSStyleDeclaration.ptr.prototype.SetLeft = function(v) {
		var s, v;
		s = this;
		s.Object.left = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetLeft = function(v) { return this.$val.SetLeft(v); };
	CSSStyleDeclaration.ptr.prototype.LetterSpacing = function() {
		var s;
		s = this;
		return $internalize(s.Object.letterSpacing, $String);
	};
	CSSStyleDeclaration.prototype.LetterSpacing = function() { return this.$val.LetterSpacing(); };
	CSSStyleDeclaration.ptr.prototype.SetLetterSpacing = function(v) {
		var s, v;
		s = this;
		s.Object.letterSpacing = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetLetterSpacing = function(v) { return this.$val.SetLetterSpacing(v); };
	CSSStyleDeclaration.ptr.prototype.LineHeight = function() {
		var s;
		s = this;
		return $internalize(s.Object.lineHeight, $String);
	};
	CSSStyleDeclaration.prototype.LineHeight = function() { return this.$val.LineHeight(); };
	CSSStyleDeclaration.ptr.prototype.SetLineHeight = function(v) {
		var s, v;
		s = this;
		s.Object.lineHeight = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetLineHeight = function(v) { return this.$val.SetLineHeight(v); };
	CSSStyleDeclaration.ptr.prototype.ListStyle = function() {
		var s;
		s = this;
		return $internalize(s.Object.listStyle, $String);
	};
	CSSStyleDeclaration.prototype.ListStyle = function() { return this.$val.ListStyle(); };
	CSSStyleDeclaration.ptr.prototype.SetListStyle = function(v) {
		var s, v;
		s = this;
		s.Object.listStyle = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetListStyle = function(v) { return this.$val.SetListStyle(v); };
	CSSStyleDeclaration.ptr.prototype.ListStyleImage = function() {
		var s;
		s = this;
		return $internalize(s.Object.listStyleImage, $String);
	};
	CSSStyleDeclaration.prototype.ListStyleImage = function() { return this.$val.ListStyleImage(); };
	CSSStyleDeclaration.ptr.prototype.SetListStyleImage = function(v) {
		var s, v;
		s = this;
		s.Object.listStyleImage = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetListStyleImage = function(v) { return this.$val.SetListStyleImage(v); };
	CSSStyleDeclaration.ptr.prototype.ListStylePosition = function() {
		var s;
		s = this;
		return $internalize(s.Object.listStylePosition, $String);
	};
	CSSStyleDeclaration.prototype.ListStylePosition = function() { return this.$val.ListStylePosition(); };
	CSSStyleDeclaration.ptr.prototype.SetListStylePosition = function(v) {
		var s, v;
		s = this;
		s.Object.listStylePosition = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetListStylePosition = function(v) { return this.$val.SetListStylePosition(v); };
	CSSStyleDeclaration.ptr.prototype.ListStyleType = function() {
		var s;
		s = this;
		return $internalize(s.Object.listStyleType, $String);
	};
	CSSStyleDeclaration.prototype.ListStyleType = function() { return this.$val.ListStyleType(); };
	CSSStyleDeclaration.ptr.prototype.SetListStyleType = function(v) {
		var s, v;
		s = this;
		s.Object.listStyleType = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetListStyleType = function(v) { return this.$val.SetListStyleType(v); };
	CSSStyleDeclaration.ptr.prototype.Margin = function() {
		var s;
		s = this;
		return $internalize(s.Object.margin, $String);
	};
	CSSStyleDeclaration.prototype.Margin = function() { return this.$val.Margin(); };
	CSSStyleDeclaration.ptr.prototype.SetMargin = function(v) {
		var s, v;
		s = this;
		s.Object.margin = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetMargin = function(v) { return this.$val.SetMargin(v); };
	CSSStyleDeclaration.ptr.prototype.MarginBottom = function() {
		var s;
		s = this;
		return $internalize(s.Object.marginBottom, $String);
	};
	CSSStyleDeclaration.prototype.MarginBottom = function() { return this.$val.MarginBottom(); };
	CSSStyleDeclaration.ptr.prototype.SetMarginBottom = function(v) {
		var s, v;
		s = this;
		s.Object.marginBottom = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetMarginBottom = function(v) { return this.$val.SetMarginBottom(v); };
	CSSStyleDeclaration.ptr.prototype.MarginLeft = function() {
		var s;
		s = this;
		return $internalize(s.Object.marginLeft, $String);
	};
	CSSStyleDeclaration.prototype.MarginLeft = function() { return this.$val.MarginLeft(); };
	CSSStyleDeclaration.ptr.prototype.SetMarginLeft = function(v) {
		var s, v;
		s = this;
		s.Object.marginLeft = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetMarginLeft = function(v) { return this.$val.SetMarginLeft(v); };
	CSSStyleDeclaration.ptr.prototype.MarginRight = function() {
		var s;
		s = this;
		return $internalize(s.Object.marginRight, $String);
	};
	CSSStyleDeclaration.prototype.MarginRight = function() { return this.$val.MarginRight(); };
	CSSStyleDeclaration.ptr.prototype.SetMarginRight = function(v) {
		var s, v;
		s = this;
		s.Object.marginRight = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetMarginRight = function(v) { return this.$val.SetMarginRight(v); };
	CSSStyleDeclaration.ptr.prototype.MarginTop = function() {
		var s;
		s = this;
		return $internalize(s.Object.marginTop, $String);
	};
	CSSStyleDeclaration.prototype.MarginTop = function() { return this.$val.MarginTop(); };
	CSSStyleDeclaration.ptr.prototype.SetMarginTop = function(v) {
		var s, v;
		s = this;
		s.Object.marginTop = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetMarginTop = function(v) { return this.$val.SetMarginTop(v); };
	CSSStyleDeclaration.ptr.prototype.MaxHeight = function() {
		var s;
		s = this;
		return $internalize(s.Object.maxHeight, $String);
	};
	CSSStyleDeclaration.prototype.MaxHeight = function() { return this.$val.MaxHeight(); };
	CSSStyleDeclaration.ptr.prototype.SetMaxHeight = function(v) {
		var s, v;
		s = this;
		s.Object.maxHeight = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetMaxHeight = function(v) { return this.$val.SetMaxHeight(v); };
	CSSStyleDeclaration.ptr.prototype.MaxWidth = function() {
		var s;
		s = this;
		return $internalize(s.Object.maxWidth, $String);
	};
	CSSStyleDeclaration.prototype.MaxWidth = function() { return this.$val.MaxWidth(); };
	CSSStyleDeclaration.ptr.prototype.SetMaxWidth = function(v) {
		var s, v;
		s = this;
		s.Object.maxWidth = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetMaxWidth = function(v) { return this.$val.SetMaxWidth(v); };
	CSSStyleDeclaration.ptr.prototype.MinHeight = function() {
		var s;
		s = this;
		return $internalize(s.Object.minHeight, $String);
	};
	CSSStyleDeclaration.prototype.MinHeight = function() { return this.$val.MinHeight(); };
	CSSStyleDeclaration.ptr.prototype.SetMinHeight = function(v) {
		var s, v;
		s = this;
		s.Object.minHeight = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetMinHeight = function(v) { return this.$val.SetMinHeight(v); };
	CSSStyleDeclaration.ptr.prototype.MinWidth = function() {
		var s;
		s = this;
		return $internalize(s.Object.minWidth, $String);
	};
	CSSStyleDeclaration.prototype.MinWidth = function() { return this.$val.MinWidth(); };
	CSSStyleDeclaration.ptr.prototype.SetMinWidth = function(v) {
		var s, v;
		s = this;
		s.Object.minWidth = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetMinWidth = function(v) { return this.$val.SetMinWidth(v); };
	CSSStyleDeclaration.ptr.prototype.Opacity = function() {
		var s;
		s = this;
		return $internalize(s.Object.opacity, $String);
	};
	CSSStyleDeclaration.prototype.Opacity = function() { return this.$val.Opacity(); };
	CSSStyleDeclaration.ptr.prototype.SetOpacity = function(v) {
		var s, v;
		s = this;
		s.Object.opacity = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetOpacity = function(v) { return this.$val.SetOpacity(v); };
	CSSStyleDeclaration.ptr.prototype.Order = function() {
		var s;
		s = this;
		return $internalize(s.Object.order, $String);
	};
	CSSStyleDeclaration.prototype.Order = function() { return this.$val.Order(); };
	CSSStyleDeclaration.ptr.prototype.SetOrder = function(v) {
		var s, v;
		s = this;
		s.Object.order = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetOrder = function(v) { return this.$val.SetOrder(v); };
	CSSStyleDeclaration.ptr.prototype.Orphans = function() {
		var s;
		s = this;
		return $internalize(s.Object.orphans, $String);
	};
	CSSStyleDeclaration.prototype.Orphans = function() { return this.$val.Orphans(); };
	CSSStyleDeclaration.ptr.prototype.SetOrphans = function(v) {
		var s, v;
		s = this;
		s.Object.orphans = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetOrphans = function(v) { return this.$val.SetOrphans(v); };
	CSSStyleDeclaration.ptr.prototype.Outline = function() {
		var s;
		s = this;
		return $internalize(s.Object.outline, $String);
	};
	CSSStyleDeclaration.prototype.Outline = function() { return this.$val.Outline(); };
	CSSStyleDeclaration.ptr.prototype.SetOutline = function(v) {
		var s, v;
		s = this;
		s.Object.outline = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetOutline = function(v) { return this.$val.SetOutline(v); };
	CSSStyleDeclaration.ptr.prototype.OutlineColor = function() {
		var s;
		s = this;
		return $internalize(s.Object.outlineColor, $String);
	};
	CSSStyleDeclaration.prototype.OutlineColor = function() { return this.$val.OutlineColor(); };
	CSSStyleDeclaration.ptr.prototype.SetOutlineColor = function(v) {
		var s, v;
		s = this;
		s.Object.outlineColor = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetOutlineColor = function(v) { return this.$val.SetOutlineColor(v); };
	CSSStyleDeclaration.ptr.prototype.OutlineOffset = function() {
		var s;
		s = this;
		return $internalize(s.Object.outlineOffset, $String);
	};
	CSSStyleDeclaration.prototype.OutlineOffset = function() { return this.$val.OutlineOffset(); };
	CSSStyleDeclaration.ptr.prototype.SetOutlineOffset = function(v) {
		var s, v;
		s = this;
		s.Object.outlineOffset = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetOutlineOffset = function(v) { return this.$val.SetOutlineOffset(v); };
	CSSStyleDeclaration.ptr.prototype.OutlineStyle = function() {
		var s;
		s = this;
		return $internalize(s.Object.outlineStyle, $String);
	};
	CSSStyleDeclaration.prototype.OutlineStyle = function() { return this.$val.OutlineStyle(); };
	CSSStyleDeclaration.ptr.prototype.SetOutlineStyle = function(v) {
		var s, v;
		s = this;
		s.Object.outlineStyle = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetOutlineStyle = function(v) { return this.$val.SetOutlineStyle(v); };
	CSSStyleDeclaration.ptr.prototype.OutlineWidth = function() {
		var s;
		s = this;
		return $internalize(s.Object.outlineWidth, $String);
	};
	CSSStyleDeclaration.prototype.OutlineWidth = function() { return this.$val.OutlineWidth(); };
	CSSStyleDeclaration.ptr.prototype.SetOutlineWidth = function(v) {
		var s, v;
		s = this;
		s.Object.outlineWidth = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetOutlineWidth = function(v) { return this.$val.SetOutlineWidth(v); };
	CSSStyleDeclaration.ptr.prototype.Overflow = function() {
		var s;
		s = this;
		return $internalize(s.Object.overflow, $String);
	};
	CSSStyleDeclaration.prototype.Overflow = function() { return this.$val.Overflow(); };
	CSSStyleDeclaration.ptr.prototype.SetOverflow = function(v) {
		var s, v;
		s = this;
		s.Object.overflow = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetOverflow = function(v) { return this.$val.SetOverflow(v); };
	CSSStyleDeclaration.ptr.prototype.OverflowX = function() {
		var s;
		s = this;
		return $internalize(s.Object.overflowX, $String);
	};
	CSSStyleDeclaration.prototype.OverflowX = function() { return this.$val.OverflowX(); };
	CSSStyleDeclaration.ptr.prototype.SetOverflowX = function(v) {
		var s, v;
		s = this;
		s.Object.overflowX = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetOverflowX = function(v) { return this.$val.SetOverflowX(v); };
	CSSStyleDeclaration.ptr.prototype.OverflowY = function() {
		var s;
		s = this;
		return $internalize(s.Object.overflowY, $String);
	};
	CSSStyleDeclaration.prototype.OverflowY = function() { return this.$val.OverflowY(); };
	CSSStyleDeclaration.ptr.prototype.SetOverflowY = function(v) {
		var s, v;
		s = this;
		s.Object.overflowY = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetOverflowY = function(v) { return this.$val.SetOverflowY(v); };
	CSSStyleDeclaration.ptr.prototype.Padding = function() {
		var s;
		s = this;
		return $internalize(s.Object.padding, $String);
	};
	CSSStyleDeclaration.prototype.Padding = function() { return this.$val.Padding(); };
	CSSStyleDeclaration.ptr.prototype.SetPadding = function(v) {
		var s, v;
		s = this;
		s.Object.padding = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetPadding = function(v) { return this.$val.SetPadding(v); };
	CSSStyleDeclaration.ptr.prototype.PaddingBottom = function() {
		var s;
		s = this;
		return $internalize(s.Object.paddingBottom, $String);
	};
	CSSStyleDeclaration.prototype.PaddingBottom = function() { return this.$val.PaddingBottom(); };
	CSSStyleDeclaration.ptr.prototype.SetPaddingBottom = function(v) {
		var s, v;
		s = this;
		s.Object.paddingBottom = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetPaddingBottom = function(v) { return this.$val.SetPaddingBottom(v); };
	CSSStyleDeclaration.ptr.prototype.PaddingLeft = function() {
		var s;
		s = this;
		return $internalize(s.Object.paddingLeft, $String);
	};
	CSSStyleDeclaration.prototype.PaddingLeft = function() { return this.$val.PaddingLeft(); };
	CSSStyleDeclaration.ptr.prototype.SetPaddingLeft = function(v) {
		var s, v;
		s = this;
		s.Object.paddingLeft = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetPaddingLeft = function(v) { return this.$val.SetPaddingLeft(v); };
	CSSStyleDeclaration.ptr.prototype.PaddingRight = function() {
		var s;
		s = this;
		return $internalize(s.Object.paddingRight, $String);
	};
	CSSStyleDeclaration.prototype.PaddingRight = function() { return this.$val.PaddingRight(); };
	CSSStyleDeclaration.ptr.prototype.SetPaddingRight = function(v) {
		var s, v;
		s = this;
		s.Object.paddingRight = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetPaddingRight = function(v) { return this.$val.SetPaddingRight(v); };
	CSSStyleDeclaration.ptr.prototype.PaddingTop = function() {
		var s;
		s = this;
		return $internalize(s.Object.paddingTop, $String);
	};
	CSSStyleDeclaration.prototype.PaddingTop = function() { return this.$val.PaddingTop(); };
	CSSStyleDeclaration.ptr.prototype.SetPaddingTop = function(v) {
		var s, v;
		s = this;
		s.Object.paddingTop = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetPaddingTop = function(v) { return this.$val.SetPaddingTop(v); };
	CSSStyleDeclaration.ptr.prototype.PageBreakAfter = function() {
		var s;
		s = this;
		return $internalize(s.Object.pageBreakAfter, $String);
	};
	CSSStyleDeclaration.prototype.PageBreakAfter = function() { return this.$val.PageBreakAfter(); };
	CSSStyleDeclaration.ptr.prototype.SetPageBreakAfter = function(v) {
		var s, v;
		s = this;
		s.Object.pageBreakAfter = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetPageBreakAfter = function(v) { return this.$val.SetPageBreakAfter(v); };
	CSSStyleDeclaration.ptr.prototype.PageBreakBefore = function() {
		var s;
		s = this;
		return $internalize(s.Object.pageBreakBefore, $String);
	};
	CSSStyleDeclaration.prototype.PageBreakBefore = function() { return this.$val.PageBreakBefore(); };
	CSSStyleDeclaration.ptr.prototype.SetPageBreakBefore = function(v) {
		var s, v;
		s = this;
		s.Object.pageBreakBefore = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetPageBreakBefore = function(v) { return this.$val.SetPageBreakBefore(v); };
	CSSStyleDeclaration.ptr.prototype.PageBreakInside = function() {
		var s;
		s = this;
		return $internalize(s.Object.pageBreakInside, $String);
	};
	CSSStyleDeclaration.prototype.PageBreakInside = function() { return this.$val.PageBreakInside(); };
	CSSStyleDeclaration.ptr.prototype.SetPageBreakInside = function(v) {
		var s, v;
		s = this;
		s.Object.pageBreakInside = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetPageBreakInside = function(v) { return this.$val.SetPageBreakInside(v); };
	CSSStyleDeclaration.ptr.prototype.Perspective = function() {
		var s;
		s = this;
		return $internalize(s.Object.perspective, $String);
	};
	CSSStyleDeclaration.prototype.Perspective = function() { return this.$val.Perspective(); };
	CSSStyleDeclaration.ptr.prototype.SetPerspective = function(v) {
		var s, v;
		s = this;
		s.Object.perspective = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetPerspective = function(v) { return this.$val.SetPerspective(v); };
	CSSStyleDeclaration.ptr.prototype.PerspectiveOrigin = function() {
		var s;
		s = this;
		return $internalize(s.Object.perspectiveOrigin, $String);
	};
	CSSStyleDeclaration.prototype.PerspectiveOrigin = function() { return this.$val.PerspectiveOrigin(); };
	CSSStyleDeclaration.ptr.prototype.SetPerspectiveOrigin = function(v) {
		var s, v;
		s = this;
		s.Object.perspectiveOrigin = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetPerspectiveOrigin = function(v) { return this.$val.SetPerspectiveOrigin(v); };
	CSSStyleDeclaration.ptr.prototype.Position = function() {
		var s;
		s = this;
		return $internalize(s.Object.position, $String);
	};
	CSSStyleDeclaration.prototype.Position = function() { return this.$val.Position(); };
	CSSStyleDeclaration.ptr.prototype.SetPosition = function(v) {
		var s, v;
		s = this;
		s.Object.position = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetPosition = function(v) { return this.$val.SetPosition(v); };
	CSSStyleDeclaration.ptr.prototype.Quotes = function() {
		var s;
		s = this;
		return $internalize(s.Object.quotes, $String);
	};
	CSSStyleDeclaration.prototype.Quotes = function() { return this.$val.Quotes(); };
	CSSStyleDeclaration.ptr.prototype.SetQuotes = function(v) {
		var s, v;
		s = this;
		s.Object.quotes = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetQuotes = function(v) { return this.$val.SetQuotes(v); };
	CSSStyleDeclaration.ptr.prototype.Resize = function() {
		var s;
		s = this;
		return $internalize(s.Object.resize, $String);
	};
	CSSStyleDeclaration.prototype.Resize = function() { return this.$val.Resize(); };
	CSSStyleDeclaration.ptr.prototype.SetResize = function(v) {
		var s, v;
		s = this;
		s.Object.resize = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetResize = function(v) { return this.$val.SetResize(v); };
	CSSStyleDeclaration.ptr.prototype.Right = function() {
		var s;
		s = this;
		return $internalize(s.Object.right, $String);
	};
	CSSStyleDeclaration.prototype.Right = function() { return this.$val.Right(); };
	CSSStyleDeclaration.ptr.prototype.SetRight = function(v) {
		var s, v;
		s = this;
		s.Object.right = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetRight = function(v) { return this.$val.SetRight(v); };
	CSSStyleDeclaration.ptr.prototype.TableLayout = function() {
		var s;
		s = this;
		return $internalize(s.Object.tableLayout, $String);
	};
	CSSStyleDeclaration.prototype.TableLayout = function() { return this.$val.TableLayout(); };
	CSSStyleDeclaration.ptr.prototype.SetTableLayout = function(v) {
		var s, v;
		s = this;
		s.Object.tableLayout = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetTableLayout = function(v) { return this.$val.SetTableLayout(v); };
	CSSStyleDeclaration.ptr.prototype.TabSize = function() {
		var s;
		s = this;
		return $internalize(s.Object.tabSize, $String);
	};
	CSSStyleDeclaration.prototype.TabSize = function() { return this.$val.TabSize(); };
	CSSStyleDeclaration.ptr.prototype.SetTabSize = function(v) {
		var s, v;
		s = this;
		s.Object.tabSize = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetTabSize = function(v) { return this.$val.SetTabSize(v); };
	CSSStyleDeclaration.ptr.prototype.TextAlign = function() {
		var s;
		s = this;
		return $internalize(s.Object.textAlign, $String);
	};
	CSSStyleDeclaration.prototype.TextAlign = function() { return this.$val.TextAlign(); };
	CSSStyleDeclaration.ptr.prototype.SetTextAlign = function(v) {
		var s, v;
		s = this;
		s.Object.textAlign = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetTextAlign = function(v) { return this.$val.SetTextAlign(v); };
	CSSStyleDeclaration.ptr.prototype.TextAlignLast = function() {
		var s;
		s = this;
		return $internalize(s.Object.textAlignLast, $String);
	};
	CSSStyleDeclaration.prototype.TextAlignLast = function() { return this.$val.TextAlignLast(); };
	CSSStyleDeclaration.ptr.prototype.SetTextAlignLast = function(v) {
		var s, v;
		s = this;
		s.Object.textAlignLast = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetTextAlignLast = function(v) { return this.$val.SetTextAlignLast(v); };
	CSSStyleDeclaration.ptr.prototype.TextDecoration = function() {
		var s;
		s = this;
		return $internalize(s.Object.textDecoration, $String);
	};
	CSSStyleDeclaration.prototype.TextDecoration = function() { return this.$val.TextDecoration(); };
	CSSStyleDeclaration.ptr.prototype.SetTextDecoration = function(v) {
		var s, v;
		s = this;
		s.Object.textDecoration = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetTextDecoration = function(v) { return this.$val.SetTextDecoration(v); };
	CSSStyleDeclaration.ptr.prototype.TextDecorationColor = function() {
		var s;
		s = this;
		return $internalize(s.Object.textDecorationColor, $String);
	};
	CSSStyleDeclaration.prototype.TextDecorationColor = function() { return this.$val.TextDecorationColor(); };
	CSSStyleDeclaration.ptr.prototype.SetTextDecorationColor = function(v) {
		var s, v;
		s = this;
		s.Object.textDecorationColor = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetTextDecorationColor = function(v) { return this.$val.SetTextDecorationColor(v); };
	CSSStyleDeclaration.ptr.prototype.TextDecorationLine = function() {
		var s;
		s = this;
		return $internalize(s.Object.textDecorationLine, $String);
	};
	CSSStyleDeclaration.prototype.TextDecorationLine = function() { return this.$val.TextDecorationLine(); };
	CSSStyleDeclaration.ptr.prototype.SetTextDecorationLine = function(v) {
		var s, v;
		s = this;
		s.Object.textDecorationLine = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetTextDecorationLine = function(v) { return this.$val.SetTextDecorationLine(v); };
	CSSStyleDeclaration.ptr.prototype.TextDecorationStyle = function() {
		var s;
		s = this;
		return $internalize(s.Object.textDecorationStyle, $String);
	};
	CSSStyleDeclaration.prototype.TextDecorationStyle = function() { return this.$val.TextDecorationStyle(); };
	CSSStyleDeclaration.ptr.prototype.SetTextDecorationStyle = function(v) {
		var s, v;
		s = this;
		s.Object.textDecorationStyle = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetTextDecorationStyle = function(v) { return this.$val.SetTextDecorationStyle(v); };
	CSSStyleDeclaration.ptr.prototype.TextIndent = function() {
		var s;
		s = this;
		return $internalize(s.Object.textIndent, $String);
	};
	CSSStyleDeclaration.prototype.TextIndent = function() { return this.$val.TextIndent(); };
	CSSStyleDeclaration.ptr.prototype.SetTextIndent = function(v) {
		var s, v;
		s = this;
		s.Object.textIndent = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetTextIndent = function(v) { return this.$val.SetTextIndent(v); };
	CSSStyleDeclaration.ptr.prototype.TextOverflow = function() {
		var s;
		s = this;
		return $internalize(s.Object.textOverflow, $String);
	};
	CSSStyleDeclaration.prototype.TextOverflow = function() { return this.$val.TextOverflow(); };
	CSSStyleDeclaration.ptr.prototype.SetTextOverflow = function(v) {
		var s, v;
		s = this;
		s.Object.textOverflow = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetTextOverflow = function(v) { return this.$val.SetTextOverflow(v); };
	CSSStyleDeclaration.ptr.prototype.TextShadow = function() {
		var s;
		s = this;
		return $internalize(s.Object.textShadow, $String);
	};
	CSSStyleDeclaration.prototype.TextShadow = function() { return this.$val.TextShadow(); };
	CSSStyleDeclaration.ptr.prototype.SetTextShadow = function(v) {
		var s, v;
		s = this;
		s.Object.textShadow = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetTextShadow = function(v) { return this.$val.SetTextShadow(v); };
	CSSStyleDeclaration.ptr.prototype.TextTransform = function() {
		var s;
		s = this;
		return $internalize(s.Object.textTransform, $String);
	};
	CSSStyleDeclaration.prototype.TextTransform = function() { return this.$val.TextTransform(); };
	CSSStyleDeclaration.ptr.prototype.SetTextTransform = function(v) {
		var s, v;
		s = this;
		s.Object.textTransform = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetTextTransform = function(v) { return this.$val.SetTextTransform(v); };
	CSSStyleDeclaration.ptr.prototype.Top = function() {
		var s;
		s = this;
		return $internalize(s.Object.top, $String);
	};
	CSSStyleDeclaration.prototype.Top = function() { return this.$val.Top(); };
	CSSStyleDeclaration.ptr.prototype.SetTop = function(v) {
		var s, v;
		s = this;
		s.Object.top = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetTop = function(v) { return this.$val.SetTop(v); };
	CSSStyleDeclaration.ptr.prototype.Transform = function() {
		var s;
		s = this;
		return $internalize(s.Object.transform, $String);
	};
	CSSStyleDeclaration.prototype.Transform = function() { return this.$val.Transform(); };
	CSSStyleDeclaration.ptr.prototype.SetTransform = function(v) {
		var s, v;
		s = this;
		s.Object.transform = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetTransform = function(v) { return this.$val.SetTransform(v); };
	CSSStyleDeclaration.ptr.prototype.TransformOrigin = function() {
		var s;
		s = this;
		return $internalize(s.Object.transformOrigin, $String);
	};
	CSSStyleDeclaration.prototype.TransformOrigin = function() { return this.$val.TransformOrigin(); };
	CSSStyleDeclaration.ptr.prototype.SetTransformOrigin = function(v) {
		var s, v;
		s = this;
		s.Object.transformOrigin = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetTransformOrigin = function(v) { return this.$val.SetTransformOrigin(v); };
	CSSStyleDeclaration.ptr.prototype.TransformStyle = function() {
		var s;
		s = this;
		return $internalize(s.Object.transformStyle, $String);
	};
	CSSStyleDeclaration.prototype.TransformStyle = function() { return this.$val.TransformStyle(); };
	CSSStyleDeclaration.ptr.prototype.SetTransformStyle = function(v) {
		var s, v;
		s = this;
		s.Object.transformStyle = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetTransformStyle = function(v) { return this.$val.SetTransformStyle(v); };
	CSSStyleDeclaration.ptr.prototype.Transition = function() {
		var s;
		s = this;
		return $internalize(s.Object.transition, $String);
	};
	CSSStyleDeclaration.prototype.Transition = function() { return this.$val.Transition(); };
	CSSStyleDeclaration.ptr.prototype.SetTransition = function(v) {
		var s, v;
		s = this;
		s.Object.transition = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetTransition = function(v) { return this.$val.SetTransition(v); };
	CSSStyleDeclaration.ptr.prototype.TransitionProperty = function() {
		var s;
		s = this;
		return $internalize(s.Object.transitionProperty, $String);
	};
	CSSStyleDeclaration.prototype.TransitionProperty = function() { return this.$val.TransitionProperty(); };
	CSSStyleDeclaration.ptr.prototype.SetTransitionProperty = function(v) {
		var s, v;
		s = this;
		s.Object.transitionProperty = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetTransitionProperty = function(v) { return this.$val.SetTransitionProperty(v); };
	CSSStyleDeclaration.ptr.prototype.TransitionDuration = function() {
		var s;
		s = this;
		return $internalize(s.Object.transitionDuration, $String);
	};
	CSSStyleDeclaration.prototype.TransitionDuration = function() { return this.$val.TransitionDuration(); };
	CSSStyleDeclaration.ptr.prototype.SetTransitionDuration = function(v) {
		var s, v;
		s = this;
		s.Object.transitionDuration = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetTransitionDuration = function(v) { return this.$val.SetTransitionDuration(v); };
	CSSStyleDeclaration.ptr.prototype.TransitionTimingFunction = function() {
		var s;
		s = this;
		return $internalize(s.Object.transitionTimingFunction, $String);
	};
	CSSStyleDeclaration.prototype.TransitionTimingFunction = function() { return this.$val.TransitionTimingFunction(); };
	CSSStyleDeclaration.ptr.prototype.SetTransitionTimingFunction = function(v) {
		var s, v;
		s = this;
		s.Object.transitionTimingFunction = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetTransitionTimingFunction = function(v) { return this.$val.SetTransitionTimingFunction(v); };
	CSSStyleDeclaration.ptr.prototype.TransitionDelay = function() {
		var s;
		s = this;
		return $internalize(s.Object.transitionDelay, $String);
	};
	CSSStyleDeclaration.prototype.TransitionDelay = function() { return this.$val.TransitionDelay(); };
	CSSStyleDeclaration.ptr.prototype.SetTransitionDelay = function(v) {
		var s, v;
		s = this;
		s.Object.transitionDelay = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetTransitionDelay = function(v) { return this.$val.SetTransitionDelay(v); };
	CSSStyleDeclaration.ptr.prototype.UnicodeBidi = function() {
		var s;
		s = this;
		return $internalize(s.Object.unicodeBidi, $String);
	};
	CSSStyleDeclaration.prototype.UnicodeBidi = function() { return this.$val.UnicodeBidi(); };
	CSSStyleDeclaration.ptr.prototype.SetUnicodeBidi = function(v) {
		var s, v;
		s = this;
		s.Object.unicodeBidi = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetUnicodeBidi = function(v) { return this.$val.SetUnicodeBidi(v); };
	CSSStyleDeclaration.ptr.prototype.UserSelect = function() {
		var s;
		s = this;
		return $internalize(s.Object.userSelect, $String);
	};
	CSSStyleDeclaration.prototype.UserSelect = function() { return this.$val.UserSelect(); };
	CSSStyleDeclaration.ptr.prototype.SetUserSelect = function(v) {
		var s, v;
		s = this;
		s.Object.userSelect = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetUserSelect = function(v) { return this.$val.SetUserSelect(v); };
	CSSStyleDeclaration.ptr.prototype.VerticalAlign = function() {
		var s;
		s = this;
		return $internalize(s.Object.verticalAlign, $String);
	};
	CSSStyleDeclaration.prototype.VerticalAlign = function() { return this.$val.VerticalAlign(); };
	CSSStyleDeclaration.ptr.prototype.SetVerticalAlign = function(v) {
		var s, v;
		s = this;
		s.Object.verticalAlign = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetVerticalAlign = function(v) { return this.$val.SetVerticalAlign(v); };
	CSSStyleDeclaration.ptr.prototype.Visibility = function() {
		var s;
		s = this;
		return $internalize(s.Object.visibility, $String);
	};
	CSSStyleDeclaration.prototype.Visibility = function() { return this.$val.Visibility(); };
	CSSStyleDeclaration.ptr.prototype.SetVisibility = function(v) {
		var s, v;
		s = this;
		s.Object.visibility = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetVisibility = function(v) { return this.$val.SetVisibility(v); };
	CSSStyleDeclaration.ptr.prototype.WhiteSpace = function() {
		var s;
		s = this;
		return $internalize(s.Object.whiteSpace, $String);
	};
	CSSStyleDeclaration.prototype.WhiteSpace = function() { return this.$val.WhiteSpace(); };
	CSSStyleDeclaration.ptr.prototype.SetWhiteSpace = function(v) {
		var s, v;
		s = this;
		s.Object.whiteSpace = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetWhiteSpace = function(v) { return this.$val.SetWhiteSpace(v); };
	CSSStyleDeclaration.ptr.prototype.Width = function() {
		var s;
		s = this;
		return $internalize(s.Object.width, $String);
	};
	CSSStyleDeclaration.prototype.Width = function() { return this.$val.Width(); };
	CSSStyleDeclaration.ptr.prototype.SetWidth = function(v) {
		var s, v;
		s = this;
		s.Object.width = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetWidth = function(v) { return this.$val.SetWidth(v); };
	CSSStyleDeclaration.ptr.prototype.WordBreak = function() {
		var s;
		s = this;
		return $internalize(s.Object.wordBreak, $String);
	};
	CSSStyleDeclaration.prototype.WordBreak = function() { return this.$val.WordBreak(); };
	CSSStyleDeclaration.ptr.prototype.SetWordBreak = function(v) {
		var s, v;
		s = this;
		s.Object.wordBreak = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetWordBreak = function(v) { return this.$val.SetWordBreak(v); };
	CSSStyleDeclaration.ptr.prototype.WordSpacing = function() {
		var s;
		s = this;
		return $internalize(s.Object.wordSpacing, $String);
	};
	CSSStyleDeclaration.prototype.WordSpacing = function() { return this.$val.WordSpacing(); };
	CSSStyleDeclaration.ptr.prototype.SetWordSpacing = function(v) {
		var s, v;
		s = this;
		s.Object.wordSpacing = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetWordSpacing = function(v) { return this.$val.SetWordSpacing(v); };
	CSSStyleDeclaration.ptr.prototype.WordWrap = function() {
		var s;
		s = this;
		return $internalize(s.Object.wordWrap, $String);
	};
	CSSStyleDeclaration.prototype.WordWrap = function() { return this.$val.WordWrap(); };
	CSSStyleDeclaration.ptr.prototype.SetWordWrap = function(v) {
		var s, v;
		s = this;
		s.Object.wordWrap = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetWordWrap = function(v) { return this.$val.SetWordWrap(v); };
	CSSStyleDeclaration.ptr.prototype.Widows = function() {
		var s;
		s = this;
		return $internalize(s.Object.widows, $String);
	};
	CSSStyleDeclaration.prototype.Widows = function() { return this.$val.Widows(); };
	CSSStyleDeclaration.ptr.prototype.SetWidows = function(v) {
		var s, v;
		s = this;
		s.Object.widows = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetWidows = function(v) { return this.$val.SetWidows(v); };
	CSSStyleDeclaration.ptr.prototype.ZIndex = function() {
		var s;
		s = this;
		return $internalize(s.Object.zIndex, $String);
	};
	CSSStyleDeclaration.prototype.ZIndex = function() { return this.$val.ZIndex(); };
	CSSStyleDeclaration.ptr.prototype.SetZIndex = function(v) {
		var s, v;
		s = this;
		s.Object.zIndex = $externalize(v, $String);
	};
	CSSStyleDeclaration.prototype.SetZIndex = function(v) { return this.$val.SetZIndex(v); };
	Object.ptr.prototype.ActiveElement = function() {
		var o;
		o = this;
		return new Object.ptr(o.Object.activeElement);
	};
	Object.prototype.ActiveElement = function() { return this.$val.ActiveElement(); };
	Object.ptr.prototype.CreateElement = function(tag) {
		var o, tag;
		o = this;
		return new Object.ptr($pkg.Document.Object.createElement($externalize(tag, $String)));
	};
	Object.prototype.CreateElement = function(tag) { return this.$val.CreateElement(tag); };
	Object.ptr.prototype.CreateTextNode = function(textContent) {
		var o, textContent;
		o = this;
		return new Object.ptr($pkg.Document.Object.createTextNode($externalize(textContent, $String)));
	};
	Object.prototype.CreateTextNode = function(textContent) { return this.$val.CreateTextNode(textContent); };
	Object.ptr.prototype.GetElementById = function(id) {
		var id, o;
		o = this;
		return new Object.ptr(o.Object.getElementById($externalize(id, $String)));
	};
	Object.prototype.GetElementById = function(id) { return this.$val.GetElementById(id); };
	Object.ptr.prototype.Write = function(markup) {
		var markup, o;
		o = this;
		$pkg.Document.Object.write($externalize(markup, $String));
	};
	Object.prototype.Write = function(markup) { return this.$val.Write(markup); };
	DOMRect.ptr.prototype.X = function() {
		var r;
		r = this;
		return $parseFloat(r.Object.x);
	};
	DOMRect.prototype.X = function() { return this.$val.X(); };
	DOMRect.ptr.prototype.Y = function() {
		var r;
		r = this;
		return $parseFloat(r.Object.y);
	};
	DOMRect.prototype.Y = function() { return this.$val.Y(); };
	DOMRect.ptr.prototype.Width = function() {
		var r;
		r = this;
		return $parseFloat(r.Object.width);
	};
	DOMRect.prototype.Width = function() { return this.$val.Width(); };
	DOMRect.ptr.prototype.Height = function() {
		var r;
		r = this;
		return $parseFloat(r.Object.height);
	};
	DOMRect.prototype.Height = function() { return this.$val.Height(); };
	DOMRect.ptr.prototype.Top = function() {
		var r;
		r = this;
		return $parseFloat(r.Object.top);
	};
	DOMRect.prototype.Top = function() { return this.$val.Top(); };
	DOMRect.ptr.prototype.Right = function() {
		var r;
		r = this;
		return $parseFloat(r.Object.right);
	};
	DOMRect.prototype.Right = function() { return this.$val.Right(); };
	DOMRect.ptr.prototype.Bottom = function() {
		var r;
		r = this;
		return $parseFloat(r.Object.bottom);
	};
	DOMRect.prototype.Bottom = function() { return this.$val.Bottom(); };
	DOMRect.ptr.prototype.Left = function() {
		var r;
		r = this;
		return $parseFloat(r.Object.left);
	};
	DOMRect.prototype.Left = function() { return this.$val.Left(); };
	Object.ptr.prototype.ClassList = function() {
		var o;
		o = this;
		return new DOMTokenList.ptr(o.Object.classList);
	};
	Object.prototype.ClassList = function() { return this.$val.ClassList(); };
	Object.ptr.prototype.InnerHTML = function() {
		var o;
		o = this;
		return $internalize(o.Object.innerHTML, $String);
	};
	Object.prototype.InnerHTML = function() { return this.$val.InnerHTML(); };
	Object.ptr.prototype.SetInnerHTML = function(html) {
		var html, o;
		o = this;
		o.Object.innerHTML = $externalize(html, $String);
	};
	Object.prototype.SetInnerHTML = function(html) { return this.$val.SetInnerHTML(html); };
	Object.ptr.prototype.OuterHTML = function() {
		var o;
		o = this;
		return $internalize(o.Object.outerHTML, $String);
	};
	Object.prototype.OuterHTML = function() { return this.$val.OuterHTML(); };
	Object.ptr.prototype.SetOuterHTML = function(html) {
		var html, o;
		o = this;
		o.Object.outerHTML = $externalize(html, $String);
	};
	Object.prototype.SetOuterHTML = function(html) { return this.$val.SetOuterHTML(html); };
	Object.ptr.prototype.TagName = function() {
		var o;
		o = this;
		return $internalize(o.Object.tagName, $String);
	};
	Object.prototype.TagName = function() { return this.$val.TagName(); };
	Object.ptr.prototype.GetAttribute = function(attributeName) {
		var attributeName, o;
		o = this;
		return $internalize(o.Object.getAttribute($externalize(attributeName, $String)), $String);
	};
	Object.prototype.GetAttribute = function(attributeName) { return this.$val.GetAttribute(attributeName); };
	Object.ptr.prototype.GetBoundingClientRect = function() {
		var o;
		o = this;
		return new DOMRect.ptr(o.Object.getBoundingClientRect());
	};
	Object.prototype.GetBoundingClientRect = function() { return this.$val.GetBoundingClientRect(); };
	Object.ptr.prototype.QuerySelector = function(selectors) {
		var o, selectors;
		o = this;
		return new Object.ptr(o.Object.querySelector($externalize(selectors, $String)));
	};
	Object.prototype.QuerySelector = function(selectors) { return this.$val.QuerySelector(selectors); };
	Object.ptr.prototype.QuerySelectorAll = function(selectors) {
		var i, length, nodeList, nodes, o, selectors;
		o = this;
		nodeList = o.Object.querySelectorAll($externalize(selectors, $String));
		length = $parseInt(nodeList.length) >> 0;
		nodes = sliceType.nil;
		i = 0;
		while (true) {
			if (!(i < length)) { break; }
			nodes = $append(nodes, new Object.ptr(nodeList.item(i)));
			i = i + (1) >> 0;
		}
		return nodes;
	};
	Object.prototype.QuerySelectorAll = function(selectors) { return this.$val.QuerySelectorAll(selectors); };
	Event.ptr.prototype.Target = function() {
		var e;
		e = this;
		return new Object.ptr(e.Object.target);
	};
	Event.prototype.Target = function() { return this.$val.Target(); };
	Event.ptr.prototype.PreventDefault = function() {
		var e;
		e = this;
		e.Object.preventDefault();
	};
	Event.prototype.PreventDefault = function() { return this.$val.PreventDefault(); };
	Event.ptr.prototype.StopImmediatePropagation = function() {
		var e;
		e = this;
		e.Object.stopImmediatePropagation();
	};
	Event.prototype.StopImmediatePropagation = function() { return this.$val.StopImmediatePropagation(); };
	Event.ptr.prototype.StopPropagation = function() {
		var e;
		e = this;
		e.Object.stopPropagation();
	};
	Event.prototype.StopPropagation = function() { return this.$val.StopPropagation(); };
	Object.ptr.prototype.AddEventListener = function(t, listener, args) {
		var args, listener, o, t;
		o = this;
		if (args.$length === 1) {
			o.Object.addEventListener($externalize(t, $String), $externalize(listener, funcType), $externalize((0 >= args.$length ? ($throwRuntimeError("index out of range"), undefined) : args.$array[args.$offset + 0]), $emptyInterface));
		} else {
			o.Object.addEventListener($externalize(t, $String), $externalize(listener, funcType));
		}
	};
	Object.prototype.AddEventListener = function(t, listener, args) { return this.$val.AddEventListener(t, listener, args); };
	Object.ptr.prototype.RemoveEventListener = function(t, listener, args) {
		var args, listener, o, t;
		o = this;
		if (args.$length === 1) {
			o.Object.removeEventListener($externalize(t, $String), $externalize(listener, funcType), $externalize((0 >= args.$length ? ($throwRuntimeError("index out of range"), undefined) : args.$array[args.$offset + 0]), $emptyInterface));
		} else {
			o.Object.removeEventListener($externalize(t, $String), $externalize(listener, funcType));
		}
	};
	Object.prototype.RemoveEventListener = function(t, listener, args) { return this.$val.RemoveEventListener(t, listener, args); };
	Object.ptr.prototype.RemoveAllChildNodes = function() {
		var o;
		o = this;
		while (true) {
			if (!(o.HasChildNodes())) { break; }
			o.RemoveChild(o.LastChild());
		}
	};
	Object.prototype.RemoveAllChildNodes = function() { return this.$val.RemoveAllChildNodes(); };
	Object.ptr.prototype.AppendBefore = function(n) {
		var n, o;
		o = this;
		o.ParentNode().InsertBefore(n, o);
	};
	Object.prototype.AppendBefore = function(n) { return this.$val.AppendBefore(n); };
	Object.ptr.prototype.AppendAfter = function(n) {
		var n, o;
		o = this;
		o.ParentNode().InsertBefore(n, o.NextSibling());
	};
	Object.prototype.AppendAfter = function(n) { return this.$val.AppendAfter(n); };
	Object.ptr.prototype.IsFocused = function() {
		var o;
		o = this;
		return o.IsEqualNode($pkg.Document.ActiveElement());
	};
	Object.prototype.IsFocused = function() { return this.$val.IsFocused(); };
	Object.ptr.prototype.Style = function() {
		var o;
		o = this;
		return new CSSStyleDeclaration.ptr(o.Object.style);
	};
	Object.prototype.Style = function() { return this.$val.Style(); };
	Object.ptr.prototype.Dataset = function() {
		var o;
		o = this;
		return new Object.ptr(o.Object.dataset);
	};
	Object.prototype.Dataset = function() { return this.$val.Dataset(); };
	Object.ptr.prototype.Blur = function() {
		var o;
		o = this;
		o.Object.blur();
	};
	Object.prototype.Blur = function() { return this.$val.Blur(); };
	Object.ptr.prototype.Focus = function() {
		var o;
		o = this;
		o.Object.focus();
	};
	Object.prototype.Focus = function() { return this.$val.Focus(); };
	Object.ptr.prototype.Value = function() {
		var o;
		o = this;
		return $internalize(o.Object.value, $String);
	};
	Object.prototype.Value = function() { return this.$val.Value(); };
	Object.ptr.prototype.SetValue = function(s) {
		var o, s;
		o = this;
		o.Object.value = $externalize(s, $String);
	};
	Object.prototype.SetValue = function(s) { return this.$val.SetValue(s); };
	Event.ptr.prototype.Key = function() {
		var e;
		e = this;
		return $internalize(e.Object.key, $String);
	};
	Event.prototype.Key = function() { return this.$val.Key(); };
	Event.ptr.prototype.KeyCode = function() {
		var e;
		e = this;
		return $parseInt(e.Object.keyCode) >> 0;
	};
	Event.prototype.KeyCode = function() { return this.$val.KeyCode(); };
	Object.ptr.prototype.ChildNodes = function() {
		var i, length, nodeList, nodes, o;
		o = this;
		nodeList = o.Object.childNodes;
		length = $parseInt(nodeList.length) >> 0;
		nodes = sliceType.nil;
		i = 0;
		while (true) {
			if (!(i < length)) { break; }
			nodes = $append(nodes, new Object.ptr(nodeList.item(i)));
			i = i + (1) >> 0;
		}
		return nodes;
	};
	Object.prototype.ChildNodes = function() { return this.$val.ChildNodes(); };
	Object.ptr.prototype.FirstChild = function() {
		var o;
		o = this;
		return new Object.ptr(o.Object.firstChild);
	};
	Object.prototype.FirstChild = function() { return this.$val.FirstChild(); };
	Object.ptr.prototype.LastChild = function() {
		var o;
		o = this;
		return new Object.ptr(o.Object.lastChild);
	};
	Object.prototype.LastChild = function() { return this.$val.LastChild(); };
	Object.ptr.prototype.NextSibling = function() {
		var o;
		o = this;
		return new Object.ptr(o.Object.nextSibling);
	};
	Object.prototype.NextSibling = function() { return this.$val.NextSibling(); };
	Object.ptr.prototype.NodeType = function() {
		var o;
		o = this;
		return $parseInt(o.Object.nodeType) >> 0;
	};
	Object.prototype.NodeType = function() { return this.$val.NodeType(); };
	Object.ptr.prototype.NodeValue = function() {
		var o;
		o = this;
		return $internalize(o.Object.nodeValue, $String);
	};
	Object.prototype.NodeValue = function() { return this.$val.NodeValue(); };
	Object.ptr.prototype.SetNodeValue = function(s) {
		var o, s;
		o = this;
		o.Object.nodeValue = $externalize(s, $String);
	};
	Object.prototype.SetNodeValue = function(s) { return this.$val.SetNodeValue(s); };
	Object.ptr.prototype.ParentNode = function() {
		var o;
		o = this;
		return new Object.ptr(o.Object.parentNode);
	};
	Object.prototype.ParentNode = function() { return this.$val.ParentNode(); };
	Object.ptr.prototype.TextContent = function() {
		var o;
		o = this;
		return $internalize(o.Object.textContent, $String);
	};
	Object.prototype.TextContent = function() { return this.$val.TextContent(); };
	Object.ptr.prototype.SetTextContent = function(s) {
		var o, s;
		o = this;
		o.Object.textContent = $externalize(s, $String);
	};
	Object.prototype.SetTextContent = function(s) { return this.$val.SetTextContent(s); };
	Object.ptr.prototype.AppendChild = function(c) {
		var c, o;
		o = this;
		o.Object.appendChild($externalize(c, ptrType));
	};
	Object.prototype.AppendChild = function(c) { return this.$val.AppendChild(c); };
	Object.ptr.prototype.HasChildNodes = function() {
		var o;
		o = this;
		return !!(o.Object.hasChildNodes());
	};
	Object.prototype.HasChildNodes = function() { return this.$val.HasChildNodes(); };
	Object.ptr.prototype.InsertBefore = function(newNode, referenceNode) {
		var newNode, o, referenceNode;
		o = this;
		return new Object.ptr(o.Object.insertBefore($externalize(newNode, ptrType), $externalize(referenceNode, ptrType)));
	};
	Object.prototype.InsertBefore = function(newNode, referenceNode) { return this.$val.InsertBefore(newNode, referenceNode); };
	Object.ptr.prototype.IsEqualNode = function(n) {
		var n, o;
		o = this;
		return !!(o.Object.isEqualNode($externalize(n, ptrType)));
	};
	Object.prototype.IsEqualNode = function(n) { return this.$val.IsEqualNode(n); };
	Object.ptr.prototype.IsSameNode = function(n) {
		var n, o;
		o = this;
		return !!(o.Object.isSameNode($externalize(n, ptrType)));
	};
	Object.prototype.IsSameNode = function(n) { return this.$val.IsSameNode(n); };
	Object.ptr.prototype.RemoveChild = function(c) {
		var c, o;
		o = this;
		return new Object.ptr(o.Object.removeChild($externalize(c, ptrType)));
	};
	Object.prototype.RemoveChild = function(c) { return this.$val.RemoveChild(c); };
	DOMTokenList.ptr.prototype.Length = function() {
		var t;
		t = this;
		return $parseInt(t.Object.length) >> 0;
	};
	DOMTokenList.prototype.Length = function() { return this.$val.Length(); };
	DOMTokenList.ptr.prototype.Contains = function(s) {
		var s, t;
		t = this;
		return !!(t.Object.contains($externalize(s, $String)));
	};
	DOMTokenList.prototype.Contains = function(s) { return this.$val.Contains(s); };
	DOMTokenList.ptr.prototype.Add = function(s) {
		var s, t;
		t = this;
		t.Object.add($externalize(s, $String));
	};
	DOMTokenList.prototype.Add = function(s) { return this.$val.Add(s); };
	DOMTokenList.ptr.prototype.Remove = function(s) {
		var s, t;
		t = this;
		t.Object.remove($externalize(s, $String));
	};
	DOMTokenList.prototype.Remove = function(s) { return this.$val.Remove(s); };
	DOMTokenList.ptr.prototype.Toggle = function(s) {
		var s, t;
		t = this;
		t.Object.toggle($externalize(s, $String));
	};
	DOMTokenList.prototype.Toggle = function(s) { return this.$val.Toggle(s); };
	ptrType$1.methods = [{prop: "CssText", name: "CssText", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Length", name: "Length", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "AlignContent", name: "AlignContent", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetAlignContent", name: "SetAlignContent", pkg: "", typ: $funcType([$String], [], false)}, {prop: "AlignItems", name: "AlignItems", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetAlignItems", name: "SetAlignItems", pkg: "", typ: $funcType([$String], [], false)}, {prop: "AlignSelf", name: "AlignSelf", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetAlignSelf", name: "SetAlignSelf", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Animation", name: "Animation", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetAnimation", name: "SetAnimation", pkg: "", typ: $funcType([$String], [], false)}, {prop: "AnimationDelay", name: "AnimationDelay", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetAnimationDelay", name: "SetAnimationDelay", pkg: "", typ: $funcType([$String], [], false)}, {prop: "AnimationDirection", name: "AnimationDirection", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetAnimationDirection", name: "SetAnimationDirection", pkg: "", typ: $funcType([$String], [], false)}, {prop: "AnimationDuration", name: "AnimationDuration", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetAnimationDuration", name: "SetAnimationDuration", pkg: "", typ: $funcType([$String], [], false)}, {prop: "AnimationFillMode", name: "AnimationFillMode", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetAnimationFillMode", name: "SetAnimationFillMode", pkg: "", typ: $funcType([$String], [], false)}, {prop: "AnimationIterationCount", name: "AnimationIterationCount", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetAnimationIterationCount", name: "SetAnimationIterationCount", pkg: "", typ: $funcType([$String], [], false)}, {prop: "AnimationName", name: "AnimationName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetAnimationName", name: "SetAnimationName", pkg: "", typ: $funcType([$String], [], false)}, {prop: "AnimationTimingFunction", name: "AnimationTimingFunction", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetAnimationTimingFunction", name: "SetAnimationTimingFunction", pkg: "", typ: $funcType([$String], [], false)}, {prop: "AnimationPlayState", name: "AnimationPlayState", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetAnimationPlayState", name: "SetAnimationPlayState", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Background", name: "Background", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBackground", name: "SetBackground", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BackgroundAttachment", name: "BackgroundAttachment", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBackgroundAttachment", name: "SetBackgroundAttachment", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BackgroundColor", name: "BackgroundColor", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBackgroundColor", name: "SetBackgroundColor", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BackgroundImage", name: "BackgroundImage", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBackgroundImage", name: "SetBackgroundImage", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BackgroundPosition", name: "BackgroundPosition", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBackgroundPosition", name: "SetBackgroundPosition", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BackgroundRepeat", name: "BackgroundRepeat", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBackgroundRepeat", name: "SetBackgroundRepeat", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BackgroundClip", name: "BackgroundClip", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBackgroundClip", name: "SetBackgroundClip", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BackgroundOrigin", name: "BackgroundOrigin", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBackgroundOrigin", name: "SetBackgroundOrigin", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BackgroundSize", name: "BackgroundSize", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBackgroundSize", name: "SetBackgroundSize", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BackfaceVisibility", name: "BackfaceVisibility", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBackfaceVisibility", name: "SetBackfaceVisibility", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Border", name: "Border", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorder", name: "SetBorder", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderBottom", name: "BorderBottom", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderBottom", name: "SetBorderBottom", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderBottomColor", name: "BorderBottomColor", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderBottomColor", name: "SetBorderBottomColor", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderBottomLeftRadius", name: "BorderBottomLeftRadius", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderBottomLeftRadius", name: "SetBorderBottomLeftRadius", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderBottomRightRadius", name: "BorderBottomRightRadius", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderBottomRightRadius", name: "SetBorderBottomRightRadius", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderBottomStyle", name: "BorderBottomStyle", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderBottomStyle", name: "SetBorderBottomStyle", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderBottomWidth", name: "BorderBottomWidth", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderBottomWidth", name: "SetBorderBottomWidth", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderCollapse", name: "BorderCollapse", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderCollapse", name: "SetBorderCollapse", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderColor", name: "BorderColor", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderColor", name: "SetBorderColor", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderImage", name: "BorderImage", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderImage", name: "SetBorderImage", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderImageOutset", name: "BorderImageOutset", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderImageOutset", name: "SetBorderImageOutset", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderImageRepeat", name: "BorderImageRepeat", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderImageRepeat", name: "SetBorderImageRepeat", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderImageSlice", name: "BorderImageSlice", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderImageSlice", name: "SetBorderImageSlice", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderImageSource", name: "BorderImageSource", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderImageSource", name: "SetBorderImageSource", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderImageWidth", name: "BorderImageWidth", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderImageWidth", name: "SetBorderImageWidth", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderLeft", name: "BorderLeft", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderLeft", name: "SetBorderLeft", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderLeftColor", name: "BorderLeftColor", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderLeftColor", name: "SetBorderLeftColor", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderLeftStyle", name: "BorderLeftStyle", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderLeftStyle", name: "SetBorderLeftStyle", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderLeftWidth", name: "BorderLeftWidth", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderLeftWidth", name: "SetBorderLeftWidth", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderRadius", name: "BorderRadius", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderRadius", name: "SetBorderRadius", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderRight", name: "BorderRight", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderRight", name: "SetBorderRight", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderRightColor", name: "BorderRightColor", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderRightColor", name: "SetBorderRightColor", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderRightStyle", name: "BorderRightStyle", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderRightStyle", name: "SetBorderRightStyle", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderRightWidth", name: "BorderRightWidth", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderRightWidth", name: "SetBorderRightWidth", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderSpacing", name: "BorderSpacing", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderSpacing", name: "SetBorderSpacing", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderStyle", name: "BorderStyle", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderStyle", name: "SetBorderStyle", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderTop", name: "BorderTop", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderTop", name: "SetBorderTop", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderTopColor", name: "BorderTopColor", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderTopColor", name: "SetBorderTopColor", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderTopLeftRadius", name: "BorderTopLeftRadius", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderTopLeftRadius", name: "SetBorderTopLeftRadius", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderTopRightRadius", name: "BorderTopRightRadius", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderTopRightRadius", name: "SetBorderTopRightRadius", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderTopStyle", name: "BorderTopStyle", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderTopStyle", name: "SetBorderTopStyle", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderTopWidth", name: "BorderTopWidth", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderTopWidth", name: "SetBorderTopWidth", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BorderWidth", name: "BorderWidth", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBorderWidth", name: "SetBorderWidth", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Bottom", name: "Bottom", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBottom", name: "SetBottom", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BoxShadow", name: "BoxShadow", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBoxShadow", name: "SetBoxShadow", pkg: "", typ: $funcType([$String], [], false)}, {prop: "BoxSizing", name: "BoxSizing", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetBoxSizing", name: "SetBoxSizing", pkg: "", typ: $funcType([$String], [], false)}, {prop: "CaptionSide", name: "CaptionSide", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetCaptionSide", name: "SetCaptionSide", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Clear", name: "Clear", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetClear", name: "SetClear", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Clip", name: "Clip", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetClip", name: "SetClip", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Color", name: "Color", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetColor", name: "SetColor", pkg: "", typ: $funcType([$String], [], false)}, {prop: "ColumnCount", name: "ColumnCount", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetColumnCount", name: "SetColumnCount", pkg: "", typ: $funcType([$String], [], false)}, {prop: "ColumnFill", name: "ColumnFill", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetColumnFill", name: "SetColumnFill", pkg: "", typ: $funcType([$String], [], false)}, {prop: "ColumnGap", name: "ColumnGap", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetColumnGap", name: "SetColumnGap", pkg: "", typ: $funcType([$String], [], false)}, {prop: "ColumnRule", name: "ColumnRule", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetColumnRule", name: "SetColumnRule", pkg: "", typ: $funcType([$String], [], false)}, {prop: "ColumnRuleColor", name: "ColumnRuleColor", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetColumnRuleColor", name: "SetColumnRuleColor", pkg: "", typ: $funcType([$String], [], false)}, {prop: "ColumnRuleStyle", name: "ColumnRuleStyle", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetColumnRuleStyle", name: "SetColumnRuleStyle", pkg: "", typ: $funcType([$String], [], false)}, {prop: "ColumnRuleWidth", name: "ColumnRuleWidth", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetColumnRuleWidth", name: "SetColumnRuleWidth", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Columns", name: "Columns", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetColumns", name: "SetColumns", pkg: "", typ: $funcType([$String], [], false)}, {prop: "ColumnSpan", name: "ColumnSpan", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetColumnSpan", name: "SetColumnSpan", pkg: "", typ: $funcType([$String], [], false)}, {prop: "ColumnWidth", name: "ColumnWidth", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetColumnWidth", name: "SetColumnWidth", pkg: "", typ: $funcType([$String], [], false)}, {prop: "CounterIncrement", name: "CounterIncrement", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetCounterIncrement", name: "SetCounterIncrement", pkg: "", typ: $funcType([$String], [], false)}, {prop: "CounterReset", name: "CounterReset", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetCounterReset", name: "SetCounterReset", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Cursor", name: "Cursor", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetCursor", name: "SetCursor", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Direction", name: "Direction", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetDirection", name: "SetDirection", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Display", name: "Display", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetDisplay", name: "SetDisplay", pkg: "", typ: $funcType([$String], [], false)}, {prop: "EmptyCells", name: "EmptyCells", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetEmptyCells", name: "SetEmptyCells", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Filter", name: "Filter", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetFilter", name: "SetFilter", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Flex", name: "Flex", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetFlex", name: "SetFlex", pkg: "", typ: $funcType([$String], [], false)}, {prop: "FlexBasis", name: "FlexBasis", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetFlexBasis", name: "SetFlexBasis", pkg: "", typ: $funcType([$String], [], false)}, {prop: "FlexDirection", name: "FlexDirection", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetFlexDirection", name: "SetFlexDirection", pkg: "", typ: $funcType([$String], [], false)}, {prop: "FlexFlow", name: "FlexFlow", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetFlexFlow", name: "SetFlexFlow", pkg: "", typ: $funcType([$String], [], false)}, {prop: "FlexGrow", name: "FlexGrow", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetFlexGrow", name: "SetFlexGrow", pkg: "", typ: $funcType([$String], [], false)}, {prop: "FlexShrink", name: "FlexShrink", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetFlexShrink", name: "SetFlexShrink", pkg: "", typ: $funcType([$String], [], false)}, {prop: "FlexWrap", name: "FlexWrap", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetFlexWrap", name: "SetFlexWrap", pkg: "", typ: $funcType([$String], [], false)}, {prop: "CssFloat", name: "CssFloat", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetCssFloat", name: "SetCssFloat", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Font", name: "Font", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetFont", name: "SetFont", pkg: "", typ: $funcType([$String], [], false)}, {prop: "FontFamily", name: "FontFamily", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetFontFamily", name: "SetFontFamily", pkg: "", typ: $funcType([$String], [], false)}, {prop: "FontSize", name: "FontSize", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetFontSize", name: "SetFontSize", pkg: "", typ: $funcType([$String], [], false)}, {prop: "FontStyle", name: "FontStyle", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetFontStyle", name: "SetFontStyle", pkg: "", typ: $funcType([$String], [], false)}, {prop: "FontVariant", name: "FontVariant", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetFontVariant", name: "SetFontVariant", pkg: "", typ: $funcType([$String], [], false)}, {prop: "FontWeight", name: "FontWeight", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetFontWeight", name: "SetFontWeight", pkg: "", typ: $funcType([$String], [], false)}, {prop: "FontSizeAdjust", name: "FontSizeAdjust", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetFontSizeAdjust", name: "SetFontSizeAdjust", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Height", name: "Height", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetHeight", name: "SetHeight", pkg: "", typ: $funcType([$String], [], false)}, {prop: "JustifyContent", name: "JustifyContent", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetJustifyContent", name: "SetJustifyContent", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Left", name: "Left", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetLeft", name: "SetLeft", pkg: "", typ: $funcType([$String], [], false)}, {prop: "LetterSpacing", name: "LetterSpacing", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetLetterSpacing", name: "SetLetterSpacing", pkg: "", typ: $funcType([$String], [], false)}, {prop: "LineHeight", name: "LineHeight", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetLineHeight", name: "SetLineHeight", pkg: "", typ: $funcType([$String], [], false)}, {prop: "ListStyle", name: "ListStyle", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetListStyle", name: "SetListStyle", pkg: "", typ: $funcType([$String], [], false)}, {prop: "ListStyleImage", name: "ListStyleImage", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetListStyleImage", name: "SetListStyleImage", pkg: "", typ: $funcType([$String], [], false)}, {prop: "ListStylePosition", name: "ListStylePosition", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetListStylePosition", name: "SetListStylePosition", pkg: "", typ: $funcType([$String], [], false)}, {prop: "ListStyleType", name: "ListStyleType", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetListStyleType", name: "SetListStyleType", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Margin", name: "Margin", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetMargin", name: "SetMargin", pkg: "", typ: $funcType([$String], [], false)}, {prop: "MarginBottom", name: "MarginBottom", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetMarginBottom", name: "SetMarginBottom", pkg: "", typ: $funcType([$String], [], false)}, {prop: "MarginLeft", name: "MarginLeft", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetMarginLeft", name: "SetMarginLeft", pkg: "", typ: $funcType([$String], [], false)}, {prop: "MarginRight", name: "MarginRight", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetMarginRight", name: "SetMarginRight", pkg: "", typ: $funcType([$String], [], false)}, {prop: "MarginTop", name: "MarginTop", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetMarginTop", name: "SetMarginTop", pkg: "", typ: $funcType([$String], [], false)}, {prop: "MaxHeight", name: "MaxHeight", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetMaxHeight", name: "SetMaxHeight", pkg: "", typ: $funcType([$String], [], false)}, {prop: "MaxWidth", name: "MaxWidth", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetMaxWidth", name: "SetMaxWidth", pkg: "", typ: $funcType([$String], [], false)}, {prop: "MinHeight", name: "MinHeight", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetMinHeight", name: "SetMinHeight", pkg: "", typ: $funcType([$String], [], false)}, {prop: "MinWidth", name: "MinWidth", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetMinWidth", name: "SetMinWidth", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Opacity", name: "Opacity", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetOpacity", name: "SetOpacity", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Order", name: "Order", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetOrder", name: "SetOrder", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Orphans", name: "Orphans", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetOrphans", name: "SetOrphans", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Outline", name: "Outline", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetOutline", name: "SetOutline", pkg: "", typ: $funcType([$String], [], false)}, {prop: "OutlineColor", name: "OutlineColor", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetOutlineColor", name: "SetOutlineColor", pkg: "", typ: $funcType([$String], [], false)}, {prop: "OutlineOffset", name: "OutlineOffset", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetOutlineOffset", name: "SetOutlineOffset", pkg: "", typ: $funcType([$String], [], false)}, {prop: "OutlineStyle", name: "OutlineStyle", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetOutlineStyle", name: "SetOutlineStyle", pkg: "", typ: $funcType([$String], [], false)}, {prop: "OutlineWidth", name: "OutlineWidth", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetOutlineWidth", name: "SetOutlineWidth", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Overflow", name: "Overflow", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetOverflow", name: "SetOverflow", pkg: "", typ: $funcType([$String], [], false)}, {prop: "OverflowX", name: "OverflowX", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetOverflowX", name: "SetOverflowX", pkg: "", typ: $funcType([$String], [], false)}, {prop: "OverflowY", name: "OverflowY", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetOverflowY", name: "SetOverflowY", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Padding", name: "Padding", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetPadding", name: "SetPadding", pkg: "", typ: $funcType([$String], [], false)}, {prop: "PaddingBottom", name: "PaddingBottom", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetPaddingBottom", name: "SetPaddingBottom", pkg: "", typ: $funcType([$String], [], false)}, {prop: "PaddingLeft", name: "PaddingLeft", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetPaddingLeft", name: "SetPaddingLeft", pkg: "", typ: $funcType([$String], [], false)}, {prop: "PaddingRight", name: "PaddingRight", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetPaddingRight", name: "SetPaddingRight", pkg: "", typ: $funcType([$String], [], false)}, {prop: "PaddingTop", name: "PaddingTop", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetPaddingTop", name: "SetPaddingTop", pkg: "", typ: $funcType([$String], [], false)}, {prop: "PageBreakAfter", name: "PageBreakAfter", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetPageBreakAfter", name: "SetPageBreakAfter", pkg: "", typ: $funcType([$String], [], false)}, {prop: "PageBreakBefore", name: "PageBreakBefore", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetPageBreakBefore", name: "SetPageBreakBefore", pkg: "", typ: $funcType([$String], [], false)}, {prop: "PageBreakInside", name: "PageBreakInside", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetPageBreakInside", name: "SetPageBreakInside", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Perspective", name: "Perspective", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetPerspective", name: "SetPerspective", pkg: "", typ: $funcType([$String], [], false)}, {prop: "PerspectiveOrigin", name: "PerspectiveOrigin", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetPerspectiveOrigin", name: "SetPerspectiveOrigin", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Position", name: "Position", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetPosition", name: "SetPosition", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Quotes", name: "Quotes", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetQuotes", name: "SetQuotes", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Resize", name: "Resize", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetResize", name: "SetResize", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Right", name: "Right", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetRight", name: "SetRight", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TableLayout", name: "TableLayout", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTableLayout", name: "SetTableLayout", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TabSize", name: "TabSize", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTabSize", name: "SetTabSize", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TextAlign", name: "TextAlign", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTextAlign", name: "SetTextAlign", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TextAlignLast", name: "TextAlignLast", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTextAlignLast", name: "SetTextAlignLast", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TextDecoration", name: "TextDecoration", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTextDecoration", name: "SetTextDecoration", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TextDecorationColor", name: "TextDecorationColor", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTextDecorationColor", name: "SetTextDecorationColor", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TextDecorationLine", name: "TextDecorationLine", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTextDecorationLine", name: "SetTextDecorationLine", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TextDecorationStyle", name: "TextDecorationStyle", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTextDecorationStyle", name: "SetTextDecorationStyle", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TextIndent", name: "TextIndent", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTextIndent", name: "SetTextIndent", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TextOverflow", name: "TextOverflow", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTextOverflow", name: "SetTextOverflow", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TextShadow", name: "TextShadow", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTextShadow", name: "SetTextShadow", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TextTransform", name: "TextTransform", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTextTransform", name: "SetTextTransform", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Top", name: "Top", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTop", name: "SetTop", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Transform", name: "Transform", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTransform", name: "SetTransform", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TransformOrigin", name: "TransformOrigin", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTransformOrigin", name: "SetTransformOrigin", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TransformStyle", name: "TransformStyle", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTransformStyle", name: "SetTransformStyle", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Transition", name: "Transition", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTransition", name: "SetTransition", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TransitionProperty", name: "TransitionProperty", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTransitionProperty", name: "SetTransitionProperty", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TransitionDuration", name: "TransitionDuration", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTransitionDuration", name: "SetTransitionDuration", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TransitionTimingFunction", name: "TransitionTimingFunction", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTransitionTimingFunction", name: "SetTransitionTimingFunction", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TransitionDelay", name: "TransitionDelay", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTransitionDelay", name: "SetTransitionDelay", pkg: "", typ: $funcType([$String], [], false)}, {prop: "UnicodeBidi", name: "UnicodeBidi", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetUnicodeBidi", name: "SetUnicodeBidi", pkg: "", typ: $funcType([$String], [], false)}, {prop: "UserSelect", name: "UserSelect", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetUserSelect", name: "SetUserSelect", pkg: "", typ: $funcType([$String], [], false)}, {prop: "VerticalAlign", name: "VerticalAlign", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetVerticalAlign", name: "SetVerticalAlign", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Visibility", name: "Visibility", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetVisibility", name: "SetVisibility", pkg: "", typ: $funcType([$String], [], false)}, {prop: "WhiteSpace", name: "WhiteSpace", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetWhiteSpace", name: "SetWhiteSpace", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Width", name: "Width", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetWidth", name: "SetWidth", pkg: "", typ: $funcType([$String], [], false)}, {prop: "WordBreak", name: "WordBreak", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetWordBreak", name: "SetWordBreak", pkg: "", typ: $funcType([$String], [], false)}, {prop: "WordSpacing", name: "WordSpacing", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetWordSpacing", name: "SetWordSpacing", pkg: "", typ: $funcType([$String], [], false)}, {prop: "WordWrap", name: "WordWrap", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetWordWrap", name: "SetWordWrap", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Widows", name: "Widows", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetWidows", name: "SetWidows", pkg: "", typ: $funcType([$String], [], false)}, {prop: "ZIndex", name: "ZIndex", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetZIndex", name: "SetZIndex", pkg: "", typ: $funcType([$String], [], false)}];
	ptrType.methods = [{prop: "ActiveElement", name: "ActiveElement", pkg: "", typ: $funcType([], [ptrType], false)}, {prop: "CreateElement", name: "CreateElement", pkg: "", typ: $funcType([$String], [ptrType], false)}, {prop: "CreateTextNode", name: "CreateTextNode", pkg: "", typ: $funcType([$String], [ptrType], false)}, {prop: "GetElementById", name: "GetElementById", pkg: "", typ: $funcType([$String], [ptrType], false)}, {prop: "Write", name: "Write", pkg: "", typ: $funcType([$String], [], false)}, {prop: "ClassList", name: "ClassList", pkg: "", typ: $funcType([], [ptrType$3], false)}, {prop: "InnerHTML", name: "InnerHTML", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetInnerHTML", name: "SetInnerHTML", pkg: "", typ: $funcType([$String], [], false)}, {prop: "OuterHTML", name: "OuterHTML", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetOuterHTML", name: "SetOuterHTML", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TagName", name: "TagName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "GetAttribute", name: "GetAttribute", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "GetBoundingClientRect", name: "GetBoundingClientRect", pkg: "", typ: $funcType([], [ptrType$4], false)}, {prop: "QuerySelector", name: "QuerySelector", pkg: "", typ: $funcType([$String], [ptrType], false)}, {prop: "QuerySelectorAll", name: "QuerySelectorAll", pkg: "", typ: $funcType([$String], [sliceType], false)}, {prop: "AddEventListener", name: "AddEventListener", pkg: "", typ: $funcType([$String, funcType, sliceType$1], [], true)}, {prop: "RemoveEventListener", name: "RemoveEventListener", pkg: "", typ: $funcType([$String, funcType, sliceType$1], [], true)}, {prop: "RemoveAllChildNodes", name: "RemoveAllChildNodes", pkg: "", typ: $funcType([], [], false)}, {prop: "AppendBefore", name: "AppendBefore", pkg: "", typ: $funcType([ptrType], [], false)}, {prop: "AppendAfter", name: "AppendAfter", pkg: "", typ: $funcType([ptrType], [], false)}, {prop: "IsFocused", name: "IsFocused", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Style", name: "Style", pkg: "", typ: $funcType([], [ptrType$1], false)}, {prop: "Dataset", name: "Dataset", pkg: "", typ: $funcType([], [ptrType], false)}, {prop: "Blur", name: "Blur", pkg: "", typ: $funcType([], [], false)}, {prop: "Focus", name: "Focus", pkg: "", typ: $funcType([], [], false)}, {prop: "Value", name: "Value", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetValue", name: "SetValue", pkg: "", typ: $funcType([$String], [], false)}, {prop: "ChildNodes", name: "ChildNodes", pkg: "", typ: $funcType([], [sliceType], false)}, {prop: "FirstChild", name: "FirstChild", pkg: "", typ: $funcType([], [ptrType], false)}, {prop: "LastChild", name: "LastChild", pkg: "", typ: $funcType([], [ptrType], false)}, {prop: "NextSibling", name: "NextSibling", pkg: "", typ: $funcType([], [ptrType], false)}, {prop: "NodeType", name: "NodeType", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NodeValue", name: "NodeValue", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetNodeValue", name: "SetNodeValue", pkg: "", typ: $funcType([$String], [], false)}, {prop: "ParentNode", name: "ParentNode", pkg: "", typ: $funcType([], [ptrType], false)}, {prop: "TextContent", name: "TextContent", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTextContent", name: "SetTextContent", pkg: "", typ: $funcType([$String], [], false)}, {prop: "AppendChild", name: "AppendChild", pkg: "", typ: $funcType([ptrType], [], false)}, {prop: "HasChildNodes", name: "HasChildNodes", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "InsertBefore", name: "InsertBefore", pkg: "", typ: $funcType([ptrType, ptrType], [ptrType], false)}, {prop: "IsEqualNode", name: "IsEqualNode", pkg: "", typ: $funcType([ptrType], [$Bool], false)}, {prop: "IsSameNode", name: "IsSameNode", pkg: "", typ: $funcType([ptrType], [$Bool], false)}, {prop: "RemoveChild", name: "RemoveChild", pkg: "", typ: $funcType([ptrType], [ptrType], false)}];
	ptrType$4.methods = [{prop: "X", name: "X", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Y", name: "Y", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Width", name: "Width", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Height", name: "Height", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Top", name: "Top", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Right", name: "Right", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Bottom", name: "Bottom", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Left", name: "Left", pkg: "", typ: $funcType([], [$Float64], false)}];
	Event.methods = [{prop: "Target", name: "Target", pkg: "", typ: $funcType([], [ptrType], false)}, {prop: "PreventDefault", name: "PreventDefault", pkg: "", typ: $funcType([], [], false)}, {prop: "StopImmediatePropagation", name: "StopImmediatePropagation", pkg: "", typ: $funcType([], [], false)}, {prop: "StopPropagation", name: "StopPropagation", pkg: "", typ: $funcType([], [], false)}, {prop: "Key", name: "Key", pkg: "", typ: $funcType([], [$String], false)}, {prop: "KeyCode", name: "KeyCode", pkg: "", typ: $funcType([], [$Int], false)}];
	ptrType$3.methods = [{prop: "Length", name: "Length", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Contains", name: "Contains", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "Add", name: "Add", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Remove", name: "Remove", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Toggle", name: "Toggle", pkg: "", typ: $funcType([$String], [], false)}];
	CSSStyleDeclaration.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType$2, tag: ""}]);
	Object.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType$2, tag: ""}]);
	DOMRect.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType$2, tag: ""}]);
	Event.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType$2, tag: ""}]);
	DOMTokenList.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType$2, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.Document = new Object.ptr($global.document);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["errors"] = (function() {
	var $pkg = {}, $init, errorString, ptrType, New;
	errorString = $pkg.errorString = $newType(0, $kindStruct, "errors.errorString", true, "errors", false, function(s_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.s = "";
			return;
		}
		this.s = s_;
	});
	ptrType = $ptrType(errorString);
	New = function(text) {
		var text;
		return new errorString.ptr(text);
	};
	$pkg.New = New;
	errorString.ptr.prototype.Error = function() {
		var e;
		e = this;
		return e.s;
	};
	errorString.prototype.Error = function() { return this.$val.Error(); };
	ptrType.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	errorString.init("errors", [{prop: "s", name: "s", embedded: false, exported: false, typ: $String, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["internal/race"] = (function() {
	var $pkg = {}, $init, Acquire, Release;
	Acquire = function(addr) {
		var addr;
	};
	$pkg.Acquire = Acquire;
	Release = function(addr) {
		var addr;
	};
	$pkg.Release = Release;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["sync/atomic"] = (function() {
	var $pkg = {}, $init, js, CompareAndSwapInt32, AddInt32, LoadUint32, StoreUint32;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	CompareAndSwapInt32 = function(addr, old, new$1) {
		var addr, new$1, old;
		if (addr.$get() === old) {
			addr.$set(new$1);
			return true;
		}
		return false;
	};
	$pkg.CompareAndSwapInt32 = CompareAndSwapInt32;
	AddInt32 = function(addr, delta) {
		var addr, delta, new$1;
		new$1 = addr.$get() + delta >> 0;
		addr.$set(new$1);
		return new$1;
	};
	$pkg.AddInt32 = AddInt32;
	LoadUint32 = function(addr) {
		var addr;
		return addr.$get();
	};
	$pkg.LoadUint32 = LoadUint32;
	StoreUint32 = function(addr, val) {
		var addr, val;
		addr.$set(val);
	};
	$pkg.StoreUint32 = StoreUint32;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["sync"] = (function() {
	var $pkg = {}, $init, js, race, runtime, atomic, Pool, Mutex, Once, poolLocalInternal, poolLocal, notifyList, ptrType, sliceType, ptrType$1, chanType, sliceType$1, ptrType$6, ptrType$7, sliceType$4, funcType, ptrType$16, funcType$2, ptrType$17, arrayType$2, semWaiters, semAwoken, expunged, allPools, runtime_registerPoolCleanup, runtime_SemacquireMutex, runtime_Semrelease, runtime_notifyListCheck, runtime_canSpin, runtime_nanotime, throw$1, poolCleanup, init, indexLocal, init$1, runtime_doSpin;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	race = $packages["internal/race"];
	runtime = $packages["runtime"];
	atomic = $packages["sync/atomic"];
	Pool = $pkg.Pool = $newType(0, $kindStruct, "sync.Pool", true, "sync", true, function(local_, localSize_, store_, New_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.local = 0;
			this.localSize = 0;
			this.store = sliceType$4.nil;
			this.New = $throwNilPointerError;
			return;
		}
		this.local = local_;
		this.localSize = localSize_;
		this.store = store_;
		this.New = New_;
	});
	Mutex = $pkg.Mutex = $newType(0, $kindStruct, "sync.Mutex", true, "sync", true, function(state_, sema_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.state = 0;
			this.sema = 0;
			return;
		}
		this.state = state_;
		this.sema = sema_;
	});
	Once = $pkg.Once = $newType(0, $kindStruct, "sync.Once", true, "sync", true, function(m_, done_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.m = new Mutex.ptr(0, 0);
			this.done = 0;
			return;
		}
		this.m = m_;
		this.done = done_;
	});
	poolLocalInternal = $pkg.poolLocalInternal = $newType(0, $kindStruct, "sync.poolLocalInternal", true, "sync", false, function(private$0_, shared_, Mutex_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.private$0 = $ifaceNil;
			this.shared = sliceType$4.nil;
			this.Mutex = new Mutex.ptr(0, 0);
			return;
		}
		this.private$0 = private$0_;
		this.shared = shared_;
		this.Mutex = Mutex_;
	});
	poolLocal = $pkg.poolLocal = $newType(0, $kindStruct, "sync.poolLocal", true, "sync", false, function(poolLocalInternal_, pad_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.poolLocalInternal = new poolLocalInternal.ptr($ifaceNil, sliceType$4.nil, new Mutex.ptr(0, 0));
			this.pad = arrayType$2.zero();
			return;
		}
		this.poolLocalInternal = poolLocalInternal_;
		this.pad = pad_;
	});
	notifyList = $pkg.notifyList = $newType(0, $kindStruct, "sync.notifyList", true, "sync", false, function(wait_, notify_, lock_, head_, tail_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.wait = 0;
			this.notify = 0;
			this.lock = 0;
			this.head = 0;
			this.tail = 0;
			return;
		}
		this.wait = wait_;
		this.notify = notify_;
		this.lock = lock_;
		this.head = head_;
		this.tail = tail_;
	});
	ptrType = $ptrType(Pool);
	sliceType = $sliceType(ptrType);
	ptrType$1 = $ptrType($Uint32);
	chanType = $chanType($Bool, false, false);
	sliceType$1 = $sliceType(chanType);
	ptrType$6 = $ptrType($Int32);
	ptrType$7 = $ptrType(poolLocal);
	sliceType$4 = $sliceType($emptyInterface);
	funcType = $funcType([], [$emptyInterface], false);
	ptrType$16 = $ptrType(Mutex);
	funcType$2 = $funcType([], [], false);
	ptrType$17 = $ptrType(Once);
	arrayType$2 = $arrayType($Uint8, 100);
	Pool.ptr.prototype.Get = function() {
		var _r, p, x, x$1, x$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; p = $f.p; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		/* */ if (p.store.$length === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (p.store.$length === 0) { */ case 1:
			/* */ if (!(p.New === $throwNilPointerError)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(p.New === $throwNilPointerError)) { */ case 3:
				_r = p.New(); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				$s = -1; return _r;
			/* } */ case 4:
			$s = -1; return $ifaceNil;
		/* } */ case 2:
		x$2 = (x = p.store, x$1 = p.store.$length - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + x$1]));
		p.store = $subslice(p.store, 0, (p.store.$length - 1 >> 0));
		$s = -1; return x$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Pool.ptr.prototype.Get }; } $f._r = _r; $f.p = p; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Pool.prototype.Get = function() { return this.$val.Get(); };
	Pool.ptr.prototype.Put = function(x) {
		var p, x;
		p = this;
		if ($interfaceIsEqual(x, $ifaceNil)) {
			return;
		}
		p.store = $append(p.store, x);
	};
	Pool.prototype.Put = function(x) { return this.$val.Put(x); };
	runtime_registerPoolCleanup = function(cleanup) {
		var cleanup;
	};
	runtime_SemacquireMutex = function(s, lifo) {
		var _entry, _entry$1, _entry$2, _entry$3, _entry$4, _key, _key$1, _key$2, _r, ch, lifo, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _entry = $f._entry; _entry$1 = $f._entry$1; _entry$2 = $f._entry$2; _entry$3 = $f._entry$3; _entry$4 = $f._entry$4; _key = $f._key; _key$1 = $f._key$1; _key$2 = $f._key$2; _r = $f._r; ch = $f.ch; lifo = $f.lifo; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ if (((s.$get() - (_entry = semAwoken[ptrType$1.keyFor(s)], _entry !== undefined ? _entry.v : 0) >>> 0)) === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (((s.$get() - (_entry = semAwoken[ptrType$1.keyFor(s)], _entry !== undefined ? _entry.v : 0) >>> 0)) === 0) { */ case 1:
			ch = new $Chan($Bool, 0);
			if (lifo) {
				_key = s; (semWaiters || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key)] = { k: _key, v: $appendSlice(new sliceType$1([ch]), (_entry$1 = semWaiters[ptrType$1.keyFor(s)], _entry$1 !== undefined ? _entry$1.v : sliceType$1.nil)) };
			} else {
				_key$1 = s; (semWaiters || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key$1)] = { k: _key$1, v: $append((_entry$2 = semWaiters[ptrType$1.keyFor(s)], _entry$2 !== undefined ? _entry$2.v : sliceType$1.nil), ch) };
			}
			_r = $recv(ch); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r[0];
			_key$2 = s; (semAwoken || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key$2)] = { k: _key$2, v: (_entry$3 = semAwoken[ptrType$1.keyFor(s)], _entry$3 !== undefined ? _entry$3.v : 0) - (1) >>> 0 };
			if ((_entry$4 = semAwoken[ptrType$1.keyFor(s)], _entry$4 !== undefined ? _entry$4.v : 0) === 0) {
				delete semAwoken[ptrType$1.keyFor(s)];
			}
		/* } */ case 2:
		s.$set(s.$get() - (1) >>> 0);
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: runtime_SemacquireMutex }; } $f._entry = _entry; $f._entry$1 = _entry$1; $f._entry$2 = _entry$2; $f._entry$3 = _entry$3; $f._entry$4 = _entry$4; $f._key = _key; $f._key$1 = _key$1; $f._key$2 = _key$2; $f._r = _r; $f.ch = ch; $f.lifo = lifo; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	runtime_Semrelease = function(s, handoff) {
		var _entry, _entry$1, _key, _key$1, ch, handoff, s, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _entry = $f._entry; _entry$1 = $f._entry$1; _key = $f._key; _key$1 = $f._key$1; ch = $f.ch; handoff = $f.handoff; s = $f.s; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s.$set(s.$get() + (1) >>> 0);
		w = (_entry = semWaiters[ptrType$1.keyFor(s)], _entry !== undefined ? _entry.v : sliceType$1.nil);
		if (w.$length === 0) {
			$s = -1; return;
		}
		ch = (0 >= w.$length ? ($throwRuntimeError("index out of range"), undefined) : w.$array[w.$offset + 0]);
		w = $subslice(w, 1);
		_key = s; (semWaiters || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key)] = { k: _key, v: w };
		if (w.$length === 0) {
			delete semWaiters[ptrType$1.keyFor(s)];
		}
		_key$1 = s; (semAwoken || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key$1)] = { k: _key$1, v: (_entry$1 = semAwoken[ptrType$1.keyFor(s)], _entry$1 !== undefined ? _entry$1.v : 0) + (1) >>> 0 };
		$r = $send(ch, true); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: runtime_Semrelease }; } $f._entry = _entry; $f._entry$1 = _entry$1; $f._key = _key; $f._key$1 = _key$1; $f.ch = ch; $f.handoff = handoff; $f.s = s; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	runtime_notifyListCheck = function(size) {
		var size;
	};
	runtime_canSpin = function(i) {
		var i;
		return false;
	};
	runtime_nanotime = function() {
		return $mul64($internalize(new ($global.Date)().getTime(), $Int64), new $Int64(0, 1000000));
	};
	throw$1 = function(s) {
		var s;
		$throwRuntimeError($externalize(s, $String));
	};
	Mutex.ptr.prototype.Lock = function() {
		var awoke, delta, iter, m, new$1, old, queueLifo, starving, waitStartTime, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; awoke = $f.awoke; delta = $f.delta; iter = $f.iter; m = $f.m; new$1 = $f.new$1; old = $f.old; queueLifo = $f.queueLifo; starving = $f.starving; waitStartTime = $f.waitStartTime; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), 0, 1)) {
			if (false) {
				race.Acquire((m));
			}
			$s = -1; return;
		}
		waitStartTime = new $Int64(0, 0);
		starving = false;
		awoke = false;
		iter = 0;
		old = m.state;
		/* while (true) { */ case 1:
			/* */ if (((old & 5) === 1) && runtime_canSpin(iter)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (((old & 5) === 1) && runtime_canSpin(iter)) { */ case 3:
				if (!awoke && ((old & 2) === 0) && !(((old >> 3 >> 0) === 0)) && atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, old | 2)) {
					awoke = true;
				}
				runtime_doSpin();
				iter = iter + (1) >> 0;
				old = m.state;
				/* continue; */ $s = 1; continue;
			/* } */ case 4:
			new$1 = old;
			if ((old & 4) === 0) {
				new$1 = new$1 | (1);
			}
			if (!(((old & 5) === 0))) {
				new$1 = new$1 + (8) >> 0;
			}
			if (starving && !(((old & 1) === 0))) {
				new$1 = new$1 | (4);
			}
			if (awoke) {
				if ((new$1 & 2) === 0) {
					throw$1("sync: inconsistent mutex state");
				}
				new$1 = (new$1 & ~(2)) >> 0;
			}
			/* */ if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { $s = 5; continue; }
			/* */ $s = 6; continue;
			/* if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { */ case 5:
				if ((old & 5) === 0) {
					/* break; */ $s = 2; continue;
				}
				queueLifo = !((waitStartTime.$high === 0 && waitStartTime.$low === 0));
				if ((waitStartTime.$high === 0 && waitStartTime.$low === 0)) {
					waitStartTime = runtime_nanotime();
				}
				$r = runtime_SemacquireMutex((m.$ptr_sema || (m.$ptr_sema = new ptrType$1(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m))), queueLifo); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				starving = starving || (x = (x$1 = runtime_nanotime(), new $Int64(x$1.$high - waitStartTime.$high, x$1.$low - waitStartTime.$low)), (x.$high > 0 || (x.$high === 0 && x.$low > 1000000)));
				old = m.state;
				if (!(((old & 4) === 0))) {
					if (!(((old & 3) === 0)) || ((old >> 3 >> 0) === 0)) {
						throw$1("sync: inconsistent mutex state");
					}
					delta = -7;
					if (!starving || ((old >> 3 >> 0) === 1)) {
						delta = delta - (4) >> 0;
					}
					atomic.AddInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), delta);
					/* break; */ $s = 2; continue;
				}
				awoke = true;
				iter = 0;
				$s = 7; continue;
			/* } else { */ case 6:
				old = m.state;
			/* } */ case 7:
		/* } */ $s = 1; continue; case 2:
		if (false) {
			race.Acquire((m));
		}
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Mutex.ptr.prototype.Lock }; } $f.awoke = awoke; $f.delta = delta; $f.iter = iter; $f.m = m; $f.new$1 = new$1; $f.old = old; $f.queueLifo = queueLifo; $f.starving = starving; $f.waitStartTime = waitStartTime; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Mutex.prototype.Lock = function() { return this.$val.Lock(); };
	Mutex.ptr.prototype.Unlock = function() {
		var m, new$1, old, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; m = $f.m; new$1 = $f.new$1; old = $f.old; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		if (false) {
			$unused(m.state);
			race.Release((m));
		}
		new$1 = atomic.AddInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), -1);
		if ((((new$1 + 1 >> 0)) & 1) === 0) {
			throw$1("sync: unlock of unlocked mutex");
		}
		/* */ if ((new$1 & 4) === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if ((new$1 & 4) === 0) { */ case 1:
			old = new$1;
			/* while (true) { */ case 4:
				if (((old >> 3 >> 0) === 0) || !(((old & 7) === 0))) {
					$s = -1; return;
				}
				new$1 = ((old - 8 >> 0)) | 2;
				/* */ if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { $s = 6; continue; }
				/* */ $s = 7; continue;
				/* if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { */ case 6:
					$r = runtime_Semrelease((m.$ptr_sema || (m.$ptr_sema = new ptrType$1(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m))), false); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$s = -1; return;
				/* } */ case 7:
				old = m.state;
			/* } */ $s = 4; continue; case 5:
			$s = 3; continue;
		/* } else { */ case 2:
			$r = runtime_Semrelease((m.$ptr_sema || (m.$ptr_sema = new ptrType$1(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m))), true); /* */ $s = 9; case 9: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Mutex.ptr.prototype.Unlock }; } $f.m = m; $f.new$1 = new$1; $f.old = old; $f.$s = $s; $f.$r = $r; return $f;
	};
	Mutex.prototype.Unlock = function() { return this.$val.Unlock(); };
	Once.ptr.prototype.Do = function(f) {
		var f, o, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; f = $f.f; o = $f.o; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		o = this;
		if (atomic.LoadUint32((o.$ptr_done || (o.$ptr_done = new ptrType$1(function() { return this.$target.done; }, function($v) { this.$target.done = $v; }, o)))) === 1) {
			$s = -1; return;
		}
		$r = o.m.Lock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$deferred.push([$methodVal(o.m, "Unlock"), []]);
		/* */ if (o.done === 0) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (o.done === 0) { */ case 2:
			$deferred.push([atomic.StoreUint32, [(o.$ptr_done || (o.$ptr_done = new ptrType$1(function() { return this.$target.done; }, function($v) { this.$target.done = $v; }, o))), 1]]);
			$r = f(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		$s = -1; return;
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: Once.ptr.prototype.Do }; } $f.f = f; $f.o = o; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	Once.prototype.Do = function(f) { return this.$val.Do(f); };
	poolCleanup = function() {
		var _i, _i$1, _ref, _ref$1, i, i$1, j, l, p, x;
		_ref = allPools;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			p = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			((i < 0 || i >= allPools.$length) ? ($throwRuntimeError("index out of range"), undefined) : allPools.$array[allPools.$offset + i] = ptrType.nil);
			i$1 = 0;
			while (true) {
				if (!(i$1 < ((p.localSize >> 0)))) { break; }
				l = indexLocal(p.local, i$1);
				l.poolLocalInternal.private$0 = $ifaceNil;
				_ref$1 = l.poolLocalInternal.shared;
				_i$1 = 0;
				while (true) {
					if (!(_i$1 < _ref$1.$length)) { break; }
					j = _i$1;
					(x = l.poolLocalInternal.shared, ((j < 0 || j >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + j] = $ifaceNil));
					_i$1++;
				}
				l.poolLocalInternal.shared = sliceType$4.nil;
				i$1 = i$1 + (1) >> 0;
			}
			p.local = 0;
			p.localSize = 0;
			_i++;
		}
		allPools = new sliceType([]);
	};
	init = function() {
		runtime_registerPoolCleanup(poolCleanup);
	};
	indexLocal = function(l, i) {
		var i, l, lp;
		lp = (((l) + ($imul(((i >>> 0)), 128) >>> 0) >>> 0));
		return ($pointerOfStructConversion(lp, ptrType$7));
	};
	init$1 = function() {
		var n;
		n = new notifyList.ptr(0, 0, 0, 0, 0);
		runtime_notifyListCheck(20);
	};
	runtime_doSpin = function() {
		$throwRuntimeError("native function not implemented: sync.runtime_doSpin");
	};
	ptrType.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "Put", name: "Put", pkg: "", typ: $funcType([$emptyInterface], [], false)}, {prop: "getSlow", name: "getSlow", pkg: "sync", typ: $funcType([], [$emptyInterface], false)}, {prop: "pin", name: "pin", pkg: "sync", typ: $funcType([], [ptrType$7], false)}, {prop: "pinSlow", name: "pinSlow", pkg: "sync", typ: $funcType([], [ptrType$7], false)}];
	ptrType$16.methods = [{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}];
	ptrType$17.methods = [{prop: "Do", name: "Do", pkg: "", typ: $funcType([funcType$2], [], false)}];
	Pool.init("sync", [{prop: "local", name: "local", embedded: false, exported: false, typ: $UnsafePointer, tag: ""}, {prop: "localSize", name: "localSize", embedded: false, exported: false, typ: $Uintptr, tag: ""}, {prop: "store", name: "store", embedded: false, exported: false, typ: sliceType$4, tag: ""}, {prop: "New", name: "New", embedded: false, exported: true, typ: funcType, tag: ""}]);
	Mutex.init("sync", [{prop: "state", name: "state", embedded: false, exported: false, typ: $Int32, tag: ""}, {prop: "sema", name: "sema", embedded: false, exported: false, typ: $Uint32, tag: ""}]);
	Once.init("sync", [{prop: "m", name: "m", embedded: false, exported: false, typ: Mutex, tag: ""}, {prop: "done", name: "done", embedded: false, exported: false, typ: $Uint32, tag: ""}]);
	poolLocalInternal.init("sync", [{prop: "private$0", name: "private", embedded: false, exported: false, typ: $emptyInterface, tag: ""}, {prop: "shared", name: "shared", embedded: false, exported: false, typ: sliceType$4, tag: ""}, {prop: "Mutex", name: "Mutex", embedded: true, exported: true, typ: Mutex, tag: ""}]);
	poolLocal.init("sync", [{prop: "poolLocalInternal", name: "poolLocalInternal", embedded: true, exported: false, typ: poolLocalInternal, tag: ""}, {prop: "pad", name: "pad", embedded: false, exported: false, typ: arrayType$2, tag: ""}]);
	notifyList.init("sync", [{prop: "wait", name: "wait", embedded: false, exported: false, typ: $Uint32, tag: ""}, {prop: "notify", name: "notify", embedded: false, exported: false, typ: $Uint32, tag: ""}, {prop: "lock", name: "lock", embedded: false, exported: false, typ: $Uintptr, tag: ""}, {prop: "head", name: "head", embedded: false, exported: false, typ: $UnsafePointer, tag: ""}, {prop: "tail", name: "tail", embedded: false, exported: false, typ: $UnsafePointer, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = race.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = atomic.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		allPools = sliceType.nil;
		semWaiters = {};
		semAwoken = {};
		expunged = (new Uint8Array(8));
		init();
		init$1();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["io"] = (function() {
	var $pkg = {}, $init, errors, sync, atomic, Writer, StringWriter, sliceType, errWhence, errOffset;
	errors = $packages["errors"];
	sync = $packages["sync"];
	atomic = $packages["sync/atomic"];
	Writer = $pkg.Writer = $newType(8, $kindInterface, "io.Writer", true, "io", true, null);
	StringWriter = $pkg.StringWriter = $newType(8, $kindInterface, "io.StringWriter", true, "io", true, null);
	sliceType = $sliceType($Uint8);
	Writer.init([{prop: "Write", name: "Write", pkg: "", typ: $funcType([sliceType], [$Int, $error], false)}]);
	StringWriter.init([{prop: "WriteString", name: "WriteString", pkg: "", typ: $funcType([$String], [$Int, $error], false)}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = atomic.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrShortWrite = errors.New("short write");
		$pkg.ErrShortBuffer = errors.New("short buffer");
		$pkg.EOF = errors.New("EOF");
		$pkg.ErrUnexpectedEOF = errors.New("unexpected EOF");
		$pkg.ErrNoProgress = errors.New("multiple Read calls return no data or error");
		errWhence = errors.New("Seek: invalid whence");
		errOffset = errors.New("Seek: invalid offset");
		$pkg.ErrClosedPipe = errors.New("io: read/write on closed pipe");
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["unicode"] = (function() {
	var $pkg = {}, $init, RangeTable, Range16, Range32, CaseRange, d, arrayType, sliceType, sliceType$1, sliceType$3, _White_Space, _CaseRanges, to, IsSpace, is16, is32, isExcludingLatin, To, ToLower;
	RangeTable = $pkg.RangeTable = $newType(0, $kindStruct, "unicode.RangeTable", true, "unicode", true, function(R16_, R32_, LatinOffset_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.R16 = sliceType.nil;
			this.R32 = sliceType$1.nil;
			this.LatinOffset = 0;
			return;
		}
		this.R16 = R16_;
		this.R32 = R32_;
		this.LatinOffset = LatinOffset_;
	});
	Range16 = $pkg.Range16 = $newType(0, $kindStruct, "unicode.Range16", true, "unicode", true, function(Lo_, Hi_, Stride_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Lo = 0;
			this.Hi = 0;
			this.Stride = 0;
			return;
		}
		this.Lo = Lo_;
		this.Hi = Hi_;
		this.Stride = Stride_;
	});
	Range32 = $pkg.Range32 = $newType(0, $kindStruct, "unicode.Range32", true, "unicode", true, function(Lo_, Hi_, Stride_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Lo = 0;
			this.Hi = 0;
			this.Stride = 0;
			return;
		}
		this.Lo = Lo_;
		this.Hi = Hi_;
		this.Stride = Stride_;
	});
	CaseRange = $pkg.CaseRange = $newType(0, $kindStruct, "unicode.CaseRange", true, "unicode", true, function(Lo_, Hi_, Delta_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Lo = 0;
			this.Hi = 0;
			this.Delta = arrayType.zero();
			return;
		}
		this.Lo = Lo_;
		this.Hi = Hi_;
		this.Delta = Delta_;
	});
	d = $pkg.d = $newType(12, $kindArray, "unicode.d", true, "unicode", false, null);
	arrayType = $arrayType($Int32, 3);
	sliceType = $sliceType(Range16);
	sliceType$1 = $sliceType(Range32);
	sliceType$3 = $sliceType(CaseRange);
	to = function(_case, r, caseRange) {
		var _case, _q, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, caseRange, cr, delta, foundMapping, hi, lo, m, mappedRune, r, x;
		mappedRune = 0;
		foundMapping = false;
		if (_case < 0 || 3 <= _case) {
			_tmp = 65533;
			_tmp$1 = false;
			mappedRune = _tmp;
			foundMapping = _tmp$1;
			return [mappedRune, foundMapping];
		}
		lo = 0;
		hi = caseRange.$length;
		while (true) {
			if (!(lo < hi)) { break; }
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			cr = ((m < 0 || m >= caseRange.$length) ? ($throwRuntimeError("index out of range"), undefined) : caseRange.$array[caseRange.$offset + m]);
			if (((cr.Lo >> 0)) <= r && r <= ((cr.Hi >> 0))) {
				delta = ((x = cr.Delta, ((_case < 0 || _case >= x.length) ? ($throwRuntimeError("index out of range"), undefined) : x[_case])));
				if (delta > 1114111) {
					_tmp$2 = ((cr.Lo >> 0)) + ((((((r - ((cr.Lo >> 0)) >> 0)) & ~1) >> 0) | (((_case & 1) >> 0)))) >> 0;
					_tmp$3 = true;
					mappedRune = _tmp$2;
					foundMapping = _tmp$3;
					return [mappedRune, foundMapping];
				}
				_tmp$4 = r + delta >> 0;
				_tmp$5 = true;
				mappedRune = _tmp$4;
				foundMapping = _tmp$5;
				return [mappedRune, foundMapping];
			}
			if (r < ((cr.Lo >> 0))) {
				hi = m;
			} else {
				lo = m + 1 >> 0;
			}
		}
		_tmp$6 = r;
		_tmp$7 = false;
		mappedRune = _tmp$6;
		foundMapping = _tmp$7;
		return [mappedRune, foundMapping];
	};
	IsSpace = function(r) {
		var _1, r;
		if (((r >>> 0)) <= 255) {
			_1 = r;
			if ((_1 === (9)) || (_1 === (10)) || (_1 === (11)) || (_1 === (12)) || (_1 === (13)) || (_1 === (32)) || (_1 === (133)) || (_1 === (160))) {
				return true;
			}
			return false;
		}
		return isExcludingLatin($pkg.White_Space, r);
	};
	$pkg.IsSpace = IsSpace;
	is16 = function(ranges, r) {
		var _i, _q, _r, _r$1, _ref, hi, i, lo, m, r, range_, range_$1, ranges;
		if (ranges.$length <= 18 || r <= 255) {
			_ref = ranges;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				i = _i;
				range_ = ((i < 0 || i >= ranges.$length) ? ($throwRuntimeError("index out of range"), undefined) : ranges.$array[ranges.$offset + i]);
				if (r < range_.Lo) {
					return false;
				}
				if (r <= range_.Hi) {
					return (range_.Stride === 1) || ((_r = ((r - range_.Lo << 16 >>> 16)) % range_.Stride, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) === 0);
				}
				_i++;
			}
			return false;
		}
		lo = 0;
		hi = ranges.$length;
		while (true) {
			if (!(lo < hi)) { break; }
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			range_$1 = ((m < 0 || m >= ranges.$length) ? ($throwRuntimeError("index out of range"), undefined) : ranges.$array[ranges.$offset + m]);
			if (range_$1.Lo <= r && r <= range_$1.Hi) {
				return (range_$1.Stride === 1) || ((_r$1 = ((r - range_$1.Lo << 16 >>> 16)) % range_$1.Stride, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) === 0);
			}
			if (r < range_$1.Lo) {
				hi = m;
			} else {
				lo = m + 1 >> 0;
			}
		}
		return false;
	};
	is32 = function(ranges, r) {
		var _i, _q, _r, _r$1, _ref, hi, i, lo, m, r, range_, range_$1, ranges;
		if (ranges.$length <= 18) {
			_ref = ranges;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				i = _i;
				range_ = ((i < 0 || i >= ranges.$length) ? ($throwRuntimeError("index out of range"), undefined) : ranges.$array[ranges.$offset + i]);
				if (r < range_.Lo) {
					return false;
				}
				if (r <= range_.Hi) {
					return (range_.Stride === 1) || ((_r = ((r - range_.Lo >>> 0)) % range_.Stride, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) === 0);
				}
				_i++;
			}
			return false;
		}
		lo = 0;
		hi = ranges.$length;
		while (true) {
			if (!(lo < hi)) { break; }
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			range_$1 = $clone(((m < 0 || m >= ranges.$length) ? ($throwRuntimeError("index out of range"), undefined) : ranges.$array[ranges.$offset + m]), Range32);
			if (range_$1.Lo <= r && r <= range_$1.Hi) {
				return (range_$1.Stride === 1) || ((_r$1 = ((r - range_$1.Lo >>> 0)) % range_$1.Stride, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) === 0);
			}
			if (r < range_$1.Lo) {
				hi = m;
			} else {
				lo = m + 1 >> 0;
			}
		}
		return false;
	};
	isExcludingLatin = function(rangeTab, r) {
		var off, r, r16, r32, rangeTab, x;
		r16 = rangeTab.R16;
		off = rangeTab.LatinOffset;
		if (r16.$length > off && r <= (((x = r16.$length - 1 >> 0, ((x < 0 || x >= r16.$length) ? ($throwRuntimeError("index out of range"), undefined) : r16.$array[r16.$offset + x])).Hi >> 0))) {
			return is16($subslice(r16, off), ((r << 16 >>> 16)));
		}
		r32 = rangeTab.R32;
		if (r32.$length > 0 && r >= (((0 >= r32.$length ? ($throwRuntimeError("index out of range"), undefined) : r32.$array[r32.$offset + 0]).Lo >> 0))) {
			return is32(r32, ((r >>> 0)));
		}
		return false;
	};
	To = function(_case, r) {
		var _case, _tuple, r;
		_tuple = to(_case, r, $pkg.CaseRanges);
		r = _tuple[0];
		return r;
	};
	$pkg.To = To;
	ToLower = function(r) {
		var r;
		if (r <= 127) {
			if (65 <= r && r <= 90) {
				r = r + (32) >> 0;
			}
			return r;
		}
		return To(1, r);
	};
	$pkg.ToLower = ToLower;
	RangeTable.init("", [{prop: "R16", name: "R16", embedded: false, exported: true, typ: sliceType, tag: ""}, {prop: "R32", name: "R32", embedded: false, exported: true, typ: sliceType$1, tag: ""}, {prop: "LatinOffset", name: "LatinOffset", embedded: false, exported: true, typ: $Int, tag: ""}]);
	Range16.init("", [{prop: "Lo", name: "Lo", embedded: false, exported: true, typ: $Uint16, tag: ""}, {prop: "Hi", name: "Hi", embedded: false, exported: true, typ: $Uint16, tag: ""}, {prop: "Stride", name: "Stride", embedded: false, exported: true, typ: $Uint16, tag: ""}]);
	Range32.init("", [{prop: "Lo", name: "Lo", embedded: false, exported: true, typ: $Uint32, tag: ""}, {prop: "Hi", name: "Hi", embedded: false, exported: true, typ: $Uint32, tag: ""}, {prop: "Stride", name: "Stride", embedded: false, exported: true, typ: $Uint32, tag: ""}]);
	CaseRange.init("", [{prop: "Lo", name: "Lo", embedded: false, exported: true, typ: $Uint32, tag: ""}, {prop: "Hi", name: "Hi", embedded: false, exported: true, typ: $Uint32, tag: ""}, {prop: "Delta", name: "Delta", embedded: false, exported: true, typ: d, tag: ""}]);
	d.init($Int32, 3);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_White_Space = new RangeTable.ptr(new sliceType([new Range16.ptr(9, 13, 1), new Range16.ptr(32, 32, 1), new Range16.ptr(133, 133, 1), new Range16.ptr(160, 160, 1), new Range16.ptr(5760, 5760, 1), new Range16.ptr(8192, 8202, 1), new Range16.ptr(8232, 8233, 1), new Range16.ptr(8239, 8239, 1), new Range16.ptr(8287, 8287, 1), new Range16.ptr(12288, 12288, 1)]), sliceType$1.nil, 4);
		$pkg.White_Space = _White_Space;
		_CaseRanges = new sliceType$3([new CaseRange.ptr(65, 90, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(97, 122, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(181, 181, $toNativeArray($kindInt32, [743, 0, 743])), new CaseRange.ptr(192, 214, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(216, 222, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(224, 246, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(248, 254, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(255, 255, $toNativeArray($kindInt32, [121, 0, 121])), new CaseRange.ptr(256, 303, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(304, 304, $toNativeArray($kindInt32, [0, -199, 0])), new CaseRange.ptr(305, 305, $toNativeArray($kindInt32, [-232, 0, -232])), new CaseRange.ptr(306, 311, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(313, 328, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(330, 375, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(376, 376, $toNativeArray($kindInt32, [0, -121, 0])), new CaseRange.ptr(377, 382, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(383, 383, $toNativeArray($kindInt32, [-300, 0, -300])), new CaseRange.ptr(384, 384, $toNativeArray($kindInt32, [195, 0, 195])), new CaseRange.ptr(385, 385, $toNativeArray($kindInt32, [0, 210, 0])), new CaseRange.ptr(386, 389, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(390, 390, $toNativeArray($kindInt32, [0, 206, 0])), new CaseRange.ptr(391, 392, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(393, 394, $toNativeArray($kindInt32, [0, 205, 0])), new CaseRange.ptr(395, 396, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(398, 398, $toNativeArray($kindInt32, [0, 79, 0])), new CaseRange.ptr(399, 399, $toNativeArray($kindInt32, [0, 202, 0])), new CaseRange.ptr(400, 400, $toNativeArray($kindInt32, [0, 203, 0])), new CaseRange.ptr(401, 402, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(403, 403, $toNativeArray($kindInt32, [0, 205, 0])), new CaseRange.ptr(404, 404, $toNativeArray($kindInt32, [0, 207, 0])), new CaseRange.ptr(405, 405, $toNativeArray($kindInt32, [97, 0, 97])), new CaseRange.ptr(406, 406, $toNativeArray($kindInt32, [0, 211, 0])), new CaseRange.ptr(407, 407, $toNativeArray($kindInt32, [0, 209, 0])), new CaseRange.ptr(408, 409, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(410, 410, $toNativeArray($kindInt32, [163, 0, 163])), new CaseRange.ptr(412, 412, $toNativeArray($kindInt32, [0, 211, 0])), new CaseRange.ptr(413, 413, $toNativeArray($kindInt32, [0, 213, 0])), new CaseRange.ptr(414, 414, $toNativeArray($kindInt32, [130, 0, 130])), new CaseRange.ptr(415, 415, $toNativeArray($kindInt32, [0, 214, 0])), new CaseRange.ptr(416, 421, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(422, 422, $toNativeArray($kindInt32, [0, 218, 0])), new CaseRange.ptr(423, 424, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(425, 425, $toNativeArray($kindInt32, [0, 218, 0])), new CaseRange.ptr(428, 429, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(430, 430, $toNativeArray($kindInt32, [0, 218, 0])), new CaseRange.ptr(431, 432, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(433, 434, $toNativeArray($kindInt32, [0, 217, 0])), new CaseRange.ptr(435, 438, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(439, 439, $toNativeArray($kindInt32, [0, 219, 0])), new CaseRange.ptr(440, 441, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(444, 445, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(447, 447, $toNativeArray($kindInt32, [56, 0, 56])), new CaseRange.ptr(452, 452, $toNativeArray($kindInt32, [0, 2, 1])), new CaseRange.ptr(453, 453, $toNativeArray($kindInt32, [-1, 1, 0])), new CaseRange.ptr(454, 454, $toNativeArray($kindInt32, [-2, 0, -1])), new CaseRange.ptr(455, 455, $toNativeArray($kindInt32, [0, 2, 1])), new CaseRange.ptr(456, 456, $toNativeArray($kindInt32, [-1, 1, 0])), new CaseRange.ptr(457, 457, $toNativeArray($kindInt32, [-2, 0, -1])), new CaseRange.ptr(458, 458, $toNativeArray($kindInt32, [0, 2, 1])), new CaseRange.ptr(459, 459, $toNativeArray($kindInt32, [-1, 1, 0])), new CaseRange.ptr(460, 460, $toNativeArray($kindInt32, [-2, 0, -1])), new CaseRange.ptr(461, 476, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(477, 477, $toNativeArray($kindInt32, [-79, 0, -79])), new CaseRange.ptr(478, 495, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(497, 497, $toNativeArray($kindInt32, [0, 2, 1])), new CaseRange.ptr(498, 498, $toNativeArray($kindInt32, [-1, 1, 0])), new CaseRange.ptr(499, 499, $toNativeArray($kindInt32, [-2, 0, -1])), new CaseRange.ptr(500, 501, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(502, 502, $toNativeArray($kindInt32, [0, -97, 0])), new CaseRange.ptr(503, 503, $toNativeArray($kindInt32, [0, -56, 0])), new CaseRange.ptr(504, 543, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(544, 544, $toNativeArray($kindInt32, [0, -130, 0])), new CaseRange.ptr(546, 563, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(570, 570, $toNativeArray($kindInt32, [0, 10795, 0])), new CaseRange.ptr(571, 572, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(573, 573, $toNativeArray($kindInt32, [0, -163, 0])), new CaseRange.ptr(574, 574, $toNativeArray($kindInt32, [0, 10792, 0])), new CaseRange.ptr(575, 576, $toNativeArray($kindInt32, [10815, 0, 10815])), new CaseRange.ptr(577, 578, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(579, 579, $toNativeArray($kindInt32, [0, -195, 0])), new CaseRange.ptr(580, 580, $toNativeArray($kindInt32, [0, 69, 0])), new CaseRange.ptr(581, 581, $toNativeArray($kindInt32, [0, 71, 0])), new CaseRange.ptr(582, 591, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(592, 592, $toNativeArray($kindInt32, [10783, 0, 10783])), new CaseRange.ptr(593, 593, $toNativeArray($kindInt32, [10780, 0, 10780])), new CaseRange.ptr(594, 594, $toNativeArray($kindInt32, [10782, 0, 10782])), new CaseRange.ptr(595, 595, $toNativeArray($kindInt32, [-210, 0, -210])), new CaseRange.ptr(596, 596, $toNativeArray($kindInt32, [-206, 0, -206])), new CaseRange.ptr(598, 599, $toNativeArray($kindInt32, [-205, 0, -205])), new CaseRange.ptr(601, 601, $toNativeArray($kindInt32, [-202, 0, -202])), new CaseRange.ptr(603, 603, $toNativeArray($kindInt32, [-203, 0, -203])), new CaseRange.ptr(604, 604, $toNativeArray($kindInt32, [42319, 0, 42319])), new CaseRange.ptr(608, 608, $toNativeArray($kindInt32, [-205, 0, -205])), new CaseRange.ptr(609, 609, $toNativeArray($kindInt32, [42315, 0, 42315])), new CaseRange.ptr(611, 611, $toNativeArray($kindInt32, [-207, 0, -207])), new CaseRange.ptr(613, 613, $toNativeArray($kindInt32, [42280, 0, 42280])), new CaseRange.ptr(614, 614, $toNativeArray($kindInt32, [42308, 0, 42308])), new CaseRange.ptr(616, 616, $toNativeArray($kindInt32, [-209, 0, -209])), new CaseRange.ptr(617, 617, $toNativeArray($kindInt32, [-211, 0, -211])), new CaseRange.ptr(618, 618, $toNativeArray($kindInt32, [42308, 0, 42308])), new CaseRange.ptr(619, 619, $toNativeArray($kindInt32, [10743, 0, 10743])), new CaseRange.ptr(620, 620, $toNativeArray($kindInt32, [42305, 0, 42305])), new CaseRange.ptr(623, 623, $toNativeArray($kindInt32, [-211, 0, -211])), new CaseRange.ptr(625, 625, $toNativeArray($kindInt32, [10749, 0, 10749])), new CaseRange.ptr(626, 626, $toNativeArray($kindInt32, [-213, 0, -213])), new CaseRange.ptr(629, 629, $toNativeArray($kindInt32, [-214, 0, -214])), new CaseRange.ptr(637, 637, $toNativeArray($kindInt32, [10727, 0, 10727])), new CaseRange.ptr(640, 640, $toNativeArray($kindInt32, [-218, 0, -218])), new CaseRange.ptr(643, 643, $toNativeArray($kindInt32, [-218, 0, -218])), new CaseRange.ptr(647, 647, $toNativeArray($kindInt32, [42282, 0, 42282])), new CaseRange.ptr(648, 648, $toNativeArray($kindInt32, [-218, 0, -218])), new CaseRange.ptr(649, 649, $toNativeArray($kindInt32, [-69, 0, -69])), new CaseRange.ptr(650, 651, $toNativeArray($kindInt32, [-217, 0, -217])), new CaseRange.ptr(652, 652, $toNativeArray($kindInt32, [-71, 0, -71])), new CaseRange.ptr(658, 658, $toNativeArray($kindInt32, [-219, 0, -219])), new CaseRange.ptr(669, 669, $toNativeArray($kindInt32, [42261, 0, 42261])), new CaseRange.ptr(670, 670, $toNativeArray($kindInt32, [42258, 0, 42258])), new CaseRange.ptr(837, 837, $toNativeArray($kindInt32, [84, 0, 84])), new CaseRange.ptr(880, 883, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(886, 887, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(891, 893, $toNativeArray($kindInt32, [130, 0, 130])), new CaseRange.ptr(895, 895, $toNativeArray($kindInt32, [0, 116, 0])), new CaseRange.ptr(902, 902, $toNativeArray($kindInt32, [0, 38, 0])), new CaseRange.ptr(904, 906, $toNativeArray($kindInt32, [0, 37, 0])), new CaseRange.ptr(908, 908, $toNativeArray($kindInt32, [0, 64, 0])), new CaseRange.ptr(910, 911, $toNativeArray($kindInt32, [0, 63, 0])), new CaseRange.ptr(913, 929, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(931, 939, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(940, 940, $toNativeArray($kindInt32, [-38, 0, -38])), new CaseRange.ptr(941, 943, $toNativeArray($kindInt32, [-37, 0, -37])), new CaseRange.ptr(945, 961, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(962, 962, $toNativeArray($kindInt32, [-31, 0, -31])), new CaseRange.ptr(963, 971, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(972, 972, $toNativeArray($kindInt32, [-64, 0, -64])), new CaseRange.ptr(973, 974, $toNativeArray($kindInt32, [-63, 0, -63])), new CaseRange.ptr(975, 975, $toNativeArray($kindInt32, [0, 8, 0])), new CaseRange.ptr(976, 976, $toNativeArray($kindInt32, [-62, 0, -62])), new CaseRange.ptr(977, 977, $toNativeArray($kindInt32, [-57, 0, -57])), new CaseRange.ptr(981, 981, $toNativeArray($kindInt32, [-47, 0, -47])), new CaseRange.ptr(982, 982, $toNativeArray($kindInt32, [-54, 0, -54])), new CaseRange.ptr(983, 983, $toNativeArray($kindInt32, [-8, 0, -8])), new CaseRange.ptr(984, 1007, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1008, 1008, $toNativeArray($kindInt32, [-86, 0, -86])), new CaseRange.ptr(1009, 1009, $toNativeArray($kindInt32, [-80, 0, -80])), new CaseRange.ptr(1010, 1010, $toNativeArray($kindInt32, [7, 0, 7])), new CaseRange.ptr(1011, 1011, $toNativeArray($kindInt32, [-116, 0, -116])), new CaseRange.ptr(1012, 1012, $toNativeArray($kindInt32, [0, -60, 0])), new CaseRange.ptr(1013, 1013, $toNativeArray($kindInt32, [-96, 0, -96])), new CaseRange.ptr(1015, 1016, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1017, 1017, $toNativeArray($kindInt32, [0, -7, 0])), new CaseRange.ptr(1018, 1019, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1021, 1023, $toNativeArray($kindInt32, [0, -130, 0])), new CaseRange.ptr(1024, 1039, $toNativeArray($kindInt32, [0, 80, 0])), new CaseRange.ptr(1040, 1071, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(1072, 1103, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(1104, 1119, $toNativeArray($kindInt32, [-80, 0, -80])), new CaseRange.ptr(1120, 1153, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1162, 1215, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1216, 1216, $toNativeArray($kindInt32, [0, 15, 0])), new CaseRange.ptr(1217, 1230, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1231, 1231, $toNativeArray($kindInt32, [-15, 0, -15])), new CaseRange.ptr(1232, 1327, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1329, 1366, $toNativeArray($kindInt32, [0, 48, 0])), new CaseRange.ptr(1377, 1414, $toNativeArray($kindInt32, [-48, 0, -48])), new CaseRange.ptr(4256, 4293, $toNativeArray($kindInt32, [0, 7264, 0])), new CaseRange.ptr(4295, 4295, $toNativeArray($kindInt32, [0, 7264, 0])), new CaseRange.ptr(4301, 4301, $toNativeArray($kindInt32, [0, 7264, 0])), new CaseRange.ptr(5024, 5103, $toNativeArray($kindInt32, [0, 38864, 0])), new CaseRange.ptr(5104, 5109, $toNativeArray($kindInt32, [0, 8, 0])), new CaseRange.ptr(5112, 5117, $toNativeArray($kindInt32, [-8, 0, -8])), new CaseRange.ptr(7296, 7296, $toNativeArray($kindInt32, [-6254, 0, -6254])), new CaseRange.ptr(7297, 7297, $toNativeArray($kindInt32, [-6253, 0, -6253])), new CaseRange.ptr(7298, 7298, $toNativeArray($kindInt32, [-6244, 0, -6244])), new CaseRange.ptr(7299, 7300, $toNativeArray($kindInt32, [-6242, 0, -6242])), new CaseRange.ptr(7301, 7301, $toNativeArray($kindInt32, [-6243, 0, -6243])), new CaseRange.ptr(7302, 7302, $toNativeArray($kindInt32, [-6236, 0, -6236])), new CaseRange.ptr(7303, 7303, $toNativeArray($kindInt32, [-6181, 0, -6181])), new CaseRange.ptr(7304, 7304, $toNativeArray($kindInt32, [35266, 0, 35266])), new CaseRange.ptr(7545, 7545, $toNativeArray($kindInt32, [35332, 0, 35332])), new CaseRange.ptr(7549, 7549, $toNativeArray($kindInt32, [3814, 0, 3814])), new CaseRange.ptr(7680, 7829, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(7835, 7835, $toNativeArray($kindInt32, [-59, 0, -59])), new CaseRange.ptr(7838, 7838, $toNativeArray($kindInt32, [0, -7615, 0])), new CaseRange.ptr(7840, 7935, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(7936, 7943, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(7944, 7951, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(7952, 7957, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(7960, 7965, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(7968, 7975, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(7976, 7983, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(7984, 7991, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(7992, 7999, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8000, 8005, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8008, 8013, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8017, 8017, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8019, 8019, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8021, 8021, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8023, 8023, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8025, 8025, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8027, 8027, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8029, 8029, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8031, 8031, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8032, 8039, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8040, 8047, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8048, 8049, $toNativeArray($kindInt32, [74, 0, 74])), new CaseRange.ptr(8050, 8053, $toNativeArray($kindInt32, [86, 0, 86])), new CaseRange.ptr(8054, 8055, $toNativeArray($kindInt32, [100, 0, 100])), new CaseRange.ptr(8056, 8057, $toNativeArray($kindInt32, [128, 0, 128])), new CaseRange.ptr(8058, 8059, $toNativeArray($kindInt32, [112, 0, 112])), new CaseRange.ptr(8060, 8061, $toNativeArray($kindInt32, [126, 0, 126])), new CaseRange.ptr(8064, 8071, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8072, 8079, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8080, 8087, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8088, 8095, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8096, 8103, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8104, 8111, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8112, 8113, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8115, 8115, $toNativeArray($kindInt32, [9, 0, 9])), new CaseRange.ptr(8120, 8121, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8122, 8123, $toNativeArray($kindInt32, [0, -74, 0])), new CaseRange.ptr(8124, 8124, $toNativeArray($kindInt32, [0, -9, 0])), new CaseRange.ptr(8126, 8126, $toNativeArray($kindInt32, [-7205, 0, -7205])), new CaseRange.ptr(8131, 8131, $toNativeArray($kindInt32, [9, 0, 9])), new CaseRange.ptr(8136, 8139, $toNativeArray($kindInt32, [0, -86, 0])), new CaseRange.ptr(8140, 8140, $toNativeArray($kindInt32, [0, -9, 0])), new CaseRange.ptr(8144, 8145, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8152, 8153, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8154, 8155, $toNativeArray($kindInt32, [0, -100, 0])), new CaseRange.ptr(8160, 8161, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8165, 8165, $toNativeArray($kindInt32, [7, 0, 7])), new CaseRange.ptr(8168, 8169, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8170, 8171, $toNativeArray($kindInt32, [0, -112, 0])), new CaseRange.ptr(8172, 8172, $toNativeArray($kindInt32, [0, -7, 0])), new CaseRange.ptr(8179, 8179, $toNativeArray($kindInt32, [9, 0, 9])), new CaseRange.ptr(8184, 8185, $toNativeArray($kindInt32, [0, -128, 0])), new CaseRange.ptr(8186, 8187, $toNativeArray($kindInt32, [0, -126, 0])), new CaseRange.ptr(8188, 8188, $toNativeArray($kindInt32, [0, -9, 0])), new CaseRange.ptr(8486, 8486, $toNativeArray($kindInt32, [0, -7517, 0])), new CaseRange.ptr(8490, 8490, $toNativeArray($kindInt32, [0, -8383, 0])), new CaseRange.ptr(8491, 8491, $toNativeArray($kindInt32, [0, -8262, 0])), new CaseRange.ptr(8498, 8498, $toNativeArray($kindInt32, [0, 28, 0])), new CaseRange.ptr(8526, 8526, $toNativeArray($kindInt32, [-28, 0, -28])), new CaseRange.ptr(8544, 8559, $toNativeArray($kindInt32, [0, 16, 0])), new CaseRange.ptr(8560, 8575, $toNativeArray($kindInt32, [-16, 0, -16])), new CaseRange.ptr(8579, 8580, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(9398, 9423, $toNativeArray($kindInt32, [0, 26, 0])), new CaseRange.ptr(9424, 9449, $toNativeArray($kindInt32, [-26, 0, -26])), new CaseRange.ptr(11264, 11310, $toNativeArray($kindInt32, [0, 48, 0])), new CaseRange.ptr(11312, 11358, $toNativeArray($kindInt32, [-48, 0, -48])), new CaseRange.ptr(11360, 11361, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11362, 11362, $toNativeArray($kindInt32, [0, -10743, 0])), new CaseRange.ptr(11363, 11363, $toNativeArray($kindInt32, [0, -3814, 0])), new CaseRange.ptr(11364, 11364, $toNativeArray($kindInt32, [0, -10727, 0])), new CaseRange.ptr(11365, 11365, $toNativeArray($kindInt32, [-10795, 0, -10795])), new CaseRange.ptr(11366, 11366, $toNativeArray($kindInt32, [-10792, 0, -10792])), new CaseRange.ptr(11367, 11372, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11373, 11373, $toNativeArray($kindInt32, [0, -10780, 0])), new CaseRange.ptr(11374, 11374, $toNativeArray($kindInt32, [0, -10749, 0])), new CaseRange.ptr(11375, 11375, $toNativeArray($kindInt32, [0, -10783, 0])), new CaseRange.ptr(11376, 11376, $toNativeArray($kindInt32, [0, -10782, 0])), new CaseRange.ptr(11378, 11379, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11381, 11382, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11390, 11391, $toNativeArray($kindInt32, [0, -10815, 0])), new CaseRange.ptr(11392, 11491, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11499, 11502, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11506, 11507, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11520, 11557, $toNativeArray($kindInt32, [-7264, 0, -7264])), new CaseRange.ptr(11559, 11559, $toNativeArray($kindInt32, [-7264, 0, -7264])), new CaseRange.ptr(11565, 11565, $toNativeArray($kindInt32, [-7264, 0, -7264])), new CaseRange.ptr(42560, 42605, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42624, 42651, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42786, 42799, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42802, 42863, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42873, 42876, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42877, 42877, $toNativeArray($kindInt32, [0, -35332, 0])), new CaseRange.ptr(42878, 42887, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42891, 42892, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42893, 42893, $toNativeArray($kindInt32, [0, -42280, 0])), new CaseRange.ptr(42896, 42899, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42902, 42921, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42922, 42922, $toNativeArray($kindInt32, [0, -42308, 0])), new CaseRange.ptr(42923, 42923, $toNativeArray($kindInt32, [0, -42319, 0])), new CaseRange.ptr(42924, 42924, $toNativeArray($kindInt32, [0, -42315, 0])), new CaseRange.ptr(42925, 42925, $toNativeArray($kindInt32, [0, -42305, 0])), new CaseRange.ptr(42926, 42926, $toNativeArray($kindInt32, [0, -42308, 0])), new CaseRange.ptr(42928, 42928, $toNativeArray($kindInt32, [0, -42258, 0])), new CaseRange.ptr(42929, 42929, $toNativeArray($kindInt32, [0, -42282, 0])), new CaseRange.ptr(42930, 42930, $toNativeArray($kindInt32, [0, -42261, 0])), new CaseRange.ptr(42931, 42931, $toNativeArray($kindInt32, [0, 928, 0])), new CaseRange.ptr(42932, 42935, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(43859, 43859, $toNativeArray($kindInt32, [-928, 0, -928])), new CaseRange.ptr(43888, 43967, $toNativeArray($kindInt32, [-38864, 0, -38864])), new CaseRange.ptr(65313, 65338, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(65345, 65370, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(66560, 66599, $toNativeArray($kindInt32, [0, 40, 0])), new CaseRange.ptr(66600, 66639, $toNativeArray($kindInt32, [-40, 0, -40])), new CaseRange.ptr(66736, 66771, $toNativeArray($kindInt32, [0, 40, 0])), new CaseRange.ptr(66776, 66811, $toNativeArray($kindInt32, [-40, 0, -40])), new CaseRange.ptr(68736, 68786, $toNativeArray($kindInt32, [0, 64, 0])), new CaseRange.ptr(68800, 68850, $toNativeArray($kindInt32, [-64, 0, -64])), new CaseRange.ptr(71840, 71871, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(71872, 71903, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(125184, 125217, $toNativeArray($kindInt32, [0, 34, 0])), new CaseRange.ptr(125218, 125251, $toNativeArray($kindInt32, [-34, 0, -34]))]);
		$pkg.CaseRanges = _CaseRanges;
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["unicode/utf8"] = (function() {
	var $pkg = {}, $init, acceptRange, first, acceptRanges, DecodeRuneInString, DecodeLastRuneInString, RuneLen, EncodeRune, RuneCountInString, RuneStart;
	acceptRange = $pkg.acceptRange = $newType(0, $kindStruct, "utf8.acceptRange", true, "unicode/utf8", false, function(lo_, hi_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.lo = 0;
			this.hi = 0;
			return;
		}
		this.lo = lo_;
		this.hi = hi_;
	});
	DecodeRuneInString = function(s) {
		var _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, accept, mask, n, r, s, s0, s1, s2, s3, size, sz, x, x$1;
		r = 0;
		size = 0;
		n = s.length;
		if (n < 1) {
			_tmp = 65533;
			_tmp$1 = 0;
			r = _tmp;
			size = _tmp$1;
			return [r, size];
		}
		s0 = s.charCodeAt(0);
		x = ((s0 < 0 || s0 >= first.length) ? ($throwRuntimeError("index out of range"), undefined) : first[s0]);
		if (x >= 240) {
			mask = (((x >> 0)) << 31 >> 0) >> 31 >> 0;
			_tmp$2 = ((((s.charCodeAt(0) >> 0)) & ~mask) >> 0) | (65533 & mask);
			_tmp$3 = 1;
			r = _tmp$2;
			size = _tmp$3;
			return [r, size];
		}
		sz = (x & 7) >>> 0;
		accept = $clone((x$1 = x >>> 4 << 24 >>> 24, ((x$1 < 0 || x$1 >= acceptRanges.length) ? ($throwRuntimeError("index out of range"), undefined) : acceptRanges[x$1])), acceptRange);
		if (n < ((sz >> 0))) {
			_tmp$4 = 65533;
			_tmp$5 = 1;
			r = _tmp$4;
			size = _tmp$5;
			return [r, size];
		}
		s1 = s.charCodeAt(1);
		if (s1 < accept.lo || accept.hi < s1) {
			_tmp$6 = 65533;
			_tmp$7 = 1;
			r = _tmp$6;
			size = _tmp$7;
			return [r, size];
		}
		if (sz === 2) {
			_tmp$8 = (((((s0 & 31) >>> 0) >> 0)) << 6 >> 0) | ((((s1 & 63) >>> 0) >> 0));
			_tmp$9 = 2;
			r = _tmp$8;
			size = _tmp$9;
			return [r, size];
		}
		s2 = s.charCodeAt(2);
		if (s2 < 128 || 191 < s2) {
			_tmp$10 = 65533;
			_tmp$11 = 1;
			r = _tmp$10;
			size = _tmp$11;
			return [r, size];
		}
		if (sz === 3) {
			_tmp$12 = ((((((s0 & 15) >>> 0) >> 0)) << 12 >> 0) | (((((s1 & 63) >>> 0) >> 0)) << 6 >> 0)) | ((((s2 & 63) >>> 0) >> 0));
			_tmp$13 = 3;
			r = _tmp$12;
			size = _tmp$13;
			return [r, size];
		}
		s3 = s.charCodeAt(3);
		if (s3 < 128 || 191 < s3) {
			_tmp$14 = 65533;
			_tmp$15 = 1;
			r = _tmp$14;
			size = _tmp$15;
			return [r, size];
		}
		_tmp$16 = (((((((s0 & 7) >>> 0) >> 0)) << 18 >> 0) | (((((s1 & 63) >>> 0) >> 0)) << 12 >> 0)) | (((((s2 & 63) >>> 0) >> 0)) << 6 >> 0)) | ((((s3 & 63) >>> 0) >> 0));
		_tmp$17 = 4;
		r = _tmp$16;
		size = _tmp$17;
		return [r, size];
	};
	$pkg.DecodeRuneInString = DecodeRuneInString;
	DecodeLastRuneInString = function(s) {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tuple, end, lim, r, s, size, start;
		r = 0;
		size = 0;
		end = s.length;
		if (end === 0) {
			_tmp = 65533;
			_tmp$1 = 0;
			r = _tmp;
			size = _tmp$1;
			return [r, size];
		}
		start = end - 1 >> 0;
		r = ((s.charCodeAt(start) >> 0));
		if (r < 128) {
			_tmp$2 = r;
			_tmp$3 = 1;
			r = _tmp$2;
			size = _tmp$3;
			return [r, size];
		}
		lim = end - 4 >> 0;
		if (lim < 0) {
			lim = 0;
		}
		start = start - (1) >> 0;
		while (true) {
			if (!(start >= lim)) { break; }
			if (RuneStart(s.charCodeAt(start))) {
				break;
			}
			start = start - (1) >> 0;
		}
		if (start < 0) {
			start = 0;
		}
		_tuple = DecodeRuneInString($substring(s, start, end));
		r = _tuple[0];
		size = _tuple[1];
		if (!(((start + size >> 0) === end))) {
			_tmp$4 = 65533;
			_tmp$5 = 1;
			r = _tmp$4;
			size = _tmp$5;
			return [r, size];
		}
		_tmp$6 = r;
		_tmp$7 = size;
		r = _tmp$6;
		size = _tmp$7;
		return [r, size];
	};
	$pkg.DecodeLastRuneInString = DecodeLastRuneInString;
	RuneLen = function(r) {
		var r;
		if (r < 0) {
			return -1;
		} else if (r <= 127) {
			return 1;
		} else if (r <= 2047) {
			return 2;
		} else if (55296 <= r && r <= 57343) {
			return -1;
		} else if (r <= 65535) {
			return 3;
		} else if (r <= 1114111) {
			return 4;
		}
		return -1;
	};
	$pkg.RuneLen = RuneLen;
	EncodeRune = function(p, r) {
		var i, p, r;
		i = ((r >>> 0));
		if (i <= 127) {
			(0 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 0] = ((r << 24 >>> 24)));
			return 1;
		} else if (i <= 2047) {
			$unused((1 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 1]));
			(0 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 0] = ((192 | (((r >> 6 >> 0) << 24 >>> 24))) >>> 0));
			(1 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 1] = ((128 | ((((r << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			return 2;
		} else if ((i > 1114111) || (55296 <= i && i <= 57343)) {
			r = 65533;
			$unused((2 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 2]));
			(0 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 0] = ((224 | (((r >> 12 >> 0) << 24 >>> 24))) >>> 0));
			(1 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 1] = ((128 | (((((r >> 6 >> 0) << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 2] = ((128 | ((((r << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			return 3;
		} else if (i <= 65535) {
			$unused((2 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 2]));
			(0 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 0] = ((224 | (((r >> 12 >> 0) << 24 >>> 24))) >>> 0));
			(1 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 1] = ((128 | (((((r >> 6 >> 0) << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 2] = ((128 | ((((r << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			return 3;
		} else {
			$unused((3 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 3]));
			(0 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 0] = ((240 | (((r >> 18 >> 0) << 24 >>> 24))) >>> 0));
			(1 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 1] = ((128 | (((((r >> 12 >> 0) << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 2] = ((128 | (((((r >> 6 >> 0) << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			(3 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 3] = ((128 | ((((r << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			return 4;
		}
	};
	$pkg.EncodeRune = EncodeRune;
	RuneCountInString = function(s) {
		var accept, c, c$1, c$2, c$3, i, n, ns, s, size, x, x$1;
		n = 0;
		ns = s.length;
		i = 0;
		while (true) {
			if (!(i < ns)) { break; }
			c = s.charCodeAt(i);
			if (c < 128) {
				i = i + (1) >> 0;
				n = n + (1) >> 0;
				continue;
			}
			x = ((c < 0 || c >= first.length) ? ($throwRuntimeError("index out of range"), undefined) : first[c]);
			if (x === 241) {
				i = i + (1) >> 0;
				n = n + (1) >> 0;
				continue;
			}
			size = ((((x & 7) >>> 0) >> 0));
			if ((i + size >> 0) > ns) {
				i = i + (1) >> 0;
				n = n + (1) >> 0;
				continue;
			}
			accept = $clone((x$1 = x >>> 4 << 24 >>> 24, ((x$1 < 0 || x$1 >= acceptRanges.length) ? ($throwRuntimeError("index out of range"), undefined) : acceptRanges[x$1])), acceptRange);
			c$1 = s.charCodeAt((i + 1 >> 0));
			if (c$1 < accept.lo || accept.hi < c$1) {
				size = 1;
			} else if (size === 2) {
			} else {
				c$2 = s.charCodeAt((i + 2 >> 0));
				if (c$2 < 128 || 191 < c$2) {
					size = 1;
				} else if (size === 3) {
				} else {
					c$3 = s.charCodeAt((i + 3 >> 0));
					if (c$3 < 128 || 191 < c$3) {
						size = 1;
					}
				}
			}
			i = i + (size) >> 0;
			n = n + (1) >> 0;
		}
		n = n;
		return n;
	};
	$pkg.RuneCountInString = RuneCountInString;
	RuneStart = function(b) {
		var b;
		return !((((b & 192) >>> 0) === 128));
	};
	$pkg.RuneStart = RuneStart;
	acceptRange.init("unicode/utf8", [{prop: "lo", name: "lo", embedded: false, exported: false, typ: $Uint8, tag: ""}, {prop: "hi", name: "hi", embedded: false, exported: false, typ: $Uint8, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		first = $toNativeArray($kindUint8, [240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 19, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 35, 3, 3, 52, 4, 4, 4, 68, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241]);
		acceptRanges = $toNativeArray($kindStruct, [new acceptRange.ptr(128, 191), new acceptRange.ptr(160, 191), new acceptRange.ptr(128, 159), new acceptRange.ptr(144, 191), new acceptRange.ptr(128, 143)]);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["strings"] = (function() {
	var $pkg = {}, $init, errors, js, bytealg, io, sync, unicode, utf8, Builder, Replacer, replacer, trieNode, genericReplacer, appendSliceWriter, stringWriter, singleStringReplacer, byteReplacer, byteStringReplacer, stringFinder, ptrType, sliceType, sliceType$1, arrayType, ptrType$1, arrayType$1, ptrType$2, sliceType$2, ptrType$3, ptrType$4, arrayType$2, sliceType$3, ptrType$7, ptrType$8, ptrType$9, ptrType$10, Index, Count, NewReplacer, makeGenericReplacer, getStringWriter, makeSingleStringReplacer, makeStringFinder, longestCommonSuffix, max, HasPrefix, Map, ToLower, TrimLeftFunc, TrimRightFunc, TrimFunc, indexFunc, lastIndexFunc, TrimSpace;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	bytealg = $packages["internal/bytealg"];
	io = $packages["io"];
	sync = $packages["sync"];
	unicode = $packages["unicode"];
	utf8 = $packages["unicode/utf8"];
	Builder = $pkg.Builder = $newType(0, $kindStruct, "strings.Builder", true, "strings", true, function(addr_, buf_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.addr = ptrType.nil;
			this.buf = sliceType.nil;
			return;
		}
		this.addr = addr_;
		this.buf = buf_;
	});
	Replacer = $pkg.Replacer = $newType(0, $kindStruct, "strings.Replacer", true, "strings", true, function(once_, r_, oldnew_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.once = new sync.Once.ptr(new sync.Mutex.ptr(0, 0), 0);
			this.r = $ifaceNil;
			this.oldnew = sliceType$1.nil;
			return;
		}
		this.once = once_;
		this.r = r_;
		this.oldnew = oldnew_;
	});
	replacer = $pkg.replacer = $newType(8, $kindInterface, "strings.replacer", true, "strings", false, null);
	trieNode = $pkg.trieNode = $newType(0, $kindStruct, "strings.trieNode", true, "strings", false, function(value_, priority_, prefix_, next_, table_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.value = "";
			this.priority = 0;
			this.prefix = "";
			this.next = ptrType$2.nil;
			this.table = sliceType$2.nil;
			return;
		}
		this.value = value_;
		this.priority = priority_;
		this.prefix = prefix_;
		this.next = next_;
		this.table = table_;
	});
	genericReplacer = $pkg.genericReplacer = $newType(0, $kindStruct, "strings.genericReplacer", true, "strings", false, function(root_, tableSize_, mapping_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.root = new trieNode.ptr("", 0, "", ptrType$2.nil, sliceType$2.nil);
			this.tableSize = 0;
			this.mapping = arrayType.zero();
			return;
		}
		this.root = root_;
		this.tableSize = tableSize_;
		this.mapping = mapping_;
	});
	appendSliceWriter = $pkg.appendSliceWriter = $newType(12, $kindSlice, "strings.appendSliceWriter", true, "strings", false, null);
	stringWriter = $pkg.stringWriter = $newType(0, $kindStruct, "strings.stringWriter", true, "strings", false, function(w_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.w = $ifaceNil;
			return;
		}
		this.w = w_;
	});
	singleStringReplacer = $pkg.singleStringReplacer = $newType(0, $kindStruct, "strings.singleStringReplacer", true, "strings", false, function(finder_, value_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.finder = ptrType$4.nil;
			this.value = "";
			return;
		}
		this.finder = finder_;
		this.value = value_;
	});
	byteReplacer = $pkg.byteReplacer = $newType(256, $kindArray, "strings.byteReplacer", true, "strings", false, null);
	byteStringReplacer = $pkg.byteStringReplacer = $newType(0, $kindStruct, "strings.byteStringReplacer", true, "strings", false, function(replacements_, toReplace_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.replacements = arrayType$1.zero();
			this.toReplace = sliceType$1.nil;
			return;
		}
		this.replacements = replacements_;
		this.toReplace = toReplace_;
	});
	stringFinder = $pkg.stringFinder = $newType(0, $kindStruct, "strings.stringFinder", true, "strings", false, function(pattern_, badCharSkip_, goodSuffixSkip_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.pattern = "";
			this.badCharSkip = arrayType$2.zero();
			this.goodSuffixSkip = sliceType$3.nil;
			return;
		}
		this.pattern = pattern_;
		this.badCharSkip = badCharSkip_;
		this.goodSuffixSkip = goodSuffixSkip_;
	});
	ptrType = $ptrType(Builder);
	sliceType = $sliceType($Uint8);
	sliceType$1 = $sliceType($String);
	arrayType = $arrayType($Uint8, 256);
	ptrType$1 = $ptrType(byteReplacer);
	arrayType$1 = $arrayType(sliceType, 256);
	ptrType$2 = $ptrType(trieNode);
	sliceType$2 = $sliceType(ptrType$2);
	ptrType$3 = $ptrType(appendSliceWriter);
	ptrType$4 = $ptrType(stringFinder);
	arrayType$2 = $arrayType($Int, 256);
	sliceType$3 = $sliceType($Int);
	ptrType$7 = $ptrType(Replacer);
	ptrType$8 = $ptrType(genericReplacer);
	ptrType$9 = $ptrType(singleStringReplacer);
	ptrType$10 = $ptrType(byteStringReplacer);
	Index = function(s, sep) {
		var s, sep;
		return $parseInt(s.indexOf(sep)) >> 0;
	};
	$pkg.Index = Index;
	Count = function(s, sep) {
		var n, pos, s, sep;
		n = 0;
		if ((sep.length === 0)) {
			return utf8.RuneCountInString(s) + 1 >> 0;
		} else if (sep.length > s.length) {
			return 0;
		} else if ((sep.length === s.length)) {
			if (sep === s) {
				return 1;
			}
			return 0;
		}
		while (true) {
			pos = Index(s, sep);
			if (pos === -1) {
				break;
			}
			n = n + (1) >> 0;
			s = $substring(s, (pos + sep.length >> 0));
		}
		return n;
	};
	$pkg.Count = Count;
	Builder.ptr.prototype.String = function() {
		var b;
		b = this;
		return ($bytesToString(b.buf));
	};
	Builder.prototype.String = function() { return this.$val.String(); };
	Builder.ptr.prototype.copyCheck = function() {
		var b;
		b = this;
		if (b.addr === ptrType.nil) {
			b.addr = b;
		} else if (!(b.addr === b)) {
			$panic(new $String("strings: illegal use of non-zero Builder copied by value"));
		}
	};
	Builder.prototype.copyCheck = function() { return this.$val.copyCheck(); };
	Builder.ptr.prototype.Len = function() {
		var b;
		b = this;
		return b.buf.$length;
	};
	Builder.prototype.Len = function() { return this.$val.Len(); };
	Builder.ptr.prototype.Cap = function() {
		var b;
		b = this;
		return b.buf.$capacity;
	};
	Builder.prototype.Cap = function() { return this.$val.Cap(); };
	Builder.ptr.prototype.Reset = function() {
		var b;
		b = this;
		b.addr = ptrType.nil;
		b.buf = sliceType.nil;
	};
	Builder.prototype.Reset = function() { return this.$val.Reset(); };
	Builder.ptr.prototype.grow = function(n) {
		var b, buf, n;
		b = this;
		buf = $makeSlice(sliceType, b.buf.$length, (($imul(2, b.buf.$capacity)) + n >> 0));
		$copySlice(buf, b.buf);
		b.buf = buf;
	};
	Builder.prototype.grow = function(n) { return this.$val.grow(n); };
	Builder.ptr.prototype.Grow = function(n) {
		var b, n;
		b = this;
		b.copyCheck();
		if (n < 0) {
			$panic(new $String("strings.Builder.Grow: negative count"));
		}
		if ((b.buf.$capacity - b.buf.$length >> 0) < n) {
			b.grow(n);
		}
	};
	Builder.prototype.Grow = function(n) { return this.$val.Grow(n); };
	Builder.ptr.prototype.Write = function(p) {
		var b, p;
		b = this;
		b.copyCheck();
		b.buf = $appendSlice(b.buf, p);
		return [p.$length, $ifaceNil];
	};
	Builder.prototype.Write = function(p) { return this.$val.Write(p); };
	Builder.ptr.prototype.WriteByte = function(c) {
		var b, c;
		b = this;
		b.copyCheck();
		b.buf = $append(b.buf, c);
		return $ifaceNil;
	};
	Builder.prototype.WriteByte = function(c) { return this.$val.WriteByte(c); };
	Builder.ptr.prototype.WriteRune = function(r) {
		var b, l, n, r;
		b = this;
		b.copyCheck();
		if (r < 128) {
			b.buf = $append(b.buf, ((r << 24 >>> 24)));
			return [1, $ifaceNil];
		}
		l = b.buf.$length;
		if ((b.buf.$capacity - l >> 0) < 4) {
			b.grow(4);
		}
		n = utf8.EncodeRune($subslice(b.buf, l, (l + 4 >> 0)), r);
		b.buf = $subslice(b.buf, 0, (l + n >> 0));
		return [n, $ifaceNil];
	};
	Builder.prototype.WriteRune = function(r) { return this.$val.WriteRune(r); };
	Builder.ptr.prototype.WriteString = function(s) {
		var b, s;
		b = this;
		b.copyCheck();
		b.buf = $appendSlice(b.buf, s);
		return [s.length, $ifaceNil];
	};
	Builder.prototype.WriteString = function(s) { return this.$val.WriteString(s); };
	NewReplacer = function(oldnew) {
		var _r, oldnew;
		if ((_r = oldnew.$length % 2, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) === 1) {
			$panic(new $String("strings.NewReplacer: odd argument count"));
		}
		return new Replacer.ptr(new sync.Once.ptr(new sync.Mutex.ptr(0, 0), 0), $ifaceNil, $appendSlice((sliceType$1.nil), oldnew));
	};
	$pkg.NewReplacer = NewReplacer;
	Replacer.ptr.prototype.buildOnce = function() {
		var r;
		r = this;
		r.r = r.build();
		r.oldnew = sliceType$1.nil;
	};
	Replacer.prototype.buildOnce = function() { return this.$val.buildOnce(); };
	Replacer.ptr.prototype.build = function() {
		var _i, _q, _ref, allNewBytes, b, i, i$1, i$2, i$3, n, n$1, o, o$1, oldnew, r, r$1, x, x$1, x$2, x$3, x$4;
		b = this;
		oldnew = b.oldnew;
		if ((oldnew.$length === 2) && (0 >= oldnew.$length ? ($throwRuntimeError("index out of range"), undefined) : oldnew.$array[oldnew.$offset + 0]).length > 1) {
			return makeSingleStringReplacer((0 >= oldnew.$length ? ($throwRuntimeError("index out of range"), undefined) : oldnew.$array[oldnew.$offset + 0]), (1 >= oldnew.$length ? ($throwRuntimeError("index out of range"), undefined) : oldnew.$array[oldnew.$offset + 1]));
		}
		allNewBytes = true;
		i = 0;
		while (true) {
			if (!(i < oldnew.$length)) { break; }
			if (!((((i < 0 || i >= oldnew.$length) ? ($throwRuntimeError("index out of range"), undefined) : oldnew.$array[oldnew.$offset + i]).length === 1))) {
				return makeGenericReplacer(oldnew);
			}
			if (!(((x = i + 1 >> 0, ((x < 0 || x >= oldnew.$length) ? ($throwRuntimeError("index out of range"), undefined) : oldnew.$array[oldnew.$offset + x])).length === 1))) {
				allNewBytes = false;
			}
			i = i + (2) >> 0;
		}
		if (allNewBytes) {
			r = arrayType.zero();
			_ref = r;
			_i = 0;
			while (true) {
				if (!(_i < 256)) { break; }
				i$1 = _i;
				((i$1 < 0 || i$1 >= r.length) ? ($throwRuntimeError("index out of range"), undefined) : r[i$1] = ((i$1 << 24 >>> 24)));
				_i++;
			}
			i$2 = oldnew.$length - 2 >> 0;
			while (true) {
				if (!(i$2 >= 0)) { break; }
				o = ((i$2 < 0 || i$2 >= oldnew.$length) ? ($throwRuntimeError("index out of range"), undefined) : oldnew.$array[oldnew.$offset + i$2]).charCodeAt(0);
				n = (x$1 = i$2 + 1 >> 0, ((x$1 < 0 || x$1 >= oldnew.$length) ? ($throwRuntimeError("index out of range"), undefined) : oldnew.$array[oldnew.$offset + x$1])).charCodeAt(0);
				((o < 0 || o >= r.length) ? ($throwRuntimeError("index out of range"), undefined) : r[o] = n);
				i$2 = i$2 - (2) >> 0;
			}
			return new ptrType$1(r);
		}
		r$1 = new byteStringReplacer.ptr(arrayType$1.zero(), $makeSlice(sliceType$1, 0, (_q = oldnew.$length / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"))));
		i$3 = oldnew.$length - 2 >> 0;
		while (true) {
			if (!(i$3 >= 0)) { break; }
			o$1 = ((i$3 < 0 || i$3 >= oldnew.$length) ? ($throwRuntimeError("index out of range"), undefined) : oldnew.$array[oldnew.$offset + i$3]).charCodeAt(0);
			n$1 = (x$2 = i$3 + 1 >> 0, ((x$2 < 0 || x$2 >= oldnew.$length) ? ($throwRuntimeError("index out of range"), undefined) : oldnew.$array[oldnew.$offset + x$2]));
			if ((x$3 = r$1.replacements, ((o$1 < 0 || o$1 >= x$3.length) ? ($throwRuntimeError("index out of range"), undefined) : x$3[o$1])) === sliceType.nil) {
				r$1.toReplace = $append(r$1.toReplace, ($bytesToString(new sliceType([o$1]))));
			}
			(x$4 = r$1.replacements, ((o$1 < 0 || o$1 >= x$4.length) ? ($throwRuntimeError("index out of range"), undefined) : x$4[o$1] = (new sliceType($stringToBytes(n$1)))));
			i$3 = i$3 - (2) >> 0;
		}
		return r$1;
	};
	Replacer.prototype.build = function() { return this.$val.build(); };
	Replacer.ptr.prototype.Replace = function(s) {
		var _r, r, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; r = $f.r; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		$r = r.once.Do($methodVal(r, "buildOnce")); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		_r = r.r.Replace(s); /* */ $s = 2; case 2: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Replacer.ptr.prototype.Replace }; } $f._r = _r; $f.r = r; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	Replacer.prototype.Replace = function(s) { return this.$val.Replace(s); };
	Replacer.ptr.prototype.WriteString = function(w, s) {
		var _r, _tuple, err, n, r, s, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; err = $f.err; n = $f.n; r = $f.r; s = $f.s; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = 0;
		err = $ifaceNil;
		r = this;
		$r = r.once.Do($methodVal(r, "buildOnce")); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		_r = r.r.WriteString(w, s); /* */ $s = 2; case 2: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		n = _tuple[0];
		err = _tuple[1];
		$s = -1; return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Replacer.ptr.prototype.WriteString }; } $f._r = _r; $f._tuple = _tuple; $f.err = err; $f.n = n; $f.r = r; $f.s = s; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	Replacer.prototype.WriteString = function(w, s) { return this.$val.WriteString(w, s); };
	trieNode.ptr.prototype.add = function(key, val, priority, r) {
		var key, keyNode, m, n, next, prefixNode, priority, r, t, val, x, x$1, x$10, x$11, x$12, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		t = this;
		if (key === "") {
			if (t.priority === 0) {
				t.value = val;
				t.priority = priority;
			}
			return;
		}
		if (!(t.prefix === "")) {
			n = 0;
			while (true) {
				if (!(n < t.prefix.length && n < key.length)) { break; }
				if (!((t.prefix.charCodeAt(n) === key.charCodeAt(n)))) {
					break;
				}
				n = n + (1) >> 0;
			}
			if (n === t.prefix.length) {
				t.next.add($substring(key, n), val, priority, r);
			} else if (n === 0) {
				prefixNode = ptrType$2.nil;
				if (t.prefix.length === 1) {
					prefixNode = t.next;
				} else {
					prefixNode = new trieNode.ptr("", 0, $substring(t.prefix, 1), t.next, sliceType$2.nil);
				}
				keyNode = new trieNode.ptr("", 0, "", ptrType$2.nil, sliceType$2.nil);
				t.table = $makeSlice(sliceType$2, r.tableSize);
				(x = t.table, x$1 = (x$2 = r.mapping, x$3 = t.prefix.charCodeAt(0), ((x$3 < 0 || x$3 >= x$2.length) ? ($throwRuntimeError("index out of range"), undefined) : x$2[x$3])), ((x$1 < 0 || x$1 >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + x$1] = prefixNode));
				(x$4 = t.table, x$5 = (x$6 = r.mapping, x$7 = key.charCodeAt(0), ((x$7 < 0 || x$7 >= x$6.length) ? ($throwRuntimeError("index out of range"), undefined) : x$6[x$7])), ((x$5 < 0 || x$5 >= x$4.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$4.$array[x$4.$offset + x$5] = keyNode));
				t.prefix = "";
				t.next = ptrType$2.nil;
				keyNode.add($substring(key, 1), val, priority, r);
			} else {
				next = new trieNode.ptr("", 0, $substring(t.prefix, n), t.next, sliceType$2.nil);
				t.prefix = $substring(t.prefix, 0, n);
				t.next = next;
				next.add($substring(key, n), val, priority, r);
			}
		} else if (!(t.table === sliceType$2.nil)) {
			m = (x$8 = r.mapping, x$9 = key.charCodeAt(0), ((x$9 < 0 || x$9 >= x$8.length) ? ($throwRuntimeError("index out of range"), undefined) : x$8[x$9]));
			if ((x$10 = t.table, ((m < 0 || m >= x$10.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$10.$array[x$10.$offset + m])) === ptrType$2.nil) {
				(x$11 = t.table, ((m < 0 || m >= x$11.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$11.$array[x$11.$offset + m] = new trieNode.ptr("", 0, "", ptrType$2.nil, sliceType$2.nil)));
			}
			(x$12 = t.table, ((m < 0 || m >= x$12.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$12.$array[x$12.$offset + m])).add($substring(key, 1), val, priority, r);
		} else {
			t.prefix = key;
			t.next = new trieNode.ptr("", 0, "", ptrType$2.nil, sliceType$2.nil);
			t.next.add("", val, priority, r);
		}
	};
	trieNode.prototype.add = function(key, val, priority, r) { return this.$val.add(key, val, priority, r); };
	genericReplacer.ptr.prototype.lookup = function(s, ignoreRoot) {
		var bestPriority, found, ignoreRoot, index, keylen, n, node, r, s, val, x, x$1, x$2;
		val = "";
		keylen = 0;
		found = false;
		r = this;
		bestPriority = 0;
		node = r.root;
		n = 0;
		while (true) {
			if (!(!(node === ptrType$2.nil))) { break; }
			if (node.priority > bestPriority && !(ignoreRoot && node === r.root)) {
				bestPriority = node.priority;
				val = node.value;
				keylen = n;
				found = true;
			}
			if (s === "") {
				break;
			}
			if (!(node.table === sliceType$2.nil)) {
				index = (x = r.mapping, x$1 = s.charCodeAt(0), ((x$1 < 0 || x$1 >= x.length) ? ($throwRuntimeError("index out of range"), undefined) : x[x$1]));
				if (((index >> 0)) === r.tableSize) {
					break;
				}
				node = (x$2 = node.table, ((index < 0 || index >= x$2.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$2.$array[x$2.$offset + index]));
				s = $substring(s, 1);
				n = n + (1) >> 0;
			} else if (!(node.prefix === "") && HasPrefix(s, node.prefix)) {
				n = n + (node.prefix.length) >> 0;
				s = $substring(s, node.prefix.length);
				node = node.next;
			} else {
				break;
			}
		}
		return [val, keylen, found];
	};
	genericReplacer.prototype.lookup = function(s, ignoreRoot) { return this.$val.lookup(s, ignoreRoot); };
	makeGenericReplacer = function(oldnew) {
		var _i, _i$1, _ref, _ref$1, b, b$1, i, i$1, i$2, index, j, key, oldnew, r, x, x$1, x$2, x$3, x$4;
		r = new genericReplacer.ptr(new trieNode.ptr("", 0, "", ptrType$2.nil, sliceType$2.nil), 0, arrayType.zero());
		i = 0;
		while (true) {
			if (!(i < oldnew.$length)) { break; }
			key = ((i < 0 || i >= oldnew.$length) ? ($throwRuntimeError("index out of range"), undefined) : oldnew.$array[oldnew.$offset + i]);
			j = 0;
			while (true) {
				if (!(j < key.length)) { break; }
				(x = r.mapping, x$1 = key.charCodeAt(j), ((x$1 < 0 || x$1 >= x.length) ? ($throwRuntimeError("index out of range"), undefined) : x[x$1] = 1));
				j = j + (1) >> 0;
			}
			i = i + (2) >> 0;
		}
		_ref = r.mapping;
		_i = 0;
		while (true) {
			if (!(_i < 256)) { break; }
			b = ((_i < 0 || _i >= _ref.length) ? ($throwRuntimeError("index out of range"), undefined) : _ref[_i]);
			r.tableSize = r.tableSize + (((b >> 0))) >> 0;
			_i++;
		}
		index = 0;
		_ref$1 = r.mapping;
		_i$1 = 0;
		while (true) {
			if (!(_i$1 < 256)) { break; }
			i$1 = _i$1;
			b$1 = ((_i$1 < 0 || _i$1 >= _ref$1.length) ? ($throwRuntimeError("index out of range"), undefined) : _ref$1[_i$1]);
			if (b$1 === 0) {
				(x$2 = r.mapping, ((i$1 < 0 || i$1 >= x$2.length) ? ($throwRuntimeError("index out of range"), undefined) : x$2[i$1] = ((r.tableSize << 24 >>> 24))));
			} else {
				(x$3 = r.mapping, ((i$1 < 0 || i$1 >= x$3.length) ? ($throwRuntimeError("index out of range"), undefined) : x$3[i$1] = index));
				index = index + (1) << 24 >>> 24;
			}
			_i$1++;
		}
		r.root.table = $makeSlice(sliceType$2, r.tableSize);
		i$2 = 0;
		while (true) {
			if (!(i$2 < oldnew.$length)) { break; }
			r.root.add(((i$2 < 0 || i$2 >= oldnew.$length) ? ($throwRuntimeError("index out of range"), undefined) : oldnew.$array[oldnew.$offset + i$2]), (x$4 = i$2 + 1 >> 0, ((x$4 < 0 || x$4 >= oldnew.$length) ? ($throwRuntimeError("index out of range"), undefined) : oldnew.$array[oldnew.$offset + x$4])), oldnew.$length - i$2 >> 0, r);
			i$2 = i$2 + (2) >> 0;
		}
		return r;
	};
	$ptrType(appendSliceWriter).prototype.Write = function(p) {
		var p, w;
		w = this;
		w.$set($appendSlice(w.$get(), p));
		return [p.$length, $ifaceNil];
	};
	$ptrType(appendSliceWriter).prototype.WriteString = function(s) {
		var s, w;
		w = this;
		w.$set($appendSlice(w.$get(), s));
		return [s.length, $ifaceNil];
	};
	stringWriter.ptr.prototype.WriteString = function(s) {
		var _r, s, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; s = $f.s; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		w = this;
		_r = w.w.Write((new sliceType($stringToBytes(s)))); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: stringWriter.ptr.prototype.WriteString }; } $f._r = _r; $f.s = s; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	stringWriter.prototype.WriteString = function(s) { return this.$val.WriteString(s); };
	getStringWriter = function(w) {
		var _tuple, ok, sw, w, x;
		_tuple = $assertType(w, io.StringWriter, true);
		sw = _tuple[0];
		ok = _tuple[1];
		if (!ok) {
			sw = (x = new stringWriter.ptr(w), new x.constructor.elem(x));
		}
		return sw;
	};
	genericReplacer.ptr.prototype.Replace = function(s) {
		var _r, buf, r, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; buf = $f.buf; r = $f.r; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		buf = [buf];
		r = this;
		buf[0] = $makeSlice(appendSliceWriter, 0, s.length);
		_r = r.WriteString((buf.$ptr || (buf.$ptr = new ptrType$3(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, buf))), s); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r;
		$s = -1; return ($bytesToString(buf[0]));
		/* */ } return; } if ($f === undefined) { $f = { $blk: genericReplacer.ptr.prototype.Replace }; } $f._r = _r; $f.buf = buf; $f.r = r; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	genericReplacer.prototype.Replace = function(s) { return this.$val.Replace(s); };
	genericReplacer.ptr.prototype.WriteString = function(w, s) {
		var _r, _r$1, _r$2, _tmp, _tmp$1, _tuple, _tuple$1, _tuple$2, _tuple$3, err, i, index, keylen, last, match, n, prevMatchEmpty, r, s, sw, val, w, wn, x, x$1, x$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; err = $f.err; i = $f.i; index = $f.index; keylen = $f.keylen; last = $f.last; match = $f.match; n = $f.n; prevMatchEmpty = $f.prevMatchEmpty; r = $f.r; s = $f.s; sw = $f.sw; val = $f.val; w = $f.w; wn = $f.wn; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = 0;
		err = $ifaceNil;
		r = this;
		sw = getStringWriter(w);
		_tmp = 0;
		_tmp$1 = 0;
		last = _tmp;
		wn = _tmp$1;
		prevMatchEmpty = false;
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i <= s.length)) { break; } */ if(!(i <= s.length)) { $s = 2; continue; }
			/* */ if (!((i === s.length)) && (r.root.priority === 0)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!((i === s.length)) && (r.root.priority === 0)) { */ case 3:
				index = (((x = r.mapping, x$1 = s.charCodeAt(i), ((x$1 < 0 || x$1 >= x.length) ? ($throwRuntimeError("index out of range"), undefined) : x[x$1])) >> 0));
				if ((index === r.tableSize) || (x$2 = r.root.table, ((index < 0 || index >= x$2.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$2.$array[x$2.$offset + index])) === ptrType$2.nil) {
					i = i + (1) >> 0;
					/* continue; */ $s = 1; continue;
				}
			/* } */ case 4:
			_tuple = r.lookup($substring(s, i), prevMatchEmpty);
			val = _tuple[0];
			keylen = _tuple[1];
			match = _tuple[2];
			prevMatchEmpty = match && (keylen === 0);
			/* */ if (match) { $s = 5; continue; }
			/* */ $s = 6; continue;
			/* if (match) { */ case 5:
				_r = sw.WriteString($substring(s, last, i)); /* */ $s = 7; case 7: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_tuple$1 = _r;
				wn = _tuple$1[0];
				err = _tuple$1[1];
				n = n + (wn) >> 0;
				if (!($interfaceIsEqual(err, $ifaceNil))) {
					$s = -1; return [n, err];
				}
				_r$1 = sw.WriteString(val); /* */ $s = 8; case 8: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_tuple$2 = _r$1;
				wn = _tuple$2[0];
				err = _tuple$2[1];
				n = n + (wn) >> 0;
				if (!($interfaceIsEqual(err, $ifaceNil))) {
					$s = -1; return [n, err];
				}
				i = i + (keylen) >> 0;
				last = i;
				/* continue; */ $s = 1; continue;
			/* } */ case 6:
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		/* */ if (!((last === s.length))) { $s = 9; continue; }
		/* */ $s = 10; continue;
		/* if (!((last === s.length))) { */ case 9:
			_r$2 = sw.WriteString($substring(s, last)); /* */ $s = 11; case 11: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			_tuple$3 = _r$2;
			wn = _tuple$3[0];
			err = _tuple$3[1];
			n = n + (wn) >> 0;
		/* } */ case 10:
		$s = -1; return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: genericReplacer.ptr.prototype.WriteString }; } $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f.err = err; $f.i = i; $f.index = index; $f.keylen = keylen; $f.last = last; $f.match = match; $f.n = n; $f.prevMatchEmpty = prevMatchEmpty; $f.r = r; $f.s = s; $f.sw = sw; $f.val = val; $f.w = w; $f.wn = wn; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	genericReplacer.prototype.WriteString = function(w, s) { return this.$val.WriteString(w, s); };
	makeSingleStringReplacer = function(pattern, value) {
		var pattern, value;
		return new singleStringReplacer.ptr(makeStringFinder(pattern), value);
	};
	singleStringReplacer.ptr.prototype.Replace = function(s) {
		var _tmp, _tmp$1, buf, i, match, matched, r, s;
		r = this;
		buf = sliceType.nil;
		_tmp = 0;
		_tmp$1 = false;
		i = _tmp;
		matched = _tmp$1;
		while (true) {
			match = r.finder.next($substring(s, i));
			if (match === -1) {
				break;
			}
			matched = true;
			buf = $appendSlice(buf, $substring(s, i, (i + match >> 0)));
			buf = $appendSlice(buf, r.value);
			i = i + ((match + r.finder.pattern.length >> 0)) >> 0;
		}
		if (!matched) {
			return s;
		}
		buf = $appendSlice(buf, $substring(s, i));
		return ($bytesToString(buf));
	};
	singleStringReplacer.prototype.Replace = function(s) { return this.$val.Replace(s); };
	singleStringReplacer.ptr.prototype.WriteString = function(w, s) {
		var _r, _r$1, _r$2, _tmp, _tmp$1, _tuple, _tuple$1, _tuple$2, err, i, match, n, r, s, sw, w, wn, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; err = $f.err; i = $f.i; match = $f.match; n = $f.n; r = $f.r; s = $f.s; sw = $f.sw; w = $f.w; wn = $f.wn; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = 0;
		err = $ifaceNil;
		r = this;
		sw = getStringWriter(w);
		_tmp = 0;
		_tmp$1 = 0;
		i = _tmp;
		wn = _tmp$1;
		/* while (true) { */ case 1:
			match = r.finder.next($substring(s, i));
			if (match === -1) {
				/* break; */ $s = 2; continue;
			}
			_r = sw.WriteString($substring(s, i, (i + match >> 0))); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple = _r;
			wn = _tuple[0];
			err = _tuple[1];
			n = n + (wn) >> 0;
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				$s = -1; return [n, err];
			}
			_r$1 = sw.WriteString(r.value); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_tuple$1 = _r$1;
			wn = _tuple$1[0];
			err = _tuple$1[1];
			n = n + (wn) >> 0;
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				$s = -1; return [n, err];
			}
			i = i + ((match + r.finder.pattern.length >> 0)) >> 0;
		/* } */ $s = 1; continue; case 2:
		_r$2 = sw.WriteString($substring(s, i)); /* */ $s = 5; case 5: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_tuple$2 = _r$2;
		wn = _tuple$2[0];
		err = _tuple$2[1];
		n = n + (wn) >> 0;
		$s = -1; return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: singleStringReplacer.ptr.prototype.WriteString }; } $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.err = err; $f.i = i; $f.match = match; $f.n = n; $f.r = r; $f.s = s; $f.sw = sw; $f.w = w; $f.wn = wn; $f.$s = $s; $f.$r = $r; return $f;
	};
	singleStringReplacer.prototype.WriteString = function(w, s) { return this.$val.WriteString(w, s); };
	byteReplacer.prototype.Replace = function(s) {
		var b, buf, i, r, s;
		r = this.$val;
		buf = sliceType.nil;
		i = 0;
		while (true) {
			if (!(i < s.length)) { break; }
			b = s.charCodeAt(i);
			if (!(((r.nilCheck, ((b < 0 || b >= r.length) ? ($throwRuntimeError("index out of range"), undefined) : r[b])) === b))) {
				if (buf === sliceType.nil) {
					buf = (new sliceType($stringToBytes(s)));
				}
				((i < 0 || i >= buf.$length) ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + i] = (r.nilCheck, ((b < 0 || b >= r.length) ? ($throwRuntimeError("index out of range"), undefined) : r[b])));
			}
			i = i + (1) >> 0;
		}
		if (buf === sliceType.nil) {
			return s;
		}
		return ($bytesToString(buf));
	};
	$ptrType(byteReplacer).prototype.Replace = function(s) { return (new byteReplacer(this.$get())).Replace(s); };
	byteReplacer.prototype.WriteString = function(w, s) {
		var _i, _r, _ref, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, b, buf, bufsize, err, err$1, i, n, ncopy, r, s, w, wn, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _i = $f._i; _r = $f._r; _ref = $f._ref; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tuple = $f._tuple; b = $f.b; buf = $f.buf; bufsize = $f.bufsize; err = $f.err; err$1 = $f.err$1; i = $f.i; n = $f.n; ncopy = $f.ncopy; r = $f.r; s = $f.s; w = $f.w; wn = $f.wn; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = 0;
		err = $ifaceNil;
		r = this.$val;
		bufsize = 32768;
		if (s.length < bufsize) {
			bufsize = s.length;
		}
		buf = $makeSlice(sliceType, bufsize);
		/* while (true) { */ case 1:
			/* if (!(s.length > 0)) { break; } */ if(!(s.length > 0)) { $s = 2; continue; }
			ncopy = $copyString(buf, s);
			s = $substring(s, ncopy);
			_ref = $subslice(buf, 0, ncopy);
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				i = _i;
				b = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
				((i < 0 || i >= buf.$length) ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + i] = (r.nilCheck, ((b < 0 || b >= r.length) ? ($throwRuntimeError("index out of range"), undefined) : r[b])));
				_i++;
			}
			_r = w.Write($subslice(buf, 0, ncopy)); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple = _r;
			wn = _tuple[0];
			err$1 = _tuple[1];
			n = n + (wn) >> 0;
			if (!($interfaceIsEqual(err$1, $ifaceNil))) {
				_tmp = n;
				_tmp$1 = err$1;
				n = _tmp;
				err = _tmp$1;
				$s = -1; return [n, err];
			}
		/* } */ $s = 1; continue; case 2:
		_tmp$2 = n;
		_tmp$3 = $ifaceNil;
		n = _tmp$2;
		err = _tmp$3;
		$s = -1; return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: byteReplacer.prototype.WriteString }; } $f._i = _i; $f._r = _r; $f._ref = _ref; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tuple = _tuple; $f.b = b; $f.buf = buf; $f.bufsize = bufsize; $f.err = err; $f.err$1 = err$1; $f.i = i; $f.n = n; $f.ncopy = ncopy; $f.r = r; $f.s = s; $f.w = w; $f.wn = wn; $f.$s = $s; $f.$r = $r; return $f;
	};
	$ptrType(byteReplacer).prototype.WriteString = function(w, s) { return (new byteReplacer(this.$get())).WriteString(w, s); };
	byteStringReplacer.ptr.prototype.Replace = function(s) {
		var _i, _ref, anyChanges, b, b$1, buf, c, i, i$1, j, newSize, r, s, x, x$1, x$2, x$3, x$4, x$5, x$6;
		r = this;
		newSize = s.length;
		anyChanges = false;
		if (($imul(r.toReplace.$length, 8)) <= s.length) {
			_ref = r.toReplace;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				x = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
				c = Count(s, x);
				if (!((c === 0))) {
					newSize = newSize + (($imul(c, (((x$1 = r.replacements, x$2 = x.charCodeAt(0), ((x$2 < 0 || x$2 >= x$1.length) ? ($throwRuntimeError("index out of range"), undefined) : x$1[x$2])).$length - 1 >> 0))))) >> 0;
					anyChanges = true;
				}
				_i++;
			}
		} else {
			i = 0;
			while (true) {
				if (!(i < s.length)) { break; }
				b = s.charCodeAt(i);
				if (!((x$3 = r.replacements, ((b < 0 || b >= x$3.length) ? ($throwRuntimeError("index out of range"), undefined) : x$3[b])) === sliceType.nil)) {
					newSize = newSize + (((x$4 = r.replacements, ((b < 0 || b >= x$4.length) ? ($throwRuntimeError("index out of range"), undefined) : x$4[b])).$length - 1 >> 0)) >> 0;
					anyChanges = true;
				}
				i = i + (1) >> 0;
			}
		}
		if (!anyChanges) {
			return s;
		}
		buf = $makeSlice(sliceType, newSize);
		j = 0;
		i$1 = 0;
		while (true) {
			if (!(i$1 < s.length)) { break; }
			b$1 = s.charCodeAt(i$1);
			if (!((x$5 = r.replacements, ((b$1 < 0 || b$1 >= x$5.length) ? ($throwRuntimeError("index out of range"), undefined) : x$5[b$1])) === sliceType.nil)) {
				j = j + ($copySlice($subslice(buf, j), (x$6 = r.replacements, ((b$1 < 0 || b$1 >= x$6.length) ? ($throwRuntimeError("index out of range"), undefined) : x$6[b$1])))) >> 0;
			} else {
				((j < 0 || j >= buf.$length) ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + j] = b$1);
				j = j + (1) >> 0;
			}
			i$1 = i$1 + (1) >> 0;
		}
		return ($bytesToString(buf));
	};
	byteStringReplacer.prototype.Replace = function(s) { return this.$val.Replace(s); };
	byteStringReplacer.ptr.prototype.WriteString = function(w, s) {
		var _r, _r$1, _r$2, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, _tuple$1, _tuple$2, b, err, err$1, err$2, i, last, n, nw, nw$1, nw$2, r, s, sw, w, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; b = $f.b; err = $f.err; err$1 = $f.err$1; err$2 = $f.err$2; i = $f.i; last = $f.last; n = $f.n; nw = $f.nw; nw$1 = $f.nw$1; nw$2 = $f.nw$2; r = $f.r; s = $f.s; sw = $f.sw; w = $f.w; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = 0;
		err = $ifaceNil;
		r = this;
		sw = getStringWriter(w);
		last = 0;
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < s.length)) { break; } */ if(!(i < s.length)) { $s = 2; continue; }
			b = s.charCodeAt(i);
			/* */ if ((x = r.replacements, ((b < 0 || b >= x.length) ? ($throwRuntimeError("index out of range"), undefined) : x[b])) === sliceType.nil) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if ((x = r.replacements, ((b < 0 || b >= x.length) ? ($throwRuntimeError("index out of range"), undefined) : x[b])) === sliceType.nil) { */ case 3:
				i = i + (1) >> 0;
				/* continue; */ $s = 1; continue;
			/* } */ case 4:
			/* */ if (!((last === i))) { $s = 5; continue; }
			/* */ $s = 6; continue;
			/* if (!((last === i))) { */ case 5:
				_r = sw.WriteString($substring(s, last, i)); /* */ $s = 7; case 7: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_tuple = _r;
				nw = _tuple[0];
				err$1 = _tuple[1];
				n = n + (nw) >> 0;
				if (!($interfaceIsEqual(err$1, $ifaceNil))) {
					_tmp = n;
					_tmp$1 = err$1;
					n = _tmp;
					err = _tmp$1;
					$s = -1; return [n, err];
				}
			/* } */ case 6:
			last = i + 1 >> 0;
			_r$1 = w.Write((x$1 = r.replacements, ((b < 0 || b >= x$1.length) ? ($throwRuntimeError("index out of range"), undefined) : x$1[b]))); /* */ $s = 8; case 8: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_tuple$1 = _r$1;
			nw$1 = _tuple$1[0];
			err$2 = _tuple$1[1];
			n = n + (nw$1) >> 0;
			if (!($interfaceIsEqual(err$2, $ifaceNil))) {
				_tmp$2 = n;
				_tmp$3 = err$2;
				n = _tmp$2;
				err = _tmp$3;
				$s = -1; return [n, err];
			}
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		/* */ if (!((last === s.length))) { $s = 9; continue; }
		/* */ $s = 10; continue;
		/* if (!((last === s.length))) { */ case 9:
			nw$2 = 0;
			_r$2 = sw.WriteString($substring(s, last)); /* */ $s = 11; case 11: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			_tuple$2 = _r$2;
			nw$2 = _tuple$2[0];
			err = _tuple$2[1];
			n = n + (nw$2) >> 0;
		/* } */ case 10:
		$s = -1; return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: byteStringReplacer.ptr.prototype.WriteString }; } $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.b = b; $f.err = err; $f.err$1 = err$1; $f.err$2 = err$2; $f.i = i; $f.last = last; $f.n = n; $f.nw = nw; $f.nw$1 = nw$1; $f.nw$2 = nw$2; $f.r = r; $f.s = s; $f.sw = sw; $f.w = w; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	byteStringReplacer.prototype.WriteString = function(w, s) { return this.$val.WriteString(w, s); };
	makeStringFinder = function(pattern) {
		var _i, _ref, f, i, i$1, i$2, i$3, last, lastPrefix, lenSuffix, pattern, x, x$1, x$2, x$3, x$4, x$5;
		f = new stringFinder.ptr(pattern, arrayType$2.zero(), $makeSlice(sliceType$3, pattern.length));
		last = pattern.length - 1 >> 0;
		_ref = f.badCharSkip;
		_i = 0;
		while (true) {
			if (!(_i < 256)) { break; }
			i = _i;
			(x = f.badCharSkip, ((i < 0 || i >= x.length) ? ($throwRuntimeError("index out of range"), undefined) : x[i] = pattern.length));
			_i++;
		}
		i$1 = 0;
		while (true) {
			if (!(i$1 < last)) { break; }
			(x$1 = f.badCharSkip, x$2 = pattern.charCodeAt(i$1), ((x$2 < 0 || x$2 >= x$1.length) ? ($throwRuntimeError("index out of range"), undefined) : x$1[x$2] = (last - i$1 >> 0)));
			i$1 = i$1 + (1) >> 0;
		}
		lastPrefix = last;
		i$2 = last;
		while (true) {
			if (!(i$2 >= 0)) { break; }
			if (HasPrefix(pattern, $substring(pattern, (i$2 + 1 >> 0)))) {
				lastPrefix = i$2 + 1 >> 0;
			}
			(x$3 = f.goodSuffixSkip, ((i$2 < 0 || i$2 >= x$3.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$3.$array[x$3.$offset + i$2] = ((lastPrefix + last >> 0) - i$2 >> 0)));
			i$2 = i$2 - (1) >> 0;
		}
		i$3 = 0;
		while (true) {
			if (!(i$3 < last)) { break; }
			lenSuffix = longestCommonSuffix(pattern, $substring(pattern, 1, (i$3 + 1 >> 0)));
			if (!((pattern.charCodeAt((i$3 - lenSuffix >> 0)) === pattern.charCodeAt((last - lenSuffix >> 0))))) {
				(x$4 = f.goodSuffixSkip, x$5 = last - lenSuffix >> 0, ((x$5 < 0 || x$5 >= x$4.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$4.$array[x$4.$offset + x$5] = ((lenSuffix + last >> 0) - i$3 >> 0)));
			}
			i$3 = i$3 + (1) >> 0;
		}
		return f;
	};
	longestCommonSuffix = function(a, b) {
		var a, b, i;
		i = 0;
		while (true) {
			if (!(i < a.length && i < b.length)) { break; }
			if (!((a.charCodeAt(((a.length - 1 >> 0) - i >> 0)) === b.charCodeAt(((b.length - 1 >> 0) - i >> 0))))) {
				break;
			}
			i = i + (1) >> 0;
		}
		return i;
	};
	stringFinder.ptr.prototype.next = function(text) {
		var f, i, j, text, x, x$1, x$2;
		f = this;
		i = f.pattern.length - 1 >> 0;
		while (true) {
			if (!(i < text.length)) { break; }
			j = f.pattern.length - 1 >> 0;
			while (true) {
				if (!(j >= 0 && (text.charCodeAt(i) === f.pattern.charCodeAt(j)))) { break; }
				i = i - (1) >> 0;
				j = j - (1) >> 0;
			}
			if (j < 0) {
				return i + 1 >> 0;
			}
			i = i + (max((x = f.badCharSkip, x$1 = text.charCodeAt(i), ((x$1 < 0 || x$1 >= x.length) ? ($throwRuntimeError("index out of range"), undefined) : x[x$1])), (x$2 = f.goodSuffixSkip, ((j < 0 || j >= x$2.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$2.$array[x$2.$offset + j])))) >> 0;
		}
		return -1;
	};
	stringFinder.prototype.next = function(text) { return this.$val.next(text); };
	max = function(a, b) {
		var a, b;
		if (a > b) {
			return a;
		}
		return b;
	};
	HasPrefix = function(s, prefix) {
		var prefix, s;
		return s.length >= prefix.length && $substring(s, 0, prefix.length) === prefix;
	};
	$pkg.HasPrefix = HasPrefix;
	Map = function(mapping, s) {
		var _i, _i$1, _r, _r$1, _ref, _ref$1, _rune, _rune$1, _tuple, b, c, c$1, i, mapping, r, r$1, s, width, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _i = $f._i; _i$1 = $f._i$1; _r = $f._r; _r$1 = $f._r$1; _ref = $f._ref; _ref$1 = $f._ref$1; _rune = $f._rune; _rune$1 = $f._rune$1; _tuple = $f._tuple; b = $f.b; c = $f.c; c$1 = $f.c$1; i = $f.i; mapping = $f.mapping; r = $f.r; r$1 = $f.r$1; s = $f.s; width = $f.width; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		b = new Builder.ptr(ptrType.nil, sliceType.nil);
		_ref = s;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.length)) { break; } */ if(!(_i < _ref.length)) { $s = 2; continue; }
			_rune = $decodeRune(_ref, _i);
			i = _i;
			c = _rune[0];
			_r = mapping(c); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			r = _r;
			if ((r === c) && !((c === 65533))) {
				_i += _rune[1];
				/* continue; */ $s = 1; continue;
			}
			width = 0;
			if (c === 65533) {
				_tuple = utf8.DecodeRuneInString($substring(s, i));
				c = _tuple[0];
				width = _tuple[1];
				if (!((width === 1)) && (r === c)) {
					_i += _rune[1];
					/* continue; */ $s = 1; continue;
				}
			} else {
				width = utf8.RuneLen(c);
			}
			b.Grow(s.length + 4 >> 0);
			b.WriteString($substring(s, 0, i));
			if (r >= 0) {
				b.WriteRune(r);
			}
			s = $substring(s, (i + width >> 0));
			/* break; */ $s = 2; continue;
		/* } */ $s = 1; continue; case 2:
		if (b.Cap() === 0) {
			$s = -1; return s;
		}
		_ref$1 = s;
		_i$1 = 0;
		/* while (true) { */ case 4:
			/* if (!(_i$1 < _ref$1.length)) { break; } */ if(!(_i$1 < _ref$1.length)) { $s = 5; continue; }
			_rune$1 = $decodeRune(_ref$1, _i$1);
			c$1 = _rune$1[0];
			_r$1 = mapping(c$1); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			r$1 = _r$1;
			if (r$1 >= 0) {
				if (r$1 < 128) {
					b.WriteByte(((r$1 << 24 >>> 24)));
				} else {
					b.WriteRune(r$1);
				}
			}
			_i$1 += _rune$1[1];
		/* } */ $s = 4; continue; case 5:
		$s = -1; return b.String();
		/* */ } return; } if ($f === undefined) { $f = { $blk: Map }; } $f._i = _i; $f._i$1 = _i$1; $f._r = _r; $f._r$1 = _r$1; $f._ref = _ref; $f._ref$1 = _ref$1; $f._rune = _rune; $f._rune$1 = _rune$1; $f._tuple = _tuple; $f.b = b; $f.c = c; $f.c$1 = c$1; $f.i = i; $f.mapping = mapping; $f.r = r; $f.r$1 = r$1; $f.s = s; $f.width = width; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Map = Map;
	ToLower = function(s) {
		var _r, _tmp, _tmp$1, b, c, c$1, hasUpper, i, i$1, isASCII, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; b = $f.b; c = $f.c; c$1 = $f.c$1; hasUpper = $f.hasUpper; i = $f.i; i$1 = $f.i$1; isASCII = $f.isASCII; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tmp = true;
		_tmp$1 = false;
		isASCII = _tmp;
		hasUpper = _tmp$1;
		i = 0;
		while (true) {
			if (!(i < s.length)) { break; }
			c = s.charCodeAt(i);
			if (c >= 128) {
				isASCII = false;
				break;
			}
			hasUpper = hasUpper || (c >= 65 && c <= 90);
			i = i + (1) >> 0;
		}
		if (isASCII) {
			if (!hasUpper) {
				$s = -1; return s;
			}
			b = new Builder.ptr(ptrType.nil, sliceType.nil);
			b.Grow(s.length);
			i$1 = 0;
			while (true) {
				if (!(i$1 < s.length)) { break; }
				c$1 = s.charCodeAt(i$1);
				if (c$1 >= 65 && c$1 <= 90) {
					c$1 = c$1 + (32) << 24 >>> 24;
				}
				b.WriteByte(c$1);
				i$1 = i$1 + (1) >> 0;
			}
			$s = -1; return b.String();
		}
		_r = Map(unicode.ToLower, s); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ToLower }; } $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f.b = b; $f.c = c; $f.c$1 = c$1; $f.hasUpper = hasUpper; $f.i = i; $f.i$1 = i$1; $f.isASCII = isASCII; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.ToLower = ToLower;
	TrimLeftFunc = function(s, f) {
		var _r, f, i, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; f = $f.f; i = $f.i; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = indexFunc(s, f, false); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		i = _r;
		if (i === -1) {
			$s = -1; return "";
		}
		$s = -1; return $substring(s, i);
		/* */ } return; } if ($f === undefined) { $f = { $blk: TrimLeftFunc }; } $f._r = _r; $f.f = f; $f.i = i; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.TrimLeftFunc = TrimLeftFunc;
	TrimRightFunc = function(s, f) {
		var _r, _tuple, f, i, s, wid, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; f = $f.f; i = $f.i; s = $f.s; wid = $f.wid; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = lastIndexFunc(s, f, false); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		i = _r;
		if (i >= 0 && s.charCodeAt(i) >= 128) {
			_tuple = utf8.DecodeRuneInString($substring(s, i));
			wid = _tuple[1];
			i = i + (wid) >> 0;
		} else {
			i = i + (1) >> 0;
		}
		$s = -1; return $substring(s, 0, i);
		/* */ } return; } if ($f === undefined) { $f = { $blk: TrimRightFunc }; } $f._r = _r; $f._tuple = _tuple; $f.f = f; $f.i = i; $f.s = s; $f.wid = wid; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.TrimRightFunc = TrimRightFunc;
	TrimFunc = function(s, f) {
		var _r, _r$1, f, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; f = $f.f; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = TrimLeftFunc(s, f); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = TrimRightFunc(_r, f); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: TrimFunc }; } $f._r = _r; $f._r$1 = _r$1; $f.f = f; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.TrimFunc = TrimFunc;
	indexFunc = function(s, f, truth) {
		var _i, _r, _ref, _rune, f, i, r, s, truth, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _i = $f._i; _r = $f._r; _ref = $f._ref; _rune = $f._rune; f = $f.f; i = $f.i; r = $f.r; s = $f.s; truth = $f.truth; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_ref = s;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.length)) { break; } */ if(!(_i < _ref.length)) { $s = 2; continue; }
			_rune = $decodeRune(_ref, _i);
			i = _i;
			r = _rune[0];
			_r = f(r); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ if (_r === truth) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (_r === truth) { */ case 3:
				$s = -1; return i;
			/* } */ case 4:
			_i += _rune[1];
		/* } */ $s = 1; continue; case 2:
		$s = -1; return -1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: indexFunc }; } $f._i = _i; $f._r = _r; $f._ref = _ref; $f._rune = _rune; $f.f = f; $f.i = i; $f.r = r; $f.s = s; $f.truth = truth; $f.$s = $s; $f.$r = $r; return $f;
	};
	lastIndexFunc = function(s, f, truth) {
		var _r, _tuple, f, i, r, s, size, truth, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; f = $f.f; i = $f.i; r = $f.r; s = $f.s; size = $f.size; truth = $f.truth; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		i = s.length;
		/* while (true) { */ case 1:
			/* if (!(i > 0)) { break; } */ if(!(i > 0)) { $s = 2; continue; }
			_tuple = utf8.DecodeLastRuneInString($substring(s, 0, i));
			r = _tuple[0];
			size = _tuple[1];
			i = i - (size) >> 0;
			_r = f(r); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ if (_r === truth) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (_r === truth) { */ case 3:
				$s = -1; return i;
			/* } */ case 4:
		/* } */ $s = 1; continue; case 2:
		$s = -1; return -1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: lastIndexFunc }; } $f._r = _r; $f._tuple = _tuple; $f.f = f; $f.i = i; $f.r = r; $f.s = s; $f.size = size; $f.truth = truth; $f.$s = $s; $f.$r = $r; return $f;
	};
	TrimSpace = function(s) {
		var _r, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = TrimFunc(s, unicode.IsSpace); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: TrimSpace }; } $f._r = _r; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.TrimSpace = TrimSpace;
	ptrType.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "copyCheck", name: "copyCheck", pkg: "strings", typ: $funcType([], [], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Cap", name: "Cap", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Reset", name: "Reset", pkg: "", typ: $funcType([], [], false)}, {prop: "grow", name: "grow", pkg: "strings", typ: $funcType([$Int], [], false)}, {prop: "Grow", name: "Grow", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Write", name: "Write", pkg: "", typ: $funcType([sliceType], [$Int, $error], false)}, {prop: "WriteByte", name: "WriteByte", pkg: "", typ: $funcType([$Uint8], [$error], false)}, {prop: "WriteRune", name: "WriteRune", pkg: "", typ: $funcType([$Int32], [$Int, $error], false)}, {prop: "WriteString", name: "WriteString", pkg: "", typ: $funcType([$String], [$Int, $error], false)}];
	ptrType$7.methods = [{prop: "buildOnce", name: "buildOnce", pkg: "strings", typ: $funcType([], [], false)}, {prop: "build", name: "build", pkg: "strings", typ: $funcType([], [replacer], false)}, {prop: "Replace", name: "Replace", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "WriteString", name: "WriteString", pkg: "", typ: $funcType([io.Writer, $String], [$Int, $error], false)}];
	ptrType$2.methods = [{prop: "add", name: "add", pkg: "strings", typ: $funcType([$String, $String, $Int, ptrType$8], [], false)}];
	ptrType$8.methods = [{prop: "lookup", name: "lookup", pkg: "strings", typ: $funcType([$String, $Bool], [$String, $Int, $Bool], false)}, {prop: "Replace", name: "Replace", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "WriteString", name: "WriteString", pkg: "", typ: $funcType([io.Writer, $String], [$Int, $error], false)}];
	ptrType$3.methods = [{prop: "Write", name: "Write", pkg: "", typ: $funcType([sliceType], [$Int, $error], false)}, {prop: "WriteString", name: "WriteString", pkg: "", typ: $funcType([$String], [$Int, $error], false)}];
	stringWriter.methods = [{prop: "WriteString", name: "WriteString", pkg: "", typ: $funcType([$String], [$Int, $error], false)}];
	ptrType$9.methods = [{prop: "Replace", name: "Replace", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "WriteString", name: "WriteString", pkg: "", typ: $funcType([io.Writer, $String], [$Int, $error], false)}];
	ptrType$1.methods = [{prop: "Replace", name: "Replace", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "WriteString", name: "WriteString", pkg: "", typ: $funcType([io.Writer, $String], [$Int, $error], false)}];
	ptrType$10.methods = [{prop: "Replace", name: "Replace", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "WriteString", name: "WriteString", pkg: "", typ: $funcType([io.Writer, $String], [$Int, $error], false)}];
	ptrType$4.methods = [{prop: "next", name: "next", pkg: "strings", typ: $funcType([$String], [$Int], false)}];
	Builder.init("strings", [{prop: "addr", name: "addr", embedded: false, exported: false, typ: ptrType, tag: ""}, {prop: "buf", name: "buf", embedded: false, exported: false, typ: sliceType, tag: ""}]);
	Replacer.init("strings", [{prop: "once", name: "once", embedded: false, exported: false, typ: sync.Once, tag: ""}, {prop: "r", name: "r", embedded: false, exported: false, typ: replacer, tag: ""}, {prop: "oldnew", name: "oldnew", embedded: false, exported: false, typ: sliceType$1, tag: ""}]);
	replacer.init([{prop: "Replace", name: "Replace", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "WriteString", name: "WriteString", pkg: "", typ: $funcType([io.Writer, $String], [$Int, $error], false)}]);
	trieNode.init("strings", [{prop: "value", name: "value", embedded: false, exported: false, typ: $String, tag: ""}, {prop: "priority", name: "priority", embedded: false, exported: false, typ: $Int, tag: ""}, {prop: "prefix", name: "prefix", embedded: false, exported: false, typ: $String, tag: ""}, {prop: "next", name: "next", embedded: false, exported: false, typ: ptrType$2, tag: ""}, {prop: "table", name: "table", embedded: false, exported: false, typ: sliceType$2, tag: ""}]);
	genericReplacer.init("strings", [{prop: "root", name: "root", embedded: false, exported: false, typ: trieNode, tag: ""}, {prop: "tableSize", name: "tableSize", embedded: false, exported: false, typ: $Int, tag: ""}, {prop: "mapping", name: "mapping", embedded: false, exported: false, typ: arrayType, tag: ""}]);
	appendSliceWriter.init($Uint8);
	stringWriter.init("strings", [{prop: "w", name: "w", embedded: false, exported: false, typ: io.Writer, tag: ""}]);
	singleStringReplacer.init("strings", [{prop: "finder", name: "finder", embedded: false, exported: false, typ: ptrType$4, tag: ""}, {prop: "value", name: "value", embedded: false, exported: false, typ: $String, tag: ""}]);
	byteReplacer.init($Uint8, 256);
	byteStringReplacer.init("strings", [{prop: "replacements", name: "replacements", embedded: false, exported: false, typ: arrayType$1, tag: ""}, {prop: "toReplace", name: "toReplace", embedded: false, exported: false, typ: sliceType$1, tag: ""}]);
	stringFinder.init("strings", [{prop: "pattern", name: "pattern", embedded: false, exported: false, typ: $String, tag: ""}, {prop: "badCharSkip", name: "badCharSkip", embedded: false, exported: false, typ: arrayType$2, tag: ""}, {prop: "goodSuffixSkip", name: "goodSuffixSkip", embedded: false, exported: false, typ: sliceType$3, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = bytealg.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = unicode.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["main"] = (function() {
	var $pkg = {}, $init, godom, strings, sliceType, mapping, r, excludedElement, traverse, main;
	godom = $packages["github.com/siongui/godom"];
	strings = $packages["strings"];
	sliceType = $sliceType($String);
	traverse = function(elm) {
		var _entry, _i, _r, _r$1, _r$2, _ref, _tuple, elm, in$1, node, nodeType, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _entry = $f._entry; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _ref = $f._ref; _tuple = $f._tuple; elm = $f.elm; in$1 = $f.in$1; node = $f.node; nodeType = $f.nodeType; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		nodeType = elm.NodeType();
		/* */ if ((nodeType === 1) || (nodeType === 9)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if ((nodeType === 1) || (nodeType === 9)) { */ case 1:
			_r = strings.ToLower(elm.TagName()); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple = (_entry = excludedElement[$String.keyFor(_r)], _entry !== undefined ? [_entry.v, true] : [false, false]);
			in$1 = _tuple[1];
			if (in$1) {
				$s = -1; return;
			}
			_ref = elm.ChildNodes();
			_i = 0;
			/* while (true) { */ case 4:
				/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 5; continue; }
				node = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
				$r = traverse(node); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				_i++;
			/* } */ $s = 4; continue; case 5:
			$s = -1; return;
		/* } */ case 2:
		/* */ if (nodeType === 3) { $s = 7; continue; }
		/* */ $s = 8; continue;
		/* if (nodeType === 3) { */ case 7:
			_r$1 = strings.TrimSpace(elm.NodeValue()); /* */ $s = 9; case 9: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			v = _r$1;
			/* */ if (!(v === "")) { $s = 10; continue; }
			/* */ $s = 11; continue;
			/* if (!(v === "")) { */ case 10:
				_r$2 = r.Replace(v); /* */ $s = 12; case 12: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				$r = elm.SetNodeValue(_r$2); /* */ $s = 13; case 13: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 11:
			$s = -1; return;
		/* } */ case 8:
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: traverse }; } $f._entry = _entry; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._ref = _ref; $f._tuple = _tuple; $f.elm = elm; $f.in$1 = in$1; $f.node = node; $f.nodeType = nodeType; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	main = function() {
		var $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = traverse(godom.Document); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: main }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = godom.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strings.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		mapping = new sliceType(["\xE6\x9E\x9C\xE5\xBE\xB7\xE7\x91\xAA", "\xE5\x96\xAC\xE7\xAD\x94\xE6\x91\xA9", "\xE8\x8B\x9F\xE7\xAD\x94\xE9\xA6\xAC", "\xE5\x96\xAC\xE7\xAD\x94\xE6\x91\xA9", "\xE7\xB6\xAD\xE5\xB7\xB4\xE8\xA5\xBF", "\xE6\xAF\x97\xE5\xA9\x86\xE5\xB0\xB8", "\xE8\xA5\xBF\xE5\xA5\x87", "\xE5\xB0\xB8\xE6\xA3\x84", "\xE9\x9F\x8B\xE6\xB2\x99\xE8\x8F\xA9", "\xE6\xAF\x97\xE8\x88\x8D\xE6\xB5\xAE", "\xE5\x92\x96\xE5\x8F\xA4\xE4\xB8\x89\xE5\xA1\x94", "\xE6\x8B\x98\xE7\x95\x99\xE5\xAD\xAB", "\xE6\x9E\x9C\xE9\x82\xA3\xE5\x98\x8E\xE9\xA6\xAC\xE9\x82\xA3", "\xE6\x8B\x98\xE9\x82\xA3\xE5\x90\xAB\xE7\x89\x9F\xE5\xB0\xBC", "\xE5\x92\x96\xE6\xB2\x99\xE5\xB7\xB4", "\xE8\xBF\xA6\xE8\x91\x89", "\xE7\xBE\x8E\xE5\xBE\xB7\xE4\xBA\x9E", "\xE5\xBD\x8C\xE5\x8B\x92", "\xE6\xAF\x94\xE5\xBA\xAB", "\xE6\xAF\x94\xE4\xB8\x98", "\xE6\xB2\x99\xE5\x88\xA9\xE5\xAD\x90", "\xE8\x88\x8D\xE5\x88\xA9\xE5\xBC\x97", "\xE9\xA6\xAC\xE5\x93\x88\xE6\x91\xA9\xE5\x98\x8E\xE5\x96\x87\xE9\x82\xA3", "\xE6\x91\xA9\xE8\xA8\xB6\xE7\x9B\xAE\xE7\x8A\x8D\xE9\x80\xA3", "\xE6\x91\xA9\xE5\x98\x8E\xE5\x96\x87\xE9\x82\xA3", "\xE7\x9B\xAE\xE7\x8A\x8D\xE9\x80\xA3", "\xE9\xA6\xAC\xE5\x93\x88\xE5\x92\x96\xE6\xB2\x99\xE5\xB7\xB4", "\xE5\xA4\xA7\xE8\xBF\xA6\xE8\x91\x89", "\xE9\xA6\xAC\xE5\x93\x88\xE8\xBF\xA6\xE8\x91\x89", "\xE5\xA4\xA7\xE8\xBF\xA6\xE8\x91\x89", "\xE4\xBC\x8D\xE5\xB7\xB4\xE9\x9B\xA2", "\xE5\x84\xAA\xE5\xA9\x86\xE9\x9B\xA2", "\xE6\x8B\x89\xE8\x83\xA1\xE5\x96\x87", "\xE7\xBE\x85\xE7\x9D\xBA\xE7\xBE\x85", "\xE9\xA6\xAC\xE5\x93\x88\xE5\x92\x96\xE5\x90\x92\xE9\x82\xA3", "\xE6\x91\xA9\xE8\xA8\xB6\xE8\xBF\xA6\xE6\x97\x83\xE5\xBB\xB6", "\xE9\xA6\xAC\xE5\x93\x88\xE5\x92\x96\xE5\x90\x92\xE4\xBA\x9E\xE9\x82\xA3", "\xE6\x91\xA9\xE8\xA8\xB6\xE8\xBF\xA6\xE6\x97\x83\xE5\xBB\xB6", "\xE5\x92\x96\xE5\x90\x92\xE9\x82\xA3", "\xE8\xBF\xA6\xE6\x97\x83\xE5\xBB\xB6", "\xE6\x9C\xAC\xE9\x82\xA3.\xE6\xBB\xBF\xE7\xAD\x94\xE5\xB0\xBC\xE8\xA3\x9C\xE7\xAD\x94", "\xE5\xAF\x8C\xE6\xA8\x93\xE9\x82\xA3", "\xE6\xBB\xBF\xE7\xAD\x94\xE5\xB0\xBC\xE8\xA3\x9C\xE7\xAD\x94", "\xE6\xBB\xBF\xE6\x85\x88\xE5\xAD\x90", "\xE6\x9C\xAC\xE9\x82\xA3\xE7\x93\xA6\xE9\x81\x94\xE9\x82\xA3", "\xE5\xAF\x8C\xE6\xA8\x93\xE9\x82\xA3\xE7\x93\xA6\xE9\x81\x94\xE9\x82\xA3", "\xE6\x9C\xAC\xE9\x82\xA3", "\xE5\xAF\x8C\xE6\xA8\x93\xE9\x82\xA3", "\xE6\xBB\xBF\xE7\xAD\x94\xE5\xB0\xBC\xE5\xAD\x90", "\xE6\xBB\xBF\xE6\x85\x88\xE5\xAD\x90", "\xE9\xA6\xAC\xE5\x93\x88\xE6\x9E\x9C\xE6\x8F\x90\xE7\xAD\x94", "\xE6\x91\xA9\xE8\xA8\xB6\xE6\x8B\x98\xE7\xB5\xBA\xE7\xBE\x85", "\xE9\xA6\xAC\xE5\x93\x88\xE5\x92\x96\xE6\xAF\x94\xE9\x82\xA3", "\xE6\x91\xA9\xE8\xA8\xB6\xE5\x8A\xAB\xE8\xB3\x93\xE9\x82\xA3", "\xE5\x92\x96\xE6\xAF\x94\xE9\x82\xA3", "\xE5\x8A\xAB\xE8\xB3\x93\xE9\x82\xA3", "\xE9\x98\xBF\xE5\xA5\xB4\xE7\x9B\xA7\xE5\xA1\x94", "\xE9\x98\xBF\xE9\x82\xA3\xE5\xBE\x8B", "\xE9\x9B\xA3\xE9\x81\x94", "\xE9\x9B\xA3\xE9\x99\x80", "\xE6\x8B\x94\xE5\x8F\xA4\xE5\x96\x87", "\xE8\x96\x84\xE6\x8B\x98\xE7\xBE\x85", "\xE8\x98\x87\xE8\x8F\xA9\xE5\xB8\x9D", "\xE9\xA0\x88\xE8\x8F\xA9\xE6\x8F\x90", "\xE5\xAE\x89\xE9\x9B\x85\xE8\xA2\x9E\xE4\xB8\xB9\xE9\x9B\x85", "\xE9\x98\xBF\xE8\x8B\xA5\xE6\x86\x8D\xE9\x99\xB3\xE5\xA6\x82", "\xE8\xA2\x9E\xE4\xB8\xB9\xE9\x9B\x85", "\xE6\x86\x8D\xE9\x99\xB3\xE5\xA6\x82", "\xE9\x98\xBF\xE6\xB2\x99\xE5\x9F\xBA", "\xE9\x98\xBF\xE8\xAA\xAA\xE7\xA4\xBA", "\xE7\x95\xA2\xE9\x99\xB5\xE9\x81\x94\xE7\x93\xA6\xE5\xB7\xAE", "\xE7\x95\xA2\xE9\x99\xB5\xE4\xBC\xBD\xE5\xA9\x86\xE8\xB9\x89", "\xE5\x98\x8E\xE6\x97\xBA\xE5\xB7\xB4\xE5\xB8\x9D", "\xE6\x86\x8D\xE6\xA2\xB5\xE6\xB3\xA2\xE6\x8F\x90", "\xE5\x8B\x92\xE7\x93\xA6\xE7\xAD\x94", "\xE9\x9B\xA2\xE5\xA9\x86\xE5\xA4\x9A", "\xE9\x9B\xB7\xE7\x93\xA6\xE5\xA1\x94", "\xE9\x9B\xA2\xE5\xA9\x86\xE5\xA4\x9A", "\xE9\x9B\xB7\xE7\x93\xA6\xE9\x81\x94", "\xE9\x9B\xA2\xE8\xB6\x8A\xE5\x93\x86", "\xE9\x81\x94\xE6\x8B\x94\xE9\xA6\xAC\xE5\x96\x87\xE5\xAD\x90", "\xE9\x81\x9D\xE5\xA9\x86\xE6\x91\xA9\xE7\xBE\x85\xE5\xAD\x90", "\xE8\xB3\x93\xE5\x85\x9C\xE5\x96\x87\xE8\xB7\x8B\xE6\x8B\x89\xE5\xBA\xA6\xE9\x98\xBF\xE8\xBF\xA6", "\xE8\xB3\x93\xE9\xA0\xAD\xE7\x9B\xA7\xE9\xA0\x97\xE7\xBE\x85\xE5\xA2\xAE", "\xE6\x9C\xB1\xE8\x87\x98\xE8\x88\xAC\xE4\xBB\x96\xE5\x98\x8E", "\xE5\x91\xA8\xE5\x88\xA9\xE6\xA7\x83\xE9\x99\x80\xE4\xBC\xBD", "\xE5\x92\x96\xE5\x9A\x95\xE9\x81\x94\xE5\xA4\xB7", "\xE8\xBF\xA6\xE7\x95\x99\xE9\x99\x80\xE5\xA4\xB7", "\xE4\xBA\x9E\xE6\xB2\x99", "\xE8\x80\xB6\xE8\x88\x8D", "\xE9\x87\x91\xE6\xAF\x94\xE5\x96\x87", "\xE9\x87\x91\xE6\xAF\x98\xE7\xBE\x85", "\xE5\x87\x86\xE9\x81\x94", "\xE7\xB4\x94\xE9\x99\x80", "\xE8\x98\x87\xE8\xB7\x8B\xE9\x81\x94", "\xE9\xA0\x88\xE8\xB7\x8B\xE9\x99\x80\xE7\xBE\x85", "\xE8\xBF\xAD\xE7\x93\xA6\xE9\x81\x94\xE7\xAD\x94", "\xE6\x8F\x90\xE5\xA9\x86\xE9\x81\x94\xE5\xA4\x9A", "\xE5\xBE\x97\xE7\x93\xA6\xE9\x81\x94\xE7\xAD\x94", "\xE6\x8F\x90\xE5\xA9\x86\xE9\x81\x94\xE5\xA4\x9A", "\xE4\xBC\x8D\xE9\x81\x94\xE5\xA4\xB7", "\xE5\x84\xAA\xE9\x99\x80\xE5\xA4\xB7", "\xE4\xBC\x8D\xE5\xB7\xB4\xE9\x9B\xA3\xE9\x81\x94", "\xE8\xB7\x8B\xE9\x9B\xA3\xE9\x99\x80", "\xE9\x97\xA1\xE9\x82\xA3", "\xE8\xBB\x8A\xE5\x8C\xBF", "\xE9\xA6\xAC\xE8\x88\x88\xE5\xBE\xB7", "\xE6\x91\xA9\xE5\x93\x82\xE9\x99\x80", "\xE7\x91\xAA\xE6\xAC\xA3\xE5\xBE\xB7", "\xE6\x91\xA9\xE5\x93\x82\xE9\x99\x80", "\xE6\x8B\x94\xE5\xB8\x8C\xE4\xBA\x9E", "\xE5\xA9\x86\xE9\x86\xAF\xE8\xBF\xA6", "\xE6\xB1\xAA\xE7\xA9\x8D\xE6\x92\x92", "\xE5\xA9\x86\xE8\x80\x86\xE8\x88\x8D", "\xE6\xAF\x94\xE5\xBA\xAB\xE5\xB0\xBC", "\xE6\xAF\x94\xE4\xB8\x98\xE5\xB0\xBC", "\xE5\xB7\xB4\xE8\xBF\xA6\xE5\xB7\xB4\xE5\xB8\x9D\xE8\x8B\x9F\xE7\xAD\x94\xE5\xBD\x8C", "\xE6\xB3\xA2\xE9\x97\x8D\xE6\xB3\xA2\xE6\x8F\x90\xE7\x9E\xBF\xE6\x9B\x87\xE5\xBD\x8C", "\xE5\xB7\xB4\xE8\xBF\xA6\xE5\xB7\xB4\xE5\xB8\x9D", "\xE6\xB3\xA2\xE9\x97\x8D\xE6\xB3\xA2\xE6\x8F\x90", "\xE8\x8B\x9F\xE7\xAD\x94\xE5\xBD\x8C", "\xE7\x9E\xBF\xE6\x9B\x87\xE5\xBD\x8C", "\xE4\xBA\x9E\xE5\xA3\xBD\xE5\xA1\x94\xE6\x8B\x89", "\xE8\x80\xB6\xE8\xBC\xB8\xE9\x99\x80\xE7\xBE\x85", "\xE6\x9F\xAF\xE7\x91\xAA", "\xE5\xB7\xAE\xE6\x91\xA9", "\xE5\x9C\x9F\xE5\x96\x87\xE9\x9B\xA3\xE9\x81\x94", "\xE5\x81\xB7\xE8\x98\xAD\xE9\x9B\xA3\xE9\x99\x80", "\xE6\xA1\x91\xE5\x96\x80\xE8\x9C\x9C\xE5\xA6\xB2", "\xE5\x83\xA7\xE4\xBC\xBD\xE8\x9C\x9C\xE5\xA4\x9A", "\xE7\xA9\x8D\xE6\x92\x92\xE8\x8B\x9F\xE7\xAD\x94\xE5\xBD\x8C", "\xE7\xBF\x85\xE8\x88\x8D\xE5\x96\xAC\xE7\xAD\x94\xE5\xBD\x8C", "\xE7\xA9\x8D\xE6\x92\x92.\xE8\x8B\x9F\xE7\xAD\x94\xE5\xBD\x8C", "\xE7\xBF\x85\xE8\x88\x8D.\xE5\x96\xAC\xE7\xAD\x94\xE5\xBD\x8C", "\xE7\xA9\x8D\xE6\x92\x92\xE2\x80\xA7\xE8\x8B\x9F\xE7\xAD\x94\xE5\xBD\x8C", "\xE7\xBF\x85\xE8\x88\x8D\xE2\x80\xA7\xE5\x96\xAC\xE7\xAD\x94\xE5\xBD\x8C", "\xE7\xB4\xA2\xE9\x82\xA3", "\xE8\xBC\xB8\xE9\x82\xA3", "\xE5\xB7\xB4\xE7\xAD\x94\xE5\x90\x92\xE6\x8B\x89", "\xE6\xB3\xA2\xE7\xBE\x85\xE9\x81\xAE\xE9\x82\xA3", "\xE6\x97\x83\xE9\x81\x94\xE7\xBE\x85", "\xE6\x97\x83\xE6\xAA\x80\xE9\x82\xA3", "\xE7\x83\x8F\xE7\xAD\x94\xE6\x8B\x89", "\xE9\xAC\xB1\xE5\xA4\x9A\xE7\xBE\x85", "\xE7\xB6\xAD\xE6\x9C\xAB\xE7\xBE\x85", "\xE6\xAF\x98\xE6\x91\xA9\xE7\xBE\x85", "\xE4\xBC\x8A\xE8\xA5\xBF\xE9\x81\x94\xE8\xA5\xBF", "\xE4\xBC\x8A\xE5\xB8\xAB\xE9\x81\x94\xE6\x82\x89", "\xE9\x81\x94\xE7\x91\xAA\xE5\xB8\x9D\xE9\x82\xA3", "\xE6\x9B\x87\xE6\x91\xA9\xE6\x8F\x90\xE9\x82\xA3", "\xE6\x98\x86\xE9\x81\x94\xE6\x8B\x89\xE5\x85\x8B\xE8\x96\xA9", "\xE8\xBB\x8D\xE9\x99\x80\xE7\xBE\x85\xE6\x8B\x98\xE5\xA4\xB7\xE8\x96\xA9", "\xE5\x90\x89\xE7\xAD\x94", "\xE8\xB3\xAA\xE5\xA4\x9A\xE7\xBE\x85", "\xE4\xBC\x8D\xE5\x98\x8E", "\xE9\x83\x81\xE4\xBC\xBD", "\xE5\x9F\xBA\xE7\x93\xA6\xE5\x92\x96", "\xE8\x80\x86\xE5\xA9\x86", "\xE7\xB6\xAD\xE6\xB2\x99\xE5\x8D\xA1", "\xE6\xAF\x98\xE8\x88\x8D\xE4\xBD\x89", "\xE5\xA8\x81\xE6\xB2\x99\xE5\x92\x96", "\xE6\xAF\x98\xE8\x88\x8D\xE4\xBD\x89", "\xE7\x91\xAA\xE8\x8E\x89\xE5\x92\x96", "\xE6\x9C\xAB\xE5\x88\xA9", "\xE5\xBA\xAB\xE7\xAB\xB9\xE7\xAD\x94\xE6\x8B\x89", "\xE4\xB9\x85\xE5\xA3\xBD\xE5\xA4\x9A\xE7\xBE\x85", "\xE4\xBC\x8D\xE7\xAD\x94\xE6\x8B\x89\xE9\x9B\xA3\xE7\xAD\x94\xE6\xAF\x8D", "\xE9\xAC\xB1\xE5\xA4\x9A\xE7\xBE\x85\xE9\x9B\xA3\xE9\x99\x80\xE6\xAF\x8D", "\xE6\xB2\x99\xE7\x91\xAA\xE7\x93\xA6\xE5\xB8\x9D", "\xE5\xB7\xAE\xE6\x91\xA9\xE5\xA9\x86\xE5\xB8\x9D", "\xE9\x9D\xA2\xE9\x81\x94\xE5\x92\x96", "\xE9\x9D\xA2\xE6\x89\x98\xE8\xBF\xA6", "\xE6\x91\xB3\xE6\xB2\x99\xE4\xBC\xBD", "\xE7\x9E\xBF\xE6\xB2\x99\xE4\xBC\xBD", "\xE5\xAE\x89\xE5\xB7\xB4\xE6\x8B\x94\xE5\x88\xA9", "\xE8\x8F\xB4\xE5\xA9\x86\xE6\xB3\xA2\xE5\x88\xA9", "\xE5\xBA\xB5\xE5\xA9\x86\xE6\xB3\xA2\xE5\x88\xA9", "\xE8\x8F\xB4\xE5\xA9\x86\xE6\xB3\xA2\xE5\x88\xA9", "\xE8\xA5\xBF\xE5\x88\xA9\xE7\x91\xAA", "\xE5\xB8\xAB\xE5\x88\xA9\xE6\x91\xA9", "\xE6\xB2\x99\xE6\x8B\x89\xE7\x93\xA6\xE6\x8F\x90", "\xE5\xA8\x91\xE7\xBE\x85\xE8\xB7\x8B\xE6\x8F\x90", "\xE8\x96\xA9\xE5\x96\x87\xE7\x93\xA6\xE5\xB8\x9D", "\xE5\xA8\x91\xE7\xBE\x85\xE8\xB7\x8B\xE6\x8F\x90", "\xE5\x91\xB5\xE5\xA1\x94\xE5\x8D\xA1", "\xE5\x91\xB5\xE5\xA4\x9A", "\xE8\xB3\x93\xE6\xAF\x94\xE8\x96\xA9\xE6\x8B\x89", "\xE9\xA0\xBB\xE5\xA9\x86\xE5\xA8\x91\xE7\xBE\x85", "\xE5\xB7\xB4\xE8\xAC\x9D\xE9\x82\xA3\xE5\x9C\xB0", "\xE6\xB3\xA2\xE6\x96\xAF\xE5\x8C\xBF", "\xE4\xBC\x8D\xE9\x81\x94\xE4\xBA\x9E\xE9\x82\xA3", "\xE5\x84\xAA\xE5\xA1\xAB\xE7\x8E\x8B", "\xE9\x98\xBF\xE8\xBF\xA6\xE7\xAD\x94\xE6\xB2\x99\xE9\x83\xBD", "\xE9\x98\xBF\xE9\x97\x8D\xE4\xB8\x96", "\xE9\xA6\xAC\xE5\x93\x88\xE9\x82\xA3\xE9\xA6\xAC", "\xE6\x91\xA9\xE8\xA8\xB6\xE7\x94\xB7", "\xE7\xB6\xAD\xE9\x83\xBD\xE5\x99\xA0\xE8\xB7\x8B", "\xE6\xAF\x97\xE7\x90\x89\xE7\x92\x83", "\xE9\x98\xBF\xE9\xA6\x96\xE5\x92\x96", "\xE9\x98\xBF\xE8\x82\xB2\xE7\x8E\x8B", "\xE5\xBD\x8C\xE6\x9E\x97\xE9\x81\x94", "\xE5\xBD\x8C\xE8\x98\xAD\xE9\x99\x80", "\xE9\xA6\xAC\xE5\x98\x8E\xE5\xA1\x94", "\xE6\x91\xA9\xE6\x8F\xAD\xE9\x99\x80", "\xE9\xAB\x98\xE6\xB2\x99\xE5\x96\x87", "\xE6\x86\x8D\xE8\x96\xA9\xE7\xBE\x85", "\xE7\x93\xA6\xE5\x9F\xBA", "\xE8\xB7\x8B\xE8\x80\x86", "\xE5\x92\x96\xE8\xA5\xBF", "\xE8\xBF\xA6\xE5\xB0\xB8", "\xE9\xA6\xAC\xE5\x96\x87", "\xE6\x9C\xAB\xE7\xBE\x85", "\xE9\xA6\xAC\xE6\x8B\x89", "\xE6\x9C\xAB\xE7\xBE\x85", "\xE7\x9B\x8E\xE5\x98\x8E", "\xE9\xB4\xA6\xE4\xBC\xBD", "\xE5\x8F\xA4\xE7\x9B\xA7", "\xE4\xBF\xB1\xE7\x9B\xA7", "\xE7\x94\x98\xE5\xA1\x94\xE6\x8B\x89", "\xE7\x8A\x8D\xE9\x99\x80\xE7\xBE\x85", "\xE8\xB7\x8B\xE5\x98\x8E", "\xE5\xA9\x86\xE4\xBC\xBD", "\xE6\xB2\x99\xE7\x93\xA6\xE6\x8F\x90", "\xE8\x88\x8D\xE8\xA1\x9B", "\xE9\x9F\x8B\xE6\xB2\x99\xE9\x9B\xA2", "\xE6\xAF\x97\xE8\x88\x8D\xE9\x9B\xA2", "\xE5\xB7\xB4\xE6\x8B\x89\xE7\xB4\x8D\xE8\xA5\xBF", "\xE6\xB3\xA2\xE7\xBE\x85\xE5\xA5\x88", "\xE9\xAB\x98\xE8\xB3\x9E\xE6\xAF\x94", "\xE6\x86\x8D\xE8\xB3\x9E\xE5\xBD\x8C", "\xE5\xB7\xB4\xE5\x97\x92\xE5\x8E\x98\xE5\xAD\x90", "\xE6\xB3\xA2\xE5\x90\x92\xE9\x87\x90\xE5\xAD\x90", "\xE5\x92\x96\xE7\x95\xA2\xE5\x96\x87\xE7\x93\xA6\xE5\x9C\x9F", "\xE8\xBF\xA6\xE6\xAF\x97\xE7\xBE\x85\xE8\xA1\x9B", "\xE5\x80\xAB\xE6\xAF\x94\xE5\xB0\xBC", "\xE8\x97\x8D\xE6\xAF\x97\xE5\xB0\xBC", "\xE5\xB8\x83\xE5\xBE\xB7\xE5\x98\x8E\xE4\xBA\x9E", "\xE8\x8F\xA9\xE6\x8F\x90\xE4\xBC\xBD\xE8\x80\xB6", "\xE5\x8F\xA4\xE8\xA5\xBF\xE9\x82\xA3\xE6\x8B\x89", "\xE6\x8B\x98\xE5\xB0\xB8\xE9\x82\xA3\xE7\xBE\x85", "\xE5\xBA\xAB\xE5\xB8\x8C\xE9\x82\xA3\xE6\x8B\x89", "\xE6\x8B\x98\xE5\xB0\xB8\xE9\x82\xA3\xE7\xBE\x85", "\xE4\xBC\x8D\xE7\x9B\xA7\xE9\x9F\x8B\xE5\x96\x87", "\xE5\x84\xAA\xE6\xA8\x93\xE9\xA0\xBB\xE8\x9E\xBA", "\xE6\xA1\x91\xE5\x92\x96\xE6\xB2\x99", "\xE5\x83\xA7\xE4\xBC\xBD\xE6\x96\xBD", "\xE7\xAD\x94\xE5\x92\x96\xE8\xA5\xBF\xE5\x96\x87", "\xE5\x91\xBE\xE5\x8F\x89\xE5\xA7\x8B\xE7\xBE\x85", "\xE6\x8F\xAD\xE9\x81\x94\xE6\x9E\x97", "\xE7\xA5\x87\xE5\x9C\x92", "\xE6\x8F\xAD\xE9\x81\x94", "\xE7\xA5\x87\xE9\x99\x80", "\xE9\x98\xBF\xE6\x8B\x89\xE7\xB6\xAD", "\xE9\x98\xBF\xE7\xBE\x85\xE6\xAF\x98", "\xE5\xB7\xB4\xE5\xB8\x9D\xE6\x91\xA9\xE5\x8D\xA1", "\xE6\xB3\xA2\xE7\xBE\x85\xE6\x8F\x90\xE6\x9C\xA8\xE5\x8F\x89", "\xE4\xBC\x8D\xE6\xB3\xA2\xE8\x96\xA9\xE4\xBB\x96", "\xE5\xB8\x83\xE8\x96\xA9", "\xE5\xB7\xB4\xE6\x8B\x89\xE5\x9F\xBA\xE5\x98\x8E", "\xE6\xB3\xA2\xE7\xBE\x85\xE5\xA4\xB7", "\xE6\xA1\x91\xE5\x96\x80\xE5\x9C\xB0\xE8\xAC\x9D\xE6\xB2\x99", "\xE5\x83\xA7\xE6\xAE\x98", "\xE5\x83\xA7\xE5\xA7\x8B\xE7\xB5\x82", "\xE5\x83\xA7\xE6\xAE\x98", "\xE5\xB0\xBC\xE8\x96\xA9\xE8\x80\x86\xE4\xBA\x9E\xE5\xB7\xB4\xE5\x90\x89\xE5\xB8\x9D\xE4\xBA\x9E", "\xE5\xB0\xBC\xE8\x96\xA9\xE8\x80\x86\xE6\xB3\xA2\xE9\x80\xB8\xE6\x8F\x90", "\xE6\x8D\xA8\xE5\xBF\x83\xE5\xA2\xAE", "\xE5\xB0\xBC\xE8\x96\xA9\xE8\x80\x86\xE6\xB3\xA2\xE9\x80\xB8\xE6\x8F\x90", "\xE5\xB7\xB4\xE5\x90\x89\xE5\xB8\x9D\xE4\xBA\x9E", "\xE6\xB3\xA2\xE9\x80\xB8\xE6\x8F\x90", "\xE5\xBF\x83\xE5\xA2\xAE", "\xE6\xB3\xA2\xE9\x80\xB8\xE6\x8F\x90", "\xE5\x9C\x9F\xE5\x96\x87\xE5\x90\x92\xE4\xBA\x9E", "\xE5\x81\xB7\xE8\x98\xAD\xE9\x81\xAE", "\xE7\x94\x98\xE9\xA6\xAC", "\xE7\xBE\xAF\xE7\xA3\xA8", "\xE9\xA6\xAC\xE9\x82\xA3\xE7\xAD\x94", "\xE6\x91\xA9\xE9\x82\xA3\xE5\x9F\xB5", "\xE6\xB2\x99\xE9\xA6\xAC\xE5\x85\xA7\xE6\x8B\x89", "\xE6\xB2\x99\xE5\xBD\x8C", "\xE6\xB2\x99\xE9\xA6\xAC\xE5\x85\xA7\xE8\x8E\x89", "\xE6\xB2\x99\xE5\xBD\x8C\xE5\xB0\xBC", "\xE6\xA1\x91\xE5\x96\x80\xE5\xB8\x9D", "\xE5\x83\xA7\xE4\xBC\xBD\xE6\xA2\xA8", "\xE5\x92\x96\xE6\x8F\x90\xE9\x82\xA3", "\xE8\xBF\xA6\xE7\xB5\xBA\xE9\x82\xA3", "\xE9\x98\xBF\xE6\x8B\x89\xE6\xBC\xA2", "\xE9\x98\xBF\xE7\xBE\x85\xE6\xBC\xA2", "\xE5\xB7\xB4\xE6\x8B\x89\xE5\xAF\x86", "\xE6\xB3\xA2\xE7\xBE\x85\xE8\x9C\x9C", "\xE7\xB6\xAD\xE5\xB7\xB4\xE6\xB2\x99\xE9\x82\xA3", "\xE6\xAF\x98\xE9\x89\xA2\xE8\x88\x8D\xE9\x82\xA3", "\xE9\x98\xBF\xE5\x90\x92\xE5\x88\xA9\xE4\xBA\x9E", "\xE9\x98\xBF\xE9\x97\x8D\xE6\xA2\xA8", "\xE9\x83\xBD\xE8\xA5\xBF\xE7\xAD\x94", "\xE5\x85\x9C\xE7\x8E\x87", "\xE4\xB8\x89\xE5\x8D\x81\xE4\xB8\x89\xE5\xA4\xA9", "\xE5\xBF\x89\xE5\x88\xA9\xE5\xA4\xA9", "\xE4\xBA\x9E\xE9\xA6\xAC", "\xE5\xA4\x9C\xE6\x91\xA9", "\xE6\xB2\x99\xE5\x92\x96\xE5\xA4\xA9\xE5\xB8\x9D", "\xE5\xB8\x9D\xE9\x87\x8B\xE5\xA4\xA9", "\xE9\x9F\x8B\xE6\xB2\x99\xE7\x93\xA6\xE7\xB4\x8D", "\xE6\xAF\x97\xE6\xB2\x99\xE9\x96\x80", "\xE7\x94\x98\xE5\xA1\x94\xE6\x8B\x94", "\xE4\xB9\xBE\xE9\x97\xA5\xE5\xA9\x86", "\xE4\xBA\x9E\xE5\x8D\xA1", "\xE5\xA4\x9C\xE5\x8F\x89", "\xE5\x98\x8E\xE7\x9B\xA7\xE8\x87\x98", "\xE8\xBF\xA6\xE6\xA8\x93\xE7\xBE\x85", "\xE9\x82\xA3\xE6\x91\xA9", "\xE5\x8D\x97\xE7\x84\xA1", "\xE9\x98\xBF\xE8\x98\x87\xE7\xBE\x85", "\xE9\x98\xBF\xE4\xBF\xAE\xE7\xBE\x85", "\xE8\x96\xA9\xE5\xBA\xA6", "\xE5\x96\x84\xE5\x93\x89", "\xE7\x93\xA6\xE8\x96\xA9", "\xE5\x83\xA7\xE8\x87\x98", "\xE5\xAD\xA4\xE9\x82\xB8", "\xE8\x8C\x85\xE7\xAF\xB7", "\xE5\x9C\xA8\xE5\xAD\xB8\xE5\xB0\xBC", "\xE5\xBC\x8F\xE5\x8F\x89\xE6\x91\xA9\xE9\x82\xA3", "\xE8\xBF\x91\xE4\xBA\x8B\xE7\x94\xB7", "\xE5\x84\xAA\xE5\xA9\x86\xE5\xA1\x9E", "\xE7\x83\x8F\xE5\xB8\x95\xE8\x96\xA9\xE5\x92\x96", "\xE5\x84\xAA\xE5\xA9\x86\xE5\xA1\x9E", "\xE8\xBF\x91\xE4\xBA\x8B\xE5\xA5\xB3", "\xE5\x84\xAA\xE5\xA9\x86\xE5\xA4\xB7", "\xE7\x8D\xA8\xE8\xA6\xBA", "\xE8\xBE\x9F\xE6\x94\xAF\xE4\xBD\x9B", "\xE6\x9E\x97\xE9\x87\x8E", "\xE9\x98\xBF\xE8\x98\xAD\xE8\x8B\xA5", "\xE9\x81\xAE\xE7\xAD\x94", "\xE7\xA5\x87\xE9\x99\x80", "\xE6\xB2\x99\xE5\x88\xA9\xE8\xA3\x9C\xE7\xAD\x94", "\xE8\x88\x8D\xE5\x88\xA9\xE5\xBC\x97", "\xE5\xB7\xB4\xE6\x96\xAF\xE9\x82\xA3\xE5\x9C\xB0", "\xE6\xB3\xA2\xE6\x96\xAF\xE5\x8C\xBF", "\xE5\xAD\xAB\xE9\x81\x94\xE5\x88\xA9\xE5\x92\x96\xE6\x8B\x94\xE6\x8B\x89\xE5\xA4\x9A\xE7\x93\xA6\xE5\xA5\xA2", "\xE5\xAD\xAB\xE9\x99\x80\xE5\x88\xA9\xE8\xBF\xA6\xEF\xBC\x8E\xE5\xA9\x86\xE7\xBE\x85\xE5\xA2\xAE\xE9\x97\x8D", "\xE5\xAD\xAB\xE9\x81\x94\xE5\x88\xA9\xE5\x92\x96", "\xE5\xAD\xAB\xE9\x99\x80\xE5\x88\xA9\xE8\xBF\xA6", "\xE7\x89\x9F\xE5\x88\xA9\xE5\xB8\x95\xE8\xB0\xB7\xE9\x82\xA3", "\xE7\x89\x9F\xE7\x8A\x81\xE7\xA0\xB4\xE7\xBE\xA4\xE9\x82\xA3", "\xE9\x9F\x8B\xE5\xBE\x97\xE5\xB8\x8C\xE5\x92\x96", "\xE9\x9E\x9E\xE9\x99\x80\xE6\x8F\x90", "\xE9\x98\xBF\xE5\x88\xA9\xE4\xBB\x96", "\xE9\x98\xBF\xE6\xA2\xA8\xE5\x90\x92", "\xE6\xAF\x98\xE6\xBC\x8F\xE6\xA2\xAF\xE5\x92\x96", "\xE5\x8D\x91\xE7\x9B\xA7\xEF\xBC\x8E\xE5\xA9\x86\xE8\xB9\x89\xE5\xBB\xB6\xE9\x82\xA3", "\xE9\x9B\xA3\xE6\x8F\x90\xE9\x9B\x85", "\xE9\x9B\xA3\xE6\x8F\x90", "\xE9\xA0\x88\xE5\xA5\x87\xE6\x8F\x90\xE8\xA8\xB6", "\xE5\x96\x84\xE6\xAF\x98\xE6\x8F\x90\xE8\xA8\xB6", "\xE5\xA5\x87\xE6\x8F\x90\xE8\xA8\xB6", "\xE6\xAF\x98\xE6\x8F\x90\xE8\xA8\xB6", "\xE8\x96\xA9\xE9\x81\xAE\xE5\x92\x96", "\xE8\x96\xA9\xE9\x81\xAE", "\xE6\xB2\x99\xE5\xB8\x9D", "[\xE5\x8F\xA3*\xE8\x8D\xBC]\xE5\xB8\x9D", "\xE8\x88\x92\xE8\x8A\xAD\xE9\x81\x94", "\xE9\xA0\x88\xE8\xB7\x8B\xE9\x99\x80\xE7\xBE\x85", "\xE5\x87\xB1\xE7\x91\xAA", "\xE5\xB7\xAE\xE6\x91\xA9", "\xE5\x83\xA7\xE4\xBC\xBD. \xE7\xB1\xB3\xE5\xA1\x94", "\xE5\x83\xA7\xE4\xBC\xBD\xE8\x9C\x9C\xE5\xA4\x9A", "\xE7\x91\xAA\xE5\x8D\xB0\xE9\x81\x94", "\xE6\x91\xA9\xE5\x93\x82\xE9\x99\x80", "\xE5\xB8\x95\xE6\x89\x8E\xE4\xBD\xB3\xE6\x8B\x89", "\xE6\xB3\xA2\xE7\xBE\x85\xE9\x81\xAE\xE9\x82\xA3", "\xE5\xB7\xB4\xE7\xAD\x94\xE7\x8F\x88", "\xE6\xB3\xA2\xE7\xBE\x85\xE9\x81\xAE\xE9\x82\xA3", "\xE7\x8E\xBB\xE5\xA4\xA7\xE6\x98\x86\xE5\xA4\xA7\xE6\x8B\x89\xE7\xB5\xA6\xE6\xB2\x99", "\xE8\xBB\x8D\xE9\x99\x80\xE7\xBE\x85\xE6\x8B\x98\xE5\xA4\xB7\xE8\x96\xA9", "\xE8\xB7\x8B\xE9\x99\x80\xE8\xBB\x8D\xE9\x99\x80\xE7\xBE\x85\xE6\x8B\x98\xE5\xA4\xB7\xE5\x9C\x8B", "\xE8\xBB\x8D\xE9\x99\x80\xE7\xBE\x85\xE6\x8B\x98\xE5\xA4\xB7\xE8\x96\xA9", "\xE5\x90\xA7\xE5\x8F\xA4\xE5\x96\x87", "\xE8\x96\x84\xE6\x8B\x98\xE7\xBE\x85", "\xE6\x99\xAE\xE5\xBA\xAB\xE6\xB2\x99\xE6\x8F\x90", "\xE5\xBC\x97\xE5\x8A\xA0\xE6\xB2\x99", "\xE6\xB2\x99\xE9\xA6\xAC\xE5\x86\x85\xE6\x8B\x89", "\xE6\xB2\x99\xE5\xBD\x8C", "\xE5\xB7\xB4\xE6\x94\xAF\xE5\x92\x96\xE4\xBD\x9B", "\xE8\xBE\x9F\xE6\x94\xAF\xE4\xBD\x9B", "\xE6\xB2\x99\xE6\x8B\x89", "\xE5\xA8\x91\xE7\xBE\x85", "\xE9\x98\xBF\xE9\x9B\xA3\xE9\x81\x94", "\xE9\x98\xBF\xE9\x9B\xA3", "\xE5\xB8\x95\xE7\x93\xA6", "\xE6\xB3\xA2\xE5\xA9\x86\xE5\x9F\x8E", "\xE7\xB4\xA2\xE7\xAD\x94\xE8\x88\xAC\xE9\x82\xA3", "\xE9\xA0\x88\xE9\x99\x80\xE6\xB4\xB9", "\xE8\x96\xA9\xE5\x92\x96\xE9\x81\x94\xE5\x98\x8E\xE5\xBD\x8C", "\xE6\x96\xAF\xE9\x99\x80\xE5\x90\xAB", "\xE9\x98\xBF\xE9\x82\xA3\xE5\x98\x8E\xE5\xBD\x8C", "\xE9\x98\xBF\xE9\x82\xA3\xE5\x90\xAB", "\xE5\xA0\xAA\xE5\xA1\x94\xE5\x92\x96", "\xE7\x8A\x8D\xE5\xBA\xA6", "\xE8\x98\x87\xE8\xB7\x8B", "\xE9\xA0\x88\xE8\xB7\x8B", "\xE5\xA8\x81\xE8\xB7\x8B\xE6\x8B\x89", "\xE5\x8D\x97\xE5\xB1\xB1", "\xE5\xA8\x81\xE6\xB2\x99\xE5\xA0\xAA\xE9\xA6\xAC", "\xE6\xAF\x98\xE8\x88\x8D\xE7\xBE\xAF\xE7\xA3\xA8", "\xE7\xB6\xAD\xE9\x82\xA3\xE4\xBA\x9E", "\xE6\xAF\x98\xE5\xA5\x88\xE8\x80\xB6", "\xE9\x9F\x8B\xE7\xA2\x9F\xE5\x93\x88\xE7\x89\x9F\xE5\xB0\xBC", "\xE6\xAF\x98\xE6\x8F\x90\xE8\xA8\xB6\xE7\x89\x9F\xE5\xB0\xBC", "\xE5\x92\x96\xE6\x8B\x89\xE9\xBA\xBB", "\xE8\xBF\xA6\xE7\xBE\x85\xE6\x91\xA9", "\xE5\x8D\xA1\xE6\x8B\x89\xE7\x91\xAA", "\xE8\xBF\xA6\xE7\xBE\x85\xE6\x91\xA9", "\xE8\x91\x9B\xE6\x8B\x89\xE5\x98\x9B", "\xE8\xBF\xA6\xE7\xBE\x85\xE6\x91\xA9", "\xE8\xBF\xA6\xE6\x91\xA9\xE7\xBE\x85", "\xE8\xBF\xA6\xE7\xBE\x85\xE6\x91\xA9", "\xE8\x91\x9B\xE6\x8B\x89\xE7\x91\xAA", "\xE8\xBF\xA6\xE7\xBE\x85\xE6\x91\xA9", "\xE8\xBF\xA6\xE8\x97\x8D\xE7\xA3\xA8", "\xE8\xBF\xA6\xE7\xBE\x85\xE6\x91\xA9", "\xE5\x8D\xA1\xEF\xA4\xA5\xE6\x91\xA9", "\xE8\xBF\xA6\xE7\xBE\x85\xE6\x91\xA9", "\xE7\xBE\xAF\xE8\x87\x98\xE6\x91\xA9", "\xE8\xBF\xA6\xE7\xBE\x85\xE6\x91\xA9", "\xE6\x9E\x9C\xE5\xBE\xB7\xE7\x8E\x9B", "\xE4\xB9\x94\xE7\xAD\x94\xE6\x91\xA9", "\xE8\x8B\x9F\xE7\xAD\x94\xE9\xA9\xAC", "\xE4\xB9\x94\xE7\xAD\x94\xE6\x91\xA9", "\xE7\xBB\xB4\xE5\xB7\xB4\xE8\xA5\xBF", "\xE6\xAF\x97\xE5\xA9\x86\xE5\xB0\xB8", "\xE8\xA5\xBF\xE5\xA5\x87", "\xE5\xB0\xB8\xE5\xBC\x83", "\xE9\x9F\xA6\xE6\xB2\x99\xE8\x8F\xA9", "\xE6\xAF\x97\xE8\x88\x8D\xE6\xB5\xAE", "\xE5\x92\x96\xE5\x8F\xA4\xE4\xB8\x89\xE5\xA1\x94", "\xE6\x8B\x98\xE7\x95\x99\xE5\xAD\x99", "\xE6\x9E\x9C\xE9\x82\xA3\xE5\x98\x8E\xE9\xA9\xAC\xE9\x82\xA3", "\xE6\x8B\x98\xE9\x82\xA3\xE5\x90\xAB\xE7\x89\x9F\xE5\xB0\xBC", "\xE5\x92\x96\xE6\xB2\x99\xE5\xB7\xB4", "\xE8\xBF\xA6\xE5\x8F\xB6", "\xE7\xBE\x8E\xE5\xBE\xB7\xE4\xBA\x9A", "\xE5\xBC\xA5\xE5\x8B\x92", "\xE6\xAF\x94\xE5\xBA\x93", "\xE6\xAF\x94\xE4\xB8\x98", "\xE6\xB2\x99\xE5\x88\xA9\xE5\xAD\x90", "\xE8\x88\x8D\xE5\x88\xA9\xE5\xBC\x97", "\xE9\xA9\xAC\xE5\x93\x88\xE6\x91\xA9\xE5\x98\x8E\xE5\x96\x87\xE9\x82\xA3", "\xE6\x91\xA9\xE8\xAF\x83\xE7\x9B\xAE\xE7\x8A\x8D\xE8\xBF\x9E", "\xE6\x91\xA9\xE5\x98\x8E\xE5\x96\x87\xE9\x82\xA3", "\xE7\x9B\xAE\xE7\x8A\x8D\xE8\xBF\x9E", "\xE9\xA9\xAC\xE5\x93\x88\xE5\x92\x96\xE6\xB2\x99\xE5\xB7\xB4", "\xE5\xA4\xA7\xE8\xBF\xA6\xE5\x8F\xB6", "\xE9\xA9\xAC\xE5\x93\x88\xE8\xBF\xA6\xE5\x8F\xB6", "\xE5\xA4\xA7\xE8\xBF\xA6\xE5\x8F\xB6", "\xE4\xBC\x8D\xE5\xB7\xB4\xE7\xA6\xBB", "\xE4\xBC\x98\xE5\xA9\x86\xE7\xA6\xBB", "\xE6\x8B\x89\xE8\x83\xA1\xE5\x96\x87", "\xE7\xBD\x97\xE7\x9D\xBA\xE7\xBD\x97", "\xE9\xA9\xAC\xE5\x93\x88\xE5\x92\x96\xE5\x90\x92\xE9\x82\xA3", "\xE6\x91\xA9\xE8\xAF\x83\xE8\xBF\xA6\xE6\x97\x83\xE5\xBB\xB6", "\xE9\xA9\xAC\xE5\x93\x88\xE5\x92\x96\xE5\x90\x92\xE4\xBA\x9A\xE9\x82\xA3", "\xE6\x91\xA9\xE8\xAF\x83\xE8\xBF\xA6\xE6\x97\x83\xE5\xBB\xB6", "\xE5\x92\x96\xE5\x90\x92\xE9\x82\xA3", "\xE8\xBF\xA6\xE6\x97\x83\xE5\xBB\xB6", "\xE6\x9C\xAC\xE9\x82\xA3.\xE6\xBB\xA1\xE7\xAD\x94\xE5\xB0\xBC\xE8\xA1\xA5\xE7\xAD\x94", "\xE5\xAF\x8C\xE6\xA5\xBC\xE9\x82\xA3", "\xE6\xBB\xA1\xE7\xAD\x94\xE5\xB0\xBC\xE8\xA1\xA5\xE7\xAD\x94", "\xE6\xBB\xA1\xE6\x85\x88\xE5\xAD\x90", "\xE6\x9C\xAC\xE9\x82\xA3\xE7\x93\xA6\xE8\xBE\xBE\xE9\x82\xA3", "\xE5\xAF\x8C\xE6\xA5\xBC\xE9\x82\xA3\xE7\x93\xA6\xE8\xBE\xBE\xE9\x82\xA3", "\xE6\x9C\xAC\xE9\x82\xA3", "\xE5\xAF\x8C\xE6\xA5\xBC\xE9\x82\xA3", "\xE6\xBB\xA1\xE7\xAD\x94\xE5\xB0\xBC\xE5\xAD\x90", "\xE6\xBB\xA1\xE6\x85\x88\xE5\xAD\x90", "\xE9\xA9\xAC\xE5\x93\x88\xE6\x9E\x9C\xE6\x8F\x90\xE7\xAD\x94", "\xE6\x91\xA9\xE8\xAF\x83\xE6\x8B\x98\xE7\xB5\xBA\xE7\xBD\x97", "\xE9\xA9\xAC\xE5\x93\x88\xE5\x92\x96\xE6\xAF\x94\xE9\x82\xA3", "\xE6\x91\xA9\xE8\xAF\x83\xE5\x8A\xAB\xE5\xAE\xBE\xE9\x82\xA3", "\xE5\x92\x96\xE6\xAF\x94\xE9\x82\xA3", "\xE5\x8A\xAB\xE5\xAE\xBE\xE9\x82\xA3", "\xE9\x98\xBF\xE5\xA5\xB4\xE5\x8D\xA2\xE5\xA1\x94", "\xE9\x98\xBF\xE9\x82\xA3\xE5\xBE\x8B", "\xE9\x9A\xBE\xE8\xBE\xBE", "\xE9\x9A\xBE\xE9\x99\x80", "\xE6\x8B\x94\xE5\x8F\xA4\xE5\x96\x87", "\xE8\x96\x84\xE6\x8B\x98\xE7\xBD\x97", "\xE8\x8B\x8F\xE8\x8F\xA9\xE5\xB8\x9D", "\xE9\xA1\xBB\xE8\x8F\xA9\xE6\x8F\x90", "\xE5\xAE\x89\xE9\x9B\x85\xE8\xA1\xAE\xE4\xB8\xB9\xE9\x9B\x85", "\xE9\x98\xBF\xE8\x8B\xA5\xE6\x86\x8D\xE9\x99\x88\xE5\xA6\x82", "\xE8\xA1\xAE\xE4\xB8\xB9\xE9\x9B\x85", "\xE6\x86\x8D\xE9\x99\x88\xE5\xA6\x82", "\xE9\x98\xBF\xE6\xB2\x99\xE5\x9F\xBA", "\xE9\x98\xBF\xE8\xAF\xB4\xE7\xA4\xBA", "\xE6\xAF\x95\xE9\x99\xB5\xE8\xBE\xBE\xE7\x93\xA6\xE5\xB7\xAE", "\xE6\xAF\x95\xE9\x99\xB5\xE4\xBC\xBD\xE5\xA9\x86\xE8\xB9\x89", "\xE5\x98\x8E\xE6\x97\xBA\xE5\xB7\xB4\xE5\xB8\x9D", "\xE6\x86\x8D\xE6\xA2\xB5\xE6\xB3\xA2\xE6\x8F\x90", "\xE5\x8B\x92\xE7\x93\xA6\xE7\xAD\x94", "\xE7\xA6\xBB\xE5\xA9\x86\xE5\xA4\x9A", "\xE9\x9B\xB7\xE7\x93\xA6\xE5\xA1\x94", "\xE7\xA6\xBB\xE5\xA9\x86\xE5\xA4\x9A", "\xE9\x9B\xB7\xE7\x93\xA6\xE8\xBE\xBE", "\xE7\xA6\xBB\xE8\xB6\x8A\xE5\x93\x86", "\xE8\xBE\xBE\xE6\x8B\x94\xE9\xA9\xAC\xE5\x96\x87\xE5\xAD\x90", "\xE9\x81\x9D\xE5\xA9\x86\xE6\x91\xA9\xE7\xBD\x97\xE5\xAD\x90", "\xE5\xAE\xBE\xE5\x85\x9C\xE5\x96\x87\xE8\xB7\x8B\xE6\x8B\x89\xE5\xBA\xA6\xE9\x98\xBF\xE8\xBF\xA6", "\xE5\xAE\xBE\xE5\xA4\xB4\xE5\x8D\xA2\xE9\xA2\x87\xE7\xBD\x97\xE5\xA0\x95", "\xE6\x9C\xB1\xE8\x85\x8A\xE8\x88\xAC\xE4\xBB\x96\xE5\x98\x8E", "\xE5\x91\xA8\xE5\x88\xA9\xE7\x9B\x98\xE9\x99\x80\xE4\xBC\xBD", "\xE5\x92\x96\xE5\x99\x9C\xE8\xBE\xBE\xE5\xA4\xB7", "\xE8\xBF\xA6\xE7\x95\x99\xE9\x99\x80\xE5\xA4\xB7", "\xE4\xBA\x9A\xE6\xB2\x99", "\xE8\x80\xB6\xE8\x88\x8D", "\xE9\x87\x91\xE6\xAF\x94\xE5\x96\x87", "\xE9\x87\x91\xE6\xAF\x97\xE7\xBD\x97", "\xE5\x87\x86\xE8\xBE\xBE", "\xE7\xBA\xAF\xE9\x99\x80", "\xE8\x8B\x8F\xE8\xB7\x8B\xE8\xBE\xBE", "\xE9\xA1\xBB\xE8\xB7\x8B\xE9\x99\x80\xE7\xBD\x97", "\xE8\xBF\xAD\xE7\x93\xA6\xE8\xBE\xBE\xE7\xAD\x94", "\xE6\x8F\x90\xE5\xA9\x86\xE8\xBE\xBE\xE5\xA4\x9A", "\xE5\xBE\x97\xE7\x93\xA6\xE8\xBE\xBE\xE7\xAD\x94", "\xE6\x8F\x90\xE5\xA9\x86\xE8\xBE\xBE\xE5\xA4\x9A", "\xE4\xBC\x8D\xE8\xBE\xBE\xE5\xA4\xB7", "\xE4\xBC\x98\xE9\x99\x80\xE5\xA4\xB7", "\xE4\xBC\x8D\xE5\xB7\xB4\xE9\x9A\xBE\xE8\xBE\xBE", "\xE8\xB7\x8B\xE9\x9A\xBE\xE9\x99\x80", "\xE9\x98\x90\xE9\x82\xA3", "\xE8\xBD\xA6\xE5\x8C\xBF", "\xE9\xA9\xAC\xE5\x85\xB4\xE5\xBE\xB7", "\xE6\x91\xA9\xE5\x93\x82\xE9\x99\x80", "\xE7\x8E\x9B\xE6\xAC\xA3\xE5\xBE\xB7", "\xE6\x91\xA9\xE5\x93\x82\xE9\x99\x80", "\xE6\x8B\x94\xE5\xB8\x8C\xE4\xBA\x9A", "\xE5\xA9\x86\xE9\x86\xAF\xE8\xBF\xA6", "\xE6\xB1\xAA\xE7\xA7\xAF\xE6\x92\x92", "\xE5\xA9\x86\xE8\x80\x86\xE8\x88\x8D", "\xE6\xAF\x94\xE5\xBA\x93\xE5\xB0\xBC", "\xE6\xAF\x94\xE4\xB8\x98\xE5\xB0\xBC", "\xE5\xB7\xB4\xE8\xBF\xA6\xE5\xB7\xB4\xE5\xB8\x9D\xE8\x8B\x9F\xE7\xAD\x94\xE5\xBC\xA5", "\xE6\xB3\xA2\xE9\x97\x8D\xE6\xB3\xA2\xE6\x8F\x90\xE7\x9E\xBF\xE6\x98\x99\xE5\xBC\xA5", "\xE5\xB7\xB4\xE8\xBF\xA6\xE5\xB7\xB4\xE5\xB8\x9D", "\xE6\xB3\xA2\xE9\x97\x8D\xE6\xB3\xA2\xE6\x8F\x90", "\xE8\x8B\x9F\xE7\xAD\x94\xE5\xBC\xA5", "\xE7\x9E\xBF\xE6\x98\x99\xE5\xBC\xA5", "\xE4\xBA\x9A\xE5\xAF\xBF\xE5\xA1\x94\xE6\x8B\x89", "\xE8\x80\xB6\xE8\xBE\x93\xE9\x99\x80\xE7\xBD\x97", "\xE6\x9F\xAF\xE7\x8E\x9B", "\xE5\xB7\xAE\xE6\x91\xA9", "\xE5\x9C\x9F\xE5\x96\x87\xE9\x9A\xBE\xE8\xBE\xBE", "\xE5\x81\xB7\xE5\x85\xB0\xE9\x9A\xBE\xE9\x99\x80", "\xE6\xA1\x91\xE5\x96\x80\xE8\x9C\x9C\xE5\xA6\xB2", "\xE5\x83\xA7\xE4\xBC\xBD\xE8\x9C\x9C\xE5\xA4\x9A", "\xE7\xA7\xAF\xE6\x92\x92\xE8\x8B\x9F\xE7\xAD\x94\xE5\xBC\xA5", "\xE7\xBF\x85\xE8\x88\x8D\xE4\xB9\x94\xE7\xAD\x94\xE5\xBC\xA5", "\xE7\xA7\xAF\xE6\x92\x92.\xE8\x8B\x9F\xE7\xAD\x94\xE5\xBC\xA5", "\xE7\xBF\x85\xE8\x88\x8D.\xE4\xB9\x94\xE7\xAD\x94\xE5\xBC\xA5", "\xE7\xA7\xAF\xE6\x92\x92\xE2\x80\xA7\xE8\x8B\x9F\xE7\xAD\x94\xE5\xBC\xA5", "\xE7\xBF\x85\xE8\x88\x8D\xE2\x80\xA7\xE4\xB9\x94\xE7\xAD\x94\xE5\xBC\xA5", "\xE7\xB4\xA2\xE9\x82\xA3", "\xE8\xBE\x93\xE9\x82\xA3", "\xE5\xB7\xB4\xE7\xAD\x94\xE5\x90\x92\xE6\x8B\x89", "\xE6\xB3\xA2\xE7\xBD\x97\xE9\x81\xAE\xE9\x82\xA3", "\xE6\x97\x83\xE8\xBE\xBE\xE7\xBD\x97", "\xE6\x97\x83\xE6\xAA\x80\xE9\x82\xA3", "\xE4\xB9\x8C\xE7\xAD\x94\xE6\x8B\x89", "\xE9\x83\x81\xE5\xA4\x9A\xE7\xBD\x97", "\xE7\xBB\xB4\xE6\x9C\xAB\xE7\xBD\x97", "\xE6\xAF\x97\xE6\x91\xA9\xE7\xBD\x97", "\xE4\xBC\x8A\xE8\xA5\xBF\xE8\xBE\xBE\xE8\xA5\xBF", "\xE4\xBC\x8A\xE5\xB8\x88\xE8\xBE\xBE\xE6\x82\x89", "\xE8\xBE\xBE\xE7\x8E\x9B\xE5\xB8\x9D\xE9\x82\xA3", "\xE6\x98\x99\xE6\x91\xA9\xE6\x8F\x90\xE9\x82\xA3", "\xE6\x98\x86\xE8\xBE\xBE\xE6\x8B\x89\xE5\x85\x8B\xE8\x90\xA8", "\xE5\x86\x9B\xE9\x99\x80\xE7\xBD\x97\xE6\x8B\x98\xE5\xA4\xB7\xE8\x90\xA8", "\xE5\x90\x89\xE7\xAD\x94", "\xE8\xB4\xA8\xE5\xA4\x9A\xE7\xBD\x97", "\xE4\xBC\x8D\xE5\x98\x8E", "\xE9\x83\x81\xE4\xBC\xBD", "\xE5\x9F\xBA\xE7\x93\xA6\xE5\x92\x96", "\xE8\x80\x86\xE5\xA9\x86", "\xE7\xBB\xB4\xE6\xB2\x99\xE5\x8D\xA1", "\xE6\xAF\x97\xE8\x88\x8D\xE4\xBD\x89", "\xE5\xA8\x81\xE6\xB2\x99\xE5\x92\x96", "\xE6\xAF\x97\xE8\x88\x8D\xE4\xBD\x89", "\xE7\x8E\x9B\xE8\x8E\x89\xE5\x92\x96", "\xE6\x9C\xAB\xE5\x88\xA9", "\xE5\xBA\x93\xE7\xAB\xB9\xE7\xAD\x94\xE6\x8B\x89", "\xE4\xB9\x85\xE5\xAF\xBF\xE5\xA4\x9A\xE7\xBD\x97", "\xE4\xBC\x8D\xE7\xAD\x94\xE6\x8B\x89\xE9\x9A\xBE\xE7\xAD\x94\xE6\xAF\x8D", "\xE9\x83\x81\xE5\xA4\x9A\xE7\xBD\x97\xE9\x9A\xBE\xE9\x99\x80\xE6\xAF\x8D", "\xE6\xB2\x99\xE7\x8E\x9B\xE7\x93\xA6\xE5\xB8\x9D", "\xE5\xB7\xAE\xE6\x91\xA9\xE5\xA9\x86\xE5\xB8\x9D", "\xE9\x9D\xA2\xE8\xBE\xBE\xE5\x92\x96", "\xE9\x9D\xA2\xE6\x89\x98\xE8\xBF\xA6", "\xE6\x8A\xA0\xE6\xB2\x99\xE4\xBC\xBD", "\xE7\x9E\xBF\xE6\xB2\x99\xE4\xBC\xBD", "\xE5\xAE\x89\xE5\xB7\xB4\xE6\x8B\x94\xE5\x88\xA9", "\xE5\xBA\xB5\xE5\xA9\x86\xE6\xB3\xA2\xE5\x88\xA9", "\xE5\xBA\xB5\xE5\xA9\x86\xE6\xB3\xA2\xE5\x88\xA9", "\xE5\xBA\xB5\xE5\xA9\x86\xE6\xB3\xA2\xE5\x88\xA9", "\xE8\xA5\xBF\xE5\x88\xA9\xE7\x8E\x9B", "\xE5\xB8\x88\xE5\x88\xA9\xE6\x91\xA9", "\xE6\xB2\x99\xE6\x8B\x89\xE7\x93\xA6\xE6\x8F\x90", "\xE5\xA8\x91\xE7\xBD\x97\xE8\xB7\x8B\xE6\x8F\x90", "\xE8\x90\xA8\xE5\x96\x87\xE7\x93\xA6\xE5\xB8\x9D", "\xE5\xA8\x91\xE7\xBD\x97\xE8\xB7\x8B\xE6\x8F\x90", "\xE5\x91\xB5\xE5\xA1\x94\xE5\x8D\xA1", "\xE5\x91\xB5\xE5\xA4\x9A", "\xE5\xAE\xBE\xE6\xAF\x94\xE8\x90\xA8\xE6\x8B\x89", "\xE9\xA2\x91\xE5\xA9\x86\xE5\xA8\x91\xE7\xBD\x97", "\xE5\xB7\xB4\xE8\xB0\xA2\xE9\x82\xA3\xE5\x9C\xB0", "\xE6\xB3\xA2\xE6\x96\xAF\xE5\x8C\xBF", "\xE4\xBC\x8D\xE8\xBE\xBE\xE4\xBA\x9A\xE9\x82\xA3", "\xE4\xBC\x98\xE5\xA1\xAB\xE7\x8E\x8B", "\xE9\x98\xBF\xE8\xBF\xA6\xE7\xAD\x94\xE6\xB2\x99\xE9\x83\xBD", "\xE9\x98\xBF\xE9\x97\x8D\xE4\xB8\x96", "\xE9\xA9\xAC\xE5\x93\x88\xE9\x82\xA3\xE9\xA9\xAC", "\xE6\x91\xA9\xE8\xAF\x83\xE7\x94\xB7", "\xE7\xBB\xB4\xE9\x83\xBD\xE5\x93\x92\xE8\xB7\x8B", "\xE6\xAF\x97\xE7\x90\x89\xE7\x92\x83", "\xE9\x98\xBF\xE9\xA6\x96\xE5\x92\x96", "\xE9\x98\xBF\xE8\x82\xB2\xE7\x8E\x8B", "\xE5\xBC\xA5\xE6\x9E\x97\xE8\xBE\xBE", "\xE5\xBC\xA5\xE5\x85\xB0\xE9\x99\x80", "\xE9\xA9\xAC\xE5\x98\x8E\xE5\xA1\x94", "\xE6\x91\xA9\xE6\x8F\xAD\xE9\x99\x80", "\xE9\xAB\x98\xE6\xB2\x99\xE5\x96\x87", "\xE6\x86\x8D\xE8\x90\xA8\xE7\xBD\x97", "\xE7\x93\xA6\xE5\x9F\xBA", "\xE8\xB7\x8B\xE8\x80\x86", "\xE5\x92\x96\xE8\xA5\xBF", "\xE8\xBF\xA6\xE5\xB0\xB8", "\xE9\xA9\xAC\xE5\x96\x87", "\xE6\x9C\xAB\xE7\xBD\x97", "\xE9\xA9\xAC\xE6\x8B\x89", "\xE6\x9C\xAB\xE7\xBD\x97", "\xE7\x9B\x8E\xE5\x98\x8E", "\xE9\xB8\xAF\xE4\xBC\xBD", "\xE5\x8F\xA4\xE5\x8D\xA2", "\xE4\xBF\xB1\xE5\x8D\xA2", "\xE7\x94\x98\xE5\xA1\x94\xE6\x8B\x89", "\xE7\x8A\x8D\xE9\x99\x80\xE7\xBD\x97", "\xE8\xB7\x8B\xE5\x98\x8E", "\xE5\xA9\x86\xE4\xBC\xBD", "\xE6\xB2\x99\xE7\x93\xA6\xE6\x8F\x90", "\xE8\x88\x8D\xE5\x8D\xAB", "\xE9\x9F\xA6\xE6\xB2\x99\xE7\xA6\xBB", "\xE6\xAF\x97\xE8\x88\x8D\xE7\xA6\xBB", "\xE5\xB7\xB4\xE6\x8B\x89\xE7\xBA\xB3\xE8\xA5\xBF", "\xE6\xB3\xA2\xE7\xBD\x97\xE5\xA5\x88", "\xE9\xAB\x98\xE8\xB5\x8F\xE6\xAF\x94", "\xE6\x86\x8D\xE8\xB5\x8F\xE5\xBC\xA5", "\xE5\xB7\xB4\xE5\x97\x92\xE5\x8E\x98\xE5\xAD\x90", "\xE6\xB3\xA2\xE5\x90\x92\xE5\x8E\x98\xE5\xAD\x90", "\xE5\x92\x96\xE6\xAF\x95\xE5\x96\x87\xE7\x93\xA6\xE5\x9C\x9F", "\xE8\xBF\xA6\xE6\xAF\x97\xE7\xBD\x97\xE5\x8D\xAB", "\xE4\xBC\xA6\xE6\xAF\x94\xE5\xB0\xBC", "\xE8\x93\x9D\xE6\xAF\x97\xE5\xB0\xBC", "\xE5\xB8\x83\xE5\xBE\xB7\xE5\x98\x8E\xE4\xBA\x9A", "\xE8\x8F\xA9\xE6\x8F\x90\xE4\xBC\xBD\xE8\x80\xB6", "\xE5\x8F\xA4\xE8\xA5\xBF\xE9\x82\xA3\xE6\x8B\x89", "\xE6\x8B\x98\xE5\xB0\xB8\xE9\x82\xA3\xE7\xBD\x97", "\xE5\xBA\x93\xE5\xB8\x8C\xE9\x82\xA3\xE6\x8B\x89", "\xE6\x8B\x98\xE5\xB0\xB8\xE9\x82\xA3\xE7\xBD\x97", "\xE4\xBC\x8D\xE5\x8D\xA2\xE9\x9F\xA6\xE5\x96\x87", "\xE4\xBC\x98\xE6\xA5\xBC\xE9\xA2\x91\xE8\x9E\xBA", "\xE6\xA1\x91\xE5\x92\x96\xE6\xB2\x99", "\xE5\x83\xA7\xE4\xBC\xBD\xE6\x96\xBD", "\xE7\xAD\x94\xE5\x92\x96\xE8\xA5\xBF\xE5\x96\x87", "\xE5\x91\xBE\xE5\x8F\x89\xE5\xA7\x8B\xE7\xBD\x97", "\xE6\x8F\xAD\xE8\xBE\xBE\xE6\x9E\x97", "\xE5\x8F\xAA\xE5\x9B\xAD", "\xE6\x8F\xAD\xE8\xBE\xBE", "\xE5\x8F\xAA\xE9\x99\x80", "\xE9\x98\xBF\xE6\x8B\x89\xE7\xBB\xB4", "\xE9\x98\xBF\xE7\xBD\x97\xE6\xAF\x97", "\xE5\xB7\xB4\xE5\xB8\x9D\xE6\x91\xA9\xE5\x8D\xA1", "\xE6\xB3\xA2\xE7\xBD\x97\xE6\x8F\x90\xE6\x9C\xA8\xE5\x8F\x89", "\xE4\xBC\x8D\xE6\xB3\xA2\xE8\x90\xA8\xE4\xBB\x96", "\xE5\xB8\x83\xE8\x90\xA8", "\xE5\xB7\xB4\xE6\x8B\x89\xE5\x9F\xBA\xE5\x98\x8E", "\xE6\xB3\xA2\xE7\xBD\x97\xE5\xA4\xB7", "\xE6\xA1\x91\xE5\x96\x80\xE5\x9C\xB0\xE8\xB0\xA2\xE6\xB2\x99", "\xE5\x83\xA7\xE6\xAE\x8B", "\xE5\x83\xA7\xE5\xA7\x8B\xE7\xBB\x88", "\xE5\x83\xA7\xE6\xAE\x8B", "\xE5\xB0\xBC\xE8\x90\xA8\xE8\x80\x86\xE4\xBA\x9A\xE5\xB7\xB4\xE5\x90\x89\xE5\xB8\x9D\xE4\xBA\x9A", "\xE5\xB0\xBC\xE8\x90\xA8\xE8\x80\x86\xE6\xB3\xA2\xE9\x80\xB8\xE6\x8F\x90", "\xE8\x88\x8D\xE5\xBF\x83\xE5\xA0\x95", "\xE5\xB0\xBC\xE8\x90\xA8\xE8\x80\x86\xE6\xB3\xA2\xE9\x80\xB8\xE6\x8F\x90", "\xE5\xB7\xB4\xE5\x90\x89\xE5\xB8\x9D\xE4\xBA\x9A", "\xE6\xB3\xA2\xE9\x80\xB8\xE6\x8F\x90", "\xE5\xBF\x83\xE5\xA0\x95", "\xE6\xB3\xA2\xE9\x80\xB8\xE6\x8F\x90", "\xE5\x9C\x9F\xE5\x96\x87\xE5\x90\x92\xE4\xBA\x9A", "\xE5\x81\xB7\xE5\x85\xB0\xE9\x81\xAE", "\xE7\x94\x98\xE9\xA9\xAC", "\xE7\xBE\xAF\xE7\xA3\xA8", "\xE9\xA9\xAC\xE9\x82\xA3\xE7\xAD\x94", "\xE6\x91\xA9\xE9\x82\xA3\xE5\x9F\xB5", "\xE6\xB2\x99\xE9\xA9\xAC\xE5\x86\x85\xE6\x8B\x89", "\xE6\xB2\x99\xE5\xBC\xA5", "\xE6\xB2\x99\xE9\xA9\xAC\xE5\x86\x85\xE8\x8E\x89", "\xE6\xB2\x99\xE5\xBC\xA5\xE5\xB0\xBC", "\xE6\xA1\x91\xE5\x96\x80\xE5\xB8\x9D", "\xE5\x83\xA7\xE4\xBC\xBD\xE6\xA2\xA8", "\xE5\x92\x96\xE6\x8F\x90\xE9\x82\xA3", "\xE8\xBF\xA6\xE7\xB5\xBA\xE9\x82\xA3", "\xE9\x98\xBF\xE6\x8B\x89\xE6\xB1\x89", "\xE9\x98\xBF\xE7\xBD\x97\xE6\xB1\x89", "\xE5\xB7\xB4\xE6\x8B\x89\xE5\xAF\x86", "\xE6\xB3\xA2\xE7\xBD\x97\xE8\x9C\x9C", "\xE7\xBB\xB4\xE5\xB7\xB4\xE6\xB2\x99\xE9\x82\xA3", "\xE6\xAF\x97\xE9\x92\xB5\xE8\x88\x8D\xE9\x82\xA3", "\xE9\x98\xBF\xE5\x90\x92\xE5\x88\xA9\xE4\xBA\x9A", "\xE9\x98\xBF\xE9\x97\x8D\xE6\xA2\xA8", "\xE9\x83\xBD\xE8\xA5\xBF\xE7\xAD\x94", "\xE5\x85\x9C\xE7\x8E\x87", "\xE4\xB8\x89\xE5\x8D\x81\xE4\xB8\x89\xE5\xA4\xA9", "\xE5\xBF\x89\xE5\x88\xA9\xE5\xA4\xA9", "\xE4\xBA\x9A\xE9\xA9\xAC", "\xE5\xA4\x9C\xE6\x91\xA9", "\xE6\xB2\x99\xE5\x92\x96\xE5\xA4\xA9\xE5\xB8\x9D", "\xE5\xB8\x9D\xE9\x87\x8A\xE5\xA4\xA9", "\xE9\x9F\xA6\xE6\xB2\x99\xE7\x93\xA6\xE7\xBA\xB3", "\xE6\xAF\x97\xE6\xB2\x99\xE9\x97\xA8", "\xE7\x94\x98\xE5\xA1\x94\xE6\x8B\x94", "\xE5\xB9\xB2\xE9\x97\xBC\xE5\xA9\x86", "\xE4\xBA\x9A\xE5\x8D\xA1", "\xE5\xA4\x9C\xE5\x8F\x89", "\xE5\x98\x8E\xE5\x8D\xA2\xE8\x85\x8A", "\xE8\xBF\xA6\xE6\xA5\xBC\xE7\xBD\x97", "\xE9\x82\xA3\xE6\x91\xA9", "\xE5\x8D\x97\xE6\x97\xA0", "\xE9\x98\xBF\xE8\x8B\x8F\xE7\xBD\x97", "\xE9\x98\xBF\xE4\xBF\xAE\xE7\xBD\x97", "\xE8\x90\xA8\xE5\xBA\xA6", "\xE5\x96\x84\xE5\x93\x89", "\xE7\x93\xA6\xE8\x90\xA8", "\xE5\x83\xA7\xE8\x85\x8A", "\xE5\xAD\xA4\xE9\x82\xB8", "\xE8\x8C\x85\xE7\xAF\xB7", "\xE5\x9C\xA8\xE5\xAD\xA6\xE5\xB0\xBC", "\xE5\xBC\x8F\xE5\x8F\x89\xE6\x91\xA9\xE9\x82\xA3", "\xE8\xBF\x91\xE4\xBA\x8B\xE7\x94\xB7", "\xE4\xBC\x98\xE5\xA9\x86\xE5\xA1\x9E", "\xE4\xB9\x8C\xE5\xB8\x95\xE8\x90\xA8\xE5\x92\x96", "\xE4\xBC\x98\xE5\xA9\x86\xE5\xA1\x9E", "\xE8\xBF\x91\xE4\xBA\x8B\xE5\xA5\xB3", "\xE4\xBC\x98\xE5\xA9\x86\xE5\xA4\xB7", "\xE7\x8B\xAC\xE8\xA7\x89", "\xE8\xBE\x9F\xE6\x94\xAF\xE4\xBD\x9B", "\xE6\x9E\x97\xE9\x87\x8E", "\xE9\x98\xBF\xE5\x85\xB0\xE8\x8B\xA5", "\xE9\x81\xAE\xE7\xAD\x94", "\xE5\x8F\xAA\xE9\x99\x80", "\xE6\xB2\x99\xE5\x88\xA9\xE8\xA1\xA5\xE7\xAD\x94", "\xE8\x88\x8D\xE5\x88\xA9\xE5\xBC\x97", "\xE5\xB7\xB4\xE6\x96\xAF\xE9\x82\xA3\xE5\x9C\xB0", "\xE6\xB3\xA2\xE6\x96\xAF\xE5\x8C\xBF", "\xE5\xAD\x99\xE8\xBE\xBE\xE5\x88\xA9\xE5\x92\x96\xE6\x8B\x94\xE6\x8B\x89\xE5\xA4\x9A\xE7\x93\xA6\xE5\xA5\xA2", "\xE5\xAD\x99\xE9\x99\x80\xE5\x88\xA9\xE8\xBF\xA6\xEF\xBC\x8E\xE5\xA9\x86\xE7\xBD\x97\xE5\xA0\x95\xE9\x97\x8D", "\xE5\xAD\x99\xE8\xBE\xBE\xE5\x88\xA9\xE5\x92\x96", "\xE5\xAD\x99\xE9\x99\x80\xE5\x88\xA9\xE8\xBF\xA6", "\xE7\x89\x9F\xE5\x88\xA9\xE5\xB8\x95\xE8\xB0\xB7\xE9\x82\xA3", "\xE7\x89\x9F\xE7\x8A\x81\xE7\xA0\xB4\xE7\xBE\xA4\xE9\x82\xA3", "\xE9\x9F\xA6\xE5\xBE\x97\xE5\xB8\x8C\xE5\x92\x96", "\xE9\x9E\x9E\xE9\x99\x80\xE6\x8F\x90", "\xE9\x98\xBF\xE5\x88\xA9\xE4\xBB\x96", "\xE9\x98\xBF\xE6\xA2\xA8\xE5\x90\x92", "\xE6\xAF\x97\xE6\xBC\x8F\xE6\xA2\xAF\xE5\x92\x96", "\xE5\x8D\x91\xE5\x8D\xA2\xEF\xBC\x8E\xE5\xA9\x86\xE8\xB9\x89\xE5\xBB\xB6\xE9\x82\xA3", "\xE9\x9A\xBE\xE6\x8F\x90\xE9\x9B\x85", "\xE9\x9A\xBE\xE6\x8F\x90", "\xE9\xA1\xBB\xE5\xA5\x87\xE6\x8F\x90\xE8\xAF\x83", "\xE5\x96\x84\xE6\xAF\x97\xE6\x8F\x90\xE8\xAF\x83", "\xE5\xA5\x87\xE6\x8F\x90\xE8\xAF\x83", "\xE6\xAF\x97\xE6\x8F\x90\xE8\xAF\x83", "\xE8\x90\xA8\xE9\x81\xAE\xE5\x92\x96", "\xE8\x90\xA8\xE9\x81\xAE", "\xE6\xB2\x99\xE5\xB8\x9D", "[\xE5\x8F\xA3*\xE8\x8D\xBC]\xE5\xB8\x9D", "\xE8\x88\x92\xE8\x8A\xAD\xE8\xBE\xBE", "\xE9\xA1\xBB\xE8\xB7\x8B\xE9\x99\x80\xE7\xBD\x97", "\xE5\x87\xAF\xE7\x8E\x9B", "\xE5\xB7\xAE\xE6\x91\xA9", "\xE5\x83\xA7\xE4\xBC\xBD. \xE7\xB1\xB3\xE5\xA1\x94", "\xE5\x83\xA7\xE4\xBC\xBD\xE8\x9C\x9C\xE5\xA4\x9A", "\xE7\x8E\x9B\xE5\x8D\xB0\xE8\xBE\xBE", "\xE6\x91\xA9\xE5\x93\x82\xE9\x99\x80", "\xE5\xB8\x95\xE6\x89\x8E\xE4\xBD\xB3\xE6\x8B\x89", "\xE6\xB3\xA2\xE7\xBD\x97\xE9\x81\xAE\xE9\x82\xA3", "\xE5\xB7\xB4\xE7\xAD\x94\xE7\x8F\x88", "\xE6\xB3\xA2\xE7\xBD\x97\xE9\x81\xAE\xE9\x82\xA3", "\xE7\x8E\xBB\xE5\xA4\xA7\xE6\x98\x86\xE5\xA4\xA7\xE6\x8B\x89\xE7\xBB\x99\xE6\xB2\x99", "\xE5\x86\x9B\xE9\x99\x80\xE7\xBD\x97\xE6\x8B\x98\xE5\xA4\xB7\xE8\x90\xA8", "\xE8\xB7\x8B\xE9\x99\x80\xE5\x86\x9B\xE9\x99\x80\xE7\xBD\x97\xE6\x8B\x98\xE5\xA4\xB7\xE5\x9B\xBD", "\xE5\x86\x9B\xE9\x99\x80\xE7\xBD\x97\xE6\x8B\x98\xE5\xA4\xB7\xE8\x90\xA8", "\xE5\x90\xA7\xE5\x8F\xA4\xE5\x96\x87", "\xE8\x96\x84\xE6\x8B\x98\xE7\xBD\x97", "\xE6\x99\xAE\xE5\xBA\x93\xE6\xB2\x99\xE6\x8F\x90", "\xE5\xBC\x97\xE5\x8A\xA0\xE6\xB2\x99", "\xE6\xB2\x99\xE9\xA9\xAC\xE5\x86\x85\xE6\x8B\x89", "\xE6\xB2\x99\xE5\xBC\xA5", "\xE5\xB7\xB4\xE6\x94\xAF\xE5\x92\x96\xE4\xBD\x9B", "\xE8\xBE\x9F\xE6\x94\xAF\xE4\xBD\x9B", "\xE6\xB2\x99\xE6\x8B\x89", "\xE5\xA8\x91\xE7\xBD\x97", "\xE9\x98\xBF\xE9\x9A\xBE\xE8\xBE\xBE", "\xE9\x98\xBF\xE9\x9A\xBE", "\xE5\xB8\x95\xE7\x93\xA6", "\xE6\xB3\xA2\xE5\xA9\x86\xE5\x9F\x8E", "\xE7\xB4\xA2\xE7\xAD\x94\xE8\x88\xAC\xE9\x82\xA3", "\xE9\xA1\xBB\xE9\x99\x80\xE6\xB4\xB9", "\xE8\x90\xA8\xE5\x92\x96\xE8\xBE\xBE\xE5\x98\x8E\xE5\xBC\xA5", "\xE6\x96\xAF\xE9\x99\x80\xE5\x90\xAB", "\xE9\x98\xBF\xE9\x82\xA3\xE5\x98\x8E\xE5\xBC\xA5", "\xE9\x98\xBF\xE9\x82\xA3\xE5\x90\xAB", "\xE5\xA0\xAA\xE5\xA1\x94\xE5\x92\x96", "\xE7\x8A\x8D\xE5\xBA\xA6", "\xE8\x8B\x8F\xE8\xB7\x8B", "\xE9\xA1\xBB\xE8\xB7\x8B", "\xE5\xA8\x81\xE8\xB7\x8B\xE6\x8B\x89", "\xE5\x8D\x97\xE5\xB1\xB1", "\xE5\xA8\x81\xE6\xB2\x99\xE5\xA0\xAA\xE9\xA9\xAC", "\xE6\xAF\x97\xE8\x88\x8D\xE7\xBE\xAF\xE7\xA3\xA8", "\xE7\xBB\xB4\xE9\x82\xA3\xE4\xBA\x9A", "\xE6\xAF\x97\xE5\xA5\x88\xE8\x80\xB6", "\xE9\x9F\xA6\xE7\xA2\x9F\xE5\x93\x88\xE7\x89\x9F\xE5\xB0\xBC", "\xE6\xAF\x97\xE6\x8F\x90\xE8\xAF\x83\xE7\x89\x9F\xE5\xB0\xBC", "\xE5\x92\x96\xE6\x8B\x89\xE9\xBA\xBB", "\xE8\xBF\xA6\xE7\xBD\x97\xE6\x91\xA9", "\xE5\x8D\xA1\xE6\x8B\x89\xE7\x8E\x9B", "\xE8\xBF\xA6\xE7\xBD\x97\xE6\x91\xA9", "\xE8\x91\x9B\xE6\x8B\x89\xE5\x98\x9B", "\xE8\xBF\xA6\xE7\xBD\x97\xE6\x91\xA9", "\xE8\xBF\xA6\xE6\x91\xA9\xE7\xBD\x97", "\xE8\xBF\xA6\xE7\xBD\x97\xE6\x91\xA9", "\xE8\x91\x9B\xE6\x8B\x89\xE7\x8E\x9B", "\xE8\xBF\xA6\xE7\xBD\x97\xE6\x91\xA9", "\xE8\xBF\xA6\xE8\x93\x9D\xE7\xA3\xA8", "\xE8\xBF\xA6\xE7\xBD\x97\xE6\x91\xA9", "\xE5\x8D\xA1\xEF\xA4\xA5\xE6\x91\xA9", "\xE8\xBF\xA6\xE7\xBD\x97\xE6\x91\xA9", "\xE7\xBE\xAF\xE8\x85\x8A\xE6\x91\xA9", "\xE8\xBF\xA6\xE7\xBD\x97\xE6\x91\xA9"]);
		r = strings.NewReplacer(mapping);
		excludedElement = $makeMap($String.keyFor, [{ k: "style", v: true }, { k: "script", v: true }, { k: "noscript", v: true }, { k: "iframe", v: true }, { k: "object", v: true }]);
		/* */ if ($pkg === $mainPkg) { $s = 3; continue; }
		/* */ $s = 4; continue;
		/* if ($pkg === $mainPkg) { */ case 3:
			$r = main(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$mainFinished = true;
		/* } */ case 4:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$synthesizeMethods();
var $mainPkg = $packages["main"];
$packages["runtime"].$init();
$go($mainPkg.$init, []);
$flushConsole();

}).call(this);
//# sourceMappingURL=cc.js.map
