"use strict";
module.exports = function() {
var ASSERT = require("./assert.js");
var util = require("./util.js");
var async = require("./async.js");
var errors = require("./errors.js");
var global = require("./global.js");

var INTERNAL = function(){};
var APPLY = {};
var NEXT_FILTER = {e: null};

var CapturedTrace = require("./captured_trace.js")();

var errorObj = util.errorObj;
var tryCatch1 = util.tryCatch1;
var RangeError = errors.RangeError;
var TypeError = errors.TypeError;
var TimeoutError = errors.TimeoutError;
var RejectionError = errors.RejectionError;
var markAsOriginatingFromRejection = errors.markAsOriginatingFromRejection;
var canAttach = errors.canAttach;

var setPrototypeOf = Object.setPrototypeOf
    ? Object.setPrototypeOf
    : function (obj,proto) {
          /* jshint -W103 */
          obj.__proto__ = proto;
          /* jshint +W103 */
      };

var makeSelfResolutionError = function Promise$_makeSelfResolutionError() {
    return new TypeError(CIRCULAR_RESOLUTION_ERROR);
};

function isPromise(obj) {
    if (obj === void 0) return false;
    return obj instanceof Promise;
}

var id = 0;
function Promise(resolver) {
    if (typeof resolver !== "function") {
        throw new TypeError(CONSTRUCT_ERROR_ARG);
    }
    var self;
    if (this==null || this.constructor !== Promise) {
        self = function(resolve){
            return self._then(
                function(V) { return resolve(null,V); },
                resolve, void 0, void 0, void 0);
        };
        setPrototypeOf(self, Promise.prototype);
    }
    else {
        throw new TypeError(CONSTRUCT_ERROR_INVOCATION);
    }
    self.domain = global.process ? global.process.domain : null;
    //see constants.js for layout
    self._bitField = NO_STATE;
    //Since most promises have exactly 1 parallel handler
    //store the first ones directly on the object
    //The rest (if needed) are stored on the object's
    //elements array (this[0], this[1]...etc)
    //which has less indirection than when using external array
    self._fulfillmentHandler0 = void 0;
    self._rejectionHandler0 = void 0;
    self._promise0 = void 0;
    self._receiver0 = void 0;
    //reason for rejection or fulfilled value
    self._settledValue = void 0;
    //for .bind
    self._boundTo = void 0;
    if (debugging) self._objid = ++id;
    if (resolver !== INTERNAL) self._resolveFromResolver(resolver);
    return self;
}

Promise.prototype.toString = function Promise$toString() {
    return "[object Promise"+(this._objid?"#"+this._objid:"")+"]";
};

Promise.prototype.caught = Promise.prototype["catch"] =
function Promise$catch(fn) {
    return this._then(void 0, fn, void 0, void 0, void 0);
};

Promise.prototype.then =
function Promise$then(didFulfill, didReject, didProgress) {
    return this._then(didFulfill, didReject, didProgress,
        void 0, void 0);
};

Promise.resolve =
function Promise$Resolve(error, value, caller) {
    return error==null ? Promise.fulfill(value,caller) : Promise.reject(error);
};

Promise.fulfill =
function Promise$Resolve(value) {
    var ret = Promise(INTERNAL);
    ret._setTrace(void 0);
    if (ret._tryFollow(value)) {
        return ret;
    }
    ret._setFulfilled();
    ret._settledValue = value;
    return ret;
};

Promise.reject = function Promise$Reject(reason) {
    var ret = Promise(INTERNAL);
    ret._setTrace(void 0);
    markAsOriginatingFromRejection(reason);
    ret._setRejected();
    ret._settledValue = reason;
    if (!canAttach(reason)) {
        var trace = new Error(reason + "");
        ret._setCarriedStackTrace(trace);
    }
    ret._ensurePossibleRejectionHandled();
    return ret;
};

Promise.prototype._resolveFromSyncValue =
function Promise$_resolveFromSyncValue(value) {
    if (value === errorObj) {
        this._setRejected();
        this._settledValue = value.e;
        this._ensurePossibleRejectionHandled();
    }
    else {
        var maybePromise = Promise._cast(value, void 0);
        if (maybePromise instanceof Promise) {
            this._follow(maybePromise);
        }
        else {
            this._setFulfilled();
            this._settledValue = value;
        }
    }
};

Promise.defer = function () {
    var resolver;
    var P = Promise(function(R){ resolver = R; });
    resolver.promise = P;
    return resolver;
};

Promise.andMaybeCallback =
function (then,resolvecb) {
    var P = Promise(resolvecb);
    if (then) P(then);
    return P;
};

Promise.cast = function Promise$_Cast(obj) {
    var ret = Promise._cast(obj, void 0);
    if (!(ret instanceof Promise)) {
        return Promise.resolve(ret);
    }
    return ret;
};

var debugging = __DEBUG__ || !!(
    typeof process !== "undefined" &&
    typeof process.execPath === "string" &&
    typeof process.env === "object" &&
    (process.env["BLUEBIRD_DEBUG"] ||
        process.env["NODE_ENV"] === "development")
);


Promise.longStackTraces = function Promise$LongStackTraces() {
    if (async.haveItemsQueued() &&
        debugging === false
   ) {
        throw new Error(LONG_STACK_TRACES_ERROR);
    }
    debugging = CapturedTrace.isSupported();
};

Promise.hasLongStackTraces = function Promise$HasLongStackTraces() {
    return debugging && CapturedTrace.isSupported();
};

Promise.prototype._setProxyHandlers =
function Promise$_setProxyHandlers(receiver, promiseSlotValue) {
    var index = this._length();

    if (index >= MAX_LENGTH - CALLBACK_SIZE) {
        index = 0;
        this._setLength(0);
    }
    if (index === 0) {
        this._promise0 = promiseSlotValue;
        this._receiver0 = receiver;
    }
    else {
        var i = index - CALLBACK_SIZE;
        this[i + CALLBACK_PROMISE_OFFSET] = promiseSlotValue;
        this[i + CALLBACK_RECEIVER_OFFSET] = receiver;
        this[i + CALLBACK_FULFILL_OFFSET] =
        this[i + CALLBACK_REJECT_OFFSET] =
        this[i + CALLBACK_PROGRESS_OFFSET] = void 0;
    }
    this._setLength(index + CALLBACK_SIZE);
};

Promise.prototype._proxyPromise = function Promise$_proxyPromise(promise) {
    ASSERT(!promise._isProxied());
    ASSERT(!this.isResolved());
    ASSERT(arguments.length === 1);
    promise._setProxied();
    this._setProxyHandlers(promise, -1);
};

Promise.prototype._then =
function Promise$_then(
    didFulfill,
    didReject,
    didProgress,
    receiver,
    internalData
) {
    ASSERT(arguments.length === 5);
    var haveInternalData = internalData !== void 0;
    var ret = haveInternalData ? internalData : Promise(INTERNAL);

    if (debugging && !haveInternalData) {
        var haveSameContext = this._peekContext() === this._traceParent;
        ret._traceParent = haveSameContext ? this._traceParent : this;
        ret._setTrace(this);
    }

    if (!haveInternalData && this._isBound()) {
        ret._setBoundTo(this._boundTo);
    }

    var callbackIndex =
        this._addCallbacks(didFulfill, didReject, didProgress, ret, receiver);

    if (this.isResolved()) {
        async.invoke(this._queueSettleAt, this, callbackIndex);
    }

    return ret;
};

Promise.prototype._length = function Promise$_length() {
    ASSERT(isPromise(this));
    ASSERT(arguments.length === 0);
    return this._bitField & LENGTH_MASK;
};

Promise.prototype.isFulfilled = function Promise$isFulfilled() {
    return (this._bitField & IS_FULFILLED) > 0;
};

Promise.prototype.isRejected = function Promise$isRejected() {
    return (this._bitField & IS_REJECTED) > 0;
};

Promise.prototype.isPending = function Promise$isPending() {
    return (this._bitField & IS_REJECTED_OR_FULFILLED) === 0;
};

Promise.prototype.isResolved = function Promise$isResolved() {
    return (this._bitField & IS_REJECTED_OR_FULFILLED) > 0;
};

Promise.prototype._isFollowingOrFulfilledOrRejected =
function Promise$_isFollowingOrFulfilledOrRejected() {
    return (this._bitField & IS_FOLLOWING_OR_REJECTED_OR_FULFILLED) > 0;
};

Promise.prototype._isFollowing = function Promise$_isFollowing() {
    return (this._bitField & IS_FOLLOWING) === IS_FOLLOWING;
};

Promise.prototype._setLength = function Promise$_setLength(len) {
    this._bitField = (this._bitField & LENGTH_CLEAR_MASK) |
        (len & LENGTH_MASK);
};

Promise.prototype._setFulfilled = function Promise$_setFulfilled() {
    this._bitField = this._bitField | IS_FULFILLED;
};

Promise.prototype._setRejected = function Promise$_setRejected() {
    this._bitField = this._bitField | IS_REJECTED;
};

Promise.prototype._setFollowing = function Promise$_setFollowing() {
    this._bitField = this._bitField | IS_FOLLOWING;
};

Promise.prototype._setRejectionIsUnhandled =
function Promise$_setRejectionIsUnhandled() {
    ASSERT(this.isRejected());
    this._bitField = this._bitField | IS_REJECTION_UNHANDLED;
};

Promise.prototype._unsetRejectionIsUnhandled =
function Promise$_unsetRejectionIsUnhandled() {
    this._bitField = this._bitField & (~IS_REJECTION_UNHANDLED);
    if (this._isUnhandledRejectionNotified()) {
        this._unsetUnhandledRejectionIsNotified();
    }
};

Promise.prototype._isRejectionUnhandled =
function Promise$_isRejectionUnhandled() {
    return (this._bitField & IS_REJECTION_UNHANDLED) > 0;
};

Promise.prototype._setUnhandledRejectionIsNotified =
function Promise$_setUnhandledRejectionIsNotified() {
    this._bitField = this._bitField | IS_UNHANDLED_REJECTION_NOTIFIED;
};

Promise.prototype._unsetUnhandledRejectionIsNotified =
function Promise$_unsetUnhandledRejectionIsNotified() {
    this._bitField = this._bitField & (~IS_UNHANDLED_REJECTION_NOTIFIED);
};

Promise.prototype._isUnhandledRejectionNotified =
function Promise$_isUnhandledRejectionNotified() {
    return (this._bitField & IS_UNHANDLED_REJECTION_NOTIFIED) > 0;
};

Promise.prototype._setCarriedStackTrace =
function Promise$_setCarriedStackTrace(capturedTrace) {
    ASSERT(this.isRejected());
    this._bitField = this._bitField | IS_CARRYING_STACK_TRACE;
    //Since this field is not used in rejected promises, smuggle the trace there
    this._fulfillmentHandler0 = capturedTrace;
};

Promise.prototype._unsetCarriedStackTrace =
function Promise$_unsetCarriedStackTrace() {
    ASSERT(this.isRejected());
    this._bitField = this._bitField & (~IS_CARRYING_STACK_TRACE);
    this._fulfillmentHandler0 = void 0;
};

Promise.prototype._isCarryingStackTrace =
function Promise$_isCarryingStackTrace() {
    return (this._bitField & IS_CARRYING_STACK_TRACE) > 0;
};

Promise.prototype._getCarriedStackTrace =
function Promise$_getCarriedStackTrace() {
    ASSERT(this.isRejected());
    return this._isCarryingStackTrace()
        ? this._fulfillmentHandler0
        : void 0;
};

Promise.prototype._receiverAt = function Promise$_receiverAt(index) {
    ASSERT(typeof index === "number");
    ASSERT(index >= 0);
    ASSERT(index % CALLBACK_SIZE === 0);

    var ret;
    if (index === 0) {
        ret = this._receiver0;
    }
    else {
        ret = this[index + CALLBACK_RECEIVER_OFFSET - CALLBACK_SIZE];
    }
    //Only use the bound value when not calling internal methods
    if (this._isBound() && ret === void 0) {
        return this._boundTo;
    }
    return ret;
};

Promise.prototype._promiseAt = function Promise$_promiseAt(index) {
    ASSERT(typeof index === "number");
    ASSERT(index >= 0);
    ASSERT(index % CALLBACK_SIZE === 0);
    if (index === 0) return this._promise0;
    return this[index + CALLBACK_PROMISE_OFFSET - CALLBACK_SIZE];
};

Promise.prototype._fulfillmentHandlerAt =
function Promise$_fulfillmentHandlerAt(index) {
    ASSERT(typeof index === "number");
    ASSERT(index >= 0);
    ASSERT(index % CALLBACK_SIZE === 0);
    ASSERT(!this._isCarryingStackTrace());
    if (index === 0) return this._fulfillmentHandler0;
    return this[index + CALLBACK_FULFILL_OFFSET - CALLBACK_SIZE];
};

Promise.prototype._rejectionHandlerAt =
function Promise$_rejectionHandlerAt(index) {
    ASSERT(typeof index === "number");
    ASSERT(index >= 0);
    ASSERT(index % CALLBACK_SIZE === 0);
    if (index === 0) return this._rejectionHandler0;
    return this[index + CALLBACK_REJECT_OFFSET - CALLBACK_SIZE];
};

Promise.prototype._unsetAt = function Promise$_unsetAt(index) {
    ASSERT(typeof index === "number");
    ASSERT(index >= 0);
    ASSERT(index % CALLBACK_SIZE === 0);
     if (index === 0) {
        this._rejectionHandler0 =
        this._progressHandler0 =
        this._promise0 =
        this._receiver0 = void 0;
        if (!this._isCarryingStackTrace()) {
            this._fulfillmentHandler0 = void 0;
        }
    }
    else {
        this[index - CALLBACK_SIZE + CALLBACK_FULFILL_OFFSET] =
        this[index - CALLBACK_SIZE + CALLBACK_REJECT_OFFSET] =
        this[index - CALLBACK_SIZE + CALLBACK_PROGRESS_OFFSET] =
        this[index - CALLBACK_SIZE + CALLBACK_PROMISE_OFFSET] =
        this[index - CALLBACK_SIZE + CALLBACK_RECEIVER_OFFSET] = void 0;
    }
};

Promise.prototype._resolveFromResolver =
function Promise$_resolveFromResolver(resolver) {
    ASSERT(typeof resolver === "function");
    var promise = this;
    this._setTrace(void 0);
    this._pushContext();

    var resolve = function(E,V) {
        if (E) {
            if (promise._tryFollow(E)) {
                return;
            }
            var trace = canAttach(E) ? E : new Error(E + "");
            promise._attachExtraTrace(trace);
            markAsOriginatingFromRejection(E);
            promise._reject(E, trace === E ? void 0 : trace);
            return;
        }
        if (promise._tryFollow(V)) {
            return;
        }
        promise._fulfill(V);
    };
    resolve.fulfill =
    resolve.withoutErrors =
    function Promise$_resolver(val) {
        if (promise._tryFollow(val)) {
            return;
        }
        promise._fulfill(val);
    };
    resolve.reject =
    function Promise$_rejecter(val) {
        var trace = canAttach(val) ? val : new Error(val + "");
        promise._attachExtraTrace(trace);
        markAsOriginatingFromRejection(val);
        promise._reject(val, trace === val ? void 0 : trace);
    };
    var r = tryCatch1(resolver, void 0, resolve);
    this._popContext();

    if (r !== void 0 && r === errorObj) {
        var e = r.e;
        var trace = canAttach(e) ? e : new Error(e + "");
        promise._reject(e, trace);
    }
};

Promise.prototype._addCallbacks = function Promise$_addCallbacks(
    fulfill,
    reject,
    progress,
    promise,
    receiver
) {
    var index = this._length();

    if (index >= MAX_LENGTH - CALLBACK_SIZE) {
        index = 0;
        this._setLength(0);
    }

    if (index === 0) {
        this._promise0 = promise;
        if (receiver !== void 0) this._receiver0 = receiver;
        if (typeof fulfill === "function" && !this._isCarryingStackTrace())
            this._fulfillmentHandler0 = fulfill;
        if (typeof reject === "function") this._rejectionHandler0 = reject;
        if (typeof progress === "function") this._progressHandler0 = progress;
    }
    else {
        var i = index - CALLBACK_SIZE;
        this[i + CALLBACK_PROMISE_OFFSET] = promise;
        this[i + CALLBACK_RECEIVER_OFFSET] = receiver;
        this[i + CALLBACK_FULFILL_OFFSET] = typeof fulfill === "function"
                                            ? fulfill : void 0;
        this[i + CALLBACK_REJECT_OFFSET] = typeof reject === "function"
                                            ? reject : void 0;
        this[i + CALLBACK_PROGRESS_OFFSET] = typeof progress === "function"
                                            ? progress : void 0;
    }
    this._setLength(index + CALLBACK_SIZE);
    return index;
};



Promise.prototype._setBoundTo = function Promise$_setBoundTo(obj) {
    if (obj !== void 0) {
        this._bitField = this._bitField | IS_BOUND;
        this._boundTo = obj;
    }
    else {
        this._bitField = this._bitField & (~IS_BOUND);
    }
};

Promise.prototype._isBound = function Promise$_isBound() {
    return (this._bitField & IS_BOUND) === IS_BOUND;
};

Promise.prototype._callHandler =
function Promise$_callHandler(
    handler, receiver, promise, value, localDebugging) {
    //Special receiver that means we are .applying an array of arguments
    //(for .spread() at the moment)
    var x;
    if (receiver === APPLY && !this.isRejected()) {
        x = this._callSpread(handler, promise, value, localDebugging);
    }
    else {
        if (localDebugging) promise._pushContext();
        x = tryCatch1(handler, receiver, value);
    }
    if (localDebugging) promise._popContext();
    return x;
};

Promise.prototype._settlePromiseFromHandler =
function Promise$_settlePromiseFromHandler(
    handler, receiver, value, promise
) {
    //if promise is not instanceof Promise
    //it is internally smuggled data
    if (!isPromise(promise)) {
        handler.call(receiver, value, promise);
        return;
    }

    var localDebugging = debugging;
    var x = this._callHandler(handler, receiver,
                              promise, value, localDebugging);
    var fallthrough = false;
    if (typeof x == "undefined") {
        fallthrough = true;
        if (this.isRejected()) {
            x = errorObj;
            x.e = value;
        }
        else {
            x = value;
        }
    }

    if (promise._isFollowing()) return;

    if (x === errorObj || x === promise || x === NEXT_FILTER) {
        var err = x === promise
                    ? makeSelfResolutionError()
                    : x.e;
        var trace = canAttach(err) ? err : new Error(err + "");
        if (x !== NEXT_FILTER) promise._attachExtraTrace(trace);
        promise._rejectUnchecked(err, trace,
            fallthrough && ! this._isRejectionUnhandled());
    }
    else {
        var castValue = Promise._cast(x, promise);
        if (isPromise(castValue)) {
            if (castValue.isRejected() &&
                !castValue._isCarryingStackTrace() &&
                !canAttach(castValue._settledValue)) {
                var trace = new Error(castValue._settledValue + "");
                promise._attachExtraTrace(trace);
                castValue._setCarriedStackTrace(trace);
            }
            promise._follow(castValue);
        }
        else {
            promise._fulfillUnchecked(x);
        }
    }
};

Promise.prototype._follow =
function Promise$_follow(promise) {
    ASSERT(arguments.length === 1);
    ASSERT(this._isFollowingOrFulfilledOrRejected() === false);
    ASSERT(isPromise(promise));
    ASSERT(promise !== this);
    this._setFollowing();

    if (promise.isPending()) {
        promise._proxyPromise(this);
    }
    else if (promise.isFulfilled()) {
        this._fulfillUnchecked(promise._settledValue);
    }
    else {
        this._rejectUnchecked(promise._settledValue,
            promise._getCarriedStackTrace());
    }

    if (promise._isRejectionUnhandled()) promise._unsetRejectionIsUnhandled();

    if (debugging &&
        promise._traceParent == null) {
        promise._traceParent = this;
    }
};

Promise.prototype._tryFollow =
function Promise$_tryFollow(value) {
    ASSERT(arguments.length === 1);
    if (this._isFollowingOrFulfilledOrRejected() ||
        value === this) {
        return false;
    }
    var maybePromise = Promise._cast(value, void 0);
    if (!isPromise(maybePromise)) {
        return false;
    }
    this._follow(maybePromise);
    return true;
};

Promise.prototype._resetTrace = function Promise$_resetTrace() {
    if (debugging) {
        this._trace = new CapturedTrace(this._peekContext() === void 0);
    }
};

Promise.prototype._setTrace = function Promise$_setTrace(parent) {
    ASSERT(this._trace == null);
    ASSERT(arguments.length === 1);
    if (debugging) {
        var context = this._peekContext();
        this._traceParent = context;
        var isTopLevel = context === void 0;
        if (parent !== void 0 &&
            parent._traceParent === context) {
            ASSERT(parent._trace != null);
            this._trace = parent._trace;
        }
        else {
            this._trace = new CapturedTrace(isTopLevel);
        }
    }
    return this;
};

Promise.prototype._attachExtraTrace =
function Promise$_attachExtraTrace(error) {
    if (debugging) {
        ASSERT(canAttach(error));
        var promise = this;
        var stack = error.stack;
        stack = typeof stack === "string"
            ? stack.split("\n") : [];
        var headerLineCount = 1;

        while(promise != null &&
            promise._trace != null) {
            stack = CapturedTrace.combine(
                stack,
                promise._trace.stack.split("\n")
           );
            promise = promise._traceParent;
        }

        var max = Error.stackTraceLimit + headerLineCount;
        var len = stack.length;
        if (len  > max) {
            stack.length = max;
        }
        if (stack.length <= headerLineCount) {
            error.stack = "(No stack trace)";
        }
        else {
            error.stack = stack.join("\n");
        }
    }
};

Promise.prototype._fulfill = function Promise$_fulfill(value) {
    if (this._isFollowingOrFulfilledOrRejected()) return;
    this._fulfillUnchecked(value);
};

Promise.prototype._reject =
function Promise$_reject(reason, carriedStackTrace, rejectionHandled) {
    if (this._isFollowingOrFulfilledOrRejected()) return;
    this._rejectUnchecked(reason, carriedStackTrace, rejectionHandled);
};

Promise.prototype._settlePromiseAt =
function Promise$_settlePromiseAt(index, rejectionHandled) {
    var handler = this.isFulfilled()
        ? this._fulfillmentHandlerAt(index)
        : this._rejectionHandlerAt(index);

    ASSERT(this.isResolved());

    var value = this._settledValue;
    var receiver = this._receiverAt(index);
    var promise = this._promiseAt(index);

    if (typeof handler === "function") {
        this._settlePromiseFromHandler(handler, receiver, value, promise);
    }
    else {
        var done = false;
        var isFulfilled = this.isFulfilled();
        //optimization when .then listeners on a promise are
        //just respective fate sealers on some other promise
        if (receiver !== void 0) {
            if (receiver instanceof Promise &&
                receiver._isProxied()) {
                //Must be smuggled data if proxied
                ASSERT(!isPromise(promise));
                receiver._unsetProxied();

                if (isFulfilled) receiver._fulfillUnchecked(value);
                else receiver._rejectUnchecked(value,
                    this._getCarriedStackTrace());
                done = true;
            }
        }

        if (!done) {
            if (isFulfilled) {
                promise._fulfill(value);
            }
            else {
                promise._reject(value, this._getCarriedStackTrace(),
                    rejectionHandled);
            }
        }
    }

    //this is only necessary against index inflation with long lived promises
    //that accumulate the index size over time,
    //not because the data wouldn't be GCd otherwise
    if (index >= 256) {
        this._queueGC();
    }
};

Promise.prototype._isProxied = function Promise$_isProxied() {
    return (this._bitField & IS_PROXIED) === IS_PROXIED;
};

Promise.prototype._setProxied = function Promise$_setProxied() {
    this._bitField = this._bitField | IS_PROXIED;
};

Promise.prototype._unsetProxied = function Promise$_unsetProxied() {
    this._bitField = this._bitField & (~IS_PROXIED);
};

Promise.prototype._isGcQueued = function Promise$_isGcQueued() {
    return (this._bitField & IS_GC_QUEUED) === IS_GC_QUEUED;
};

Promise.prototype._setGcQueued = function Promise$_setGcQueued() {
    this._bitField = this._bitField | IS_GC_QUEUED;
};

Promise.prototype._unsetGcQueued = function Promise$_unsetGcQueued() {
    this._bitField = this._bitField & (~IS_GC_QUEUED);
};

Promise.prototype._queueGC = function Promise$_queueGC() {
    if (this._isGcQueued()) return;
    this._setGcQueued();
    async.invokeLater(this._gc, this, void 0);
};

Promise.prototype._gc = function Promise$gc() {
    var len = this._length();
    this._unsetAt(0);
    for (var i = 0; i < len; i++) {
        //Delete is cool on array indexes
        delete this[i];
    }
    this._setLength(0);
    this._unsetGcQueued();
};

Promise.prototype._queueSettleAt = function Promise$_queueSettleAt(index) {
    ASSERT(typeof index === "number");
    ASSERT(index >= 0);
    ASSERT(this.isFulfilled() || this.isRejected());
    if (this._isRejectionUnhandled()) this._unsetRejectionIsUnhandled();
    async.invoke(this._settlePromiseAt, this, index);
};

Promise.prototype._fulfillUnchecked =
function Promise$_fulfillUnchecked(value) {
    if (!this.isPending()) return;
    if (value === this) {
        var err = makeSelfResolutionError();
        this._attachExtraTrace(err);
        return this._rejectUnchecked(err, void 0);
    }
    this._setFulfilled();
    this._settledValue = value;
    var len = this._length();

    if (len > 0) {
        async.invoke(this._settlePromises, this, null);
    }
};

Promise.prototype._rejectUncheckedCheckError =
function Promise$_rejectUncheckedCheckError(reason) {
    var trace = canAttach(reason) ? reason : new Error(reason + "");
    this._rejectUnchecked(reason, trace === reason ? void 0 : trace);
};

Promise.prototype._rejectUnchecked =
function Promise$_rejectUnchecked(reason, trace, rejectionHandled) {
    if (!this.isPending()) return;
    if (reason === this) {
        var err = makeSelfResolutionError();
        this._attachExtraTrace(err);
        return this._rejectUnchecked(err);
    }
    this._setRejected();
    this._settledValue = reason;

    var len = this._length();

    if (trace !== void 0) this._setCarriedStackTrace(trace);

    if (len > 0) {
        async.invoke(this._rejectPromises, this, rejectionHandled);
    }
    else if (!rejectionHandled) {
        this._ensurePossibleRejectionHandled();
    }
};

Promise.prototype._rejectPromises =
function Promise$_rejectPromises(rejectionHandled) {
    this._settlePromises(rejectionHandled);
    this._unsetCarriedStackTrace();
};

Promise.prototype._settlePromises =
function Promise$_settlePromises(rejectionHandled) {
    var len = this._length();
    for (var i = 0; i < len; i+= CALLBACK_SIZE) {
        this._settlePromiseAt(i, rejectionHandled);
    }
};

Promise.prototype._ensurePossibleRejectionHandled =
function Promise$_ensurePossibleRejectionHandled() {
    this._setRejectionIsUnhandled();
    if (CapturedTrace.possiblyUnhandledRejection !== void 0) {
        async.invokeLater(this._notifyUnhandledRejection, this, void 0);
    }
};

Promise.prototype._notifyUnhandledRejection =
function Promise$_notifyUnhandledRejection() {
    if (this._isRejectionUnhandled()) {
        var reason = this._settledValue;
        var trace = this._getCarriedStackTrace();

        this._setUnhandledRejectionIsNotified();

        if (trace !== void 0) {
            this._unsetCarriedStackTrace();
            reason = trace;
        }
        if (typeof CapturedTrace.possiblyUnhandledRejection === "function") {
            if (this.domain) {
                var result = util.tryCatch2(
                    CapturedTrace.possiblyUnhandledRejection,
                    CapturedTrace, reason, this);
                if (result === errorObj) {
                    this.domain.emit("error", result.e);
                }
            }
            else {
                CapturedTrace.possiblyUnhandledRejection(reason, this);
            }
        }
    }
};

var contextStack = [];
Promise.prototype._peekContext = function Promise$_peekContext() {
    var lastIndex = contextStack.length - 1;
    if (lastIndex >= 0) {
        return contextStack[lastIndex];
    }
    return void 0;

};

Promise.prototype._pushContext = function Promise$_pushContext() {
    if (!debugging) return;
    contextStack.push(this);
};

Promise.prototype._popContext = function Promise$_popContext() {
    if (!debugging) return;
    contextStack.pop();
};

if (!CapturedTrace.isSupported()) {
    Promise.longStackTraces = function(){};
    debugging = false;
}

Promise._makeSelfResolutionError = makeSelfResolutionError;
require("./finally.js")(Promise, NEXT_FILTER);
require("./direct_resolve.js")(Promise);
require("./thenables.js")(Promise, INTERNAL);
Promise.RangeError = RangeError;
Promise.TimeoutError = TimeoutError;
Promise.TypeError = TypeError;
Promise.RejectionError = RejectionError;

util.toFastProperties(Promise);
util.toFastProperties(Promise.prototype);

return Promise;
};
