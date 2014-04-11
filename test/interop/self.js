"use strict";

var interop = require('../interop.js');
var name = "promisable-bluebird";

interop( name,
    function(){ return require('../../js/debug/bluebird.js') },
    function (P,cb) {
        return P(function(R){ cb( R.fulfill, R.reject ) });
    });
