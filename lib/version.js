'use strict';
// ChurchStream's version. In a built app it is baked in by the bundler (scripts/build-exe.js),
// so an app pack carries its own version; in development it comes from package.json.
/* global __CS_VERSION__ */
module.exports = (typeof __CS_VERSION__ !== 'undefined' && __CS_VERSION__) || require('../package.json').version;
