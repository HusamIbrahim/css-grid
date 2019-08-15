#!/usr/bin/env node

/* eslint-disable max-len, flowtype/require-valid-file-annotation, flowtype/require-return-type */
/* global packageInformationStores, null, $$SETUP_STATIC_TABLES */

// Used for the resolveUnqualified part of the resolution (ie resolving folder/index.js & file extensions)
// Deconstructed so that they aren't affected by any fs monkeypatching occuring later during the execution
const {statSync, lstatSync, readlinkSync, readFileSync, existsSync, realpathSync} = require('fs');

const Module = require('module');
const path = require('path');
const StringDecoder = require('string_decoder');

const ignorePattern = null ? new RegExp(null) : null;

const pnpFile = path.resolve(__dirname, __filename);
const builtinModules = new Set(Module.builtinModules || Object.keys(process.binding('natives')));

const topLevelLocator = {name: null, reference: null};
const blacklistedLocator = {name: NaN, reference: NaN};

// Used for compatibility purposes - cf setupCompatibilityLayer
const patchedModules = [];
const fallbackLocators = [topLevelLocator];

// Matches backslashes of Windows paths
const backwardSlashRegExp = /\\/g;

// Matches if the path must point to a directory (ie ends with /)
const isDirRegExp = /\/$/;

// Matches if the path starts with a valid path qualifier (./, ../, /)
// eslint-disable-next-line no-unused-vars
const isStrictRegExp = /^\.{0,2}\//;

// Splits a require request into its components, or return null if the request is a file path
const pathRegExp = /^(?![a-zA-Z]:[\\\/]|\\\\|\.{0,2}(?:\/|$))((?:@[^\/]+\/)?[^\/]+)\/?(.*|)$/;

// Keep a reference around ("module" is a common name in this context, so better rename it to something more significant)
const pnpModule = module;

/**
 * Used to disable the resolution hooks (for when we want to fallback to the previous resolution - we then need
 * a way to "reset" the environment temporarily)
 */

let enableNativeHooks = true;

/**
 * Simple helper function that assign an error code to an error, so that it can more easily be caught and used
 * by third-parties.
 */

function makeError(code, message, data = {}) {
  const error = new Error(message);
  return Object.assign(error, {code, data});
}

/**
 * Ensures that the returned locator isn't a blacklisted one.
 *
 * Blacklisted packages are packages that cannot be used because their dependencies cannot be deduced. This only
 * happens with peer dependencies, which effectively have different sets of dependencies depending on their parents.
 *
 * In order to deambiguate those different sets of dependencies, the Yarn implementation of PnP will generate a
 * symlink for each combination of <package name>/<package version>/<dependent package> it will find, and will
 * blacklist the target of those symlinks. By doing this, we ensure that files loaded through a specific path
 * will always have the same set of dependencies, provided the symlinks are correctly preserved.
 *
 * Unfortunately, some tools do not preserve them, and when it happens PnP isn't able anymore to deduce the set of
 * dependencies based on the path of the file that makes the require calls. But since we've blacklisted those paths,
 * we're able to print a more helpful error message that points out that a third-party package is doing something
 * incompatible!
 */

// eslint-disable-next-line no-unused-vars
function blacklistCheck(locator) {
  if (locator === blacklistedLocator) {
    throw makeError(
      `BLACKLISTED`,
      [
        `A package has been resolved through a blacklisted path - this is usually caused by one of your tools calling`,
        `"realpath" on the return value of "require.resolve". Since the returned values use symlinks to disambiguate`,
        `peer dependencies, they must be passed untransformed to "require".`,
      ].join(` `)
    );
  }

  return locator;
}

let packageInformationStores = new Map([
  ["browser-sync", new Map([
    ["2.26.7", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-browser-sync-2.26.7-120287716eb405651a76cc74fe851c31350557f9/node_modules/browser-sync/"),
      packageDependencies: new Map([
        ["browser-sync-client", "2.26.6"],
        ["browser-sync-ui", "2.26.4"],
        ["bs-recipes", "1.3.4"],
        ["bs-snippet-injector", "2.0.1"],
        ["chokidar", "2.1.6"],
        ["connect", "3.6.6"],
        ["connect-history-api-fallback", "1.6.0"],
        ["dev-ip", "1.0.1"],
        ["easy-extender", "2.3.4"],
        ["eazy-logger", "3.0.2"],
        ["etag", "1.8.1"],
        ["fresh", "0.5.2"],
        ["fs-extra", "3.0.1"],
        ["http-proxy", "1.15.2"],
        ["immutable", "3.8.2"],
        ["localtunnel", "1.9.2"],
        ["micromatch", "3.1.10"],
        ["opn", "5.3.0"],
        ["portscanner", "2.1.1"],
        ["qs", "6.2.3"],
        ["raw-body", "2.4.1"],
        ["resp-modifier", "6.0.2"],
        ["rx", "4.1.0"],
        ["send", "0.16.2"],
        ["serve-index", "1.9.1"],
        ["serve-static", "1.13.2"],
        ["server-destroy", "1.0.1"],
        ["socket.io", "2.1.1"],
        ["ua-parser-js", "0.7.17"],
        ["yargs", "6.4.0"],
        ["browser-sync", "2.26.7"],
      ]),
    }],
  ])],
  ["browser-sync-client", new Map([
    ["2.26.6", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-browser-sync-client-2.26.6-e5201d3ace8aee88af17656b7b0c0620b6f8e4ab/node_modules/browser-sync-client/"),
      packageDependencies: new Map([
        ["etag", "1.8.1"],
        ["fresh", "0.5.2"],
        ["mitt", "1.1.3"],
        ["rxjs", "5.5.12"],
        ["browser-sync-client", "2.26.6"],
      ]),
    }],
  ])],
  ["etag", new Map([
    ["1.8.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-etag-1.8.1-41ae2eeb65efa62268aebfea83ac7d79299b0887/node_modules/etag/"),
      packageDependencies: new Map([
        ["etag", "1.8.1"],
      ]),
    }],
  ])],
  ["fresh", new Map([
    ["0.5.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-fresh-0.5.2-3d8cadd90d976569fa835ab1f8e4b23a105605a7/node_modules/fresh/"),
      packageDependencies: new Map([
        ["fresh", "0.5.2"],
      ]),
    }],
  ])],
  ["mitt", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-mitt-1.1.3-528c506238a05dce11cd914a741ea2cc332da9b8/node_modules/mitt/"),
      packageDependencies: new Map([
        ["mitt", "1.1.3"],
      ]),
    }],
  ])],
  ["rxjs", new Map([
    ["5.5.12", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-rxjs-5.5.12-6fa61b8a77c3d793dbaf270bee2f43f652d741cc/node_modules/rxjs/"),
      packageDependencies: new Map([
        ["symbol-observable", "1.0.1"],
        ["rxjs", "5.5.12"],
      ]),
    }],
  ])],
  ["symbol-observable", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-symbol-observable-1.0.1-8340fc4702c3122df5d22288f88283f513d3fdd4/node_modules/symbol-observable/"),
      packageDependencies: new Map([
        ["symbol-observable", "1.0.1"],
      ]),
    }],
  ])],
  ["browser-sync-ui", new Map([
    ["2.26.4", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-browser-sync-ui-2.26.4-3772f13c6b93f2d7d333f4be0ca1ec02aae97dba/node_modules/browser-sync-ui/"),
      packageDependencies: new Map([
        ["async-each-series", "0.1.1"],
        ["connect-history-api-fallback", "1.6.0"],
        ["immutable", "3.8.2"],
        ["server-destroy", "1.0.1"],
        ["socket.io-client", "2.2.0"],
        ["stream-throttle", "0.1.3"],
        ["browser-sync-ui", "2.26.4"],
      ]),
    }],
  ])],
  ["async-each-series", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-async-each-series-0.1.1-7617c1917401fd8ca4a28aadce3dbae98afeb432/node_modules/async-each-series/"),
      packageDependencies: new Map([
        ["async-each-series", "0.1.1"],
      ]),
    }],
  ])],
  ["connect-history-api-fallback", new Map([
    ["1.6.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-connect-history-api-fallback-1.6.0-8b32089359308d111115d81cad3fceab888f97bc/node_modules/connect-history-api-fallback/"),
      packageDependencies: new Map([
        ["connect-history-api-fallback", "1.6.0"],
      ]),
    }],
  ])],
  ["immutable", new Map([
    ["3.8.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-immutable-3.8.2-c2439951455bb39913daf281376f1530e104adf3/node_modules/immutable/"),
      packageDependencies: new Map([
        ["immutable", "3.8.2"],
      ]),
    }],
  ])],
  ["server-destroy", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-server-destroy-1.0.1-f13bf928e42b9c3e79383e61cc3998b5d14e6cdd/node_modules/server-destroy/"),
      packageDependencies: new Map([
        ["server-destroy", "1.0.1"],
      ]),
    }],
  ])],
  ["socket.io-client", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-socket-io-client-2.2.0-84e73ee3c43d5020ccc1a258faeeb9aec2723af7/node_modules/socket.io-client/"),
      packageDependencies: new Map([
        ["backo2", "1.0.2"],
        ["base64-arraybuffer", "0.1.5"],
        ["component-bind", "1.0.0"],
        ["component-emitter", "1.2.1"],
        ["debug", "3.1.0"],
        ["engine.io-client", "3.3.2"],
        ["has-binary2", "1.0.3"],
        ["has-cors", "1.1.0"],
        ["indexof", "0.0.1"],
        ["object-component", "0.0.3"],
        ["parseqs", "0.0.5"],
        ["parseuri", "0.0.5"],
        ["socket.io-parser", "3.3.0"],
        ["to-array", "0.1.4"],
        ["socket.io-client", "2.2.0"],
      ]),
    }],
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-socket-io-client-2.1.1-dcb38103436ab4578ddb026638ae2f21b623671f/node_modules/socket.io-client/"),
      packageDependencies: new Map([
        ["backo2", "1.0.2"],
        ["base64-arraybuffer", "0.1.5"],
        ["component-bind", "1.0.0"],
        ["component-emitter", "1.2.1"],
        ["debug", "3.1.0"],
        ["engine.io-client", "3.2.1"],
        ["has-binary2", "1.0.3"],
        ["has-cors", "1.1.0"],
        ["indexof", "0.0.1"],
        ["object-component", "0.0.3"],
        ["parseqs", "0.0.5"],
        ["parseuri", "0.0.5"],
        ["socket.io-parser", "3.2.0"],
        ["to-array", "0.1.4"],
        ["socket.io-client", "2.1.1"],
      ]),
    }],
  ])],
  ["backo2", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-backo2-1.0.2-31ab1ac8b129363463e35b3ebb69f4dfcfba7947/node_modules/backo2/"),
      packageDependencies: new Map([
        ["backo2", "1.0.2"],
      ]),
    }],
  ])],
  ["base64-arraybuffer", new Map([
    ["0.1.5", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-base64-arraybuffer-0.1.5-73926771923b5a19747ad666aa5cd4bf9c6e9ce8/node_modules/base64-arraybuffer/"),
      packageDependencies: new Map([
        ["base64-arraybuffer", "0.1.5"],
      ]),
    }],
  ])],
  ["component-bind", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-component-bind-1.0.0-00c608ab7dcd93897c0009651b1d3a8e1e73bbd1/node_modules/component-bind/"),
      packageDependencies: new Map([
        ["component-bind", "1.0.0"],
      ]),
    }],
  ])],
  ["component-emitter", new Map([
    ["1.2.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-component-emitter-1.2.1-137918d6d78283f7df7a6b7c5a63e140e69425e6/node_modules/component-emitter/"),
      packageDependencies: new Map([
        ["component-emitter", "1.2.1"],
      ]),
    }],
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-component-emitter-1.3.0-16e4070fba8ae29b679f2215853ee181ab2eabc0/node_modules/component-emitter/"),
      packageDependencies: new Map([
        ["component-emitter", "1.3.0"],
      ]),
    }],
  ])],
  ["debug", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-debug-3.1.0-5bb5a0672628b64149566ba16819e61518c67261/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
        ["debug", "3.1.0"],
      ]),
    }],
    ["2.6.9", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-debug-2.6.9-5d128515df134ff327e90a4c93f4e077a536341f/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
        ["debug", "2.6.9"],
      ]),
    }],
    ["4.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-debug-4.1.1-3b72260255109c6b589cee050f1d516139664791/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.1.2"],
        ["debug", "4.1.1"],
      ]),
    }],
  ])],
  ["ms", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-ms-2.0.0-5608aeadfc00be6c2901df5f9861788de0d597c8/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
      ]),
    }],
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-ms-2.1.2-d09d1f357b443f493382a8eb3ccd183872ae6009/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "2.1.2"],
      ]),
    }],
  ])],
  ["engine.io-client", new Map([
    ["3.3.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-engine-io-client-3.3.2-04e068798d75beda14375a264bb3d742d7bc33aa/node_modules/engine.io-client/"),
      packageDependencies: new Map([
        ["component-emitter", "1.2.1"],
        ["component-inherit", "0.0.3"],
        ["debug", "3.1.0"],
        ["engine.io-parser", "2.1.3"],
        ["has-cors", "1.1.0"],
        ["indexof", "0.0.1"],
        ["parseqs", "0.0.5"],
        ["parseuri", "0.0.5"],
        ["ws", "6.1.4"],
        ["xmlhttprequest-ssl", "1.5.5"],
        ["yeast", "0.1.2"],
        ["engine.io-client", "3.3.2"],
      ]),
    }],
    ["3.2.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-engine-io-client-3.2.1-6f54c0475de487158a1a7c77d10178708b6add36/node_modules/engine.io-client/"),
      packageDependencies: new Map([
        ["component-emitter", "1.2.1"],
        ["component-inherit", "0.0.3"],
        ["debug", "3.1.0"],
        ["engine.io-parser", "2.1.3"],
        ["has-cors", "1.1.0"],
        ["indexof", "0.0.1"],
        ["parseqs", "0.0.5"],
        ["parseuri", "0.0.5"],
        ["ws", "3.3.3"],
        ["xmlhttprequest-ssl", "1.5.5"],
        ["yeast", "0.1.2"],
        ["engine.io-client", "3.2.1"],
      ]),
    }],
  ])],
  ["component-inherit", new Map([
    ["0.0.3", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-component-inherit-0.0.3-645fc4adf58b72b649d5cae65135619db26ff143/node_modules/component-inherit/"),
      packageDependencies: new Map([
        ["component-inherit", "0.0.3"],
      ]),
    }],
  ])],
  ["engine.io-parser", new Map([
    ["2.1.3", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-engine-io-parser-2.1.3-757ab970fbf2dfb32c7b74b033216d5739ef79a6/node_modules/engine.io-parser/"),
      packageDependencies: new Map([
        ["after", "0.8.2"],
        ["arraybuffer.slice", "0.0.7"],
        ["base64-arraybuffer", "0.1.5"],
        ["blob", "0.0.5"],
        ["has-binary2", "1.0.3"],
        ["engine.io-parser", "2.1.3"],
      ]),
    }],
  ])],
  ["after", new Map([
    ["0.8.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-after-0.8.2-fedb394f9f0e02aa9768e702bda23b505fae7e1f/node_modules/after/"),
      packageDependencies: new Map([
        ["after", "0.8.2"],
      ]),
    }],
  ])],
  ["arraybuffer.slice", new Map([
    ["0.0.7", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-arraybuffer-slice-0.0.7-3bbc4275dd584cc1b10809b89d4e8b63a69e7675/node_modules/arraybuffer.slice/"),
      packageDependencies: new Map([
        ["arraybuffer.slice", "0.0.7"],
      ]),
    }],
  ])],
  ["blob", new Map([
    ["0.0.5", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-blob-0.0.5-d680eeef25f8cd91ad533f5b01eed48e64caf683/node_modules/blob/"),
      packageDependencies: new Map([
        ["blob", "0.0.5"],
      ]),
    }],
  ])],
  ["has-binary2", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-has-binary2-1.0.3-7776ac627f3ea77250cfc332dab7ddf5e4f5d11d/node_modules/has-binary2/"),
      packageDependencies: new Map([
        ["isarray", "2.0.1"],
        ["has-binary2", "1.0.3"],
      ]),
    }],
  ])],
  ["isarray", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-isarray-2.0.1-a37d94ed9cda2d59865c9f76fe596ee1f338741e/node_modules/isarray/"),
      packageDependencies: new Map([
        ["isarray", "2.0.1"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-isarray-1.0.0-bb935d48582cba168c06834957a54a3e07124f11/node_modules/isarray/"),
      packageDependencies: new Map([
        ["isarray", "1.0.0"],
      ]),
    }],
  ])],
  ["has-cors", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-has-cors-1.1.0-5e474793f7ea9843d1bb99c23eef49ff126fff39/node_modules/has-cors/"),
      packageDependencies: new Map([
        ["has-cors", "1.1.0"],
      ]),
    }],
  ])],
  ["indexof", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-indexof-0.0.1-82dc336d232b9062179d05ab3293a66059fd435d/node_modules/indexof/"),
      packageDependencies: new Map([
        ["indexof", "0.0.1"],
      ]),
    }],
  ])],
  ["parseqs", new Map([
    ["0.0.5", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-parseqs-0.0.5-d5208a3738e46766e291ba2ea173684921a8b89d/node_modules/parseqs/"),
      packageDependencies: new Map([
        ["better-assert", "1.0.2"],
        ["parseqs", "0.0.5"],
      ]),
    }],
  ])],
  ["better-assert", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-better-assert-1.0.2-40866b9e1b9e0b55b481894311e68faffaebc522/node_modules/better-assert/"),
      packageDependencies: new Map([
        ["callsite", "1.0.0"],
        ["better-assert", "1.0.2"],
      ]),
    }],
  ])],
  ["callsite", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-callsite-1.0.0-280398e5d664bd74038b6f0905153e6e8af1bc20/node_modules/callsite/"),
      packageDependencies: new Map([
        ["callsite", "1.0.0"],
      ]),
    }],
  ])],
  ["parseuri", new Map([
    ["0.0.5", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-parseuri-0.0.5-80204a50d4dbb779bfdc6ebe2778d90e4bce320a/node_modules/parseuri/"),
      packageDependencies: new Map([
        ["better-assert", "1.0.2"],
        ["parseuri", "0.0.5"],
      ]),
    }],
  ])],
  ["ws", new Map([
    ["6.1.4", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-ws-6.1.4-5b5c8800afab925e94ccb29d153c8d02c1776ef9/node_modules/ws/"),
      packageDependencies: new Map([
        ["async-limiter", "1.0.1"],
        ["ws", "6.1.4"],
      ]),
    }],
    ["3.3.3", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-ws-3.3.3-f1cf84fe2d5e901ebce94efaece785f187a228f2/node_modules/ws/"),
      packageDependencies: new Map([
        ["async-limiter", "1.0.1"],
        ["safe-buffer", "5.1.2"],
        ["ultron", "1.1.1"],
        ["ws", "3.3.3"],
      ]),
    }],
  ])],
  ["async-limiter", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-async-limiter-1.0.1-dd379e94f0db8310b08291f9d64c3209766617fd/node_modules/async-limiter/"),
      packageDependencies: new Map([
        ["async-limiter", "1.0.1"],
      ]),
    }],
  ])],
  ["xmlhttprequest-ssl", new Map([
    ["1.5.5", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-xmlhttprequest-ssl-1.5.5-c2876b06168aadc40e57d97e81191ac8f4398b3e/node_modules/xmlhttprequest-ssl/"),
      packageDependencies: new Map([
        ["xmlhttprequest-ssl", "1.5.5"],
      ]),
    }],
  ])],
  ["yeast", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-yeast-0.1.2-008e06d8094320c372dbc2f8ed76a0ca6c8ac419/node_modules/yeast/"),
      packageDependencies: new Map([
        ["yeast", "0.1.2"],
      ]),
    }],
  ])],
  ["object-component", new Map([
    ["0.0.3", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-object-component-0.0.3-f0c69aa50efc95b866c186f400a33769cb2f1291/node_modules/object-component/"),
      packageDependencies: new Map([
        ["object-component", "0.0.3"],
      ]),
    }],
  ])],
  ["socket.io-parser", new Map([
    ["3.3.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-socket-io-parser-3.3.0-2b52a96a509fdf31440ba40fed6094c7d4f1262f/node_modules/socket.io-parser/"),
      packageDependencies: new Map([
        ["debug", "3.1.0"],
        ["component-emitter", "1.2.1"],
        ["isarray", "2.0.1"],
        ["socket.io-parser", "3.3.0"],
      ]),
    }],
    ["3.2.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-socket-io-parser-3.2.0-e7c6228b6aa1f814e6148aea325b51aa9499e077/node_modules/socket.io-parser/"),
      packageDependencies: new Map([
        ["debug", "3.1.0"],
        ["component-emitter", "1.2.1"],
        ["isarray", "2.0.1"],
        ["socket.io-parser", "3.2.0"],
      ]),
    }],
  ])],
  ["to-array", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-to-array-0.1.4-17e6c11f73dd4f3d74cda7a4ff3238e9ad9bf890/node_modules/to-array/"),
      packageDependencies: new Map([
        ["to-array", "0.1.4"],
      ]),
    }],
  ])],
  ["stream-throttle", new Map([
    ["0.1.3", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-stream-throttle-0.1.3-add57c8d7cc73a81630d31cd55d3961cfafba9c3/node_modules/stream-throttle/"),
      packageDependencies: new Map([
        ["commander", "2.20.0"],
        ["limiter", "1.1.4"],
        ["stream-throttle", "0.1.3"],
      ]),
    }],
  ])],
  ["commander", new Map([
    ["2.20.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-commander-2.20.0-d58bb2b5c1ee8f87b0d340027e9e94e222c5a422/node_modules/commander/"),
      packageDependencies: new Map([
        ["commander", "2.20.0"],
      ]),
    }],
  ])],
  ["limiter", new Map([
    ["1.1.4", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-limiter-1.1.4-87c9c3972d389fdb0ba67a45aadbc5d2f8413bc1/node_modules/limiter/"),
      packageDependencies: new Map([
        ["limiter", "1.1.4"],
      ]),
    }],
  ])],
  ["bs-recipes", new Map([
    ["1.3.4", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-bs-recipes-1.3.4-0d2d4d48a718c8c044769fdc4f89592dc8b69585/node_modules/bs-recipes/"),
      packageDependencies: new Map([
        ["bs-recipes", "1.3.4"],
      ]),
    }],
  ])],
  ["bs-snippet-injector", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-bs-snippet-injector-2.0.1-61b5393f11f52559ed120693100343b6edb04dd5/node_modules/bs-snippet-injector/"),
      packageDependencies: new Map([
        ["bs-snippet-injector", "2.0.1"],
      ]),
    }],
  ])],
  ["chokidar", new Map([
    ["2.1.6", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-chokidar-2.1.6-b6cad653a929e244ce8a834244164d241fa954c5/node_modules/chokidar/"),
      packageDependencies: new Map([
        ["anymatch", "2.0.0"],
        ["async-each", "1.0.3"],
        ["braces", "2.3.2"],
        ["glob-parent", "3.1.0"],
        ["inherits", "2.0.4"],
        ["is-binary-path", "1.0.1"],
        ["is-glob", "4.0.1"],
        ["normalize-path", "3.0.0"],
        ["path-is-absolute", "1.0.1"],
        ["readdirp", "2.2.1"],
        ["upath", "1.1.2"],
        ["chokidar", "2.1.6"],
      ]),
    }],
  ])],
  ["anymatch", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-anymatch-2.0.0-bcb24b4f37934d9aa7ac17b4adaf89e7c76ef2eb/node_modules/anymatch/"),
      packageDependencies: new Map([
        ["micromatch", "3.1.10"],
        ["normalize-path", "2.1.1"],
        ["anymatch", "2.0.0"],
      ]),
    }],
  ])],
  ["micromatch", new Map([
    ["3.1.10", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-micromatch-3.1.10-70859bc95c9840952f359a068a3fc49f9ecfac23/node_modules/micromatch/"),
      packageDependencies: new Map([
        ["arr-diff", "4.0.0"],
        ["array-unique", "0.3.2"],
        ["braces", "2.3.2"],
        ["define-property", "2.0.2"],
        ["extend-shallow", "3.0.2"],
        ["extglob", "2.0.4"],
        ["fragment-cache", "0.2.1"],
        ["kind-of", "6.0.2"],
        ["nanomatch", "1.2.13"],
        ["object.pick", "1.3.0"],
        ["regex-not", "1.0.2"],
        ["snapdragon", "0.8.2"],
        ["to-regex", "3.0.2"],
        ["micromatch", "3.1.10"],
      ]),
    }],
  ])],
  ["arr-diff", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-arr-diff-4.0.0-d6461074febfec71e7e15235761a329a5dc7c520/node_modules/arr-diff/"),
      packageDependencies: new Map([
        ["arr-diff", "4.0.0"],
      ]),
    }],
  ])],
  ["array-unique", new Map([
    ["0.3.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-array-unique-0.3.2-a894b75d4bc4f6cd679ef3244a9fd8f46ae2d428/node_modules/array-unique/"),
      packageDependencies: new Map([
        ["array-unique", "0.3.2"],
      ]),
    }],
  ])],
  ["braces", new Map([
    ["2.3.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-braces-2.3.2-5979fd3f14cd531565e5fa2df1abfff1dfaee729/node_modules/braces/"),
      packageDependencies: new Map([
        ["arr-flatten", "1.1.0"],
        ["array-unique", "0.3.2"],
        ["extend-shallow", "2.0.1"],
        ["fill-range", "4.0.0"],
        ["isobject", "3.0.1"],
        ["repeat-element", "1.1.3"],
        ["snapdragon", "0.8.2"],
        ["snapdragon-node", "2.1.1"],
        ["split-string", "3.1.0"],
        ["to-regex", "3.0.2"],
        ["braces", "2.3.2"],
      ]),
    }],
  ])],
  ["arr-flatten", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-arr-flatten-1.1.0-36048bbff4e7b47e136644316c99669ea5ae91f1/node_modules/arr-flatten/"),
      packageDependencies: new Map([
        ["arr-flatten", "1.1.0"],
      ]),
    }],
  ])],
  ["extend-shallow", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-extend-shallow-2.0.1-51af7d614ad9a9f610ea1bafbb989d6b1c56890f/node_modules/extend-shallow/"),
      packageDependencies: new Map([
        ["is-extendable", "0.1.1"],
        ["extend-shallow", "2.0.1"],
      ]),
    }],
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-extend-shallow-3.0.2-26a71aaf073b39fb2127172746131c2704028db8/node_modules/extend-shallow/"),
      packageDependencies: new Map([
        ["assign-symbols", "1.0.0"],
        ["is-extendable", "1.0.1"],
        ["extend-shallow", "3.0.2"],
      ]),
    }],
  ])],
  ["is-extendable", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-extendable-0.1.1-62b110e289a471418e3ec36a617d472e301dfc89/node_modules/is-extendable/"),
      packageDependencies: new Map([
        ["is-extendable", "0.1.1"],
      ]),
    }],
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-extendable-1.0.1-a7470f9e426733d81bd81e1155264e3a3507cab4/node_modules/is-extendable/"),
      packageDependencies: new Map([
        ["is-plain-object", "2.0.4"],
        ["is-extendable", "1.0.1"],
      ]),
    }],
  ])],
  ["fill-range", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-fill-range-4.0.0-d544811d428f98eb06a63dc402d2403c328c38f7/node_modules/fill-range/"),
      packageDependencies: new Map([
        ["extend-shallow", "2.0.1"],
        ["is-number", "3.0.0"],
        ["repeat-string", "1.6.1"],
        ["to-regex-range", "2.1.1"],
        ["fill-range", "4.0.0"],
      ]),
    }],
  ])],
  ["is-number", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-number-3.0.0-24fd6201a4782cf50561c810276afc7d12d71195/node_modules/is-number/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["is-number", "3.0.0"],
      ]),
    }],
  ])],
  ["kind-of", new Map([
    ["3.2.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-kind-of-3.2.2-31ea21a734bab9bbb0f32466d893aea51e4a3c64/node_modules/kind-of/"),
      packageDependencies: new Map([
        ["is-buffer", "1.1.6"],
        ["kind-of", "3.2.2"],
      ]),
    }],
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-kind-of-4.0.0-20813df3d712928b207378691a45066fae72dd57/node_modules/kind-of/"),
      packageDependencies: new Map([
        ["is-buffer", "1.1.6"],
        ["kind-of", "4.0.0"],
      ]),
    }],
    ["5.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-kind-of-5.1.0-729c91e2d857b7a419a1f9aa65685c4c33f5845d/node_modules/kind-of/"),
      packageDependencies: new Map([
        ["kind-of", "5.1.0"],
      ]),
    }],
    ["6.0.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-kind-of-6.0.2-01146b36a6218e64e58f3a8d66de5d7fc6f6d051/node_modules/kind-of/"),
      packageDependencies: new Map([
        ["kind-of", "6.0.2"],
      ]),
    }],
  ])],
  ["is-buffer", new Map([
    ["1.1.6", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-buffer-1.1.6-efaa2ea9daa0d7ab2ea13a97b2b8ad51fefbe8be/node_modules/is-buffer/"),
      packageDependencies: new Map([
        ["is-buffer", "1.1.6"],
      ]),
    }],
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-buffer-2.0.3-4ecf3fcf749cbd1e472689e109ac66261a25e725/node_modules/is-buffer/"),
      packageDependencies: new Map([
        ["is-buffer", "2.0.3"],
      ]),
    }],
  ])],
  ["repeat-string", new Map([
    ["1.6.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-repeat-string-1.6.1-8dcae470e1c88abc2d600fff4a776286da75e637/node_modules/repeat-string/"),
      packageDependencies: new Map([
        ["repeat-string", "1.6.1"],
      ]),
    }],
  ])],
  ["to-regex-range", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-to-regex-range-2.1.1-7c80c17b9dfebe599e27367e0d4dd5590141db38/node_modules/to-regex-range/"),
      packageDependencies: new Map([
        ["is-number", "3.0.0"],
        ["repeat-string", "1.6.1"],
        ["to-regex-range", "2.1.1"],
      ]),
    }],
  ])],
  ["isobject", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-isobject-3.0.1-4e431e92b11a9731636aa1f9c8d1ccbcfdab78df/node_modules/isobject/"),
      packageDependencies: new Map([
        ["isobject", "3.0.1"],
      ]),
    }],
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-isobject-2.1.0-f065561096a3f1da2ef46272f815c840d87e0c89/node_modules/isobject/"),
      packageDependencies: new Map([
        ["isarray", "1.0.0"],
        ["isobject", "2.1.0"],
      ]),
    }],
  ])],
  ["repeat-element", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-repeat-element-1.1.3-782e0d825c0c5a3bb39731f84efee6b742e6b1ce/node_modules/repeat-element/"),
      packageDependencies: new Map([
        ["repeat-element", "1.1.3"],
      ]),
    }],
  ])],
  ["snapdragon", new Map([
    ["0.8.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-snapdragon-0.8.2-64922e7c565b0e14204ba1aa7d6964278d25182d/node_modules/snapdragon/"),
      packageDependencies: new Map([
        ["base", "0.11.2"],
        ["debug", "2.6.9"],
        ["define-property", "0.2.5"],
        ["extend-shallow", "2.0.1"],
        ["map-cache", "0.2.2"],
        ["source-map", "0.5.7"],
        ["source-map-resolve", "0.5.2"],
        ["use", "3.1.1"],
        ["snapdragon", "0.8.2"],
      ]),
    }],
  ])],
  ["base", new Map([
    ["0.11.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-base-0.11.2-7bde5ced145b6d551a90db87f83c558b4eb48a8f/node_modules/base/"),
      packageDependencies: new Map([
        ["cache-base", "1.0.1"],
        ["class-utils", "0.3.6"],
        ["component-emitter", "1.3.0"],
        ["define-property", "1.0.0"],
        ["isobject", "3.0.1"],
        ["mixin-deep", "1.3.2"],
        ["pascalcase", "0.1.1"],
        ["base", "0.11.2"],
      ]),
    }],
  ])],
  ["cache-base", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-cache-base-1.0.1-0a7f46416831c8b662ee36fe4e7c59d76f666ab2/node_modules/cache-base/"),
      packageDependencies: new Map([
        ["collection-visit", "1.0.0"],
        ["component-emitter", "1.3.0"],
        ["get-value", "2.0.6"],
        ["has-value", "1.0.0"],
        ["isobject", "3.0.1"],
        ["set-value", "2.0.1"],
        ["to-object-path", "0.3.0"],
        ["union-value", "1.0.1"],
        ["unset-value", "1.0.0"],
        ["cache-base", "1.0.1"],
      ]),
    }],
  ])],
  ["collection-visit", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-collection-visit-1.0.0-4bc0373c164bc3291b4d368c829cf1a80a59dca0/node_modules/collection-visit/"),
      packageDependencies: new Map([
        ["map-visit", "1.0.0"],
        ["object-visit", "1.0.1"],
        ["collection-visit", "1.0.0"],
      ]),
    }],
  ])],
  ["map-visit", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-map-visit-1.0.0-ecdca8f13144e660f1b5bd41f12f3479d98dfb8f/node_modules/map-visit/"),
      packageDependencies: new Map([
        ["object-visit", "1.0.1"],
        ["map-visit", "1.0.0"],
      ]),
    }],
  ])],
  ["object-visit", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-object-visit-1.0.1-f79c4493af0c5377b59fe39d395e41042dd045bb/node_modules/object-visit/"),
      packageDependencies: new Map([
        ["isobject", "3.0.1"],
        ["object-visit", "1.0.1"],
      ]),
    }],
  ])],
  ["get-value", new Map([
    ["2.0.6", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-get-value-2.0.6-dc15ca1c672387ca76bd37ac0a395ba2042a2c28/node_modules/get-value/"),
      packageDependencies: new Map([
        ["get-value", "2.0.6"],
      ]),
    }],
  ])],
  ["has-value", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-has-value-1.0.0-18b281da585b1c5c51def24c930ed29a0be6b177/node_modules/has-value/"),
      packageDependencies: new Map([
        ["get-value", "2.0.6"],
        ["has-values", "1.0.0"],
        ["isobject", "3.0.1"],
        ["has-value", "1.0.0"],
      ]),
    }],
    ["0.3.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-has-value-0.3.1-7b1f58bada62ca827ec0a2078025654845995e1f/node_modules/has-value/"),
      packageDependencies: new Map([
        ["get-value", "2.0.6"],
        ["has-values", "0.1.4"],
        ["isobject", "2.1.0"],
        ["has-value", "0.3.1"],
      ]),
    }],
  ])],
  ["has-values", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-has-values-1.0.0-95b0b63fec2146619a6fe57fe75628d5a39efe4f/node_modules/has-values/"),
      packageDependencies: new Map([
        ["is-number", "3.0.0"],
        ["kind-of", "4.0.0"],
        ["has-values", "1.0.0"],
      ]),
    }],
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-has-values-0.1.4-6d61de95d91dfca9b9a02089ad384bff8f62b771/node_modules/has-values/"),
      packageDependencies: new Map([
        ["has-values", "0.1.4"],
      ]),
    }],
  ])],
  ["set-value", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-set-value-2.0.1-a18d40530e6f07de4228c7defe4227af8cad005b/node_modules/set-value/"),
      packageDependencies: new Map([
        ["extend-shallow", "2.0.1"],
        ["is-extendable", "0.1.1"],
        ["is-plain-object", "2.0.4"],
        ["split-string", "3.1.0"],
        ["set-value", "2.0.1"],
      ]),
    }],
  ])],
  ["is-plain-object", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-plain-object-2.0.4-2c163b3fafb1b606d9d17928f05c2a1c38e07677/node_modules/is-plain-object/"),
      packageDependencies: new Map([
        ["isobject", "3.0.1"],
        ["is-plain-object", "2.0.4"],
      ]),
    }],
  ])],
  ["split-string", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-split-string-3.1.0-7cb09dda3a86585705c64b39a6466038682e8fe2/node_modules/split-string/"),
      packageDependencies: new Map([
        ["extend-shallow", "3.0.2"],
        ["split-string", "3.1.0"],
      ]),
    }],
  ])],
  ["assign-symbols", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-assign-symbols-1.0.0-59667f41fadd4f20ccbc2bb96b8d4f7f78ec0367/node_modules/assign-symbols/"),
      packageDependencies: new Map([
        ["assign-symbols", "1.0.0"],
      ]),
    }],
  ])],
  ["to-object-path", new Map([
    ["0.3.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-to-object-path-0.3.0-297588b7b0e7e0ac08e04e672f85c1f4999e17af/node_modules/to-object-path/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["to-object-path", "0.3.0"],
      ]),
    }],
  ])],
  ["union-value", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-union-value-1.0.1-0b6fe7b835aecda61c6ea4d4f02c14221e109847/node_modules/union-value/"),
      packageDependencies: new Map([
        ["arr-union", "3.1.0"],
        ["get-value", "2.0.6"],
        ["is-extendable", "0.1.1"],
        ["set-value", "2.0.1"],
        ["union-value", "1.0.1"],
      ]),
    }],
  ])],
  ["arr-union", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-arr-union-3.1.0-e39b09aea9def866a8f206e288af63919bae39c4/node_modules/arr-union/"),
      packageDependencies: new Map([
        ["arr-union", "3.1.0"],
      ]),
    }],
  ])],
  ["unset-value", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-unset-value-1.0.0-8376873f7d2335179ffb1e6fc3a8ed0dfc8ab559/node_modules/unset-value/"),
      packageDependencies: new Map([
        ["has-value", "0.3.1"],
        ["isobject", "3.0.1"],
        ["unset-value", "1.0.0"],
      ]),
    }],
  ])],
  ["class-utils", new Map([
    ["0.3.6", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-class-utils-0.3.6-f93369ae8b9a7ce02fd41faad0ca83033190c463/node_modules/class-utils/"),
      packageDependencies: new Map([
        ["arr-union", "3.1.0"],
        ["define-property", "0.2.5"],
        ["isobject", "3.0.1"],
        ["static-extend", "0.1.2"],
        ["class-utils", "0.3.6"],
      ]),
    }],
  ])],
  ["define-property", new Map([
    ["0.2.5", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-define-property-0.2.5-c35b1ef918ec3c990f9a5bc57be04aacec5c8116/node_modules/define-property/"),
      packageDependencies: new Map([
        ["is-descriptor", "0.1.6"],
        ["define-property", "0.2.5"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-define-property-1.0.0-769ebaaf3f4a63aad3af9e8d304c9bbe79bfb0e6/node_modules/define-property/"),
      packageDependencies: new Map([
        ["is-descriptor", "1.0.2"],
        ["define-property", "1.0.0"],
      ]),
    }],
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-define-property-2.0.2-d459689e8d654ba77e02a817f8710d702cb16e9d/node_modules/define-property/"),
      packageDependencies: new Map([
        ["is-descriptor", "1.0.2"],
        ["isobject", "3.0.1"],
        ["define-property", "2.0.2"],
      ]),
    }],
  ])],
  ["is-descriptor", new Map([
    ["0.1.6", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-descriptor-0.1.6-366d8240dde487ca51823b1ab9f07a10a78251ca/node_modules/is-descriptor/"),
      packageDependencies: new Map([
        ["is-accessor-descriptor", "0.1.6"],
        ["is-data-descriptor", "0.1.4"],
        ["kind-of", "5.1.0"],
        ["is-descriptor", "0.1.6"],
      ]),
    }],
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-descriptor-1.0.2-3b159746a66604b04f8c81524ba365c5f14d86ec/node_modules/is-descriptor/"),
      packageDependencies: new Map([
        ["is-accessor-descriptor", "1.0.0"],
        ["is-data-descriptor", "1.0.0"],
        ["kind-of", "6.0.2"],
        ["is-descriptor", "1.0.2"],
      ]),
    }],
  ])],
  ["is-accessor-descriptor", new Map([
    ["0.1.6", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-accessor-descriptor-0.1.6-a9e12cb3ae8d876727eeef3843f8a0897b5c98d6/node_modules/is-accessor-descriptor/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["is-accessor-descriptor", "0.1.6"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-accessor-descriptor-1.0.0-169c2f6d3df1f992618072365c9b0ea1f6878656/node_modules/is-accessor-descriptor/"),
      packageDependencies: new Map([
        ["kind-of", "6.0.2"],
        ["is-accessor-descriptor", "1.0.0"],
      ]),
    }],
  ])],
  ["is-data-descriptor", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-data-descriptor-0.1.4-0b5ee648388e2c860282e793f1856fec3f301b56/node_modules/is-data-descriptor/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["is-data-descriptor", "0.1.4"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-data-descriptor-1.0.0-d84876321d0e7add03990406abbbbd36ba9268c7/node_modules/is-data-descriptor/"),
      packageDependencies: new Map([
        ["kind-of", "6.0.2"],
        ["is-data-descriptor", "1.0.0"],
      ]),
    }],
  ])],
  ["static-extend", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-static-extend-0.1.2-60809c39cbff55337226fd5e0b520f341f1fb5c6/node_modules/static-extend/"),
      packageDependencies: new Map([
        ["define-property", "0.2.5"],
        ["object-copy", "0.1.0"],
        ["static-extend", "0.1.2"],
      ]),
    }],
  ])],
  ["object-copy", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-object-copy-0.1.0-7e7d858b781bd7c991a41ba975ed3812754e998c/node_modules/object-copy/"),
      packageDependencies: new Map([
        ["copy-descriptor", "0.1.1"],
        ["define-property", "0.2.5"],
        ["kind-of", "3.2.2"],
        ["object-copy", "0.1.0"],
      ]),
    }],
  ])],
  ["copy-descriptor", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-copy-descriptor-0.1.1-676f6eb3c39997c2ee1ac3a924fd6124748f578d/node_modules/copy-descriptor/"),
      packageDependencies: new Map([
        ["copy-descriptor", "0.1.1"],
      ]),
    }],
  ])],
  ["mixin-deep", new Map([
    ["1.3.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-mixin-deep-1.3.2-1120b43dc359a785dce65b55b82e257ccf479566/node_modules/mixin-deep/"),
      packageDependencies: new Map([
        ["for-in", "1.0.2"],
        ["is-extendable", "1.0.1"],
        ["mixin-deep", "1.3.2"],
      ]),
    }],
  ])],
  ["for-in", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-for-in-1.0.2-81068d295a8142ec0ac726c6e2200c30fb6d5e80/node_modules/for-in/"),
      packageDependencies: new Map([
        ["for-in", "1.0.2"],
      ]),
    }],
  ])],
  ["pascalcase", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-pascalcase-0.1.1-b363e55e8006ca6fe21784d2db22bd15d7917f14/node_modules/pascalcase/"),
      packageDependencies: new Map([
        ["pascalcase", "0.1.1"],
      ]),
    }],
  ])],
  ["map-cache", new Map([
    ["0.2.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-map-cache-0.2.2-c32abd0bd6525d9b051645bb4f26ac5dc98a0dbf/node_modules/map-cache/"),
      packageDependencies: new Map([
        ["map-cache", "0.2.2"],
      ]),
    }],
  ])],
  ["source-map", new Map([
    ["0.5.7", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-source-map-0.5.7-8a039d2d1021d22d1ea14c80d8ea468ba2ef3fcc/node_modules/source-map/"),
      packageDependencies: new Map([
        ["source-map", "0.5.7"],
      ]),
    }],
  ])],
  ["source-map-resolve", new Map([
    ["0.5.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-source-map-resolve-0.5.2-72e2cc34095543e43b2c62b2c4c10d4a9054f259/node_modules/source-map-resolve/"),
      packageDependencies: new Map([
        ["atob", "2.1.2"],
        ["decode-uri-component", "0.2.0"],
        ["resolve-url", "0.2.1"],
        ["source-map-url", "0.4.0"],
        ["urix", "0.1.0"],
        ["source-map-resolve", "0.5.2"],
      ]),
    }],
  ])],
  ["atob", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-atob-2.1.2-6d9517eb9e030d2436666651e86bd9f6f13533c9/node_modules/atob/"),
      packageDependencies: new Map([
        ["atob", "2.1.2"],
      ]),
    }],
  ])],
  ["decode-uri-component", new Map([
    ["0.2.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-decode-uri-component-0.2.0-eb3913333458775cb84cd1a1fae062106bb87545/node_modules/decode-uri-component/"),
      packageDependencies: new Map([
        ["decode-uri-component", "0.2.0"],
      ]),
    }],
  ])],
  ["resolve-url", new Map([
    ["0.2.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-resolve-url-0.2.1-2c637fe77c893afd2a663fe21aa9080068e2052a/node_modules/resolve-url/"),
      packageDependencies: new Map([
        ["resolve-url", "0.2.1"],
      ]),
    }],
  ])],
  ["source-map-url", new Map([
    ["0.4.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-source-map-url-0.4.0-3e935d7ddd73631b97659956d55128e87b5084a3/node_modules/source-map-url/"),
      packageDependencies: new Map([
        ["source-map-url", "0.4.0"],
      ]),
    }],
  ])],
  ["urix", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-urix-0.1.0-da937f7a62e21fec1fd18d49b35c2935067a6c72/node_modules/urix/"),
      packageDependencies: new Map([
        ["urix", "0.1.0"],
      ]),
    }],
  ])],
  ["use", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-use-3.1.1-d50c8cac79a19fbc20f2911f56eb973f4e10070f/node_modules/use/"),
      packageDependencies: new Map([
        ["use", "3.1.1"],
      ]),
    }],
  ])],
  ["snapdragon-node", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-snapdragon-node-2.1.1-6c175f86ff14bdb0724563e8f3c1b021a286853b/node_modules/snapdragon-node/"),
      packageDependencies: new Map([
        ["define-property", "1.0.0"],
        ["isobject", "3.0.1"],
        ["snapdragon-util", "3.0.1"],
        ["snapdragon-node", "2.1.1"],
      ]),
    }],
  ])],
  ["snapdragon-util", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-snapdragon-util-3.0.1-f956479486f2acd79700693f6f7b805e45ab56e2/node_modules/snapdragon-util/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["snapdragon-util", "3.0.1"],
      ]),
    }],
  ])],
  ["to-regex", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-to-regex-3.0.2-13cfdd9b336552f30b51f33a8ae1b42a7a7599ce/node_modules/to-regex/"),
      packageDependencies: new Map([
        ["define-property", "2.0.2"],
        ["extend-shallow", "3.0.2"],
        ["regex-not", "1.0.2"],
        ["safe-regex", "1.1.0"],
        ["to-regex", "3.0.2"],
      ]),
    }],
  ])],
  ["regex-not", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-regex-not-1.0.2-1f4ece27e00b0b65e0247a6810e6a85d83a5752c/node_modules/regex-not/"),
      packageDependencies: new Map([
        ["extend-shallow", "3.0.2"],
        ["safe-regex", "1.1.0"],
        ["regex-not", "1.0.2"],
      ]),
    }],
  ])],
  ["safe-regex", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-safe-regex-1.1.0-40a3669f3b077d1e943d44629e157dd48023bf2e/node_modules/safe-regex/"),
      packageDependencies: new Map([
        ["ret", "0.1.15"],
        ["safe-regex", "1.1.0"],
      ]),
    }],
  ])],
  ["ret", new Map([
    ["0.1.15", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-ret-0.1.15-b8a4825d5bdb1fc3f6f53c2bc33f81388681c7bc/node_modules/ret/"),
      packageDependencies: new Map([
        ["ret", "0.1.15"],
      ]),
    }],
  ])],
  ["extglob", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-extglob-2.0.4-ad00fe4dc612a9232e8718711dc5cb5ab0285543/node_modules/extglob/"),
      packageDependencies: new Map([
        ["array-unique", "0.3.2"],
        ["define-property", "1.0.0"],
        ["expand-brackets", "2.1.4"],
        ["extend-shallow", "2.0.1"],
        ["fragment-cache", "0.2.1"],
        ["regex-not", "1.0.2"],
        ["snapdragon", "0.8.2"],
        ["to-regex", "3.0.2"],
        ["extglob", "2.0.4"],
      ]),
    }],
  ])],
  ["expand-brackets", new Map([
    ["2.1.4", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-expand-brackets-2.1.4-b77735e315ce30f6b6eff0f83b04151a22449622/node_modules/expand-brackets/"),
      packageDependencies: new Map([
        ["debug", "2.6.9"],
        ["define-property", "0.2.5"],
        ["extend-shallow", "2.0.1"],
        ["posix-character-classes", "0.1.1"],
        ["regex-not", "1.0.2"],
        ["snapdragon", "0.8.2"],
        ["to-regex", "3.0.2"],
        ["expand-brackets", "2.1.4"],
      ]),
    }],
  ])],
  ["posix-character-classes", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-posix-character-classes-0.1.1-01eac0fe3b5af71a2a6c02feabb8c1fef7e00eab/node_modules/posix-character-classes/"),
      packageDependencies: new Map([
        ["posix-character-classes", "0.1.1"],
      ]),
    }],
  ])],
  ["fragment-cache", new Map([
    ["0.2.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-fragment-cache-0.2.1-4290fad27f13e89be7f33799c6bc5a0abfff0d19/node_modules/fragment-cache/"),
      packageDependencies: new Map([
        ["map-cache", "0.2.2"],
        ["fragment-cache", "0.2.1"],
      ]),
    }],
  ])],
  ["nanomatch", new Map([
    ["1.2.13", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-nanomatch-1.2.13-b87a8aa4fc0de8fe6be88895b38983ff265bd119/node_modules/nanomatch/"),
      packageDependencies: new Map([
        ["arr-diff", "4.0.0"],
        ["array-unique", "0.3.2"],
        ["define-property", "2.0.2"],
        ["extend-shallow", "3.0.2"],
        ["fragment-cache", "0.2.1"],
        ["is-windows", "1.0.2"],
        ["kind-of", "6.0.2"],
        ["object.pick", "1.3.0"],
        ["regex-not", "1.0.2"],
        ["snapdragon", "0.8.2"],
        ["to-regex", "3.0.2"],
        ["nanomatch", "1.2.13"],
      ]),
    }],
  ])],
  ["is-windows", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-windows-1.0.2-d1850eb9791ecd18e6182ce12a30f396634bb19d/node_modules/is-windows/"),
      packageDependencies: new Map([
        ["is-windows", "1.0.2"],
      ]),
    }],
  ])],
  ["object.pick", new Map([
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-object-pick-1.3.0-87a10ac4c1694bd2e1cbf53591a66141fb5dd747/node_modules/object.pick/"),
      packageDependencies: new Map([
        ["isobject", "3.0.1"],
        ["object.pick", "1.3.0"],
      ]),
    }],
  ])],
  ["normalize-path", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-normalize-path-2.1.1-1ab28b556e198363a8c1a6f7e6fa20137fe6aed9/node_modules/normalize-path/"),
      packageDependencies: new Map([
        ["remove-trailing-separator", "1.1.0"],
        ["normalize-path", "2.1.1"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-normalize-path-3.0.0-0dcd69ff23a1c9b11fd0978316644a0388216a65/node_modules/normalize-path/"),
      packageDependencies: new Map([
        ["normalize-path", "3.0.0"],
      ]),
    }],
  ])],
  ["remove-trailing-separator", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-remove-trailing-separator-1.1.0-c24bce2a283adad5bc3f58e0d48249b92379d8ef/node_modules/remove-trailing-separator/"),
      packageDependencies: new Map([
        ["remove-trailing-separator", "1.1.0"],
      ]),
    }],
  ])],
  ["async-each", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-async-each-1.0.3-b727dbf87d7651602f06f4d4ac387f47d91b0cbf/node_modules/async-each/"),
      packageDependencies: new Map([
        ["async-each", "1.0.3"],
      ]),
    }],
  ])],
  ["glob-parent", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-glob-parent-3.1.0-9e6af6299d8d3bd2bd40430832bd113df906c5ae/node_modules/glob-parent/"),
      packageDependencies: new Map([
        ["is-glob", "3.1.0"],
        ["path-dirname", "1.0.2"],
        ["glob-parent", "3.1.0"],
      ]),
    }],
  ])],
  ["is-glob", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-glob-3.1.0-7ba5ae24217804ac70707b96922567486cc3e84a/node_modules/is-glob/"),
      packageDependencies: new Map([
        ["is-extglob", "2.1.1"],
        ["is-glob", "3.1.0"],
      ]),
    }],
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-glob-4.0.1-7567dbe9f2f5e2467bc77ab83c4a29482407a5dc/node_modules/is-glob/"),
      packageDependencies: new Map([
        ["is-extglob", "2.1.1"],
        ["is-glob", "4.0.1"],
      ]),
    }],
  ])],
  ["is-extglob", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-extglob-2.1.1-a88c02535791f02ed37c76a1b9ea9773c833f8c2/node_modules/is-extglob/"),
      packageDependencies: new Map([
        ["is-extglob", "2.1.1"],
      ]),
    }],
  ])],
  ["path-dirname", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-path-dirname-1.0.2-cc33d24d525e099a5388c0336c6e32b9160609e0/node_modules/path-dirname/"),
      packageDependencies: new Map([
        ["path-dirname", "1.0.2"],
      ]),
    }],
  ])],
  ["inherits", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-inherits-2.0.4-0fa2c64f932917c3433a0ded55363aae37416b7c/node_modules/inherits/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
      ]),
    }],
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-inherits-2.0.3-633c2c83e3da42a502f52466022480f4208261de/node_modules/inherits/"),
      packageDependencies: new Map([
        ["inherits", "2.0.3"],
      ]),
    }],
  ])],
  ["is-binary-path", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-binary-path-1.0.1-75f16642b480f187a711c814161fd3a4a7655898/node_modules/is-binary-path/"),
      packageDependencies: new Map([
        ["binary-extensions", "1.13.1"],
        ["is-binary-path", "1.0.1"],
      ]),
    }],
  ])],
  ["binary-extensions", new Map([
    ["1.13.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-binary-extensions-1.13.1-598afe54755b2868a5330d2aff9d4ebb53209b65/node_modules/binary-extensions/"),
      packageDependencies: new Map([
        ["binary-extensions", "1.13.1"],
      ]),
    }],
  ])],
  ["path-is-absolute", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-path-is-absolute-1.0.1-174b9268735534ffbc7ace6bf53a5a9e1b5c5f5f/node_modules/path-is-absolute/"),
      packageDependencies: new Map([
        ["path-is-absolute", "1.0.1"],
      ]),
    }],
  ])],
  ["readdirp", new Map([
    ["2.2.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-readdirp-2.2.1-0e87622a3325aa33e892285caf8b4e846529a525/node_modules/readdirp/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
        ["micromatch", "3.1.10"],
        ["readable-stream", "2.3.6"],
        ["readdirp", "2.2.1"],
      ]),
    }],
  ])],
  ["graceful-fs", new Map([
    ["4.2.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-graceful-fs-4.2.2-6f0952605d0140c1cfdb138ed005775b92d67b02/node_modules/graceful-fs/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
      ]),
    }],
  ])],
  ["readable-stream", new Map([
    ["2.3.6", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-readable-stream-2.3.6-b11c27d88b8ff1fbe070643cf94b0c79ae1b0aaf/node_modules/readable-stream/"),
      packageDependencies: new Map([
        ["core-util-is", "1.0.2"],
        ["inherits", "2.0.4"],
        ["isarray", "1.0.0"],
        ["process-nextick-args", "2.0.1"],
        ["safe-buffer", "5.1.2"],
        ["string_decoder", "1.1.1"],
        ["util-deprecate", "1.0.2"],
        ["readable-stream", "2.3.6"],
      ]),
    }],
  ])],
  ["core-util-is", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-core-util-is-1.0.2-b5fd54220aa2bc5ab57aab7140c940754503c1a7/node_modules/core-util-is/"),
      packageDependencies: new Map([
        ["core-util-is", "1.0.2"],
      ]),
    }],
  ])],
  ["process-nextick-args", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-process-nextick-args-2.0.1-7820d9b16120cc55ca9ae7792680ae7dba6d7fe2/node_modules/process-nextick-args/"),
      packageDependencies: new Map([
        ["process-nextick-args", "2.0.1"],
      ]),
    }],
  ])],
  ["safe-buffer", new Map([
    ["5.1.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-safe-buffer-5.1.2-991ec69d296e0313747d59bdfd2b745c35f8828d/node_modules/safe-buffer/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
      ]),
    }],
  ])],
  ["string_decoder", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-string-decoder-1.1.1-9cf1611ba62685d7030ae9e4ba34149c3af03fc8/node_modules/string_decoder/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
        ["string_decoder", "1.1.1"],
      ]),
    }],
  ])],
  ["util-deprecate", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-util-deprecate-1.0.2-450d4dc9fa70de732762fbd2d4a28981419a0ccf/node_modules/util-deprecate/"),
      packageDependencies: new Map([
        ["util-deprecate", "1.0.2"],
      ]),
    }],
  ])],
  ["upath", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-upath-1.1.2-3db658600edaeeccbe6db5e684d67ee8c2acd068/node_modules/upath/"),
      packageDependencies: new Map([
        ["upath", "1.1.2"],
      ]),
    }],
  ])],
  ["connect", new Map([
    ["3.6.6", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-connect-3.6.6-09eff6c55af7236e137135a72574858b6786f524/node_modules/connect/"),
      packageDependencies: new Map([
        ["debug", "2.6.9"],
        ["finalhandler", "1.1.0"],
        ["parseurl", "1.3.3"],
        ["utils-merge", "1.0.1"],
        ["connect", "3.6.6"],
      ]),
    }],
  ])],
  ["finalhandler", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-finalhandler-1.1.0-ce0b6855b45853e791b2fcc680046d88253dd7f5/node_modules/finalhandler/"),
      packageDependencies: new Map([
        ["debug", "2.6.9"],
        ["encodeurl", "1.0.2"],
        ["escape-html", "1.0.3"],
        ["on-finished", "2.3.0"],
        ["parseurl", "1.3.3"],
        ["statuses", "1.3.1"],
        ["unpipe", "1.0.0"],
        ["finalhandler", "1.1.0"],
      ]),
    }],
  ])],
  ["encodeurl", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-encodeurl-1.0.2-ad3ff4c86ec2d029322f5a02c3a9a606c95b3f59/node_modules/encodeurl/"),
      packageDependencies: new Map([
        ["encodeurl", "1.0.2"],
      ]),
    }],
  ])],
  ["escape-html", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-escape-html-1.0.3-0258eae4d3d0c0974de1c169188ef0051d1d1988/node_modules/escape-html/"),
      packageDependencies: new Map([
        ["escape-html", "1.0.3"],
      ]),
    }],
  ])],
  ["on-finished", new Map([
    ["2.3.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-on-finished-2.3.0-20f1336481b083cd75337992a16971aa2d906947/node_modules/on-finished/"),
      packageDependencies: new Map([
        ["ee-first", "1.1.1"],
        ["on-finished", "2.3.0"],
      ]),
    }],
  ])],
  ["ee-first", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-ee-first-1.1.1-590c61156b0ae2f4f0255732a158b266bc56b21d/node_modules/ee-first/"),
      packageDependencies: new Map([
        ["ee-first", "1.1.1"],
      ]),
    }],
  ])],
  ["parseurl", new Map([
    ["1.3.3", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-parseurl-1.3.3-9da19e7bee8d12dff0513ed5b76957793bc2e8d4/node_modules/parseurl/"),
      packageDependencies: new Map([
        ["parseurl", "1.3.3"],
      ]),
    }],
  ])],
  ["statuses", new Map([
    ["1.3.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-statuses-1.3.1-faf51b9eb74aaef3b3acf4ad5f61abf24cb7b93e/node_modules/statuses/"),
      packageDependencies: new Map([
        ["statuses", "1.3.1"],
      ]),
    }],
    ["1.5.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-statuses-1.5.0-161c7dac177659fd9811f43771fa99381478628c/node_modules/statuses/"),
      packageDependencies: new Map([
        ["statuses", "1.5.0"],
      ]),
    }],
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-statuses-1.4.0-bb73d446da2796106efcc1b601a253d6c46bd087/node_modules/statuses/"),
      packageDependencies: new Map([
        ["statuses", "1.4.0"],
      ]),
    }],
  ])],
  ["unpipe", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-unpipe-1.0.0-b2bf4ee8514aae6165b4817829d21b2ef49904ec/node_modules/unpipe/"),
      packageDependencies: new Map([
        ["unpipe", "1.0.0"],
      ]),
    }],
  ])],
  ["utils-merge", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-utils-merge-1.0.1-9f95710f50a267947b2ccc124741c1028427e713/node_modules/utils-merge/"),
      packageDependencies: new Map([
        ["utils-merge", "1.0.1"],
      ]),
    }],
  ])],
  ["dev-ip", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-dev-ip-1.0.1-a76a3ed1855be7a012bb8ac16cb80f3c00dc28f0/node_modules/dev-ip/"),
      packageDependencies: new Map([
        ["dev-ip", "1.0.1"],
      ]),
    }],
  ])],
  ["easy-extender", new Map([
    ["2.3.4", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-easy-extender-2.3.4-298789b64f9aaba62169c77a2b3b64b4c9589b8f/node_modules/easy-extender/"),
      packageDependencies: new Map([
        ["lodash", "4.17.15"],
        ["easy-extender", "2.3.4"],
      ]),
    }],
  ])],
  ["lodash", new Map([
    ["4.17.15", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-lodash-4.17.15-b447f6670a0455bbfeedd11392eff330ea097548/node_modules/lodash/"),
      packageDependencies: new Map([
        ["lodash", "4.17.15"],
      ]),
    }],
  ])],
  ["eazy-logger", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-eazy-logger-3.0.2-a325aa5e53d13a2225889b2ac4113b2b9636f4fc/node_modules/eazy-logger/"),
      packageDependencies: new Map([
        ["tfunk", "3.1.0"],
        ["eazy-logger", "3.0.2"],
      ]),
    }],
  ])],
  ["tfunk", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-tfunk-3.1.0-38e4414fc64977d87afdaa72facb6d29f82f7b5b/node_modules/tfunk/"),
      packageDependencies: new Map([
        ["chalk", "1.1.3"],
        ["object-path", "0.9.2"],
        ["tfunk", "3.1.0"],
      ]),
    }],
  ])],
  ["chalk", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-chalk-1.1.3-a8115c55e4a702fe4d150abd3872822a7e09fc98/node_modules/chalk/"),
      packageDependencies: new Map([
        ["ansi-styles", "2.2.1"],
        ["escape-string-regexp", "1.0.5"],
        ["has-ansi", "2.0.0"],
        ["strip-ansi", "3.0.1"],
        ["supports-color", "2.0.0"],
        ["chalk", "1.1.3"],
      ]),
    }],
  ])],
  ["ansi-styles", new Map([
    ["2.2.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-ansi-styles-2.2.1-b432dd3358b634cf75e1e4664368240533c1ddbe/node_modules/ansi-styles/"),
      packageDependencies: new Map([
        ["ansi-styles", "2.2.1"],
      ]),
    }],
  ])],
  ["escape-string-regexp", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-escape-string-regexp-1.0.5-1b61c0562190a8dff6ae3bb2cf0200ca130b86d4/node_modules/escape-string-regexp/"),
      packageDependencies: new Map([
        ["escape-string-regexp", "1.0.5"],
      ]),
    }],
  ])],
  ["has-ansi", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-has-ansi-2.0.0-34f5049ce1ecdf2b0649af3ef24e45ed35416d91/node_modules/has-ansi/"),
      packageDependencies: new Map([
        ["ansi-regex", "2.1.1"],
        ["has-ansi", "2.0.0"],
      ]),
    }],
  ])],
  ["ansi-regex", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-ansi-regex-2.1.1-c3b33ab5ee360d86e0e628f0468ae7ef27d654df/node_modules/ansi-regex/"),
      packageDependencies: new Map([
        ["ansi-regex", "2.1.1"],
      ]),
    }],
  ])],
  ["strip-ansi", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-strip-ansi-3.0.1-6a385fb8853d952d5ff05d0e8aaf94278dc63dcf/node_modules/strip-ansi/"),
      packageDependencies: new Map([
        ["ansi-regex", "2.1.1"],
        ["strip-ansi", "3.0.1"],
      ]),
    }],
  ])],
  ["supports-color", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-supports-color-2.0.0-535d045ce6b6363fa40117084629995e9df324c7/node_modules/supports-color/"),
      packageDependencies: new Map([
        ["supports-color", "2.0.0"],
      ]),
    }],
  ])],
  ["object-path", new Map([
    ["0.9.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-object-path-0.9.2-0fd9a74fc5fad1ae3968b586bda5c632bd6c05a5/node_modules/object-path/"),
      packageDependencies: new Map([
        ["object-path", "0.9.2"],
      ]),
    }],
  ])],
  ["fs-extra", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-fs-extra-3.0.1-3794f378c58b342ea7dbbb23095109c4b3b62291/node_modules/fs-extra/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
        ["jsonfile", "3.0.1"],
        ["universalify", "0.1.2"],
        ["fs-extra", "3.0.1"],
      ]),
    }],
  ])],
  ["jsonfile", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-jsonfile-3.0.1-a5ecc6f65f53f662c4415c7675a0331d0992ec66/node_modules/jsonfile/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
        ["jsonfile", "3.0.1"],
      ]),
    }],
  ])],
  ["universalify", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-universalify-0.1.2-b646f69be3942dabcecc9d6639c80dc105efaa66/node_modules/universalify/"),
      packageDependencies: new Map([
        ["universalify", "0.1.2"],
      ]),
    }],
  ])],
  ["http-proxy", new Map([
    ["1.15.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-http-proxy-1.15.2-642fdcaffe52d3448d2bda3b0079e9409064da31/node_modules/http-proxy/"),
      packageDependencies: new Map([
        ["eventemitter3", "1.2.0"],
        ["requires-port", "1.0.0"],
        ["http-proxy", "1.15.2"],
      ]),
    }],
  ])],
  ["eventemitter3", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-eventemitter3-1.2.0-1c86991d816ad1e504750e73874224ecf3bec508/node_modules/eventemitter3/"),
      packageDependencies: new Map([
        ["eventemitter3", "1.2.0"],
      ]),
    }],
  ])],
  ["requires-port", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-requires-port-1.0.0-925d2601d39ac485e091cf0da5c6e694dc3dcaff/node_modules/requires-port/"),
      packageDependencies: new Map([
        ["requires-port", "1.0.0"],
      ]),
    }],
  ])],
  ["localtunnel", new Map([
    ["1.9.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-localtunnel-1.9.2-0012fcabc29cf964c130a01858768aa2bb65b5af/node_modules/localtunnel/"),
      packageDependencies: new Map([
        ["axios", "0.19.0"],
        ["debug", "4.1.1"],
        ["openurl", "1.1.1"],
        ["yargs", "6.6.0"],
        ["localtunnel", "1.9.2"],
      ]),
    }],
  ])],
  ["axios", new Map([
    ["0.19.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-axios-0.19.0-8e09bff3d9122e133f7b8101c8fbdd00ed3d2ab8/node_modules/axios/"),
      packageDependencies: new Map([
        ["follow-redirects", "1.5.10"],
        ["is-buffer", "2.0.3"],
        ["axios", "0.19.0"],
      ]),
    }],
  ])],
  ["follow-redirects", new Map([
    ["1.5.10", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-follow-redirects-1.5.10-7b7a9f9aea2fdff36786a94ff643ed07f4ff5e2a/node_modules/follow-redirects/"),
      packageDependencies: new Map([
        ["debug", "3.1.0"],
        ["follow-redirects", "1.5.10"],
      ]),
    }],
  ])],
  ["openurl", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-openurl-1.1.1-3875b4b0ef7a52c156f0db41d4609dbb0f94b387/node_modules/openurl/"),
      packageDependencies: new Map([
        ["openurl", "1.1.1"],
      ]),
    }],
  ])],
  ["yargs", new Map([
    ["6.6.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-yargs-6.6.0-782ec21ef403345f830a808ca3d513af56065208/node_modules/yargs/"),
      packageDependencies: new Map([
        ["camelcase", "3.0.0"],
        ["cliui", "3.2.0"],
        ["decamelize", "1.2.0"],
        ["get-caller-file", "1.0.3"],
        ["os-locale", "1.4.0"],
        ["read-pkg-up", "1.0.1"],
        ["require-directory", "2.1.1"],
        ["require-main-filename", "1.0.1"],
        ["set-blocking", "2.0.0"],
        ["string-width", "1.0.2"],
        ["which-module", "1.0.0"],
        ["y18n", "3.2.1"],
        ["yargs-parser", "4.2.1"],
        ["yargs", "6.6.0"],
      ]),
    }],
    ["6.4.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-yargs-6.4.0-816e1a866d5598ccf34e5596ddce22d92da490d4/node_modules/yargs/"),
      packageDependencies: new Map([
        ["camelcase", "3.0.0"],
        ["cliui", "3.2.0"],
        ["decamelize", "1.2.0"],
        ["get-caller-file", "1.0.3"],
        ["os-locale", "1.4.0"],
        ["read-pkg-up", "1.0.1"],
        ["require-directory", "2.1.1"],
        ["require-main-filename", "1.0.1"],
        ["set-blocking", "2.0.0"],
        ["string-width", "1.0.2"],
        ["which-module", "1.0.0"],
        ["window-size", "0.2.0"],
        ["y18n", "3.2.1"],
        ["yargs-parser", "4.2.1"],
        ["yargs", "6.4.0"],
      ]),
    }],
  ])],
  ["camelcase", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-camelcase-3.0.0-32fc4b9fcdaf845fcdf7e73bb97cac2261f0ab0a/node_modules/camelcase/"),
      packageDependencies: new Map([
        ["camelcase", "3.0.0"],
      ]),
    }],
  ])],
  ["cliui", new Map([
    ["3.2.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-cliui-3.2.0-120601537a916d29940f934da3b48d585a39213d/node_modules/cliui/"),
      packageDependencies: new Map([
        ["string-width", "1.0.2"],
        ["strip-ansi", "3.0.1"],
        ["wrap-ansi", "2.1.0"],
        ["cliui", "3.2.0"],
      ]),
    }],
  ])],
  ["string-width", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-string-width-1.0.2-118bdf5b8cdc51a2a7e70d211e07e2b0b9b107d3/node_modules/string-width/"),
      packageDependencies: new Map([
        ["code-point-at", "1.1.0"],
        ["is-fullwidth-code-point", "1.0.0"],
        ["strip-ansi", "3.0.1"],
        ["string-width", "1.0.2"],
      ]),
    }],
  ])],
  ["code-point-at", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-code-point-at-1.1.0-0d070b4d043a5bea33a2f1a40e2edb3d9a4ccf77/node_modules/code-point-at/"),
      packageDependencies: new Map([
        ["code-point-at", "1.1.0"],
      ]),
    }],
  ])],
  ["is-fullwidth-code-point", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-fullwidth-code-point-1.0.0-ef9e31386f031a7f0d643af82fde50c457ef00cb/node_modules/is-fullwidth-code-point/"),
      packageDependencies: new Map([
        ["number-is-nan", "1.0.1"],
        ["is-fullwidth-code-point", "1.0.0"],
      ]),
    }],
  ])],
  ["number-is-nan", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-number-is-nan-1.0.1-097b602b53422a522c1afb8790318336941a011d/node_modules/number-is-nan/"),
      packageDependencies: new Map([
        ["number-is-nan", "1.0.1"],
      ]),
    }],
  ])],
  ["wrap-ansi", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-wrap-ansi-2.1.0-d8fc3d284dd05794fe84973caecdd1cf824fdd85/node_modules/wrap-ansi/"),
      packageDependencies: new Map([
        ["string-width", "1.0.2"],
        ["strip-ansi", "3.0.1"],
        ["wrap-ansi", "2.1.0"],
      ]),
    }],
  ])],
  ["decamelize", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-decamelize-1.2.0-f6534d15148269b20352e7bee26f501f9a191290/node_modules/decamelize/"),
      packageDependencies: new Map([
        ["decamelize", "1.2.0"],
      ]),
    }],
  ])],
  ["get-caller-file", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-get-caller-file-1.0.3-f978fa4c90d1dfe7ff2d6beda2a515e713bdcf4a/node_modules/get-caller-file/"),
      packageDependencies: new Map([
        ["get-caller-file", "1.0.3"],
      ]),
    }],
  ])],
  ["os-locale", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-os-locale-1.4.0-20f9f17ae29ed345e8bde583b13d2009803c14d9/node_modules/os-locale/"),
      packageDependencies: new Map([
        ["lcid", "1.0.0"],
        ["os-locale", "1.4.0"],
      ]),
    }],
  ])],
  ["lcid", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-lcid-1.0.0-308accafa0bc483a3867b4b6f2b9506251d1b835/node_modules/lcid/"),
      packageDependencies: new Map([
        ["invert-kv", "1.0.0"],
        ["lcid", "1.0.0"],
      ]),
    }],
  ])],
  ["invert-kv", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-invert-kv-1.0.0-104a8e4aaca6d3d8cd157a8ef8bfab2d7a3ffdb6/node_modules/invert-kv/"),
      packageDependencies: new Map([
        ["invert-kv", "1.0.0"],
      ]),
    }],
  ])],
  ["read-pkg-up", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-read-pkg-up-1.0.1-9d63c13276c065918d57f002a57f40a1b643fb02/node_modules/read-pkg-up/"),
      packageDependencies: new Map([
        ["find-up", "1.1.2"],
        ["read-pkg", "1.1.0"],
        ["read-pkg-up", "1.0.1"],
      ]),
    }],
  ])],
  ["find-up", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-find-up-1.1.2-6b2e9822b1a2ce0a60ab64d610eccad53cb24d0f/node_modules/find-up/"),
      packageDependencies: new Map([
        ["path-exists", "2.1.0"],
        ["pinkie-promise", "2.0.1"],
        ["find-up", "1.1.2"],
      ]),
    }],
  ])],
  ["path-exists", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-path-exists-2.1.0-0feb6c64f0fc518d9a754dd5efb62c7022761f4b/node_modules/path-exists/"),
      packageDependencies: new Map([
        ["pinkie-promise", "2.0.1"],
        ["path-exists", "2.1.0"],
      ]),
    }],
  ])],
  ["pinkie-promise", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-pinkie-promise-2.0.1-2135d6dfa7a358c069ac9b178776288228450ffa/node_modules/pinkie-promise/"),
      packageDependencies: new Map([
        ["pinkie", "2.0.4"],
        ["pinkie-promise", "2.0.1"],
      ]),
    }],
  ])],
  ["pinkie", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-pinkie-2.0.4-72556b80cfa0d48a974e80e77248e80ed4f7f870/node_modules/pinkie/"),
      packageDependencies: new Map([
        ["pinkie", "2.0.4"],
      ]),
    }],
  ])],
  ["read-pkg", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-read-pkg-1.1.0-f5ffaa5ecd29cb31c0474bca7d756b6bb29e3f28/node_modules/read-pkg/"),
      packageDependencies: new Map([
        ["load-json-file", "1.1.0"],
        ["normalize-package-data", "2.5.0"],
        ["path-type", "1.1.0"],
        ["read-pkg", "1.1.0"],
      ]),
    }],
  ])],
  ["load-json-file", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-load-json-file-1.1.0-956905708d58b4bab4c2261b04f59f31c99374c0/node_modules/load-json-file/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
        ["parse-json", "2.2.0"],
        ["pify", "2.3.0"],
        ["pinkie-promise", "2.0.1"],
        ["strip-bom", "2.0.0"],
        ["load-json-file", "1.1.0"],
      ]),
    }],
  ])],
  ["parse-json", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-parse-json-2.2.0-f480f40434ef80741f8469099f8dea18f55a4dc9/node_modules/parse-json/"),
      packageDependencies: new Map([
        ["error-ex", "1.3.2"],
        ["parse-json", "2.2.0"],
      ]),
    }],
  ])],
  ["error-ex", new Map([
    ["1.3.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-error-ex-1.3.2-b4ac40648107fdcdcfae242f428bea8a14d4f1bf/node_modules/error-ex/"),
      packageDependencies: new Map([
        ["is-arrayish", "0.2.1"],
        ["error-ex", "1.3.2"],
      ]),
    }],
  ])],
  ["is-arrayish", new Map([
    ["0.2.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-arrayish-0.2.1-77c99840527aa8ecb1a8ba697b80645a7a926a9d/node_modules/is-arrayish/"),
      packageDependencies: new Map([
        ["is-arrayish", "0.2.1"],
      ]),
    }],
  ])],
  ["pify", new Map([
    ["2.3.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-pify-2.3.0-ed141a6ac043a849ea588498e7dca8b15330e90c/node_modules/pify/"),
      packageDependencies: new Map([
        ["pify", "2.3.0"],
      ]),
    }],
  ])],
  ["strip-bom", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-strip-bom-2.0.0-6219a85616520491f35788bdbf1447a99c7e6b0e/node_modules/strip-bom/"),
      packageDependencies: new Map([
        ["is-utf8", "0.2.1"],
        ["strip-bom", "2.0.0"],
      ]),
    }],
  ])],
  ["is-utf8", new Map([
    ["0.2.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-utf8-0.2.1-4b0da1442104d1b336340e80797e865cf39f7d72/node_modules/is-utf8/"),
      packageDependencies: new Map([
        ["is-utf8", "0.2.1"],
      ]),
    }],
  ])],
  ["normalize-package-data", new Map([
    ["2.5.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-normalize-package-data-2.5.0-e66db1838b200c1dfc233225d12cb36520e234a8/node_modules/normalize-package-data/"),
      packageDependencies: new Map([
        ["hosted-git-info", "2.8.4"],
        ["resolve", "1.12.0"],
        ["semver", "5.7.1"],
        ["validate-npm-package-license", "3.0.4"],
        ["normalize-package-data", "2.5.0"],
      ]),
    }],
  ])],
  ["hosted-git-info", new Map([
    ["2.8.4", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-hosted-git-info-2.8.4-44119abaf4bc64692a16ace34700fed9c03e2546/node_modules/hosted-git-info/"),
      packageDependencies: new Map([
        ["hosted-git-info", "2.8.4"],
      ]),
    }],
  ])],
  ["resolve", new Map([
    ["1.12.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-resolve-1.12.0-3fc644a35c84a48554609ff26ec52b66fa577df6/node_modules/resolve/"),
      packageDependencies: new Map([
        ["path-parse", "1.0.6"],
        ["resolve", "1.12.0"],
      ]),
    }],
  ])],
  ["path-parse", new Map([
    ["1.0.6", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-path-parse-1.0.6-d62dbb5679405d72c4737ec58600e9ddcf06d24c/node_modules/path-parse/"),
      packageDependencies: new Map([
        ["path-parse", "1.0.6"],
      ]),
    }],
  ])],
  ["semver", new Map([
    ["5.7.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-semver-5.7.1-a954f931aeba508d307bbf069eff0c01c96116f7/node_modules/semver/"),
      packageDependencies: new Map([
        ["semver", "5.7.1"],
      ]),
    }],
  ])],
  ["validate-npm-package-license", new Map([
    ["3.0.4", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-validate-npm-package-license-3.0.4-fc91f6b9c7ba15c857f4cb2c5defeec39d4f410a/node_modules/validate-npm-package-license/"),
      packageDependencies: new Map([
        ["spdx-correct", "3.1.0"],
        ["spdx-expression-parse", "3.0.0"],
        ["validate-npm-package-license", "3.0.4"],
      ]),
    }],
  ])],
  ["spdx-correct", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-spdx-correct-3.1.0-fb83e504445268f154b074e218c87c003cd31df4/node_modules/spdx-correct/"),
      packageDependencies: new Map([
        ["spdx-expression-parse", "3.0.0"],
        ["spdx-license-ids", "3.0.5"],
        ["spdx-correct", "3.1.0"],
      ]),
    }],
  ])],
  ["spdx-expression-parse", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-spdx-expression-parse-3.0.0-99e119b7a5da00e05491c9fa338b7904823b41d0/node_modules/spdx-expression-parse/"),
      packageDependencies: new Map([
        ["spdx-exceptions", "2.2.0"],
        ["spdx-license-ids", "3.0.5"],
        ["spdx-expression-parse", "3.0.0"],
      ]),
    }],
  ])],
  ["spdx-exceptions", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-spdx-exceptions-2.2.0-2ea450aee74f2a89bfb94519c07fcd6f41322977/node_modules/spdx-exceptions/"),
      packageDependencies: new Map([
        ["spdx-exceptions", "2.2.0"],
      ]),
    }],
  ])],
  ["spdx-license-ids", new Map([
    ["3.0.5", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-spdx-license-ids-3.0.5-3694b5804567a458d3c8045842a6358632f62654/node_modules/spdx-license-ids/"),
      packageDependencies: new Map([
        ["spdx-license-ids", "3.0.5"],
      ]),
    }],
  ])],
  ["path-type", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-path-type-1.1.0-59c44f7ee491da704da415da5a4070ba4f8fe441/node_modules/path-type/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
        ["pify", "2.3.0"],
        ["pinkie-promise", "2.0.1"],
        ["path-type", "1.1.0"],
      ]),
    }],
  ])],
  ["require-directory", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-require-directory-2.1.1-8c64ad5fd30dab1c976e2344ffe7f792a6a6df42/node_modules/require-directory/"),
      packageDependencies: new Map([
        ["require-directory", "2.1.1"],
      ]),
    }],
  ])],
  ["require-main-filename", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-require-main-filename-1.0.1-97f717b69d48784f5f526a6c5aa8ffdda055a4d1/node_modules/require-main-filename/"),
      packageDependencies: new Map([
        ["require-main-filename", "1.0.1"],
      ]),
    }],
  ])],
  ["set-blocking", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-set-blocking-2.0.0-045f9782d011ae9a6803ddd382b24392b3d890f7/node_modules/set-blocking/"),
      packageDependencies: new Map([
        ["set-blocking", "2.0.0"],
      ]),
    }],
  ])],
  ["which-module", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-which-module-1.0.0-bba63ca861948994ff307736089e3b96026c2a4f/node_modules/which-module/"),
      packageDependencies: new Map([
        ["which-module", "1.0.0"],
      ]),
    }],
  ])],
  ["y18n", new Map([
    ["3.2.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-y18n-3.2.1-6d15fba884c08679c0d77e88e7759e811e07fa41/node_modules/y18n/"),
      packageDependencies: new Map([
        ["y18n", "3.2.1"],
      ]),
    }],
  ])],
  ["yargs-parser", new Map([
    ["4.2.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-yargs-parser-4.2.1-29cceac0dc4f03c6c87b4a9f217dd18c9f74871c/node_modules/yargs-parser/"),
      packageDependencies: new Map([
        ["camelcase", "3.0.0"],
        ["yargs-parser", "4.2.1"],
      ]),
    }],
  ])],
  ["opn", new Map([
    ["5.3.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-opn-5.3.0-64871565c863875f052cfdf53d3e3cb5adb53b1c/node_modules/opn/"),
      packageDependencies: new Map([
        ["is-wsl", "1.1.0"],
        ["opn", "5.3.0"],
      ]),
    }],
  ])],
  ["is-wsl", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-wsl-1.1.0-1f16e4aa22b04d1336b66188a66af3c600c3a66d/node_modules/is-wsl/"),
      packageDependencies: new Map([
        ["is-wsl", "1.1.0"],
      ]),
    }],
  ])],
  ["portscanner", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-portscanner-2.1.1-eabb409e4de24950f5a2a516d35ae769343fbb96/node_modules/portscanner/"),
      packageDependencies: new Map([
        ["async", "1.5.2"],
        ["is-number-like", "1.0.8"],
        ["portscanner", "2.1.1"],
      ]),
    }],
  ])],
  ["async", new Map([
    ["1.5.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-async-1.5.2-ec6a61ae56480c0c3cb241c95618e20892f9672a/node_modules/async/"),
      packageDependencies: new Map([
        ["async", "1.5.2"],
      ]),
    }],
  ])],
  ["is-number-like", new Map([
    ["1.0.8", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-is-number-like-1.0.8-2e129620b50891042e44e9bbbb30593e75cfbbe3/node_modules/is-number-like/"),
      packageDependencies: new Map([
        ["lodash.isfinite", "3.3.2"],
        ["is-number-like", "1.0.8"],
      ]),
    }],
  ])],
  ["lodash.isfinite", new Map([
    ["3.3.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-lodash-isfinite-3.3.2-fb89b65a9a80281833f0b7478b3a5104f898ebb3/node_modules/lodash.isfinite/"),
      packageDependencies: new Map([
        ["lodash.isfinite", "3.3.2"],
      ]),
    }],
  ])],
  ["qs", new Map([
    ["6.2.3", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-qs-6.2.3-1cfcb25c10a9b2b483053ff39f5dfc9233908cfe/node_modules/qs/"),
      packageDependencies: new Map([
        ["qs", "6.2.3"],
      ]),
    }],
  ])],
  ["raw-body", new Map([
    ["2.4.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-raw-body-2.4.1-30ac82f98bb5ae8c152e67149dac8d55153b168c/node_modules/raw-body/"),
      packageDependencies: new Map([
        ["bytes", "3.1.0"],
        ["http-errors", "1.7.3"],
        ["iconv-lite", "0.4.24"],
        ["unpipe", "1.0.0"],
        ["raw-body", "2.4.1"],
      ]),
    }],
  ])],
  ["bytes", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-bytes-3.1.0-f6cf7933a360e0588fa9fde85651cdc7f805d1f6/node_modules/bytes/"),
      packageDependencies: new Map([
        ["bytes", "3.1.0"],
      ]),
    }],
  ])],
  ["http-errors", new Map([
    ["1.7.3", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-http-errors-1.7.3-6c619e4f9c60308c38519498c14fbb10aacebb06/node_modules/http-errors/"),
      packageDependencies: new Map([
        ["depd", "1.1.2"],
        ["inherits", "2.0.4"],
        ["setprototypeof", "1.1.1"],
        ["statuses", "1.5.0"],
        ["toidentifier", "1.0.0"],
        ["http-errors", "1.7.3"],
      ]),
    }],
    ["1.6.3", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-http-errors-1.6.3-8b55680bb4be283a0b5bf4ea2e38580be1d9320d/node_modules/http-errors/"),
      packageDependencies: new Map([
        ["depd", "1.1.2"],
        ["inherits", "2.0.3"],
        ["setprototypeof", "1.1.0"],
        ["statuses", "1.5.0"],
        ["http-errors", "1.6.3"],
      ]),
    }],
  ])],
  ["depd", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-depd-1.1.2-9bcd52e14c097763e749b274c4346ed2e560b5a9/node_modules/depd/"),
      packageDependencies: new Map([
        ["depd", "1.1.2"],
      ]),
    }],
  ])],
  ["setprototypeof", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-setprototypeof-1.1.1-7e95acb24aa92f5885e0abef5ba131330d4ae683/node_modules/setprototypeof/"),
      packageDependencies: new Map([
        ["setprototypeof", "1.1.1"],
      ]),
    }],
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-setprototypeof-1.1.0-d0bd85536887b6fe7c0d818cb962d9d91c54e656/node_modules/setprototypeof/"),
      packageDependencies: new Map([
        ["setprototypeof", "1.1.0"],
      ]),
    }],
  ])],
  ["toidentifier", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-toidentifier-1.0.0-7e1be3470f1e77948bc43d94a3c8f4d7752ba553/node_modules/toidentifier/"),
      packageDependencies: new Map([
        ["toidentifier", "1.0.0"],
      ]),
    }],
  ])],
  ["iconv-lite", new Map([
    ["0.4.24", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-iconv-lite-0.4.24-2022b4b25fbddc21d2f524974a474aafe733908b/node_modules/iconv-lite/"),
      packageDependencies: new Map([
        ["safer-buffer", "2.1.2"],
        ["iconv-lite", "0.4.24"],
      ]),
    }],
  ])],
  ["safer-buffer", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-safer-buffer-2.1.2-44fa161b0187b9549dd84bb91802f9bd8385cd6a/node_modules/safer-buffer/"),
      packageDependencies: new Map([
        ["safer-buffer", "2.1.2"],
      ]),
    }],
  ])],
  ["resp-modifier", new Map([
    ["6.0.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-resp-modifier-6.0.2-b124de5c4fbafcba541f48ffa73970f4aa456b4f/node_modules/resp-modifier/"),
      packageDependencies: new Map([
        ["debug", "2.6.9"],
        ["minimatch", "3.0.4"],
        ["resp-modifier", "6.0.2"],
      ]),
    }],
  ])],
  ["minimatch", new Map([
    ["3.0.4", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-minimatch-3.0.4-5166e286457f03306064be5497e8dbb0c3d32083/node_modules/minimatch/"),
      packageDependencies: new Map([
        ["brace-expansion", "1.1.11"],
        ["minimatch", "3.0.4"],
      ]),
    }],
  ])],
  ["brace-expansion", new Map([
    ["1.1.11", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-brace-expansion-1.1.11-3c7fcbf529d87226f3d2f52b966ff5271eb441dd/node_modules/brace-expansion/"),
      packageDependencies: new Map([
        ["balanced-match", "1.0.0"],
        ["concat-map", "0.0.1"],
        ["brace-expansion", "1.1.11"],
      ]),
    }],
  ])],
  ["balanced-match", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-balanced-match-1.0.0-89b4d199ab2bee49de164ea02b89ce462d71b767/node_modules/balanced-match/"),
      packageDependencies: new Map([
        ["balanced-match", "1.0.0"],
      ]),
    }],
  ])],
  ["concat-map", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-concat-map-0.0.1-d8a96bd77fd68df7793a73036a3ba0d5405d477b/node_modules/concat-map/"),
      packageDependencies: new Map([
        ["concat-map", "0.0.1"],
      ]),
    }],
  ])],
  ["rx", new Map([
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-rx-4.1.0-a5f13ff79ef3b740fe30aa803fb09f98805d4782/node_modules/rx/"),
      packageDependencies: new Map([
        ["rx", "4.1.0"],
      ]),
    }],
  ])],
  ["send", new Map([
    ["0.16.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-send-0.16.2-6ecca1e0f8c156d141597559848df64730a6bbc1/node_modules/send/"),
      packageDependencies: new Map([
        ["debug", "2.6.9"],
        ["depd", "1.1.2"],
        ["destroy", "1.0.4"],
        ["encodeurl", "1.0.2"],
        ["escape-html", "1.0.3"],
        ["etag", "1.8.1"],
        ["fresh", "0.5.2"],
        ["http-errors", "1.6.3"],
        ["mime", "1.4.1"],
        ["ms", "2.0.0"],
        ["on-finished", "2.3.0"],
        ["range-parser", "1.2.1"],
        ["statuses", "1.4.0"],
        ["send", "0.16.2"],
      ]),
    }],
  ])],
  ["destroy", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-destroy-1.0.4-978857442c44749e4206613e37946205826abd80/node_modules/destroy/"),
      packageDependencies: new Map([
        ["destroy", "1.0.4"],
      ]),
    }],
  ])],
  ["mime", new Map([
    ["1.4.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-mime-1.4.1-121f9ebc49e3766f311a76e1fa1c8003c4b03aa6/node_modules/mime/"),
      packageDependencies: new Map([
        ["mime", "1.4.1"],
      ]),
    }],
  ])],
  ["range-parser", new Map([
    ["1.2.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-range-parser-1.2.1-3cf37023d199e1c24d1a55b84800c2f3e6468031/node_modules/range-parser/"),
      packageDependencies: new Map([
        ["range-parser", "1.2.1"],
      ]),
    }],
  ])],
  ["serve-index", new Map([
    ["1.9.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-serve-index-1.9.1-d3768d69b1e7d82e5ce050fff5b453bea12a9239/node_modules/serve-index/"),
      packageDependencies: new Map([
        ["accepts", "1.3.7"],
        ["batch", "0.6.1"],
        ["debug", "2.6.9"],
        ["escape-html", "1.0.3"],
        ["http-errors", "1.6.3"],
        ["mime-types", "2.1.24"],
        ["parseurl", "1.3.3"],
        ["serve-index", "1.9.1"],
      ]),
    }],
  ])],
  ["accepts", new Map([
    ["1.3.7", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-accepts-1.3.7-531bc726517a3b2b41f850021c6cc15eaab507cd/node_modules/accepts/"),
      packageDependencies: new Map([
        ["mime-types", "2.1.24"],
        ["negotiator", "0.6.2"],
        ["accepts", "1.3.7"],
      ]),
    }],
  ])],
  ["mime-types", new Map([
    ["2.1.24", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-mime-types-2.1.24-b6f8d0b3e951efb77dedeca194cff6d16f676f81/node_modules/mime-types/"),
      packageDependencies: new Map([
        ["mime-db", "1.40.0"],
        ["mime-types", "2.1.24"],
      ]),
    }],
  ])],
  ["mime-db", new Map([
    ["1.40.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-mime-db-1.40.0-a65057e998db090f732a68f6c276d387d4126c32/node_modules/mime-db/"),
      packageDependencies: new Map([
        ["mime-db", "1.40.0"],
      ]),
    }],
  ])],
  ["negotiator", new Map([
    ["0.6.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-negotiator-0.6.2-feacf7ccf525a77ae9634436a64883ffeca346fb/node_modules/negotiator/"),
      packageDependencies: new Map([
        ["negotiator", "0.6.2"],
      ]),
    }],
  ])],
  ["batch", new Map([
    ["0.6.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-batch-0.6.1-dc34314f4e679318093fc760272525f94bf25c16/node_modules/batch/"),
      packageDependencies: new Map([
        ["batch", "0.6.1"],
      ]),
    }],
  ])],
  ["serve-static", new Map([
    ["1.13.2", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-serve-static-1.13.2-095e8472fd5b46237db50ce486a43f4b86c6cec1/node_modules/serve-static/"),
      packageDependencies: new Map([
        ["encodeurl", "1.0.2"],
        ["escape-html", "1.0.3"],
        ["parseurl", "1.3.3"],
        ["send", "0.16.2"],
        ["serve-static", "1.13.2"],
      ]),
    }],
  ])],
  ["socket.io", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-socket-io-2.1.1-a069c5feabee3e6b214a75b40ce0652e1cfb9980/node_modules/socket.io/"),
      packageDependencies: new Map([
        ["debug", "3.1.0"],
        ["engine.io", "3.2.1"],
        ["has-binary2", "1.0.3"],
        ["socket.io-adapter", "1.1.1"],
        ["socket.io-client", "2.1.1"],
        ["socket.io-parser", "3.2.0"],
        ["socket.io", "2.1.1"],
      ]),
    }],
  ])],
  ["engine.io", new Map([
    ["3.2.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-engine-io-3.2.1-b60281c35484a70ee0351ea0ebff83ec8c9522a2/node_modules/engine.io/"),
      packageDependencies: new Map([
        ["accepts", "1.3.7"],
        ["base64id", "1.0.0"],
        ["debug", "3.1.0"],
        ["engine.io-parser", "2.1.3"],
        ["ws", "3.3.3"],
        ["cookie", "0.3.1"],
        ["engine.io", "3.2.1"],
      ]),
    }],
  ])],
  ["base64id", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-base64id-1.0.0-47688cb99bb6804f0e06d3e763b1c32e57d8e6b6/node_modules/base64id/"),
      packageDependencies: new Map([
        ["base64id", "1.0.0"],
      ]),
    }],
  ])],
  ["ultron", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-ultron-1.1.1-9fe1536a10a664a65266a1e3ccf85fd36302bc9c/node_modules/ultron/"),
      packageDependencies: new Map([
        ["ultron", "1.1.1"],
      ]),
    }],
  ])],
  ["cookie", new Map([
    ["0.3.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-cookie-0.3.1-e7e0a1f9ef43b4c8ba925c5c5a96e806d16873bb/node_modules/cookie/"),
      packageDependencies: new Map([
        ["cookie", "0.3.1"],
      ]),
    }],
  ])],
  ["socket.io-adapter", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-socket-io-adapter-1.1.1-2a805e8a14d6372124dd9159ad4502f8cb07f06b/node_modules/socket.io-adapter/"),
      packageDependencies: new Map([
        ["socket.io-adapter", "1.1.1"],
      ]),
    }],
  ])],
  ["ua-parser-js", new Map([
    ["0.7.17", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-ua-parser-js-0.7.17-e9ec5f9498b9ec910e7ae3ac626a805c4d09ecac/node_modules/ua-parser-js/"),
      packageDependencies: new Map([
        ["ua-parser-js", "0.7.17"],
      ]),
    }],
  ])],
  ["window-size", new Map([
    ["0.2.0", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-window-size-0.2.0-b4315bb4214a3d7058ebeee892e13fa24d98b075/node_modules/window-size/"),
      packageDependencies: new Map([
        ["window-size", "0.2.0"],
      ]),
    }],
  ])],
  ["run-script-os", new Map([
    ["1.0.7", {
      packageLocation: path.resolve(__dirname, "../../AppData/Local/Yarn/Cache/v4/npm-run-script-os-1.0.7-7cd51144a19c6ca364fe668433f55b47babf4749/node_modules/run-script-os/"),
      packageDependencies: new Map([
        ["run-script-os", "1.0.7"],
      ]),
    }],
  ])],
  [null, new Map([
    [null, {
      packageLocation: path.resolve(__dirname, "./"),
      packageDependencies: new Map([
        ["browser-sync", "2.26.7"],
        ["run-script-os", "1.0.7"],
      ]),
    }],
  ])],
]);

let locatorsByLocations = new Map([
  ["../../AppData/Local/Yarn/Cache/v4/npm-browser-sync-2.26.7-120287716eb405651a76cc74fe851c31350557f9/node_modules/browser-sync/", {"name":"browser-sync","reference":"2.26.7"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-browser-sync-client-2.26.6-e5201d3ace8aee88af17656b7b0c0620b6f8e4ab/node_modules/browser-sync-client/", {"name":"browser-sync-client","reference":"2.26.6"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-etag-1.8.1-41ae2eeb65efa62268aebfea83ac7d79299b0887/node_modules/etag/", {"name":"etag","reference":"1.8.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-fresh-0.5.2-3d8cadd90d976569fa835ab1f8e4b23a105605a7/node_modules/fresh/", {"name":"fresh","reference":"0.5.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-mitt-1.1.3-528c506238a05dce11cd914a741ea2cc332da9b8/node_modules/mitt/", {"name":"mitt","reference":"1.1.3"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-rxjs-5.5.12-6fa61b8a77c3d793dbaf270bee2f43f652d741cc/node_modules/rxjs/", {"name":"rxjs","reference":"5.5.12"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-symbol-observable-1.0.1-8340fc4702c3122df5d22288f88283f513d3fdd4/node_modules/symbol-observable/", {"name":"symbol-observable","reference":"1.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-browser-sync-ui-2.26.4-3772f13c6b93f2d7d333f4be0ca1ec02aae97dba/node_modules/browser-sync-ui/", {"name":"browser-sync-ui","reference":"2.26.4"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-async-each-series-0.1.1-7617c1917401fd8ca4a28aadce3dbae98afeb432/node_modules/async-each-series/", {"name":"async-each-series","reference":"0.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-connect-history-api-fallback-1.6.0-8b32089359308d111115d81cad3fceab888f97bc/node_modules/connect-history-api-fallback/", {"name":"connect-history-api-fallback","reference":"1.6.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-immutable-3.8.2-c2439951455bb39913daf281376f1530e104adf3/node_modules/immutable/", {"name":"immutable","reference":"3.8.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-server-destroy-1.0.1-f13bf928e42b9c3e79383e61cc3998b5d14e6cdd/node_modules/server-destroy/", {"name":"server-destroy","reference":"1.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-socket-io-client-2.2.0-84e73ee3c43d5020ccc1a258faeeb9aec2723af7/node_modules/socket.io-client/", {"name":"socket.io-client","reference":"2.2.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-socket-io-client-2.1.1-dcb38103436ab4578ddb026638ae2f21b623671f/node_modules/socket.io-client/", {"name":"socket.io-client","reference":"2.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-backo2-1.0.2-31ab1ac8b129363463e35b3ebb69f4dfcfba7947/node_modules/backo2/", {"name":"backo2","reference":"1.0.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-base64-arraybuffer-0.1.5-73926771923b5a19747ad666aa5cd4bf9c6e9ce8/node_modules/base64-arraybuffer/", {"name":"base64-arraybuffer","reference":"0.1.5"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-component-bind-1.0.0-00c608ab7dcd93897c0009651b1d3a8e1e73bbd1/node_modules/component-bind/", {"name":"component-bind","reference":"1.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-component-emitter-1.2.1-137918d6d78283f7df7a6b7c5a63e140e69425e6/node_modules/component-emitter/", {"name":"component-emitter","reference":"1.2.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-component-emitter-1.3.0-16e4070fba8ae29b679f2215853ee181ab2eabc0/node_modules/component-emitter/", {"name":"component-emitter","reference":"1.3.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-debug-3.1.0-5bb5a0672628b64149566ba16819e61518c67261/node_modules/debug/", {"name":"debug","reference":"3.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-debug-2.6.9-5d128515df134ff327e90a4c93f4e077a536341f/node_modules/debug/", {"name":"debug","reference":"2.6.9"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-debug-4.1.1-3b72260255109c6b589cee050f1d516139664791/node_modules/debug/", {"name":"debug","reference":"4.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-ms-2.0.0-5608aeadfc00be6c2901df5f9861788de0d597c8/node_modules/ms/", {"name":"ms","reference":"2.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-ms-2.1.2-d09d1f357b443f493382a8eb3ccd183872ae6009/node_modules/ms/", {"name":"ms","reference":"2.1.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-engine-io-client-3.3.2-04e068798d75beda14375a264bb3d742d7bc33aa/node_modules/engine.io-client/", {"name":"engine.io-client","reference":"3.3.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-engine-io-client-3.2.1-6f54c0475de487158a1a7c77d10178708b6add36/node_modules/engine.io-client/", {"name":"engine.io-client","reference":"3.2.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-component-inherit-0.0.3-645fc4adf58b72b649d5cae65135619db26ff143/node_modules/component-inherit/", {"name":"component-inherit","reference":"0.0.3"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-engine-io-parser-2.1.3-757ab970fbf2dfb32c7b74b033216d5739ef79a6/node_modules/engine.io-parser/", {"name":"engine.io-parser","reference":"2.1.3"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-after-0.8.2-fedb394f9f0e02aa9768e702bda23b505fae7e1f/node_modules/after/", {"name":"after","reference":"0.8.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-arraybuffer-slice-0.0.7-3bbc4275dd584cc1b10809b89d4e8b63a69e7675/node_modules/arraybuffer.slice/", {"name":"arraybuffer.slice","reference":"0.0.7"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-blob-0.0.5-d680eeef25f8cd91ad533f5b01eed48e64caf683/node_modules/blob/", {"name":"blob","reference":"0.0.5"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-has-binary2-1.0.3-7776ac627f3ea77250cfc332dab7ddf5e4f5d11d/node_modules/has-binary2/", {"name":"has-binary2","reference":"1.0.3"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-isarray-2.0.1-a37d94ed9cda2d59865c9f76fe596ee1f338741e/node_modules/isarray/", {"name":"isarray","reference":"2.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-isarray-1.0.0-bb935d48582cba168c06834957a54a3e07124f11/node_modules/isarray/", {"name":"isarray","reference":"1.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-has-cors-1.1.0-5e474793f7ea9843d1bb99c23eef49ff126fff39/node_modules/has-cors/", {"name":"has-cors","reference":"1.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-indexof-0.0.1-82dc336d232b9062179d05ab3293a66059fd435d/node_modules/indexof/", {"name":"indexof","reference":"0.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-parseqs-0.0.5-d5208a3738e46766e291ba2ea173684921a8b89d/node_modules/parseqs/", {"name":"parseqs","reference":"0.0.5"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-better-assert-1.0.2-40866b9e1b9e0b55b481894311e68faffaebc522/node_modules/better-assert/", {"name":"better-assert","reference":"1.0.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-callsite-1.0.0-280398e5d664bd74038b6f0905153e6e8af1bc20/node_modules/callsite/", {"name":"callsite","reference":"1.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-parseuri-0.0.5-80204a50d4dbb779bfdc6ebe2778d90e4bce320a/node_modules/parseuri/", {"name":"parseuri","reference":"0.0.5"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-ws-6.1.4-5b5c8800afab925e94ccb29d153c8d02c1776ef9/node_modules/ws/", {"name":"ws","reference":"6.1.4"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-ws-3.3.3-f1cf84fe2d5e901ebce94efaece785f187a228f2/node_modules/ws/", {"name":"ws","reference":"3.3.3"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-async-limiter-1.0.1-dd379e94f0db8310b08291f9d64c3209766617fd/node_modules/async-limiter/", {"name":"async-limiter","reference":"1.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-xmlhttprequest-ssl-1.5.5-c2876b06168aadc40e57d97e81191ac8f4398b3e/node_modules/xmlhttprequest-ssl/", {"name":"xmlhttprequest-ssl","reference":"1.5.5"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-yeast-0.1.2-008e06d8094320c372dbc2f8ed76a0ca6c8ac419/node_modules/yeast/", {"name":"yeast","reference":"0.1.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-object-component-0.0.3-f0c69aa50efc95b866c186f400a33769cb2f1291/node_modules/object-component/", {"name":"object-component","reference":"0.0.3"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-socket-io-parser-3.3.0-2b52a96a509fdf31440ba40fed6094c7d4f1262f/node_modules/socket.io-parser/", {"name":"socket.io-parser","reference":"3.3.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-socket-io-parser-3.2.0-e7c6228b6aa1f814e6148aea325b51aa9499e077/node_modules/socket.io-parser/", {"name":"socket.io-parser","reference":"3.2.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-to-array-0.1.4-17e6c11f73dd4f3d74cda7a4ff3238e9ad9bf890/node_modules/to-array/", {"name":"to-array","reference":"0.1.4"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-stream-throttle-0.1.3-add57c8d7cc73a81630d31cd55d3961cfafba9c3/node_modules/stream-throttle/", {"name":"stream-throttle","reference":"0.1.3"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-commander-2.20.0-d58bb2b5c1ee8f87b0d340027e9e94e222c5a422/node_modules/commander/", {"name":"commander","reference":"2.20.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-limiter-1.1.4-87c9c3972d389fdb0ba67a45aadbc5d2f8413bc1/node_modules/limiter/", {"name":"limiter","reference":"1.1.4"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-bs-recipes-1.3.4-0d2d4d48a718c8c044769fdc4f89592dc8b69585/node_modules/bs-recipes/", {"name":"bs-recipes","reference":"1.3.4"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-bs-snippet-injector-2.0.1-61b5393f11f52559ed120693100343b6edb04dd5/node_modules/bs-snippet-injector/", {"name":"bs-snippet-injector","reference":"2.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-chokidar-2.1.6-b6cad653a929e244ce8a834244164d241fa954c5/node_modules/chokidar/", {"name":"chokidar","reference":"2.1.6"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-anymatch-2.0.0-bcb24b4f37934d9aa7ac17b4adaf89e7c76ef2eb/node_modules/anymatch/", {"name":"anymatch","reference":"2.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-micromatch-3.1.10-70859bc95c9840952f359a068a3fc49f9ecfac23/node_modules/micromatch/", {"name":"micromatch","reference":"3.1.10"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-arr-diff-4.0.0-d6461074febfec71e7e15235761a329a5dc7c520/node_modules/arr-diff/", {"name":"arr-diff","reference":"4.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-array-unique-0.3.2-a894b75d4bc4f6cd679ef3244a9fd8f46ae2d428/node_modules/array-unique/", {"name":"array-unique","reference":"0.3.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-braces-2.3.2-5979fd3f14cd531565e5fa2df1abfff1dfaee729/node_modules/braces/", {"name":"braces","reference":"2.3.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-arr-flatten-1.1.0-36048bbff4e7b47e136644316c99669ea5ae91f1/node_modules/arr-flatten/", {"name":"arr-flatten","reference":"1.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-extend-shallow-2.0.1-51af7d614ad9a9f610ea1bafbb989d6b1c56890f/node_modules/extend-shallow/", {"name":"extend-shallow","reference":"2.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-extend-shallow-3.0.2-26a71aaf073b39fb2127172746131c2704028db8/node_modules/extend-shallow/", {"name":"extend-shallow","reference":"3.0.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-extendable-0.1.1-62b110e289a471418e3ec36a617d472e301dfc89/node_modules/is-extendable/", {"name":"is-extendable","reference":"0.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-extendable-1.0.1-a7470f9e426733d81bd81e1155264e3a3507cab4/node_modules/is-extendable/", {"name":"is-extendable","reference":"1.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-fill-range-4.0.0-d544811d428f98eb06a63dc402d2403c328c38f7/node_modules/fill-range/", {"name":"fill-range","reference":"4.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-number-3.0.0-24fd6201a4782cf50561c810276afc7d12d71195/node_modules/is-number/", {"name":"is-number","reference":"3.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-kind-of-3.2.2-31ea21a734bab9bbb0f32466d893aea51e4a3c64/node_modules/kind-of/", {"name":"kind-of","reference":"3.2.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-kind-of-4.0.0-20813df3d712928b207378691a45066fae72dd57/node_modules/kind-of/", {"name":"kind-of","reference":"4.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-kind-of-5.1.0-729c91e2d857b7a419a1f9aa65685c4c33f5845d/node_modules/kind-of/", {"name":"kind-of","reference":"5.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-kind-of-6.0.2-01146b36a6218e64e58f3a8d66de5d7fc6f6d051/node_modules/kind-of/", {"name":"kind-of","reference":"6.0.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-buffer-1.1.6-efaa2ea9daa0d7ab2ea13a97b2b8ad51fefbe8be/node_modules/is-buffer/", {"name":"is-buffer","reference":"1.1.6"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-buffer-2.0.3-4ecf3fcf749cbd1e472689e109ac66261a25e725/node_modules/is-buffer/", {"name":"is-buffer","reference":"2.0.3"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-repeat-string-1.6.1-8dcae470e1c88abc2d600fff4a776286da75e637/node_modules/repeat-string/", {"name":"repeat-string","reference":"1.6.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-to-regex-range-2.1.1-7c80c17b9dfebe599e27367e0d4dd5590141db38/node_modules/to-regex-range/", {"name":"to-regex-range","reference":"2.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-isobject-3.0.1-4e431e92b11a9731636aa1f9c8d1ccbcfdab78df/node_modules/isobject/", {"name":"isobject","reference":"3.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-isobject-2.1.0-f065561096a3f1da2ef46272f815c840d87e0c89/node_modules/isobject/", {"name":"isobject","reference":"2.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-repeat-element-1.1.3-782e0d825c0c5a3bb39731f84efee6b742e6b1ce/node_modules/repeat-element/", {"name":"repeat-element","reference":"1.1.3"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-snapdragon-0.8.2-64922e7c565b0e14204ba1aa7d6964278d25182d/node_modules/snapdragon/", {"name":"snapdragon","reference":"0.8.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-base-0.11.2-7bde5ced145b6d551a90db87f83c558b4eb48a8f/node_modules/base/", {"name":"base","reference":"0.11.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-cache-base-1.0.1-0a7f46416831c8b662ee36fe4e7c59d76f666ab2/node_modules/cache-base/", {"name":"cache-base","reference":"1.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-collection-visit-1.0.0-4bc0373c164bc3291b4d368c829cf1a80a59dca0/node_modules/collection-visit/", {"name":"collection-visit","reference":"1.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-map-visit-1.0.0-ecdca8f13144e660f1b5bd41f12f3479d98dfb8f/node_modules/map-visit/", {"name":"map-visit","reference":"1.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-object-visit-1.0.1-f79c4493af0c5377b59fe39d395e41042dd045bb/node_modules/object-visit/", {"name":"object-visit","reference":"1.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-get-value-2.0.6-dc15ca1c672387ca76bd37ac0a395ba2042a2c28/node_modules/get-value/", {"name":"get-value","reference":"2.0.6"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-has-value-1.0.0-18b281da585b1c5c51def24c930ed29a0be6b177/node_modules/has-value/", {"name":"has-value","reference":"1.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-has-value-0.3.1-7b1f58bada62ca827ec0a2078025654845995e1f/node_modules/has-value/", {"name":"has-value","reference":"0.3.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-has-values-1.0.0-95b0b63fec2146619a6fe57fe75628d5a39efe4f/node_modules/has-values/", {"name":"has-values","reference":"1.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-has-values-0.1.4-6d61de95d91dfca9b9a02089ad384bff8f62b771/node_modules/has-values/", {"name":"has-values","reference":"0.1.4"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-set-value-2.0.1-a18d40530e6f07de4228c7defe4227af8cad005b/node_modules/set-value/", {"name":"set-value","reference":"2.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-plain-object-2.0.4-2c163b3fafb1b606d9d17928f05c2a1c38e07677/node_modules/is-plain-object/", {"name":"is-plain-object","reference":"2.0.4"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-split-string-3.1.0-7cb09dda3a86585705c64b39a6466038682e8fe2/node_modules/split-string/", {"name":"split-string","reference":"3.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-assign-symbols-1.0.0-59667f41fadd4f20ccbc2bb96b8d4f7f78ec0367/node_modules/assign-symbols/", {"name":"assign-symbols","reference":"1.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-to-object-path-0.3.0-297588b7b0e7e0ac08e04e672f85c1f4999e17af/node_modules/to-object-path/", {"name":"to-object-path","reference":"0.3.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-union-value-1.0.1-0b6fe7b835aecda61c6ea4d4f02c14221e109847/node_modules/union-value/", {"name":"union-value","reference":"1.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-arr-union-3.1.0-e39b09aea9def866a8f206e288af63919bae39c4/node_modules/arr-union/", {"name":"arr-union","reference":"3.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-unset-value-1.0.0-8376873f7d2335179ffb1e6fc3a8ed0dfc8ab559/node_modules/unset-value/", {"name":"unset-value","reference":"1.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-class-utils-0.3.6-f93369ae8b9a7ce02fd41faad0ca83033190c463/node_modules/class-utils/", {"name":"class-utils","reference":"0.3.6"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-define-property-0.2.5-c35b1ef918ec3c990f9a5bc57be04aacec5c8116/node_modules/define-property/", {"name":"define-property","reference":"0.2.5"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-define-property-1.0.0-769ebaaf3f4a63aad3af9e8d304c9bbe79bfb0e6/node_modules/define-property/", {"name":"define-property","reference":"1.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-define-property-2.0.2-d459689e8d654ba77e02a817f8710d702cb16e9d/node_modules/define-property/", {"name":"define-property","reference":"2.0.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-descriptor-0.1.6-366d8240dde487ca51823b1ab9f07a10a78251ca/node_modules/is-descriptor/", {"name":"is-descriptor","reference":"0.1.6"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-descriptor-1.0.2-3b159746a66604b04f8c81524ba365c5f14d86ec/node_modules/is-descriptor/", {"name":"is-descriptor","reference":"1.0.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-accessor-descriptor-0.1.6-a9e12cb3ae8d876727eeef3843f8a0897b5c98d6/node_modules/is-accessor-descriptor/", {"name":"is-accessor-descriptor","reference":"0.1.6"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-accessor-descriptor-1.0.0-169c2f6d3df1f992618072365c9b0ea1f6878656/node_modules/is-accessor-descriptor/", {"name":"is-accessor-descriptor","reference":"1.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-data-descriptor-0.1.4-0b5ee648388e2c860282e793f1856fec3f301b56/node_modules/is-data-descriptor/", {"name":"is-data-descriptor","reference":"0.1.4"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-data-descriptor-1.0.0-d84876321d0e7add03990406abbbbd36ba9268c7/node_modules/is-data-descriptor/", {"name":"is-data-descriptor","reference":"1.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-static-extend-0.1.2-60809c39cbff55337226fd5e0b520f341f1fb5c6/node_modules/static-extend/", {"name":"static-extend","reference":"0.1.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-object-copy-0.1.0-7e7d858b781bd7c991a41ba975ed3812754e998c/node_modules/object-copy/", {"name":"object-copy","reference":"0.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-copy-descriptor-0.1.1-676f6eb3c39997c2ee1ac3a924fd6124748f578d/node_modules/copy-descriptor/", {"name":"copy-descriptor","reference":"0.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-mixin-deep-1.3.2-1120b43dc359a785dce65b55b82e257ccf479566/node_modules/mixin-deep/", {"name":"mixin-deep","reference":"1.3.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-for-in-1.0.2-81068d295a8142ec0ac726c6e2200c30fb6d5e80/node_modules/for-in/", {"name":"for-in","reference":"1.0.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-pascalcase-0.1.1-b363e55e8006ca6fe21784d2db22bd15d7917f14/node_modules/pascalcase/", {"name":"pascalcase","reference":"0.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-map-cache-0.2.2-c32abd0bd6525d9b051645bb4f26ac5dc98a0dbf/node_modules/map-cache/", {"name":"map-cache","reference":"0.2.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-source-map-0.5.7-8a039d2d1021d22d1ea14c80d8ea468ba2ef3fcc/node_modules/source-map/", {"name":"source-map","reference":"0.5.7"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-source-map-resolve-0.5.2-72e2cc34095543e43b2c62b2c4c10d4a9054f259/node_modules/source-map-resolve/", {"name":"source-map-resolve","reference":"0.5.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-atob-2.1.2-6d9517eb9e030d2436666651e86bd9f6f13533c9/node_modules/atob/", {"name":"atob","reference":"2.1.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-decode-uri-component-0.2.0-eb3913333458775cb84cd1a1fae062106bb87545/node_modules/decode-uri-component/", {"name":"decode-uri-component","reference":"0.2.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-resolve-url-0.2.1-2c637fe77c893afd2a663fe21aa9080068e2052a/node_modules/resolve-url/", {"name":"resolve-url","reference":"0.2.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-source-map-url-0.4.0-3e935d7ddd73631b97659956d55128e87b5084a3/node_modules/source-map-url/", {"name":"source-map-url","reference":"0.4.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-urix-0.1.0-da937f7a62e21fec1fd18d49b35c2935067a6c72/node_modules/urix/", {"name":"urix","reference":"0.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-use-3.1.1-d50c8cac79a19fbc20f2911f56eb973f4e10070f/node_modules/use/", {"name":"use","reference":"3.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-snapdragon-node-2.1.1-6c175f86ff14bdb0724563e8f3c1b021a286853b/node_modules/snapdragon-node/", {"name":"snapdragon-node","reference":"2.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-snapdragon-util-3.0.1-f956479486f2acd79700693f6f7b805e45ab56e2/node_modules/snapdragon-util/", {"name":"snapdragon-util","reference":"3.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-to-regex-3.0.2-13cfdd9b336552f30b51f33a8ae1b42a7a7599ce/node_modules/to-regex/", {"name":"to-regex","reference":"3.0.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-regex-not-1.0.2-1f4ece27e00b0b65e0247a6810e6a85d83a5752c/node_modules/regex-not/", {"name":"regex-not","reference":"1.0.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-safe-regex-1.1.0-40a3669f3b077d1e943d44629e157dd48023bf2e/node_modules/safe-regex/", {"name":"safe-regex","reference":"1.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-ret-0.1.15-b8a4825d5bdb1fc3f6f53c2bc33f81388681c7bc/node_modules/ret/", {"name":"ret","reference":"0.1.15"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-extglob-2.0.4-ad00fe4dc612a9232e8718711dc5cb5ab0285543/node_modules/extglob/", {"name":"extglob","reference":"2.0.4"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-expand-brackets-2.1.4-b77735e315ce30f6b6eff0f83b04151a22449622/node_modules/expand-brackets/", {"name":"expand-brackets","reference":"2.1.4"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-posix-character-classes-0.1.1-01eac0fe3b5af71a2a6c02feabb8c1fef7e00eab/node_modules/posix-character-classes/", {"name":"posix-character-classes","reference":"0.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-fragment-cache-0.2.1-4290fad27f13e89be7f33799c6bc5a0abfff0d19/node_modules/fragment-cache/", {"name":"fragment-cache","reference":"0.2.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-nanomatch-1.2.13-b87a8aa4fc0de8fe6be88895b38983ff265bd119/node_modules/nanomatch/", {"name":"nanomatch","reference":"1.2.13"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-windows-1.0.2-d1850eb9791ecd18e6182ce12a30f396634bb19d/node_modules/is-windows/", {"name":"is-windows","reference":"1.0.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-object-pick-1.3.0-87a10ac4c1694bd2e1cbf53591a66141fb5dd747/node_modules/object.pick/", {"name":"object.pick","reference":"1.3.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-normalize-path-2.1.1-1ab28b556e198363a8c1a6f7e6fa20137fe6aed9/node_modules/normalize-path/", {"name":"normalize-path","reference":"2.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-normalize-path-3.0.0-0dcd69ff23a1c9b11fd0978316644a0388216a65/node_modules/normalize-path/", {"name":"normalize-path","reference":"3.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-remove-trailing-separator-1.1.0-c24bce2a283adad5bc3f58e0d48249b92379d8ef/node_modules/remove-trailing-separator/", {"name":"remove-trailing-separator","reference":"1.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-async-each-1.0.3-b727dbf87d7651602f06f4d4ac387f47d91b0cbf/node_modules/async-each/", {"name":"async-each","reference":"1.0.3"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-glob-parent-3.1.0-9e6af6299d8d3bd2bd40430832bd113df906c5ae/node_modules/glob-parent/", {"name":"glob-parent","reference":"3.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-glob-3.1.0-7ba5ae24217804ac70707b96922567486cc3e84a/node_modules/is-glob/", {"name":"is-glob","reference":"3.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-glob-4.0.1-7567dbe9f2f5e2467bc77ab83c4a29482407a5dc/node_modules/is-glob/", {"name":"is-glob","reference":"4.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-extglob-2.1.1-a88c02535791f02ed37c76a1b9ea9773c833f8c2/node_modules/is-extglob/", {"name":"is-extglob","reference":"2.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-path-dirname-1.0.2-cc33d24d525e099a5388c0336c6e32b9160609e0/node_modules/path-dirname/", {"name":"path-dirname","reference":"1.0.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-inherits-2.0.4-0fa2c64f932917c3433a0ded55363aae37416b7c/node_modules/inherits/", {"name":"inherits","reference":"2.0.4"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-inherits-2.0.3-633c2c83e3da42a502f52466022480f4208261de/node_modules/inherits/", {"name":"inherits","reference":"2.0.3"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-binary-path-1.0.1-75f16642b480f187a711c814161fd3a4a7655898/node_modules/is-binary-path/", {"name":"is-binary-path","reference":"1.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-binary-extensions-1.13.1-598afe54755b2868a5330d2aff9d4ebb53209b65/node_modules/binary-extensions/", {"name":"binary-extensions","reference":"1.13.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-path-is-absolute-1.0.1-174b9268735534ffbc7ace6bf53a5a9e1b5c5f5f/node_modules/path-is-absolute/", {"name":"path-is-absolute","reference":"1.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-readdirp-2.2.1-0e87622a3325aa33e892285caf8b4e846529a525/node_modules/readdirp/", {"name":"readdirp","reference":"2.2.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-graceful-fs-4.2.2-6f0952605d0140c1cfdb138ed005775b92d67b02/node_modules/graceful-fs/", {"name":"graceful-fs","reference":"4.2.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-readable-stream-2.3.6-b11c27d88b8ff1fbe070643cf94b0c79ae1b0aaf/node_modules/readable-stream/", {"name":"readable-stream","reference":"2.3.6"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-core-util-is-1.0.2-b5fd54220aa2bc5ab57aab7140c940754503c1a7/node_modules/core-util-is/", {"name":"core-util-is","reference":"1.0.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-process-nextick-args-2.0.1-7820d9b16120cc55ca9ae7792680ae7dba6d7fe2/node_modules/process-nextick-args/", {"name":"process-nextick-args","reference":"2.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-safe-buffer-5.1.2-991ec69d296e0313747d59bdfd2b745c35f8828d/node_modules/safe-buffer/", {"name":"safe-buffer","reference":"5.1.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-string-decoder-1.1.1-9cf1611ba62685d7030ae9e4ba34149c3af03fc8/node_modules/string_decoder/", {"name":"string_decoder","reference":"1.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-util-deprecate-1.0.2-450d4dc9fa70de732762fbd2d4a28981419a0ccf/node_modules/util-deprecate/", {"name":"util-deprecate","reference":"1.0.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-upath-1.1.2-3db658600edaeeccbe6db5e684d67ee8c2acd068/node_modules/upath/", {"name":"upath","reference":"1.1.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-connect-3.6.6-09eff6c55af7236e137135a72574858b6786f524/node_modules/connect/", {"name":"connect","reference":"3.6.6"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-finalhandler-1.1.0-ce0b6855b45853e791b2fcc680046d88253dd7f5/node_modules/finalhandler/", {"name":"finalhandler","reference":"1.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-encodeurl-1.0.2-ad3ff4c86ec2d029322f5a02c3a9a606c95b3f59/node_modules/encodeurl/", {"name":"encodeurl","reference":"1.0.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-escape-html-1.0.3-0258eae4d3d0c0974de1c169188ef0051d1d1988/node_modules/escape-html/", {"name":"escape-html","reference":"1.0.3"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-on-finished-2.3.0-20f1336481b083cd75337992a16971aa2d906947/node_modules/on-finished/", {"name":"on-finished","reference":"2.3.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-ee-first-1.1.1-590c61156b0ae2f4f0255732a158b266bc56b21d/node_modules/ee-first/", {"name":"ee-first","reference":"1.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-parseurl-1.3.3-9da19e7bee8d12dff0513ed5b76957793bc2e8d4/node_modules/parseurl/", {"name":"parseurl","reference":"1.3.3"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-statuses-1.3.1-faf51b9eb74aaef3b3acf4ad5f61abf24cb7b93e/node_modules/statuses/", {"name":"statuses","reference":"1.3.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-statuses-1.5.0-161c7dac177659fd9811f43771fa99381478628c/node_modules/statuses/", {"name":"statuses","reference":"1.5.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-statuses-1.4.0-bb73d446da2796106efcc1b601a253d6c46bd087/node_modules/statuses/", {"name":"statuses","reference":"1.4.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-unpipe-1.0.0-b2bf4ee8514aae6165b4817829d21b2ef49904ec/node_modules/unpipe/", {"name":"unpipe","reference":"1.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-utils-merge-1.0.1-9f95710f50a267947b2ccc124741c1028427e713/node_modules/utils-merge/", {"name":"utils-merge","reference":"1.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-dev-ip-1.0.1-a76a3ed1855be7a012bb8ac16cb80f3c00dc28f0/node_modules/dev-ip/", {"name":"dev-ip","reference":"1.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-easy-extender-2.3.4-298789b64f9aaba62169c77a2b3b64b4c9589b8f/node_modules/easy-extender/", {"name":"easy-extender","reference":"2.3.4"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-lodash-4.17.15-b447f6670a0455bbfeedd11392eff330ea097548/node_modules/lodash/", {"name":"lodash","reference":"4.17.15"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-eazy-logger-3.0.2-a325aa5e53d13a2225889b2ac4113b2b9636f4fc/node_modules/eazy-logger/", {"name":"eazy-logger","reference":"3.0.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-tfunk-3.1.0-38e4414fc64977d87afdaa72facb6d29f82f7b5b/node_modules/tfunk/", {"name":"tfunk","reference":"3.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-chalk-1.1.3-a8115c55e4a702fe4d150abd3872822a7e09fc98/node_modules/chalk/", {"name":"chalk","reference":"1.1.3"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-ansi-styles-2.2.1-b432dd3358b634cf75e1e4664368240533c1ddbe/node_modules/ansi-styles/", {"name":"ansi-styles","reference":"2.2.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-escape-string-regexp-1.0.5-1b61c0562190a8dff6ae3bb2cf0200ca130b86d4/node_modules/escape-string-regexp/", {"name":"escape-string-regexp","reference":"1.0.5"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-has-ansi-2.0.0-34f5049ce1ecdf2b0649af3ef24e45ed35416d91/node_modules/has-ansi/", {"name":"has-ansi","reference":"2.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-ansi-regex-2.1.1-c3b33ab5ee360d86e0e628f0468ae7ef27d654df/node_modules/ansi-regex/", {"name":"ansi-regex","reference":"2.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-strip-ansi-3.0.1-6a385fb8853d952d5ff05d0e8aaf94278dc63dcf/node_modules/strip-ansi/", {"name":"strip-ansi","reference":"3.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-supports-color-2.0.0-535d045ce6b6363fa40117084629995e9df324c7/node_modules/supports-color/", {"name":"supports-color","reference":"2.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-object-path-0.9.2-0fd9a74fc5fad1ae3968b586bda5c632bd6c05a5/node_modules/object-path/", {"name":"object-path","reference":"0.9.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-fs-extra-3.0.1-3794f378c58b342ea7dbbb23095109c4b3b62291/node_modules/fs-extra/", {"name":"fs-extra","reference":"3.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-jsonfile-3.0.1-a5ecc6f65f53f662c4415c7675a0331d0992ec66/node_modules/jsonfile/", {"name":"jsonfile","reference":"3.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-universalify-0.1.2-b646f69be3942dabcecc9d6639c80dc105efaa66/node_modules/universalify/", {"name":"universalify","reference":"0.1.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-http-proxy-1.15.2-642fdcaffe52d3448d2bda3b0079e9409064da31/node_modules/http-proxy/", {"name":"http-proxy","reference":"1.15.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-eventemitter3-1.2.0-1c86991d816ad1e504750e73874224ecf3bec508/node_modules/eventemitter3/", {"name":"eventemitter3","reference":"1.2.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-requires-port-1.0.0-925d2601d39ac485e091cf0da5c6e694dc3dcaff/node_modules/requires-port/", {"name":"requires-port","reference":"1.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-localtunnel-1.9.2-0012fcabc29cf964c130a01858768aa2bb65b5af/node_modules/localtunnel/", {"name":"localtunnel","reference":"1.9.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-axios-0.19.0-8e09bff3d9122e133f7b8101c8fbdd00ed3d2ab8/node_modules/axios/", {"name":"axios","reference":"0.19.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-follow-redirects-1.5.10-7b7a9f9aea2fdff36786a94ff643ed07f4ff5e2a/node_modules/follow-redirects/", {"name":"follow-redirects","reference":"1.5.10"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-openurl-1.1.1-3875b4b0ef7a52c156f0db41d4609dbb0f94b387/node_modules/openurl/", {"name":"openurl","reference":"1.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-yargs-6.6.0-782ec21ef403345f830a808ca3d513af56065208/node_modules/yargs/", {"name":"yargs","reference":"6.6.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-yargs-6.4.0-816e1a866d5598ccf34e5596ddce22d92da490d4/node_modules/yargs/", {"name":"yargs","reference":"6.4.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-camelcase-3.0.0-32fc4b9fcdaf845fcdf7e73bb97cac2261f0ab0a/node_modules/camelcase/", {"name":"camelcase","reference":"3.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-cliui-3.2.0-120601537a916d29940f934da3b48d585a39213d/node_modules/cliui/", {"name":"cliui","reference":"3.2.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-string-width-1.0.2-118bdf5b8cdc51a2a7e70d211e07e2b0b9b107d3/node_modules/string-width/", {"name":"string-width","reference":"1.0.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-code-point-at-1.1.0-0d070b4d043a5bea33a2f1a40e2edb3d9a4ccf77/node_modules/code-point-at/", {"name":"code-point-at","reference":"1.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-fullwidth-code-point-1.0.0-ef9e31386f031a7f0d643af82fde50c457ef00cb/node_modules/is-fullwidth-code-point/", {"name":"is-fullwidth-code-point","reference":"1.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-number-is-nan-1.0.1-097b602b53422a522c1afb8790318336941a011d/node_modules/number-is-nan/", {"name":"number-is-nan","reference":"1.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-wrap-ansi-2.1.0-d8fc3d284dd05794fe84973caecdd1cf824fdd85/node_modules/wrap-ansi/", {"name":"wrap-ansi","reference":"2.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-decamelize-1.2.0-f6534d15148269b20352e7bee26f501f9a191290/node_modules/decamelize/", {"name":"decamelize","reference":"1.2.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-get-caller-file-1.0.3-f978fa4c90d1dfe7ff2d6beda2a515e713bdcf4a/node_modules/get-caller-file/", {"name":"get-caller-file","reference":"1.0.3"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-os-locale-1.4.0-20f9f17ae29ed345e8bde583b13d2009803c14d9/node_modules/os-locale/", {"name":"os-locale","reference":"1.4.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-lcid-1.0.0-308accafa0bc483a3867b4b6f2b9506251d1b835/node_modules/lcid/", {"name":"lcid","reference":"1.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-invert-kv-1.0.0-104a8e4aaca6d3d8cd157a8ef8bfab2d7a3ffdb6/node_modules/invert-kv/", {"name":"invert-kv","reference":"1.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-read-pkg-up-1.0.1-9d63c13276c065918d57f002a57f40a1b643fb02/node_modules/read-pkg-up/", {"name":"read-pkg-up","reference":"1.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-find-up-1.1.2-6b2e9822b1a2ce0a60ab64d610eccad53cb24d0f/node_modules/find-up/", {"name":"find-up","reference":"1.1.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-path-exists-2.1.0-0feb6c64f0fc518d9a754dd5efb62c7022761f4b/node_modules/path-exists/", {"name":"path-exists","reference":"2.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-pinkie-promise-2.0.1-2135d6dfa7a358c069ac9b178776288228450ffa/node_modules/pinkie-promise/", {"name":"pinkie-promise","reference":"2.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-pinkie-2.0.4-72556b80cfa0d48a974e80e77248e80ed4f7f870/node_modules/pinkie/", {"name":"pinkie","reference":"2.0.4"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-read-pkg-1.1.0-f5ffaa5ecd29cb31c0474bca7d756b6bb29e3f28/node_modules/read-pkg/", {"name":"read-pkg","reference":"1.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-load-json-file-1.1.0-956905708d58b4bab4c2261b04f59f31c99374c0/node_modules/load-json-file/", {"name":"load-json-file","reference":"1.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-parse-json-2.2.0-f480f40434ef80741f8469099f8dea18f55a4dc9/node_modules/parse-json/", {"name":"parse-json","reference":"2.2.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-error-ex-1.3.2-b4ac40648107fdcdcfae242f428bea8a14d4f1bf/node_modules/error-ex/", {"name":"error-ex","reference":"1.3.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-arrayish-0.2.1-77c99840527aa8ecb1a8ba697b80645a7a926a9d/node_modules/is-arrayish/", {"name":"is-arrayish","reference":"0.2.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-pify-2.3.0-ed141a6ac043a849ea588498e7dca8b15330e90c/node_modules/pify/", {"name":"pify","reference":"2.3.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-strip-bom-2.0.0-6219a85616520491f35788bdbf1447a99c7e6b0e/node_modules/strip-bom/", {"name":"strip-bom","reference":"2.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-utf8-0.2.1-4b0da1442104d1b336340e80797e865cf39f7d72/node_modules/is-utf8/", {"name":"is-utf8","reference":"0.2.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-normalize-package-data-2.5.0-e66db1838b200c1dfc233225d12cb36520e234a8/node_modules/normalize-package-data/", {"name":"normalize-package-data","reference":"2.5.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-hosted-git-info-2.8.4-44119abaf4bc64692a16ace34700fed9c03e2546/node_modules/hosted-git-info/", {"name":"hosted-git-info","reference":"2.8.4"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-resolve-1.12.0-3fc644a35c84a48554609ff26ec52b66fa577df6/node_modules/resolve/", {"name":"resolve","reference":"1.12.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-path-parse-1.0.6-d62dbb5679405d72c4737ec58600e9ddcf06d24c/node_modules/path-parse/", {"name":"path-parse","reference":"1.0.6"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-semver-5.7.1-a954f931aeba508d307bbf069eff0c01c96116f7/node_modules/semver/", {"name":"semver","reference":"5.7.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-validate-npm-package-license-3.0.4-fc91f6b9c7ba15c857f4cb2c5defeec39d4f410a/node_modules/validate-npm-package-license/", {"name":"validate-npm-package-license","reference":"3.0.4"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-spdx-correct-3.1.0-fb83e504445268f154b074e218c87c003cd31df4/node_modules/spdx-correct/", {"name":"spdx-correct","reference":"3.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-spdx-expression-parse-3.0.0-99e119b7a5da00e05491c9fa338b7904823b41d0/node_modules/spdx-expression-parse/", {"name":"spdx-expression-parse","reference":"3.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-spdx-exceptions-2.2.0-2ea450aee74f2a89bfb94519c07fcd6f41322977/node_modules/spdx-exceptions/", {"name":"spdx-exceptions","reference":"2.2.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-spdx-license-ids-3.0.5-3694b5804567a458d3c8045842a6358632f62654/node_modules/spdx-license-ids/", {"name":"spdx-license-ids","reference":"3.0.5"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-path-type-1.1.0-59c44f7ee491da704da415da5a4070ba4f8fe441/node_modules/path-type/", {"name":"path-type","reference":"1.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-require-directory-2.1.1-8c64ad5fd30dab1c976e2344ffe7f792a6a6df42/node_modules/require-directory/", {"name":"require-directory","reference":"2.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-require-main-filename-1.0.1-97f717b69d48784f5f526a6c5aa8ffdda055a4d1/node_modules/require-main-filename/", {"name":"require-main-filename","reference":"1.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-set-blocking-2.0.0-045f9782d011ae9a6803ddd382b24392b3d890f7/node_modules/set-blocking/", {"name":"set-blocking","reference":"2.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-which-module-1.0.0-bba63ca861948994ff307736089e3b96026c2a4f/node_modules/which-module/", {"name":"which-module","reference":"1.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-y18n-3.2.1-6d15fba884c08679c0d77e88e7759e811e07fa41/node_modules/y18n/", {"name":"y18n","reference":"3.2.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-yargs-parser-4.2.1-29cceac0dc4f03c6c87b4a9f217dd18c9f74871c/node_modules/yargs-parser/", {"name":"yargs-parser","reference":"4.2.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-opn-5.3.0-64871565c863875f052cfdf53d3e3cb5adb53b1c/node_modules/opn/", {"name":"opn","reference":"5.3.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-wsl-1.1.0-1f16e4aa22b04d1336b66188a66af3c600c3a66d/node_modules/is-wsl/", {"name":"is-wsl","reference":"1.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-portscanner-2.1.1-eabb409e4de24950f5a2a516d35ae769343fbb96/node_modules/portscanner/", {"name":"portscanner","reference":"2.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-async-1.5.2-ec6a61ae56480c0c3cb241c95618e20892f9672a/node_modules/async/", {"name":"async","reference":"1.5.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-is-number-like-1.0.8-2e129620b50891042e44e9bbbb30593e75cfbbe3/node_modules/is-number-like/", {"name":"is-number-like","reference":"1.0.8"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-lodash-isfinite-3.3.2-fb89b65a9a80281833f0b7478b3a5104f898ebb3/node_modules/lodash.isfinite/", {"name":"lodash.isfinite","reference":"3.3.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-qs-6.2.3-1cfcb25c10a9b2b483053ff39f5dfc9233908cfe/node_modules/qs/", {"name":"qs","reference":"6.2.3"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-raw-body-2.4.1-30ac82f98bb5ae8c152e67149dac8d55153b168c/node_modules/raw-body/", {"name":"raw-body","reference":"2.4.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-bytes-3.1.0-f6cf7933a360e0588fa9fde85651cdc7f805d1f6/node_modules/bytes/", {"name":"bytes","reference":"3.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-http-errors-1.7.3-6c619e4f9c60308c38519498c14fbb10aacebb06/node_modules/http-errors/", {"name":"http-errors","reference":"1.7.3"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-http-errors-1.6.3-8b55680bb4be283a0b5bf4ea2e38580be1d9320d/node_modules/http-errors/", {"name":"http-errors","reference":"1.6.3"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-depd-1.1.2-9bcd52e14c097763e749b274c4346ed2e560b5a9/node_modules/depd/", {"name":"depd","reference":"1.1.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-setprototypeof-1.1.1-7e95acb24aa92f5885e0abef5ba131330d4ae683/node_modules/setprototypeof/", {"name":"setprototypeof","reference":"1.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-setprototypeof-1.1.0-d0bd85536887b6fe7c0d818cb962d9d91c54e656/node_modules/setprototypeof/", {"name":"setprototypeof","reference":"1.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-toidentifier-1.0.0-7e1be3470f1e77948bc43d94a3c8f4d7752ba553/node_modules/toidentifier/", {"name":"toidentifier","reference":"1.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-iconv-lite-0.4.24-2022b4b25fbddc21d2f524974a474aafe733908b/node_modules/iconv-lite/", {"name":"iconv-lite","reference":"0.4.24"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-safer-buffer-2.1.2-44fa161b0187b9549dd84bb91802f9bd8385cd6a/node_modules/safer-buffer/", {"name":"safer-buffer","reference":"2.1.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-resp-modifier-6.0.2-b124de5c4fbafcba541f48ffa73970f4aa456b4f/node_modules/resp-modifier/", {"name":"resp-modifier","reference":"6.0.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-minimatch-3.0.4-5166e286457f03306064be5497e8dbb0c3d32083/node_modules/minimatch/", {"name":"minimatch","reference":"3.0.4"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-brace-expansion-1.1.11-3c7fcbf529d87226f3d2f52b966ff5271eb441dd/node_modules/brace-expansion/", {"name":"brace-expansion","reference":"1.1.11"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-balanced-match-1.0.0-89b4d199ab2bee49de164ea02b89ce462d71b767/node_modules/balanced-match/", {"name":"balanced-match","reference":"1.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-concat-map-0.0.1-d8a96bd77fd68df7793a73036a3ba0d5405d477b/node_modules/concat-map/", {"name":"concat-map","reference":"0.0.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-rx-4.1.0-a5f13ff79ef3b740fe30aa803fb09f98805d4782/node_modules/rx/", {"name":"rx","reference":"4.1.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-send-0.16.2-6ecca1e0f8c156d141597559848df64730a6bbc1/node_modules/send/", {"name":"send","reference":"0.16.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-destroy-1.0.4-978857442c44749e4206613e37946205826abd80/node_modules/destroy/", {"name":"destroy","reference":"1.0.4"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-mime-1.4.1-121f9ebc49e3766f311a76e1fa1c8003c4b03aa6/node_modules/mime/", {"name":"mime","reference":"1.4.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-range-parser-1.2.1-3cf37023d199e1c24d1a55b84800c2f3e6468031/node_modules/range-parser/", {"name":"range-parser","reference":"1.2.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-serve-index-1.9.1-d3768d69b1e7d82e5ce050fff5b453bea12a9239/node_modules/serve-index/", {"name":"serve-index","reference":"1.9.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-accepts-1.3.7-531bc726517a3b2b41f850021c6cc15eaab507cd/node_modules/accepts/", {"name":"accepts","reference":"1.3.7"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-mime-types-2.1.24-b6f8d0b3e951efb77dedeca194cff6d16f676f81/node_modules/mime-types/", {"name":"mime-types","reference":"2.1.24"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-mime-db-1.40.0-a65057e998db090f732a68f6c276d387d4126c32/node_modules/mime-db/", {"name":"mime-db","reference":"1.40.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-negotiator-0.6.2-feacf7ccf525a77ae9634436a64883ffeca346fb/node_modules/negotiator/", {"name":"negotiator","reference":"0.6.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-batch-0.6.1-dc34314f4e679318093fc760272525f94bf25c16/node_modules/batch/", {"name":"batch","reference":"0.6.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-serve-static-1.13.2-095e8472fd5b46237db50ce486a43f4b86c6cec1/node_modules/serve-static/", {"name":"serve-static","reference":"1.13.2"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-socket-io-2.1.1-a069c5feabee3e6b214a75b40ce0652e1cfb9980/node_modules/socket.io/", {"name":"socket.io","reference":"2.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-engine-io-3.2.1-b60281c35484a70ee0351ea0ebff83ec8c9522a2/node_modules/engine.io/", {"name":"engine.io","reference":"3.2.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-base64id-1.0.0-47688cb99bb6804f0e06d3e763b1c32e57d8e6b6/node_modules/base64id/", {"name":"base64id","reference":"1.0.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-ultron-1.1.1-9fe1536a10a664a65266a1e3ccf85fd36302bc9c/node_modules/ultron/", {"name":"ultron","reference":"1.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-cookie-0.3.1-e7e0a1f9ef43b4c8ba925c5c5a96e806d16873bb/node_modules/cookie/", {"name":"cookie","reference":"0.3.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-socket-io-adapter-1.1.1-2a805e8a14d6372124dd9159ad4502f8cb07f06b/node_modules/socket.io-adapter/", {"name":"socket.io-adapter","reference":"1.1.1"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-ua-parser-js-0.7.17-e9ec5f9498b9ec910e7ae3ac626a805c4d09ecac/node_modules/ua-parser-js/", {"name":"ua-parser-js","reference":"0.7.17"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-window-size-0.2.0-b4315bb4214a3d7058ebeee892e13fa24d98b075/node_modules/window-size/", {"name":"window-size","reference":"0.2.0"}],
  ["../../AppData/Local/Yarn/Cache/v4/npm-run-script-os-1.0.7-7cd51144a19c6ca364fe668433f55b47babf4749/node_modules/run-script-os/", {"name":"run-script-os","reference":"1.0.7"}],
  ["./", topLevelLocator],
]);
exports.findPackageLocator = function findPackageLocator(location) {
  let relativeLocation = normalizePath(path.relative(__dirname, location));

  if (!relativeLocation.match(isStrictRegExp))
    relativeLocation = `./${relativeLocation}`;

  if (location.match(isDirRegExp) && relativeLocation.charAt(relativeLocation.length - 1) !== '/')
    relativeLocation = `${relativeLocation}/`;

  let match;

  if (relativeLocation.length >= 156 && relativeLocation[155] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 156)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 150 && relativeLocation[149] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 150)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 146 && relativeLocation[145] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 146)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 144 && relativeLocation[143] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 144)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 142 && relativeLocation[141] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 142)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 140 && relativeLocation[139] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 140)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 139 && relativeLocation[138] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 139)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 138 && relativeLocation[137] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 138)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 136 && relativeLocation[135] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 136)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 135 && relativeLocation[134] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 135)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 134 && relativeLocation[133] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 134)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 133 && relativeLocation[132] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 133)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 132 && relativeLocation[131] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 132)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 131 && relativeLocation[130] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 131)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 130 && relativeLocation[129] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 130)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 128 && relativeLocation[127] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 128)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 126 && relativeLocation[125] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 126)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 125 && relativeLocation[124] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 125)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 124 && relativeLocation[123] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 124)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 122 && relativeLocation[121] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 122)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 121 && relativeLocation[120] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 121)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 120 && relativeLocation[119] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 120)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 119 && relativeLocation[118] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 119)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 118 && relativeLocation[117] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 118)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 116 && relativeLocation[115] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 116)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 115 && relativeLocation[114] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 115)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 114 && relativeLocation[113] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 114)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 112 && relativeLocation[111] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 112)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 111 && relativeLocation[110] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 111)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 110 && relativeLocation[109] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 110)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 109 && relativeLocation[108] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 109)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 108 && relativeLocation[107] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 108)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 107 && relativeLocation[106] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 107)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 106 && relativeLocation[105] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 106)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 104 && relativeLocation[103] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 104)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 2 && relativeLocation[1] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 2)))
      return blacklistCheck(match);

  return null;
};


/**
 * Returns the module that should be used to resolve require calls. It's usually the direct parent, except if we're
 * inside an eval expression.
 */

function getIssuerModule(parent) {
  let issuer = parent;

  while (issuer && (issuer.id === '[eval]' || issuer.id === '<repl>' || !issuer.filename)) {
    issuer = issuer.parent;
  }

  return issuer;
}

/**
 * Returns information about a package in a safe way (will throw if they cannot be retrieved)
 */

function getPackageInformationSafe(packageLocator) {
  const packageInformation = exports.getPackageInformation(packageLocator);

  if (!packageInformation) {
    throw makeError(
      `INTERNAL`,
      `Couldn't find a matching entry in the dependency tree for the specified parent (this is probably an internal error)`
    );
  }

  return packageInformation;
}

/**
 * Implements the node resolution for folder access and extension selection
 */

function applyNodeExtensionResolution(unqualifiedPath, {extensions}) {
  // We use this "infinite while" so that we can restart the process as long as we hit package folders
  while (true) {
    let stat;

    try {
      stat = statSync(unqualifiedPath);
    } catch (error) {}

    // If the file exists and is a file, we can stop right there

    if (stat && !stat.isDirectory()) {
      // If the very last component of the resolved path is a symlink to a file, we then resolve it to a file. We only
      // do this first the last component, and not the rest of the path! This allows us to support the case of bin
      // symlinks, where a symlink in "/xyz/pkg-name/.bin/bin-name" will point somewhere else (like "/xyz/pkg-name/index.js").
      // In such a case, we want relative requires to be resolved relative to "/xyz/pkg-name/" rather than "/xyz/pkg-name/.bin/".
      //
      // Also note that the reason we must use readlink on the last component (instead of realpath on the whole path)
      // is that we must preserve the other symlinks, in particular those used by pnp to deambiguate packages using
      // peer dependencies. For example, "/xyz/.pnp/local/pnp-01234569/.bin/bin-name" should see its relative requires
      // be resolved relative to "/xyz/.pnp/local/pnp-0123456789/" rather than "/xyz/pkg-with-peers/", because otherwise
      // we would lose the information that would tell us what are the dependencies of pkg-with-peers relative to its
      // ancestors.

      if (lstatSync(unqualifiedPath).isSymbolicLink()) {
        unqualifiedPath = path.normalize(path.resolve(path.dirname(unqualifiedPath), readlinkSync(unqualifiedPath)));
      }

      return unqualifiedPath;
    }

    // If the file is a directory, we must check if it contains a package.json with a "main" entry

    if (stat && stat.isDirectory()) {
      let pkgJson;

      try {
        pkgJson = JSON.parse(readFileSync(`${unqualifiedPath}/package.json`, 'utf-8'));
      } catch (error) {}

      let nextUnqualifiedPath;

      if (pkgJson && pkgJson.main) {
        nextUnqualifiedPath = path.resolve(unqualifiedPath, pkgJson.main);
      }

      // If the "main" field changed the path, we start again from this new location

      if (nextUnqualifiedPath && nextUnqualifiedPath !== unqualifiedPath) {
        const resolution = applyNodeExtensionResolution(nextUnqualifiedPath, {extensions});

        if (resolution !== null) {
          return resolution;
        }
      }
    }

    // Otherwise we check if we find a file that match one of the supported extensions

    const qualifiedPath = extensions
      .map(extension => {
        return `${unqualifiedPath}${extension}`;
      })
      .find(candidateFile => {
        return existsSync(candidateFile);
      });

    if (qualifiedPath) {
      return qualifiedPath;
    }

    // Otherwise, we check if the path is a folder - in such a case, we try to use its index

    if (stat && stat.isDirectory()) {
      const indexPath = extensions
        .map(extension => {
          return `${unqualifiedPath}/index${extension}`;
        })
        .find(candidateFile => {
          return existsSync(candidateFile);
        });

      if (indexPath) {
        return indexPath;
      }
    }

    // Otherwise there's nothing else we can do :(

    return null;
  }
}

/**
 * This function creates fake modules that can be used with the _resolveFilename function.
 * Ideally it would be nice to be able to avoid this, since it causes useless allocations
 * and cannot be cached efficiently (we recompute the nodeModulePaths every time).
 *
 * Fortunately, this should only affect the fallback, and there hopefully shouldn't be a
 * lot of them.
 */

function makeFakeModule(path) {
  const fakeModule = new Module(path, false);
  fakeModule.filename = path;
  fakeModule.paths = Module._nodeModulePaths(path);
  return fakeModule;
}

/**
 * Normalize path to posix format.
 */

function normalizePath(fsPath) {
  fsPath = path.normalize(fsPath);

  if (process.platform === 'win32') {
    fsPath = fsPath.replace(backwardSlashRegExp, '/');
  }

  return fsPath;
}

/**
 * Forward the resolution to the next resolver (usually the native one)
 */

function callNativeResolution(request, issuer) {
  if (issuer.endsWith('/')) {
    issuer += 'internal.js';
  }

  try {
    enableNativeHooks = false;

    // Since we would need to create a fake module anyway (to call _resolveLookupPath that
    // would give us the paths to give to _resolveFilename), we can as well not use
    // the {paths} option at all, since it internally makes _resolveFilename create another
    // fake module anyway.
    return Module._resolveFilename(request, makeFakeModule(issuer), false);
  } finally {
    enableNativeHooks = true;
  }
}

/**
 * This key indicates which version of the standard is implemented by this resolver. The `std` key is the
 * Plug'n'Play standard, and any other key are third-party extensions. Third-party extensions are not allowed
 * to override the standard, and can only offer new methods.
 *
 * If an new version of the Plug'n'Play standard is released and some extensions conflict with newly added
 * functions, they'll just have to fix the conflicts and bump their own version number.
 */

exports.VERSIONS = {std: 1};

/**
 * Useful when used together with getPackageInformation to fetch information about the top-level package.
 */

exports.topLevel = {name: null, reference: null};

/**
 * Gets the package information for a given locator. Returns null if they cannot be retrieved.
 */

exports.getPackageInformation = function getPackageInformation({name, reference}) {
  const packageInformationStore = packageInformationStores.get(name);

  if (!packageInformationStore) {
    return null;
  }

  const packageInformation = packageInformationStore.get(reference);

  if (!packageInformation) {
    return null;
  }

  return packageInformation;
};

/**
 * Transforms a request (what's typically passed as argument to the require function) into an unqualified path.
 * This path is called "unqualified" because it only changes the package name to the package location on the disk,
 * which means that the end result still cannot be directly accessed (for example, it doesn't try to resolve the
 * file extension, or to resolve directories to their "index.js" content). Use the "resolveUnqualified" function
 * to convert them to fully-qualified paths, or just use "resolveRequest" that do both operations in one go.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveToUnqualified = function resolveToUnqualified(request, issuer, {considerBuiltins = true} = {}) {
  // The 'pnpapi' request is reserved and will always return the path to the PnP file, from everywhere

  if (request === `pnpapi`) {
    return pnpFile;
  }

  // Bailout if the request is a native module

  if (considerBuiltins && builtinModules.has(request)) {
    return null;
  }

  // We allow disabling the pnp resolution for some subpaths. This is because some projects, often legacy,
  // contain multiple levels of dependencies (ie. a yarn.lock inside a subfolder of a yarn.lock). This is
  // typically solved using workspaces, but not all of them have been converted already.

  if (ignorePattern && ignorePattern.test(normalizePath(issuer))) {
    const result = callNativeResolution(request, issuer);

    if (result === false) {
      throw makeError(
        `BUILTIN_NODE_RESOLUTION_FAIL`,
        `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer was explicitely ignored by the regexp "null")`,
        {
          request,
          issuer,
        }
      );
    }

    return result;
  }

  let unqualifiedPath;

  // If the request is a relative or absolute path, we just return it normalized

  const dependencyNameMatch = request.match(pathRegExp);

  if (!dependencyNameMatch) {
    if (path.isAbsolute(request)) {
      unqualifiedPath = path.normalize(request);
    } else if (issuer.match(isDirRegExp)) {
      unqualifiedPath = path.normalize(path.resolve(issuer, request));
    } else {
      unqualifiedPath = path.normalize(path.resolve(path.dirname(issuer), request));
    }
  }

  // Things are more hairy if it's a package require - we then need to figure out which package is needed, and in
  // particular the exact version for the given location on the dependency tree

  if (dependencyNameMatch) {
    const [, dependencyName, subPath] = dependencyNameMatch;

    const issuerLocator = exports.findPackageLocator(issuer);

    // If the issuer file doesn't seem to be owned by a package managed through pnp, then we resort to using the next
    // resolution algorithm in the chain, usually the native Node resolution one

    if (!issuerLocator) {
      const result = callNativeResolution(request, issuer);

      if (result === false) {
        throw makeError(
          `BUILTIN_NODE_RESOLUTION_FAIL`,
          `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer doesn't seem to be part of the Yarn-managed dependency tree)`,
          {
            request,
            issuer,
          }
        );
      }

      return result;
    }

    const issuerInformation = getPackageInformationSafe(issuerLocator);

    // We obtain the dependency reference in regard to the package that request it

    let dependencyReference = issuerInformation.packageDependencies.get(dependencyName);

    // If we can't find it, we check if we can potentially load it from the packages that have been defined as potential fallbacks.
    // It's a bit of a hack, but it improves compatibility with the existing Node ecosystem. Hopefully we should eventually be able
    // to kill this logic and become stricter once pnp gets enough traction and the affected packages fix themselves.

    if (issuerLocator !== topLevelLocator) {
      for (let t = 0, T = fallbackLocators.length; dependencyReference === undefined && t < T; ++t) {
        const fallbackInformation = getPackageInformationSafe(fallbackLocators[t]);
        dependencyReference = fallbackInformation.packageDependencies.get(dependencyName);
      }
    }

    // If we can't find the path, and if the package making the request is the top-level, we can offer nicer error messages

    if (!dependencyReference) {
      if (dependencyReference === null) {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `You seem to be requiring a peer dependency ("${dependencyName}"), but it is not installed (which might be because you're the top-level package)`,
            {request, issuer, dependencyName}
          );
        } else {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" is trying to access a peer dependency ("${dependencyName}") that should be provided by its direct ancestor but isn't`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName}
          );
        }
      } else {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `You cannot require a package ("${dependencyName}") that is not declared in your dependencies (via "${issuer}")`,
            {request, issuer, dependencyName}
          );
        } else {
          const candidates = Array.from(issuerInformation.packageDependencies.keys());
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" (via "${issuer}") is trying to require the package "${dependencyName}" (via "${request}") without it being listed in its dependencies (${candidates.join(
              `, `
            )})`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName, candidates}
          );
        }
      }
    }

    // We need to check that the package exists on the filesystem, because it might not have been installed

    const dependencyLocator = {name: dependencyName, reference: dependencyReference};
    const dependencyInformation = exports.getPackageInformation(dependencyLocator);
    const dependencyLocation = path.resolve(__dirname, dependencyInformation.packageLocation);

    if (!dependencyLocation) {
      throw makeError(
        `MISSING_DEPENDENCY`,
        `Package "${dependencyLocator.name}@${dependencyLocator.reference}" is a valid dependency, but hasn't been installed and thus cannot be required (it might be caused if you install a partial tree, such as on production environments)`,
        {request, issuer, dependencyLocator: Object.assign({}, dependencyLocator)}
      );
    }

    // Now that we know which package we should resolve to, we only have to find out the file location

    if (subPath) {
      unqualifiedPath = path.resolve(dependencyLocation, subPath);
    } else {
      unqualifiedPath = dependencyLocation;
    }
  }

  return path.normalize(unqualifiedPath);
};

/**
 * Transforms an unqualified path into a qualified path by using the Node resolution algorithm (which automatically
 * appends ".js" / ".json", and transforms directory accesses into "index.js").
 */

exports.resolveUnqualified = function resolveUnqualified(
  unqualifiedPath,
  {extensions = Object.keys(Module._extensions)} = {}
) {
  const qualifiedPath = applyNodeExtensionResolution(unqualifiedPath, {extensions});

  if (qualifiedPath) {
    return path.normalize(qualifiedPath);
  } else {
    throw makeError(
      `QUALIFIED_PATH_RESOLUTION_FAILED`,
      `Couldn't find a suitable Node resolution for unqualified path "${unqualifiedPath}"`,
      {unqualifiedPath}
    );
  }
};

/**
 * Transforms a request into a fully qualified path.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveRequest = function resolveRequest(request, issuer, {considerBuiltins, extensions} = {}) {
  let unqualifiedPath;

  try {
    unqualifiedPath = exports.resolveToUnqualified(request, issuer, {considerBuiltins});
  } catch (originalError) {
    // If we get a BUILTIN_NODE_RESOLUTION_FAIL error there, it means that we've had to use the builtin node
    // resolution, which usually shouldn't happen. It might be because the user is trying to require something
    // from a path loaded through a symlink (which is not possible, because we need something normalized to
    // figure out which package is making the require call), so we try to make the same request using a fully
    // resolved issuer and throws a better and more actionable error if it works.
    if (originalError.code === `BUILTIN_NODE_RESOLUTION_FAIL`) {
      let realIssuer;

      try {
        realIssuer = realpathSync(issuer);
      } catch (error) {}

      if (realIssuer) {
        if (issuer.endsWith(`/`)) {
          realIssuer = realIssuer.replace(/\/?$/, `/`);
        }

        try {
          exports.resolveToUnqualified(request, realIssuer, {considerBuiltins});
        } catch (error) {
          // If an error was thrown, the problem doesn't seem to come from a path not being normalized, so we
          // can just throw the original error which was legit.
          throw originalError;
        }

        // If we reach this stage, it means that resolveToUnqualified didn't fail when using the fully resolved
        // file path, which is very likely caused by a module being invoked through Node with a path not being
        // correctly normalized (ie you should use "node $(realpath script.js)" instead of "node script.js").
        throw makeError(
          `SYMLINKED_PATH_DETECTED`,
          `A pnp module ("${request}") has been required from what seems to be a symlinked path ("${issuer}"). This is not possible, you must ensure that your modules are invoked through their fully resolved path on the filesystem (in this case "${realIssuer}").`,
          {
            request,
            issuer,
            realIssuer,
          }
        );
      }
    }
    throw originalError;
  }

  if (unqualifiedPath === null) {
    return null;
  }

  try {
    return exports.resolveUnqualified(unqualifiedPath, {extensions});
  } catch (resolutionError) {
    if (resolutionError.code === 'QUALIFIED_PATH_RESOLUTION_FAILED') {
      Object.assign(resolutionError.data, {request, issuer});
    }
    throw resolutionError;
  }
};

/**
 * Setups the hook into the Node environment.
 *
 * From this point on, any call to `require()` will go through the "resolveRequest" function, and the result will
 * be used as path of the file to load.
 */

exports.setup = function setup() {
  // A small note: we don't replace the cache here (and instead use the native one). This is an effort to not
  // break code similar to "delete require.cache[require.resolve(FOO)]", where FOO is a package located outside
  // of the Yarn dependency tree. In this case, we defer the load to the native loader. If we were to replace the
  // cache by our own, the native loader would populate its own cache, which wouldn't be exposed anymore, so the
  // delete call would be broken.

  const originalModuleLoad = Module._load;

  Module._load = function(request, parent, isMain) {
    if (!enableNativeHooks) {
      return originalModuleLoad.call(Module, request, parent, isMain);
    }

    // Builtins are managed by the regular Node loader

    if (builtinModules.has(request)) {
      try {
        enableNativeHooks = false;
        return originalModuleLoad.call(Module, request, parent, isMain);
      } finally {
        enableNativeHooks = true;
      }
    }

    // The 'pnpapi' name is reserved to return the PnP api currently in use by the program

    if (request === `pnpapi`) {
      return pnpModule.exports;
    }

    // Request `Module._resolveFilename` (ie. `resolveRequest`) to tell us which file we should load

    const modulePath = Module._resolveFilename(request, parent, isMain);

    // Check if the module has already been created for the given file

    const cacheEntry = Module._cache[modulePath];

    if (cacheEntry) {
      return cacheEntry.exports;
    }

    // Create a new module and store it into the cache

    const module = new Module(modulePath, parent);
    Module._cache[modulePath] = module;

    // The main module is exposed as global variable

    if (isMain) {
      process.mainModule = module;
      module.id = '.';
    }

    // Try to load the module, and remove it from the cache if it fails

    let hasThrown = true;

    try {
      module.load(modulePath);
      hasThrown = false;
    } finally {
      if (hasThrown) {
        delete Module._cache[modulePath];
      }
    }

    // Some modules might have to be patched for compatibility purposes

    for (const [filter, patchFn] of patchedModules) {
      if (filter.test(request)) {
        module.exports = patchFn(exports.findPackageLocator(parent.filename), module.exports);
      }
    }

    return module.exports;
  };

  const originalModuleResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function(request, parent, isMain, options) {
    if (!enableNativeHooks) {
      return originalModuleResolveFilename.call(Module, request, parent, isMain, options);
    }

    let issuers;

    if (options) {
      const optionNames = new Set(Object.keys(options));
      optionNames.delete('paths');

      if (optionNames.size > 0) {
        throw makeError(
          `UNSUPPORTED`,
          `Some options passed to require() aren't supported by PnP yet (${Array.from(optionNames).join(', ')})`
        );
      }

      if (options.paths) {
        issuers = options.paths.map(entry => `${path.normalize(entry)}/`);
      }
    }

    if (!issuers) {
      const issuerModule = getIssuerModule(parent);
      const issuer = issuerModule ? issuerModule.filename : `${process.cwd()}/`;

      issuers = [issuer];
    }

    let firstError;

    for (const issuer of issuers) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, issuer);
      } catch (error) {
        firstError = firstError || error;
        continue;
      }

      return resolution !== null ? resolution : request;
    }

    throw firstError;
  };

  const originalFindPath = Module._findPath;

  Module._findPath = function(request, paths, isMain) {
    if (!enableNativeHooks) {
      return originalFindPath.call(Module, request, paths, isMain);
    }

    for (const path of paths) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, path);
      } catch (error) {
        continue;
      }

      if (resolution) {
        return resolution;
      }
    }

    return false;
  };

  process.versions.pnp = String(exports.VERSIONS.std);
};

exports.setupCompatibilityLayer = () => {
  // ESLint currently doesn't have any portable way for shared configs to specify their own
  // plugins that should be used (https://github.com/eslint/eslint/issues/10125). This will
  // likely get fixed at some point, but it'll take time and in the meantime we'll just add
  // additional fallback entries for common shared configs.

  for (const name of [`react-scripts`]) {
    const packageInformationStore = packageInformationStores.get(name);
    if (packageInformationStore) {
      for (const reference of packageInformationStore.keys()) {
        fallbackLocators.push({name, reference});
      }
    }
  }

  // Modern versions of `resolve` support a specific entry point that custom resolvers can use
  // to inject a specific resolution logic without having to patch the whole package.
  //
  // Cf: https://github.com/browserify/resolve/pull/174

  patchedModules.push([
    /^\.\/normalize-options\.js$/,
    (issuer, normalizeOptions) => {
      if (!issuer || issuer.name !== 'resolve') {
        return normalizeOptions;
      }

      return (request, opts) => {
        opts = opts || {};

        if (opts.forceNodeResolution) {
          return opts;
        }

        opts.preserveSymlinks = true;
        opts.paths = function(request, basedir, getNodeModulesDir, opts) {
          // Extract the name of the package being requested (1=full name, 2=scope name, 3=local name)
          const parts = request.match(/^((?:(@[^\/]+)\/)?([^\/]+))/);

          // make sure that basedir ends with a slash
          if (basedir.charAt(basedir.length - 1) !== '/') {
            basedir = path.join(basedir, '/');
          }
          // This is guaranteed to return the path to the "package.json" file from the given package
          const manifestPath = exports.resolveToUnqualified(`${parts[1]}/package.json`, basedir);

          // The first dirname strips the package.json, the second strips the local named folder
          let nodeModules = path.dirname(path.dirname(manifestPath));

          // Strips the scope named folder if needed
          if (parts[2]) {
            nodeModules = path.dirname(nodeModules);
          }

          return [nodeModules];
        };

        return opts;
      };
    },
  ]);
};

if (module.parent && module.parent.id === 'internal/preload') {
  exports.setupCompatibilityLayer();

  exports.setup();
}

if (process.mainModule === module) {
  exports.setupCompatibilityLayer();

  const reportError = (code, message, data) => {
    process.stdout.write(`${JSON.stringify([{code, message, data}, null])}\n`);
  };

  const reportSuccess = resolution => {
    process.stdout.write(`${JSON.stringify([null, resolution])}\n`);
  };

  const processResolution = (request, issuer) => {
    try {
      reportSuccess(exports.resolveRequest(request, issuer));
    } catch (error) {
      reportError(error.code, error.message, error.data);
    }
  };

  const processRequest = data => {
    try {
      const [request, issuer] = JSON.parse(data);
      processResolution(request, issuer);
    } catch (error) {
      reportError(`INVALID_JSON`, error.message, error.data);
    }
  };

  if (process.argv.length > 2) {
    if (process.argv.length !== 4) {
      process.stderr.write(`Usage: ${process.argv[0]} ${process.argv[1]} <request> <issuer>\n`);
      process.exitCode = 64; /* EX_USAGE */
    } else {
      processResolution(process.argv[2], process.argv[3]);
    }
  } else {
    let buffer = '';
    const decoder = new StringDecoder.StringDecoder();

    process.stdin.on('data', chunk => {
      buffer += decoder.write(chunk);

      do {
        const index = buffer.indexOf('\n');
        if (index === -1) {
          break;
        }

        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);

        processRequest(line);
      } while (true);
    });
  }
}
