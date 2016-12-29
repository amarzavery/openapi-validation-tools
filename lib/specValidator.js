// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

'use strict';

var Sway = require('sway'),
  util = require('util'),
  msRest = require('ms-rest'),
  HttpRequest = msRest.WebResource,
  path = require('path'),
  fs = require('fs'),
  utils = require('./util/utils'),
  Constants = require('./util/constants'),
  ErrorCodes = Constants.ErrorCodes;

class SpecValidator {

  constructor(specPath, specInJson) {
    if (specPath === null || specPath === undefined || typeof specPath.valueOf() !== 'string' || !specPath.trim().length) {
      throw new Error ('specPath is a required parameter of type string and it cannot be an empty string.')
    }
    //If the spec path is a url starting with https://github then let us auto convert it to an https://raw.githubusercontent url.
    if (specPath.startsWith('https://github')) {
      specPath = specPath.replace(/^https:\/\/(github.com)(.*)blob\/(.*)/ig, 'https://raw.githubusercontent.com$2$3');
    }
    this.specPath = specPath;
    this.specDir = path.dirname(this.specPath);
    this.specInJson = specInJson;
    this.specValidationResult = { validityStatus: true, operations: {} };
    this.swaggerApi = null;
  }

  unifyXmsPaths() {
    //unify x-ms-paths into paths
    if (this.specInJson['x-ms-paths'] && this.specInJson['x-ms-paths'] instanceof Object &&
      Object.keys(this.specInJson['x-ms-paths']).length > 0) {
      let paths = this.specInJson.paths;
      for (let property in this.specInJson['x-ms-paths']) {
        paths[property] = this.specInJson['x-ms-paths'][property];
      }
      this.specInJson.paths = paths;
    }
  }

  updateValidityStatus(value) {
    if (!Boolean(value)) {
      this.specValidationResult.validityStatus = false;
    } else {
      this.specValidationResult.validityStatus = true;
    }
    return;
  }

  constructErrorObject(code, message, innerErrors) {
    let err = {
      code: code,
      message: message,
    }
    if (innerErrors) {
      err.innerErrors = innerErrors;
    }
    this.updateValidityStatus();
    return err;
  }

  initialize() {
    let self = this;
    return utils.parseJson(self.specPath).then(function (result) {
      self.specInJson = result;
      self.unifyXmsPaths();
      let options = {};
      options.definition = self.specInJson;
      options.jsonRefs = {};
      options.jsonRefs.relativeBase = self.specDir;
      return Sway.create(options);
    }).then(function (api) {
      self.swaggerApi = api;
      return Promise.resolve(api);
    }).catch(function (err) {
      return Promise.reject(err);
    });
  }

  validateSpec() {
    let self = this;
    return self.initialize().then(function (api) {
      let validationResult = self.swaggerApi.validate();
      if (validationResult) {
        if (validationResult.errors && validationResult.errors.length) {
          console.log('');
          console.log(Constants.Errors);
          console.log('------');
          self.updateValidityStatus();
          console.dir(validationResult.errors, { depth: null, colors: true });
        }
        if (validationResult.warnings && validationResult.warnings.length > 0) {
          console.log('');
          console.log(Constants.Warnings);
          console.log('--------');
          console.dir(validationResult.warnings, { depth: null, colors: true });
        }
      }
      return Promise.resolve();
    }).catch(function (err) {
      let msg = `An Internal Error occurred in validating the spec "${self.specPath}". \t${err.message}.`;
      err.code = ErrorCodes.InternalError;
      err.message = msg;
      self.specValidationResult.validateSpec = {};
      self.specValidationResult.validateSpec.error = err;
      console.dir(`${err}`, { depth: null, colors: true });
      self.updateValidityStatus();
      return Promise.resolve();
    })
  }

  getOperationById(id) {
    if (!self.swaggerApi) {
      throw new Error(`Please call specValidator.initialize() so that swaggerApi is populated, before calling this method.`);
    }
    if (!id) {
      throw new Error(`id cannot be null or undefined and must be of type string.`);
    }
    let result = this.swaggerApi.getOperations().filter(function(item) {
      return (item.operationId === id);
    });
    return result[0];
  }

  getXmsExamples(idOrObj) {
    if (!idOrObj) {
      throw new Error(`idOrObj cannot be null or undefined and must be of type string or object.`);
    }
    let operation = {};
    if (typeof idOrObj.valueOf() === 'string') {
      operation = self.getOperationById(id);
    } else {
      operation = idOrObj;
    }
    let result;
    if (operation && operation['x-ms-examples']) {
      result = operation['x-ms-examples'];
    }
    return result;
  }

  validateOperation(operation) {
    //validateXmsExamples
      //validateRequest
      //validateResponse
    //validateExample
      //validateRequest
      //validateResponse
    let xmsExamples = operation['x-ms-examples'];
    if (xmsExamples) {
      let parameters = operation.getParameters();
      let exampleParameters = xmsExamples.parameters;
      parameters.forEach(function(parameter) {
        if (!exampleParameters[parameter.name]) {
          throw new Error('Parameter not found in x-ms-examples.');
        }
        let options = {};
        if (parameter.in === 'path') {
          if (!options.pathParameters) options.pathParameters = {};
          if (parameter['x-ms-skip-url-encoding']) {
            options.pathParameters[parameter.name] = {
              value: exampleParameters[parameter.name],
              skipUrlEncoding: true
            };
          } else {
            options.pathParameters[parameter.name] = exampleParameters[parameter.name];
          }
        } else if (parameter.in === 'query') {
          if (!options.queryParameters) options.queryParameters = {};
          if (parameter['x-ms-skip-url-encoding']) {
            options.queryParameters[parameter.name] = {
              value: exampleParameters[parameter.name],
              skipUrlEncoding: true
            };
          } else {
            options.queryParameters[parameter.name] = exampleParameters[parameter.name];
          }
        } else if (parameter.in === 'body') {
          options.body = exampleParameters[parameter.name];
          options.disablebJsonStringifyBody = true;
        } else if (parameter.in === 'header') {
          if (!options.headers) options.headers = {};
          options.headers[parameter.name] = exampleParameters[parameter.name];
        }
      });
      let request = new HttpRequest();
      request = request.prepare(options);
      let validationResult = operation.validateRequest(req);
    }
  }
}

module.exports = SpecValidator;