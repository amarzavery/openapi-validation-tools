// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

'use strict';

var log = require('./lib/util/logging'),
  utils = require('./lib/util/utils'),
  path = require('path'),
  SpecValidator = require('./lib/specValidator');

exports.finalValidationResult = { validityStatus: true };

exports.getDocumentsFromCompositeSwagger = function getDocumentsFromCompositeSwagger(compositeSpecPath) {
  let compositeSwagger;
  let finalDocs = [];
  return utils.parseJson(compositeSpecPath).then(function (result) {
    compositeSwagger = result;
    if (!(compositeSwagger.documents && Array.isArray(compositeSwagger.documents) && compositeSwagger.documents.length > 0)) {
      throw new Error(`CompositeSwagger - ${compositeSpecPath} must contain a documents property and it must be of type array and it must be a non empty array.`);
    }
    let docs = compositeSwagger.documents;
    let basePath = path.dirname(compositeSpecPath);
    for (let i=0; i<docs.length; i++) {
      if (docs[i].startsWith('.')) {
        docs[i] = docs[i].substring(1);
      }
      let individualPath = '';
      if (docs[i].startsWith('http')) {
        individualPath = docs[i];
      } else {
        individualPath = basePath + docs[i];
      }
      finalDocs.push(individualPath);
    }
    return finalDocs;
  }).catch(function (err) {
    return Promise.reject(err);
  });
};

exports.validateSpec = function validateSpec(specPath) {
  let validator = new SpecValidator(specPath);
  exports.finalValidationResult[specPath] = validator.specValidationResult;
  validator.initialize().then(function() {
    console.log(`\n> Semantically validating  ${specPath}:\n`);
    validator.validateSpec();
    return exports.updateEndResultOfSingleValidation(validator);
  }).catch(function(err) {
    console.dir(err, {depth: null, colors: true});
    return;
  });
};

exports.executeSequentially = function executeSequentially(promiseFactories) {
  var result = Promise.resolve();
  promiseFactories.forEach(function (promiseFactory) {
    result = result.then(promiseFactory);
  });
  return result;
};

exports.validateCompositeSpec = function validateCompositeSpec(compositeSpecPath){
  return exports.getDocumentsFromCompositeSwagger(compositeSpecPath).then(function(docs) {
    let promiseFactories = docs.map(function(doc) {
      return exports.validateSpec(doc);
    });
    return exports.executeSequentially(promiseFactories);
  }).catch(function (err) {
    console.dir(err, {depth: null, colors: true});
  });
};

exports.validateExamples = function validateExamples(specPath, operationIds) {
  let validator = new SpecValidator(specPath);
  exports.finalValidationResult[specPath] = validator.specValidationResult;
  validator.initialize().then(function() {
    console.log(`\n> Validating "examples" and "x-ms-examples" in  ${specPath}:\n`);
    validator.validateOperations(operationIds);
    exports.updateEndResultOfSingleValidation(validator);
  }).catch(function (err) {
    console.dir(err, {depth: null, colors: true});
  });
};

exports.validateExamplesInCompositeSpec = function validateExamplesInCompositeSpec(compositeSpecPath){
  return exports.getDocumentsFromCompositeSwagger(compositeSpecPath).then(function(docs) {
    let promiseFactories = docs.map(function(doc) {
      return exports.validateExamples(doc);
    });
    return exports.executeSequentially(promiseFactories);
  }).catch(function (err) {
    console.dir(err, {depth: null, colors: true});
  });
};

exports.updateEndResultOfSingleValidation = function updateEndResultOfSingleValidation(validator) {
  if (validator.specValidationResult.validityStatus) console.log('\n> No Errors were found.');
  if (!validator.specValidationResult.validityStatus) {
    exports.finalValidationResult.validityStatus = validator.specValidationResult.validityStatus;
  }
  return;
}

exports = module.exports;