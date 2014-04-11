"use strict";
var Continue = require('../js/debug/bluebird.js'),
    test  = require('tape');

var createWith = function(F){ return function(msg,cb) { var C = Continue(F); cb ? cb(C,C+" "+msg) : msg(C) } }
var create = {
    immediate: {
        success: createWith(function(R) { R(null,'OK') }),
        failure: createWith(function(R) { throw new Error('NOK') })
    },
    deferred: {
        success: createWith(function(R) { process.nextTick(function(){ R(null,'OK') }) }),
        failure: createWith(function(R) { process.nextTick(function(){ R(new Error('NOK')) }) })
    },
};

function forEach(A,F) { for (var K in A) F(K,A[K]) }

test("Continuable Style Tests", function(T) {
    T.plan(18);
    forEach( create, function(kind,statuses) {
        forEach( statuses, function(result,create) {
            create("basic "+kind+" "+result, function(C,M) {
                result == 'success'
                    ? C(function(_,V){ T.is(V,'OK',M) })
                    : C(function(E){ T.ok( E instanceof Error, M);
                })
            });
            create("chained "+kind+" "+result, function(C,M){
                var chained = C(function(){});
                result == 'success'
                    ? chained(function(_,V){ T.is(V,'OK',M) })
                    : chained(function(E){ T.ok( E instanceof Error, M) });
            });

            create("chained w/deferred return "+kind+" "+result,function(C,M){
                var chained = C(function(E,V){ return Continue(function(R){ R(E,V) }) });
                result == 'success'
                    ? chained(function(_,V) { T.is(V,'OK',M) })
                    : chained(function(E) { T.ok( E instanceof Error, M) })
            });

            create("chained w/immediate return "+kind+" "+result,function(C,M){
                var chained = C(function(E,V){ if (V) { return V } });
                result == 'success'
                    ? chained(function(_,V) { T.is(V,'OK', M) })
                    : chained(function(E) { T.ok( E instanceof Error, M) })
            });
            if (result=='success') {
                create("chained w/succes->new val "+kind+" "+result, function(C,M){
                    var chained = function(E,V){ return "ONLY OK" };
                    chained(function(E,V){
                        T.is(E, null, M+" no error");
                        T.is(V, "ONLY OK", M+" has value");
                    });
                });
            }
        })
    })

    var WoE = Continue(function(R){ R.withoutErrors("OK") });
    WoE(function(E,V){ T.is(V,'OK', WoE+' resolve without errors') });

    var Chained = Continue.fulfill(Continue.fulfill('OK'))
    Chained(function(E,V){ T.is(V,'OK', Chained+' chained promise resolve') });
});
