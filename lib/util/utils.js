// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

'use strict';
var fs = require('fs');
var request = require('request');

// Remove byte order marker. This catches EF BB BF (the UTF-8 BOM)
// because the buffer-to-string conversion in `fs.readFile()`
// translates it to FEFF, the UTF-16 BOM.
function stripBOM(content) {
  if (Buffer.isBuffer(content)) {
    content = content.toString();
  }
  if (content.charCodeAt(0) === 0xFEFF || content.charCodeAt(0) === 0xFFFE) {
    content = content.slice(1);
  }
  return content;
}

/*
 * Provides a parsed JSON from the given file path or a url.
 *
 * @param {string} specPath - A local file path or a (github) url to the swagger spec.
 *
 * @returns {object} Swagger - Parsed Swagger document in JSON format.
 */

exports.parseJson = function parseJson(specPath) {
  let result = null;
  if (!specPath || (specPath && typeof specPath.valueOf() !== 'string')) {
    let err = new Error('A (github) url or a local file path to the swagger spec is required and must be of type string.');
    return Promise.rject(err);
  }
  //url
  if (specPath.match(/^http.*/ig) !== null) {
    //If the spec path is a url starting with https://github then let us auto convert it to an https://raw.githubusercontent url.
    if (specPath.startsWith('https://github')) {
      specPath = specPath.replace(/^https:\/\/(github.com)(.*)blob\/(.*)/ig, 'https://raw.githubusercontent.com$2$3');
    }
    return exports.makeRequest({ url: specPath, json: true });
  } else {
    //local filepath
    try {
      result = JSON.parse(stripBOM(fs.readFileSync(specPath, 'utf8')));
      return Promise.resolve(result);
    } catch (err) {
      return Promise.reject(err);
    }
  }
};

exports.run = function run(genfun) {
  // instantiate the generator object
  var gen = genfun();
  // This is the async loop pattern
  function next(err, answer) {
    var res;
    if (err) {
      // if err, throw it into the wormhole
      return gen.throw(err);
    } else {
      // if good value, send it
      res = gen.next(answer);
    }
    if (!res.done) {
      // if we are not at the end
      // we have an async request to
      // fulfill, we do this by calling 
      // `value` as a function
      // and passing it a callback
      // that receives err, answer
      // for which we'll just use `next()`
      res.value(next);
    }
  }
  // Kick off the async loop
  next();
};

exports.makeRequest = function makeRequest(options) {

  var promise = new Promise(function (resolve, reject) {
    request(options, function (err, response, responseBody) {
      if (err) {
        return reject(err);
      }
      if (response.statusCode !== 200) {
        var msg = `StatusCode: "${response.statusCode}", ResponseBody: "${responseBody}"`
        return reject(new Error(msg));
      }
      return resolve(responseBody);
    });
  });
  return promise;
};

exports = module.exports;