"use strict";
Error.stackTraceLimit = 100;
var astPasses = require("./ast_passes.js");
var node11 = parseInt(process.versions.node.split(".")[1], 10) >= 11;
var Q = require("q");
Q.longStackSupport = true;

module.exports = function( grunt ) {
    var isCI = !!grunt.option("ci");


    function getBrowsers() {
        //Terse format to generate the verbose format required by sauce
        var browsers = {
            "internet explorer|WIN8": ["10"],
            "internet explorer|WIN8.1": ["11"],
            "firefox|Windows 7": ["3.5", "3.6", "4", "25"],
            "chrome|Windows 7": null,
            "safari|Windows 7": ["5"],
            "iphone|OS X 10.8": ["6.0"]
        };

        var ret = [];
        for( var browserAndPlatform in browsers) {
            var split = browserAndPlatform.split("|");
            var browser = split[0];
            var platform = split[1];
            var versions = browsers[browserAndPlatform];
            if( versions != null ) {
                for( var i = 0, len = versions.length; i < len; ++i ) {
                    ret.push({
                        browserName: browser,
                        platform: platform,
                        version: versions[i]
                    });
                }
            }
            else {
                ret.push({
                    browserName: browser,
                    platform: platform
                });
            }
        }
        return ret;
    }


    function getBrowserBuildHeader( sources ) {
        var header = "/**\n * bluebird build version " + gruntConfig.pkg.version + "\n";
        var enabledFeatures = ["core"];

        header += ( " * Features enabled: " + enabledFeatures.join(", ") + "\n" );

        header += "*/\n";
        return header;
    }

    var CONSTANTS_FILE = './src/constants.js';
    var BUILD_DEBUG_DEST = "./js/debug/bluebird.js";

    var license;
    function getLicense() {
        if( !license ) {
            var fs = require("fs");
            var text = fs.readFileSync("LICENSE", "utf8");
            text = text.split("\n").map(function(line, index){
                return " * " + line;
            }).join("\n")
            license = "/**\n" + text + "\n */\n";
        }
        return license
    }

    var preserved;
    function getLicensePreserve() {
        if( !preserved ) {
            var fs = require("fs");
            var text = fs.readFileSync("LICENSE", "utf8");
            text = text.split("\n").map(function(line, index){
                if( index === 0 ) {
                    return " * @preserve " + line;
                }
                return " * " + line;
            }).join("\n")
            preserved = "/**\n" + text + "\n */\n";
        }
        return preserved;
    }

    function writeFile( dest, content ) {
        grunt.file.write( dest, content );
        grunt.log.writeln('File "' + dest + '" created.');
    }

    function writeFileAsync( dest, content ) {
        var fs = require("fs");
        return Q.nfcall(fs.writeFile, dest, content).then(function(){
            grunt.log.writeln('File "' + dest + '" created.');
        });
    }

    var gruntConfig = {};

    var getGlobals = function() {
        var fs = require("fs");
        var file = "./src/constants.js";
        var contents = fs.readFileSync(file, "utf8");
        var rconstantname = /CONSTANT\(\s*([^,]+)/g;
        var m;
        var globals = {
            Error: true,
            args: true,
            INLINE_SLICE: false,
            TypeError: true,
            RangeError: true,
            __DEBUG__: false,
            __BROWSER__: false,
            process: true,
            "console": false,
            "require": false,
            "module": false,
            "define": false
        };
        while( ( m = rconstantname.exec( contents ) ) ) {
            globals[m[1]] = false;
        }
        return globals;
    }

    gruntConfig.pkg = grunt.file.readJSON("package.json");

    gruntConfig.jshint = {
        all: {
            options: {
                globals: getGlobals(),

                "bitwise": false,
                "camelcase": true,
                "curly": true,
                "eqeqeq": true,
                "es3": true,
                "forin": true,
                "immed": true,
                "latedef": false,
                "newcap": true,
                "noarg": true,
                "noempty": true,
                "nonew": true,
                "plusplus": false,
                "quotmark": "double",
                "undef": true,
                "unused": true,
                "strict": false,
                "trailing": true,
                "maxparams": 6,
                "maxlen": 80,

                "asi": false,
                "boss": true,
                "eqnull": true,
                "evil": true,
                "expr": false,
                "funcscope": false,
                "globalstrict": false,
                "lastsemic": false,
                "laxcomma": false,
                "laxbreak": false,
                "loopfunc": true,
                "multistr": true,
                "proto": false,
                "scripturl": true,
                "smarttabs": false,
                "shadow": true,
                "sub": true,
                "supernew": false,
                "validthis": true,

                "browser": true,
                "jquery": true,
                "devel": true,


                '-W014': true,
                '-W116': true,
                '-W106': true,
                '-W064': true,
                '-W097': true
            },

            files: {
                src: [
                    "./src/finally.js",
                    "./src/direct_resolve.js",
                    "./src/thenables.js",
                    "./src/util.js",
                    "./src/schedule.js",
                    "./src/queue.js",
                    "./src/errors.js",
                    "./src/captured_trace.js",
                    "./src/async.js",
                    "./src/promise.js"
                ]
            }
        }
    };

    if( !isCI ) {
        gruntConfig.jshint.all.options.reporter = require("jshint-stylish");
    }

    gruntConfig.connect = {
        server: {
            options: {
                base: "./browser",
                port: 9999
            }
        }
    };

    gruntConfig.watch = {};

    gruntConfig.bump = {
      options: {
        files: ['package.json'],
        updateConfigs: [],
        commit: true,
        commitMessage: 'Release v%VERSION%',
        commitFiles: ['-a'],
        createTag: true,
        tagName: 'v%VERSION%',
        tagMessage: 'Version %VERSION%',
        false: true,
        pushTo: 'master',
        gitDescribeOptions: '--tags --always --abbrev=1 --dirty=-d' // options to use with '$ git describe'
      }
    };

    grunt.initConfig(gruntConfig);
    grunt.loadNpmTasks("grunt-contrib-connect");
    grunt.loadNpmTasks("grunt-saucelabs");
    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-contrib-watch');
    grunt.loadNpmTasks('grunt-contrib-concat');

    function buildMain( sources ) {
        var fs = require("fs");
        var Q = require("q");
        var root = cleanDirectory("./js/main/");

        return Q.all(sources.map(function( source ) {
            var src = astPasses.removeAsserts( source.sourceCode, source.fileName );
            src = astPasses.inlineExpansion( src, source.fileName );
            src = astPasses.expandConstants( src, source.fileName );
            src = src.replace( /__DEBUG__/g, "false" );
            src = src.replace( /__BROWSER__/g, "false" );
            var path = root + source.fileName;
            return writeFileAsync(path, src);
        }));
    }

    function buildDebug( sources ) {
        var fs = require("fs");
        var Q = require("q");
        var root = cleanDirectory("./js/debug/");

        return Q.nfcall(require('mkdirp'), root).then(function(){
            return Q.all(sources.map(function( source ) {
                var src = astPasses.expandAsserts( source.sourceCode, source.fileName );
                src = astPasses.inlineExpansion( src, source.fileName );
                src = astPasses.expandConstants( src, source.fileName );
                src = src.replace( /__DEBUG__/g, "true" );
                src = src.replace( /__BROWSER__/g, "false" );
                var path = root + source.fileName;
                return writeFileAsync(path, src);
            }));
        });
    }

    function buildBrowser( sources ) {
        var fs = require("fs");
        var browserify = require("browserify");
        var b = browserify("./js/main/bluebird.js");
        var dest = "./js/browser/bluebird.js";

        var header = getBrowserBuildHeader( sources );

        return Q.nbind(b.bundle, b)({
                detectGlobals: false,
                standalone: "Promise"
        }).then(function(src) {
            return writeFileAsync( dest,
                getLicensePreserve() + src )
        }).then(function() {
            return Q.nfcall(fs.readFile, dest, "utf8" );
        }).then(function( src ) {
            src = header + src;
            return Q.nfcall(fs.writeFile, dest, src );
        });
    }

    function cleanDirectory(dir) {
        if (isCI) return dir;
        var fs = require("fs");
        require("rimraf").sync(dir);
        fs.mkdirSync(dir);
        return dir;
    }

    var mandatoryPaths = [
        "./src/finally.js",
        "./src/es5.js",
        "./src/bluebird.js",
        "./src/thenables.js",
        "./src/assert.js",
        "./src/global.js",
        "./src/util.js",
        "./src/schedule.js",
        "./src/queue.js",
        "./src/errors.js",
        "./src/captured_trace.js",
        "./src/async.js",
        "./src/promise.js",
        "./src/direct_resolve.js"
    ];



    function build( paths, isCI ) {
        var fs = require("fs");
        astPasses.readConstants(fs.readFileSync(CONSTANTS_FILE, "utf8"), CONSTANTS_FILE);
        if( !paths ) {
            paths = mandatoryPaths;
        }
        var Q = require("q");

        var promises = [];
        var sources = paths.map(function(v){
            var promise = Q.nfcall(fs.readFile, v, "utf8");
            promises.push(promise);
            var ret = {};

            ret.fileName = v.replace("./src/", "");
            ret.sourceCode = promise.then(function(v){
                ret.sourceCode = v;
            });
            return ret;
        });

        //Perform common AST passes on all builds
        return Q.all(promises.slice()).then(function(){
            sources.forEach( function( source ) {
                var src = source.sourceCode
                src = astPasses.removeComments(src, source.fileName);
                src = getLicense() + src;
                source.sourceCode = src;
            });

            if( isCI ) {
                return buildDebug( sources );
            }
            else {
                return Q.all([
                    buildMain( sources ).then( function() {
                        return buildBrowser( sources );
                    }),
                    buildDebug( sources ),
                ]);
            }
        });
    }

    grunt.registerTask( "build", function() {

        var done = this.async();
        var features = grunt.option("features");
        var paths = null;

        build( paths, isCI ).then(function() {
            done();
        }).catch(function(e) {
            function leftPad(count, num) {
                  return (new Array(count + 1).join("0") + num).slice(-count)
            }
            if( e.fileName && e.stack ) {
                var stack = e.stack.split("\n");
                var rLineNo = /\((\d+):(\d+)\)/;
                var match = rLineNo.exec(stack[0]);
                var lineNumber = parseInt(match[1], 10) - 1;
                var columnNumber = parseInt(match[2], 10);
                var padTo = (lineNumber + 5).toString().length;
                var src = e.scriptSrc.split("\n").map(function(v, i) {
                    return leftPad(padTo, (i + 1)) + "  " + v;
                });
                src = src.slice(lineNumber - 5, lineNumber + 5).join("\n") + "\n";
                console.error(src);
                stack[0] = stack[0] + " " + e.fileName;
                console.error(stack.join("\n"));
                if (!grunt.option("verbose")) {
                    console.error("use --verbose to see the source code");
                }

            }
            else {
                console.error(e.stack);
            }
            done(false);
        }).done();
    });

    grunt.registerTask( "default", ["jshint", "build"] );

};
