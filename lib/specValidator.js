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
  log = require('./util/logging'),
  ResponseWrapper = require('./responseWrapper'),
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
    if (!self.swaggerApi) {
      throw new Error(`Please call "specValidator.initialize()" before calling this method, so that swaggerApi is populated.`);
    }
    try {
      let validationResult = self.swaggerApi.validate();
      if (validationResult) {
        if (validationResult.errors && validationResult.errors.length) {
          log.info('');
          log.info(Constants.Errors);
          log.info('------');
          self.updateValidityStatus();
          log.error(validationResult.errors);
        }
        if (validationResult.warnings && validationResult.warnings.length > 0) {
          log.info('');
          log.info(Constants.Warnings);
          log.info('--------');
          log.warn(util.inspect(validationResult.warnings));
        }
      }
    } catch (err) {
      let msg = `An Internal Error occurred in validating the spec "${self.specPath}". \t${err.message}.`;
      err.code = ErrorCodes.InternalError;
      err.message = msg;
      self.specValidationResult.validateSpec = {};
      self.specValidationResult.validateSpec.error = err;
      log.error(err);
      self.updateValidityStatus();
    }
  }

  getOperationById(id) {
    let self = this;
    if (!self.swaggerApi) {
      throw new Error(`Please call specValidator.initialize() so that swaggerApi is populated, before calling this method.`);
    }
    if (!id) {
      throw new Error(`id cannot be null or undefined and must be of type string.`);
    }
    let result = this.swaggerApi.getOperations().find(function(item) {
      return (item.operationId === id);
    });
    return result;
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
    if (operation && operation[Constants.xmsExamples]) {
      result = operation[Constants.xmsExamples];
    }
    return result;
  }

  validateOperation(operation) {
    let self = this;
    self.validateXmsExamples(operation);
    self.validateExample(operation);
  }

  validateOperations(operationIds) {
    let self = this;
    if (!self.swaggerApi) {
      throw new Error(`Please call "specValidator.initialize()" before calling this method, so that swaggerApi is populated.`);
    }
    if (operationIds !== null && operationIds !== undefined && typeof operationIds.valueOf() !== 'string') {
      throw new Error(`operationIds parameter must be of type 'string'.`);
    }
    
    let operations = self.swaggerApi.getOperations();
    if (operationIds) {
      let operationIdsObj = {};
      operationIds.trim().split(',').map(function(item) { operationIdsObj[item.trim()] = 1; });
      let operationsToValidate = operations.filter(function(item) {
        return Boolean(operationIdsObj[item.operationId]);
      });
      if (operationsToValidate.length) operations = operationsToValidate;
    }
    for (let i=0; i<operations.length; i++) {
      let operation = operations[i];
      self.validateOperation(operation);
    }
  }

  validateXmsExamples(operation) {
    let self = this;
    if (operation === null || operation === undefined || typeof operation !== 'object') {
      throw new Error('operation cannot be null or undefined and must be of type \'object\'.');
    }
    let xmsExamples = operation[Constants.xmsExamples];
    if (xmsExamples) {
      for (let scenario in xmsExamples) {
        let xmsExample = xmsExamples[scenario];
        let validationResult = self.validateRequest(operation, xmsExample.parameters);
        log.info(`${operation.operationId}: x-ms-example request validation\n${util.inspect(validationResult, {depth: null})}`);
        self.validateXmsExampleResponses(operation, xmsExample.responses);
      }
    }
    return;
  }

  validateExample(operation) {
    let self = this;
    if (operation === null || operation === undefined || typeof operation !== 'object') {
      throw new Error('operation cannot be null or undefined and must be of type \'object\'.');
    }
    self.validateExampleRequest(operation);
    self.validateExampleResponses(operation);
  }

  validateRequest(operation, exampleParameterValues) {
    let self = this;
    if (operation === null || operation === undefined || typeof operation !== 'object') {
      throw new Error('operation cannot be null or undefined and must be of type \'object\'.');
    }

    if (exampleParameterValues === null || exampleParameterValues === undefined || typeof exampleParameterValues !== 'object') {
      throw new Error('exampleParameterValues cannot be null or undefined and must be of type \'object\' (A dictionary of key-value pairs of parameter-names and their values).');
    }
    let parameters = operation.getParameters();
    let options = {};
    options.method = operation.method;
    options.pathTemplate = operation.pathObject.path;
    parameters.forEach(function(parameter) {
      if (!exampleParameterValues[parameter.name]) {
        if (parameter.required) {
          throw new Error(`Parameter ${parameter.name} is required in the swagger spec but is not present in the provided example parameter values.`);
        }
        return;
      }
      let location = parameter.in;
      if (location === 'path' || location === 'query') {
        let paramType = location + 'Parameters';
        if (!options[paramType]) options[paramType] = {};
        if (parameter[Constants.xmsSkipUrlEncoding]) {
          options[paramType][parameter.name] = {
            value: exampleParameterValues[parameter.name],
            skipUrlEncoding: true
          };
        } else {
          options[paramType][parameter.name] = exampleParameterValues[parameter.name];
        }
      } else if (location === 'body') {
        options.body = exampleParameterValues[parameter.name];
        options.disableJsonStringifyOnBody = true;
      } else if (location === 'header') {
        if (!options.headers) options.headers = {};
        options.headers[parameter.name] = exampleParameterValues[parameter.name];
      }
    });
    let request = new HttpRequest();
    request = request.prepare(options);
    return operation.validateRequest(request);
  }

  validateResponse(operationOrResponse, responseWrapper) {
    let self = this;
    if (operationOrResponse === null || operationOrResponse === undefined || typeof operationOrResponse !== 'object') {
      throw new Error('operationOrResponse cannot be null or undefined and must be of type \'object\'.');
    }

    if (responseWrapper === null || responseWrapper === undefined || typeof responseWrapper !== 'object') {
      throw new Error('responseWrapper cannot be null or undefined and must be of type \'object\'.');
    }

    return operationOrResponse.validateResponse(responseWrapper);
  }

  validateExampleRequest(operation) {
    let self = this;
    if (operation === null || operation === undefined || typeof operation !== 'object') {
      throw new Error('operation cannot be null or undefined and must be of type \'object\'.');
    }
    let parameters = operation.getParameters();
    //as per swagger specification https://github.com/OAI/OpenAPI-Specification/blob/master/versions/2.0.md#fixed-fields-13
    //example can only be provided in a schema and schema can only be provided for a body parameter. Hence, if the body 
    //parameter schema has an example, then we will populate sample values for other parameters and create a request object.
    //This request object will be used to validate the body parameter example. Otherwise, we will skip it.
    let bodyParam = parameters.find(function(item) {
      return (item.in === 'body');
    });
    if (bodyParam && bodyParam.schema && bodyParam.schema.example) {
      let exampleParameterValues = {};
      for (let i=0; i <parameters.length; i++) {
        exampleParameterValues[parameters[i].name] = parameters[i].getSample();
      }
      exampleParameterValues[bodyParam.name] = bodyParam.schema.example;
      let validationResult = self.validateRequest(operation, exampleParameterValues);
      log.info(`${operation.operationId}: example request validation\n${util.inspect(validationResult, {depth: null})}`);
    }
  }

  validateXmsExampleResponses(operation, exampleResponseValue) {
    let self = this;
    if (operation === null || operation === undefined || typeof operation !== 'object') {
      throw new Error('operation cannot be null or undefined and must be of type \'object\'.');
    }

    if (exampleResponseValue === null || exampleResponseValue === undefined || typeof exampleResponseValue !== 'object') {
      throw new Error('operation cannot be null or undefined and must be of type \'object\'.');
    }

    for (let exampleResponseStatusCode in exampleResponseValue) {
      let response = operation.getResponse(exampleResponseStatusCode);
      if (!response) {
        let e = new Error(`${exampleResponseStatusCode} for operation ${operation.operationId} is provided in exampleResponseValue, however it is not present in the swagger spec.`);
        log.error(e);
        continue;
      }
      let exampleResponseHeaders = exampleResponseValue[exampleResponseStatusCode]['headers'] || {};
      let exampleResponseBody = exampleResponseValue[exampleResponseStatusCode]['body'];
      //ensure content-type header is present
      if (!(exampleResponseHeaders['content-type'] || exampleResponseHeaders['Content-Type'])) {
        exampleResponseHeaders['content-type'] = operation.produces[0];
      }
      let exampleResponse = new ResponseWrapper(exampleResponseStatusCode, exampleResponseBody, exampleResponseHeaders);
      let validationResult = self.validateResponse(operation, exampleResponse);
      log.info(`${operation.operationId}: x-ms-example response statusCode: ${exampleResponseStatusCode} validation\n${util.inspect(validationResult, {depth: null})}`);
    }
  }

  validateExampleResponses(operation) {
    let self = this;
    if (operation === null || operation === undefined || typeof operation !== 'object') {
      throw new Error('operation cannot be null or undefined and must be of type \'object\'.');
    }

    let responses = operation.getResponses();
    for (let i=0; i < responses.length; i++) {
      let response = responses[i];
      if (response.examples) {
        for (mimeType in response.examples) {
          let exampleResponseBody = response.examples[mimeType];
          let exampleResponseHeaders = { 'content-type': mimeType };
          let exampleResponse = new ResponseWrapper(response.statusCode, exampleResponseBody, exampleResponseHeaders);
          let validationResult = self.validateResponse(operation, exampleResponse);
          log.info(`${operation.operationId}: example response statusCode: ${response.statusCode} validation\n${util.inspect(validationResult, {depth: null})}`);
        }
      }
    }
  }
}

module.exports = SpecValidator;