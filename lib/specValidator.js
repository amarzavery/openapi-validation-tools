﻿// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

'use strict';

var util = require('util'),
  path = require('path'),
  fs = require('fs'),
  Sway = require('sway'),
  msRest = require('ms-rest'),
  HttpRequest = msRest.WebResource,
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
    this.specValidationResult = { validityStatus: true, operations: { } };
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

  findObject(what, where, actualReference, docPath) {
    let self = this;
    let result = eval(`where.${what}`);
    if (!result) {
      let msg = `Object '${what}' from the given reference ` + 
      `'${actualReference}' is not found in the swagger spec '${docPath}'.`;
      let e = self.constructErrorObject('OBJECT_NOT_FOUND', msg);
      log.error(e);
      throw e;
    } else {
      return result;
    }
  }

  getDefinitionFromReference(reference) {
    let self = this;
    if (!reference || (reference && reference.trim().length === 0)) {
      throw new Error('reference cannot be null or undefined and it must be a non-empty string.');
    }
    let refObj = utils.parseReferenceInSwagger(reference);
    if (refObj.filePath) {
      let docPath = utils.joinPath(self.specDir, refObj.filePath);
      return utils.parseJson(docPath).then(function(result) {
        return self.findObject(refObj.localReference.accessorProperty, result, refObj.localReference.value, docPath);
      });
    } else {
      return self.findObject(refObj.localReference.accessorProperty, self.specInJson, refObj.localReference.value, self.specPath);
    }
  }

  mergeResolvedAllOfObjects(source, target) {
    let self = this;
    if (!source || (source && typeof source !== 'object')) {
      return Promise.reject(new Error(`source must be of type "object".`));
    }
    if (!target || (target && typeof target !== 'object')) {
      return Promise.reject(new Error(`target must be of type "object".`));
    }
    //merge the target model's properties
    source.properties = utils.merge(source.properties, target.properties);
    //merge the array of required properties
    if (target.required) {
      if (!source.required) {
        source.required = [];
      }
      source.required = [...new Set([...source.required, ...target.required])];
    }
    //merge x-ms-azure-resource
    if (target['x-ms-azure-resource']) {
      source['x-ms-azure-resource'] = target['x-ms-azure-resource'];
    }
    return Promise.resolve(source);
  }

  getRefDefinitionInAllOf(item) {
    let self = this;
    if (!item || (item && typeof item !== 'object')) {
      return Promise.reject(new Error(`item must be of type "object".`));
    }
    if (item['$ref']) {
      return Promise.resolve(self.getDefinitionFromReference(item['$ref']));
    } else {
      return Promise.resolve(item);
    }
  }

  composeAllOf(model, item) {
    let self = this;
    return self.getRefDefinitionInAllOf(item).then(function(result) {
      if (result && result.allOf) {
        return self.resolveAllOf(result).then(function(res) {
          return Promise.resolve(self.mergeResolvedAllOfObjects(model, result));
        }).catch(function (err) {
          log.error(err);
          return Promise.reject(err);
        });
      } else {
        return Promise.resolve(self.mergeResolvedAllOfObjects(model, result));
      }
    });
  }

  resolveAllOf(model) {
    let self = this;
    if (!model || (model && typeof model !== 'object')) {
      return Promise.reject(new Error(`model cannot be null or undefined and must of type object.`));
    }
    if (model.allOf) {
      let mpf = model.allOf.map(function(item) {
        return Promise.resolve(self.composeAllOf(model, item));
      });
      return utils.executePromisesSequentially(mpf);
    }
    return Promise.resolve(model);
  }

  makeModelsStricter() {
    let self = this;
    let spec = self.specInJson;
    let definitions = spec.definitions;
    let modelNames = Object.keys(self.specInJson.definitions);
    let mpf = modelNames.map(function (modelName) {
      let model = definitions[modelName];
      if (model && !model.additionalProperties) {
        model.additionalProperties = false;
      }
      return self.resolveAllOf(model);
    });
    return utils.executePromisesSequentially(mpf);
  }

  updateValidityStatus(value) {
    if (!Boolean(value)) {
      this.specValidationResult.validityStatus = false;
    } else {
      this.specValidationResult.validityStatus = true;
    }
    return;
  }

  constructErrorObject(code, message, innerErrors, skipValidityStatusUpdate) {
    let err = {
      code: code,
      message: message,
    }
    if (innerErrors) {
      err.innerErrors = innerErrors;
    }
    if (!skipValidityStatusUpdate) {
      this.updateValidityStatus();
    }
    return err;
  }

  initialize() {
    let self = this;
    return utils.parseJson(self.specPath).then(function (result) {
      self.specInJson = result;
      self.unifyXmsPaths();
      return self;
    }).then(function () {
      return self.makeModelsStricter();
    }).then(function() {
      return Object.keys(self.specInJson.definitions).map(function(definitionName){
        if (self.specInJson.definitions[definitionName].allOf) {
          delete self.specInJson.definitions[definitionName].allOf;
        }
      });
    }).then(function() {
      let options = {};
      options.definition = self.specInJson;
      options.jsonRefs = {};
      options.jsonRefs.includeInvalid = true;
      options.jsonRefs.relativeBase = self.specDir;
      return Sway.create(options);
    }).then(function (api) {
      self.swaggerApi = api;
      return Promise.resolve(api);
    }).catch(function (err) {
      console.dir(err);
      let e = self.constructErrorObject(ErrorCodes.ResolveSpecError, err.message, [err]);
      self.specValidationResult.resolveSpec = e;
      log.error(`${ErrorCodes.ResolveSpecError}: ${err.message}.`);
      return Promise.reject(e);
    });
  }

  validateSpec() {
    let self = this;
    self.specValidationResult.validateSpec = {};
    self.specValidationResult.validateSpec.isValid = true;
    if (!self.swaggerApi) {
      let msg = `Please call "specValidator.initialize()" before calling this method, so that swaggerApi is populated.`;
      let e = self.constructErrorObject(ErrorCodes.InitializationError, msg)
      self.specValidationResult.initialize = e;
      self.specValidationResult.validateSpec.isValid = false;
      log.error(`${ErrorCodes.InitializationError}: ${msg}`);
      return;
    }
    try {
      let validationResult = self.swaggerApi.validate();
      if (validationResult) {
        if (validationResult.errors && validationResult.errors.length) {
          self.specValidationResult.validateSpec.isValid = false;
          let e = self.constructErrorObject(ErrorCodes.SemanticValidationError, `The spec ${self.specPath} has semantic validation errors.`, validationResult.errors);
          self.specValidationResult.validateSpec.error = e;
          log.error(Constants.Errors);
          log.error('------');
          self.updateValidityStatus();
          log.error(e);
        } else {
          self.specValidationResult.validateSpec.result = `The spec ${self.specPath} is sematically valid.`
        }
        if (validationResult.warnings && validationResult.warnings.length > 0) {
          self.specValidationResult.validateSpec.warning = validationResult.warnings;
          log.warn(Constants.Warnings);
          log.warn('--------');
          log.warn(util.inspect(validationResult.warnings));
        }
      }
    } catch (err) {
      let msg = `An Internal Error occurred in validating the spec "${self.specPath}". \t${err.message}.`;
      err.code = ErrorCodes.InternalError;
      err.message = msg;
      self.specValidationResult.validateSpec.isValid = false;
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

  constructOperationResult(operation, result, exampleType) {
    let operationId = operation.operationId;
    if (result.exampleNotFound) {
      this.specValidationResult.operations[operationId][exampleType].error = result.exampleNotFound;
      log.error(result.exampleNotFound);
    }
    if (exampleType === Constants.xmsExamples) {
      if (result.scenarios) {
        this.specValidationResult.operations[operationId][Constants.xmsExamples].scenarios = {};
        for (let scenario in result.scenarios) {
          //requestValidation
          let requestValidationErrors = result.scenarios[scenario].requestValidation.validationResult.errors;
          let requestValidationWarnings = result.scenarios[scenario].requestValidation.validationResult.warnings;
          this.specValidationResult.operations[operationId][Constants.xmsExamples].scenarios[scenario] = {};
          this.specValidationResult.operations[operationId][Constants.xmsExamples].scenarios[scenario].isValid = true;
          this.specValidationResult.operations[operationId][Constants.xmsExamples].scenarios[scenario].request = {};
          this.specValidationResult.operations[operationId][Constants.xmsExamples].scenarios[scenario].request.isValid = true;
          let subMsg = `validating the request for x-ms-example "${scenario}" in operation "${operationId}"`;
          if (requestValidationErrors && requestValidationErrors.length) {
            this.specValidationResult.operations[operationId][Constants.xmsExamples].scenarios[scenario].isValid = false;
            this.specValidationResult.operations[operationId][Constants.xmsExamples].scenarios[scenario].request.isValid = false;
            let msg = `Found errors in ${subMsg}.`;
            let e = this.constructErrorObject(ErrorCodes.RequestValidationError, msg, requestValidationErrors);
            this.specValidationResult.operations[operationId][Constants.xmsExamples].scenarios[scenario].request.error = e;
            log.error(`${subMsg}:\n`, e);
          } else {
            let msg = `Request parameters for x-ms-example "${scenario}" in operation "${operationId}" is valid.`;
            this.specValidationResult.operations[operationId][Constants.xmsExamples].scenarios[scenario].request.result = msg;
            log.info(`${msg}`);
          }
          if (requestValidationWarnings && requestValidationWarnings.length) {
            this.specValidationResult.operations[operationId][Constants.xmsExamples].scenarios[scenario].request.warning = requestValidationWarnings;
            log.warn(`${subMsg}:\n`, requestValidationWarnings);
          }

          //responseValidation
          this.specValidationResult.operations[operationId][Constants.xmsExamples].scenarios[scenario].responses = {};
          for (let responseStatusCode in result.scenarios[scenario].responseValidation) {
            let responseValidationErrors = result.scenarios[scenario].responseValidation[responseStatusCode].errors;
            let responseValidationWarnings = result.scenarios[scenario].responseValidation[responseStatusCode].warnings;
            this.specValidationResult.operations[operationId][Constants.xmsExamples].scenarios[scenario].responses[responseStatusCode] = {};
            this.specValidationResult.operations[operationId][Constants.xmsExamples].scenarios[scenario].responses[responseStatusCode].isValid = true;
            let subMsg = `validating the response with statusCode "${responseStatusCode}" for x-ms-example "${scenario}" in operation "${operationId}"`;
            if (responseValidationErrors && responseValidationErrors.length) {
              this.specValidationResult.operations[operationId][Constants.xmsExamples].scenarios[scenario].isValid = false;
              this.specValidationResult.operations[operationId][Constants.xmsExamples].scenarios[scenario].responses[responseStatusCode].isValid = false;
              let msg = `Found errors in ${subMsg}.`;
              let e = this.constructErrorObject(ErrorCodes.ResponseValidationError, msg, responseValidationErrors);
              this.specValidationResult.operations[operationId][Constants.xmsExamples].scenarios[scenario].responses[responseStatusCode].error = e;
              log.error(`${subMsg}:\n`, e);
            } else {
              let msg = `Response with statusCode "${responseStatusCode}" for x-ms-example "${scenario}" in operation "${operationId}" is valid.`;
              this.specValidationResult.operations[operationId][Constants.xmsExamples].scenarios[scenario].responses[responseStatusCode].result = msg;
              log.info(`${msg}`);
            }
            if (responseValidationWarnings && responseValidationWarnings.length) {
              this.specValidationResult.operations[operationId][Constants.xmsExamples].scenarios[scenario].responses[responseStatusCode].warning = responseValidationWarnings;
              log.warn(`${subMsg}:\n`, responseValidationWarnings);
            }
          }
        }
      }
    } else if (exampleType === Constants.exampleInSpec) {
      if (result.requestValidation && Object.keys(result.requestValidation).length) {
        //requestValidation
        let requestValidationErrors = result.requestValidation.validationResult.errors;
        let requestValidationWarnings = result.requestValidation.validationResult.warnings;
        this.specValidationResult.operations[operationId][Constants.exampleInSpec].isValid = true;
        this.specValidationResult.operations[operationId][Constants.exampleInSpec].request = {};
        this.specValidationResult.operations[operationId][Constants.exampleInSpec].request.isValid = true;
        let subMsg = `validating the request for example in spec for operation "${operationId}`;
        if (requestValidationErrors && requestValidationErrors.length) {
          this.specValidationResult.operations[operationId][Constants.exampleInSpec].isValid = false;
          this.specValidationResult.operations[operationId][Constants.exampleInSpec].request.isValid = false;
          let msg = `Found errors in ${subMsg}.`;
          let e = this.constructErrorObject(ErrorCodes.RequestValidationError, msg, requestValidationErrors);
          this.specValidationResult.operations[operationId][Constants.exampleInSpec].request.error = e;
          log.error(`${subMsg}:\n`, e);
        } else {
          let msg = `Request parameters for example in spec for operation "${operationId}" is valid.`;
          this.specValidationResult.operations[operationId][Constants.exampleInSpec].request.result = msg;
          log.info(`${msg}`);
        }
        if (requestValidationWarnings && requestValidationWarnings.length) {
          this.specValidationResult.operations[operationId][Constants.exampleInSpec].request.warning = requestValidationWarnings;
          log.warn(`${subMsg}:\n`, requestValidationWarnings);
        }
      }
      if (result.responseValidation && Object.keys(result.responseValidation).length) {
        //responseValidation
        this.specValidationResult.operations[operationId][Constants.exampleInSpec].responses = {};
        for (let responseStatusCode in result.responseValidation) {
          let responseValidationErrors = result.responseValidation[responseStatusCode].errors;
          let responseValidationWarnings = result.responseValidation[responseStatusCode].warnings;
          this.specValidationResult.operations[operationId][Constants.exampleInSpec].responses[responseStatusCode] = {};
          this.specValidationResult.operations[operationId][Constants.exampleInSpec].responses[responseStatusCode].isValid = true;
          let subMsg = `validating the response with statusCode "${responseStatusCode}" for example in spec for operation "${operationId}"`;
          if (responseValidationErrors && responseValidationErrors.length) {
            this.specValidationResult.operations[operationId][Constants.exampleInSpec].isValid = false;
            this.specValidationResult.operations[operationId][Constants.exampleInSpec].responses[responseStatusCode].isValid = false;
            let msg = `Found errors in ${subMsg}.`;
            let e = this.constructErrorObject(ErrorCodes.ResponseValidationError, msg, responseValidationErrors);
            this.specValidationResult.operations[operationId][Constants.exampleInSpec].responses[responseStatusCode].error = e;
            log.error(`${subMsg}:\n`, e);
          } else {
            let msg = `Response with statusCode "${responseStatusCode}" for example in spec for operation "${operationId}" is valid.`;
            this.specValidationResult.operations[operationId][Constants.exampleInSpec].responses[responseStatusCode].result = msg;
            log.info(`${msg}`);
          }
          if (responseValidationWarnings && responseValidationWarnings.length) {
            this.specValidationResult.operations[operationId][Constants.exampleInSpec].responses[responseStatusCode].warning = responseValidationWarnings;
            log.warn(`${subMsg}:\n`, responseValidationWarnings);
          }
        }
      }
    }
    return;
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
      self.specValidationResult.operations[operation.operationId] = {};
      self.specValidationResult.operations[operation.operationId][Constants.xmsExamples] = {};
      self.specValidationResult.operations[operation.operationId][Constants.exampleInSpec] = {};
      self.validateOperation(operation);
      if (Object.keys(self.specValidationResult.operations[operation.operationId][Constants.exampleInSpec]).length === 0) {
        delete self.specValidationResult.operations[operation.operationId][Constants.exampleInSpec];
      }
    }
  }

  validateXmsExamples(operation) {
    let self = this;
    if (operation === null || operation === undefined || typeof operation !== 'object') {
      throw new Error('operation cannot be null or undefined and must be of type \'object\'.');
    }
    let xmsExamples = operation[Constants.xmsExamples];
    let result = {scenarios: {} };
    let resultScenarios = result.scenarios;
    if (xmsExamples) {
      for (let scenario in xmsExamples) {
        let xmsExample = xmsExamples[scenario];
        resultScenarios[scenario] = {};
        resultScenarios[scenario].requestValidation = self.validateRequest(operation, xmsExample.parameters);
        resultScenarios[scenario].responseValidation = self.validateXmsExampleResponses(operation, xmsExample.responses);
      }
    } else {
      let msg = `x-ms-example not found in ${operation.operationId}.`;
      result.exampleNotFound = self.constructErrorObject(ErrorCodes.XmsExampleNotFoundError, msg, null, true);
    }
    self.constructOperationResult(operation, result, Constants.xmsExamples);
    return;
  }

  validateExample(operation) {
    let self = this;
    if (operation === null || operation === undefined || typeof operation !== 'object') {
      throw new Error('operation cannot be null or undefined and must be of type \'object\'.');
    }
    let result = {};
    result.requestValidation = self.validateExampleRequest(operation);
    result.responseValidation = self.validateExampleResponses(operation);
    self.constructOperationResult(operation, result, Constants.exampleInSpec);
    return;
  }

  validateRequest(operation, exampleParameterValues) {
    let self = this;
    if (operation === null || operation === undefined || typeof operation !== 'object') {
      throw new Error('operation cannot be null or undefined and must be of type \'object\'.');
    }

    if (exampleParameterValues === null || exampleParameterValues === undefined || typeof exampleParameterValues !== 'object') {
      throw new Error(`In operation "${operation.operationId}", exampleParameterValues cannot be null or undefined and must be of type "object" (A dictionary of key-value pairs of parameter-names and their values).`);
    }
    let parameters = operation.getParameters();
    let options = {};
    options.method = operation.method;
    options.pathTemplate = operation.pathObject.path;
    parameters.forEach(function(parameter) {
      if (!exampleParameterValues[parameter.name]) {
        if (parameter.required) {
          throw new Error(`In operation "${operation.operationId}", parameter ${parameter.name} is required in the swagger spec but is not present in the provided example parameter values.`);
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
    let validationResult = operation.validateRequest(request);
    let result = { request: request, validationResult: validationResult };
    return result;
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
    let result = {};
    if (bodyParam && bodyParam.schema && bodyParam.schema.example) {
      let exampleParameterValues = {};
      for (let i=0; i <parameters.length; i++) {
        exampleParameterValues[parameters[i].name] = parameters[i].getSample();
      }
      exampleParameterValues[bodyParam.name] = bodyParam.schema.example;
      result = self.validateRequest(operation, exampleParameterValues);
    }
    return result;
  }

  validateXmsExampleResponses(operation, exampleResponseValue) {
    let self = this;
    let result = {};
    if (operation === null || operation === undefined || typeof operation !== 'object') {
      throw new Error('operation cannot be null or undefined and must be of type \'object\'.');
    }

    if (exampleResponseValue === null || exampleResponseValue === undefined || typeof exampleResponseValue !== 'object') {
      throw new Error('operation cannot be null or undefined and must be of type \'object\'.');
    }
    let responsesInSwagger = {};
    let responses = operation.getResponses().map(function(response) { 
      responsesInSwagger[response.statusCode] = response.statusCode; 
      return response.statusCode; 
    });
    for (let exampleResponseStatusCode in exampleResponseValue) {
      let response = operation.getResponse(exampleResponseStatusCode);
      if (responsesInSwagger[exampleResponseStatusCode]) delete responsesInSwagger[exampleResponseStatusCode];
      result[exampleResponseStatusCode] = { errors: [], warnings: [] };
      //have to ensure how to map negative status codes to default. There have been several issues filed in the Autorest repo, w.r.t how
      //default is handled. While solving that issue, we may come up with some extension. Once that is finalized, we should code accordingly over here.
      if (!response) {
        let msg = `Response statusCode "${exampleResponseStatusCode}" for operation "${operation.operationId}" is provided in exampleResponseValue, ` + 
        `however it is not present in the swagger spec.`;
        let e = self.constructErrorObject(ErrorCodes.ResponseStatusCodeNotInSpec, msg);
        result[exampleResponseStatusCode].errors.push(e);
        log.error(e);
        continue;
      }
      
      let exampleResponseHeaders = exampleResponseValue[exampleResponseStatusCode]['headers'] || {};
      let exampleResponseBody = exampleResponseValue[exampleResponseStatusCode]['body'];
      if (exampleResponseBody && !response.schema) {
        let msg = `Response statusCode "${exampleResponseStatusCode}" for operation "${operation.operationId}" has response body provided in the example, ` + 
        `however the response does not have a "schema" defined in the swagger spec.`;
        let e = self.constructErrorObject(ErrorCodes.ResponseSchemaNotInSpec, msg);
        result[exampleResponseStatusCode].errors.push(e);
        log.error(e);
        continue;
      }
      //ensure content-type header is present
      if (!(exampleResponseHeaders['content-type'] || exampleResponseHeaders['Content-Type'])) {
        exampleResponseHeaders['content-type'] = operation.produces[0];
      }
      let exampleResponse = new ResponseWrapper(exampleResponseStatusCode, exampleResponseBody, exampleResponseHeaders);
      let validationResult = self.validateResponse(operation, exampleResponse);
      result[exampleResponseStatusCode] = validationResult;
    }
    let responseWithoutXmsExamples = Object.keys(responsesInSwagger).filter(function (statusCode) {
      if (statusCode !== 'default') {
        //let intStatusCode = parseInt(statusCode);
        //if (!isNaN(intStatusCode) && intStatusCode < 400) {
          return statusCode;
        //}
      }
    });
    if (responseWithoutXmsExamples && responseWithoutXmsExamples.length) {
      let msg = `Following response status codes "${responseWithoutXmsExamples}" for operation "${operation.operationId}" were present in the swagger spec, ` + 
      `however they were not present in x-ms-examples. Please provide them.`;
    }
    return result;
  }

  validateExampleResponses(operation) {
    let self = this;
    if (operation === null || operation === undefined || typeof operation !== 'object') {
      throw new Error('operation cannot be null or undefined and must be of type \'object\'.');
    }
    let result = {};
    let responses = operation.getResponses();
    for (let i=0; i < responses.length; i++) {
      let response = responses[i];
      if (response.examples) {
        for (mimeType in response.examples) {
          let exampleResponseBody = response.examples[mimeType];
          let exampleResponseHeaders = { 'content-type': mimeType };
          let exampleResponse = new ResponseWrapper(response.statusCode, exampleResponseBody, exampleResponseHeaders);
          let validationResult = self.validateResponse(operation, exampleResponse);
          result[response.statusCode] = validationResult;
        }
      }
    }
    return result;
  }

}

module.exports = SpecValidator;